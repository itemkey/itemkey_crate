import { NextRequest } from "next/server";

import { assertPlannerCsrf, assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const { id } = await context.params;
    const body = (await request.json()) as { action?: unknown; minutes?: unknown; expectedRevision?: unknown };
    if (typeof body.action !== "string") throw new Error("Не указано действие.");
    const data = await (await getPlannerStore()).actOnBlock(user.id, id, body.action, assertPlannerRevision(body.expectedRevision), Number(body.minutes));
    await publishRealtimeEvent({ kind: "planner", action: `block_${body.action}`, userIds: [user.id], originClientId: getOriginClientId(request) });
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось обновить текущее дело.");
  }
}
