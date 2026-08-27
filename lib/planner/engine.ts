import {
  createDefaultPlannerProfile,
  type PlannerArchiverEntry,
  type PlannerBlock,
  type PlannerCalibrationProgress,
  type PlannerConflict,
  type PlannerDeadlineAnalysis,
  type PlannerDeferredRemainder,
  type PlannerDraft,
  type PlannerEnergy,
  type PlannerItem,
  type PlannerItemPlanningState,
  type PlannerMilestone,
  type PlannerPriority,
  type PlannerProfile,
  type PlannerProposal,
  type PlannerProposalImpact,
  type PlannerProposalInput,
  type PlannerProposalChange,
  type PlannerRemainderDistribution,
  type PlannerSleepEvent,
  type PlannerTimeWindow,
  type PlannerUncertaintyPolicy,
  type PlannerUnplaced,
  type PlannerWakeAnchorReason,
} from "./types.ts";
import {
  availabilityFromSleepSchedule,
  buildPlannerSleepBlocks,
  buildSleepRecoveryAdvice,
  normalizePlannerSleepEvent,
  normalizeSleepSchedule,
  preferredSleepDurations,
  sleepDurationBounds,
  sleepRuleForWakeDate,
  sleepWindowForWakeDate,
  validateAdaptiveSleepSchedule,
} from "./sleep.ts";
import {
  addIsoMinutes,
  addPlannerDays,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  horizonDays,
  isoDurationMinutes,
  normalizePlannerDate,
  normalizePlannerTime,
  plannerMinutesToTime,
  plannerTimeToMinutes,
  plannerWeekday,
  zonedPlannerDateTimeToUtc,
} from "./time.ts";

const STEP_MINUTES = 15;

type PlannerEngineInput = PlannerProposalInput & {
  profile: PlannerProfile;
  items: PlannerItem[];
  blocks: PlannerBlock[];
  sleepEvents?: PlannerSleepEvent[];
  deferredRemainders?: PlannerDeferredRemainder[];
  archiverEntries?: PlannerArchiverEntry[];
  now?: Date;
  /** A transient profile used to compare sleep choices without changing saved preferences. */
  calculationProfile?: PlannerProfile;
  persistCalculatedSleep?: boolean;
  calculatedSleepReason?: PlannerSleepEvent["selectionReason"];
  /** Restricts an explicit schedule_item operation to the selected item. */
  targetItemIds?: string[];
  targetOccurrenceKey?: string;
  /** Internal guard used by the Archiver's safe placement strategy. */
  remainderDisplacementPolicy?: "allow" | "forbid";
  targetFromDate?: string;
};

type PlacementRequest = {
  item: PlannerItem;
  occurrenceKey: string;
  durationMinutes: number;
  tier?: "required" | "minimum" | "likely" | "reserve" | "extra";
  role?: PlannerBlock["role"];
  mandatory?: boolean;
  targetDate?: string;
  allowedDates?: string[];
  sourceBlock?: PlannerBlock;
  /** False for optional volume that is a reserve, or that did not exist before initial setup. */
  reportRemainder?: boolean;
};

type Interval = { start: number; end: number };

const priorityWeight: Record<PlannerPriority, number> = {
  low: 0,
  normal: 30,
  high: 90,
  critical: 180,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueId(prefix: string, ...parts: Array<string | number | undefined>): string {
  const value = parts.filter((part) => part !== undefined).join("-");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function normalizeWindows(value: unknown): PlannerTimeWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as { start?: unknown; end?: unknown };
    const start = normalizePlannerTime(raw.start);
    const end = normalizePlannerTime(raw.end);
    return start && end && start !== end ? [{ start, end }] : [];
  });
}

export function normalizePlannerProfile(value: Partial<PlannerProfile>): PlannerProfile {
  const fallback = createDefaultPlannerProfile(value.timezone || "Europe/Minsk");
  let timezone = typeof value.timezone === "string" && value.timezone.trim()
    ? value.timezone.trim()
    : fallback.timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    timezone = fallback.timezone;
  }
  const availability = value.availability && typeof value.availability === "object"
    ? Object.fromEntries(
        Object.entries(value.availability).map(([day, windows]) => [day, normalizeWindows(windows)])
      )
    : fallback.availability;
  const availabilityOverrides = value.availabilityOverrides && typeof value.availabilityOverrides === "object"
    ? Object.fromEntries(
        Object.entries(value.availabilityOverrides).flatMap(([date, windows]) =>
          normalizePlannerDate(date) ? [[date, normalizeWindows(windows)]] : []
        )
      )
    : {};
  const rawPolicy = value.planningPolicy;
  const planningPolicy: PlannerProfile["planningPolicy"] = {
    focus: rawPolicy?.focus === "work" ? "work" : "sleep",
    minimumNightMinutes: 360,
    maxNightDeficitMinutes: 120,
    maxRollingSevenDayDeficitMinutes: 180,
    recoveryHorizonNights: 3,
    deadlineChainGapMinutes: rawPolicy?.deadlineChainGapMinutes === 0 || rawPolicy?.deadlineChainGapMinutes === 15 ? rawPolicy.deadlineChainGapMinutes : 5,
    effectiveFromAt: rawPolicy?.effectiveFromAt && Number.isFinite(new Date(rawPolicy.effectiveFromAt).getTime())
      ? new Date(rawPolicy.effectiveFromAt).toISOString()
      : undefined,
  };
  return {
    userId: value.userId,
    timezone,
    horizon:
      value.horizon === "two_weeks" || value.horizon === "month" ? value.horizon : "week",
    reserveRatio: clamp(Number(value.reserveRatio ?? 0.2), 0, 0.6),
    defaultBufferMinutes: clamp(Math.round(Number(value.defaultBufferMinutes ?? 15)), 0, 120),
    availability,
    availabilityOverrides,
    energyWindows: Array.isArray(value.energyWindows)
      ? value.energyWindows.flatMap((window) => {
          const start = normalizePlannerTime(window?.start);
          const end = normalizePlannerTime(window?.end);
          const energy: PlannerEnergy =
            window?.energy === "high" || window?.energy === "low" ? window.energy : "normal";
          return start && end ? [{ start, end, energy }] : [];
        })
      : fallback.energyWindows,
    sleepSchedule: normalizeSleepSchedule(value.sleepSchedule ?? fallback.sleepSchedule),
    planningPolicy,
    assistantSetupVersion: Math.max(0, Math.round(Number(value.assistantSetupVersion ?? 0))),
    revision: Math.max(0, Math.round(Number(value.revision ?? 0))),
    onboardingCompleted: Boolean(value.onboardingCompleted),
  };
}

export function normalizePlannerItem(value: Partial<PlannerItem> & { id: string; title: string }): PlannerItem {
  const deadlineType = value.deadlineType === "hard" || value.deadlineType === "target"
    ? value.deadlineType
    : value.deadlineAt
      ? "target"
      : "none";
  const chainMode = value.deadlinePolicy?.chainMode === "off" || value.deadlinePolicy?.chainMode === "auto"
    || value.deadlinePolicy?.chainMode === "pinned"
    ? value.deadlinePolicy.chainMode
    : "inherit";
  const gapMinutes = value.deadlinePolicy?.gapMinutes === 0 || value.deadlinePolicy?.gapMinutes === 15
    ? value.deadlinePolicy.gapMinutes
    : value.deadlinePolicy?.gapMinutes === 5
      ? 5
      : undefined;
  const milestones = Array.isArray(value.milestones)
    ? value.milestones.slice(0, 5).flatMap((milestone, index): PlannerMilestone[] => {
        if (!milestone || typeof milestone !== "object" || !milestone.targetAt) return [];
        const target = new Date(milestone.targetAt);
        if (!Number.isFinite(target.getTime())) return [];
        return [{
          id: String(milestone.id || `milestone-${index + 1}`).slice(0, 120),
          title: String(milestone.title || `Этап ${index + 1}`).trim().slice(0, 160),
          estimateMinutes: clamp(Math.round(Number(milestone.estimateMinutes ?? 60)), 15, 24 * 60),
          targetAt: target.toISOString(),
          order: index + 1,
        }];
      })
    : [];
  const legacyLikelyMinutes = clamp(Math.round(Number(value.estimateMinutes ?? 60)), 5, 600_000);
  const rawDuration = value.uncertaintyPolicy?.duration;
  const durationMode = rawDuration?.mode === "approximate" || rawDuration?.mode === "range" || rawDuration?.mode === "unknown"
    ? rawDuration.mode
    : "exact";
  const tolerancePercent = rawDuration?.tolerancePercent === 15 || rawDuration?.tolerancePercent === 50 ? rawDuration.tolerancePercent : 30;
  const calibrationMinutes = clamp(Math.round(Number(rawDuration?.calibrationMinutes ?? rawDuration?.likelyMinutes ?? 30)), 5, 24 * 60);
  const likelyMinutes = durationMode === "unknown"
    ? calibrationMinutes
    : clamp(Math.round(Number(rawDuration?.likelyMinutes ?? legacyLikelyMinutes)), 5, 600_000);
  const calculatedMinimum = Math.max(5, Math.round(likelyMinutes * (1 - tolerancePercent / 100)));
  const calculatedMaximum = Math.max(likelyMinutes, Math.round(likelyMinutes * (1 + tolerancePercent / 100)));
  const minMinutes = durationMode === "exact" || durationMode === "unknown"
    ? likelyMinutes
    : clamp(Math.round(Number(rawDuration?.minMinutes ?? calculatedMinimum)), 5, likelyMinutes);
  const maxMinutes = durationMode === "exact" || durationMode === "unknown"
    ? likelyMinutes
    : clamp(Math.round(Number(rawDuration?.maxMinutes ?? calculatedMaximum)), likelyMinutes, 600_000);
  const rawUncertainty = value.uncertaintyPolicy;
  const allowedWeekdays = (rawUncertainty?.recurrence?.allowedWeekdays ?? value.recurrence?.weekdays ?? [])
    .map(Number)
    .filter((day, index, days) => day >= 1 && day <= 7 && days.indexOf(day) === index)
    .sort();
  const defaultOccurrences = Math.max(1, allowedWeekdays.length || 1);
  const recurrenceMinimum = clamp(Math.round(Number(rawUncertainty?.recurrence?.minOccurrences ?? defaultOccurrences)), 0, 31);
  const recurrenceLikely = clamp(Math.round(Number(rawUncertainty?.recurrence?.likelyOccurrences ?? defaultOccurrences)), recurrenceMinimum, 31);
  const recurrenceMaximum = clamp(Math.round(Number(rawUncertainty?.recurrence?.maxOccurrences ?? defaultOccurrences)), recurrenceLikely, 31);
  const uncertaintyPolicy: PlannerUncertaintyPolicy = {
    outcomeMode: value.recurrence?.durationMode === "per_occurrence"
      || (rawUncertainty?.outcomeMode === "time_budget" && value.recurrence?.durationMode !== "per_cycle")
      || (!rawUncertainty && Boolean(value.recurrence) && value.recurrence?.durationMode !== "per_cycle")
      ? "time_budget"
      : "deliverable",
    duration: {
      mode: durationMode,
      minMinutes,
      likelyMinutes,
      maxMinutes,
      tolerancePercent: durationMode === "approximate" ? tolerancePercent : undefined,
      calibrationMinutes: durationMode === "unknown" ? calibrationMinutes : undefined,
      source: rawDuration?.source === "calibration" || rawDuration?.source === "statistics" ? rawDuration.source : "user",
    },
    date: {
      mode: rawUncertainty?.date?.mode === "preferred" || rawUncertainty?.date?.mode === "range" || rawUncertainty?.date?.mode === "any"
        ? rawUncertainty.date.mode
        : "exact",
      exactDate: rawUncertainty?.date?.exactDate,
      preferredDate: rawUncertainty?.date?.preferredDate,
      earliestDate: rawUncertainty?.date?.earliestDate,
      latestDate: rawUncertainty?.date?.latestDate,
    },
    time: {
      mode: rawUncertainty?.time?.mode === "preferred" || rawUncertainty?.time?.mode === "range" || rawUncertainty?.time?.mode === "any"
        ? rawUncertainty.time.mode
        : "exact",
      exactStart: normalizePlannerTime(rawUncertainty?.time?.exactStart),
      preferredStart: normalizePlannerTime(rawUncertainty?.time?.preferredStart),
      earliestStart: normalizePlannerTime(rawUncertainty?.time?.earliestStart),
      latestEnd: normalizePlannerTime(rawUncertainty?.time?.latestEnd),
    },
    recurrence: {
      mode: rawUncertainty?.recurrence?.mode === "count_range" ? "count_range" : "exact_days",
      period: rawUncertainty?.recurrence?.period === "month" ? "month" : "week",
      minOccurrences: recurrenceMinimum,
      likelyOccurrences: recurrenceLikely,
      maxOccurrences: recurrenceMaximum,
      allowedWeekdays,
    },
    deadline: deadlineType === "none" ? { mode: "none" } : {
      mode: deadlineType === "hard" ? "hard" : "preferred_range",
      preferredFromAt: rawUncertainty?.deadline?.preferredFromAt,
      latestAt: rawUncertainty?.deadline?.latestAt ?? value.deadlineAt,
    },
    travel: rawUncertainty?.travel ? (() => {
      const travelMode = rawUncertainty.travel!.mode === "approximate" || rawUncertainty.travel!.mode === "range"
        ? rawUncertainty.travel!.mode
        : "exact";
      const travelLikely = clamp(Math.round(Number(rawUncertainty.travel!.likelyMinutes ?? 0)), 0, 24 * 60);
      return {
        mode: travelMode,
        minMinutes: travelMode === "exact" ? travelLikely : clamp(Math.round(Number(rawUncertainty.travel!.minMinutes ?? travelLikely)), 0, travelLikely),
        likelyMinutes: travelLikely,
        maxMinutes: travelMode === "exact" ? travelLikely : clamp(Math.round(Number(rawUncertainty.travel!.maxMinutes ?? travelLikely)), travelLikely, 24 * 60),
        tolerancePercent: rawUncertainty.travel!.tolerancePercent,
        punctuality: rawUncertainty.travel!.punctuality === "strict" || rawUncertainty.travel!.punctuality === "flexible"
          ? rawUncertainty.travel!.punctuality
          : "normal" as const,
      };
    })() : undefined,
    missedOccurrencePolicy: rawUncertainty?.missedOccurrencePolicy === "carry_remaining"
      || rawUncertainty?.missedOccurrencePolicy === "cancel_occurrence"
      || rawUncertainty?.missedOccurrencePolicy === "reestimate_total"
      ? rawUncertainty.missedOccurrencePolicy
      : rawUncertainty?.missedOccurrencePolicy === "ask" ? "ask" : undefined,
    reduction: rawUncertainty?.reduction?.mode === "to_minimum"
      ? {
          mode: "to_minimum",
          minimumMinutes: clamp(
            Math.round(Number(rawUncertainty.reduction.minimumMinutes ?? minMinutes)),
            5,
            likelyMinutes
          ),
        }
      : { mode: "forbidden" },
  };
  const normalizedCommitment = value.commitmentLevel === "must_not_skip" || value.commitmentLevel === "desired" || value.commitmentLevel === "if_time"
    ? value.commitmentLevel
    : "required";
  return {
    id: value.id,
    kind:
      value.kind === "fixed_event" || value.kind === "routine" ? value.kind : "flexible_task",
    title: value.title.trim().slice(0, 160) || "Новое дело",
    notes: value.notes?.trim().slice(0, 4000) || undefined,
    area: value.area?.trim().slice(0, 80) || undefined,
    location: value.location?.trim().slice(0, 240) || undefined,
    priority:
      value.priority === "low" || value.priority === "high" || value.priority === "critical"
        ? value.priority
        : "normal",
    energy: value.energy === "low" || value.energy === "high" ? value.energy : "normal",
    estimateMinutes: uncertaintyPolicy.duration.likelyMinutes,
    uncertaintyPolicy,
    commitmentLevel: deadlineType === "hard" ? "must_not_skip" : normalizedCommitment,
    planningRank: clamp(Math.round(Number(value.planningRank ?? 0)), 0, 1_000_000),
    earliestAt: value.earliestAt,
    deadlineAt: deadlineType === "none" ? undefined : value.deadlineAt,
    deadlineType,
    targetFinishAt: deadlineType === "hard" ? value.targetFinishAt : undefined,
    targetFinishMode: value.targetFinishMode === "manual" ? "manual" : "auto",
    estimateConfidence: value.estimateConfidence === "high" || value.estimateConfidence === "low" ? value.estimateConfidence : "normal",
    deadlinePolicy: {
      chainMode,
      gapMinutes,
      nextItemId: chainMode === "pinned" ? value.deadlinePolicy?.nextItemId?.slice(0, 160) : undefined,
    },
    milestones,
    allowedWindows: normalizeWindows(value.allowedWindows),
    preferredWindows: normalizeWindows(value.preferredWindows),
    avoidedWindows: normalizeWindows(value.avoidedWindows),
    canSplit: Boolean(value.canSplit),
    minChunkMinutes: clamp(Math.round(Number(value.minChunkMinutes ?? 25)), 5, 24 * 60),
    bufferBeforeMinutes: clamp(Math.round(Number(value.bufferBeforeMinutes ?? 0)), 0, 24 * 60),
    bufferAfterMinutes: clamp(Math.round(Number(value.bufferAfterMinutes ?? 0)), 0, 24 * 60),
    recurrence: value.recurrence
      ? {
          ...value.recurrence,
          durationMode: value.recurrence.durationMode === "per_cycle" ? "per_cycle" : "per_occurrence",
          schedulingMode: value.recurrence.schedulingMode === "spare_time" ? "spare_time" : "required",
          minimumMinutes: value.recurrence.schedulingMode === "spare_time"
            ? clamp(
                Math.round(Number(value.recurrence.minimumMinutes ?? 30)),
                5,
                uncertaintyPolicy.duration.likelyMinutes
              )
            : undefined,
        }
      : undefined,
    autoPlan: value.autoPlan !== false,
    status:
      value.status === "completed" || value.status === "archived" ? value.status : "active",
    unplacedReason: value.unplacedReason?.trim().slice(0, 500) || undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function rangesOverlap(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

function blockInterval(block: PlannerBlock): Interval {
  if (block.status === "in_progress" && block.actualStartAt) {
    const actualStart = new Date(block.actualStartAt).getTime();
    const estimatedEnd = actualStart + isoDurationMinutes(block.startAt, block.endAt) * 60_000;
    return { start: actualStart, end: Math.max(new Date(block.endAt).getTime(), estimatedEnd) };
  }
  return { start: new Date(block.startAt).getTime(), end: new Date(block.endAt).getTime() };
}

function accountedBlockMinutes(block: PlannerBlock): number {
  return block.status === "done" && block.actualStartAt && block.actualEndAt
    ? isoDurationMinutes(block.actualStartAt, block.actualEndAt)
    : isoDurationMinutes(block.startAt, block.endAt);
}

function windowContainsMinute(window: PlannerTimeWindow, minute: number): boolean {
  const start = plannerTimeToMinutes(window.start);
  let end = plannerTimeToMinutes(window.end);
  if (end <= start) end += 1440;
  const candidates = [minute, minute + 1440];
  return candidates.some((candidate) => candidate >= start && candidate < end);
}

function windowOverlapsRange(window: PlannerTimeWindow, startMinute: number, endMinute: number): boolean {
  const windowStart = plannerTimeToMinutes(window.start);
  let windowEnd = plannerTimeToMinutes(window.end);
  if (windowEnd <= windowStart) windowEnd += 1440;
  return rangesOverlap({ start: startMinute, end: endMinute }, { start: windowStart, end: windowEnd })
    || rangesOverlap({ start: startMinute + 1440, end: endMinute + 1440 }, { start: windowStart, end: windowEnd });
}

function rangeInsideWindow(window: PlannerTimeWindow, startMinute: number, endMinute: number): boolean {
  const windowStart = plannerTimeToMinutes(window.start);
  let windowEnd = plannerTimeToMinutes(window.end);
  if (windowEnd <= windowStart) windowEnd += 1440;
  return [startMinute, startMinute + 1440].some((candidateStart) =>
    candidateStart >= windowStart && candidateStart + (endMinute - startMinute) <= windowEnd
  );
}

function requiredPlannerGap(defaultMinutes: number, afterMinutes: number, beforeMinutes: number): number {
  return Math.max(defaultMinutes, Math.max(0, afterMinutes) + Math.max(0, beforeMinutes));
}

function strictTravelExtra(item: PlannerItem): number {
  const travel = item.uncertaintyPolicy.travel;
  return travel?.punctuality === "strict" ? Math.max(0, travel.maxMinutes - travel.likelyMinutes) : 0;
}

function plannerBufferBefore(item: PlannerItem | undefined): number {
  if (!item) return 0;
  return item.bufferBeforeMinutes + strictTravelExtra(item);
}

function plannerBufferAfter(item: PlannerItem | undefined): number {
  if (!item) return 0;
  return item.bufferAfterMinutes > 0 ? item.bufferAfterMinutes + strictTravelExtra(item) : 0;
}

function placementFootprintMinutes(item: PlannerItem, durationMinutes: number): number {
  return durationMinutes + plannerBufferBefore(item) + plannerBufferAfter(item);
}

function energyAt(profile: PlannerProfile, minute: number): PlannerEnergy {
  return profile.energyWindows.find((window) => windowContainsMinute(window, minute))?.energy ?? "normal";
}

function durationForLocalRange(start: string, end: string): number {
  const startMinute = plannerTimeToMinutes(start);
  let endMinute = plannerTimeToMinutes(end);
  if (endMinute <= startMinute) endMinute += 1440;
  return endMinute - startMinute;
}

function blockMinutesInsideWindow(
  block: PlannerBlock,
  date: string,
  window: PlannerTimeWindow,
  timezone: string
): number {
  const windowStart = zonedPlannerDateTimeToUtc(date, window.start, timezone);
  const windowEndDate = plannerTimeToMinutes(window.end) <= plannerTimeToMinutes(window.start)
    ? addPlannerDays(date, 1)
    : date;
  const windowEnd = zonedPlannerDateTimeToUtc(windowEndDate, window.end, timezone);
  const overlapStart = Math.max(new Date(block.startAt).getTime(), new Date(windowStart).getTime());
  const overlapEnd = Math.min(new Date(block.endAt).getTime(), new Date(windowEnd).getTime());
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 60_000));
}

function availabilityForDate(profile: PlannerProfile, date: string): PlannerTimeWindow[] {
  return profile.availabilityOverrides[date]
    ?? profile.availability[String(plannerWeekday(date))]
    ?? [];
}

function deadlineBufferMinutes(item: PlannerItem): number {
  const ratio = item.estimateConfidence === "high" ? 0.15 : item.estimateConfidence === "low" ? 0.5 : 0.3;
  const minimum = item.estimateConfidence === "high" ? 30 : item.estimateConfidence === "low" ? 120 : 60;
  const maximum = item.estimateConfidence === "high" ? 240 : item.estimateConfidence === "low" ? 960 : 480;
  const confidenceBuffer = clamp(item.estimateMinutes * ratio, minimum, maximum);
  const uncertaintyBuffer = Math.max(0, item.uncertaintyPolicy.duration.maxMinutes - item.uncertaintyPolicy.duration.likelyMinutes);
  return Math.ceil(Math.max(confidenceBuffer, uncertaintyBuffer) / STEP_MINUTES) * STEP_MINUTES;
}

function plannerSlotAvailable(profile: PlannerProfile, occupied: PlannerBlock[], start: number, end: number): boolean {
  const instant = new Date(start);
  const date = formatDateInTimeZone(instant, profile.timezone);
  const minute = plannerTimeToMinutes(formatTimeInTimeZone(instant, profile.timezone));
  const insideAvailability = availabilityForDate(profile, date).some((window) => windowContainsMinute(window, minute));
  if (!insideAvailability) return false;
  return !occupied.some((block) => {
    if (block.status === "cancelled" || block.status === "skipped" || block.soft) return false;
    const interval = blockInterval(block);
    return start < interval.end && interval.start < end;
  });
}

function walkAvailableMinutesBackward(
  profile: PlannerProfile,
  occupied: PlannerBlock[],
  endAt: string,
  minutes: number,
  floorMs: number
): string {
  let cursor = Math.floor(new Date(endAt).getTime() / (STEP_MINUTES * 60_000)) * STEP_MINUTES * 60_000;
  let remaining = Math.max(0, minutes);
  while (cursor > floorMs && remaining > 0) {
    const start = cursor - STEP_MINUTES * 60_000;
    if (plannerSlotAvailable(profile, occupied, start, cursor)) remaining -= STEP_MINUTES;
    cursor = start;
  }
  return new Date(Math.max(floorMs, cursor)).toISOString();
}

function availableMinutesBetween(
  profile: PlannerProfile,
  occupied: PlannerBlock[],
  startMs: number,
  endMs: number
): number {
  let minutes = 0;
  let cursor = Math.ceil(startMs / (STEP_MINUTES * 60_000)) * STEP_MINUTES * 60_000;
  while (cursor + STEP_MINUTES * 60_000 <= endMs) {
    const end = cursor + STEP_MINUTES * 60_000;
    if (plannerSlotAvailable(profile, occupied, cursor, end)) minutes += STEP_MINUTES;
    cursor = end;
  }
  return minutes;
}

export function resolvePlannerTargetFinish(
  item: PlannerItem,
  profile: PlannerProfile,
  occupied: PlannerBlock[],
  now = new Date()
): string | undefined {
  if (item.deadlineType !== "hard" || !item.deadlineAt) return item.deadlineAt;
  if (item.targetFinishMode === "manual" && item.targetFinishAt) return item.targetFinishAt;
  return walkAvailableMinutesBackward(profile, occupied, item.deadlineAt, deadlineBufferMinutes(item), now.getTime());
}

export function suggestPlannerMilestones(item: PlannerItem, targetAt?: string, now = new Date()): PlannerMilestone[] {
  const finalTarget = targetAt ?? item.targetFinishAt ?? item.deadlineAt;
  if (item.estimateMinutes < 120 || !finalTarget) return [];
  const count = clamp(Math.ceil(item.estimateMinutes / 120), 2, 5);
  const targetMs = new Date(finalTarget).getTime();
  if (!Number.isFinite(targetMs) || targetMs <= now.getTime()) return [];
  const chunk = Math.ceil(item.estimateMinutes / count / STEP_MINUTES) * STEP_MINUTES;
  return Array.from({ length: count }, (_, index) => ({
    id: `milestone-${item.id}-${index + 1}`,
    title: `Этап ${index + 1} из ${count}`,
    estimateMinutes: index === count - 1 ? Math.max(15, item.estimateMinutes - chunk * (count - 1)) : chunk,
    targetAt: new Date(now.getTime() + (targetMs - now.getTime()) * ((index + 1) / count)).toISOString(),
    order: index + 1,
  }));
}

export function analyzePlannerDeadlines(
  items: PlannerItem[],
  blocks: PlannerBlock[],
  profile: PlannerProfile,
  now = new Date(),
  _deferredRemainders: PlannerDeferredRemainder[] = []
): PlannerDeadlineAnalysis[] {
  void _deferredRemainders; // Kept for old callers; archived volume is intentionally never counted as completed work.
  return items.flatMap((item): PlannerDeadlineAnalysis[] => {
    if (item.status !== "active" || item.deadlineType === "none" || !item.deadlineAt) return [];
    const completedMinutes = blocks
      .filter((block) => block.itemId === item.id && block.status === "done" && !block.soft)
      .reduce((sum, block) => sum + accountedBlockMinutes(block), 0);
    const accountedMinutes = completedMinutes;
    const remainingMinutes = Math.max(0, item.uncertaintyPolicy.duration.likelyMinutes - accountedMinutes);
    const maximumRemainingMinutes = Math.max(0, item.uncertaintyPolicy.duration.maxMinutes - accountedMinutes);
    const capacityBlocks = blocks.filter((block) => block.itemId !== item.id);
    const targetFinishAt = resolvePlannerTargetFinish(item, profile, capacityBlocks, now) ?? item.deadlineAt;
    const deadlineMs = new Date(item.deadlineAt).getTime();
    const targetMs = new Date(targetFinishAt).getTime();
    const availableMinutes = availableMinutesBetween(profile, capacityBlocks, now.getTime(), deadlineMs);
    const availableToTarget = availableMinutesBetween(profile, capacityBlocks, now.getTime(), targetMs);
    const slackMinutes = availableMinutes - remainingMinutes;
    const risk = availableMinutes < remainingMinutes
      ? "impossible" as const
      : availableToTarget < remainingMinutes
        ? "at_risk" as const
        : availableToTarget - remainingMinutes < Math.max(30, Math.ceil(item.estimateMinutes * 0.15))
          ? "tight" as const
          : "on_track" as const;
    const maximumRisk = availableMinutes < maximumRemainingMinutes
      ? "impossible" as const
      : availableToTarget < maximumRemainingMinutes
        ? "at_risk" as const
        : availableToTarget - maximumRemainingMinutes < Math.max(30, Math.ceil(maximumRemainingMinutes * 0.15))
          ? "tight" as const
          : "on_track" as const;
    const latestSafeStartAt = walkAvailableMinutesBackward(profile, capacityBlocks, item.deadlineAt, remainingMinutes, now.getTime());
    return [{
      itemId: item.id,
      title: item.title,
      deadlineType: item.deadlineType,
      deadlineAt: item.deadlineAt,
      targetFinishAt,
      remainingMinutes,
      availableMinutes,
      slackMinutes,
      latestSafeStartAt,
      risk,
      likelyScenario: {
        remainingMinutes,
        slackMinutes,
        risk,
      },
      maximumScenario: {
        remainingMinutes: maximumRemainingMinutes,
        slackMinutes: availableMinutes - maximumRemainingMinutes,
        risk: maximumRisk,
      },
    }];
  }).sort((left, right) => left.deadlineAt.localeCompare(right.deadlineAt) || left.itemId.localeCompare(right.itemId));
}

function getRoutineDates(item: PlannerItem, startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addPlannerDays(date, 1)) {
    if (item.recurrence?.startDate && date < item.recurrence.startDate) continue;
    if (item.recurrence?.frequency === "once") {
      if (item.recurrence.startDate === date) dates.push(date);
    } else if (!item.recurrence || item.recurrence.frequency === "daily") dates.push(date);
    else if (item.recurrence.frequency === "weekly" && plannerWeekday(date) === (item.recurrence.weekdays?.[0] ?? 1)) dates.push(date);
    else if (item.recurrence.frequency === "custom" && item.recurrence.weekdays?.includes(plannerWeekday(date))) dates.push(date);
  }
  return dates;
}

