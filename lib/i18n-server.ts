import "server-only";

import { cookies } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  type Locale,
  resolveLocalePreference,
} from "@/lib/i18n";

export async function getServerLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    return resolveLocalePreference({
      cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    });
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function getLocaleCookieOptions() {
  return {
    name: LOCALE_COOKIE_NAME,
    path: "/",
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    maxAge: 60 * 60 * 24 * 365,
  };
}
