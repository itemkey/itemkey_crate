import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from "pg";

import { assertValidUserId } from "@/lib/account-user-id";
import { getPostgresPool } from "@/lib/db/postgres";
import { toErrorMessage } from "@/lib/errors";
import type { AppUserRow } from "@/lib/types";

const APP_USER_COLUMNS =
  "id,email,email_verified_at,user_id,user_id_changed_at,nickname,profile_description,avatar_url,created_at,updated_at";
const MIGRATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const USER_ID_CHANGE_COOLDOWN_DAYS = parseBoundedIntEnv(
  process.env.USER_ID_CHANGE_COOLDOWN_DAYS,
  30,
  1,
  365
);

const MIGRATION_CODE_TTL_MINUTES = parseBoundedIntEnv(
  process.env.MIGRATION_CODE_TTL_MINUTES,
  20,
  5,
  1440
);

const MIGRATION_CODE_PEPPER = process.env.MIGRATION_CODE_PEPPER?.trim() ?? "";

type SqlExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};

type MigrationCodeRecord = {
  id: string;
  code_hash: string;
  attempts: number;
};

type ActiveMigrationCodeMeta = {
  codeHint: string;
  expiresAt: string;
};

type IssueMigrationCodeResult = ActiveMigrationCodeMeta & {
  code: string;
};

export class UserIdTakenError extends Error {
  constructor() {
    super("Такой user-id уже занят.");
    this.name = "UserIdTakenError";
  }
}

export class UserIdCooldownError extends Error {
  readonly nextAllowedAt: string;

  constructor(nextAllowedAt: string) {
    super("user-id можно менять только раз в 30 дней.");
    this.name = "UserIdCooldownError";
    this.nextAllowedAt = nextAllowedAt;
  }
}

export class MigrationCodeInvalidError extends Error {
  constructor() {
    super("Неверный migration-код или user-id.");
    this.name = "MigrationCodeInvalidError";
  }
}

export type AccountStore = {
  source: "postgres";
  isUserIdAvailable(userId: string, excludeAppUserId?: string): Promise<boolean>;
  getByAppUserId(appUserId: string): Promise<AppUserRow | null>;
  updateProfile(
    appUserId: string,
    patch: {
      nickname?: string;
      profileDescription?: string;
      avatarUrl?: string | null;
    }
  ): Promise<AppUserRow>;
  updateUserId(appUserId: string, userId: string): Promise<AppUserRow>;
  getUserIdChangeAvailability(appUserId: string): Promise<{
    canChangeNow: boolean;
    nextAllowedAt: string | null;
  }>;
  issueMigrationCode(appUserId: string): Promise<IssueMigrationCodeResult>;
  getActiveMigrationCode(appUserId: string): Promise<ActiveMigrationCodeMeta | null>;
  consumeMigrationCodeByUserId(input: {
    userId: string;
    code: string;
  }): Promise<{ appUserId: string }>;
};

let cachedAccountStore: AccountStore | null = null;

function parseBoundedIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  if (normalized < min || normalized > max) {
    return fallback;
  }

  return normalized;
}

function normalizeAppUser(row: AppUserRow): AppUserRow {
  return {
    ...row,
    email_verified_at: row.email_verified_at ?? null,
    user_id: row.user_id ?? null,
    user_id_changed_at: row.user_id_changed_at ?? null,
    nickname: typeof row.nickname === "string" ? row.nickname : "",
    profile_description:
      typeof row.profile_description === "string" ? row.profile_description : "",
    avatar_url:
      typeof row.avatar_url === "string" && row.avatar_url.trim().length > 0
        ? row.avatar_url
        : null,
    email: typeof row.email === "string" ? row.email : "",
  };
}

function buildCodeHint(code: string): string {
  const normalized = code.replace(/-/g, "");
  return `***${normalized.slice(-4)}`;
}