function calendarWeekStart(date: string): string {
  return addPlannerDays(date, 1 - plannerWeekday(date));
}

function blockLocalDate(block: PlannerBlock, timezone: string): string {
  return formatDateInTimeZone(new Date(block.startAt), timezone);
}

function buildPlacementRequests(
  items: PlannerItem[],
  blocks: PlannerBlock[],
  startDate: string,
  endDate: string,
  timezone: string,
  effectiveFromAt?: string,
  deferredRemainders: PlannerDeferredRemainder[] = [],
  targetItemIds?: Set<string>,
  currentAt?: string
): PlacementRequest[] {
  const requests: PlacementRequest[] = [];
  const activeBlocks = blocks.filter((block) => block.status !== "cancelled" && block.status !== "skipped" && !block.soft);
  const recurrenceBlocks = blocks.filter((block) => block.status !== "cancelled" && !block.soft);
  const activationDate = effectiveFromAt ? formatDateInTimeZone(new Date(effectiveFromAt), timezone) : undefined;
  const deferredMinutes = (itemId: string, occurrencePrefix?: string) => deferredRemainders
    .filter((remainder) => remainder.itemId === itemId
      && !remainder.resolvedAt
      && remainder.pendingMinutes > 0
      && (!occurrencePrefix || remainder.occurrenceKey?.startsWith(occurrencePrefix)))
    .reduce((sum, remainder) => sum + remainder.pendingMinutes, 0);
  const mandatoryMinimum = (item: PlannerItem) => item.deadlineType === "hard"
    || item.commitmentLevel === "must_not_skip"
    || item.commitmentLevel === "required";
  const pushVolumeRequests = (
    item: PlannerItem,
    occurrenceKey: string,
    alreadyPlanned: number,
    constraints: Pick<PlacementRequest, "targetDate" | "allowedDates">,
    occurrenceTier?: "likely" | "extra",
    volumeScale = 1,
    mandatoryOverride?: boolean,
    reportRemainder = true
  ) => {
    const estimate = item.uncertaintyPolicy.duration;
    const scaleMinutes = (minutes: number) => volumeScale === 1
      ? minutes
      : Math.max(0, Math.round(minutes * volumeScale / STEP_MINUTES) * STEP_MINUTES);
    const scaledMinimum = scaleMinutes(estimate.minMinutes);
    const scaledLikely = Math.max(scaledMinimum, scaleMinutes(estimate.likelyMinutes));
    const scaledMaximum = Math.max(scaledLikely, scaleMinutes(estimate.maxMinutes));
    const role = estimate.mode === "unknown" ? "calibration" as const : "work" as const;
    if (occurrenceTier) {
      const target = scaledLikely;
      const remaining = Math.max(0, target - alreadyPlanned);
      if (remaining > 0) requests.push({
        item,
        occurrenceKey,
        durationMinutes: remaining,
        tier: occurrenceTier,
        role,
        mandatory: false,
        reportRemainder,
        ...constraints,
      });
      return;
    }
    const legacySpareMinimum = item.recurrence?.schedulingMode === "spare_time"
      ? Math.min(scaledMinimum, scaleMinutes(item.recurrence.minimumMinutes ?? estimate.minMinutes))
      : scaledMinimum;
    const minimumRemaining = Math.max(0, legacySpareMinimum - alreadyPlanned);
    const likelyRemaining = Math.max(0, scaledLikely - Math.max(alreadyPlanned, legacySpareMinimum));
    const reserveRemaining = Math.max(0, scaledMaximum - Math.max(alreadyPlanned, scaledLikely));
    if (minimumRemaining > 0) requests.push({
      item,
      occurrenceKey: estimate.mode === "exact" ? occurrenceKey : `${occurrenceKey}:minimum`,
      durationMinutes: minimumRemaining,
      tier: "minimum",
      role,
      mandatory: mandatoryOverride ?? mandatoryMinimum(item),
      reportRemainder,
      ...constraints,
    });
    if (likelyRemaining > 0) requests.push({
      item,
      occurrenceKey: `${occurrenceKey}:likely`,
      durationMinutes: likelyRemaining,
      tier: "likely",
      role,
      mandatory: false,
      reportRemainder,
      ...constraints,
    });
    if (reserveRemaining > 0) requests.push({
      item,
      occurrenceKey: `${occurrenceKey}:reserve`,
      durationMinutes: reserveRemaining,
      tier: "reserve",
      role: "uncertainty_reserve",
      mandatory: false,
      reportRemainder: false,
      ...constraints,
    });
  };
  const partialPeriod = (item: PlannerItem, period: "week" | "month", periodKey: string): {
    scale: number;
    min: number;
    likely: number;
    max: number;
  } => {
    const policy = item.uncertaintyPolicy.recurrence;
    if (!activationDate) return { scale: 1, min: policy.minOccurrences, likely: policy.likelyOccurrences, max: policy.maxOccurrences };
    const activationKey = period === "month" ? activationDate.slice(0, 7) : calendarWeekStart(activationDate);
    if (activationKey !== periodKey) return { scale: 1, min: policy.minOccurrences, likely: policy.likelyOccurrences, max: policy.maxOccurrences };
    const periodStart = period === "month" ? `${periodKey}-01` : periodKey;
    const periodStartDate = new Date(`${periodStart}T00:00:00Z`);
    const nextMonth = new Date(Date.UTC(periodStartDate.getUTCFullYear(), periodStartDate.getUTCMonth() + 1, 1))
      .toISOString().slice(0, 10);
    const periodEnd = period === "month" ? addPlannerDays(nextMonth, -1) : addPlannerDays(periodStart, 6);
    const eligible = getRoutineDates(item, periodStart, periodEnd)
      .filter((date) => !policy.allowedWeekdays.length || policy.allowedWeekdays.includes(plannerWeekday(date)));
    const remaining = eligible.filter((date) => date >= activationDate).length;
    const scale = eligible.length ? remaining / eligible.length : 1;
    const maximum = Math.min(remaining, Math.ceil(policy.maxOccurrences * scale));
    const minimum = Math.min(maximum, Math.floor(policy.minOccurrences * scale));
    const likely = Math.min(maximum, Math.max(minimum, Math.round(policy.likelyOccurrences * scale)));
    return { scale, min: minimum, likely, max: maximum };
  };
  const datesInPolicyRange = (item: PlannerItem): string[] | undefined => {
    const policy = item.uncertaintyPolicy.date;
    if (policy.mode !== "range") return undefined;
    const earliest = policy.earliestDate ?? startDate;
    const latest = policy.latestDate ?? endDate;
    const dates: string[] = [];
    for (let date = startDate; date <= endDate; date = addPlannerDays(date, 1)) {
      if (date >= earliest && date <= latest) dates.push(date);
    }
    return dates;
  };
  const directConstraints = (item: PlannerItem): Pick<PlacementRequest, "targetDate" | "allowedDates"> => {
    const policy = item.uncertaintyPolicy.date;
    if (policy.mode === "exact") {
      return { targetDate: policy.exactDate ?? item.recurrence?.startDate };
    }
    return { allowedDates: datesInPolicyRange(item) };
  };
  for (const item of items) {
    if (targetItemIds && !targetItemIds.has(item.id)) continue;
    if (item.status !== "active" || item.kind === "fixed_event"
      || !item.autoPlan && !targetItemIds?.has(item.id)) continue;
    if (item.uncertaintyPolicy.duration.mode === "unknown") {
      const nowMs = new Date(currentAt ?? effectiveFromAt ?? Date.now()).getTime();
      const accounted = activeBlocks
        .filter((block) => block.itemId === item.id
          && block.role === "calibration"
          && (block.status === "done" || block.status === "in_progress" || new Date(block.endAt).getTime() > nowMs))
        .reduce((sum, block) => sum + accountedBlockMinutes(block), 0);
      const allowedDates = item.recurrence ? getRoutineDates(item, startDate, endDate) : datesInPolicyRange(item);
      pushVolumeRequests(item, `${item.id}:calibration`, accounted, item.recurrence
        ? { allowedDates }
        : directConstraints(item));
      continue;
    }
    if (item.uncertaintyPolicy.recurrence.mode === "count_range" && item.recurrence && item.recurrence.frequency !== "once") {
      const policy = item.uncertaintyPolicy.recurrence;
      const candidateDates = getRoutineDates(item, startDate, endDate)
        .filter((date) => !policy.allowedWeekdays.length || policy.allowedWeekdays.includes(plannerWeekday(date)));
      const periods = new Map<string, string[]>();
      for (const date of candidateDates) {
        const periodKey = policy.period === "month" ? date.slice(0, 7) : calendarWeekStart(date);
        periods.set(periodKey, [...(periods.get(periodKey) ?? []), date]);
      }
      if (item.uncertaintyPolicy.outcomeMode === "deliverable") {
        for (const [periodKey, periodDates] of periods) {
          const allowedDates = periodDates.slice(0, Math.max(1, policy.maxOccurrences));
          const alreadyPlanned = recurrenceBlocks
            .filter((block) => block.itemId === item.id && block.occurrenceKey?.startsWith(`${item.id}:project:${periodKey}`))
            .reduce((sum, block) => sum + accountedBlockMinutes(block), 0)
            + deferredMinutes(item.id, `${item.id}:project:${periodKey}`);
          pushVolumeRequests(item, `${item.id}:project:${periodKey}`, alreadyPlanned, { allowedDates });
        }
        continue;
      }
      for (const [periodKey, periodDates] of periods) {
        const partial = partialPeriod(item, policy.period, periodKey);
        const maximum = Math.min(partial.max, periodDates.length);
        for (let index = 0; index < maximum; index += 1) {
          const occurrenceKey = `${item.id}:count:${periodKey}:${index + 1}`;
          const targetDate = periodDates[Math.min(periodDates.length - 1, Math.floor(index * periodDates.length / Math.max(1, maximum)))];
          const alreadyPlanned = recurrenceBlocks
            .filter((block) => block.itemId === item.id && block.occurrenceKey?.startsWith(occurrenceKey))
            .reduce((sum, block) => sum + accountedBlockMinutes(block), 0)
            + deferredMinutes(item.id, occurrenceKey);
          const occurrenceTier = index < partial.min
            ? undefined
            : index < partial.likely
              ? "likely" as const
              : "extra" as const;
          pushVolumeRequests(
            item,
            occurrenceKey,
            alreadyPlanned,
            { targetDate },
            occurrenceTier,
            1,
            targetDate === activationDate ? false : undefined,
            targetDate !== activationDate && occurrenceTier !== "extra"
          );
        }
      }
      continue;
    }
    if (item.kind === "routine" || item.recurrence?.frequency === "once") {
      const routineDates = getRoutineDates(item, startDate, endDate);
      if (item.uncertaintyPolicy.outcomeMode === "deliverable" || (item.kind === "routine" && item.recurrence?.durationMode === "per_cycle")) {
        const datesByPeriod = new Map<string, string[]>();
        const monthly = item.uncertaintyPolicy.recurrence.period === "month";
        for (const date of routineDates) {
          const periodKey = monthly ? date.slice(0, 7) : calendarWeekStart(date);
          datesByPeriod.set(periodKey, [...(datesByPeriod.get(periodKey) ?? []), date]);
        }
        for (const [periodKey, allowedDates] of datesByPeriod) {
          const alreadyPlanned = recurrenceBlocks
            .filter((block) => {
              if (block.itemId !== item.id) return false;
              const date = blockLocalDate(block, timezone);
              return monthly ? date.startsWith(periodKey) : calendarWeekStart(date) === periodKey;
            })
            .reduce((sum, block) => sum + accountedBlockMinutes(block), 0)
            + deferredMinutes(item.id, `${item.id}:cycle:${periodKey}`);
          const partial = partialPeriod(item, monthly ? "month" : "week", periodKey);
          const scale = item.uncertaintyPolicy.outcomeMode === "time_budget" ? partial.scale : 1;
          pushVolumeRequests(item, `${item.id}:cycle:${periodKey}`, alreadyPlanned, { allowedDates }, undefined, scale);
        }
        continue;
      }
      for (const date of routineDates) {
        const key = `${item.id}:${date}`;
        const alreadyPlanned = recurrenceBlocks
          .filter((block) => block.itemId === item.id && blockLocalDate(block, timezone) === date)
          .reduce((sum, block) => sum + accountedBlockMinutes(block), 0)
          + deferredMinutes(item.id, key);
        pushVolumeRequests(
          item,
          key,
          alreadyPlanned,
          { targetDate: date },
          undefined,
          1,
          date === activationDate ? false : undefined,
          date !== activationDate
        );
      }
      continue;
    }
    const alreadyPlanned = activeBlocks
      .filter((block) => block.itemId === item.id)
      .reduce((sum, block) => sum + accountedBlockMinutes(block), 0)
      + deferredMinutes(item.id);
    pushVolumeRequests(item, item.id, alreadyPlanned, directConstraints(item));
  }
  return requests.sort((left, right) => {
    const placementRank = (request: PlacementRequest) => {
      if (request.tier === "reserve") return 30;
      if (request.tier === "extra") return 50;
      if (request.item.commitmentLevel === "if_time" || request.item.recurrence?.schedulingMode === "spare_time") return 40;
      const group = request.item.deadlineType === "hard" || request.item.commitmentLevel === "must_not_skip"
        ? 0
        : request.item.commitmentLevel === "required"
          ? 10
          : 20;
      return group + (request.tier === "likely" ? 1 : 0);
    };
    const rank = placementRank(left) - placementRank(right);
    if (rank) return rank;
    const manualRank = left.item.planningRank - right.item.planningRank;
    if (manualRank) return manualRank;
    const leftHard = left.item.deadlineType === "hard" ? 1 : 0;
    const rightHard = right.item.deadlineType === "hard" ? 1 : 0;
    if (leftHard !== rightHard) return rightHard - leftHard;
    const leftTarget = left.item.targetFinishAt ?? left.item.deadlineAt;
    const rightTarget = right.item.targetFinishAt ?? right.item.deadlineAt;
    if (leftTarget && rightTarget && leftTarget !== rightTarget) return leftTarget.localeCompare(rightTarget);
    if (leftTarget) return -1;
    if (rightTarget) return 1;
    const priority = priorityWeight[right.item.priority] - priorityWeight[left.item.priority];
    if (priority) return priority;
    if (left.item.deadlineAt && right.item.deadlineAt) return left.item.deadlineAt.localeCompare(right.item.deadlineAt);
    if (left.item.deadlineAt) return -1;
    if (right.item.deadlineAt) return 1;
    return left.item.id.localeCompare(right.item.id);
  });
}

function scoreCandidate(
  item: PlannerItem,
  profile: PlannerProfile,
  date: string,
  startMinute: number,
  startAt: number,
  horizonStart: number,
  energyShiftMinutes = 0
): number {
  let score = priorityWeight[item.priority] - (startAt - horizonStart) / 3_600_000;
  if (energyAt(profile, startMinute - energyShiftMinutes) === item.energy) score += 80;
  if (item.preferredWindows.some((window) => windowContainsMinute(window, startMinute))) score += 120;
  if (item.uncertaintyPolicy.date.mode === "preferred" && item.uncertaintyPolicy.date.preferredDate === date) score += 180;
  if (item.uncertaintyPolicy.time.mode === "preferred" && item.uncertaintyPolicy.time.preferredStart) {
    const distance = Math.abs(startMinute - plannerTimeToMinutes(item.uncertaintyPolicy.time.preferredStart));
    score += Math.max(0, 140 - distance);
  }
  const effectiveDeadline = item.targetFinishAt ?? item.deadlineAt;
  if (effectiveDeadline) {
    const slackHours = (new Date(effectiveDeadline).getTime() - startAt) / 3_600_000;
    score += slackHours >= 0 ? Math.max(0, 160 - slackHours) : -10_000;
  }
  if (item.earliestAt && startAt < new Date(item.earliestAt).getTime()) score -= 10_000;
  score -= Number(date.replaceAll("-", "")) / 100_000_000;
  return score;
}

function findPlacement(
  request: PlacementRequest,
  durationMinutes: number,
  profile: PlannerProfile,
  occupied: PlannerBlock[],
  startDate: string,
  endDate: string,
  nowMs: number,
  autoMinutesByDate: Map<string, number>,
  itemById: Map<string, PlannerItem>,
  energyShiftByDate: Map<string, number>,
  chain?: { startAt: string; previousBlockId: string; gapMinutes: number }
): { startAt: string; endAt: string; date: string } | null {
  let best: { startAt: string; endAt: string; date: string; score: number } | null = null;
  const horizonStartMs = new Date(zonedPlannerDateTimeToUtc(startDate, "00:00", profile.timezone)).getTime();
  const earliestFeasibleDateWins = !request.item.earliestAt
    && !request.item.deadlineAt
    && request.item.preferredWindows.length === 0
    && request.item.uncertaintyPolicy.date.mode === "any"
    && request.item.uncertaintyPolicy.time.mode === "any"
    && profile.energyWindows.length === 0;
  for (let date = startDate; date <= endDate; date = addPlannerDays(date, 1)) {
    if (request.targetDate && date !== request.targetDate) continue;
    if (request.allowedDates && !request.allowedDates.includes(date)) continue;
    let foundOnDate = false;
    const windows = availabilityForDate(profile, date);
    const totalAvailable = windows.reduce((sum, window) => sum + durationForLocalRange(window.start, window.end), 0);
    const fixedMinutes = occupied
      .filter((block) => block.fixed && !block.soft && !["cancelled", "skipped"].includes(block.status))
      .reduce((sum, block) => {
        const bodyMinutes = windows.reduce(
          (windowSum, window) => windowSum + blockMinutesInsideWindow(block, date, window, profile.timezone),
          0
        );
        if (!bodyMinutes) return sum;
        const blockItem = block.itemId ? itemById.get(block.itemId) : undefined;
        return sum + bodyMinutes + plannerBufferBefore(blockItem) + plannerBufferAfter(blockItem);
      }, 0);
    const capacity = Math.floor(Math.max(0, totalAvailable - fixedMinutes) * (1 - profile.reserveRatio));
    if (request.tier !== "reserve" && (autoMinutesByDate.get(date) ?? 0) + placementFootprintMinutes(request.item, durationMinutes) > capacity) continue;
    for (const window of windows) {
      const windowStart = plannerTimeToMinutes(window.start);
      let windowEnd = plannerTimeToMinutes(window.end);
      if (windowEnd <= windowStart) windowEnd += 1440;
      for (let minute = Math.ceil(windowStart / STEP_MINUTES) * STEP_MINUTES; minute + durationMinutes <= windowEnd; minute += STEP_MINUTES) {
        const localDate = minute >= 1440 ? addPlannerDays(date, 1) : date;
        const localMinute = minute % 1440;
        const timePolicy = request.item.uncertaintyPolicy.time;
        if (timePolicy.mode === "exact" && timePolicy.exactStart
          && localMinute !== plannerTimeToMinutes(timePolicy.exactStart)) continue;
        if (timePolicy.mode === "range" && timePolicy.earliestStart && timePolicy.latestEnd
          && !rangeInsideWindow(
            { start: timePolicy.earliestStart, end: timePolicy.latestEnd },
            localMinute,
            localMinute + durationMinutes
          )) continue;
        if (request.item.allowedWindows.length > 0
          && !request.item.allowedWindows.some((candidate) => rangeInsideWindow(candidate, localMinute, localMinute + durationMinutes))) continue;
        if (minute - plannerBufferBefore(request.item) < windowStart
          || minute + durationMinutes + plannerBufferAfter(request.item) > windowEnd) continue;
        if (request.item.avoidedWindows.some((candidate) => windowOverlapsRange(candidate, localMinute, localMinute + durationMinutes))) continue;
        const startAt = zonedPlannerDateTimeToUtc(
          localDate,
          `${String(Math.floor(localMinute / 60)).padStart(2, "0")}:${String(localMinute % 60).padStart(2, "0")}`,
          profile.timezone
        );
        const endAt = addIsoMinutes(startAt, durationMinutes);
        if (request.item.deadlineType === "hard" && request.item.deadlineAt
          && new Date(endAt).getTime() > new Date(request.item.deadlineAt).getTime()) continue;
        const candidate = { start: new Date(startAt).getTime(), end: new Date(endAt).getTime() };
        if (candidate.start - plannerBufferBefore(request.item) * 60_000 < nowMs) continue;
        if (request.item.earliestAt && candidate.start < new Date(request.item.earliestAt).getTime()) continue;
        if (occupied.some((block) => {
          if (block.status === "cancelled" || block.status === "skipped" || block.soft) return false;
          const interval = blockInterval(block);
          const occupiedItem = block.itemId ? itemById.get(block.itemId) : undefined;
          const occupiedBefore = plannerBufferBefore(occupiedItem);
          const occupiedAfter = plannerBufferAfter(occupiedItem);
          if (candidate.end <= interval.start) {
            return candidate.end + requiredPlannerGap(
              profile.defaultBufferMinutes,
              plannerBufferAfter(request.item),
              occupiedBefore
            ) * 60_000 > interval.start;
          }
          if (candidate.start >= interval.end) {
            if (chain?.previousBlockId === block.id) {
              return candidate.start - chain.gapMinutes * 60_000 < interval.end;
            }
            return candidate.start - requiredPlannerGap(
              profile.defaultBufferMinutes,
              occupiedAfter,
              plannerBufferBefore(request.item)
            ) * 60_000 < interval.end;
          }
          return true;
        })) continue;
        let score = scoreCandidate(
          request.item,
          profile,
          date,
          localMinute,
          candidate.start,
          horizonStartMs,
          energyShiftByDate.get(date) ?? 0
        );
        if (chain) {
          const distance = Math.abs(candidate.start - new Date(chain.startAt).getTime()) / 60_000;
          score += distance === 0 ? 50_000 : Math.max(0, 5_000 - distance * 20);
        }
        if (!best || score > best.score) best = { startAt, endAt, date, score };
        foundOnDate = true;
      }
    }
    if (foundOnDate && earliestFeasibleDateWins) return best;
  }
  return best;
}

function safeChunkDurations(item: PlannerItem, remaining: number): number[] {
  if (!item.canSplit || remaining <= item.minChunkMinutes) return [remaining];
  const candidates = new Set<number>([remaining]);
  const firstStepped = Math.floor((remaining - 1) / STEP_MINUTES) * STEP_MINUTES;
  for (let duration = firstStepped; duration >= item.minChunkMinutes; duration -= STEP_MINUTES) {
    const rest = remaining - duration;
    if (rest === 0 || rest >= item.minChunkMinutes) candidates.add(duration);
  }
  return [...candidates].sort((left, right) => right - left);
}

function findAttachedReservePlacement(
  request: PlacementRequest,
  durationMinutes: number,
  profile: PlannerProfile,
  occupied: PlannerBlock[],
  nowMs: number,
  itemById: Map<string, PlannerItem>
): { startAt: string; endAt: string; date: string } | null {
  const baseOccurrenceKey = request.occurrenceKey.endsWith(":reserve")
    ? request.occurrenceKey.slice(0, -":reserve".length)
    : request.occurrenceKey;
  const anchor = occupied
    .filter((block) => block.itemId === request.item.id
      && !block.soft
      && block.status === "planned"
      && (block.occurrenceKey === baseOccurrenceKey
        || block.occurrenceKey?.startsWith(`${baseOccurrenceKey}:minimum`)
        || block.occurrenceKey?.startsWith(`${baseOccurrenceKey}:likely`)))
    .sort((left, right) => right.endAt.localeCompare(left.endAt))[0];
  if (!anchor) return null;
  const date = formatDateInTimeZone(new Date(anchor.startAt), profile.timezone);
  if (request.targetDate && request.targetDate !== date) return null;
  if (request.allowedDates && !request.allowedDates.includes(date)) return null;
  const startAt = anchor.endAt;
  const endAt = addIsoMinutes(startAt, durationMinutes);
  if (new Date(startAt).getTime() < nowMs) return null;
  if (request.item.deadlineType === "hard" && request.item.deadlineAt && new Date(endAt) > new Date(request.item.deadlineAt)) return null;
  const startMinute = plannerTimeToMinutes(formatTimeInTimeZone(new Date(startAt), profile.timezone));
  const endMinute = startMinute + durationMinutes;
  if (!availabilityForDate(profile, date).some((window) => {
    const windowStart = plannerTimeToMinutes(window.start);
    let windowEnd = plannerTimeToMinutes(window.end);
    if (windowEnd <= windowStart) windowEnd += 1440;
    return startMinute >= windowStart && endMinute + plannerBufferAfter(request.item) <= windowEnd;
  })) return null;
  const candidate = { start: new Date(startAt).getTime(), end: new Date(endAt).getTime() };
  const blocked = occupied.some((block) => {
    if (block.id === anchor.id || block.soft || ["cancelled", "skipped"].includes(block.status)) return false;
    const interval = blockInterval(block);
    const occupiedItem = block.itemId ? itemById.get(block.itemId) : undefined;
    if (candidate.end <= interval.start) {
      return candidate.end + requiredPlannerGap(
        profile.defaultBufferMinutes,
        plannerBufferAfter(request.item),
        plannerBufferBefore(occupiedItem)
      ) * 60_000 > interval.start;
    }
    if (candidate.start >= interval.end) {
      return candidate.start - requiredPlannerGap(
        profile.defaultBufferMinutes,
        plannerBufferAfter(occupiedItem),
        plannerBufferBefore(request.item)
      ) * 60_000 < interval.end;
    }
    return true;
  });
  return blocked ? null : { startAt, endAt, date };
}

