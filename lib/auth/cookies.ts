import "server-only";

export function shouldUseSecureCookies(): boolean {
  const rawValue = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();

  if (rawValue === "true" || rawValue === "1" || rawValue === "yes") {
    return true;
  }

  if (rawValue === "false" || rawValue === "0" || rawValue === "no") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}
