import { NextRequest } from "next/server";

import { plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    const { id } = await context.params;
    const data = await (await getPlannerStore()).applyProposal(user.id, id);
    await publishRealtimeEvent({ kind: "planner", action: "proposal_apply", userIds: [user.id], originClientId: getOriginClientId(request) });
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось применить предложение.");
  }
}