function nextDeadlineChainItem(item: PlannerItem, items: PlannerItem[]): PlannerItem | undefined {
  if (item.deadlinePolicy.chainMode === "off") return undefined;
  if (item.deadlinePolicy.chainMode === "pinned") {
    return items.find((candidate) => candidate.id === item.deadlinePolicy.nextItemId && candidate.status === "active");
  }
  return items.filter((candidate) => candidate.id !== item.id && candidate.status === "active" && candidate.kind !== "fixed_event")
    .sort((left, right) => Number(right.deadlineType === "hard") - Number(left.deadlineType === "hard")
      || (left.deadlineAt ?? "9999").localeCompare(right.deadlineAt ?? "9999")
      || priorityWeight[right.priority] - priorityWeight[left.priority]
      || Number(right.area === item.area) - Number(left.area === item.area)
      || Number(right.energy === item.energy) - Number(left.energy === item.energy)
      || left.id.localeCompare(right.id))[0];
}

function blockFromDraft(draft: PlannerDraft, item: PlannerItem, profile: PlannerProfile): PlannerBlock | null {
  if (item.kind !== "fixed_event" || !draft.date || !draft.start) return null;
  const startAt = zonedPlannerDateTimeToUtc(draft.date, draft.start, profile.timezone);
  const endAt = draft.end
    ? zonedPlannerDateTimeToUtc(
        plannerTimeToMinutes(draft.end) <= plannerTimeToMinutes(draft.start)
          ? addPlannerDays(draft.date, 1)
          : draft.date,
        draft.end,
        profile.timezone
      )
    : addIsoMinutes(startAt, item.estimateMinutes);
  return {
    id: uniqueId("block", item.id, startAt),
    itemId: item.id,
    title: item.title,
    startAt,
    endAt,
    status: "planned",
    source: "manual",
    fixed: true,
    tentative: draft.endEstimate?.mode === "unknown" || undefined,
    occurrenceKey: item.id,
    endEstimate: draft.endEstimate,
  };
}

function recurringFixedBlocks(
  item: PlannerItem,
  profile: PlannerProfile,
  startDate: string,
  endDate: string
): PlannerBlock[] {
  if (item.kind !== "fixed_event" || !item.recurrence?.startTime) return [];
  return getRoutineDates(item, startDate, endDate)
    .filter((date) => !item.recurrence?.startDate || date >= item.recurrence.startDate)
    .map((date) => {
      const startAt = zonedPlannerDateTimeToUtc(date, item.recurrence!.startTime!, profile.timezone);
      const endTime = item.recurrence?.endTime;
      const endDateForOccurrence = endTime && plannerTimeToMinutes(endTime) <= plannerTimeToMinutes(item.recurrence!.startTime!)
        ? addPlannerDays(date, 1)
        : date;
      const endAt = endTime
        ? zonedPlannerDateTimeToUtc(endDateForOccurrence, endTime, profile.timezone)
        : addIsoMinutes(startAt, item.estimateMinutes);
      return {
        id: uniqueId("block", item.id, date),
        itemId: item.id,
        title: item.title,
        startAt,
        endAt,
        status: "planned" as const,
        source: "auto" as const,
        fixed: true,
        occurrenceKey: `${item.id}:${date}`,
      };
    });
}

function prepareConstructorInput(input: PlannerEngineInput): PlannerEngineInput {
  const operation = input.operation;
  if (!operation) return input;
  if ("target" in operation && operation.target) {
    const targetItem = input.items.find((item) => item.id === operation.target!.itemId);
    if (!targetItem) throw new Error("Выбранное дело больше не найдено. Обновите план.");
    if (operation.target.blockId) {
      const targetBlock = input.blocks.find((block) => block.id === operation.target!.blockId);
      if (!targetBlock
        || targetBlock.itemId !== operation.target.itemId
        || operation.target.occurrenceKey !== undefined && targetBlock.occurrenceKey !== operation.target.occurrenceKey) {
        throw new Error("Выбранное выполнение изменилось или устарело. Обновите план и откройте его снова.");
      }
    }
    if ("blockId" in operation && operation.blockId && operation.target.blockId !== operation.blockId) {
      throw new Error("Идентификатор выбранного выполнения не совпадает с операцией. Обновите план.");
    }
    if ("itemId" in operation && operation.itemId && operation.target.itemId !== operation.itemId) {
      throw new Error("Идентификатор выбранного дела не совпадает с операцией. Обновите план.");
    }
    if (operation.kind === "edit_item" && operation.draft.id && operation.target.itemId !== operation.draft.id) {
      throw new Error("Изменяемое дело не совпадает с выбранным контекстом. Обновите план.");
    }
  }
  const base: PlannerEngineInput = { ...input, trigger: "constructor" };

  if (operation.kind === "add_item") {
    return { ...base, draft: operation.draft, rebuildFuture: true };
  }
  if (operation.kind === "schedule_item") {
    const selected = operation.target.blockId
      ? input.blocks.find((block) => block.id === operation.target.blockId)
      : undefined;
    return {
      ...base,
      targetItemIds: [operation.target.itemId],
      targetOccurrenceKey: operation.scope === "occurrence"
        ? operation.target.occurrenceKey?.replace(/:(?:minimum|likely|reserve)(?::.*)?$/, "")
        : undefined,
      targetFromDate: operation.scope === "future" && selected
        ? formatDateInTimeZone(new Date(selected.startAt), input.profile.timezone)
        : undefined,
    };
  }
  if (operation.kind === "edit_item") {
    if (operation.scope === "occurrence" && operation.blockId) return base;
    const selected = operation.blockId ? input.blocks.find((block) => block.id === operation.blockId) : undefined;
    return { ...base, draft: operation.draft, rebuildFuture: true, rebuildFromAt: selected?.startAt };
  }
  if (operation.kind === "bulk_update_items") {
    return {
      ...base,
      drafts: operation.drafts,
      removedItemIds: operation.archiveItemIds,
      rebuildFuture: true,
    };
  }
  if (operation.kind === "occupy_interval") {
    return { ...base, draft: { ...operation.draft, kind: "fixed_event" }, rebuildFuture: true };
  }
  if (operation.kind === "change_item_duration") {
    const item = input.items.find((candidate) => candidate.id === operation.itemId);
    if (!item) throw new Error("Дело для изменения длительности не найдено.");
    if (operation.scope === "occurrence" && operation.blockId) return base;
    const selected = operation.blockId ? input.blocks.find((block) => block.id === operation.blockId) : undefined;
    return {
      ...base,
      draft: {
        ...item,
        estimateMinutes: operation.duration.likelyMinutes,
        uncertaintyPolicy: {
          ...item.uncertaintyPolicy,
          duration: operation.duration,
          reduction: operation.reduction ?? item.uncertaintyPolicy.reduction,
        },
      },
      rebuildFuture: true,
      rebuildFromAt: selected?.startAt,
    };
  }
  if (operation.kind === "set_day_bounds") {
    return {
      ...base,
      profilePatch: {
        ...input.profilePatch,
        availabilityOverrides: {
          ...input.profile.availabilityOverrides,
          [operation.date]: [{ start: operation.start, end: operation.end }],
        },
      },
      rebuildFuture: true,
      rebuildFromAt: zonedPlannerDateTimeToUtc(operation.date, operation.start, input.profile.timezone),
    };
  }
  if (operation.kind === "set_sleep_boundary") {
    const now = input.now ?? new Date();
    let wakeDate = operation.date;
    let plannedStartAt: string;
    let plannedEndAt: string;
    if (operation.boundary === "bedtime") {
      plannedStartAt = zonedPlannerDateTimeToUtc(operation.date, operation.time, input.profile.timezone);
      if (new Date(plannedStartAt).getTime() <= now.getTime()) {
        throw new Error("Прошедшую границу сна нельзя изменить; выберите будущую ночь.");
      }
      wakeDate = addPlannerDays(formatDateInTimeZone(new Date(plannedStartAt), input.profile.timezone), 1);
      const duration = sleepRuleForWakeDate(input.profile.sleepSchedule, wakeDate).durationMinutes;
      plannedEndAt = addIsoMinutes(plannedStartAt, duration);
    } else {
      plannedEndAt = zonedPlannerDateTimeToUtc(operation.date, operation.time, input.profile.timezone);
      if (new Date(plannedEndAt).getTime() <= now.getTime()) {
        throw new Error("Прошедшую границу подъёма нельзя изменить; выберите будущую ночь.");
      }
      const duration = sleepRuleForWakeDate(input.profile.sleepSchedule, wakeDate).durationMinutes;
      plannedStartAt = addIsoMinutes(plannedEndAt, -duration);
    }
    return {
      ...base,
      sleepEvent: {
        wakeDate,
        eventKind: "planned_adjustment",
        state: "planned",
        plannedStartAt,
        plannedEndAt,
        plannedDurationMinutes: isoDurationMinutes(plannedStartAt, plannedEndAt),
        selectionReason: "manual",
      },
      rebuildFuture: true,
      rebuildFromAt: plannedStartAt,
    };
  }
  if (operation.kind === "cancel_item" && operation.scope === "item" && operation.itemId) {
    return { ...base, removedItemIds: [operation.itemId], rebuildFuture: true };
  }
  if (operation.kind === "rebuild_remaining") {
    const decisions = new Map(operation.decisions.map((decision) => [decision.itemId, decision.disposition]));
    const items = input.items.map((item) => {
      const disposition = decisions.get(item.id);
      if (!disposition || disposition === "cancel") return item;
      return normalizePlannerItem({
        ...item,
        commitmentLevel: disposition === "required" ? "must_not_skip" : disposition,
      });
    });
    const withBedtime = operation.bedtime
      ? prepareConstructorInput({
          ...base,
          items,
          operation: { kind: "set_sleep_boundary", boundary: "bedtime", ...operation.bedtime },
        })
      : { ...base, items };
    return { ...withBedtime, operation, rebuildFuture: true, rebuildFromAt: operation.fromAt };
  }
  return base;
}

