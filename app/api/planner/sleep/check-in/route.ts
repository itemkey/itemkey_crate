import { NextRequest } from "next/server";

import { assertPlannerCsrf, assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import type { PlannerSleepinessLevel, PlannerSleepRestedness } from "@/lib/planner/types";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const body = (await request.json()) as {
      wakeDate?: unknown;
      restedness?: unknown;
      sleepinessLevel?: unknown;
      feedbackText?: unknown;
      actualStartAt?: unknown;
      actualEndAt?: unknown;
      expectedRevision?: unknown;
    };
    const data = await (await getPlannerStore()).checkInSleep(user.id, {
      wakeDate: typeof body.wakeDate === "string" ? body.wakeDate : "",
      restedness: body.restedness as PlannerSleepRestedness,
      sleepinessLevel: Number(body.sleepinessLevel) as PlannerSleepinessLevel,
      feedbackText: typeof body.feedbackText === "string" ? body.feedbackText : undefined,
      actualStartAt: typeof body.actualStartAt === "string" ? body.actualStartAt : undefined,
      actualEndAt: typeof body.actualEndAt === "string" ? body.actualEndAt : undefined,
      expectedRevision: assertPlannerRevision(body.expectedRevision),
    });
    await publishRealtimeEvent({
      kind: "planner",
      action: "sleep_check_in",
      userIds: [user.id],
      originClientId: getOriginClientId(request),
    });
    return Response.json({ data });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось сохранить отметку сна.");
  }
}
