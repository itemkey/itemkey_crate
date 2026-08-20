import {
  DEFAULT_PLANNER_SLEEP_SCHEDULE,
  type PlannerAdaptiveSleepSchedule,
  type PlannerAvailability,
  type PlannerBlock,
  type PlannerDraft,
  type PlannerFixedSleepSchedule,
  type PlannerProfile,
  type PlannerSleepBlock,
  type PlannerSleepEvent,
  type PlannerSleepRule,
  type PlannerSleepSchedule,
  type PlannerWakeAnchorReason,
  type PlannerWakeDayPart,
} from "./types.ts";
import {
  addIsoMinutes,
  addPlannerDays,
  isoDurationMinutes,
  normalizePlannerTime,
  plannerMinutesToTime,
  plannerTimeToMinutes,
  plannerWeekday,
  zonedPlannerDateTimeToUtc,
} from "./time.ts";

const MIN_RECOMMENDED_SLEEP_MINUTES = 7 * 60;
const DEFAULT_TARGET_SLEEP_MINUTES = 8 * 60;

export const PLANNER_WAKE_DAY_PARTS: Record<PlannerWakeDayPart, {
  start: string;
  end: string;
  defaultTime: string;
}> = {
  early_morning: { start: "06:30", end: "08:00", defaultTime: "07:30" },
  morning: { start: "08:00", end: "10:00", defaultTime: "09:00" },
  late_morning: { start: "10:00", end: "12:00", defaultTime: "11:00" },
  auto: { start: "06:30", end: "12:00", defaultTime: "09:00" },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRule(value: Partial<PlannerSleepRule> | null | undefined): PlannerSleepRule {
  return {
    bedtime: normalizePlannerTime(value?.bedtime) ?? "23:00",
    durationMinutes: clamp(Math.round(Number(value?.durationMinutes ?? DEFAULT_TARGET_SLEEP_MINUTES)), 3 * 60, 16 * 60),
  };
}

export function chooseAdaptiveSleepTarget(minMinutes: number, maxMinutes: number): {
  minMinutes: number;
  maxMinutes: number;
  targetDurationMinutes: number;
  requiresHealthyMinimumConfirmation: boolean;
} {
  const first = clamp(Math.round(Number(minMinutes) || DEFAULT_TARGET_SLEEP_MINUTES), 3 * 60, 16 * 60);
  const second = clamp(Math.round(Number(maxMinutes) || DEFAULT_TARGET_SLEEP_MINUTES), 3 * 60, 16 * 60);
  const min = Math.min(first, second);
  const max = Math.max(first, second);
  const targetDurationMinutes = min <= DEFAULT_TARGET_SLEEP_MINUTES && max >= DEFAULT_TARGET_SLEEP_MINUTES
    ? DEFAULT_TARGET_SLEEP_MINUTES
    : min > DEFAULT_TARGET_SLEEP_MINUTES
      ? min
      : max >= MIN_RECOMMENDED_SLEEP_MINUTES
        ? max
        : MIN_RECOMMENDED_SLEEP_MINUTES;
  return {
    minMinutes: min,
    maxMinutes: max,
    targetDurationMinutes,
    requiresHealthyMinimumConfirmation: max < MIN_RECOMMENDED_SLEEP_MINUTES,
  };
}

export function normalizeExactSleepDurations(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((candidate) => {
    const minutes = Math.round(Number(candidate) / 15) * 15;
    return Number.isFinite(minutes) && minutes >= 3 * 60 && minutes <= 16 * 60 ? [minutes] : [];
  }))).sort((left, right) => left - right).slice(0, 6);
}

export function sleepDurationBounds(scheduleValue: PlannerSleepSchedule): { minMinutes: number; maxMinutes: number } {
  const schedule = normalizeSleepSchedule(scheduleValue);
  if (schedule.mode === "fixed") {
    const values = [schedule.weekdays.durationMinutes, schedule.weekends.durationMinutes];
    return { minMinutes: Math.min(...values), maxMinutes: Math.max(...values) };
  }
  return schedule.durationPreference.mode === "exact"
    ? {
        minMinutes: schedule.durationPreference.optionsMinutes[0],
        maxMinutes: schedule.durationPreference.optionsMinutes.at(-1)!,
      }
    : {
        minMinutes: schedule.durationPreference.minMinutes,
        maxMinutes: schedule.durationPreference.maxMinutes,
      };
}