function buildPlannerProposalResolved(input: PlannerEngineInput): PlannerProposal {
  const now = input.now ?? new Date();
  const requestedRebuildAt = input.rebuildFromAt ? new Date(input.rebuildFromAt) : now;
  const rebuildAt = Number.isFinite(requestedRebuildAt.getTime()) && requestedRebuildAt > now
    ? requestedRebuildAt
    : now;
  const trigger = input.trigger ?? (input.draft || input.drafts?.length ? "quick_add" : "autoplan");
  const baseProfile = normalizePlannerProfile(input.profile);
  const requestedProfilePatch = input.profilePatch && trigger === "assistant_setup"
    ? {
        ...input.profilePatch,
        planningPolicy: {
          ...baseProfile.planningPolicy,
          ...input.profilePatch.planningPolicy,
          effectiveFromAt: now.toISOString(),
        },
      }
    : input.profilePatch;
  const storedProfile = normalizePlannerProfile({
    ...baseProfile,
    ...(requestedProfilePatch ?? {}),
    revision: baseProfile.revision,
  });
  const profile = input.calculationProfile
    ? normalizePlannerProfile({
        ...input.calculationProfile,
        planningPolicy: storedProfile.planningPolicy,
        revision: baseProfile.revision,
      })
    : storedProfile;
  const effectiveFocus = input.planningFocusOverride ?? storedProfile.planningPolicy.focus;
  if (storedProfile.sleepSchedule.mode === "adaptive" && storedProfile.sleepSchedule.requiresHealthyMinimumConfirmation) {
    throw new Error("Подтвердите пробную цель 7 часов или выберите ручной фиксированный режим.");
  }
  const startDate = formatDateInTimeZone(now, profile.timezone);
  const endDate = addPlannerDays(startDate, horizonDays(profile.horizon) - 1);
  const normalizedDrafts = input.drafts?.length
    ? input.drafts
    : input.draft
      ? [input.draft]
      : [];
  const normalizedDraft = normalizedDrafts.length === 1 ? normalizedDrafts[0] : undefined;
  const changes: PlannerProposalChange[] = [];
  const conflicts: PlannerConflict[] = [];
  const unplaced: PlannerUnplaced[] = [];
  const items = input.items.map((item) => normalizePlannerItem(item));
  const movableBlocks = new Map<string, PlannerBlock>();
  let workingBlocks = [...input.blocks];
  let carryMissedBlockId: string | undefined;

  for (const [index, message] of validateAdaptiveSleepSchedule(storedProfile.sleepSchedule).entries()) {
    conflicts.push({
      id: uniqueId("sleep-settings", index, message),
      kind: "fixed_overlap",
      title: "Настройки сна противоречат друг другу",
      message,
      blockIds: [],
    });
  }

  if (requestedProfilePatch) {
    changes.push({
      id: uniqueId("change-profile", baseProfile.revision, trigger),
      kind: "update_profile",
      profile: storedProfile,
      reason: "Настройки подтверждены в автопланировщике.",
    });
  }

  const sleepEvents = [...(input.sleepEvents ?? [])];
  let normalizedSleepEvent: PlannerSleepEvent | undefined;
  if (input.sleepEvent) {
    const eventChange = normalizePlannerSleepEvent(input.sleepEvent);
    normalizedSleepEvent = eventChange;
    const index = sleepEvents.findIndex((event) => event.wakeDate === eventChange.wakeDate);
    if (index >= 0) sleepEvents[index] = eventChange;
    else sleepEvents.push(eventChange);
    changes.push({
      id: uniqueId("change-sleep", eventChange.wakeDate),
      kind: "upsert_sleep_event",
      event: eventChange,
      reason: eventChange.state === "tentative"
        ? "Сохранена предварительная оценка этой ночи; постоянный режим не меняется."
        : "Фактический сон учтён; обычный режим следующих ночей не меняется.",
    });
  }

  if (input.sleepEvent?.state === "tentative" && !input.sleepEvent.actualStartAt) {
    return {
      baseRevision: baseProfile.revision,
      trigger,
      operation: input.operation,
      normalizedDraft,
      normalizedDrafts: normalizedDrafts.length > 1 ? normalizedDrafts : undefined,
      removedItemIds: input.removedItemIds,
      blockExtension: input.blockExtension,
      missedOccurrence: input.missedOccurrence,
      changes,
      conflicts,
      unplaced,
      effectiveFocus,
      effectiveFromAt: storedProfile.planningPolicy.effectiveFromAt ?? now.toISOString(),
      horizonStart: startDate,
      horizonEnd: endDate,
    };
  }

  const durationBounds = sleepDurationBounds(profile.sleepSchedule);
  const calculatedSleepBlocks = buildPlannerSleepBlocks(profile, sleepEvents, startDate, endDate, now).map((block) => ({
    ...block,
    selectionReason: input.calculatedSleepReason && block.selectionReason === "preference"
      ? input.calculatedSleepReason
      : block.selectionReason,
    borrowedMinutes: (input.calculatedSleepReason === "hard_deadline" || block.selectionReason === "hard_deadline")
      ? Math.max(block.borrowedMinutes, durationBounds.minMinutes - block.selectedDurationMinutes)
      : block.borrowedMinutes,
  }));
  const energyShiftByDate = new Map(calculatedSleepBlocks.map((block) => [
    block.wakeDate,
    Math.round((new Date(block.endAt).getTime() - new Date(block.plannedEndAt).getTime()) / 60_000),
  ]));
  const sleepBlocks = calculatedSleepBlocks.map<PlannerBlock>((block) => ({
    id: block.id,
    title: block.title,
    startAt: block.startAt,
    endAt: block.endAt,
    status: block.actualEndAt ? "done" : "planned",
    source: "auto",
    fixed: true,
    occurrenceKey: block.wakeDate,
    actualStartAt: block.actualStartAt,
    actualEndAt: block.actualEndAt,
  }));
  const recoveryAdvice = normalizedSleepEvent
    ? buildSleepRecoveryAdvice(profile, normalizedSleepEvent, [...workingBlocks, ...sleepBlocks])
    : undefined;

  if (input.persistCalculatedSleep) {
    for (const block of calculatedSleepBlocks) {
      if (new Date(block.startAt).getTime() < now.getTime() || block.actualStartAt || block.actualEndAt) continue;
      const existing = sleepEvents.find((event) => event.wakeDate === block.wakeDate);
      if (existing && existing.state !== "planned") continue;
      const event = normalizePlannerSleepEvent({
        ...existing,
        wakeDate: block.wakeDate,
        eventKind: "planned_adjustment",
        state: "planned",
        plannedStartAt: block.startAt,
        plannedEndAt: block.endAt,
        plannedDurationMinutes: block.selectedDurationMinutes,
        selectionReason: block.selectionReason,
        borrowedMinutes: block.borrowedMinutes,
        recoveryNight: block.recoveryNight,
        transitionNight: block.transitionNight,
      });
      changes.push({
        id: uniqueId("planned-sleep", block.wakeDate, block.selectedDurationMinutes),
        kind: "upsert_sleep_event",
        event,
        reason: block.borrowedMinutes > 0
          ? "Сон сокращён только ради жёсткого срока; восстановление включено в предпросмотр."
          : block.selectionReason === "workload"
            ? "Выбран более короткий допустимый вариант сна, потому что он реально улучшает план."
            : "Выбранная длительность этой ночи зафиксирована в подтверждаемом плане.",
      });
    }
  }

  if (input.missedOccurrence) {
    const missed = workingBlocks.find((block) => block.id === input.missedOccurrence!.blockId);
    if (!missed || missed.fixed && !missed.itemId || ["done", "skipped", "cancelled"].includes(missed.status)) {
      throw new Error("Пропускаемое дело не найдено или уже завершено.");
    }
    const actualEndAt = now.toISOString();
    workingBlocks = workingBlocks.map((block) => block.id === missed.id
      ? { ...block, status: "skipped", actualEndAt }
      : block);
    changes.push({
      id: uniqueId("skip", missed.id, input.missedOccurrence.disposition),
      kind: "update_block_status",
      blockId: missed.id,
      title: missed.title,
      status: "skipped",
      actualStartAt: missed.actualStartAt,
      actualEndAt,
      reason: input.missedOccurrence.disposition === "cancel_occurrence"
        ? "Отменено только это выполнение; оно не создаёт долг и не появится повторно."
        : input.missedOccurrence.disposition === "reestimate_total"
          ? "Выполнение пропущено, а общий оставшийся объём уточнён перед пересборкой."
          : "Выполнение пропущено; оставшаяся работа возвращена в будущий план.",
    });
    const missedMinutes = Math.max(1, isoDurationMinutes(missed.startAt, missed.endAt));
    changes.push({
      id: uniqueId("archiver-manual-missed", missed.id),
      kind: "upsert_archiver_entry",
      entry: {
        id: `missed:${missed.id}`,
        category: "missed",
        origin: "unacknowledged",
        itemId: missed.itemId,
        sourceBlockId: missed.id,
        occurrenceKey: missed.occurrenceKey,
        title: missed.title,
        reason: "Дело явно отмечено пропущенным; выбранный итог сохранён отдельно.",
        totalMinutes: missedMinutes,
        pendingMinutes: 0,
        scheduledMinutes: input.missedOccurrence.disposition === "cancel_occurrence" ? 0 : missedMinutes,
        occurredAt: missed.endAt,
        createdAt: now.toISOString(),
        resolvedAt: now.toISOString(),
        resolution: input.missedOccurrence.disposition === "cancel_occurrence" ? "cancelled_occurrence" : "scheduled",
        returnedAt: input.missedOccurrence.disposition === "cancel_occurrence" ? undefined : now.toISOString(),
        outcomeNote: input.missedOccurrence.disposition === "cancel_occurrence"
          ? "Пользователь отменил только это выполнение."
          : "Пропущенный объём возвращён в будущий план.",
      },
      reason: "Пропуск и результат его разбора сохранены в Архиваторе дел.",
    });
    carryMissedBlockId = input.missedOccurrence.disposition === "cancel_occurrence" ? undefined : missed.id;
    const itemIndex = missed.itemId ? items.findIndex((item) => item.id === missed.itemId) : -1;
    if (itemIndex >= 0) {
      const currentItem = items[itemIndex];
      let nextItem = currentItem;
      if (input.missedOccurrence.disposition === "cancel_occurrence"
        && currentItem.kind !== "routine"
        && (!currentItem.recurrence || currentItem.recurrence.frequency === "once")) {
        nextItem = { ...currentItem, status: "completed" };
      }
      if (input.missedOccurrence.disposition === "reestimate_total") {
        const revised = Math.round(Number(input.missedOccurrence.revisedRemainingMinutes));
        if (!Number.isFinite(revised) || revised < 5) throw new Error("Укажите новый оставшийся объём работы.");
        nextItem = normalizePlannerItem({
          ...currentItem,
          estimateMinutes: revised,
          uncertaintyPolicy: {
            ...currentItem.uncertaintyPolicy,
            duration: {
              ...currentItem.uncertaintyPolicy.duration,
              mode: "exact",
              minMinutes: revised,
              likelyMinutes: revised,
              maxMinutes: revised,
              source: "user",
            },
          },
        });
      }
      if (input.missedOccurrence.rememberPolicy) {
        nextItem = {
          ...nextItem,
          uncertaintyPolicy: {
            ...nextItem.uncertaintyPolicy,
            missedOccurrencePolicy: input.missedOccurrence.disposition,
          },
        };
      }
      if (nextItem !== currentItem) {
        items[itemIndex] = nextItem;
        changes.push({
          id: uniqueId("missed-policy", nextItem.id, input.missedOccurrence.disposition),
          kind: "update_item",
          item: nextItem,
          reason: input.missedOccurrence.rememberPolicy
            ? "Выбранное действие сохранено как правило этого дела."
            : "Общий оставшийся объём дела обновлён.",
        });
      }
    }
  }

  for (const itemId of [...new Set(input.removedItemIds ?? [])]) {
    const itemIndex = items.findIndex((item) => item.id === itemId && item.status === "active");
    if (itemIndex < 0) continue;
    const archivedItem: PlannerItem = { ...items[itemIndex], status: "archived", unplacedReason: undefined };
    items[itemIndex] = archivedItem;
    changes.push({
      id: uniqueId("archive-item", itemId),
      kind: "update_item",
      item: archivedItem,
      reason: "Дело удалено из общего списка; выполненная история сохранена.",
    });
    const futureBlocks = workingBlocks.filter((block) => block.itemId === itemId
      && block.status === "planned"
      && new Date(block.startAt).getTime() >= now.getTime());
    const futureIds = new Set(futureBlocks.map((block) => block.id));
    workingBlocks = workingBlocks.filter((block) => !futureIds.has(block.id));
    for (const block of futureBlocks) {
      changes.push({
        id: uniqueId("remove-archived", block.id),
        kind: "remove_block",
        blockId: block.id,
        title: block.title,
        reason: "Будущее выполнение удалено вместе с делом; прошлое и выполненное не изменяются.",
      });
    }
  }

  if (input.rebuildFuture) {
    const explicitlyCancelledItemIds = input.operation?.kind === "rebuild_remaining"
      ? new Set(input.operation.decisions.filter((decision) => decision.disposition === "cancel").map((decision) => decision.itemId))
      : new Set<string>();
    const rebuilding = workingBlocks.filter((block) =>
      !block.fixed
      && block.status === "planned"
      && new Date(block.startAt).getTime() >= rebuildAt.getTime()
      && (!block.itemId || !explicitlyCancelledItemIds.has(block.itemId))
    );
    const rebuildingIds = new Set(rebuilding.map((block) => block.id));
    workingBlocks = workingBlocks.filter((block) => !rebuildingIds.has(block.id));
    for (const block of rebuilding) {
      changes.push({
        id: uniqueId("remove-rebuild", block.id),
        kind: "remove_block",
        blockId: block.id,
        title: block.title,
        reason: "Будущий гибкий блок освобождён для безопасной пересборки плана.",
      });
    }
  }

  const considerFixedBlock = (fixedBlock: PlannerBlock, reason: string) => {
    const fixedItem = fixedBlock.itemId ? items.find((item) => item.id === fixedBlock.itemId) : undefined;
    const rawIncoming = blockInterval(fixedBlock);
    const incoming = {
      start: rawIncoming.start - plannerBufferBefore(fixedItem) * 60_000,
      end: rawIncoming.end + plannerBufferAfter(fixedItem) * 60_000,
    };
    for (const block of [...workingBlocks, ...sleepBlocks]) {
      const occupiedItem = block.itemId ? items.find((item) => item.id === block.itemId) : undefined;
      const rawOccupied = blockInterval(block);
      const occupied = {
        start: rawOccupied.start - plannerBufferBefore(occupiedItem) * 60_000,
        end: rawOccupied.end + plannerBufferAfter(occupiedItem) * 60_000,
      };
      if (block.id === fixedBlock.id || block.status === "cancelled" || block.status === "skipped" || block.soft || !rangesOverlap(incoming, occupied)) continue;
      if (block.status === "in_progress") {
        conflicts.push({
          id: uniqueId("conflict-active", block.id, fixedBlock.id),
          kind: "active_overlap",
          title: block.title,
          message: "Новое защищённое время пересекается с уже начатым делом. Выберите: пауза, закончить сначала или изменить время.",
          blockIds: [block.id, fixedBlock.id],
        });
      } else if (block.fixed || block.status === "done" || new Date(block.startAt).getTime() < now.getTime()) {
        conflicts.push({
          id: uniqueId("conflict-fixed", block.id, fixedBlock.id),
          kind: "fixed_overlap",
          title: block.title,
          message: block.id.startsWith("sleep-")
            ? "Фиксированное событие пересекается с защищённым сном. Измените событие или данные сна."
            : "Два фиксированных события пересекаются. Автоматический перенос запрещён.",
          blockIds: [block.id, fixedBlock.id],
        });
      } else {
        movableBlocks.set(block.id, block);
      }
    }
    changes.push({ id: uniqueId("change-block", fixedBlock.id), kind: "add_block", block: fixedBlock, reason });
    workingBlocks = workingBlocks.filter((block) => !movableBlocks.has(block.id));
    workingBlocks.push(fixedBlock);
  };

  const cancelConstructorBlock = (block: PlannerBlock, reason: string) => {
    if (["done", "skipped", "cancelled"].includes(block.status)) {
      throw new Error("Завершённое, пропущенное или отменённое выполнение нельзя изменить.");
    }
    const actualEndAt = block.status === "in_progress" ? now.toISOString() : block.actualEndAt;
    workingBlocks = workingBlocks.map((candidate) => candidate.id === block.id
      ? { ...candidate, status: "cancelled", actualEndAt }
      : candidate);
    changes.push({
      id: uniqueId("constructor-cancel", block.id),
      kind: "update_block_status",
      blockId: block.id,
      title: block.title,
      status: "cancelled",
      actualStartAt: block.actualStartAt,
      actualEndAt,
      reason,
    });
  };

  const relocateConstructorBlock = (original: PlannerBlock, startAt: string, endAt: string, reason: string): PlannerBlock => {
    if (["done", "skipped", "cancelled"].includes(original.status)) {
      throw new Error("Прошедшее или завершённое выполнение нельзя изменить.");
    }
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw new Error("Укажите корректные начало и окончание дела.");
    }
    if (end <= now && original.status !== "in_progress") throw new Error("Прошедшее выполнение нельзя переносить.");
    const relocated = { ...original, startAt: start.toISOString(), endAt: end.toISOString(), source: "manual" as const };
    for (const block of [...workingBlocks, ...sleepBlocks]) {
      if (block.id === original.id || block.soft || ["cancelled", "skipped"].includes(block.status)
        || !rangesOverlap(blockInterval(relocated), blockInterval(block))) continue;
      if (block.fixed || block.status === "done" || block.status === "in_progress" || new Date(block.startAt) < now) {
        conflicts.push({
          id: uniqueId("constructor-move-conflict", original.id, block.id),
          kind: block.status === "in_progress" ? "active_overlap" : "fixed_overlap",
          title: original.title,
          message: block.id.startsWith("sleep-")
            ? "Выбранное время пересекается с защищённым сном."
            : `Выбранное время пересекается с защищённым делом «${block.title}».`,
          blockIds: [original.id, block.id],
        });
      } else {
        movableBlocks.set(block.id, block);
      }
    }
    workingBlocks = workingBlocks.filter((block) => block.id !== original.id && !movableBlocks.has(block.id));
    workingBlocks.push(relocated);
    changes.push({
      id: uniqueId("constructor-move", original.id, relocated.startAt),
      kind: "move_block",
      blockId: original.id,
      title: original.title,
      fromStartAt: original.startAt,
      fromEndAt: original.endAt,
      toStartAt: relocated.startAt,
      toEndAt: relocated.endAt,
      reason,
    });
    return relocated;
  };

  const constructorOperation = input.operation;
  if (constructorOperation?.kind === "protect_interval") {
    const startAt = zonedPlannerDateTimeToUtc(constructorOperation.date, constructorOperation.start, profile.timezone);
    const endAt = zonedPlannerDateTimeToUtc(
      plannerTimeToMinutes(constructorOperation.end) <= plannerTimeToMinutes(constructorOperation.start)
        ? addPlannerDays(constructorOperation.date, 1)
        : constructorOperation.date,
      constructorOperation.end,
      profile.timezone
    );
    considerFixedBlock({
      id: uniqueId("protected-free", constructorOperation.date, constructorOperation.start, constructorOperation.end),
      title: constructorOperation.title?.trim().slice(0, 160) || "Защищённое свободное время",
      startAt,
      endAt,
      status: "planned",
      source: "manual",
      fixed: true,
      role: "protected_free",
      occurrenceKey: `protected-free:${constructorOperation.date}:${constructorOperation.start}`,
    }, "Интервал явно оставлен свободным и защищён от автопланирования.");
  }

  if (constructorOperation?.kind === "cancel_item" && constructorOperation.scope !== "item") {
    const selected = constructorOperation.blockId
      ? workingBlocks.find((block) => block.id === constructorOperation.blockId)
      : undefined;
    const itemId = constructorOperation.itemId ?? selected?.itemId;
    const targets = constructorOperation.scope === "future" && itemId && selected
      ? workingBlocks.filter((block) => block.itemId === itemId && block.status === "planned" && new Date(block.startAt) >= new Date(selected.startAt))
      : selected ? [selected] : [];
    if (!targets.length) throw new Error("Выполнение для отмены не найдено.");
    targets.forEach((block) => cancelConstructorBlock(block, "Выполнение отменено в конструкторе; прошлая история сохранена."));
    const itemIndex = itemId ? items.findIndex((item) => item.id === itemId) : -1;
    if (itemIndex >= 0 && items[itemIndex].kind !== "routine" && (!items[itemIndex].recurrence || items[itemIndex].recurrence?.frequency === "once")) {
      items[itemIndex] = { ...items[itemIndex], status: "completed" };
      changes.push({
        id: uniqueId("constructor-complete", items[itemIndex].id),
        kind: "update_item",
        item: items[itemIndex],
        reason: "Одноразовое дело завершено отменой выбранного выполнения.",
      });
    }
  }

  if (constructorOperation?.kind === "edit_item" && constructorOperation.scope === "occurrence" && constructorOperation.blockId) {
    const original = workingBlocks.find((block) => block.id === constructorOperation.blockId);
    if (!original) throw new Error("Выполнение для изменения не найдено.");
    if (["done", "skipped", "cancelled"].includes(original.status) || new Date(original.endAt) <= now) throw new Error("Прошедшее или завершённое выполнение нельзя изменить.");
    const minutes = Math.max(5, Math.round(constructorOperation.draft.estimateMinutes ?? isoDurationMinutes(original.startAt, original.endAt)));
    const updated: PlannerBlock = {
      ...original,
      title: constructorOperation.draft.title,
      endAt: addIsoMinutes(original.startAt, minutes),
      source: "manual",
      occurrenceOverride: {
        ...original.occurrenceOverride,
        title: constructorOperation.draft.title,
        notes: constructorOperation.draft.notes,
        location: constructorOperation.draft.location,
        priority: constructorOperation.draft.priority,
        commitmentLevel: constructorOperation.draft.commitmentLevel,
        uncertaintyPolicy: constructorOperation.draft.uncertaintyPolicy,
        canSplit: constructorOperation.draft.canSplit,
        minChunkMinutes: constructorOperation.draft.minChunkMinutes,
        bufferBeforeMinutes: constructorOperation.draft.bufferBeforeMinutes,
        bufferAfterMinutes: constructorOperation.draft.bufferAfterMinutes,
      },
    };
    workingBlocks = [...workingBlocks.filter((block) => block.id !== original.id), updated];
    changes.push({ id: uniqueId("constructor-edit-occurrence", original.id), kind: "update_block", block: updated, reason: "Изменено только выбранное выполнение; правило всего дела сохранено." });
  }

  if (constructorOperation?.kind === "change_item_duration" && constructorOperation.scope === "occurrence" && constructorOperation.blockId) {
    const original = workingBlocks.find((block) => block.id === constructorOperation.blockId);
    if (!original) throw new Error("Выполнение для изменения длительности не найдено.");
    if (["done", "skipped", "cancelled"].includes(original.status) || new Date(original.endAt) <= now) throw new Error("Прошедшее или завершённое выполнение нельзя изменить.");
    const sourcePolicy = original.occurrenceOverride?.uncertaintyPolicy
      ?? items.find((item) => item.id === original.itemId)?.uncertaintyPolicy;
    if (!sourcePolicy) throw new Error("Правила выбранного выполнения больше не найдены.");
    const overridden = {
      ...original,
      occurrenceOverride: {
        ...original.occurrenceOverride,
        uncertaintyPolicy: {
          ...sourcePolicy,
          duration: constructorOperation.duration,
          reduction: constructorOperation.reduction,
        },
      },
    };
    const relocated = relocateConstructorBlock(overridden, original.startAt, addIsoMinutes(original.startAt, constructorOperation.duration.likelyMinutes), "Длительность изменена только для выбранного выполнения.");
    changes.push({
      id: uniqueId("constructor-duration-override", original.id),
      kind: "update_block",
      block: relocated,
      reason: "Новая оценка сохранена только у выбранного выполнения; серия не изменилась.",
    });
  }

  if (constructorOperation?.kind === "change_block_time") {
    const original = workingBlocks.find((block) => block.id === constructorOperation.blockId);
    if (!original) throw new Error("Дело для изменения времени не найдено.");
    const targets = !constructorOperation.scope || constructorOperation.scope === "occurrence" || !original.itemId
      ? [original]
      : workingBlocks.filter((block) => block.itemId === original.itemId && block.status === "planned" && new Date(block.startAt) >= new Date(original.startAt));
    const shiftMinutes = (new Date(constructorOperation.startAt).getTime() - new Date(original.startAt).getTime()) / 60_000;
    const durationMinutes = isoDurationMinutes(constructorOperation.startAt, constructorOperation.endAt);
    workingBlocks = workingBlocks.filter((block) => !targets.some((target) => target.id === block.id));
    targets.forEach((target) => {
      const startAt = addIsoMinutes(target.startAt, shiftMinutes);
      relocateConstructorBlock(target, startAt, addIsoMinutes(startAt, durationMinutes), targets.length === 1
        ? "Начало или окончание изменено для выбранного выполнения."
        : "Время выбранного и последующих выполнений изменено вместе.");
    });
  }

  if (constructorOperation?.kind === "move_item") {
    const original = workingBlocks.find((block) => block.id === constructorOperation.blockId);
    if (!original) throw new Error("Дело для переноса не найдено.");
    const duration = isoDurationMinutes(original.startAt, original.endAt);
    const placement = constructorOperation.placement;
    let targetStartAt: string | undefined;
    if (placement.mode === "exact") {
      targetStartAt = zonedPlannerDateTimeToUtc(placement.date, placement.start, profile.timezone);
    } else if (placement.mode === "date") {
      targetStartAt = zonedPlannerDateTimeToUtc(
        placement.date,
        formatTimeInTimeZone(new Date(original.startAt), profile.timezone),
        profile.timezone
      );
    } else if (placement.mode === "before" || placement.mode === "after") {
      const anchor = workingBlocks.find((block) => block.id === placement.anchorBlockId);
      if (!anchor) throw new Error("Опорное дело для переноса не найдено.");
      targetStartAt = placement.mode === "after"
        ? addIsoMinutes(anchor.endAt, placement.gapMinutes ?? profile.defaultBufferMinutes)
        : addIsoMinutes(anchor.startAt, -(duration + (placement.gapMinutes ?? profile.defaultBufferMinutes)));
    } else if (placement.mode === "first_free") {
      const firstDate = placement.date ?? formatDateInTimeZone(now, profile.timezone);
      const lastDate = placement.date ?? endDate;
      const occupied = [...workingBlocks.filter((block) => block.id !== original.id), ...sleepBlocks];
      for (let targetDate = firstDate; targetDate <= lastDate && !targetStartAt; targetDate = addPlannerDays(targetDate, 1)) {
        for (const window of availabilityForDate(profile, targetDate)) {
          const windowMinutes = durationForLocalRange(window.start, window.end);
          for (let offset = 0; offset + duration <= windowMinutes; offset += STEP_MINUTES) {
            const candidate = addIsoMinutes(zonedPlannerDateTimeToUtc(targetDate, window.start, profile.timezone), offset);
            const end = addIsoMinutes(candidate, duration);
            if (new Date(candidate) < now) continue;
            if (plannerSlotAvailable(profile, occupied, new Date(candidate).getTime(), new Date(end).getTime())) {
              targetStartAt = candidate;
              break;
            }
          }
          if (targetStartAt) break;
        }
      }
      if (!targetStartAt) throw new Error("В выбранном периоде нет свободного окна подходящей длительности.");
    }
    if (!targetStartAt) throw new Error("Не удалось определить новое время дела.");
    const sourceItem = original.itemId ? items.find((item) => item.id === original.itemId) : undefined;
    const crossesDate = formatDateInTimeZone(new Date(targetStartAt), profile.timezone)
      !== formatDateInTimeZone(new Date(original.startAt), profile.timezone);
    if (crossesDate && sourceItem?.uncertaintyPolicy.date.mode === "exact") {
      throw new Error("Правила этого дела запрещают перенос на другой день.");
    }
    const targets = constructorOperation.scope === "occurrence" || !original.itemId
      ? [original]
      : workingBlocks.filter((block) => block.itemId === original.itemId
        && block.status === "planned"
        && new Date(block.startAt) >= new Date(original.startAt));
    const shiftMinutes = isoDurationMinutes(original.startAt, targetStartAt);
    if (new Date(targetStartAt) < new Date(original.startAt)) {
      const rawMinutes = (new Date(targetStartAt).getTime() - new Date(original.startAt).getTime()) / 60_000;
      workingBlocks = workingBlocks.filter((block) => !targets.some((target) => target.id === block.id));
      targets.forEach((target) => relocateConstructorBlock(
        target,
        addIsoMinutes(target.startAt, rawMinutes),
        addIsoMinutes(target.endAt, rawMinutes),
        constructorOperation.scope === "occurrence" ? "Выполнение перенесено выбранным структурированным способом." : "Выбранное и последующие выполнения перенесены вместе."
      ));
    } else {
      workingBlocks = workingBlocks.filter((block) => !targets.some((target) => target.id === block.id));
      targets.forEach((target) => relocateConstructorBlock(
        target,
        addIsoMinutes(target.startAt, shiftMinutes),
        addIsoMinutes(target.endAt, shiftMinutes),
        constructorOperation.scope === "occurrence" ? "Выполнение перенесено выбранным структурированным способом." : "Выбранное и последующие выполнения перенесены вместе."
      ));
    }
  }

  if (constructorOperation?.kind === "replace_item") {
    const original = workingBlocks.find((block) => block.id === constructorOperation.blockId);
    if (!original) throw new Error("Заменяемое дело не найдено.");
    if (["done", "skipped", "cancelled"].includes(original.status) || original.status !== "in_progress" && new Date(original.endAt) <= now) throw new Error("Прошедшее или завершённое выполнение нельзя заменить.");
    const replacementStartAt = original.status === "in_progress" ? now.toISOString() : original.startAt;
    const nextBlock = workingBlocks
      .filter((block) => block.id !== original.id && new Date(block.startAt) > new Date(replacementStartAt) && !["cancelled", "skipped"].includes(block.status))
      .sort((left, right) => left.startAt.localeCompare(right.startAt))[0];
    const replacementEndAt = constructorOperation.duration.mode === "same"
      ? addIsoMinutes(replacementStartAt, isoDurationMinutes(original.startAt, original.endAt))
      : constructorOperation.duration.mode === "minutes"
        ? addIsoMinutes(replacementStartAt, clamp(Math.round(constructorOperation.duration.minutes), 5, 1440))
        : constructorOperation.duration.mode === "until_next"
          ? nextBlock?.startAt ?? original.endAt
          : zonedPlannerDateTimeToUtc(constructorOperation.duration.date, constructorOperation.duration.time, profile.timezone);
    if (new Date(replacementEndAt) <= new Date(replacementStartAt)) throw new Error("Окончание замены должно быть позже начала.");
    if (original.status === "in_progress") {
      workingBlocks = workingBlocks.map((block) => block.id === original.id
        ? { ...block, status: "done", actualEndAt: now.toISOString() }
        : block);
      changes.push({
        id: uniqueId("constructor-finish-replaced", original.id),
        kind: "update_block_status",
        blockId: original.id,
        title: original.title,
        status: "done",
        actualStartAt: original.actualStartAt,
        actualEndAt: now.toISOString(),
        reason: "Текущее дело завершено в фактический момент замены; его история сохранена.",
      });
    } else {
      cancelConstructorBlock(original, "Будущее выполнение отменено и заменено новым делом.");
    }
    const replacement = normalizePlannerItem({
      ...constructorOperation.replacement,
      id: constructorOperation.replacement.id || uniqueId("replacement-item", original.id, constructorOperation.replacement.title),
      title: constructorOperation.replacement.title,
      estimateMinutes: isoDurationMinutes(replacementStartAt, replacementEndAt),
    });
    items.push(replacement);
    changes.push({ id: uniqueId("replacement-add", replacement.id), kind: "add_item", item: replacement, reason: "Новое дело создано как подтверждённая замена." });
    considerFixedBlock({
      id: uniqueId("replacement-block", replacement.id, replacementStartAt),
      itemId: replacement.id,
      title: replacement.title,
      startAt: replacementStartAt,
      endAt: replacementEndAt,
      status: original.status === "in_progress" ? "in_progress" : "planned",
      source: "manual",
      fixed: replacement.kind === "fixed_event",
      occurrenceKey: replacement.id,
      actualStartAt: original.status === "in_progress" ? now.toISOString() : undefined,
    }, "Новое дело поставлено на место отменённого выполнения.");
    if (constructorOperation.scope === "item" && original.itemId) {
      const sourceIndex = items.findIndex((item) => item.id === original.itemId);
      if (sourceIndex >= 0) {
        items[sourceIndex] = { ...items[sourceIndex], status: "archived" };
        changes.push({ id: uniqueId("replacement-archive", items[sourceIndex].id), kind: "update_item", item: items[sourceIndex], reason: "Заменённое дело архивировано; история сохранена." });
      }
    }
  }

  if (constructorOperation?.kind === "rebuild_remaining") {
    const cancelledIds = new Set(constructorOperation.decisions.filter((decision) => decision.disposition === "cancel").map((decision) => decision.itemId));
    workingBlocks.filter((block) => block.itemId && cancelledIds.has(block.itemId) && block.status === "planned" && new Date(block.startAt) >= rebuildAt)
      .forEach((block) => cancelConstructorBlock(block, "Выполнение отменено только для пересобираемой части плана."));
  }

  if (input.blockExtension) {
    const extensionMinutes = Math.round(Number(input.blockExtension.minutes));
    if (!Number.isFinite(extensionMinutes) || extensionMinutes < 5 || extensionMinutes > 1440) {
      throw new Error("Укажите продление от 5 минут до 24 часов.");
    }
    const original = workingBlocks.find((block) => block.id === input.blockExtension!.blockId);
    if (!original || !["planned", "in_progress"].includes(original.status) || original.fixed) {
      throw new Error("Продлить можно только текущее или будущее гибкое дело.");
    }
    const extended = { ...original, endAt: addIsoMinutes(original.endAt, extensionMinutes) };
    for (const block of [...workingBlocks, ...sleepBlocks]) {
      if (block.id === original.id || !rangesOverlap(blockInterval(extended), blockInterval(block))) continue;
      if (block.soft) {
        changes.push({
          id: uniqueId("consume-reserve", block.id, extensionMinutes),
          kind: "remove_block",
          blockId: block.id,
          title: block.title,
          reason: "Продление сначала использует мягкий резерв этого плана.",
        });
        workingBlocks = workingBlocks.filter((candidate) => candidate.id !== block.id);
        continue;
      }
      if (block.fixed || block.status === "done" || block.status === "in_progress" || new Date(block.startAt).getTime() < now.getTime()) {
        conflicts.push({
          id: uniqueId("extension-conflict", original.id, block.id),
          kind: block.status === "in_progress" ? "active_overlap" : "fixed_overlap",
          title: original.title,
          message: block.id.startsWith("sleep-")
            ? `Дополнительные ${extensionMinutes} минут пересекаются с защищённым сном. Продление не применено.`
            : `Дополнительные ${extensionMinutes} минут пересекаются с защищённым или уже начатым делом.`,
          blockIds: [original.id, block.id],
        });
      } else {
        movableBlocks.set(block.id, block);
      }
    }
    workingBlocks = workingBlocks.filter((block) => block.id !== original.id && !movableBlocks.has(block.id));
    workingBlocks.push(extended);
    changes.push({
      id: uniqueId("extend", original.id, extended.endAt),
      kind: "move_block",
      blockId: original.id,
      title: original.title,
      fromStartAt: original.startAt,
      fromEndAt: original.endAt,
      toStartAt: original.startAt,
      toEndAt: extended.endAt,
      reason: `Добавлено ${extensionMinutes} минут; всё последующее пересчитано без молчаливого сдвига сна или другого срока.`,
    });
    const itemIndex = items.findIndex((item) => item.id === original.itemId);
    if (itemIndex >= 0) {
      const currentItem = items[itemIndex];
      const likelyMinutes = currentItem.uncertaintyPolicy.duration.likelyMinutes + extensionMinutes;
      items[itemIndex] = normalizePlannerItem({
        ...currentItem,
        estimateMinutes: likelyMinutes,
        uncertaintyPolicy: {
          ...currentItem.uncertaintyPolicy,
          duration: {
            ...currentItem.uncertaintyPolicy.duration,
            likelyMinutes,
            maxMinutes: Math.max(likelyMinutes, currentItem.uncertaintyPolicy.duration.maxMinutes),
            source: "user",
          },
        },
      });
      changes.push({
        id: uniqueId("extend-item", items[itemIndex].id, items[itemIndex].estimateMinutes),
        kind: "update_item",
        item: items[itemIndex],
        reason: `Обычная оценка длительности увеличена на подтверждённые ${extensionMinutes} минут.`,
      });
    }
  }

  normalizedDrafts.forEach((draft, index) => {
    const item = normalizePlannerItem({
      ...draft,
      id: draft.id || uniqueId("item", index, draft.title, draft.date, draft.start),
      title: draft.title,
    });
    const existingIndex = items.findIndex((candidate) => candidate.id === item.id);
    if (existingIndex >= 0) {
      const replacedFixedBlocks = workingBlocks.filter((block) => block.itemId === item.id
        && block.fixed
        && block.status === "planned"
        && new Date(block.startAt).getTime() >= now.getTime());
      const replacedFixedIds = new Set(replacedFixedBlocks.map((block) => block.id));
      workingBlocks = workingBlocks.filter((block) => !replacedFixedIds.has(block.id));
      for (const block of replacedFixedBlocks) {
        changes.push({
          id: uniqueId("remove-edited-fixed", block.id),
          kind: "remove_block",
          blockId: block.id,
          title: block.title,
          reason: "Прежнее будущее время этого изменённого дела освобождено перед проверкой нового времени.",
        });
      }
      items[existingIndex] = item;
      changes.push({ id: uniqueId("change-item", item.id), kind: "update_item", item, reason: "Изменения существующего дела подтверждены из общего списка." });
    } else {
      items.push(item);
      changes.push({ id: uniqueId("change-item", item.id), kind: "add_item", item, reason: "Новое дело подтверждено из формы." });
    }
    const fixedBlocks = item.recurrence?.startTime
      ? recurringFixedBlocks(item, profile, startDate, endDate)
      : [blockFromDraft(draft, item, profile)].filter((block): block is PlannerBlock => Boolean(block));
    fixedBlocks.filter((block) => !item.recurrence?.startTime || new Date(block.endAt) > now).forEach((block) => {
      considerFixedBlock(block, item.recurrence
        ? "Создано повторение постоянного обязательства."
        : block.endEstimate?.mode === "unknown"
          ? "Создано событие с неизвестным окончанием; остаток дня защищён предварительно."
          : "Фиксированное событие занимает выбранное время.");
      const latestAt = block.endEstimate?.latestAt;
      if (latestAt && new Date(latestAt) > new Date(block.endAt)) {
        const reserve: PlannerBlock = {
          id: uniqueId("event-end-reserve", block.id),
          itemId: item.id,
          title: `Запас окончания — ${item.title}`,
          startAt: block.endAt,
          endAt: latestAt,
          status: "planned",
          source: "auto",
          fixed: false,
          role: "uncertainty_reserve",
          soft: true,
          occurrenceKey: `${block.occurrenceKey ?? item.id}:end-reserve`,
          endEstimate: block.endEstimate,
        };
        workingBlocks.push(reserve);
        changes.push({
          id: uniqueId("event-end-reserve-change", reserve.id),
          kind: "add_block",
          block: reserve,
          reason: "Мягкий резерв учитывает возможное более позднее окончание и помечает дела внутри него как предварительные.",
        });
      }
    });
  });

  for (const item of items.filter((candidate) => candidate.status === "active" && candidate.kind === "fixed_event" && candidate.recurrence?.startTime)) {
    for (const block of recurringFixedBlocks(item, profile, startDate, endDate).filter((candidate) => new Date(candidate.endAt) > now)) {
      if (workingBlocks.some((candidate) => candidate.itemId === item.id && candidate.occurrenceKey === block.occurrenceKey)) continue;
      considerFixedBlock(block, "Добавлено недостающее повторение постоянного обязательства.");
    }
  }

  for (const sleep of sleepBlocks) {
    for (const block of workingBlocks.filter((candidate) => (candidate.fixed || candidate.status === "in_progress") && candidate.status !== "cancelled" && candidate.status !== "skipped")) {
      const blockItem = block.itemId ? items.find((item) => item.id === block.itemId) : undefined;
      const rawBlock = blockInterval(block);
      const protectedBlock = {
        start: rawBlock.start - plannerBufferBefore(blockItem) * 60_000,
        end: rawBlock.end + plannerBufferAfter(blockItem) * 60_000,
      };
      if (!rangesOverlap(blockInterval(sleep), protectedBlock)) continue;
      if (conflicts.some((conflict) => conflict.blockIds.includes(sleep.id) && conflict.blockIds.includes(block.id))) continue;
      conflicts.push({
        id: uniqueId("conflict-sleep", sleep.id, block.id),
        kind: block.status === "in_progress" ? "active_overlap" : "fixed_overlap",
        title: block.title,
        message: block.status === "in_progress"
          ? "Сон пересекается с уже начатым делом. Поставьте дело на паузу, закончите его или исправьте время сна."
          : "Фиксированное событие пересекается с защищённым сном. Измените событие или данные сна.",
        blockIds: [block.id, sleep.id],
      });
    }
  }

  const targetCapacityBlocks = [...workingBlocks, ...sleepBlocks].filter((block) =>
    block.fixed || block.status === "done" || block.status === "in_progress" || new Date(block.startAt).getTime() < now.getTime()
  );
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.deadlineType !== "hard" || !item.deadlineAt || item.targetFinishMode === "manual") continue;
    const targetFinishAt = resolvePlannerTargetFinish(item, profile, targetCapacityBlocks, now);
    if (!targetFinishAt || targetFinishAt === item.targetFinishAt) continue;
    const updated = { ...item, targetFinishAt };
    items[index] = updated;
    const added = changes.find((change) => change.kind === "add_item" && change.item.id === item.id);
    if (added?.kind === "add_item") added.item = updated;
    else changes.push({
      id: uniqueId("deadline-target", item.id, targetFinishAt),
      kind: "update_item",
      item: updated,
      reason: "Внутренняя цель рассчитана назад от жёсткого срока через реальные рабочие окна.",
    });
  }

  let requests = buildPlacementRequests(
    items,
    [...workingBlocks.filter((block) => block.id !== carryMissedBlockId), ...movableBlocks.values()],
    startDate,
    endDate,
    profile.timezone,
    storedProfile.planningPolicy.effectiveFromAt,
    input.deferredRemainders,
    input.targetItemIds ? new Set(input.targetItemIds) : undefined,
    now.toISOString()
  );
  if (input.targetOccurrenceKey) {
    requests = requests.filter((request) => request.occurrenceKey === input.targetOccurrenceKey
      || request.occurrenceKey.startsWith(`${input.targetOccurrenceKey}:`));
  }
  if (input.targetFromDate) {
    requests = requests.flatMap((request): PlacementRequest[] => {
      if (request.targetDate) return request.targetDate >= input.targetFromDate! ? [request] : [];
      if (request.allowedDates) {
        const allowedDates = request.allowedDates.filter((date) => date >= input.targetFromDate!);
        return allowedDates.length ? [{ ...request, allowedDates }] : [];
      }
      return [request];
    });
  }
  for (const block of movableBlocks.values()) {
    const item = items.find((candidate) => candidate.id === block.itemId);
    if (item) {
      const sourceDate = blockLocalDate(block, profile.timezone);
      const perCycle = item.kind === "routine" && item.recurrence?.durationMode === "per_cycle";
      const spareTime = item.recurrence?.schedulingMode === "spare_time";
      const weekStart = calendarWeekStart(sourceDate);
      const constrainedStart = weekStart > startDate ? weekStart : startDate;
      const weekEnd = addPlannerDays(weekStart, 6);
      const constrainedEnd = weekEnd < endDate ? weekEnd : endDate;
      requests.unshift({
        item,
        occurrenceKey: block.occurrenceKey ?? (perCycle ? `${item.id}:cycle:${weekStart}` : item.id),
        durationMinutes: isoDurationMinutes(block.startAt, block.endAt),
        tier: spareTime ? block.occurrenceKey?.endsWith(":extra") ? "extra" : "minimum" : "required",
        targetDate: !perCycle && (item.kind === "routine" || item.recurrence?.frequency === "once")
          ? sourceDate
          : undefined,
        allowedDates: perCycle && constrainedStart <= constrainedEnd
          ? getRoutineDates(item, constrainedStart, constrainedEnd)
          : undefined,
        sourceBlock: block,
      });
    }
  }

  const visibleRequestedMinutes = new Map<string, number>();
  const visiblePlacedMinutes = new Map<string, number>();
  for (const request of requests) {
    if (request.reportRemainder === false || request.tier === "reserve" || request.tier === "extra") continue;
    visibleRequestedMinutes.set(request.item.id, (visibleRequestedMinutes.get(request.item.id) ?? 0) + request.durationMinutes);
  }

  const autoMinutesByDate = new Map<string, number>();
  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const block of workingBlocks.filter((candidate) => !candidate.fixed && !candidate.soft && !["cancelled", "skipped", "done"].includes(candidate.status))) {
    const date = formatDateInTimeZone(new Date(block.startAt), profile.timezone);
    const windows = availabilityForDate(profile, date);
    const minutes = windows.reduce(
      (sum, window) => sum + blockMinutesInsideWindow(block, date, window, profile.timezone),
      0
    );
    const blockItem = block.itemId ? itemById.get(block.itemId) : undefined;
    const footprint = blockItem ? placementFootprintMinutes(blockItem, minutes) : minutes;
    autoMinutesByDate.set(date, (autoMinutesByDate.get(date) ?? 0) + footprint);
  }
  const chainByItemId = new Map<string, { startAt: string; previousBlockId: string; gapMinutes: number }>();
  for (const request of requests) {
    let remaining = request.durationMinutes;
    let part = request.sourceBlock ? 0 : workingBlocks.filter((block) => block.itemId === request.item.id
      && block.occurrenceKey === request.occurrenceKey).length;
    while (remaining > 0) {
      const placements = safeChunkDurations(request.item, remaining).flatMap((duration) => {
        const placement = request.tier === "reserve"
          ? findAttachedReservePlacement(request, duration, profile, [...workingBlocks, ...sleepBlocks], now.getTime(), itemById)
          : findPlacement(
          request,
          duration,
          profile,
          [...workingBlocks, ...sleepBlocks],
          startDate,
          endDate,
          now.getTime(),
          autoMinutesByDate,
          itemById,
          energyShiftByDate,
          chainByItemId.get(request.item.id)
        );
        return placement ? [{ duration, placement }] : [];
      }).sort((left, right) => left.placement.date.localeCompare(right.placement.date)
        || right.duration - left.duration
        || left.placement.startAt.localeCompare(right.placement.startAt));
      const selectedPlacement = placements[0];
      if (!selectedPlacement) break;
      const { duration, placement } = selectedPlacement;
      part += 1;
      const block: PlannerBlock = {
        id: request.sourceBlock && part === 1 ? request.sourceBlock.id : uniqueId("block", request.item.id, request.occurrenceKey, part),
        itemId: request.item.id,
        title: request.item.title,
        startAt: placement.startAt,
        endAt: placement.endAt,
        status: "planned",
        source: "auto",
        fixed: false,
        role: request.role ?? "work",
        soft: request.tier === "reserve",
        occurrenceKey: request.occurrenceKey,
      };
      if (request.sourceBlock && part === 1) {
        changes.push({
          id: uniqueId("move", block.id, block.startAt),
          kind: "move_block",
          blockId: block.id,
          title: block.title,
          fromStartAt: request.sourceBlock.startAt,
          fromEndAt: request.sourceBlock.endAt,
          toStartAt: block.startAt,
          toEndAt: block.endAt,
          reason: "Гибкое дело перенесено вокруг нового фиксированного события.",
        });
      } else {
        changes.push({
          id: uniqueId("add", block.id),
          kind: "add_block",
          block,
          reason: request.tier === "reserve"
            ? "Мягкий резерв показывает запас до максимальной оценки и не блокирует менее важные дела."
            : request.tier === "extra"
            ? "Свободное время добавлено после размещения обязательств, сроков и защищённого минимума."
            : request.tier === "minimum"
              ? "Сначала размещён обязательный минимум неточной оценки."
              : request.tier === "likely"
                ? "План доведён от минимума до наиболее вероятной длительности."
              : request.item.preferredWindows.length
            ? "Подобрано свободное окно с учётом предпочтительного времени и нагрузки."
            : "Подобрано свободное окно с учётом приоритета, энергии и нагрузки.",
        });
      }
      workingBlocks.push(block);
      const travel = request.item.uncertaintyPolicy.travel;
      const travelReserveMinutes = travel && travel.punctuality !== "strict"
        ? Math.max(0, travel.maxMinutes - travel.likelyMinutes)
        : 0;
      if (!block.soft && travelReserveMinutes > 0) {
        const outboundReserveEndAt = addIsoMinutes(block.startAt, -request.item.bufferBeforeMinutes);
        const travelReserves: PlannerBlock[] = [{
          id: uniqueId("travel-reserve-before", block.id),
          itemId: request.item.id,
          title: `Запас на дорогу — ${request.item.title}`,
          startAt: addIsoMinutes(outboundReserveEndAt, -travelReserveMinutes),
          endAt: outboundReserveEndAt,
          status: "planned",
          source: "auto",
          fixed: false,
          role: "uncertainty_reserve",
          soft: true,
          occurrenceKey: `${request.occurrenceKey}:travel-before`,
        }];
        if (request.item.bufferAfterMinutes > 0) {
          const returnReserveStartAt = addIsoMinutes(block.endAt, request.item.bufferAfterMinutes);
          travelReserves.push({
          id: uniqueId("travel-reserve-after", block.id),
          itemId: request.item.id,
          title: `Запас на обратную дорогу — ${request.item.title}`,
          startAt: returnReserveStartAt,
          endAt: addIsoMinutes(returnReserveStartAt, travelReserveMinutes),
          status: "planned",
          source: "auto",
          fixed: false,
          role: "uncertainty_reserve",
          soft: true,
          occurrenceKey: `${request.occurrenceKey}:travel-after`,
          });
        }
        for (const reserve of travelReserves) {
          workingBlocks.push(reserve);
          changes.push({
            id: uniqueId("add", reserve.id),
            kind: "add_block",
            block: reserve,
            reason: "Мягкий запас учитывает неопределённость дороги и не блокирует менее важные дела.",
          });
        }
      }
      if (!block.soft) {
        autoMinutesByDate.set(
          placement.date,
          (autoMinutesByDate.get(placement.date) ?? 0) + placementFootprintMinutes(request.item, duration)
        );
      }
      remaining -= duration;
      if (!request.item.canSplit || request.tier === "reserve") break;
    }
    if (request.reportRemainder !== false && request.tier !== "reserve" && request.tier !== "extra") {
      visiblePlacedMinutes.set(
        request.item.id,
        (visiblePlacedMinutes.get(request.item.id) ?? 0) + Math.max(0, request.durationMinutes - remaining)
      );
    }
    if (remaining === 0 && part > 0 && request.item.deadlineType !== "none") {
      const next = nextDeadlineChainItem(request.item, items);
      const lastBlock = [...workingBlocks].reverse().find((block) => block.itemId === request.item.id && block.occurrenceKey === request.occurrenceKey);
      if (next && lastBlock) {
        const gapMinutes = request.item.deadlinePolicy.gapMinutes ?? profile.planningPolicy.deadlineChainGapMinutes;
        chainByItemId.set(next.id, {
          startAt: addIsoMinutes(lastBlock.endAt, gapMinutes),
          previousBlockId: lastBlock.id,
          gapMinutes,
        });
      }
    }
    if (remaining > 0) {
      if (request.sourceBlock && part === 0) {
        changes.push({
          id: uniqueId("remove", request.sourceBlock.id),
          kind: "remove_block",
          blockId: request.sourceBlock.id,
          title: request.sourceBlock.title,
          reason: "Вытеснённый блок отправлен в Архиватор дел: безопасного нового времени пока нет.",
        });
      }
      if (request.reportRemainder === false || request.tier === "reserve" || request.tier === "extra") continue;
      const failureOccupied = [...workingBlocks, ...sleepBlocks];
      const canPlace = (nextProfile: PlannerProfile, nextOccupied = failureOccupied, nextItem = request.item) => safeChunkDurations(nextItem, remaining)
        .some((duration) => Boolean(findPlacement(
          { ...request, item: nextItem }, duration, nextProfile, nextOccupied, startDate, endDate, now.getTime(),
          autoMinutesByDate, new Map(items.map((item) => [item.id, item])), energyShiftByDate
        )));
      const reasonCode: NonNullable<PlannerUnplaced["reasonCode"]> = canPlace({ ...profile, reserveRatio: 0 })
        ? "reserve"
        : canPlace({ ...profile, defaultBufferMinutes: 0 }, failureOccupied, {
            ...request.item,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
          })
          ? "transition"
          : canPlace(profile, workingBlocks)
            ? "sleep"
            : canPlace(profile, failureOccupied.filter((block) => !block.fixed))
              ? "fixed_event"
              : "window";
      const reasonByCode: Record<NonNullable<PlannerUnplaced["reasonCode"]>, string> = {
        reserve: "Окно существует, но защищено настройкой резерва времени.",
        transition: "Окно короче длительности дела вместе с обязательным переходом.",
        sleep: "Подходящее окно пересекается с защищённым сном.",
        fixed_event: "Подходящее окно занято фиксированным событием.",
        day_bounds: "Дело не помещается в границы выбранного дня.",
        window: "Нет окна нужной длительности внутри разрешённых границ дня и времени.",
      };
      const reason = reasonByCode[reasonCode];
      unplaced.push({
        itemId: request.item.id,
        title: request.item.title,
        requestedMinutes: visibleRequestedMinutes.get(request.item.id),
        placedMinutes: visiblePlacedMinutes.get(request.item.id),
        remainingMinutes: remaining,
        reason,
        reasonCode,
        blocking: Boolean(request.mandatory),
      });
      const addedItem = changes.find((change) => change.kind === "add_item" && change.item.id === request.item.id);
      if (addedItem?.kind === "add_item") addedItem.item.unplacedReason = reason;
      else if (!changes.some((change) => change.kind === "update_item" && change.item.id === request.item.id)) {
        changes.push({
          id: uniqueId("update-unplaced", request.item.id),
          kind: "update_item",
          item: { ...request.item, unplacedReason: reason },
          reason: request.mandatory
            ? "Причина сохранена вместе с обязательным делом в Архиваторе дел."
            : "Необязательный остаток явно оставлен в Архиваторе дел вместо молчаливого удаления.",
        });
      }
    }
  }

  const combinedUnplaced = new Map<string, PlannerUnplaced>();
  for (const entry of unplaced) {
    const previous = combinedUnplaced.get(entry.itemId);
    const representative = previous?.blocking && !entry.blocking ? previous : entry;
    combinedUnplaced.set(entry.itemId, {
      ...representative,
      requestedMinutes: visibleRequestedMinutes.get(entry.itemId) ?? entry.requestedMinutes,
      placedMinutes: visiblePlacedMinutes.get(entry.itemId) ?? entry.placedMinutes,
      remainingMinutes: Math.max(0,
        (visibleRequestedMinutes.get(entry.itemId) ?? entry.requestedMinutes ?? entry.remainingMinutes)
        - (visiblePlacedMinutes.get(entry.itemId) ?? entry.placedMinutes ?? 0)
      ),
      blocking: Boolean(previous?.blocking || entry.blocking),
    });
  }
  unplaced.splice(0, unplaced.length, ...combinedUnplaced.values());

  const savedArchiverEntries = input.archiverEntries ?? [];
  const requestedItemIds = new Set(requests.map((request) => request.item.id));
  const carriedMissedChange = carryMissedBlockId
    ? changes.find((change): change is Extract<PlannerProposalChange, { kind: "upsert_archiver_entry" }> =>
      change.kind === "upsert_archiver_entry" && change.entry.sourceBlockId === carryMissedBlockId)
    : undefined;
  const carriedUnplaced = carriedMissedChange?.entry.itemId
    ? unplaced.find((entry) => entry.itemId === carriedMissedChange.entry.itemId)
    : undefined;
  if (carriedMissedChange && carriedUnplaced) {
    const pendingMinutes = Math.min(carriedMissedChange.entry.totalMinutes, carriedUnplaced.remainingMinutes);
    const scheduledMinutes = carriedMissedChange.entry.totalMinutes - pendingMinutes;
    carriedMissedChange.entry = {
      ...carriedMissedChange.entry,
      pendingMinutes,
      scheduledMinutes,
      returnedAt: scheduledMinutes > 0 ? now.toISOString() : undefined,
      resolvedAt: pendingMinutes === 0 ? now.toISOString() : undefined,
      resolution: pendingMinutes === 0 ? "scheduled" : undefined,
      outcomeNote: scheduledMinutes > 0
        ? "Часть пропущенного объёма возвращена в план; остальное продолжает ждать решения."
        : "Для пропущенного объёма пока не нашлось безопасного времени.",
    };
  }
  for (const entry of unplaced) {
    if (carriedMissedChange?.entry.itemId === entry.itemId) continue;
    const existingEntry = savedArchiverEntries.find((candidate) => !candidate.resolvedAt
      && candidate.category === "no_slot" && candidate.itemId === entry.itemId);
    const occurredAt = existingEntry?.occurredAt ?? now.toISOString();
    const scheduledMinutes = (existingEntry?.scheduledMinutes ?? 0) + (entry.placedMinutes ?? 0);
    const totalMinutes = Math.max(
      existingEntry?.totalMinutes ?? 0,
      scheduledMinutes + entry.remainingMinutes,
      entry.requestedMinutes ?? entry.remainingMinutes
    );
    const archiveEntry: PlannerArchiverEntry = {
      id: existingEntry?.id ?? uniqueId("unplaced-case", entry.itemId, occurredAt),
      category: "no_slot",
      origin: existingEntry?.origin ?? "unplaced",
      itemId: entry.itemId,
      sourceBlockId: existingEntry?.sourceBlockId,
      occurrenceKey: existingEntry?.occurrenceKey,
      title: entry.title,
      reason: existingEntry?.reason ?? entry.reason,
      outcomeNote: existingEntry && existingEntry.reason !== entry.reason
        ? `Повторная попытка размещения: ${entry.reason}`
        : existingEntry?.outcomeNote,
      totalMinutes,
      pendingMinutes: entry.remainingMinutes,
      scheduledMinutes,
      occurredAt,
      createdAt: existingEntry?.createdAt ?? now.toISOString(),
      returnedAt: existingEntry?.returnedAt,
    };
    changes.push({
      id: uniqueId("archiver-unplaced", archiveEntry.id, archiveEntry.pendingMinutes),
      kind: "upsert_archiver_entry",
      entry: archiveEntry,
      reason: "Неразмещённый объём сохранён в Архиваторе дел до явного решения.",
    });
  }
  for (const existingEntry of savedArchiverEntries.filter((candidate) => !candidate.resolvedAt
    && candidate.category === "no_slot" && candidate.itemId && requestedItemIds.has(candidate.itemId)
    && !unplaced.some((entry) => entry.itemId === candidate.itemId))) {
    const newlyPlacedMinutes = visiblePlacedMinutes.get(existingEntry.itemId!) ?? 0;
    const totalMinutes = Math.max(existingEntry.totalMinutes, existingEntry.scheduledMinutes + newlyPlacedMinutes);
    changes.push({
      id: uniqueId("archiver-resolved", existingEntry.id),
      kind: "upsert_archiver_entry",
      entry: {
        ...existingEntry,
        totalMinutes,
        pendingMinutes: 0,
        scheduledMinutes: totalMinutes,
        returnedAt: existingEntry.returnedAt ?? now.toISOString(),
        resolvedAt: now.toISOString(),
        resolution: "scheduled",
        outcomeNote: "Весь объём получил безопасное время в подтверждённом плане.",
      },
      reason: "Запись Архиватора дел закрыта после полного размещения.",
    });
  }

  const unplacedItemIds = new Set(unplaced.map((entry) => entry.itemId));
  for (const item of items.filter((candidate) => candidate.unplacedReason)) {
    if (unplacedItemIds.has(item.id) || !requests.some((request) => request.item.id === item.id)) continue;
    changes.push({
      id: uniqueId("clear-unplaced", item.id),
      kind: "update_item",
      item: { ...item, unplacedReason: undefined },
      reason: "Для дела найдено безопасное время; прежняя причина удалена.",
    });
  }

  const deadlineAnalysis = analyzePlannerDeadlines(
    items,
    [...workingBlocks, ...sleepBlocks],
    profile,
    now,
    input.deferredRemainders
  );
  const riskWeight = { impossible: 4, at_risk: 3, tight: 2, on_track: 1 } as const;
  for (const analysis of deadlineAnalysis) {
    const item = items.find((candidate) => candidate.id === analysis.itemId);
    if (!item || item.deadlinePolicy.chainMode === "off") continue;
    const chosenItem = nextDeadlineChainItem(item, items);
    const next = chosenItem
      ? deadlineAnalysis.find((candidate) => candidate.itemId === chosenItem.id) ?? chosenItem
      : deadlineAnalysis.filter((candidate) => candidate.itemId !== item.id)
        .sort((left, right) => riskWeight[right.risk] - riskWeight[left.risk] || left.deadlineAt.localeCompare(right.deadlineAt))[0];
    if (next) {
      analysis.nextItemId = "itemId" in next ? next.itemId : next.id;
      analysis.nextItemTitle = next.title;
    }
  }

  const selectedDecisions = new Map((input.decisions ?? []).map((decision) => [decision.groupId, decision.optionId]));
  const decisionGroups = unplaced.map((entry) => {
    const item = items.find((candidate) => candidate.id === entry.itemId);
    const options = [] as NonNullable<PlannerProposal["decisionGroups"]>[number]["options"];
    if (item?.uncertaintyPolicy.date.mode !== "exact") {
      options.push({
        id: `move:${entry.itemId}`,
        kind: "move",
        title: "Перенести на другой день",
        description: `Найти первое безопасное окно для «${entry.title}» в оставшемся горизонте.`,
      });
    }
    if (item?.uncertaintyPolicy.reduction?.mode === "to_minimum"
      && item.uncertaintyPolicy.reduction.minimumMinutes < entry.remainingMinutes) {
      options.push({
        id: `shorten:${entry.itemId}`,
        kind: "shorten",
        title: `Сократить до ${item.uncertaintyPolicy.reduction.minimumMinutes} мин`,
        description: "Сокращение разрешено правилами этого дела и не опустится ниже выбранного минимума.",
      });
    }
    if (item?.commitmentLevel === "desired" || item?.commitmentLevel === "if_time") {
      options.push({
        id: `cancel:${entry.itemId}`,
        kind: "cancel",
        title: "Отменить необязательное выполнение",
        description: "История останется, а выбранное будущее выполнение не будет создано заново.",
      });
      options.push({
        id: `queue:${entry.itemId}`,
        kind: "queue",
        title: "Явно оставить в Архиваторе дел",
        description: "Дело не потеряется, но не будет считаться размещённым в этом плане.",
      });
    }
    options.push({
      id: `edit:${entry.itemId}`,
      kind: "edit",
      title: "Изменить вводные",
      description: "Вернуться в конструктор и изменить время, длительность или обязательность.",
    });
    const groupId = `unplaced:${entry.itemId}`;
    const selectedOptionId = options.some((option) => option.id === selectedDecisions.get(groupId))
      ? selectedDecisions.get(groupId)
      : undefined;
    return {
      id: groupId,
      title: `${entry.title} не помещается`,
      message: `${entry.remainingMinutes} мин осталось без места. ${entry.reason}`,
      blocking: Boolean(entry.blocking && !selectedOptionId),
      options,
      selectedOptionId,
    };
  });

  return {
    baseRevision: baseProfile.revision,
    trigger,
    operation: input.operation,
    normalizedDraft,
    normalizedDrafts: normalizedDrafts.length > 1 ? normalizedDrafts : undefined,
    removedItemIds: input.removedItemIds,
    blockExtension: input.blockExtension,
    missedOccurrence: input.missedOccurrence,
    changes,
    conflicts,
    decisionGroups,
    decisions: input.decisions,
    unplaced,
    effectiveFocus,
    deadlineAnalysis,
    sleepPlan: calculatedSleepBlocks.map((block) => ({
      wakeDate: block.wakeDate,
      startAt: block.startAt,
      endAt: block.endAt,
      durationMinutes: block.selectedDurationMinutes,
      preferredDurationMatched: block.preferredDurationMatched,
      borrowedMinutes: block.borrowedMinutes,
      reason: block.selectionReason,
      transitionNight: block.transitionNight,
    })),
    effectiveFromAt: storedProfile.planningPolicy.effectiveFromAt ?? now.toISOString(),
    horizonStart: startDate,
    horizonEnd: endDate,
    recoveryAdvice,
  };
}

