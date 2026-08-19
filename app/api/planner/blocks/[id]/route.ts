import { NextRequest } from "next/server";

import { assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    const { id } = await context.params;
    const body = (await request.json()) as {
      startAt?: unknown; endAt?: unknown; expectedRevision?: unknown;
    };
    if (typeof body.startAt !== "string" || typeof body.endAt !== "string") {
      throw new Error("Укажите начало и окончание блока.");
    }
    const data = await (await getPlannerStore()).moveBlock(
      user.id, id, body.startAt, body.endAt, assertPlannerRevision(body.expectedRevision)
    );
    await publishRealtimeEvent({ kind: "planner", action: "block_move", userIds: [user.id], originClientId: getOriginClientId(request) });
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось переместить блок.");
  }
}