export function preferredSleepDurations(scheduleValue: PlannerSleepSchedule): number[] {
  const schedule = normalizeSleepSchedule(scheduleValue);
  if (schedule.mode === "fixed") return Array.from(new Set([
    schedule.weekdays.durationMinutes,
    schedule.weekends.durationMinutes,
  ])).sort((left, right) => left - right);
  if (schedule.durationPreference.mode === "exact") return [...schedule.durationPreference.optionsMinutes];
  return [schedule.targetDurationMinutes];
}

function isWakeDayPart(value: unknown): value is PlannerWakeDayPart {
  return value === "early_morning" || value === "morning" || value === "late_morning" || value === "auto";
}

function isWakeAnchorReason(value: unknown): value is PlannerWakeAnchorReason {
  if (!value || typeof value !== "object") return false;
  const code = (value as { code?: unknown }).code;
  return code === "preferred_window" || code === "auto_default" || code === "recurring_commitment"
    || code === "plan_fit" || code === "fixed_conflict";
}

function recurringWakeRequirement(
  morningPreparationMinutes: number,
  commitments: Array<Pick<PlannerDraft, "kind" | "recurrence"> & Partial<Pick<PlannerDraft, "title">>>
): { minute: number; title?: string; startTime: string } | undefined {
  const preparation = clamp(Math.round(Number(morningPreparationMinutes) || 60), 0, 240);
  return commitments.flatMap((commitment) => {
    if (commitment.kind !== "fixed_event" || !commitment.recurrence?.startTime) return [];
    const startMinute = plannerTimeToMinutes(commitment.recurrence.startTime);
    if (startMinute < 4 * 60 || startMinute > 13 * 60) return [];
    return [{
      minute: Math.max(0, startMinute - preparation),
      title: commitment.title,
      startTime: commitment.recurrence.startTime,
    }];
  }).sort((left, right) => left.minute - right.minute)[0];
}

export function deriveAdaptiveWakeAnchorSelection(
  dayPart: PlannerWakeDayPart,
  morningPreparationMinutes: number,
  commitments: Array<Pick<PlannerDraft, "kind" | "recurrence"> & Partial<Pick<PlannerDraft, "title">>> = []
): { localTime: string; reason: PlannerWakeAnchorReason } {
  const defaultMinute = plannerTimeToMinutes(PLANNER_WAKE_DAY_PARTS[dayPart].defaultTime);
  const requirement = recurringWakeRequirement(morningPreparationMinutes, commitments);
  if (requirement && requirement.minute < defaultMinute) {
    return {
      localTime: plannerMinutesToTime(requirement.minute),
      reason: {
        code: "recurring_commitment",
        relatedTitle: requirement.title,
        relatedTime: requirement.startTime,
      },
    };
  }
  return {
    localTime: plannerMinutesToTime(defaultMinute),
    reason: { code: dayPart === "auto" ? "auto_default" : "preferred_window" },
  };
}

export function deriveAdaptiveWakeAnchor(
  dayPart: PlannerWakeDayPart,
  morningPreparationMinutes: number,
  commitments: Array<Pick<PlannerDraft, "kind" | "recurrence"> & Partial<Pick<PlannerDraft, "title">>> = []
): string {
  return deriveAdaptiveWakeAnchorSelection(dayPart, morningPreparationMinutes, commitments).localTime;
}

