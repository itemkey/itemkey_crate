import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { normalizePlannerItem } from "@/lib/planner/engine";
import { getPlannerStore } from "@/lib/planner/store";
import type { PlannerItem } from "@/lib/planner/types";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    const data = (await (await getPlannerStore()).getBootstrap(user.id)).items;
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось загрузить дела.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    const body = (await request.json()) as { expectedRevision?: unknown; item?: Partial<PlannerItem> };
    if (!body.item || typeof body.item.title !== "string") {
      throw new Error("Укажите название дела.");
    }
    const item = normalizePlannerItem({
      ...body.item,
      id: typeof body.item.id === "string" && body.item.id ? body.item.id : randomUUID(),
      title: body.item.title,
    });
    const data = await (await getPlannerStore()).saveItem(
      user.id,
      item,
      assertPlannerRevision(body.expectedRevision)
    );
    await publishRealtimeEvent({
      kind: "planner", action: "item_create", userIds: [user.id],
      originClientId: getOriginClientId(request),
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось сохранить дело.");
  }
}
