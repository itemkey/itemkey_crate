import { NextRequest } from "next/server";

import { assertPlannerCsrf, assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { normalizePlannerItem } from "@/lib/planner/engine";
import { getPlannerStore } from "@/lib/planner/store";
import type { PlannerItem } from "@/lib/planner/types";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const { id } = await context.params;
    const body = (await request.json()) as { expectedRevision?: unknown; item?: Partial<PlannerItem> };
    if (!body.item || typeof body.item.title !== "string") throw new Error("Укажите название дела.");
    const data = await (await getPlannerStore()).saveItem(
      user.id,
      normalizePlannerItem({ ...body.item, id, title: body.item.title }),
      assertPlannerRevision(body.expectedRevision)
    );
    await publishRealtimeEvent({ kind: "planner", action: "item_update", userIds: [user.id], originClientId: getOriginClientId(request) });
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось обновить дело.");
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const { id } = await context.params;
    const revision = await (await getPlannerStore()).archiveItem(
      user.id,
      id,
      assertPlannerRevision(request.nextUrl.searchParams.get("revision"))
    );
    await publishRealtimeEvent({ kind: "planner", action: "item_archive", userIds: [user.id], originClientId: getOriginClientId(request) });
    return Response.json({ data: { revision } });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось убрать дело из планировщика.");
  }
}
