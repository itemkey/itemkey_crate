import { cookies } from "next/headers";

import CrateAuthScreen from "@/components/crate-auth-screen";
import PlannerWorkspace from "@/components/planner/planner-workspace";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getRequestUserBySessionToken } from "@/lib/request-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ import?: string | string[] }> }) {
  const cookieStore = await cookies();
  const query = await searchParams;
  const user = await getRequestUserBySessionToken(
    cookieStore.get(SESSION_COOKIE_NAME)?.value
  );

  if (!user) return <CrateAuthScreen />;

  return <PlannerWorkspace accountLocale={user.locale} initialLegacyImport={query.import === "1"} />;
}