export function createAdaptiveSleepSchedule(input: {
  minMinutes: number;
  maxMinutes: number;
  exactDurationsMinutes?: number[];
  dayPart: PlannerWakeDayPart;
  morningPreparationMinutes?: number;
  commitments?: Array<Pick<PlannerDraft, "kind" | "recurrence"> & Partial<Pick<PlannerDraft, "title">>>;
  targetDurationMinutes?: number;
  healthyMinimumConfirmed?: boolean;
}): PlannerAdaptiveSleepSchedule {
  let exact = normalizeExactSleepDurations(input.exactDurationsMinutes);
  if (exact.length && exact.at(-1)! < MIN_RECOMMENDED_SLEEP_MINUTES && input.healthyMinimumConfirmed) {
    exact = normalizeExactSleepDurations([...exact, MIN_RECOMMENDED_SLEEP_MINUTES]);
  }
  const selected = exact.length
    ? chooseAdaptiveSleepTarget(exact[0], exact.at(-1)!)
    : chooseAdaptiveSleepTarget(input.minMinutes, input.maxMinutes);
  const maxForTarget = selected.maxMinutes >= MIN_RECOMMENDED_SLEEP_MINUTES
    ? selected.maxMinutes
    : MIN_RECOMMENDED_SLEEP_MINUTES;
  const requestedTarget = Number(input.targetDurationMinutes ?? (exact.at(-1) ?? selected.targetDurationMinutes));
  const targetDurationMinutes = clamp(
    Math.round(requestedTarget),
    Math.max(MIN_RECOMMENDED_SLEEP_MINUTES, selected.minMinutes),
    Math.max(Math.max(MIN_RECOMMENDED_SLEEP_MINUTES, selected.minMinutes), maxForTarget)
  );
  const preparation = clamp(Math.round(Number(input.morningPreparationMinutes ?? 60)), 0, 240);
  const anchor = deriveAdaptiveWakeAnchorSelection(input.dayPart, preparation, input.commitments);
  return {
    mode: "adaptive",
    durationPreference: exact.length
      ? { mode: "exact", optionsMinutes: exact }
      : { mode: "range", minMinutes: selected.minMinutes, maxMinutes: selected.maxMinutes },
    durationRange: { minMinutes: selected.minMinutes, maxMinutes: selected.maxMinutes },
    targetDurationMinutes,
    wakeAnchor: {
      dayPart: input.dayPart,
      localTime: anchor.localTime,
      toleranceMinutes: 60,
      selectionReason: anchor.reason,
    },
    morningPreparationMinutes: preparation,
    recovery: {
      horizonNights: 3,
      maxNightExtensionMinutes: 60,
      maxDailyAnchorShiftMinutes: 60,
      suggestShortNap: true,
    },
    requiresHealthyMinimumConfirmation: selected.requiresHealthyMinimumConfirmation
      ? !input.healthyMinimumConfirmed
      : false,
  };
}

export function normalizeSleepSchedule(value: unknown): PlannerSleepSchedule {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (raw.mode === "adaptive") {
    const rawRange = raw.durationRange && typeof raw.durationRange === "object"
      ? raw.durationRange as Record<string, unknown>
      : {};
    const rawAnchor = raw.wakeAnchor && typeof raw.wakeAnchor === "object"
      ? raw.wakeAnchor as Record<string, unknown>
      : {};
    const rawPreference = raw.durationPreference && typeof raw.durationPreference === "object"
      ? raw.durationPreference as Record<string, unknown>
      : undefined;
    const exact = rawPreference?.mode === "exact"
      ? normalizeExactSleepDurations(rawPreference.optionsMinutes)
      : [];
    const rangePreference = rawPreference?.mode === "range"
      ? rawPreference
      : rawRange;
    const selected = exact.length
      ? chooseAdaptiveSleepTarget(exact[0], exact.at(-1)!)
      : chooseAdaptiveSleepTarget(Number(rangePreference.minMinutes), Number(rangePreference.maxMinutes));
    const dayPart = isWakeDayPart(rawAnchor.dayPart) ? rawAnchor.dayPart : "morning";
    const schedule = createAdaptiveSleepSchedule({
      minMinutes: selected.minMinutes,
      maxMinutes: selected.maxMinutes,
      exactDurationsMinutes: exact,
      dayPart,
      morningPreparationMinutes: Number(raw.morningPreparationMinutes ?? 60),
      targetDurationMinutes: Number(raw.targetDurationMinutes ?? selected.targetDurationMinutes),
      healthyMinimumConfirmed: raw.requiresHealthyMinimumConfirmation !== true,
    });
    schedule.wakeAnchor.localTime = normalizePlannerTime(rawAnchor.localTime)
      ?? PLANNER_WAKE_DAY_PARTS[dayPart].defaultTime;
    schedule.wakeAnchor.toleranceMinutes = clamp(Math.round(Number(rawAnchor.toleranceMinutes ?? 60)), 0, 180);
    schedule.wakeAnchor.selectionReason = isWakeAnchorReason(rawAnchor.selectionReason)
      ? rawAnchor.selectionReason
      : { code: dayPart === "auto" ? "auto_default" : "preferred_window" };
    return schedule;
  }
  const weekdays = normalizeRule(raw.weekdays as Partial<PlannerSleepRule> | undefined
    ?? DEFAULT_PLANNER_SLEEP_SCHEDULE.weekdays);
  return {
    mode: "fixed",
    weekdays,
    weekends: normalizeRule(raw.weekends as Partial<PlannerSleepRule> | undefined ?? weekdays),
  };
}

export function isAdaptiveSleepSchedule(schedule: PlannerSleepSchedule): schedule is PlannerAdaptiveSleepSchedule {
  return schedule.mode === "adaptive";
}

