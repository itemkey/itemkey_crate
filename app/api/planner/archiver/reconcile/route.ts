import { NextRequest } from "next/server";

import { assertPlannerCsrf, assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const body = (await request.json()) as { expectedRevision?: unknown };
    const data = await (await getPlannerStore()).reconcileArchiver(
      user.id,
      assertPlannerRevision(body.expectedRevision)
    );
    if (data.created > 0) {
      await publishRealtimeEvent({
        kind: "planner", action: "archiver_reconcile", userIds: [user.id], originClientId: getOriginClientId(request),
      });
    }
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось сверить Архиватор дел.");
  }
}