type AutoWakeCandidate = {
  minute: number;
  profilePatch: Partial<PlannerProfile>;
  proposal: PlannerProposal;
  recurringConflictCount: number;
  deadlineViolations: number;
  unplacedMinutes: number;
  peakLoadMinutes: number;
  energyMismatchMinutes: number;
  placedMinutes: number;
};

type SleepChoiceScore = {
  hardFailureCount: number;
  hardRiskWeight: number;
  unplacedMinutes: number;
  durationMinutes: number;
};

function proposalSleepChoiceScore(
  proposal: PlannerProposal,
  items: PlannerItem[],
  durationMinutes: number
): SleepChoiceScore {
  const hardIds = new Set(items.filter((item) => item.deadlineType === "hard").map((item) => item.id));
  const riskWeight = { on_track: 0, tight: 1, at_risk: 2, impossible: 3 } as const;
  const hardAnalyses = (proposal.deadlineAnalysis ?? []).filter((analysis) => analysis.deadlineType === "hard");
  return {
    hardFailureCount: hardAnalyses.filter((analysis) => analysis.risk === "impossible").length
      + proposal.unplaced.filter((entry) => hardIds.has(entry.itemId)).length,
    hardRiskWeight: hardAnalyses.reduce((sum, analysis) => sum + riskWeight[analysis.risk], 0),
    unplacedMinutes: proposal.unplaced.reduce((sum, entry) => sum + entry.remainingMinutes, 0),
    durationMinutes,
  };
}

function compareSleepChoiceScore(left: SleepChoiceScore, right: SleepChoiceScore): number {
  return left.hardFailureCount - right.hardFailureCount
    || left.hardRiskWeight - right.hardRiskWeight
    || left.unplacedMinutes - right.unplacedMinutes
    || right.durationMinutes - left.durationMinutes;
}

function profileForSleepDuration(profile: PlannerProfile, durationMinutes: number): PlannerProfile {
  if (profile.sleepSchedule.mode !== "adaptive") return profile;
  const schedule = { ...profile.sleepSchedule, targetDurationMinutes: durationMinutes };
  const followsSleep = sameAvailability(profile.availability, availabilityFromSleepSchedule(profile.sleepSchedule));
  return normalizePlannerProfile({
    ...profile,
    sleepSchedule: schedule,
    availability: followsSleep ? availabilityFromSleepSchedule(schedule) : profile.availability,
  });
}

function extendEveningAvailability(profile: PlannerProfile, wakeDate: string, minutes: number): PlannerProfile {
  const bedtimeDate = addPlannerDays(wakeDate, -1);
  const day = String(plannerWeekday(bedtimeDate));
  const windows = profile.availability[day] ?? [];
  if (!windows.length) return profile;
  const lastIndex = windows.length - 1;
  return normalizePlannerProfile({
    ...profile,
    availability: {
      ...profile.availability,
      [day]: windows.map((window, index) => index === lastIndex
        ? { ...window, end: plannerMinutesToTime(plannerTimeToMinutes(window.end) + minutes) }
        : window),
    },
  });
}

