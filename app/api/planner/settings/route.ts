import { NextRequest } from "next/server";

import { assertPlannerCsrf, assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import type { PlannerProfile } from "@/lib/planner/types";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export async function PATCH(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const body = (await request.json()) as { expectedRevision?: unknown; patch?: Partial<PlannerProfile> };
    const data = await (await getPlannerStore()).updateSettings(
      user.id,
      body.patch ?? {},
      assertPlannerRevision(body.expectedRevision)
    );
    await publishRealtimeEvent({
      kind: "planner", action: "settings_update", userIds: [user.id],
      originClientId: getOriginClientId(request),
    });
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось сохранить настройки планировщика.");
  }
}
