import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from "pg";

import {
  assertValidPasswordCandidate,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { assertValidUserId } from "@/lib/account-user-id";
import {
  buildSessionExpiryDate,
  buildSessionToken,
  hashSessionToken,
} from "@/lib/auth/session";
import { getPostgresPool } from "@/lib/db/postgres";
import type { AppUserRow } from "@/lib/types";

const APP_USER_COLUMNS =
  "id,email,email_verified_at,user_id,user_id_changed_at,nickname,profile_description,avatar_url,created_at,updated_at";
const APP_USER_COLUMNS_FROM_USERS = APP_USER_COLUMNS.split(",")
  .map((column) => `users.${column}`)
  .join(",");

const AUTH_REQUIRE_EMAIL_VERIFICATION = parseBooleanEnv(
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION,
  true
);

const AUTH_SESSION_MAX_PER_USER = parseBoundedIntEnv(
  process.env.AUTH_SESSION_MAX_PER_USER,
  5,
  1,
  20
);

const EMAIL_VERIFICATION_TTL_MINUTES = parseBoundedIntEnv(
  process.env.EMAIL_VERIFICATION_TTL_MINUTES,
  1440,
  5,
  10080
);

const PASSWORD_RESET_TTL_MINUTES = parseBoundedIntEnv(
  process.env.PASSWORD_RESET_TTL_MINUTES,
  30,
  5,
  1440
);

const AUTH_TOKEN_PEPPER = process.env.AUTH_TOKEN_PEPPER?.trim() ?? "";
const AUTH_CLEANUP_INTERVAL_MS = parseBoundedIntEnv(
  process.env.AUTH_CLEANUP_INTERVAL_SECONDS,
  900,
  60,
  86400
) * 1000;

type SqlExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};

type AuthUserRow = AppUserRow & {
  password_hash: string;
};

type SessionJoinRow = AppUserRow & {
  session_id: string;
  expires_at: string;
};

type VerificationTokenRow = {
  id: string;
  app_user_id: string;
  expires_at: string;
  consumed_at: string | null;
};

type PasswordResetTokenRow = {
  id: string;
  app_user_id: string;
  expires_at: string;
  consumed_at: string | null;
};

type PgErrorShape = {
  code?: unknown;
  constraint?: unknown;
  message?: unknown;
};

let cleanupInFlight: Promise<void> | null = null;
let lastCleanupStartedAt = 0;

export class AuthEmailTakenError extends Error {
  constructor() {
    super("Аккаунт с таким email уже существует.");
    this.name = "AuthEmailTakenError";
  }
}

export class AuthUserIdTakenError extends Error {
  constructor() {
    super("Такой user-id уже занят.");
    this.name = "AuthUserIdTakenError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Неверный user-id или пароль.");
    this.name = "InvalidCredentialsError";
  }
}

export class EmailNotVerifiedError extends Error {
  constructor() {
    super("Подтверди email перед входом в аккаунт.");
    this.name = "EmailNotVerifiedError";
  }
}

export class EmailVerificationTokenInvalidError extends Error {
  constructor() {
    super("Ссылка подтверждения недействительна или устарела.");
    this.name = "EmailVerificationTokenInvalidError";
  }
}

export class PasswordResetTokenInvalidError extends Error {
  constructor() {
    super("Ссылка сброса пароля недействительна или устарела.");
    this.name = "PasswordResetTokenInvalidError";
  }
}

export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super("Текущий пароль введен неверно.");
    this.name = "InvalidCurrentPasswordError";
  }
}

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

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
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

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as PgErrorShape;
  return value.code === "23505";
}

function hasConstraint(error: unknown, fragment: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as PgErrorShape;
  if (typeof value.constraint === "string") {
    return value.constraint.toLowerCase().includes(fragment.toLowerCase());
  }

  if (typeof value.message === "string") {
    return value.message.toLowerCase().includes(fragment.toLowerCase());
  }

  return false;
}

function buildOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashOpaqueToken(token: string): string {
  return createHash("sha256")
    .update(`${token}:${AUTH_TOKEN_PEPPER}`)
    .digest("hex");
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

async function getAppUserById(
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

async function getAuthUserByEmail(email: string): Promise<AuthUserRow | null> {
  const pool = getPostgresPool();
  const { rows } = await pool.query<AuthUserRow>(
    `
      select ${APP_USER_COLUMNS}, password_hash
      from public.app_users
      where email = $1::text
      limit 1
    `,
    [email]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    ...normalizeAppUser(row),
    password_hash: row.password_hash,
  };
}

async function getAuthUserByUserId(userId: string): Promise<AuthUserRow | null> {
  const pool = getPostgresPool();
  const { rows } = await pool.query<AuthUserRow>(
    `
      select ${APP_USER_COLUMNS}, password_hash
      from public.app_users
      where user_id = $1::text
      limit 1
    `,
    [userId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    ...normalizeAppUser(row),
    password_hash: row.password_hash,
  };
}

export function isEmailVerificationRequired(): boolean {
  return AUTH_REQUIRE_EMAIL_VERIFICATION;
}

export function assertValidEmailCandidate(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Email должен быть строкой.");
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Email обязателен.");
  }

  if (normalized.length > 320) {
    throw new Error("Email слишком длинный.");
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalized)) {
    throw new Error("Укажи корректный email.");
  }

  return normalized;
}

export async function registerWithEmailPassword(input: {
  email: unknown;
  password: unknown;
  userId: string;
}): Promise<AppUserRow> {
  const email = assertValidEmailCandidate(input.email);
  const password = assertValidPasswordCandidate(input.password);
  const passwordHash = await hashPassword(password);
  const emailVerifiedAt = AUTH_REQUIRE_EMAIL_VERIFICATION
    ? null
    : new Date().toISOString();

  const pool = getPostgresPool();

  try {
    const { rows } = await pool.query<AppUserRow>(
      `
        insert into public.app_users (
          email,
          email_verified_at,
          password_hash,
          user_id,
          user_id_changed_at,
          nickname,
          profile_description,
          avatar_url
        )
        values (
          $1::text,
          $2::timestamptz,
          $3::text,
          $4::text,
          now(),
          '',
          '',
          null
        )
        returning ${APP_USER_COLUMNS}
      `,
      [email, emailVerifiedAt, passwordHash, input.userId]
    );

    const created = rows[0];
    if (!created) {
      throw new Error("Не удалось создать аккаунт.");
    }

    return normalizeAppUser(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (hasConstraint(error, "email")) {
        throw new AuthEmailTakenError();
      }

      if (hasConstraint(error, "user_id")) {
        throw new AuthUserIdTakenError();
      }
    }

    throw error;
  }
}

export async function loginWithUserIdPassword(input: {
  userId: unknown;
  password: unknown;
}): Promise<AppUserRow> {
  const userId = assertValidUserId(input.userId);
  const password = assertValidPasswordCandidate(input.password);

  const authUser = await getAuthUserByUserId(userId);
  if (!authUser) {
    throw new InvalidCredentialsError();
  }

  const valid = await verifyPassword(password, authUser.password_hash);
  if (!valid) {
    throw new InvalidCredentialsError();
  }

  if (AUTH_REQUIRE_EMAIL_VERIFICATION && !authUser.email_verified_at) {
    throw new EmailNotVerifiedError();
  }

  return normalizeAppUser(authUser);
}

export async function createSessionForUser(appUserId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = buildSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = buildSessionExpiryDate();

  const pool = getPostgresPool();

  await withPostgresTransaction(pool, async (client) => {
    await client.query(
      `
        insert into public.app_sessions (
          app_user_id,
          token_hash,
          expires_at
        )
        values (
          $1::uuid,
          $2::text,
          $3::timestamptz
        )
      `,
      [appUserId, tokenHash, expiresAt.toISOString()]
    );

    await client.query(
      `
        delete from public.app_sessions
        where app_user_id = $1::uuid
          and id in (
            select id
            from public.app_sessions
            where app_user_id = $1::uuid
            order by last_seen_at desc, created_at desc
            offset $2
          )
      `,
      [appUserId, AUTH_SESSION_MAX_PER_USER]
    );
  });

  return {
    token,
    expiresAt,
  };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  const normalized = token.trim();
  if (!normalized) {
    return;
  }

  const pool = getPostgresPool();
  await pool.query(
    `
      delete from public.app_sessions
      where token_hash = $1::text
    `,
    [hashSessionToken(normalized)]
  );
}

export async function deleteSessionsForUser(appUserId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `
      delete from public.app_sessions
      where app_user_id = $1::uuid
    `,
    [appUserId]
  );
}