export function sleepRuleForWakeDate(scheduleValue: PlannerSleepSchedule, wakeDate: string): PlannerSleepRule {
  const schedule = normalizeSleepSchedule(scheduleValue);
  if (schedule.mode === "adaptive") {
    const wakeMinute = plannerTimeToMinutes(schedule.wakeAnchor.localTime);
    return {
      bedtime: plannerMinutesToTime(wakeMinute - schedule.targetDurationMinutes),
      durationMinutes: schedule.targetDurationMinutes,
    };
  }
  const weekday = plannerWeekday(wakeDate);
  return weekday >= 6 ? schedule.weekends : schedule.weekdays;
}

function preferredDurationMatches(schedule: PlannerSleepSchedule, durationMinutes: number): boolean {
  const normalized = normalizeSleepSchedule(schedule);
  if (normalized.mode === "fixed") return preferredSleepDurations(normalized).includes(durationMinutes);
  if (normalized.durationPreference.mode === "exact") {
    return normalized.durationPreference.optionsMinutes.includes(durationMinutes);
  }
  return durationMinutes >= normalized.durationPreference.minMinutes
    && durationMinutes <= normalized.durationPreference.maxMinutes;
}

export function sleepWindowForWakeDate(
  schedule: PlannerSleepSchedule,
  wakeDate: string,
  timezone: string
): { startAt: string; endAt: string; wakeTime: string } {
  const rule = sleepRuleForWakeDate(schedule, wakeDate);
  const bedtimeMinute = plannerTimeToMinutes(rule.bedtime);
  const crossesMidnight = bedtimeMinute + rule.durationMinutes >= 1440;
  const startDate = crossesMidnight ? addPlannerDays(wakeDate, -1) : wakeDate;
  const startAt = zonedPlannerDateTimeToUtc(startDate, rule.bedtime, timezone);
  return {
    startAt,
    endAt: addIsoMinutes(startAt, rule.durationMinutes),
    wakeTime: plannerMinutesToTime(bedtimeMinute + rule.durationMinutes),
  };
}

export function availabilityFromSleepSchedule(scheduleValue: PlannerSleepSchedule): PlannerAvailability {
  const schedule = normalizeSleepSchedule(scheduleValue);
  const monday = "2026-08-17";
  return Object.fromEntries(Array.from({ length: 7 }, (_, index) => {
    const date = addPlannerDays(monday, index);
    const nextDate = addPlannerDays(date, 1);
    const wake = sleepWindowForWakeDate(schedule, date, "UTC").wakeTime;
    const bedtime = sleepRuleForWakeDate(schedule, nextDate).bedtime;
    return [String(index + 1), [{ start: wake, end: bedtime }]];
  }));
}

