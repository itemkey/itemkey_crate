import { NextRequest } from "next/server";

import { assertPlannerCsrf, plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import type { PlannerConstructorOperation, PlannerDecisionSelection, PlannerDraft, PlannerPlanningFocus, PlannerProfile, PlannerProposal, PlannerProposalInput, PlannerSleepEvent } from "@/lib/planner/types";
import { getRequestUser } from "@/lib/request-user";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function draft(value: unknown): value is PlannerDraft {
  return record(value) && text(value.title)
    && (value.kind === undefined || value.kind === "fixed_event" || value.kind === "flexible_task" || value.kind === "routine");
}

function scope(value: unknown): value is "occurrence" | "future" | "item" {
  return value === "occurrence" || value === "future" || value === "item";
}

function placement(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.mode === "date") return typeof value.date === "string" && DATE.test(value.date);
  if (value.mode === "exact") return typeof value.date === "string" && DATE.test(value.date) && typeof value.start === "string" && TIME.test(value.start);
  if (value.mode === "before" || value.mode === "after") return text(value.anchorBlockId);
  return value.mode === "first_free" && (value.date === undefined || typeof value.date === "string" && DATE.test(value.date));
}

function constructorOperation(value: unknown): PlannerConstructorOperation | undefined {
  if (!record(value) || typeof value.kind !== "string") return undefined;
  if ((value.kind === "add_item" || value.kind === "occupy_interval") && draft(value.draft)) return value as PlannerConstructorOperation;
  if (value.kind === "edit_item" && draft(value.draft) && text(value.draft.id)) return value as PlannerConstructorOperation;
  if (value.kind === "bulk_update_items" && Array.isArray(value.drafts) && value.drafts.length <= 100 && value.drafts.every(draft)) return value as PlannerConstructorOperation;
  if (value.kind === "move_item" && text(value.blockId) && scope(value.scope) && placement(value.placement)) return value as PlannerConstructorOperation;
  if (value.kind === "cancel_item" && scope(value.scope) && (text(value.blockId) || text(value.itemId))) return value as PlannerConstructorOperation;
  if (value.kind === "replace_item" && text(value.blockId) && scope(value.scope) && draft(value.replacement) && record(value.duration)
    && (value.duration.mode === "same" || value.duration.mode === "until_next"
      || value.duration.mode === "minutes" && Number.isFinite(Number(value.duration.minutes)) && Number(value.duration.minutes) >= 5
      || value.duration.mode === "until" && typeof value.duration.date === "string" && DATE.test(value.duration.date) && typeof value.duration.time === "string" && TIME.test(value.duration.time))) return value as PlannerConstructorOperation;
  if (value.kind === "change_block_time" && text(value.blockId) && text(value.startAt, 80) && text(value.endAt, 80)
    && Number.isFinite(new Date(value.startAt).getTime()) && Number.isFinite(new Date(value.endAt).getTime())) return value as PlannerConstructorOperation;
  if (value.kind === "change_item_duration" && text(value.itemId) && record(value.duration)
    && ["exact", "approximate", "range", "unknown"].includes(String(value.duration.mode))
    && Number.isFinite(Number(value.duration.likelyMinutes)) && Number(value.duration.likelyMinutes) >= 5) return value as PlannerConstructorOperation;
  if ((value.kind === "protect_interval" || value.kind === "set_day_bounds")
    && typeof value.date === "string" && DATE.test(value.date) && typeof value.start === "string" && TIME.test(value.start) && typeof value.end === "string" && TIME.test(value.end)) return value as PlannerConstructorOperation;
  if (value.kind === "set_sleep_boundary" && (value.boundary === "bedtime" || value.boundary === "wake")
    && typeof value.date === "string" && DATE.test(value.date) && typeof value.time === "string" && TIME.test(value.time)) return value as PlannerConstructorOperation;
  if (value.kind === "rebuild_remaining" && text(value.fromAt, 80) && Number.isFinite(new Date(value.fromAt).getTime())
    && Array.isArray(value.decisions) && value.decisions.length <= 100 && value.decisions.every((entry) => record(entry) && text(entry.itemId)
      && ["required", "desired", "if_time", "cancel"].includes(String(entry.disposition)))) return value as PlannerConstructorOperation;
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    assertPlannerCsrf(request);
    const body = (await request.json()) as {
      operation?: unknown;
      decisions?: unknown;
      draft?: PlannerDraft;
      drafts?: PlannerDraft[];
      removedItemIds?: unknown;
      profilePatch?: Partial<PlannerProfile>;
      sleepEvent?: PlannerSleepEvent;
      trigger?: PlannerProposal["trigger"];
      rebuildFuture?: unknown;
      rebuildFromAt?: unknown;
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
    const operation = constructorOperation(body.operation);
    if (body.operation !== undefined && !operation) throw new Error("Операция конструктора содержит недопустимые или неполные поля.");
    const decisions = Array.isArray(body.decisions)
      ? body.decisions.flatMap((entry): PlannerDecisionSelection[] => record(entry) && text(entry.groupId) && text(entry.optionId)
        ? [{ groupId: entry.groupId.slice(0, 160), optionId: entry.optionId.slice(0, 160) }]
        : []).slice(0, 100)
      : undefined;
    const rebuildFromAt = typeof body.rebuildFromAt === "string" && Number.isFinite(new Date(body.rebuildFromAt).getTime())
      ? new Date(body.rebuildFromAt).toISOString()
      : undefined;
    const drafts = Array.isArray(body.drafts) ? body.drafts.slice(0, 100) : undefined;
    const removedItemIds = Array.isArray(body.removedItemIds)
      ? [...new Set(body.removedItemIds.flatMap((id) => typeof id === "string" && id.trim()
        ? [id.slice(0, 160)]
        : []))].slice(0, 100)
      : undefined;
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
    if (!operation && !body.draft && !drafts?.length && !body.profilePatch && !body.sleepEvent && !blockExtension
      && !missedOccurrence && !remainderTransfer && body.trigger !== "autoplan" && body.trigger !== "plans_changed"
      && body.trigger !== "day_refresh" && body.trigger !== "assistant_update") {
      throw new Error("Запрос не содержит данных для изменения плана.");
    }
    const data = await (await getPlannerStore()).createProposal(user.id, {
      operation,
      decisions,
      draft: body.draft,
      drafts,
      removedItemIds,
      profilePatch: body.profilePatch,
      sleepEvent: body.sleepEvent,
      trigger: body.trigger,
      rebuildFuture: Boolean(body.rebuildFuture),
      rebuildFromAt,
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
