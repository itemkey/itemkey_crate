import "server-only";

import { createHash } from "node:crypto";

import { getPostgresPool } from "@/lib/db/postgres";

type AuthRateLimitRule = {
  windowSeconds: number;
  maxByIp: number;
  maxByEmail: number;
};

export type AuthRateLimitAction =
  | "login"
  | "register"
  | "forgot_password"
  | "reset_password"
  | "verify_email"
  | "resend_verification"
  | "change_password";

export type AuthRateLimitContext = {
  action: AuthRateLimitAction;
  ipHash: string;
  emailHash: string | null;
};

const AUTH_RATE_LIMIT_PEPPER = process.env.AUTH_RATE_LIMIT_PEPPER?.trim() ?? "";

const RULES: Record<AuthRateLimitAction, AuthRateLimitRule> = {
  login: {
    windowSeconds: 600,
    maxByIp: 20,
    maxByEmail: 8,
  },
  register: {
    windowSeconds: 3600,
    maxByIp: 12,
    maxByEmail: 4,
  },
  forgot_password: {
    windowSeconds: 1800,
    maxByIp: 20,
    maxByEmail: 4,
  },
  reset_password: {
    windowSeconds: 900,
    maxByIp: 20,
    maxByEmail: 6,
  },
  verify_email: {
    windowSeconds: 900,
    maxByIp: 30,
    maxByEmail: 12,
  },
  resend_verification: {
    windowSeconds: 1800,
    maxByIp: 20,
    maxByEmail: 4,
  },
  change_password: {
    windowSeconds: 900,
    maxByIp: 20,
    maxByEmail: 8,
  },
};

export class AuthRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Слишком много попыток. Попробуй позже.");
    this.name = "AuthRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as { code?: unknown };
  return value.code === "42P01";
}

function hashRateLimitValue(value: string): string {
  return createHash("sha256")
    .update(`${value}:${AUTH_RATE_LIMIT_PEPPER}`)
    .digest("hex");
}

function normalizeEmailForRateLimit(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized;
}

export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) {
    return cfIp;
  }

  return "unknown";
}

export function buildAuthRateLimitContext(input: {
  action: AuthRateLimitAction;
  request: Request;
  email?: string | null;
}): AuthRateLimitContext {
  const ip = extractClientIp(input.request);
  const normalizedEmail = normalizeEmailForRateLimit(input.email);

  return {
    action: input.action,
    ipHash: hashRateLimitValue(ip),
    emailHash: normalizedEmail ? hashRateLimitValue(normalizedEmail) : null,
  };
}

export async function assertAuthRateLimit(context: AuthRateLimitContext): Promise<void> {
  const rule = RULES[context.action];
  const pool = getPostgresPool();

  let ipRows: Array<{ count: string }>;
  try {
    const result = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from public.auth_rate_events
        where action = $1::text
          and ip_hash = $2::text
          and created_at > now() - ($3::int * interval '1 second')
      `,
      [context.action, context.ipHash, rule.windowSeconds]
    );
    ipRows = result.rows;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return;
    }
    throw error;
  }

  const ipCount = Number(ipRows[0]?.count ?? "0");
  if (ipCount >= rule.maxByIp) {
    throw new AuthRateLimitError(rule.windowSeconds);
  }

  if (!context.emailHash) {
    return;
  }

  const { rows: emailRows } = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from public.auth_rate_events
      where action = $1::text
        and email_hash = $2::text
        and created_at > now() - ($3::int * interval '1 second')
    `,
    [context.action, context.emailHash, rule.windowSeconds]
  );

  const emailCount = Number(emailRows[0]?.count ?? "0");
  if (emailCount >= rule.maxByEmail) {
    throw new AuthRateLimitError(rule.windowSeconds);
  }
}

export async function recordAuthRateEvent(
  context: AuthRateLimitContext,
  wasSuccess: boolean
): Promise<void> {
  const pool = getPostgresPool();

  try {
    await pool.query(
      `
        insert into public.auth_rate_events (
          action,
          ip_hash,
          email_hash,
          was_success
        )
        values (
          $1::text,
          $2::text,
          $3::text,
          $4::boolean
        )
      `,
      [context.action, context.ipHash, context.emailHash, wasSuccess]
    );
  } catch (error) {
    if (isMissingRelationError(error)) {
      return;
    }

    throw error;
  }
}