function plannerDayDistance(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

function concreteEventWindow(event: PlannerSleepEvent): { startAt: string; endAt: string } | null {
  if (!event.actualStartAt) return null;
  const endAt = event.actualEndAt ?? event.projectedEndAt;
  return endAt ? { startAt: event.actualStartAt, endAt } : null;
}

function plannedEventWindow(event: PlannerSleepEvent): { startAt: string; endAt: string } | null {
  if (!event.plannedStartAt || !event.plannedEndAt) return null;
  return { startAt: event.plannedStartAt, endAt: event.plannedEndAt };
}

function latestRecoverySource(
  profile: PlannerProfile,
  events: PlannerSleepEvent[],
  wakeDate: string
): { event: PlannerSleepEvent; dayOffset: number; wakeShiftMinutes: number; deficitMinutes: number } | null {
  if (profile.sleepSchedule.mode !== "adaptive") return null;
  const schedule = profile.sleepSchedule;
  const candidates = events.flatMap((event) => {
    if (event.state === "tentative" || event.state === "planned" || event.wakeDate >= wakeDate) return [];
    const dayOffset = plannerDayDistance(event.wakeDate, wakeDate);
    if (dayOffset < 1 || dayOffset > 14) return [];
    const concrete = concreteEventWindow(event);
    if (!concrete) return [];
    const planned = sleepWindowForWakeDate(schedule, event.wakeDate, profile.timezone);
    return [{
      event,
      dayOffset,
      wakeShiftMinutes: Math.round((new Date(concrete.endAt).getTime() - new Date(planned.endAt).getTime()) / 60_000),
      deficitMinutes: Math.max(
        0,
        sleepDurationBounds(schedule).minMinutes - isoDurationMinutes(concrete.startAt, concrete.endAt)
      ),
    }];
  }).sort((left, right) => right.event.wakeDate.localeCompare(left.event.wakeDate));
  return candidates[0] ?? null;
}

function recoveredWindowForWakeDate(
  profile: PlannerProfile,
  events: PlannerSleepEvent[],
  wakeDate: string,
  planned: { startAt: string; endAt: string }
): { startAt: string; endAt: string; recoveryNight: boolean } {
  const source = latestRecoverySource(profile, events, wakeDate);
  if (!source || profile.sleepSchedule.mode !== "adaptive") return { ...planned, recoveryNight: false };
  const schedule = profile.sleepSchedule;
  const shiftStep = schedule.recovery.maxDailyAnchorShiftMinutes * source.dayOffset;
  const remainingShift = source.wakeShiftMinutes > 0
    ? Math.max(0, source.wakeShiftMinutes - shiftStep)
    : Math.min(0, source.wakeShiftMinutes + shiftStep);
  const bounds = sleepDurationBounds(schedule);
  const severity = source.event.sleepinessLevel ?? (source.event.restedness === "not_rested" ? 2 : 0);
  const subjectiveExtension = severity >= 3 ? 60 : severity >= 1 ? Math.max(0, bounds.maxMinutes - schedule.targetDurationMinutes) : 0;
  const automaticMax = Math.max(bounds.maxMinutes, Math.min(10 * 60, bounds.maxMinutes + 60));
  const maxExtensionByRange = Math.max(0, automaticMax - schedule.targetDurationMinutes);
  const remainingDeficit = Math.max(0, source.deficitMinutes - (source.dayOffset - 1) * schedule.recovery.maxNightExtensionMinutes);
  const recoveryWindow = severity >= 3 ? 3 : severity >= 2 ? 2 : severity >= 1 ? 1 : schedule.recovery.horizonNights;
  const extension = source.dayOffset <= schedule.recovery.horizonNights
    ? Math.min(
        schedule.recovery.maxNightExtensionMinutes,
        maxExtensionByRange,
        Math.max(remainingDeficit, source.dayOffset <= recoveryWindow ? subjectiveExtension : 0)
      )
    : 0;
  const endAt = addIsoMinutes(planned.endAt, remainingShift);
  return {
    startAt: addIsoMinutes(endAt, -(schedule.targetDurationMinutes + extension)),
    endAt,
    recoveryNight: remainingShift !== 0 || extension > 0,
  };
}

export function buildPlannerSleepBlocks(
  profileValue: PlannerProfile,
  events: PlannerSleepEvent[],
  startDate: string,
  endDate: string
): PlannerSleepBlock[] {
  const profile = { ...profileValue, sleepSchedule: normalizeSleepSchedule(profileValue.sleepSchedule) };
  const byWakeDate = new Map(events.map((event) => [event.wakeDate, event]));
  const blocks: PlannerSleepBlock[] = [];
  for (let wakeDate = startDate; wakeDate <= addPlannerDays(endDate, 1); wakeDate = addPlannerDays(wakeDate, 1)) {
    const planned = sleepWindowForWakeDate(profile.sleepSchedule, wakeDate, profile.timezone);
    const event = byWakeDate.get(wakeDate);
    const eventWindow = event ? concreteEventWindow(event) : null;
    const plannedOverride = event ? plannedEventWindow(event) : null;
    const recovery = eventWindow
      ? { ...eventWindow, recoveryNight: Boolean(event?.recoveryNight) }
      : plannedOverride
        ? { ...plannedOverride, recoveryNight: Boolean(event?.recoveryNight) }
        : recoveredWindowForWakeDate(profile, events, wakeDate, planned);
    const selectedDurationMinutes = isoDurationMinutes(recovery.startAt, recovery.endAt);
    blocks.push({
      id: `sleep-${wakeDate}`,
      wakeDate,
      title: event?.state === "tentative" ? "Сон · предварительно" : recovery.recoveryNight ? "Сон · восстановление" : "Сон",
      startAt: recovery.startAt,
      endAt: recovery.endAt,
      plannedStartAt: planned.startAt,
      plannedEndAt: planned.endAt,
      actualStartAt: event?.actualStartAt,
      actualEndAt: event?.actualEndAt,
      selectedDurationMinutes,
      preferredDurationMatched: preferredDurationMatches(profile.sleepSchedule, selectedDurationMinutes),
      borrowedMinutes: event?.borrowedMinutes ?? Math.max(0, sleepDurationBounds(profile.sleepSchedule).minMinutes - selectedDurationMinutes),
      selectionReason: event?.selectionReason ?? (recovery.recoveryNight ? "recovery" : "preference"),
      tentative: event?.state === "tentative",
      recoveryNight: recovery.recoveryNight,
      fixed: true,
      locked: true,
      kind: "sleep",
    });
  }
  return blocks;
}

export function createPlannerSleepEvent(input: {
  profile: PlannerProfile;
  wakeDate: string;
  actualStartAt: string;
  actualEndAt?: string;
  restedness?: PlannerSleepEvent["restedness"];
  sleepinessLevel?: PlannerSleepEvent["sleepinessLevel"];
  feedbackText?: string;
  eventKind?: PlannerSleepEvent["eventKind"];
  recoveryNight?: boolean;
}): PlannerSleepEvent {
  const rule = sleepRuleForWakeDate(normalizeSleepSchedule(input.profile.sleepSchedule), input.wakeDate);
  const actualStartAt = new Date(input.actualStartAt).toISOString();
  const actualEndAt = input.actualEndAt ? new Date(input.actualEndAt).toISOString() : undefined;
  return {
    wakeDate: input.wakeDate,
    eventKind: input.eventKind ?? "sleep_change",
    state: actualEndAt ? "completed" : "confirmed",
    actualStartAt,
    projectedEndAt: actualEndAt ?? addIsoMinutes(actualStartAt, rule.durationMinutes),
    actualEndAt,
    restedness: input.restedness,
    sleepinessLevel: input.sleepinessLevel,
    feedbackText: input.feedbackText?.trim().slice(0, 500) || undefined,
    recoveryNight: input.recoveryNight,
  };
}

export function createTentativeSleepEvent(input: {
  profile: PlannerProfile;
  wakeDate: string;
  estimatedStartFromAt: string;
  estimatedStartToAt: string;
}): PlannerSleepEvent {
  const from = new Date(input.estimatedStartFromAt);
  const to = new Date(input.estimatedStartToAt);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) {
    throw new Error("Некорректный диапазон предполагаемого сна.");
  }
  const midpoint = new Date(from.getTime() + (to.getTime() - from.getTime()) / 2).toISOString();
  const rule = sleepRuleForWakeDate(normalizeSleepSchedule(input.profile.sleepSchedule), input.wakeDate);
  return {
    wakeDate: input.wakeDate,
    eventKind: "sleep_change",
    state: "tentative",
    actualStartAt: midpoint,
    projectedEndAt: addIsoMinutes(midpoint, rule.durationMinutes),
    estimatedStartFromAt: from.toISOString(),
    estimatedStartToAt: to.toISOString(),
  };
}