function resolvePreferredSleepDuration(input: PlannerEngineInput): PlannerProposal {
  const baseProfile = normalizePlannerProfile(input.profile);
  const requestedProfile = normalizePlannerProfile({
    ...baseProfile,
    ...(input.profilePatch ?? {}),
    revision: baseProfile.revision,
  });
  const schedule = requestedProfile.sleepSchedule;
  if (schedule.mode !== "adaptive" || schedule.durationPreference.mode !== "exact") {
    return buildPlannerProposalResolved(input);
  }
  const focus = input.planningFocusOverride ?? requestedProfile.planningPolicy.focus;
  const options = preferredSleepDurations(schedule).sort((left, right) => right - left);
  const items = [
    ...input.items.map((item) => normalizePlannerItem(item)),
    ...draftsForProposal(input).map((draft, index) => normalizePlannerItem({
      ...draft,
      id: draft.id || uniqueId("item", index, draft.title, draft.date, draft.start),
      title: draft.title,
    })),
  ];
  const candidates = options.map((durationMinutes) => {
    const calculationProfile = profileForSleepDuration(requestedProfile, durationMinutes);
    const proposal = buildPlannerProposalResolved({
      ...input,
      calculationProfile,
      persistCalculatedSleep: true,
      calculatedSleepReason: durationMinutes === options[0] ? "preference" : "workload",
    });
    return { durationMinutes, proposal, score: proposalSleepChoiceScore(proposal, items, durationMinutes) };
  });
  if (focus === "sleep") return candidates[0].proposal;
  const today = formatDateInTimeZone(input.now ?? new Date(), requestedProfile.timezone);
  const protectedBySevereSleepiness = (input.sleepEvents ?? []).some((event) => {
    if (event.state !== "completed" || (event.sleepinessLevel ?? 0) < 3) return false;
    const protectedDays = event.sleepinessLevel === 4 ? 3 : 2;
    return today >= event.wakeDate && today <= addPlannerDays(event.wakeDate, protectedDays);
  });
  if (protectedBySevereSleepiness) return candidates[0].proposal;
  const baseline = candidates[0];
  const selected = [...candidates].sort((left, right) => compareSleepChoiceScore(left.score, right.score))[0];
  const improvesPlan = compareSleepChoiceScore(selected.score, baseline.score) < 0;
  const preferred = improvesPlan ? selected : baseline;

  const hardDeadlines = items.filter((item) => item.deadlineType === "hard" && item.deadlineAt
    && new Date(item.deadlineAt).getTime() > (input.now ?? new Date()).getTime())
    .sort((left, right) => left.deadlineAt!.localeCompare(right.deadlineAt!));
  if (!hardDeadlines.length || preferred.score.hardRiskWeight < 2) return preferred.proposal;
  const minimumPreferred = options.at(-1)!;
  const now = input.now ?? new Date();
  const firstHardDeadline = hardDeadlines[0].deadlineAt!;
  const minimumProfile = profileForSleepDuration(requestedProfile, minimumPreferred);
  const horizonStart = formatDateInTimeZone(now, minimumProfile.timezone);
  const horizonEnd = addPlannerDays(horizonStart, horizonDays(minimumProfile.horizon) - 1);
  const night = buildPlannerSleepBlocks(minimumProfile, input.sleepEvents ?? [], horizonStart, horizonEnd)
    .filter((block) => new Date(block.startAt).getTime() > now.getTime()
      && new Date(block.startAt).getTime() < new Date(firstHardDeadline).getTime())
    .sort((left, right) => right.startAt.localeCompare(left.startAt))[0];
  if (!night) return preferred.proposal;
  const priorBorrowed = (input.sleepEvents ?? []).filter((event) => event.wakeDate >= addPlannerDays(night.wakeDate, -6)
    && event.wakeDate <= night.wakeDate).reduce((sum, event) => sum + (event.borrowedMinutes ?? 0), 0);
  const maxBorrowed = Math.max(0, Math.min(
    requestedProfile.planningPolicy.maxNightDeficitMinutes,
    requestedProfile.planningPolicy.maxRollingSevenDayDeficitMinutes - priorBorrowed,
    minimumPreferred - requestedProfile.planningPolicy.minimumNightMinutes
  ));
  if (maxBorrowed < STEP_MINUTES) return preferred.proposal;
  const underMinimumCandidates = Array.from({ length: Math.floor(maxBorrowed / STEP_MINUTES) }, (_, index) => (index + 1) * STEP_MINUTES)
    .map((borrowedMinutes) => {
      const plannedEndAt = night.endAt;
      const plannedStartAt = addIsoMinutes(plannedEndAt, -(minimumPreferred - borrowedMinutes));
      const hardEvent: PlannerSleepEvent = {
        wakeDate: night.wakeDate,
        eventKind: "planned_adjustment",
        state: "planned",
        plannedStartAt,
        plannedEndAt,
        plannedDurationMinutes: minimumPreferred - borrowedMinutes,
        selectionReason: "hard_deadline",
        borrowedMinutes,
      };
      let remainingRecovery = borrowedMinutes;
      const recoveryEvents: PlannerSleepEvent[] = [];
      for (let dayOffset = 1; dayOffset <= requestedProfile.planningPolicy.recoveryHorizonNights && remainingRecovery > 0; dayOffset += 1) {
        const wakeDate = addPlannerDays(night.wakeDate, dayOffset);
        if ((input.sleepEvents ?? []).some((event) => event.wakeDate === wakeDate && event.state !== "planned")) continue;
        const window = sleepWindowForWakeDate(minimumProfile.sleepSchedule, wakeDate, minimumProfile.timezone);
        const extension = Math.min(60, remainingRecovery);
        recoveryEvents.push({
          wakeDate,
          eventKind: "planned_adjustment",
          state: "planned",
          plannedStartAt: addIsoMinutes(window.endAt, -(options[0] + extension)),
          plannedEndAt: window.endAt,
          plannedDurationMinutes: options[0] + extension,
          selectionReason: "recovery",
          borrowedMinutes: 0,
          recoveryNight: true,
        });
        remainingRecovery -= extension;
      }
      const sleepEvents = [
        ...(input.sleepEvents ?? []).filter((event) => ![hardEvent, ...recoveryEvents].some((next) => next.wakeDate === event.wakeDate)),
        hardEvent,
        ...recoveryEvents,
      ];
      const calculationProfile = extendEveningAvailability(minimumProfile, night.wakeDate, borrowedMinutes);
      const proposal = buildPlannerProposalResolved({
        ...input,
        sleepEvents,
        calculationProfile,
        persistCalculatedSleep: true,
        calculatedSleepReason: "workload",
      });
      proposal.recoveryAdvice = { deficitMinutes: borrowedMinutes, recoveryNights: requestedProfile.planningPolicy.recoveryHorizonNights };
      return {
        durationMinutes: minimumPreferred - borrowedMinutes,
        proposal,
        score: proposalSleepChoiceScore(proposal, items, minimumPreferred - borrowedMinutes),
      };
    });
  const selectedBorrowing = underMinimumCandidates.sort((left, right) => compareSleepChoiceScore(left.score, right.score))[0];
  const improvesHardDeadline = selectedBorrowing
    && (selectedBorrowing.score.hardFailureCount < preferred.score.hardFailureCount
      || (selectedBorrowing.score.hardFailureCount === preferred.score.hardFailureCount
        && selectedBorrowing.score.hardRiskWeight < preferred.score.hardRiskWeight));
  return improvesHardDeadline ? selectedBorrowing.proposal : preferred.proposal;
}

function shiftEnergyWindows(profile: PlannerProfile, deltaMinutes: number): PlannerProfile["energyWindows"] {
  if (!deltaMinutes) return profile.energyWindows;
  return profile.energyWindows.map((window) => ({
    ...window,
    start: plannerMinutesToTime(plannerTimeToMinutes(window.start) + deltaMinutes),
    end: plannerMinutesToTime(plannerTimeToMinutes(window.end) + deltaMinutes),
  }));
}

function sameAvailability(left: PlannerProfile["availability"], right: PlannerProfile["availability"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function draftsForProposal(input: PlannerEngineInput): PlannerDraft[] {
  if (input.drafts?.length) return input.drafts;
  if (input.draft) return [input.draft];
  return [];
}

function autoWakeRequirement(
  items: PlannerItem[],
  preparationMinutes: number
): { minute: number; title: string; startTime: string } | undefined {
  return items.flatMap((item) => {
    if (item.status !== "active" || item.kind !== "fixed_event" || !item.recurrence?.startTime) return [];
    const startMinute = plannerTimeToMinutes(item.recurrence.startTime);
    if (startMinute < 4 * 60 || startMinute > 13 * 60) return [];
    return [{
      minute: Math.max(0, startMinute - preparationMinutes),
      title: item.title,
      startTime: item.recurrence.startTime,
    }];
  }).sort((left, right) => left.minute - right.minute)[0];
}

function automaticWakeMinute(
  items: PlannerItem[],
  profile: PlannerProfile,
  requirement?: { minute: number },
  neutralMinute = 9 * 60
): number {
  let selected = Math.min(neutralMinute, requirement?.minute ?? neutralMinute);
  const beforeTask = (item: PlannerItem) => Math.max(profile.defaultBufferMinutes, plannerBufferBefore(item));
  const considerLatestBodyEnd = (item: PlannerItem, endMinute: number) => {
    const duration = item.commitmentLevel === "if_time"
      ? item.uncertaintyPolicy.duration.minMinutes
      : item.uncertaintyPolicy.duration.likelyMinutes;
    selected = Math.min(selected, endMinute - duration - beforeTask(item));
  };
  for (const item of items) {
    if (item.status !== "active" || item.kind === "fixed_event") continue;
    if (item.deadlineType !== "hard" && item.commitmentLevel !== "must_not_skip") continue;
    if (item.deadlineAt) {
      considerLatestBodyEnd(item, plannerTimeToMinutes(formatTimeInTimeZone(new Date(item.deadlineAt), profile.timezone)));
    }
    const timePolicy = item.uncertaintyPolicy.time;
    if (timePolicy.mode === "exact" && timePolicy.exactStart) {
      selected = Math.min(selected, plannerTimeToMinutes(timePolicy.exactStart) - beforeTask(item));
    } else if (timePolicy.mode === "range" && timePolicy.latestEnd) {
      considerLatestBodyEnd(item, plannerTimeToMinutes(timePolicy.latestEnd));
    } else if (timePolicy.mode === "preferred" && timePolicy.preferredStart) {
      selected = Math.min(selected, plannerTimeToMinutes(timePolicy.preferredStart) - beforeTask(item));
    }
    for (const window of item.allowedWindows) {
      considerLatestBodyEnd(item, plannerTimeToMinutes(window.end));
    }
  }
  const minimum = requirement && requirement.minute < 6 * 60 + 30 ? requirement.minute : 6 * 60 + 30;
  return Math.max(minimum, Math.floor(selected / STEP_MINUTES) * STEP_MINUTES);
}

function historicalWakeMinute(events: PlannerSleepEvent[], profile: PlannerProfile): number | undefined {
  const values = events.flatMap((event) => {
    const endAt = event.actualEndAt;
    if (!endAt || event.recoveryNight || event.transitionNight) return [];
    return [plannerTimeToMinutes(formatTimeInTimeZone(new Date(endAt), profile.timezone))];
  }).slice(-14).sort((left, right) => left - right);
  return values.length >= 3 ? values[Math.floor(values.length / 2)] : undefined;
}

function constrainWakeMinute(minute: number, schedule: Extract<PlannerProfile["sleepSchedule"], { mode: "adaptive" }>): number {
  const preference = schedule.wakePreference;
  const before = preference.notBefore ? plannerTimeToMinutes(preference.notBefore) : undefined;
  const after = preference.notAfter ? plannerTimeToMinutes(preference.notAfter) : undefined;
  if (before !== undefined && after !== undefined && before <= after) return clamp(minute, before, after);
  if (before !== undefined && minute < before) return before;
  if (after !== undefined && minute > after) return after;
  return minute;
}

function candidateBlocks(proposal: PlannerProposal, input: PlannerEngineInput): PlannerBlock[] {
  const moved = new Map(proposal.changes.flatMap((change) => change.kind === "move_block"
    ? [[change.blockId, { startAt: change.toStartAt, endAt: change.toEndAt }] as const]
    : []));
  const removed = new Set(proposal.changes.flatMap((change) => change.kind === "remove_block" ? [change.blockId] : []));
  const unchanged = input.blocks.flatMap((block) => {
    if (removed.has(block.id)) return [];
    const next = moved.get(block.id);
    return [{ ...block, ...(next ?? {}) }];
  });
  const added = proposal.changes.flatMap((change) => change.kind === "add_block" ? [change.block] : []);
  return [...unchanged, ...added];
}

function measureAutoWakeCandidate(
  minute: number,
  profilePatch: Partial<PlannerProfile>,
  proposal: PlannerProposal,
  input: PlannerEngineInput
): AutoWakeCandidate {
  const profile = normalizePlannerProfile({ ...input.profile, ...profilePatch, revision: input.profile.revision });
  const itemById = new Map(input.items.map((item) => [item.id, normalizePlannerItem(item)]));
  for (const change of proposal.changes) {
    if (change.kind === "add_item" || change.kind === "update_item") itemById.set(change.item.id, change.item);
  }
  const blocks = candidateBlocks(proposal, input);
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const recurringItemIds = new Set([...itemById.values()]
    .filter((item) => item.kind === "fixed_event" && item.recurrence?.startTime)
    .map((item) => item.id));
  const recurringConflictCount = proposal.conflicts.filter((conflict) => conflict.blockIds.some((blockId) => {
    const itemId = blockById.get(blockId)?.itemId;
    return Boolean(itemId && recurringItemIds.has(itemId));
  })).length;
  const nowMs = (input.now ?? new Date()).getTime();
  const flexible = blocks.filter((block) => !block.fixed
    && !["cancelled", "skipped", "done"].includes(block.status)
    && new Date(block.startAt).getTime() >= nowMs);
  let deadlineViolations = 0;
  let energyMismatchMinutes = 0;
  let placedMinutes = 0;
  const loadByDate = new Map<string, number>();
  for (const block of flexible) {
    const duration = isoDurationMinutes(block.startAt, block.endAt);
    const item = block.itemId ? itemById.get(block.itemId) : undefined;
    if (item?.deadlineAt && new Date(block.endAt).getTime() > new Date(item.deadlineAt).getTime()) deadlineViolations += 1;
    if (item) {
      const startMinute = plannerTimeToMinutes(formatTimeInTimeZone(new Date(block.startAt), profile.timezone));
      if (energyAt(profile, startMinute) !== item.energy) energyMismatchMinutes += duration;
    }
    const date = formatDateInTimeZone(new Date(block.startAt), profile.timezone);
    loadByDate.set(date, (loadByDate.get(date) ?? 0) + duration);
    placedMinutes += duration;
  }
  return {
    minute,
    profilePatch,
    proposal,
    recurringConflictCount,
    deadlineViolations,
    unplacedMinutes: proposal.unplaced.reduce((sum, item) => sum + item.remainingMinutes, 0),
    peakLoadMinutes: Math.max(0, ...loadByDate.values()),
    energyMismatchMinutes,
    placedMinutes,
  };
}

function resolveAutomaticWake(input: PlannerEngineInput): PlannerProposal | null {
  const baseProfile = normalizePlannerProfile(input.profile);
  const requestedProfile = normalizePlannerProfile({
    ...baseProfile,
    ...(input.profilePatch ?? {}),
    revision: baseProfile.revision,
  });
  const schedule = requestedProfile.sleepSchedule;
  if (schedule.mode !== "adaptive" || schedule.wakePreference.mode !== "any") return null;
  const trigger = input.trigger ?? (input.draft || input.drafts?.length ? "quick_add" : "autoplan");
  const shouldResolve = Boolean(input.profilePatch?.sleepSchedule)
    || Boolean(input.rebuildFuture && ["autoplan", "assistant_setup", "assistant_update"].includes(trigger));
  if (!shouldResolve) return null;

  const drafts = draftsForProposal(input);
  const draftItems = drafts.map((draft, index) => normalizePlannerItem({
    ...draft,
    id: draft.id || uniqueId("item", index, draft.title, draft.date, draft.start),
    title: draft.title,
  }));
  const planningItems = [...new Map([
    ...input.items.map((item) => normalizePlannerItem(item)),
    ...draftItems,
  ].map((item) => [item.id, item])).values()];
  const requirement = autoWakeRequirement(planningItems, schedule.morningPreparationMinutes);
  const initialWakeMinute = plannerTimeToMinutes(schedule.wakeAnchor.localTime);
  const derivedAvailability = availabilityFromSleepSchedule(schedule);
  const availabilityFollowsSleep = Boolean(input.profilePatch?.availability)
    || sameAvailability(requestedProfile.availability, derivedAvailability);
  const evaluateCandidate = (minute: number): AutoWakeCandidate => {
    const candidateSchedule = {
      ...schedule,
      wakeAnchor: {
        ...schedule.wakeAnchor,
        localTime: plannerMinutesToTime(minute),
        selectionReason: { code: "auto_default" as const },
      },
    };
    const profilePatch: Partial<PlannerProfile> = {
      ...(input.profilePatch ?? {}),
      sleepSchedule: candidateSchedule,
      availability: availabilityFollowsSleep
        ? availabilityFromSleepSchedule(candidateSchedule)
        : requestedProfile.availability,
      energyWindows: shiftEnergyWindows(requestedProfile, minute - initialWakeMinute),
    };
    const proposal = resolvePreferredSleepDuration({ ...input, profilePatch });
    return measureAutoWakeCandidate(minute, profilePatch, proposal, input);
  };
  const historyMinute = historicalWakeMinute(input.sleepEvents ?? [], requestedProfile);
  const neutralMinute = historyMinute ?? 9 * 60;
  const candidates = [evaluateCandidate(constrainWakeMinute(
    automaticWakeMinute(planningItems, requestedProfile, requirement, neutralMinute),
    schedule
  ))];
  const selected = candidates[0];
  const mostImportantFlexible = planningItems.filter((item) => item.kind !== "fixed_event" && item.status === "active")
    .sort((left, right) => priorityWeight[right.priority] - priorityWeight[left.priority]
      || (left.deadlineAt ?? "9999").localeCompare(right.deadlineAt ?? "9999")
      || left.id.localeCompare(right.id))[0];
  let reason: PlannerWakeAnchorReason;
  if (selected.recurringConflictCount > 0) {
    reason = {
      code: "fixed_conflict",
      relatedTitle: requirement?.title,
      relatedTime: requirement?.startTime,
      placedMinutes: selected.placedMinutes,
      unplacedMinutes: selected.unplacedMinutes,
    };
  } else if (requirement && requirement.minute < 9 * 60 && selected.minute <= requirement.minute) {
    reason = {
      code: "recurring_commitment",
      relatedTitle: requirement.title,
      relatedTime: requirement.startTime,
      placedMinutes: selected.placedMinutes,
      unplacedMinutes: selected.unplacedMinutes,
    };
  } else if (historyMinute !== undefined && selected.minute === historyMinute) {
    reason = {
      code: "sleep_history",
      placedMinutes: selected.placedMinutes,
      unplacedMinutes: selected.unplacedMinutes,
    };
  } else if (selected.minute === 9 * 60) {
    reason = {
      code: "auto_default",
      placedMinutes: selected.placedMinutes,
      unplacedMinutes: selected.unplacedMinutes,
    };
  } else {
    reason = {
      code: "plan_fit",
      relatedTitle: mostImportantFlexible?.title,
      placedMinutes: selected.placedMinutes,
      unplacedMinutes: selected.unplacedMinutes,
    };
  }
  const selectedSchedule = selected.profilePatch.sleepSchedule;
  if (!selectedSchedule || selectedSchedule.mode !== "adaptive") return selected.proposal;
  const finalSchedule = {
    ...selectedSchedule,
    wakeAnchor: { ...selectedSchedule.wakeAnchor, selectionReason: reason },
    wakePreference: {
      ...selectedSchedule.wakePreference,
      source: reason.code === "sleep_history" ? "history" as const
        : reason.code === "recurring_commitment" ? "commitment" as const
        : "neutral_default" as const,
    },
  };
  const finalProfilePatch = { ...selected.profilePatch, sleepSchedule: finalSchedule };
  const proposal = resolvePreferredSleepDuration({ ...input, profilePatch: finalProfilePatch });
  return {
    ...proposal,
    wakeAnchorDecision: {
      preference: "auto",
      wakeTime: finalSchedule.wakeAnchor.localTime,
      bedtime: plannerMinutesToTime(selected.minute - finalSchedule.targetDurationMinutes),
      targetDurationMinutes: finalSchedule.targetDurationMinutes,
      durationRange: finalSchedule.durationRange,
      reason,
      candidatesEvaluated: candidates.length,
    },
  };
}

function transferItemRank(item: PlannerItem | undefined): number {
  if (!item) return -1;
  const group = item.deadlineType === "hard" || item.commitmentLevel === "must_not_skip"
    ? 0
    : item.commitmentLevel === "required"
      ? 1
      : item.commitmentLevel === "desired"
        ? 2
        : 3;
  return group * 1_000_000 + item.planningRank * 100 - priorityWeight[item.priority];
}

function transferDates(
  profile: PlannerProfile,
  distribution: NonNullable<PlannerProposalInput["remainderTransfer"]>["distribution"],
  now: Date,
  includeToday = false
): { startDate: string; endDate: string; allowedDates?: string[]; targetDate?: string } {
  const today = formatDateInTimeZone(now, profile.timezone);
  const startDate = includeToday ? today : addPlannerDays(today, 1);
  const horizonEnd = addPlannerDays(today, horizonDays(profile.horizon) - 1);
  if (distribution.mode === "date") {
    if (distribution.date < startDate || distribution.date > horizonEnd) {
      throw new Error(includeToday
        ? "Выберите сегодня или будущую дату внутри горизонта планирования."
        : "Выберите будущую дату внутри горизонта планирования.");
    }
    return { startDate: distribution.date, endDate: distribution.date, targetDate: distribution.date };
  }
  if (distribution.mode === "spread_week") {
    const endDate = addPlannerDays(startDate, 7 - plannerWeekday(startDate));
    const allowedDates: string[] = [];
    for (let date = startDate; date <= endDate; date = addPlannerDays(date, 1)) allowedDates.push(date);
    return { startDate, endDate, allowedDates };
  }
  return { startDate, endDate: horizonEnd };
}

function transferAutoMinutesByDate(
  blocks: PlannerBlock[],
  items: Map<string, PlannerItem>,
  profile: PlannerProfile
): Map<string, number> {
  const result = new Map<string, number>();
  for (const block of blocks) {
    if (block.fixed || block.soft || ["cancelled", "skipped", "done"].includes(block.status)) continue;
    const date = formatDateInTimeZone(new Date(block.startAt), profile.timezone);
    const item = block.itemId ? items.get(block.itemId) : undefined;
    const minutes = item
      ? placementFootprintMinutes(item, isoDurationMinutes(block.startAt, block.endAt))
      : isoDurationMinutes(block.startAt, block.endAt);
    result.set(date, (result.get(date) ?? 0) + minutes);
  }
  return result;
}

function attemptRemainderPlacement(args: {
  item: PlannerItem;
  minutes: number;
  profile: PlannerProfile;
  occupied: PlannerBlock[];
  range: ReturnType<typeof transferDates>;
  now: Date;
  items: Map<string, PlannerItem>;
  occurrenceKey: string;
}): PlannerBlock[] {
  const { item, profile, range, now, items, occurrenceKey } = args;
  const occupied = [...args.occupied];
  const placed: PlannerBlock[] = [];
  const autoMinutesByDate = transferAutoMinutesByDate(occupied, items, profile);
  const energyShiftByDate = new Map<string, number>();
  let remaining = args.minutes;
  const minimumChunk = Math.min(remaining, Math.max(5, item.minChunkMinutes));
  const spreadTargets = range.allowedDates ?? [];
  const perDayTarget = spreadTargets.length
    ? Math.max(minimumChunk, Math.ceil(args.minutes / spreadTargets.length / STEP_MINUTES) * STEP_MINUTES)
    : undefined;

  const placeOne = (maximum: number, targetDate?: string): boolean => {
    const floor = Math.min(maximum, minimumChunk);
    for (let duration = maximum; duration >= floor; duration = Math.max(floor - 1, duration - STEP_MINUTES)) {
      const request: PlacementRequest = {
        item,
        occurrenceKey,
        durationMinutes: duration,
        tier: "required",
        mandatory: true,
        targetDate: targetDate ?? range.targetDate,
        allowedDates: targetDate ? undefined : range.allowedDates,
      };
      const placement = findPlacement(
        request,
        duration,
        profile,
        occupied,
        range.startDate,
        range.endDate,
        now.getTime(),
        autoMinutesByDate,
        items,
        energyShiftByDate
      );
      if (!placement) {
        if (duration === floor) break;
        continue;
      }
      const block: PlannerBlock = {
        id: uniqueId("remainder-block", occurrenceKey, placed.length + 1, placement.startAt),
        itemId: item.id,
        title: item.title,
        startAt: placement.startAt,
        endAt: placement.endAt,
        status: "planned",
        source: "auto",
        fixed: false,
        role: "work",
        soft: false,
        occurrenceKey: `${occurrenceKey}:part:${placed.length + 1}`,
      };
      occupied.push(block);
      placed.push(block);
      autoMinutesByDate.set(
        placement.date,
        (autoMinutesByDate.get(placement.date) ?? 0) + placementFootprintMinutes(item, duration)
      );
      remaining -= duration;
      return true;
    }
    return false;
  };

  if (spreadTargets.length) {
    for (const date of spreadTargets) {
      if (remaining <= 0) break;
      placeOne(Math.min(remaining, perDayTarget!), date);
    }
  }
  while (remaining > 0) {
    if (!placeOne(remaining)) break;
  }
  return placed;
}

function buildRemainderTransferProposal(input: PlannerEngineInput): PlannerProposal {
  const transfer = input.remainderTransfer!;
  const now = input.now ?? new Date();
  const normalizedProfile = normalizePlannerProfile(input.profile);
  const profile = input.planningFocusOverride
    ? { ...normalizedProfile, planningPolicy: { ...normalizedProfile.planningPolicy, focus: input.planningFocusOverride } }
    : normalizedProfile;
  const deferred = input.deferredRemainders ?? [];
  const existing = transfer.deferredRemainderId
    ? deferred.find((candidate) => candidate.id === transfer.deferredRemainderId)
    : undefined;
  if (transfer.deferredRemainderId && (!existing || existing.resolvedAt || existing.pendingMinutes <= 0)) {
    throw new Error("Этот остаток уже перенесён или больше не находится в Архиваторе дел.");
  }
  const sourceBlock = input.blocks.find((block) => block.id === (existing?.sourceBlockId ?? transfer.blockId));
  if (!sourceBlock) throw new Error("Исходный блок для переноса не найден.");
  if (!existing && ["done", "skipped", "cancelled"].includes(sourceBlock.status)) {
    throw new Error("Этот блок уже завершён и не может быть перенесён повторно.");
  }
  const item = input.items.find((candidate) => candidate.id === (existing?.itemId ?? sourceBlock.itemId));
  if (!item || item.kind === "fixed_event") throw new Error("Переносить остаток можно только у гибкого дела.");

  const sourceRemainingMinutes = existing?.pendingMinutes ?? Math.max(5,
    sourceBlock.status === "in_progress"
      ? Math.round((new Date(sourceBlock.endAt).getTime() - now.getTime()) / 60_000)
      : isoDurationMinutes(sourceBlock.startAt, sourceBlock.endAt)
  );
  const rawRequested = transfer.amount.mode === "percent"
    ? sourceRemainingMinutes * transfer.amount.percent / 100
    : transfer.amount.minutes;
  const requestedMinutes = transfer.amount.mode === "percent" && transfer.amount.percent === 100
    ? sourceRemainingMinutes
    : clamp(Math.round(rawRequested / STEP_MINUTES) * STEP_MINUTES, 5, sourceRemainingMinutes);
  const range = transferDates(profile, transfer.distribution, now, input.operation?.kind === "resolve_archiver_entry");
  const occurrenceKey = existing?.id ?? uniqueId("remainder", sourceBlock.id, now.toISOString());
  const transferItem = normalizePlannerItem({
    ...item,
    canSplit: true,
    minChunkMinutes: Math.min(item.minChunkMinutes, requestedMinutes),
    uncertaintyPolicy: {
      ...item.uncertaintyPolicy,
      date: { mode: "any" },
    },
  });
  const itemById = new Map(input.items.map((candidate) => [candidate.id, candidate]));
  itemById.set(transferItem.id, transferItem);
  const sleepPlan = buildPlannerSleepBlocks(profile, input.sleepEvents ?? [], range.startDate, range.endDate, now);
  const sleepBlocks: PlannerBlock[] = sleepPlan.map((block) => ({
    id: block.id,
    title: block.title,
    startAt: block.startAt,
    endAt: block.endAt,
    status: "planned",
    source: "auto",
    fixed: true,
    occurrenceKey: block.wakeDate,
  }));
  const baseOccupied = input.blocks.filter((block) => block.id !== sourceBlock.id
    && !["cancelled", "skipped", "done"].includes(block.status));
  const originalById = new Map(baseOccupied.map((block) => [block.id, block]));
  const moved = new Map<string, PlannerBlock>();
  const trimmed = new Map<string, PlannerBlock | null>();
  const adjustedBaseBlocks = (excludedId?: string) => baseOccupied.flatMap((block) => {
    if (block.id === excludedId) return [];
    if (trimmed.has(block.id)) {
      const modified = trimmed.get(block.id);
      return modified ? [modified] : [];
    }
    return [moved.get(block.id) ?? block];
  });
  let occupied = [...baseOccupied, ...sleepBlocks];
  let placementProfile = profile;
  let placements = attemptRemainderPlacement({
    item: transferItem, minutes: requestedMinutes, profile: placementProfile, occupied, range, now,
    items: itemById, occurrenceKey,
  });

  const mayDisplace = input.remainderDisplacementPolicy !== "forbid";
  const moveCandidates = mayDisplace ? baseOccupied.filter((block) => {
    if (block.fixed || block.soft || block.itemId === item.id || block.status !== "planned") return false;
    const candidateItem = block.itemId ? itemById.get(block.itemId) : undefined;
    const date = blockLocalDate(block, profile.timezone);
    return Boolean(candidateItem)
      && date >= range.startDate
      && date <= range.endDate
      && candidateItem!.deadlineType !== "hard"
      && candidateItem!.commitmentLevel !== "must_not_skip"
      && transferItemRank(candidateItem) > transferItemRank(item);
  }).sort((left, right) => transferItemRank(itemById.get(right.itemId!)) - transferItemRank(itemById.get(left.itemId!))
    || right.startAt.localeCompare(left.startAt)) : [];
  for (const candidate of moveCandidates) {
    const scheduledBefore = placements.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
    if (scheduledBefore >= requestedMinutes) break;
    const candidateItem = itemById.get(candidate.itemId!);
    if (!candidateItem) continue;
    const baseWithoutCandidate = adjustedBaseBlocks(candidate.id);
    const candidatePlacements = attemptRemainderPlacement({
      item: transferItem,
      minutes: requestedMinutes,
      profile: placementProfile,
      occupied: [...baseWithoutCandidate, ...sleepBlocks],
      range,
      now,
      items: itemById,
      occurrenceKey,
    });
    const scheduledAfterRemoval = candidatePlacements.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
    if (scheduledAfterRemoval <= scheduledBefore) continue;
    const candidateDuration = isoDurationMinutes(candidate.startAt, candidate.endAt);
    const candidateDate = blockLocalDate(candidate, profile.timezone);
    const candidateOccupied = [...baseWithoutCandidate, ...sleepBlocks, ...candidatePlacements];
    const replacement = findPlacement(
      {
        item: candidateItem,
        occurrenceKey: candidate.occurrenceKey ?? candidate.id,
        durationMinutes: candidateDuration,
        tier: "required",
        mandatory: candidateItem.commitmentLevel === "required",
        targetDate: candidateDate,
      },
      candidateDuration,
      placementProfile,
      candidateOccupied,
      range.startDate,
      range.endDate,
      now.getTime(),
      transferAutoMinutesByDate(candidateOccupied, itemById, placementProfile),
      itemById,
      new Map()
    );
    if (!replacement || (replacement.startAt === candidate.startAt && replacement.endAt === candidate.endAt)) continue;
    moved.set(candidate.id, { ...candidate, startAt: replacement.startAt, endAt: replacement.endAt });
    placements = candidatePlacements;
    occupied = [...adjustedBaseBlocks(), ...sleepBlocks];
  }

  const optionalCandidates = mayDisplace ? baseOccupied.filter((block) => {
    if (block.fixed || block.itemId === item.id || block.status !== "planned") return false;
    const candidateItem = block.itemId ? itemById.get(block.itemId) : undefined;
    if (!candidateItem || candidateItem.deadlineType === "hard" || candidateItem.commitmentLevel === "must_not_skip") return false;
    const optionalTier = Boolean(block.soft)
      || block.occurrenceKey?.includes(":reserve")
      || block.occurrenceKey?.includes(":extra")
      || block.occurrenceKey?.includes(":likely")
      || candidateItem.commitmentLevel === "desired"
      || candidateItem.commitmentLevel === "if_time"
      || candidateItem.recurrence?.schedulingMode === "spare_time";
    return optionalTier && transferItemRank(candidateItem) > transferItemRank(item);
  }).sort((left, right) => transferItemRank(itemById.get(right.itemId!)) - transferItemRank(itemById.get(left.itemId!))
    || right.startAt.localeCompare(left.startAt)) : [];

  const removableCandidates = optionalCandidates.filter((block) => block.soft
    || block.occurrenceKey?.includes(":reserve")
    || block.occurrenceKey?.includes(":extra"));
  for (const removable of removableCandidates) {
    if (placements.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0) >= requestedMinutes) break;
    trimmed.set(removable.id, null);
    occupied = [...adjustedBaseBlocks(), ...sleepBlocks];
    placements = attemptRemainderPlacement({
      item: transferItem, minutes: requestedMinutes, profile: placementProfile, occupied, range, now,
      items: itemById, occurrenceKey,
    });
  }

  let trimSteps = 0;
  while (placements.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0) < requestedMinutes
    && optionalCandidates.length > 0 && trimSteps < 200) {
    const original = optionalCandidates[trimSteps % optionalCandidates.length];
    const current = trimmed.has(original.id) ? trimmed.get(original.id) : moved.get(original.id) ?? original;
    trimSteps += 1;
    if (!current) continue;
    const duration = isoDurationMinutes(current.startAt, current.endAt);
    const removable = current.soft
      || current.occurrenceKey?.includes(":reserve")
      || current.occurrenceKey?.includes(":extra")
      || current.occurrenceKey?.includes(":likely");
    const minimum = removable ? 0 : Math.min(duration, itemById.get(current.itemId!)?.minChunkMinutes ?? STEP_MINUTES);
    if (duration <= minimum) continue;
    const nextDuration = Math.max(minimum, duration - STEP_MINUTES);
    trimmed.set(original.id, nextDuration <= 0 ? null : { ...current, endAt: addIsoMinutes(current.startAt, nextDuration) });
    occupied = [...adjustedBaseBlocks(), ...sleepBlocks];
    placements = attemptRemainderPlacement({
      item: transferItem, minutes: requestedMinutes, profile: placementProfile, occupied, range, now,
      items: itemById, occurrenceKey,
    });
  }

  const sleepChanges: PlannerProposalImpact["sleepChanges"] = [];
  const shortenedSleep = new Map<string, typeof sleepPlan[number]>();
  const mayBorrowSleep = profile.planningPolicy.focus === "work"
    && input.operation?.kind !== "resolve_archiver_entry"
    && (item.deadlineType === "hard" || item.commitmentLevel === "must_not_skip");
  if (mayBorrowSleep && placements.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0) < requestedMinutes) {
    const candidates = sleepPlan.filter((block) => block.selectedDurationMinutes > profile.planningPolicy.minimumNightMinutes);
    let index = 0;
    while (candidates.length > 0 && index < 200
      && placements.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0) < requestedMinutes) {
      const original = candidates[index % candidates.length];
      const current = shortenedSleep.get(original.wakeDate) ?? original;
      index += 1;
      if (current.selectedDurationMinutes <= profile.planningPolicy.minimumNightMinutes) continue;
      const next = {
        ...current,
        startAt: addIsoMinutes(current.startAt, STEP_MINUTES),
        selectedDurationMinutes: current.selectedDurationMinutes - STEP_MINUTES,
        borrowedMinutes: current.borrowedMinutes + STEP_MINUTES,
        selectionReason: "hard_deadline" as const,
      };
      shortenedSleep.set(original.wakeDate, next);
      placementProfile = extendEveningAvailability(placementProfile, original.wakeDate, STEP_MINUTES);
      const adjustedSleepBlocks = sleepBlocks.map((block) => {
        const wakeDate = block.occurrenceKey;
        const shortened = wakeDate ? shortenedSleep.get(wakeDate) : undefined;
        return shortened ? { ...block, startAt: shortened.startAt } : block;
      });
      occupied = [...adjustedBaseBlocks(), ...adjustedSleepBlocks];
      placements = attemptRemainderPlacement({
        item: transferItem, minutes: requestedMinutes, profile: placementProfile, occupied, range, now,
        items: itemById, occurrenceKey,
      });
    }
  }

  const scheduledMinutes = placements.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
  const pendingMinutes = Math.max(0, sourceRemainingMinutes - scheduledMinutes);
  const expiresAt = "9999-12-31T23:59:59.999Z";
  const remainder: PlannerDeferredRemainder = {
    id: existing?.id ?? occurrenceKey,
    itemId: item.id,
    sourceBlockId: existing?.sourceBlockId ?? sourceBlock.id,
    occurrenceKey: existing?.occurrenceKey ?? sourceBlock.occurrenceKey,
    title: item.title,
    totalMinutes: existing?.totalMinutes ?? sourceRemainingMinutes,
    pendingMinutes,
    scheduledMinutes: (existing?.scheduledMinutes ?? 0) + scheduledMinutes,
    createdAt: existing?.createdAt ?? now.toISOString(),
    expiresAt,
    resolvedAt: pendingMinutes === 0 ? now.toISOString() : undefined,
    resolution: pendingMinutes === 0 ? "scheduled" : undefined,
  };

  const changes: PlannerProposalChange[] = [];
  if (!existing) {
    changes.push({
      id: uniqueId("finish-remainder-source", sourceBlock.id, now.toISOString()),
      kind: "update_block_status",
      blockId: sourceBlock.id,
      title: sourceBlock.title,
      status: sourceBlock.status === "in_progress" ? "done" : "cancelled",
      actualStartAt: sourceBlock.status === "in_progress" ? sourceBlock.actualStartAt ?? sourceBlock.startAt : undefined,
      actualEndAt: sourceBlock.status === "in_progress" ? now.toISOString() : undefined,
      reason: sourceBlock.status === "in_progress"
        ? "Выполненная часть сохранена как факт; переносится только остаток."
        : "Исходный блок отменён только после подтверждения переноса.",
    });
  }
  for (const [blockId, relocated] of moved) {
    if (trimmed.has(blockId)) continue;
    const original = originalById.get(blockId);
    if (!original) continue;
    changes.push({
      id: uniqueId("move-for-remainder", original.id, relocated.startAt),
      kind: "move_block",
      blockId: original.id,
      title: original.title,
      fromStartAt: original.startAt,
      fromEndAt: original.endAt,
      toStartAt: relocated.startAt,
      toEndAt: relocated.endAt,
      reason: "Менее важный гибкий блок перенесён целиком, чтобы освободить место без сокращения.",
    });
  }
  const reductions: PlannerProposalImpact["reductions"] = [];
  for (const [blockId, modified] of trimmed) {
    const original = originalById.get(blockId);
    if (!original) continue;
    const removedMinutes = isoDurationMinutes(original.startAt, original.endAt)
      - (modified ? isoDurationMinutes(modified.startAt, modified.endAt) : 0);
    if (removedMinutes <= 0) continue;
    reductions.push({
      itemId: original.itemId,
      title: original.title,
      minutes: removedMinutes,
      reason: original.soft ? "soft_reserve" : "optional_work",
    });
    changes.push(modified ? {
      id: uniqueId("trim-remainder", original.id, modified.endAt),
      kind: "move_block",
      blockId: original.id,
      title: original.title,
      fromStartAt: original.startAt,
      fromEndAt: original.endAt,
      toStartAt: modified.startAt,
      toEndAt: modified.endAt,
      reason: `Менее важный гибкий блок сокращён на ${removedMinutes} мин, не затрагивая обязательный минимум.`,
    } : {
      id: uniqueId("remove-optional-remainder", original.id),
      kind: "remove_block",
      blockId: original.id,
      title: original.title,
      reason: "Необязательный гибкий блок освобождён для более важного остатка.",
    });
  }
  for (const block of placements) {
    changes.push({
      id: uniqueId("add-remainder", block.id),
      kind: "add_block",
      block,
      reason: "Остаток размещён в выбранном режиме без полной пересборки плана.",
    });
  }
  for (const shortened of shortenedSleep.values()) {
    const original = sleepPlan.find((candidate) => candidate.wakeDate === shortened.wakeDate)!;
    sleepChanges.push({
      wakeDate: shortened.wakeDate,
      fromMinutes: original.selectedDurationMinutes,
      toMinutes: shortened.selectedDurationMinutes,
    });
    const previous = (input.sleepEvents ?? []).find((event) => event.wakeDate === shortened.wakeDate);
    changes.push({
      id: uniqueId("remainder-sleep", shortened.wakeDate, shortened.selectedDurationMinutes),
      kind: "upsert_sleep_event",
      event: normalizePlannerSleepEvent({
        ...previous,
        wakeDate: shortened.wakeDate,
        eventKind: "planned_adjustment",
        state: "planned",
        plannedStartAt: shortened.startAt,
        plannedEndAt: shortened.endAt,
        plannedDurationMinutes: shortened.selectedDurationMinutes,
        selectionReason: "hard_deadline",
        borrowedMinutes: original.selectedDurationMinutes - shortened.selectedDurationMinutes,
      }),
      reason: "Сон сокращён только в режиме «Дедлайны важнее» и не ниже защищённого минимума.",
    });
  }
  changes.push({
    id: uniqueId(existing ? "update-remainder" : "add-remainder-queue", remainder.id, remainder.pendingMinutes),
    kind: existing ? "update_deferred_remainder" : "add_deferred_remainder",
    remainder,
    reason: pendingMinutes > 0
      ? "Неперенесённая часть сохранена в Архиваторе дел без срока истечения."
      : "Весь выбранный остаток получил время.",
  });

  const proposal: PlannerProposal = {
    baseRevision: profile.revision,
    trigger: "plans_changed",
    remainderTransfer: { ...transfer, sourceRemainingMinutes, requestedMinutes },
    changes,
    conflicts: [],
    unplaced: [],
    effectiveFocus: profile.planningPolicy.focus,
    effectiveFromAt: profile.planningPolicy.effectiveFromAt ?? now.toISOString(),
    horizonStart: formatDateInTimeZone(now, profile.timezone),
    horizonEnd: addPlannerDays(formatDateInTimeZone(now, profile.timezone), horizonDays(profile.horizon) - 1),
    impact: {
      kind: "remainder_transfer",
      itemId: item.id,
      title: item.title,
      sourceRemainingMinutes,
      requestedMinutes,
      scheduledMinutes,
      queuedMinutes: pendingMinutes,
      queueExpiresAt: pendingMinutes > 0 ? expiresAt : undefined,
      placements: placements.map((block) => ({
        itemId: block.itemId,
        title: block.title,
        startAt: block.startAt,
        endAt: block.endAt,
      })),
      moves: Array.from(moved.entries()).flatMap(([blockId, relocated]) => {
        const original = originalById.get(blockId);
        const final = trimmed.has(blockId) ? trimmed.get(blockId) : relocated;
        if (!original || !final || (original.startAt === final.startAt && original.endAt === final.endAt)) return [];
        return [{
          itemId: original.itemId,
          title: original.title,
          fromStartAt: original.startAt,
          fromEndAt: original.endAt,
          toStartAt: final.startAt,
          toEndAt: final.endAt,
        }];
      }),
      reductions,
      sleepChanges,
    },
  };
  const applied = applyProposalChanges(input.items, input.blocks, proposal);
  proposal.deadlineAnalysis = analyzePlannerDeadlines(
    input.items,
    applied.blocks,
    profile,
    now,
    input.deferredRemainders
  );
  return proposal;
}

