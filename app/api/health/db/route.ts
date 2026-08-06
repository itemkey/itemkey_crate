import { getPostgresPool } from "@/lib/db/postgres";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export async function GET() {
  try {
    const pool = getPostgresPool();
    await pool.query("select 1");
    return Response.json(
      { status: "ok" },
      { status: 200, headers: PRIVATE_NO_STORE_HEADERS }
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
