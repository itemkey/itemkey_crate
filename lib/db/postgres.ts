import "server-only";

import { Pool } from "pg";

import { getDatabaseUrl } from "@/lib/db/provider";

let cachedPool: Pool | null = null;

export function getPostgresPool(): Pool {
  if (cachedPool) {
    return cachedPool;
  }

  cachedPool = new Pool({
    connectionString: getDatabaseUrl(),
    max: 20,
  });

  return cachedPool;
}