function summarizeProposalImpact(input: PlannerEngineInput, proposal: PlannerProposal): PlannerProposalImpact {
  const removed = new Map(proposal.changes.flatMap((change) => {
    if (change.kind !== "remove_block") return [];
    const block = input.blocks.find((candidate) => candidate.id === change.blockId);
    return block ? [[change.blockId, block] as const] : [];
  }));
  const consumedRemoved = new Set<string>();
  const placements: PlannerProposalImpact["placements"] = [];
  const reductions: PlannerProposalImpact["reductions"] = proposal.changes.flatMap((change) => {
    if (change.kind !== "move_block" || change.fromStartAt !== change.toStartAt) return [];
    const minutes = isoDurationMinutes(change.fromStartAt, change.fromEndAt) - isoDurationMinutes(change.toStartAt, change.toEndAt);
    return minutes > 0 ? [{ itemId: input.blocks.find((block) => block.id === change.blockId)?.itemId, title: change.title, minutes, reason: "optional_work" as const }] : [];
  });
  const moves: PlannerProposalImpact["moves"] = proposal.changes.flatMap((change) => change.kind === "move_block"
    && (change.fromStartAt !== change.toStartAt || change.fromEndAt !== change.toEndAt)
    ? [{
        itemId: input.blocks.find((block) => block.id === change.blockId)?.itemId,
        title: change.title,
        fromStartAt: change.fromStartAt,
        fromEndAt: change.fromEndAt,
        toStartAt: change.toStartAt,
        toEndAt: change.toEndAt,
      }]
    : []);
  for (const change of proposal.changes) {
    if (change.kind !== "add_block" || change.block.soft) continue;
    const match = [...removed.values()].find((block) => !consumedRemoved.has(block.id)
      && block.itemId === change.block.itemId
      && (block.occurrenceKey ?? "") === (change.block.occurrenceKey ?? ""));
    if (match) {
      consumedRemoved.add(match.id);
      const reducedMinutes = isoDurationMinutes(match.startAt, match.endAt) - isoDurationMinutes(change.block.startAt, change.block.endAt);
      if (match.startAt === change.block.startAt && reducedMinutes > 0) {
        reductions.push({ itemId: change.block.itemId, title: change.block.title, minutes: reducedMinutes, reason: "optional_work" });
      }
      if (match.startAt !== change.block.startAt || match.endAt !== change.block.endAt) {
        moves.push({
          itemId: change.block.itemId,
          title: change.block.title,
          fromStartAt: match.startAt,
          fromEndAt: match.endAt,
          toStartAt: change.block.startAt,
          toEndAt: change.block.endAt,
        });
      }
    } else {
      placements.push({
        itemId: change.block.itemId,
        title: change.block.title,
        startAt: change.block.startAt,
        endAt: change.block.endAt,
      });
    }
  }
  const sleepChanges = proposal.changes.flatMap((change): PlannerProposalImpact["sleepChanges"] => {
    if (change.kind !== "upsert_sleep_event" || !change.event.plannedDurationMinutes) return [];
    const previous = (input.sleepEvents ?? []).find((event) => event.wakeDate === change.event.wakeDate);
    const fromMinutes = previous?.plannedDurationMinutes;
    if (fromMinutes === change.event.plannedDurationMinutes) return [];
    return [{
      wakeDate: change.event.wakeDate,
      fromMinutes: fromMinutes ?? change.event.plannedDurationMinutes,
      toMinutes: change.event.plannedDurationMinutes,
    }];
  });
  return { kind: "general", placements, moves, reductions, sleepChanges };
}

function summarizeProposalChanges(proposal: PlannerProposal): NonNullable<PlannerProposal["humanSummary"]> {
  const summary: NonNullable<PlannerProposal["humanSummary"]> = {
    additions: [],
    cancellations: [],
    moves: [],
    reductions: [],
    sleepChanges: [],
    freedIntervals: [],
  };
  for (const change of proposal.changes) {
    if (change.kind === "add_block" && !change.block.soft) {
      summary.additions.push(`${change.block.title}: ${change.block.startAt} — ${change.block.endAt}`);
    } else if (change.kind === "update_block_status" && change.status === "cancelled") {
      summary.cancellations.push(change.title);
    } else if (change.kind === "move_block") {
      summary.moves.push(`${change.title}: ${change.fromStartAt} → ${change.toStartAt}`);
      summary.freedIntervals.push(`${change.fromStartAt} — ${change.fromEndAt}`);
    } else if (change.kind === "remove_block") {
      summary.freedIntervals.push(change.title);
    } else if (change.kind === "upsert_sleep_event") {
      summary.sleepChanges.push(`${change.event.wakeDate}: ${change.event.plannedStartAt ?? change.event.actualStartAt ?? "?"} — ${change.event.plannedEndAt ?? change.event.actualEndAt ?? change.event.projectedEndAt ?? "?"}`);
    }
  }
  for (const reduction of proposal.impact?.reductions ?? []) {
    summary.reductions.push(`${reduction.title}: −${reduction.minutes} мин`);
  }
  return summary;
}