async function touchSession(sessionId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `
      update public.app_sessions
      set last_seen_at = now()
      where id = $1::uuid
    `,
    [sessionId]
  );
}

async function deleteSessionById(sessionId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `
      delete from public.app_sessions
      where id = $1::uuid
    `,
    [sessionId]
  );
}

export async function getUserBySessionToken(token: string): Promise<AppUserRow | null> {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }

  const tokenHash = hashSessionToken(normalized);
  const pool = getPostgresPool();

  const { rows } = await pool.query<SessionJoinRow>(
    `
      select
        sessions.id as session_id,
        sessions.expires_at,
        ${APP_USER_COLUMNS_FROM_USERS}
      from public.app_sessions as sessions
      join public.app_users as users
        on users.id = sessions.app_user_id
      where sessions.token_hash = $1::text
      limit 1
    `,
    [tokenHash]
  );

  const session = rows[0];
  if (!session) {
    return null;
  }

  const expiresAt = new Date(session.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await deleteSessionById(session.session_id);
    return null;
  }

  await touchSession(session.session_id);
  maybeRunAuthCleanup();
  return normalizeAppUser(session);
}

export async function clearExpiredSessions(): Promise<QueryResult> {
  const pool = getPostgresPool();
  return pool.query(
    `
      delete from public.app_sessions
      where expires_at <= now()
    `
  );
}

export async function issueEmailVerificationToken(appUserId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = buildOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MINUTES * 60000);
  const pool = getPostgresPool();

  await withPostgresTransaction(pool, async (client) => {
    await client.query(
      `
        update public.email_verification_tokens
        set consumed_at = now()
        where app_user_id = $1::uuid
          and consumed_at is null
      `,
      [appUserId]
    );

    await client.query(
      `
        insert into public.email_verification_tokens (
          app_user_id,
          token_hash,
          expires_at
        )
        values ($1::uuid, $2::text, $3::timestamptz)
      `,
      [appUserId, tokenHash, expiresAt.toISOString()]
    );
  });

  return {
    token,
    expiresAt,
  };
}

export async function verifyEmailByToken(token: string): Promise<AppUserRow> {
  const normalized = token.trim();
  if (!normalized) {
    throw new EmailVerificationTokenInvalidError();
  }

  const tokenHash = hashOpaqueToken(normalized);
  const pool = getPostgresPool();

  return withPostgresTransaction(pool, async (client) => {
    const { rows } = await client.query<VerificationTokenRow>(
      `
        select id, app_user_id, expires_at, consumed_at
        from public.email_verification_tokens
        where token_hash = $1::text
        limit 1
        for update
      `,
      [tokenHash]
    );

    const tokenRow = rows[0];
    if (!tokenRow) {
      throw new EmailVerificationTokenInvalidError();
    }

    const expiresAt = new Date(tokenRow.expires_at);
    const isExpired =
      !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now();

    if (tokenRow.consumed_at || isExpired) {
      throw new EmailVerificationTokenInvalidError();
    }

    await client.query(
      `
        update public.email_verification_tokens
        set consumed_at = now()
        where app_user_id = $1::uuid
          and consumed_at is null
      `,
      [tokenRow.app_user_id]
    );

    const { rows: userRows } = await client.query<AppUserRow>(
      `
        update public.app_users
        set email_verified_at = coalesce(email_verified_at, now())
        where id = $1::uuid
        returning ${APP_USER_COLUMNS}
      `,
      [tokenRow.app_user_id]
    );

    const updated = userRows[0];
    if (!updated) {
      throw new EmailVerificationTokenInvalidError();
    }

    return normalizeAppUser(updated);
  });
}

