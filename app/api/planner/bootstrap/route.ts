import { NextRequest } from "next/server";

import { plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    const data = await (await getPlannerStore()).getBootstrap(
      user.id,
      request.nextUrl.searchParams.get("from") ?? undefined,
      request.nextUrl.searchParams.get("to") ?? undefined
    );
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось загрузить планировщик.");
  }
}
