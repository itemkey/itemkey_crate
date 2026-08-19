import { NextRequest } from "next/server";

import { assertPlannerCsrf, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
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
    const revision = await (await getPlannerStore()).undoChangeSet(user.id, id);
    await publishRealtimeEvent({ kind: "planner", action: "change_undo", userIds: [user.id], originClientId: getOriginClientId(request) });
    return Response.json({ data: { revision } });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось отменить изменение.");
  }
}
