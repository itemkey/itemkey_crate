import "server-only";

export type DbProvider = "postgres";

const rawProvider = process.env.DB_PROVIDER?.trim().toLowerCase();
const DATABASE_URL = process.env.DATABASE_URL;

export function resolveDbProvider(): DbProvider {
  if (rawProvider && rawProvider !== "postgres") {
    throw new Error("Unsupported DB_PROVIDER. Use postgres.");
  }

  return "postgres";
}

export function getDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is missing.");
  }

  return DATABASE_URL;
}
