import { createHash } from "node:crypto";

import { normalizeScheduleBlocks, normalizeSchedulePayload, type SchedulePayload } from "../schedules.ts";
import { addIsoMinutes, addPlannerDays, plannerTimeToMinutes, zonedPlannerDateTimeToUtc } from "./time.ts";
import { normalizePlannerItem } from "./engine.ts";
import type { PlannerBlock, PlannerItem, PlannerProfile } from "./types.ts";

export type LegacySchedulePayloadSource = {
  sourceKey: string;
  title: string;
  payload: SchedulePayload;
};

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

export function parseLegacyContinuousSchedules(content: string): Array<{ id: string; title: string; payload: SchedulePayload }> {
  try {
    const parsed = JSON.parse(content) as { kind?: unknown; schedules?: unknown };
    if (parsed.kind !== "itemkey-continuous-v1") return [];
    return normalizeScheduleBlocks(parsed.schedules).map((schedule) => ({
      id: schedule.id,
      title: schedule.title,
      payload: normalizeSchedulePayload(schedule),
    }));
  } catch {
    return [];
  }
}

export function convertLegacyScheduleSource(
  source: LegacySchedulePayloadSource,
  profile: PlannerProfile
): { sourceKey: string; title: string; items: PlannerItem[]; blocks: PlannerBlock[] } {
  const prefix = `legacy-${shortHash(source.sourceKey)}`;
  const itemIds = new Map<string, string>();
  const items: PlannerItem[] = [];
  const addItem = (
    legacyId: string,
    value: Omit<PlannerItem, "id" | "uncertaintyPolicy" | "commitmentLevel" | "planningRank">
  ) => {
    const existing = itemIds.get(legacyId);
    if (existing) return existing;
    const id = `${prefix}-${shortHash(legacyId)}`;
    itemIds.set(legacyId, id);
    items.push(normalizePlannerItem({ id, ...value }));
    return id;
  };
  for (const task of source.payload.taskBase ?? []) {
    addItem(task.id, {
      kind: task.type === "fixed" ? "fixed_event" : task.type === "habit" ? "routine" : "flexible_task",
      title: task.title,
      notes: task.details || task.description,
      area: task.category,
      priority: task.priority === "medium" ? "normal" : task.priority ?? "normal",
      energy: "normal",
      estimateMinutes: task.durationMinutes ?? task.goalMinutes ?? 60,
      deadlineType: "none",
      targetFinishMode: "auto",
      estimateConfidence: "normal",
      deadlinePolicy: { chainMode: "inherit" },
      milestones: [],
      allowedWindows: [],
      preferredWindows: task.preferredTimeOfDay ? [{ start: task.preferredTimeOfDay, end: task.approximateEnd ?? "23:59" }] : [],
      avoidedWindows: task.avoidedTimeOfDay ? [{ start: task.avoidedTimeOfDay, end: "23:59" }] : [],
      canSplit: task.canSplit ?? false,
      minChunkMinutes: task.minDurationMinutes ?? 25,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      recurrence: task.goalPeriod === "day" ? { frequency: "daily" } : undefined,
      autoPlan: task.allowAutoplan !== false,
      status: "active",
    });
  }
  const blocks: PlannerBlock[] = [];
  for (const event of source.payload.events) {
    const legacyItemId = event.taskId || event.id;
    const itemId = addItem(legacyItemId, {
      kind: event.type === "fixed" || event.type === "spontaneous" ? "fixed_event" : event.type === "habit" ? "routine" : "flexible_task",
      title: event.title,
      notes: event.description,
      area: event.category,
      location: event.location,
      priority: event.priority === "medium" ? "normal" : event.priority ?? "normal",
      energy: "normal",
      estimateMinutes: event.durationMinutes ?? 60,
      deadlineAt: event.deadline ? zonedPlannerDateTimeToUtc(event.deadline, "23:59", profile.timezone) : undefined,
      deadlineType: event.deadline ? "target" : "none",
      targetFinishMode: "auto",
      estimateConfidence: "normal",
      deadlinePolicy: { chainMode: "inherit" },
      milestones: [],
      allowedWindows: [],
      preferredWindows: [], avoidedWindows: [], canSplit: event.canSplit ?? false,
      minChunkMinutes: 25, bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
      recurrence: event.recurrenceRule?.mode === "custom"
        ? { frequency: "custom", weekdays: event.recurrenceRule.weekdays }
        : event.recurrenceRule ? { frequency: "weekly" } : undefined,
      autoPlan: event.type !== "fixed" && event.type !== "spontaneous",
      status: event.status === "done" ? "completed" : "active",
    });
    const date = event.date || source.payload.selectedDate;
    const start = event.start || source.payload.settings.defaultDayStart || "08:00";
    const startAt = zonedPlannerDateTimeToUtc(date, start, profile.timezone);
    let endAt: string;
    if (event.end) {
      const endDate = event.endDate || (plannerTimeToMinutes(event.end) <= plannerTimeToMinutes(start) ? addPlannerDays(date, 1) : date);
      endAt = zonedPlannerDateTimeToUtc(endDate, event.end, profile.timezone);
    } else endAt = addIsoMinutes(startAt, event.durationMinutes ?? 60);
    blocks.push({
      id: `${prefix}-block-${shortHash(event.id)}`,
      itemId,
      title: event.title,
      startAt,
      endAt,
      status: event.status === "done" ? "done" : event.status === "skipped" ? "skipped" : "planned",
      source: "migrated",
      fixed: event.type === "fixed" || event.type === "spontaneous" || event.canMove === false,
      occurrenceKey: `${prefix}:${event.id}`,
    });
  }
  for (const item of items.filter((candidate) => candidate.kind !== "routine")) {
    const linkedBlocks = blocks.filter((block) => block.itemId === item.id);
    if (linkedBlocks.length > 0) {
      item.status = linkedBlocks.every((block) => block.status === "done") ? "completed" : "active";
    }
  }
  return { sourceKey: source.sourceKey, title: source.title, items, blocks };
}
