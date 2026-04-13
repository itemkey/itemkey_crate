import { NextResponse, type NextRequest } from "next/server";

import { CSRF_COOKIE_NAME, isValidCsrfPair } from "@/lib/auth/csrf";

const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/csrf",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
]);

const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none", ""]);

function isMutatingMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

export function proxy(request: NextRequest) {
  if (!isMutatingMethod(request.method)) {
    return NextResponse.next();
  }

  if (CSRF_EXEMPT_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? "";
  if (!ALLOWED_FETCH_SITES.has(fetchSite)) {
    return Response.json({ error: "Forbidden request origin." }, { status: 403 });
  }

  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value?.trim() ?? "";
  const headerToken = request.headers.get("x-csrf-token")?.trim() ?? "";

  if (!cookieToken || !headerToken || !isValidCsrfPair(cookieToken, headerToken)) {
    return Response.json({ error: "Invalid CSRF token." }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