async function issuePasswordResetToken(appUserId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = buildOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60000);
  const pool = getPostgresPool();

  await withPostgresTransaction(pool, async (client) => {
    await client.query(
      `
        update public.password_reset_tokens
        set consumed_at = now()
        where app_user_id = $1::uuid
          and consumed_at is null
      `,
      [appUserId]
    );

    await client.query(
      `
        insert into public.password_reset_tokens (
          app_user_id,
          token_hash,
          expires_at
        )
        values ($1::uuid, $2::text, $3::timestamptz)
      `,
      [appUserId, tokenHash, expiresAt.toISOString()]
    );
  });

  return {
    token,
    expiresAt,
  };
}

export async function issuePasswordResetTokenForEmail(email: unknown): Promise<{
  appUserId: string;
  email: string;
  token: string;
  expiresAt: Date;
} | null> {
  const normalizedEmail = assertValidEmailCandidate(email);
  const authUser = await getAuthUserByEmail(normalizedEmail);
  if (!authUser) {
    return null;
  }

  if (AUTH_REQUIRE_EMAIL_VERIFICATION && !authUser.email_verified_at) {
    return null;
  }

  const issued = await issuePasswordResetToken(authUser.id);
  return {
    appUserId: authUser.id,
    email: authUser.email,
    token: issued.token,
    expiresAt: issued.expiresAt,
  };
}

export async function resetPasswordByToken(input: {
  token: unknown;
  newPassword: unknown;
}): Promise<AppUserRow> {
  if (typeof input.token !== "string") {
    throw new PasswordResetTokenInvalidError();
  }

  const normalizedToken = input.token.trim();
  if (!normalizedToken) {
    throw new PasswordResetTokenInvalidError();
  }

  const newPassword = assertValidPasswordCandidate(input.newPassword);
  const nextHash = await hashPassword(newPassword);
  const tokenHash = hashOpaqueToken(normalizedToken);
  const pool = getPostgresPool();

  return withPostgresTransaction(pool, async (client) => {
    const { rows } = await client.query<PasswordResetTokenRow>(
      `
        select id, app_user_id, expires_at, consumed_at
        from public.password_reset_tokens
        where token_hash = $1::text
        limit 1
        for update
      `,
      [tokenHash]
    );

    const tokenRow = rows[0];
    if (!tokenRow) {
      throw new PasswordResetTokenInvalidError();
    }

    const expiresAt = new Date(tokenRow.expires_at);
    const isExpired =
      !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now();

    if (tokenRow.consumed_at || isExpired) {
      throw new PasswordResetTokenInvalidError();
    }

    const { rows: updatedRows } = await client.query<AppUserRow>(
      `
        update public.app_users
        set password_hash = $2::text
        where id = $1::uuid
        returning ${APP_USER_COLUMNS}
      `,
      [tokenRow.app_user_id, nextHash]
    );

    const updated = updatedRows[0];
    if (!updated) {
      throw new PasswordResetTokenInvalidError();
    }

    await client.query(
      `
        update public.password_reset_tokens
        set consumed_at = now()
        where app_user_id = $1::uuid
          and consumed_at is null
      `,
      [tokenRow.app_user_id]
    );

    await client.query(
      `
        delete from public.app_sessions
        where app_user_id = $1::uuid
      `,
      [tokenRow.app_user_id]
    );

    return normalizeAppUser(updated);
  });
}

