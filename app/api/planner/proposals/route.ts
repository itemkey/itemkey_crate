import { NextRequest } from "next/server";

import { assertPlannerCsrf, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import type { PlannerDraft, PlannerProfile, PlannerProposal, PlannerSleepEvent } from "@/lib/planner/types";
import { getRequestUser } from "@/lib/request-user";

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const body = (await request.json()) as {
      command?: unknown;
      draft?: PlannerDraft;
      drafts?: PlannerDraft[];
      profilePatch?: Partial<PlannerProfile>;
      sleepEvent?: PlannerSleepEvent;
      trigger?: PlannerProposal["trigger"];
      rebuildFuture?: unknown;
    };
    const command = typeof body.command === "string" ? body.command.slice(0, 12_000) : undefined;
    const drafts = Array.isArray(body.drafts) ? body.drafts.slice(0, 100) : undefined;
    if (!command && !body.draft && !drafts?.length && !body.profilePatch && !body.sleepEvent
      && body.trigger !== "autoplan" && body.trigger !== "day_refresh" && body.trigger !== "assistant_update") {
      throw new Error("Опишите новое дело или запустите автоплан.");
    }
    const data = await (await getPlannerStore()).createProposal(user.id, {
      command,
      draft: body.draft,
      drafts,
      profilePatch: body.profilePatch,
      sleepEvent: body.sleepEvent,
      trigger: body.trigger,
      rebuildFuture: Boolean(body.rebuildFuture),
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось подготовить новый план.");
  }
}
