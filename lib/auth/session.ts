import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "item_key_session";

const SESSION_HASH_PEPPER = process.env.SESSION_HASH_PEPPER?.trim() ?? "";
const SESSION_TTL_DAYS = parseBoundedIntEnv(process.env.SESSION_TTL_DAYS, 30, 1, 365);

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

export function buildSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256")
    .update(`${token}:${SESSION_HASH_PEPPER}`)
    .digest("hex");
}

export function buildSessionExpiryDate(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
}

export function getSessionCookieBaseOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function parseSessionTokenFromCookieHeader(
  cookieHeader: string | null
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [nameRaw, ...valueParts] = pair.split("=");
    const name = nameRaw?.trim();
    if (name !== SESSION_COOKIE_NAME) {
      continue;
    }

    const value = valueParts.join("=").trim();
    if (!value) {
      return null;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function getSessionTokenFromRequest(request: Request): string | null {
  return parseSessionTokenFromCookieHeader(request.headers.get("cookie"));
}
