import { NextRequest } from "next/server";

import {
  assertAuthRateLimit,
  AuthRateLimitError,
  buildAuthRateLimitContext,
  recordAuthRateEvent,
} from "@/lib/auth/rate-limit";
import { assertPlannerRevision, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore, PlannerInvalidPasswordError } from "@/lib/planner/store";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return plannerUnauthorizedResponse();
  const context = buildAuthRateLimitContext({ action: "planner_reset", request, email: user.email });
  try {
    await assertAuthRateLimit(context);
    const body = (await request.json()) as { password?: unknown; expectedRevision?: unknown };
    const revision = await (await getPlannerStore()).resetPlanner(
      user.id,
      body.password,
      assertPlannerRevision(body.expectedRevision)
    );
    await recordAuthRateEvent(context, true);
    await publishRealtimeEvent({
      kind: "planner", action: "planner_reset", userIds: [user.id], originClientId: getOriginClientId(request),
    });
    return Response.json({ data: { revision } });
  } catch (error) {
    await recordAuthRateEvent(context, false);
    if (error instanceof AuthRateLimitError) {
      return Response.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    if (error instanceof PlannerInvalidPasswordError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return plannerErrorResponse(error, "Не удалось обнулить планировщик.");
  }
}