function buildMigrationCode(): string {
  const bytes = randomBytes(16);
  let code = "";

  for (let index = 0; index < 16; index += 1) {
    const charIndex = bytes[index] % MIGRATION_CODE_ALPHABET.length;
    code += MIGRATION_CODE_ALPHABET[charIndex];
  }

  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

function hashMigrationCode(code: string): string {
  return createHash("sha256")
    .update(`${code}:${MIGRATION_CODE_PEPPER}`)
    .digest("hex");
}

function isHashEqual(expectedHash: string, actualHash: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");

  if (expected.length === 0 || actual.length === 0 || expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function calculateNextUserIdChangeAt(current: AppUserRow): string | null {
  if (!current.user_id || !current.user_id_changed_at) {
    return null;
  }

  const changedAt = new Date(current.user_id_changed_at);
  if (!Number.isFinite(changedAt.getTime())) {
    return null;
  }

  const next = new Date(changedAt.getTime() + USER_ID_CHANGE_COOLDOWN_DAYS * 86400000);
  return next.toISOString();
}

function assertUserIdChangeAllowed(current: AppUserRow): void {
  if (!current.user_id) {
    return;
  }

  const nextAllowedAt = calculateNextUserIdChangeAt(current);
  if (!nextAllowedAt) {
    return;
  }

  if (Date.now() < new Date(nextAllowedAt).getTime()) {
    throw new UserIdCooldownError(nextAllowedAt);
  }
}

function isPgUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as { code?: unknown; constraint?: unknown };
  if (value.code === "23505") {
    return true;
  }

  if (typeof value.constraint !== "string") {
    return false;
  }

  return value.constraint.includes("user_id");
}

async function withPostgresTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getAppUserByIdPostgres(
  executor: SqlExecutor,
  appUserId: string
): Promise<AppUserRow | null> {
  const { rows } = await executor.query<AppUserRow>(
    `
      select ${APP_USER_COLUMNS}
      from public.app_users
      where id = $1::uuid
      limit 1
    `,
    [appUserId]
  );

  const row = rows[0];
  return row ? normalizeAppUser(row) : null;
}

function createPostgresAccountStore(): AccountStore {
  const pool = getPostgresPool();

  return {
    source: "postgres",
    async isUserIdAvailable(userId, excludeAppUserId) {
      const normalized = assertValidUserId(userId);
      const { rows } = await pool.query<{ exists: boolean }>(
        `
          select true as exists
          from public.app_users
          where user_id = $1::text
            and (
              $2::uuid is null
              or id <> $2::uuid
            )
          limit 1
        `,
        [normalized, excludeAppUserId ?? null]
      );

      return rows.length === 0;
    },
    async getByAppUserId(appUserId) {
      return getAppUserByIdPostgres(pool, appUserId);
    },
    async updateProfile(appUserId, patch) {
      return withPostgresTransaction(pool, async (client) => {
        const current = await getAppUserByIdPostgres(client, appUserId);
        if (!current) {
          throw new Error("Профиль аккаунта не найден.");
        }

        const nextNickname = patch.nickname ?? current.nickname;
        const nextProfileDescription =
          patch.profileDescription ?? current.profile_description;
        const nextAvatarUrl =
          typeof patch.avatarUrl === "undefined" ? current.avatar_url : patch.avatarUrl;

        const { rows } = await client.query<AppUserRow>(
          `
            update public.app_users
            set
              nickname = $2::text,
              profile_description = $3::text,
              avatar_url = $4::text
            where id = $1::uuid
            returning ${APP_USER_COLUMNS}
          `,
          [appUserId, nextNickname, nextProfileDescription, nextAvatarUrl]
        );

        const updated = rows[0];
        if (!updated) {
          throw new Error("Не удалось обновить профиль аккаунта.");
        }

        return normalizeAppUser(updated);
      });
    },
    async updateUserId(appUserId, userId) {
      const normalized = assertValidUserId(userId);

      return withPostgresTransaction(pool, async (client) => {
        const { rows } = await client.query<AppUserRow>(
          `
            select ${APP_USER_COLUMNS}
            from public.app_users
            where id = $1::uuid
            for update
          `,
          [appUserId]
        );

        const current = rows[0] ? normalizeAppUser(rows[0]) : null;
        if (!current) {
          throw new Error("Профиль аккаунта не найден.");
        }

        if (current.user_id === normalized) {
          return current;
        }

        assertUserIdChangeAllowed(current);

        try {
          const { rows: updatedRows } = await client.query<AppUserRow>(
            `
              update public.app_users
              set
                user_id = $2::text,
                user_id_changed_at = now()
              where id = $1::uuid
              returning ${APP_USER_COLUMNS}
            `,
            [appUserId, normalized]
          );

          const updated = updatedRows[0];
          if (!updated) {
            throw new Error("Не удалось обновить user-id.");
          }

          return normalizeAppUser(updated);
        } catch (error) {
          if (isPgUniqueViolation(error)) {
            throw new UserIdTakenError();
          }

          throw error;
        }
      });
    },
    async getUserIdChangeAvailability(appUserId) {
      const current = await getAppUserByIdPostgres(pool, appUserId);
      if (!current) {
        throw new Error("Профиль аккаунта не найден.");
      }

      const nextAllowedAt = calculateNextUserIdChangeAt(current);
      if (!nextAllowedAt) {
        return { canChangeNow: true, nextAllowedAt: null };
      }

      return {
        canChangeNow: Date.now() >= new Date(nextAllowedAt).getTime(),
        nextAllowedAt,
      };
    },
    async issueMigrationCode(appUserId) {
      const code = buildMigrationCode();
      const codeHash = hashMigrationCode(code);
      const codeHint = buildCodeHint(code);
      const expiresAt = new Date(
        Date.now() + MIGRATION_CODE_TTL_MINUTES * 60000
      ).toISOString();

      await withPostgresTransaction(pool, async (client) => {
        await client.query(
          `
            update public.migration_codes
            set consumed_at = now()
            where app_user_id = $1::uuid
              and consumed_at is null
          `,
          [appUserId]
        );

        await client.query(
          `
            insert into public.migration_codes (
              app_user_id,
              code_hash,
              code_hint,
              expires_at
            )
            values ($1::uuid, $2::text, $3::text, $4::timestamptz)
          `,
          [appUserId, codeHash, codeHint, expiresAt]
        );
      });

      return {
        code,
        codeHint,
        expiresAt,
      };
    },
    async getActiveMigrationCode(appUserId) {
      const { rows } = await pool.query<{ code_hint: string; expires_at: string }>(
        `
          select code_hint, expires_at
          from public.migration_codes
          where app_user_id = $1::uuid
            and consumed_at is null
            and expires_at > now()
          order by created_at desc
          limit 1
        `,
        [appUserId]
      );

      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        codeHint: row.code_hint,
        expiresAt: row.expires_at,
      };
    },
    async consumeMigrationCodeByUserId(input) {
      const normalizedUserId = assertValidUserId(input.userId);
      const normalizedCode = input.code.trim().toUpperCase();
      if (!normalizedCode) {
        throw new MigrationCodeInvalidError();
      }

      return withPostgresTransaction(pool, async (client) => {
        const { rows: appUsers } = await client.query<{ id: string }>(
          `
            select id
            from public.app_users
            where user_id = $1::text
            limit 1
            for update
          `,
          [normalizedUserId]
        );

        const appUserId = appUsers[0]?.id;
        if (!appUserId) {
          throw new MigrationCodeInvalidError();
        }

        const { rows: codeRows } = await client.query<MigrationCodeRecord>(
          `
            select id, code_hash, attempts
            from public.migration_codes
            where app_user_id = $1::uuid
              and consumed_at is null
              and expires_at > now()
            order by created_at desc
            limit 1
            for update
          `,
          [appUserId]
        );

        const activeCode = codeRows[0];
        if (!activeCode) {
          throw new MigrationCodeInvalidError();
        }

        const providedHash = hashMigrationCode(normalizedCode);
        if (!isHashEqual(activeCode.code_hash, providedHash)) {
          await client.query(
            `
              update public.migration_codes
              set attempts = attempts + 1
              where id = $1::uuid
            `,
            [activeCode.id]
          );

          throw new MigrationCodeInvalidError();
        }

        await client.query(
          `
            update public.migration_codes
            set consumed_at = now()
            where id = $1::uuid
          `,
          [activeCode.id]
        );

        return { appUserId };
      });
    },
  };
}

export async function getAccountStore(): Promise<AccountStore> {
  if (cachedAccountStore) {
    return cachedAccountStore;
  }

  try {
    cachedAccountStore = createPostgresAccountStore();
    return cachedAccountStore;
  } catch (error) {
    throw new Error(toErrorMessage(error, "postgres account store initialization failed."));
  }
}