export function createOpenSleepEvent(wakeDate: string): PlannerSleepEvent {
  return {
    wakeDate,
    eventKind: "sleep_change",
    state: "tentative",
  };
}

function normalizeOptionalIso(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Некорректное поле сна: ${field}.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Некорректное поле сна: ${field}.`);
  return date.toISOString();
}

export function normalizePlannerSleepEvent(value: PlannerSleepEvent): PlannerSleepEvent {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.wakeDate)) throw new Error("Некорректная дата пробуждения.");
  const eventKind = value.eventKind === "check_in" || value.eventKind === "planned_adjustment"
    ? value.eventKind
    : "sleep_change";
  const state = value.state === "planned" || value.state === "tentative" || value.state === "completed"
    ? value.state
    : "confirmed";
  const actualStartAt = normalizeOptionalIso(value.actualStartAt, "actualStartAt");
  const projectedEndAt = normalizeOptionalIso(value.projectedEndAt, "projectedEndAt");
  const actualEndAt = normalizeOptionalIso(value.actualEndAt, "actualEndAt");
  const estimatedStartFromAt = normalizeOptionalIso(value.estimatedStartFromAt, "estimatedStartFromAt");
  const estimatedStartToAt = normalizeOptionalIso(value.estimatedStartToAt, "estimatedStartToAt");
  const plannedStartAt = normalizeOptionalIso(value.plannedStartAt, "plannedStartAt");
  const plannedEndAt = normalizeOptionalIso(value.plannedEndAt, "plannedEndAt");
  if ((estimatedStartFromAt && !estimatedStartToAt) || (!estimatedStartFromAt && estimatedStartToAt)) {
    throw new Error("Для предварительного сна нужны обе границы диапазона.");
  }
  if (estimatedStartFromAt && estimatedStartToAt && new Date(estimatedStartToAt) < new Date(estimatedStartFromAt)) {
    throw new Error("Конец диапазона сна должен быть не раньше начала.");
  }
  for (const endAt of [projectedEndAt, actualEndAt]) {
    if (endAt && (!actualStartAt || new Date(endAt) <= new Date(actualStartAt))) {
      throw new Error("Пробуждение должно быть позже засыпания.");
    }
  }
  if ((plannedStartAt && !plannedEndAt) || (!plannedStartAt && plannedEndAt)) {
    throw new Error("Для запланированного сна нужны начало и окончание.");
  }
  if (plannedStartAt && plannedEndAt && new Date(plannedEndAt) <= new Date(plannedStartAt)) {
    throw new Error("Запланированное пробуждение должно быть позже засыпания.");
  }
  if (state === "planned" && (!plannedStartAt || !plannedEndAt)) {
    throw new Error("Для плановой корректировки нужны начало и окончание сна.");
  }
  if (state !== "planned" && state !== "tentative" && (!actualStartAt || !projectedEndAt)) {
    throw new Error("Для подтверждённого сна нужны время засыпания и подъёма.");
  }
  const restedness = value.restedness === "not_rested" || value.restedness === "okay" || value.restedness === "well_rested"
    ? value.restedness
    : undefined;
  const sleepinessLevel = Number.isInteger(value.sleepinessLevel) && Number(value.sleepinessLevel) >= 0 && Number(value.sleepinessLevel) <= 4
    ? value.sleepinessLevel
    : undefined;
  const plannedDurationMinutes = plannedStartAt && plannedEndAt
    ? isoDurationMinutes(plannedStartAt, plannedEndAt)
    : value.plannedDurationMinutes === undefined
      ? undefined
      : clamp(Math.round(Number(value.plannedDurationMinutes)), 3 * 60, 16 * 60);
  const selectionReason = value.selectionReason === "workload" || value.selectionReason === "hard_deadline"
    || value.selectionReason === "recovery" || value.selectionReason === "manual"
    ? value.selectionReason
    : "preference";
  return {
    wakeDate: value.wakeDate,
    eventKind,
    state,
    actualStartAt,
    projectedEndAt,
    actualEndAt,
    estimatedStartFromAt,
    estimatedStartToAt,
    restedness,
    sleepinessLevel,
    feedbackText: value.feedbackText?.trim().slice(0, 500) || undefined,
    plannedStartAt,
    plannedEndAt,
    plannedDurationMinutes,
    selectionReason,
    borrowedMinutes: clamp(Math.round(Number(value.borrowedMinutes ?? 0)), 0, 2 * 60),
    recoveryNight: Boolean(value.recoveryNight),
  };
}

export function plannerSleepDurationSuggestion(
  scheduleValue: PlannerSleepSchedule,
  events: PlannerSleepEvent[],
  today: string
): { currentMinutes: number; suggestedMinutes: number; sampleCount: number; reason: string } | undefined {
  const schedule = normalizeSleepSchedule(scheduleValue);
  if (schedule.mode !== "adaptive") return undefined;
  const since = addPlannerDays(today, -20);
  const comparable = events
    .filter((event) => event.eventKind === "check_in" && event.state === "completed" && !event.recoveryNight && event.restedness && event.wakeDate >= since && event.wakeDate <= today)
    .sort((left, right) => right.wakeDate.localeCompare(left.wakeDate))
    .slice(0, 7);
  if (comparable.length < 7 || comparable.filter((event) => event.restedness === "not_rested").length < 4) return undefined;
  const suggestedMinutes = schedule.durationPreference.mode === "exact"
    ? schedule.durationPreference.optionsMinutes.find((minutes) => minutes > schedule.targetDurationMinutes)
      ?? schedule.targetDurationMinutes
    : Math.min(schedule.durationPreference.maxMinutes, schedule.targetDurationMinutes + 30);
  if (suggestedMinutes <= schedule.targetDurationMinutes) return undefined;
  return {
    currentMinutes: schedule.targetDurationMinutes,
    suggestedMinutes,
    sampleCount: comparable.length,
    reason: "За семь сопоставимых ночей вы минимум четыре раза отметили, что не выспались.",
  };
}

export function buildSleepRecoveryAdvice(
  profile: PlannerProfile,
  event: PlannerSleepEvent,
  occupiedBlocks: PlannerBlock[]
): { deficitMinutes: number; recoveryNights: number; nap?: { startAt: string; endAt: string; reason: string } } | undefined {
  const schedule = normalizeSleepSchedule(profile.sleepSchedule);
  const window = concreteEventWindow(event);
  if (schedule.mode !== "adaptive" || event.state !== "completed" || !event.actualEndAt || !window) return undefined;
  const severity = event.sleepinessLevel ?? (event.restedness === "not_rested" ? 2 : 0);
  const deficitMinutes = Math.max(0, sleepDurationBounds(schedule).minMinutes - isoDurationMinutes(window.startAt, window.endAt));
  if (deficitMinutes <= 0 && severity <= 0) return undefined;
  const nextSleep = sleepWindowForWakeDate(schedule, addPlannerDays(event.wakeDate, 1), profile.timezone);
  const latestNapEnd = Math.min(
    new Date(zonedPlannerDateTimeToUtc(event.wakeDate, "15:00", profile.timezone)).getTime(),
    new Date(nextSleep.startAt).getTime() - 6 * 60 * 60_000
  );
  const availability = profile.availability[String(plannerWeekday(event.wakeDate))] ?? [];
  let candidate = Math.ceil((new Date(event.actualEndAt).getTime() + 60 * 60_000) / (15 * 60_000)) * 15 * 60_000;
  let nap: { startAt: string; endAt: string; reason: string } | undefined;
  while (candidate + 20 * 60_000 <= latestNapEnd) {
    const end = candidate + 20 * 60_000;
    const insideAvailability = availability.some((available) => {
      const startAt = new Date(zonedPlannerDateTimeToUtc(event.wakeDate, available.start, profile.timezone)).getTime();
      const endDate = plannerTimeToMinutes(available.end) <= plannerTimeToMinutes(available.start)
        ? addPlannerDays(event.wakeDate, 1)
        : event.wakeDate;
      const endAt = new Date(zonedPlannerDateTimeToUtc(endDate, available.end, profile.timezone)).getTime();
      return candidate >= startAt && end <= endAt;
    });
    const overlaps = occupiedBlocks.some((block) => {
      if (block.status === "cancelled" || block.status === "skipped") return false;
      return candidate < new Date(block.endAt).getTime() && new Date(block.startAt).getTime() < end;
    });
    if (insideAvailability && !overlaps) {
      nap = {
        startAt: new Date(candidate).toISOString(),
        endAt: new Date(end).toISOString(),
        reason: "Короткое свободное окно до 15:00 и минимум за 6 часов до следующего сна.",
      };
      break;
    }
    candidate += 15 * 60_000;
  }
  return {
    deficitMinutes,
    recoveryNights: severity >= 3 ? 3 : severity >= 2 ? 2 : severity >= 1 ? 1 : schedule.recovery.horizonNights,
    nap: severity >= 2 || deficitMinutes > 0 ? nap : undefined,
  };
}

export function plannerSleepHealthNotice(
  profile: PlannerProfile,
  events: PlannerSleepEvent[],
  today: string
): string | undefined {
  const schedule = normalizeSleepSchedule(profile.sleepSchedule);
  if (schedule.mode !== "adaptive") return undefined;
  const since = addPlannerDays(today, -13);
  const extreme = events.filter((event) => {
    if (event.state !== "completed" || event.wakeDate < since || event.wakeDate > today) return false;
    const window = concreteEventWindow(event);
    if (!window) return false;
    const planned = sleepWindowForWakeDate(schedule, event.wakeDate, profile.timezone);
    const wakeShift = Math.abs(new Date(window.endAt).getTime() - new Date(planned.endAt).getTime()) / 60_000;
    return isoDurationMinutes(window.startAt, window.endAt) < 5 * 60 || wakeShift > 3 * 60 || (event.sleepinessLevel ?? 0) >= 4;
  });
  return extreme.length >= 3
    ? "За последние две недели режим сна сильно сбивался несколько раз. Планировщик поможет сохранить дела и время восстановления, но при постоянной сонливости или проблемах со сном стоит обсудить это со специалистом."
    : undefined;
}

export function fixedScheduleView(scheduleValue: PlannerSleepSchedule): PlannerFixedSleepSchedule {
  const schedule = normalizeSleepSchedule(scheduleValue);
  if (schedule.mode === "fixed") return schedule;
  const rule = sleepRuleForWakeDate(schedule, "2026-08-17");
  return { mode: "fixed", weekdays: rule, weekends: { ...rule } };
}