export async function changePasswordForUser(input: {
  appUserId: string;
  currentPassword: unknown;
  nextPassword: unknown;
}): Promise<AppUserRow> {
  const currentPassword = assertValidPasswordCandidate(input.currentPassword);
  const nextPassword = assertValidPasswordCandidate(input.nextPassword);

  if (currentPassword === nextPassword) {
    throw new Error("Новый пароль должен отличаться от текущего.");
  }

  const nextHash = await hashPassword(nextPassword);
  const pool = getPostgresPool();

  return withPostgresTransaction(pool, async (client) => {
    const { rows } = await client.query<AuthUserRow>(
      `
        select ${APP_USER_COLUMNS}, password_hash
        from public.app_users
        where id = $1::uuid
        limit 1
        for update
      `,
      [input.appUserId]
    );

    const authUser = rows[0];
    if (!authUser) {
      throw new Error("Аккаунт не найден.");
    }

    const isCurrentPasswordValid = await verifyPassword(
      currentPassword,
      authUser.password_hash
    );
    if (!isCurrentPasswordValid) {
      throw new InvalidCurrentPasswordError();
    }

    const { rows: updatedRows } = await client.query<AppUserRow>(
      `
        update public.app_users
        set password_hash = $2::text
        where id = $1::uuid
        returning ${APP_USER_COLUMNS}
      `,
      [input.appUserId, nextHash]
    );

    const updated = updatedRows[0];
    if (!updated) {
      throw new Error("Не удалось обновить пароль.");
    }

    await client.query(
      `
        delete from public.app_sessions
        where app_user_id = $1::uuid
      `,
      [input.appUserId]
    );

    return normalizeAppUser(updated);
  });
}

export async function getUserByEmail(email: unknown): Promise<AppUserRow | null> {
  const normalizedEmail = assertValidEmailCandidate(email);
  const authUser = await getAuthUserByEmail(normalizedEmail);
  if (!authUser) {
    return null;
  }

  return normalizeAppUser(authUser);
}

export async function issueEmailVerificationTokenByEmail(email: unknown): Promise<{
  appUserId: string;
  email: string;
  token: string;
  expiresAt: Date;
} | null> {
  const normalizedEmail = assertValidEmailCandidate(email);
  const authUser = await getAuthUserByEmail(normalizedEmail);
  if (!authUser) {
    return null;
  }

  if (authUser.email_verified_at) {
    return null;
  }

  const issued = await issueEmailVerificationToken(authUser.id);
  return {
    appUserId: authUser.id,
    email: authUser.email,
    token: issued.token,
    expiresAt: issued.expiresAt,
  };
}

export async function clearExpiredAuthArtifacts(): Promise<void> {
  const pool = getPostgresPool();

  await pool.query(
    `
      delete from public.app_sessions
      where expires_at <= now()
    `
  );

  await pool.query(
    `
      delete from public.email_verification_tokens
      where expires_at <= now() - interval '7 days'
         or (
           consumed_at is not null
           and consumed_at <= now() - interval '7 days'
         )
    `
  );

  await pool.query(
    `
      delete from public.password_reset_tokens
      where expires_at <= now() - interval '7 days'
         or (
           consumed_at is not null
           and consumed_at <= now() - interval '7 days'
         )
    `
  );

  await pool.query(
    `
      delete from public.auth_rate_events
      where created_at <= now() - interval '30 days'
    `
  );
}

export function maybeRunAuthCleanup(): void {
  const now = Date.now();
  if (cleanupInFlight) {
    return;
  }

  if (now - lastCleanupStartedAt < AUTH_CLEANUP_INTERVAL_MS) {
    return;
  }

  lastCleanupStartedAt = now;
  cleanupInFlight = clearExpiredAuthArtifacts()
    .catch(() => {
      return;
    })
    .finally(() => {
      cleanupInFlight = null;
    });
}

export async function getUserById(appUserId: string): Promise<AppUserRow | null> {
  const normalized = appUserId.trim();
  if (!normalized) {
    return null;
  }

  const pool = getPostgresPool();
  return getAppUserById(pool, normalized);
}
