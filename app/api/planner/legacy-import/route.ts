import { NextRequest } from "next/server";

import { assertPlannerCsrf, assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerLegacyImportData, listPlannerLegacySources } from "@/lib/planner/legacy";
import { getPlannerStore } from "@/lib/planner/store";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    return Response.json({ data: await listPlannerLegacySources(user.id) });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось найти старые расписания.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const body = (await request.json()) as { sourceKeys?: unknown; expectedRevision?: unknown };
    if (!Array.isArray(body.sourceKeys) || !body.sourceKeys.every((key) => typeof key === "string")) {
      throw new Error("Выберите расписания для импорта.");
    }
    const store = await getPlannerStore();
    const profile = (await store.getBootstrap(user.id)).profile;
    const sources = await getPlannerLegacyImportData(user.id, body.sourceKeys, profile);
    const data = await store.importLegacy(user.id, sources, assertPlannerRevision(body.expectedRevision));
    await publishRealtimeEvent({ kind: "planner", action: "legacy_import", userIds: [user.id], originClientId: getOriginClientId(request) });
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось импортировать старые расписания.");
  }
}