function buildArchiverResolutionProposal(input: PlannerEngineInput): PlannerProposal {
  const operation = input.operation;
  if (!operation || operation.kind !== "resolve_archiver_entry") {
    throw new Error("Не выбрана запись Архиватора дел.");
  }
  const now = input.now ?? new Date();
  const profile = normalizePlannerProfile(input.profile);
  const entry = (input.archiverEntries ?? []).find((candidate) => candidate.id === operation.entryId);
  if (!entry || entry.resolvedAt) throw new Error("Эта запись уже разобрана или больше не существует.");
  const item = entry.itemId ? input.items.find((candidate) => candidate.id === entry.itemId) : undefined;
  const sourceBlock = entry.sourceBlockId
    ? input.blocks.find((candidate) => candidate.id === entry.sourceBlockId)
    : undefined;

  if (operation.resolution.kind === "late_complete") {
    if (entry.category !== "missed" || !sourceBlock) {
      throw new Error("Отметить выполненным можно только пропущенное календарное дело.");
    }
    const actualMinutes = clamp(Math.round(operation.resolution.actualMinutes), 1, 600_000);
    const actualEndAt = sourceBlock.endAt;
    const actualStartAt = addIsoMinutes(actualEndAt, -actualMinutes);
    const changes: PlannerProposalChange[] = [{
      id: uniqueId("archiver-late-done", sourceBlock.id),
      kind: "update_block_status",
      blockId: sourceBlock.id,
      title: sourceBlock.title,
      status: "done",
      actualStartAt,
      actualEndAt,
      reason: "Пропуск исправлен на фактическое выполнение с указанной длительностью.",
    }, {
      id: uniqueId("archiver-resolve", entry.id, "late-completed"),
      kind: "upsert_archiver_entry",
      entry: {
        ...entry,
        pendingMinutes: 0,
        resolvedAt: now.toISOString(),
        resolution: "late_completed",
        outcomeNote: "Пользователь подтвердил, что дело было выполнено вовремя, но не отмечено.",
      },
      reason: "Запись исправлена на выполненную и больше не считается пропуском.",
    }];
    if (item && item.kind !== "routine" && (!item.recurrence || item.recurrence.frequency === "once")) {
      changes.push({
        id: uniqueId("archiver-complete-item", item.id), kind: "update_item",
        item: { ...item, status: "completed", unplacedReason: undefined },
        reason: "Одноразовое дело завершено после поздней отметки.",
      });
    }
    return {
      baseRevision: profile.revision, trigger: "constructor", operation, changes, conflicts: [], unplaced: [],
      effectiveFocus: profile.planningPolicy.focus,
      effectiveFromAt: profile.planningPolicy.effectiveFromAt ?? now.toISOString(),
      horizonStart: formatDateInTimeZone(now, profile.timezone),
      horizonEnd: addPlannerDays(formatDateInTimeZone(now, profile.timezone), horizonDays(profile.horizon) - 1),
    };
  }

  if (operation.resolution.kind === "reestimate") {
    const remainingMinutes = clamp(Math.round(operation.resolution.remainingMinutes), 5, 600_000);
    const changes: PlannerProposalChange[] = [{
      id: uniqueId("archiver-reestimate", entry.id, remainingMinutes),
      kind: "upsert_archiver_entry",
      entry: {
        ...entry,
        totalMinutes: Math.max(entry.scheduledMinutes + remainingMinutes, remainingMinutes),
        pendingMinutes: remainingMinutes,
        outcomeNote: `Оставшийся объём переоценён: ${remainingMinutes} мин.`,
      },
      reason: "Оставшийся объём уточнён без потери исходной причины попадания.",
    }];
    if (item) {
      changes.push({
        id: uniqueId("archiver-reestimate-item", item.id, remainingMinutes),
        kind: "update_item",
        item: normalizePlannerItem({
          ...item,
          estimateMinutes: entry.scheduledMinutes + remainingMinutes,
          uncertaintyPolicy: {
            ...item.uncertaintyPolicy,
            duration: {
              ...item.uncertaintyPolicy.duration,
              mode: "exact",
              minMinutes: entry.scheduledMinutes + remainingMinutes,
              likelyMinutes: entry.scheduledMinutes + remainingMinutes,
              maxMinutes: entry.scheduledMinutes + remainingMinutes,
            },
          },
        }),
        reason: "Оценка связанного дела синхронизирована с новым оставшимся объёмом.",
      });
    }
    return {
      baseRevision: profile.revision, trigger: "constructor", operation, changes, conflicts: [], unplaced: [],
      effectiveFocus: profile.planningPolicy.focus,
      effectiveFromAt: profile.planningPolicy.effectiveFromAt ?? now.toISOString(),
      horizonStart: formatDateInTimeZone(now, profile.timezone),
      horizonEnd: addPlannerDays(formatDateInTimeZone(now, profile.timezone), horizonDays(profile.horizon) - 1),
    };
  }

  if (operation.resolution.kind === "cancel") {
    const changes: PlannerProposalChange[] = [];
    const boundary = sourceBlock?.startAt ?? entry.occurredAt;
    for (const block of input.blocks) {
      if (!entry.itemId || block.itemId !== entry.itemId || block.status !== "planned") continue;
      const selected = operation.scope === "occurrence"
        ? Boolean(sourceBlock && block.id === sourceBlock.id)
        : operation.scope === "future" ? block.startAt >= boundary : new Date(block.startAt) > now;
      if (!selected) continue;
      changes.push({
        id: uniqueId("archiver-cancel-block", block.id), kind: "update_block_status",
        blockId: block.id, title: block.title, status: "cancelled",
        reason: "Будущее выполнение отменено при разборе Архиватора дел.",
      });
    }
    if (operation.scope === "item" && item) {
      changes.push({
        id: uniqueId("archiver-cancel-item", item.id), kind: "update_item",
        item: { ...item, status: "archived", unplacedReason: undefined },
        reason: "Всё дело отменено; выполненная и прошлая история сохранена.",
      });
    }
    const resolution = operation.scope === "item" ? "cancelled_item"
      : operation.scope === "future" ? "cancelled_future" : "cancelled_occurrence";
    changes.push({
      id: uniqueId("archiver-resolve", entry.id, resolution), kind: "upsert_archiver_entry",
      entry: { ...entry, pendingMinutes: 0, resolvedAt: now.toISOString(), resolution,
        outcomeNote: "Запись разобрана явной отменой; исходная причина сохранена для статистики." },
      reason: "Отмена сохранена отдельно от причины попадания в Архиватор дел.",
    });
    return {
      baseRevision: profile.revision, trigger: "constructor", operation, changes, conflicts: [], unplaced: [],
      effectiveFocus: profile.planningPolicy.focus,
      effectiveFromAt: profile.planningPolicy.effectiveFromAt ?? now.toISOString(),
      horizonStart: formatDateInTimeZone(now, profile.timezone),
      horizonEnd: addPlannerDays(formatDateInTimeZone(now, profile.timezone), horizonDays(profile.horizon) - 1),
    };
  }

  if (!item) throw new Error("Связанное дело больше не найдено.");
  const sourceRemainingMinutes = Math.max(1, entry.pendingMinutes);
  const requestedMinutes = operation.resolution.amount.mode === "percent"
    ? operation.resolution.amount.percent === 100 ? sourceRemainingMinutes
      : clamp(Math.round(sourceRemainingMinutes * operation.resolution.amount.percent / 100 / STEP_MINUTES) * STEP_MINUTES, 5, sourceRemainingMinutes)
    : clamp(Math.round(operation.resolution.amount.minutes), 5, sourceRemainingMinutes);
  let distribution: PlannerRemainderDistribution = { mode: "asap" };
  let schedulingItem = item;
  const placement = operation.resolution.placement;
  let replacementTarget: PlannerBlock | undefined;
  let replacementTargetItem: PlannerItem | undefined;
  if (placement.mode === "spread_week") distribution = { mode: "spread_week" };
  else if (placement.mode === "date") distribution = { mode: "date", date: placement.date };
  else if (placement.mode === "first_free") distribution = placement.date ? { mode: "date", date: placement.date } : { mode: "asap" };
  else {
    let exactAt: string;
    if (placement.mode === "exact") exactAt = zonedPlannerDateTimeToUtc(placement.date, placement.start, profile.timezone);
    else if (placement.mode === "replace") {
      replacementTarget = input.blocks.find((block) => block.id === placement.targetBlockId);
      if (!replacementTarget) throw new Error("Выбранное для замены дело больше не найдено.");
      if (replacementTarget.id === sourceBlock?.id || replacementTarget.itemId === item.id) {
        throw new Error("Нельзя заменить дело той же записью Архиватора.");
      }
      if (replacementTarget.status !== "planned" || new Date(replacementTarget.startAt) <= now) {
        throw new Error("Заменять можно только будущее дело, которое ещё не началось.");
      }
      if (!replacementTarget.itemId || replacementTarget.soft || (replacementTarget.role && replacementTarget.role !== "work")) {
        throw new Error("Сон, резервы и служебные интервалы нельзя заменять через Архиватор дел.");
      }
      replacementTargetItem = input.items.find((candidate) => candidate.id === replacementTarget!.itemId);
      if (!replacementTargetItem) throw new Error("Связанное с выбранным блоком дело больше не найдено.");
      exactAt = replacementTarget.startAt;
    }
    else {
      const anchor = input.blocks.find((block) => block.id === placement.anchorBlockId);
      if (!anchor) throw new Error("Опорное дело больше не найдено.");
      const gap = placement.gapMinutes ?? profile.defaultBufferMinutes;
      exactAt = placement.mode === "after" ? addIsoMinutes(anchor.endAt, gap) : addIsoMinutes(anchor.startAt, -gap - requestedMinutes);
    }
    const exactDate = formatDateInTimeZone(new Date(exactAt), profile.timezone);
    const exactStart = formatTimeInTimeZone(new Date(exactAt), profile.timezone);
    distribution = { mode: "date", date: exactDate };
    schedulingItem = normalizePlannerItem({
      ...item,
      uncertaintyPolicy: {
        ...item.uncertaintyPolicy,
        date: { mode: "exact", exactDate },
        time: { mode: "exact", exactStart },
      },
    });
  }
  const typedConflictDecisions = operation.resolution.conflictDecisions ?? [];
  const priorityInsertion = operation.resolution.strategy === "priority" || placement.mode === "replace";
  const keepExisting = typedConflictDecisions.some((decision) => decision.disposition === "keep")
    || (input.decisions ?? []).some((decision) => decision.optionId.startsWith("keep:"));
  if (placement.mode === "replace" && !keepExisting) {
    schedulingItem = normalizePlannerItem({
      ...schedulingItem, commitmentLevel: "must_not_skip", priority: "critical", planningRank: 0,
    });
  } else if (operation.resolution.strategy === "safe" || keepExisting) {
    schedulingItem = normalizePlannerItem({
      ...schedulingItem, commitmentLevel: "if_time", priority: "low", planningRank: 1_000_000,
    });
  }
  const protectedReplacement = Boolean(replacementTarget && replacementTargetItem
    && (replacementTarget.fixed || replacementTargetItem.deadlineType === "hard"
      || replacementTargetItem.commitmentLevel === "must_not_skip"));
  const replacementGroupId = replacementTarget ? `archiver-conflict:${replacementTarget.id}` : undefined;
  const replacementSelection = replacementGroupId
    ? typedConflictDecisions.find((decision) => decision.blockId === replacementTarget!.id)?.disposition
      ?? (input.decisions ?? []).find((decision) => decision.groupId === replacementGroupId)?.optionId.split(":", 1)[0]
    : undefined;
  const removeProtectedReplacementForPreview = protectedReplacement
    && replacementSelection !== "keep";
  const transferBlocks = removeProtectedReplacementForPreview
    ? input.blocks.map((block) => block.id === replacementTarget!.id ? { ...block, status: "cancelled" as const } : block)
    : input.blocks;
  const virtualSource: PlannerBlock = sourceBlock ?? {
    id: `archiver-source:${entry.id}`, itemId: item.id, title: item.title,
    startAt: entry.occurredAt, endAt: addIsoMinutes(entry.occurredAt, Math.max(1, entry.totalMinutes)),
    status: "cancelled", source: "auto", fixed: false, role: "work", occurrenceKey: entry.occurrenceKey,
  };
  const deferred: PlannerDeferredRemainder = {
    id: entry.id, itemId: item.id, sourceBlockId: virtualSource.id, occurrenceKey: entry.occurrenceKey,
    title: item.title, totalMinutes: entry.totalMinutes, pendingMinutes: entry.pendingMinutes,
    scheduledMinutes: entry.scheduledMinutes, createdAt: entry.createdAt,
    expiresAt: "9999-12-31T23:59:59.999Z",
  };
  const proposal = buildRemainderTransferProposal({
    ...input,
    operation,
    items: input.items.map((candidate) => candidate.id === schedulingItem.id ? schedulingItem : candidate),
    blocks: sourceBlock ? transferBlocks : [...transferBlocks, virtualSource],
    deferredRemainders: [...(input.deferredRemainders ?? []).filter((candidate) => candidate.id !== deferred.id), deferred],
    remainderDisplacementPolicy: priorityInsertion && !keepExisting && !protectedReplacement ? "allow" : "forbid",
    remainderTransfer: {
      blockId: virtualSource.id,
      deferredRemainderId: deferred.id,
      amount: operation.resolution.amount,
      distribution,
    },
  });
  const scheduledMinutes = proposal.impact?.scheduledMinutes ?? 0;
  const pendingMinutes = Math.max(0, entry.pendingMinutes - scheduledMinutes);
  proposal.operation = operation;
  proposal.remainderTransfer = undefined;
  proposal.changes.push({
    id: uniqueId("archiver-schedule", entry.id, pendingMinutes), kind: "upsert_archiver_entry",
    entry: {
      ...entry,
      pendingMinutes,
      scheduledMinutes: entry.scheduledMinutes + scheduledMinutes,
      returnedAt: entry.returnedAt ?? (scheduledMinutes > 0 ? now.toISOString() : undefined),
      resolvedAt: pendingMinutes === 0 ? now.toISOString() : undefined,
      resolution: pendingMinutes === 0 ? "scheduled" : undefined,
      outcomeNote: pendingMinutes === 0
        ? "Весь объём возвращён в подтверждённый план."
        : "Часть объёма возвращена в план; остаток продолжает ждать решения.",
    },
    reason: "Состояние Архиватора дел обновлено атомарно вместе с календарём.",
  });
  if (protectedReplacement && replacementTarget && replacementGroupId) {
    const archiveId = `archive:${replacementTarget.id}`;
    const cancelId = `cancel:${replacementTarget.id}`;
    const keepId = `keep:${replacementTarget.id}`;
    const selectedOptionId = replacementSelection
      ? `${replacementSelection}:${replacementTarget.id}`
      : undefined;
    const accepted = selectedOptionId === archiveId || selectedOptionId === cancelId || selectedOptionId === keepId;
    if (selectedOptionId === archiveId || selectedOptionId === cancelId || !selectedOptionId) {
      proposal.changes.push({
        id: uniqueId("archiver-protected-replacement", replacementTarget.id, selectedOptionId ?? "preview"),
        kind: "update_block_status",
        blockId: replacementTarget.id,
        title: replacementTarget.title,
        status: "cancelled",
        reason: selectedOptionId === archiveId
          ? "Пользователь отдельно подтвердил отправку выбранного обязательного дела в Архиватор дел."
          : selectedOptionId === cancelId
            ? "Пользователь отдельно подтвердил отмену выбранного обязательного дела."
            : "Предварительное освобождение места требует отдельного подтверждения судьбы защищённого дела.",
      });
      if (selectedOptionId === archiveId) {
        const minutes = Math.max(1, isoDurationMinutes(replacementTarget.startAt, replacementTarget.endAt));
        proposal.changes.push({
          id: uniqueId("archiver-protected-displaced", replacementTarget.id),
          kind: "upsert_archiver_entry",
          entry: {
            id: `displaced:${replacementTarget.id}`,
            category: "no_slot",
            origin: "displaced",
            itemId: replacementTarget.itemId,
            sourceBlockId: replacementTarget.id,
            occurrenceKey: replacementTarget.occurrenceKey,
            title: replacementTarget.title,
            reason: `Освобождено место для «${entry.title}»; защищённое дело ожидает нового решения.`,
            totalMinutes: minutes,
            pendingMinutes: minutes,
            scheduledMinutes: 0,
            occurredAt: now.toISOString(),
            createdAt: now.toISOString(),
          },
          reason: "Вытеснённое защищённое дело сохранено в Архиваторе без срока истечения.",
        });
      }
    }
    proposal.decisionGroups = [{
      id: replacementGroupId,
      title: replacementTarget.title,
      message: replacementTarget.fixed || replacementTargetItem?.deadlineType === "hard"
        || replacementTargetItem?.commitmentLevel === "must_not_skip"
        ? "Это фиксированное, дедлайновое или обязательное дело. Отдельно подтвердите, что с ним произойдёт."
        : "Отдельно подтвердите судьбу заменяемого дела.",
      blocking: !accepted,
      selectedOptionId: accepted ? selectedOptionId : undefined,
      options: [
        { id: archiveId, kind: "queue", title: "Отправить в Архиватор", description: "Освободить выбранное время, но сохранить дело для дальнейшего разбора." },
        { id: cancelId, kind: "cancel", title: "Отменить это выполнение", description: "Отменить только выбранный календарный блок с сохранением истории." },
        { id: keepId, kind: "keep", title: "Оставить без изменений", description: "Не трогать защищённый блок; неразмещённый объём останется в Архиваторе." },
      ],
    }];
    proposal.decisions = input.decisions;
    const refreshed = summarizeProposalImpact(input, proposal);
    if (proposal.impact) proposal.impact = { ...proposal.impact, moves: refreshed.moves, reductions: refreshed.reductions, sleepChanges: refreshed.sleepChanges };
    return proposal;
  }
  if (priorityInsertion && !keepExisting) {
    const selected = new Map((input.decisions ?? []).map((decision) => [decision.groupId, decision.optionId]));
    for (const decision of typedConflictDecisions) {
      selected.set(`archiver-conflict:${decision.blockId}`, `${decision.disposition}:${decision.blockId}`);
    }
    const affectedChanges = proposal.changes.filter((change): change is Extract<PlannerProposalChange, { kind: "move_block" | "remove_block" }> =>
      (change.kind === "move_block" || change.kind === "remove_block")
      && (change.reason.includes("Менее важный") || change.reason.includes("Необязательный")));
    const groups: NonNullable<PlannerProposal["decisionGroups"]> = [];
    for (const affected of affectedChanges) {
      const block = input.blocks.find((candidate) => candidate.id === affected.blockId);
      if (!block) continue;
      const groupId = `archiver-conflict:${block.id}`;
      const optionId = selected.get(groupId);
      const proposedKind = affected.kind === "move_block" && affected.toStartAt !== affected.fromStartAt ? "move" : "shorten";
      const acceptId = `${proposedKind}:${block.id}`;
      const archiveId = `archive:${block.id}`;
      const cancelId = `cancel:${block.id}`;
      const keepId = `keep:${block.id}`;
      if (optionId === archiveId || optionId === cancelId) {
        const index = proposal.changes.indexOf(affected);
        proposal.changes.splice(index, 1, {
          id: uniqueId("archiver-displaced-cancel", block.id, optionId),
          kind: "update_block_status",
          blockId: block.id,
          title: block.title,
          status: "cancelled",
          reason: optionId === archiveId
            ? "Пользователь явно отправил вытеснённое дело в Архиватор дел."
            : "Пользователь явно отменил вытеснённое дело.",
        });
        if (optionId === archiveId) {
          const minutes = Math.max(1, isoDurationMinutes(block.startAt, block.endAt));
          proposal.changes.push({
            id: uniqueId("archiver-displaced", block.id),
            kind: "upsert_archiver_entry",
            entry: {
              id: `displaced:${block.id}`,
              category: "no_slot",
              origin: "displaced",
              itemId: block.itemId,
              sourceBlockId: block.id,
              occurrenceKey: block.occurrenceKey,
              title: block.title,
              reason: `Освобождено место для «${entry.title}»; это дело ожидает нового решения.`,
              totalMinutes: minutes,
              pendingMinutes: minutes,
              scheduledMinutes: 0,
              occurredAt: now.toISOString(),
              createdAt: now.toISOString(),
            },
            reason: "Вытеснённое дело не потеряно и сохранено без штрафа как дело без места.",
          });
        }
      }
      groups.push({
        id: groupId,
        title: block.title,
        message: proposedKind === "move"
          ? "Для приоритетной вставки это дело нужно перенести. Подтвердите его судьбу."
          : "Для приоритетной вставки это дело нужно сократить или убрать. Подтвердите его судьбу.",
        blocking: optionId !== acceptId && optionId !== archiveId && optionId !== cancelId && optionId !== keepId,
        selectedOptionId: optionId,
        options: [
          { id: acceptId, kind: proposedKind, title: proposedKind === "move" ? "Подтвердить перенос" : "Подтвердить сокращение", description: affected.reason },
          { id: archiveId, kind: "queue", title: "Отправить в Архиватор", description: "Дело не потеряется и останется без срока истечения." },
          { id: cancelId, kind: "cancel", title: "Отменить", description: "Выполнение будет отменено с сохранением истории." },
          { id: keepId, kind: "keep", title: "Оставить как есть", description: "Сохранить этот блок и использовать только оставшееся безопасное место." },
        ],
      });
    }
    proposal.decisionGroups = groups;
    proposal.decisions = input.decisions;
    const refreshed = summarizeProposalImpact(input, proposal);
    if (proposal.impact) {
      proposal.impact = {
        ...proposal.impact,
        moves: refreshed.moves,
        reductions: refreshed.reductions,
        sleepChanges: refreshed.sleepChanges,
      };
    }
  }
  return proposal;
}

export function buildPlannerProposal(input: PlannerEngineInput): PlannerProposal {
  if (input.operation?.kind === "resolve_archiver_entry") {
    const proposal = buildArchiverResolutionProposal(input);
    const withImpact = proposal.impact ? proposal : { ...proposal, impact: summarizeProposalImpact(input, proposal) };
    return { ...withImpact, humanSummary: summarizeProposalChanges(withImpact) };
  }
  const prepared = prepareConstructorInput(input);
  if (prepared.remainderTransfer) return buildRemainderTransferProposal(prepared);
  const proposal = resolveAutomaticWake(prepared) ?? resolvePreferredSleepDuration(prepared);
  const impact = summarizeProposalImpact(prepared, proposal);
  const withImpact = { ...proposal, impact };
  return { ...withImpact, humanSummary: summarizeProposalChanges(withImpact) };
}

export function applyProposalChanges(
  items: PlannerItem[],
  blocks: PlannerBlock[],
  proposal: PlannerProposal
): { items: PlannerItem[]; blocks: PlannerBlock[] } {
  if (proposal.conflicts.length > 0 || proposal.decisionGroups?.some((group) => group.blocking)) {
    throw new Error("Нельзя применить предложение с нерешёнными конфликтами или обязательными решениями.");
  }
  let nextItems = [...items];
  let nextBlocks = [...blocks];
  for (const change of proposal.changes) {
    if (change.kind === "add_item" || change.kind === "update_item") nextItems = [...nextItems.filter((item) => item.id !== change.item.id), change.item];
    else if (change.kind === "add_block" || change.kind === "update_block") nextBlocks = [...nextBlocks.filter((block) => block.id !== change.block.id), change.block];
    else if (change.kind === "move_block") {
      nextBlocks = nextBlocks.map((block) => block.id === change.blockId
        ? { ...block, startAt: change.toStartAt, endAt: change.toEndAt, source: "auto" }
        : block);
    } else if (change.kind === "remove_block") nextBlocks = nextBlocks.filter((block) => block.id !== change.blockId);
    else if (change.kind === "update_block_status") {
      nextBlocks = nextBlocks.map((block) => block.id === change.blockId
        ? {
            ...block,
            status: change.status,
            actualStartAt: change.actualStartAt ?? block.actualStartAt,
            actualEndAt: change.actualEndAt ?? block.actualEndAt,
          }
        : block);
    }
  }
  return { items: nextItems, blocks: nextBlocks };
}

export function annotateTentativeBlocks(items: PlannerItem[], blocks: PlannerBlock[]): PlannerBlock[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const groupRank = (item: PlannerItem | undefined) => {
    if (!item) return 99_000_000;
    const group = item.deadlineType === "hard" || item.commitmentLevel === "must_not_skip"
      ? 0
      : item.commitmentLevel === "required"
        ? 1
        : item.commitmentLevel === "desired"
          ? 2
          : 3;
    return group * 1_000_000 + item.planningRank;
  };
  const reserves = blocks.filter((block) => block.soft && block.status === "planned");
  return blocks.map((block) => {
    if (block.soft || block.status !== "planned") return { ...block, tentative: false, tentativeReason: undefined };
    const blockRank = groupRank(block.itemId ? byId.get(block.itemId) : undefined);
    const reserve = reserves.find((candidate) => {
      if (candidate.itemId === block.itemId || groupRank(candidate.itemId ? byId.get(candidate.itemId) : undefined) >= blockRank) return false;
      return rangesOverlap(blockInterval(block), blockInterval(candidate));
    });
    return {
      ...block,
      tentative: Boolean(reserve),
      tentativeReason: reserve ? {
        reserveBlockId: reserve.id,
        reserveItemId: reserve.itemId,
        reserveTitle: reserve.title,
        latestAt: reserve.endAt,
      } : undefined,
    };
  });
}

export function plannerCalibrationProgress(items: PlannerItem[], blocks: PlannerBlock[], now = new Date()): PlannerCalibrationProgress[] {
  return items.flatMap((item): PlannerCalibrationProgress[] => {
    if (item.uncertaintyPolicy.duration.mode !== "unknown") return [];
    const targetMinutes = item.uncertaintyPolicy.duration.calibrationMinutes ?? item.uncertaintyPolicy.duration.likelyMinutes;
    const calibrationBlocks = blocks.filter((block) => block.itemId === item.id && block.role === "calibration" && !block.soft);
    const completedMinutes = calibrationBlocks.filter((block) => block.status === "done")
      .reduce((sum, block) => sum + accountedBlockMinutes(block), 0);
    const plannedMinutes = calibrationBlocks.filter((block) => block.status === "in_progress"
      || block.status === "planned" && new Date(block.endAt) > now)
      .reduce((sum, block) => sum + accountedBlockMinutes(block), 0);
    return [{
      itemId: item.id,
      targetMinutes,
      completedMinutes,
      plannedMinutes,
      remainingMinutes: Math.max(0, targetMinutes - completedMinutes - plannedMinutes),
      complete: completedMinutes >= targetMinutes,
    }];
  });
}

function planningReasonCode(reason: string | undefined): PlannerUnplaced["reasonCode"] {
  if (!reason) return undefined;
  if (/резерв|reserve/i.test(reason)) return "reserve";
  if (/переход|transition|buffer/i.test(reason)) return "transition";
  if (/сон|sleep/i.test(reason)) return "sleep";
  if (/фиксирован|fixed/i.test(reason)) return "fixed_event";
  if (/границ.*дн|day bound/i.test(reason)) return "day_bounds";
  return "window";
}

export function plannerItemPlanningStates(items: PlannerItem[], blocks: PlannerBlock[], now = new Date()): PlannerItemPlanningState[] {
  const calibrationByItem = new Map(plannerCalibrationProgress(items, blocks, now).map((entry) => [entry.itemId, entry]));
  return items.filter((item) => item.status === "active").map((item) => {
    const itemBlocks = blocks.filter((block) => block.itemId === item.id && !block.soft);
    const completedMinutes = itemBlocks.filter((block) => block.status === "done")
      .reduce((sum, block) => sum + accountedBlockMinutes(block), 0);
    const plannedMinutes = itemBlocks.filter((block) => block.status === "in_progress"
      || block.status === "planned" && new Date(block.endAt) > now)
      .reduce((sum, block) => sum + accountedBlockMinutes(block), 0);
    const calibration = calibrationByItem.get(item.id);
    const requestedMinutes = calibration?.targetMinutes ?? item.uncertaintyPolicy.duration.likelyMinutes;
    const remainingMinutes = calibration
      ? calibration.remainingMinutes
      : Math.max(0, requestedMinutes - completedMinutes - plannedMinutes);
    const state: PlannerItemPlanningState["state"] = completedMinutes >= requestedMinutes
      ? "complete"
      : remainingMinutes <= 0
        ? "planned"
        : plannedMinutes > 0
          ? "partial"
          : "queued";
    return {
      itemId: item.id,
      requestedMinutes,
      plannedMinutes,
      completedMinutes,
      remainingMinutes,
      state,
      reason: item.unplacedReason,
      reasonCode: planningReasonCode(item.unplacedReason),
    };
  });
}

export function reconcilePlannerArchiverEntries(
  items: PlannerItem[],
  blocks: PlannerBlock[],
  existingEntries: PlannerArchiverEntry[],
  now = new Date()
): { entries: PlannerArchiverEntry[]; missedBlockIds: string[] } {
  const existingIds = new Set(existingEntries.map((entry) => entry.id));
  const unresolvedItemIds = new Set(existingEntries.flatMap((entry) => !entry.resolvedAt && entry.pendingMinutes > 0 && entry.itemId
    ? [entry.itemId]
    : []));
  const entries: PlannerArchiverEntry[] = [];
  const missedBlockIds: string[] = [];
  const nowMs = now.getTime();
  const graceCutoff = now.getTime() - 15 * 60_000;

  for (const block of blocks) {
    if (block.status !== "planned" || block.soft || !block.itemId) continue;
    if (block.role && block.role !== "work" && block.role !== "calibration") continue;
    const endMs = new Date(block.endAt).getTime();
    if (endMs > graceCutoff) {
      if (endMs <= nowMs) unresolvedItemIds.add(block.itemId);
      continue;
    }
    const item = items.find((candidate) => candidate.id === block.itemId);
    if (!item || item.status === "archived") continue;
    const id = `missed:${block.id}`;
    if (existingIds.has(id)) continue;
    const minutes = Math.max(1, isoDurationMinutes(block.startAt, block.endAt));
    entries.push({
      id, category: "missed", origin: "unacknowledged", itemId: block.itemId,
      sourceBlockId: block.id, occurrenceKey: block.occurrenceKey, title: block.title,
      reason: "Дело закончилось более 15 минут назад и не было отмечено.",
      totalMinutes: minutes, pendingMinutes: minutes, scheduledMinutes: 0,
      occurredAt: block.endAt, createdAt: now.toISOString(),
    });
    existingIds.add(id);
    unresolvedItemIds.add(block.itemId);
    missedBlockIds.push(block.id);
  }

  const planningStateByItem = new Map(plannerItemPlanningStates(items, blocks, now).map((state) => [state.itemId, state]));
  for (const item of items) {
    if (item.status !== "active" || item.kind === "fixed_event" || unresolvedItemIds.has(item.id)) continue;
    const planningState = planningStateByItem.get(item.id);
    const minutes = Math.max(0, planningState?.remainingMinutes ?? item.uncertaintyPolicy.duration.likelyMinutes);
    if (minutes === 0) continue;
    const occurredAt = item.updatedAt ?? item.createdAt ?? now.toISOString();
    const entry: PlannerArchiverEntry = {
      id: uniqueId("unplaced-reconcile", item.id, occurredAt),
      category: "no_slot",
      origin: "unplaced",
      itemId: item.id,
      title: item.title,
      reason: item.unplacedReason ?? "Активный оставшийся объём не был размещён до первого запуска Архиватора дел.",
      totalMinutes: Math.max(minutes, planningState?.requestedMinutes ?? minutes),
      pendingMinutes: minutes,
      scheduledMinutes: planningState?.plannedMinutes ?? 0,
      occurredAt,
      createdAt: now.toISOString(),
    };
    entries.push(entry);
    existingIds.add(entry.id);
    unresolvedItemIds.add(item.id);
  }
  return { entries, missedBlockIds };
}

export function plannerCompletionSuggestion(item: PlannerItem, blocks: PlannerBlock[]): number | null {
  if (item.uncertaintyPolicy.duration.mode === "unknown") {
    const target = item.uncertaintyPolicy.duration.calibrationMinutes ?? item.uncertaintyPolicy.duration.likelyMinutes;
    const completed = blocks
      .filter((block) => block.itemId === item.id && block.role === "calibration" && block.status === "done")
      .reduce((sum, block) => sum + accountedBlockMinutes(block), 0);
    if (completed < target) return null;
  }
  const samples = blocks
    .filter((block) => block.itemId === item.id && block.status === "done" && !block.soft && block.actualStartAt && block.actualEndAt)
    .map((block) => isoDurationMinutes(block.actualStartAt!, block.actualEndAt!))
    .filter((duration) => duration >= 5)
    .sort((left, right) => left - right);
  if (samples.length < 3) return null;
  const median = samples[Math.floor(samples.length / 2)];
  return Math.abs(median - item.estimateMinutes) >= 10 ? median : null;
}

export function plannerCompletionRangeSuggestion(
  item: PlannerItem,
  blocks: PlannerBlock[]
): { minMinutes: number; likelyMinutes: number; maxMinutes: number; sampleCount: number } | null {
  if (item.uncertaintyPolicy.duration.mode === "unknown") {
    const target = item.uncertaintyPolicy.duration.calibrationMinutes ?? item.uncertaintyPolicy.duration.likelyMinutes;
    const completed = blocks
      .filter((block) => block.itemId === item.id && block.role === "calibration" && block.status === "done")
      .reduce((sum, block) => sum + accountedBlockMinutes(block), 0);
    if (completed < target) return null;
  }
  const samples = blocks
    .filter((block) => block.itemId === item.id && block.status === "done" && !block.soft && block.actualStartAt && block.actualEndAt)
    .map((block) => isoDurationMinutes(block.actualStartAt!, block.actualEndAt!))
    .filter((duration) => duration >= 5)
    .sort((left, right) => left - right);
  if (samples.length < 3) return null;
  const percentile = (ratio: number) => samples[Math.min(samples.length - 1, Math.round((samples.length - 1) * ratio))];
  const roundFive = (value: number) => Math.max(5, Math.round(value / 5) * 5);
  const suggestion = {
    minMinutes: roundFive(percentile(0.2)),
    likelyMinutes: roundFive(percentile(0.5)),
    maxMinutes: roundFive(percentile(0.8)),
    sampleCount: samples.length,
  };
  suggestion.minMinutes = Math.min(suggestion.minMinutes, suggestion.likelyMinutes);
  suggestion.maxMinutes = Math.max(suggestion.maxMinutes, suggestion.likelyMinutes);
  const current = item.uncertaintyPolicy.duration;
  return Math.abs(current.minMinutes - suggestion.minMinutes) >= 10
    || Math.abs(current.likelyMinutes - suggestion.likelyMinutes) >= 10
    || Math.abs(current.maxMinutes - suggestion.maxMinutes) >= 10
    ? suggestion
    : null;
}
