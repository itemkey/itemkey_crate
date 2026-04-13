import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

export const CSRF_COOKIE_NAME = "item_key_csrf";

export function buildCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

export function getCsrfCookieBaseOptions(): {
  httpOnly: boolean;
  sameSite: "strict";
  secure: boolean;
  path: string;
} {
  return {
    httpOnly: false,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function isValidCsrfPair(cookieToken: string, headerToken: string): boolean {
  const left = Buffer.from(cookieToken);
  const right = Buffer.from(headerToken);

  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
