import { NextRequest } from "next/server";

import { assertPlannerCsrf, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import type { PlannerDraft, PlannerPlanningFocus, PlannerProfile, PlannerProposal, PlannerProposalInput, PlannerSleepEvent } from "@/lib/planner/types";
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
      planningFocusOverride?: unknown;
      blockExtension?: { blockId?: unknown; minutes?: unknown };
      missedOccurrence?: {
        blockId?: unknown;
        disposition?: unknown;
        rememberPolicy?: unknown;
        revisedRemainingMinutes?: unknown;
      };
    };
    const command = typeof body.command === "string" ? body.command.slice(0, 12_000) : undefined;
    const drafts = Array.isArray(body.drafts) ? body.drafts.slice(0, 100) : undefined;
    const missedOccurrence = body.missedOccurrence
      && typeof body.missedOccurrence.blockId === "string"
      && (body.missedOccurrence.disposition === "carry_remaining"
        || body.missedOccurrence.disposition === "cancel_occurrence"
        || body.missedOccurrence.disposition === "reestimate_total")
      ? {
          blockId: body.missedOccurrence.blockId.slice(0, 160),
          disposition: body.missedOccurrence.disposition,
          rememberPolicy: Boolean(body.missedOccurrence.rememberPolicy),
          revisedRemainingMinutes: body.missedOccurrence.disposition === "reestimate_total"
            ? Math.max(5, Math.min(600_000, Math.round(Number(body.missedOccurrence.revisedRemainingMinutes) || 0)))
            : undefined,
        } satisfies NonNullable<PlannerProposalInput["missedOccurrence"]>
      : undefined;
    if (!command && !body.draft && !drafts?.length && !body.profilePatch && !body.sleepEvent && !body.blockExtension
      && !missedOccurrence && body.trigger !== "autoplan" && body.trigger !== "plans_changed"
      && body.trigger !== "day_refresh" && body.trigger !== "assistant_update") {
      throw new Error("Запрос не содержит данных для изменения плана.");
    }
    const data = await (await getPlannerStore()).createProposal(user.id, {
      command,
      draft: body.draft,
      drafts,
      profilePatch: body.profilePatch,
      sleepEvent: body.sleepEvent,
      trigger: body.trigger,
      rebuildFuture: Boolean(body.rebuildFuture),
      planningFocusOverride: body.planningFocusOverride === "sleep" || body.planningFocusOverride === "work"
        ? body.planningFocusOverride as PlannerPlanningFocus
        : undefined,
      blockExtension: typeof body.blockExtension?.blockId === "string" && Number(body.blockExtension.minutes) === 15
        ? { blockId: body.blockExtension.blockId.slice(0, 160), minutes: 15 }
        : undefined,
      missedOccurrence,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось подготовить новый план.");
  }
}
