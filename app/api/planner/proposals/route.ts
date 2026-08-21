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
      remainderTransfer?: {
        blockId?: unknown;
        deferredRemainderId?: unknown;
        amount?: { mode?: unknown; percent?: unknown; minutes?: unknown };
        distribution?: { mode?: unknown; date?: unknown };
      };
    };
    const command = typeof body.command === "string" ? body.command.slice(0, 12_000) : undefined;
    const drafts = Array.isArray(body.drafts) ? body.drafts.slice(0, 100) : undefined;
    const extensionMinutes = Math.round(Number(body.blockExtension?.minutes));
    const blockExtension = typeof body.blockExtension?.blockId === "string"
      && Number.isFinite(extensionMinutes)
      && extensionMinutes >= 5
      && extensionMinutes <= 1440
      ? { blockId: body.blockExtension.blockId.slice(0, 160), minutes: extensionMinutes }
      : undefined;
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
    const transferAmount = body.remainderTransfer?.amount?.mode === "percent"
      && [25, 50, 75, 100].includes(Number(body.remainderTransfer.amount.percent))
      ? { mode: "percent" as const, percent: Number(body.remainderTransfer.amount.percent) as 25 | 50 | 75 | 100 }
      : body.remainderTransfer?.amount?.mode === "minutes"
        && Number.isFinite(Number(body.remainderTransfer.amount.minutes))
        ? { mode: "minutes" as const, minutes: Math.max(5, Math.min(600_000, Math.round(Number(body.remainderTransfer.amount.minutes)))) }
        : undefined;
    const transferDistribution = body.remainderTransfer?.distribution?.mode === "asap"
      ? { mode: "asap" as const }
      : body.remainderTransfer?.distribution?.mode === "spread_week"
        ? { mode: "spread_week" as const }
        : body.remainderTransfer?.distribution?.mode === "date"
          && typeof body.remainderTransfer.distribution.date === "string"
          && /^\d{4}-\d{2}-\d{2}$/.test(body.remainderTransfer.distribution.date)
          ? { mode: "date" as const, date: body.remainderTransfer.distribution.date }
          : undefined;
    const remainderTransfer = body.remainderTransfer
      && typeof body.remainderTransfer.blockId === "string"
      && transferAmount
      && transferDistribution
      ? {
          blockId: body.remainderTransfer.blockId.slice(0, 160),
          deferredRemainderId: typeof body.remainderTransfer.deferredRemainderId === "string"
            ? body.remainderTransfer.deferredRemainderId.slice(0, 160)
            : undefined,
          amount: transferAmount,
          distribution: transferDistribution,
        } satisfies NonNullable<PlannerProposalInput["remainderTransfer"]>
      : undefined;
    if (!command && !body.draft && !drafts?.length && !body.profilePatch && !body.sleepEvent && !blockExtension
      && !missedOccurrence && !remainderTransfer && body.trigger !== "autoplan" && body.trigger !== "plans_changed"
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
      blockExtension,
      missedOccurrence,
      remainderTransfer,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось подготовить новый план.");
  }
}
