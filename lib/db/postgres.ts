import "server-only";

import { Pool } from "pg";

import { getDatabaseUrl } from "@/lib/db/provider";

let cachedPool: Pool | null = null;

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function getPostgresPool(): Pool {
  if (cachedPool) {
    return cachedPool;
  }

  cachedPool = new Pool({
    connectionString: getDatabaseUrl(),
    connectionTimeoutMillis: parsePositiveIntEnv(
      process.env.PG_CONNECTION_TIMEOUT_MS,
      5000
    ),
    max: 20,
  });

  return cachedPool;
}
