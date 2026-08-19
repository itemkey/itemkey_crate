import {
  DEFAULT_PLANNER_SLEEP_SCHEDULE,
  type PlannerAvailability,
  type PlannerProfile,
  type PlannerSleepBlock,
  type PlannerSleepEvent,
  type PlannerSleepRule,
  type PlannerSleepSchedule,
} from "./types.ts";
import {
  addIsoMinutes,
  addPlannerDays,
  normalizePlannerTime,
  plannerMinutesToTime,
  plannerTimeToMinutes,
  plannerWeekday,
  zonedPlannerDateTimeToUtc,
} from "./time.ts";

function normalizeRule(value: Partial<PlannerSleepRule> | null | undefined): PlannerSleepRule {
  return {
    bedtime: normalizePlannerTime(value?.bedtime) ?? "23:00",
    durationMinutes: Math.min(16 * 60, Math.max(3 * 60, Math.round(Number(value?.durationMinutes ?? 8 * 60)))),
  };
}

export function normalizeSleepSchedule(value: Partial<PlannerSleepSchedule> | null | undefined): PlannerSleepSchedule {
  return {
    weekdays: normalizeRule(value?.weekdays ?? DEFAULT_PLANNER_SLEEP_SCHEDULE.weekdays),
    weekends: normalizeRule(value?.weekends ?? value?.weekdays ?? DEFAULT_PLANNER_SLEEP_SCHEDULE.weekends),
  };
}

export function sleepRuleForWakeDate(schedule: PlannerSleepSchedule, wakeDate: string): PlannerSleepRule {
  const weekday = plannerWeekday(wakeDate);
  return weekday >= 6 ? schedule.weekends : schedule.weekdays;
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

export function buildPlannerSleepBlocks(
  profile: PlannerProfile,
  events: PlannerSleepEvent[],
  startDate: string,
  endDate: string
): PlannerSleepBlock[] {
  const schedule = normalizeSleepSchedule(profile.sleepSchedule);
  const byWakeDate = new Map(events.map((event) => [event.wakeDate, event]));
  const blocks: PlannerSleepBlock[] = [];
  for (let wakeDate = startDate; wakeDate <= addPlannerDays(endDate, 1); wakeDate = addPlannerDays(wakeDate, 1)) {
    const planned = sleepWindowForWakeDate(schedule, wakeDate, profile.timezone);
    const event = byWakeDate.get(wakeDate);
    const startAt = event?.actualStartAt ?? planned.startAt;
    const endAt = event?.actualEndAt ?? event?.projectedEndAt ?? planned.endAt;
    blocks.push({
      id: `sleep-${wakeDate}`,
      wakeDate,
      title: "Сон",
      startAt,
      endAt,
      plannedStartAt: planned.startAt,
      plannedEndAt: planned.endAt,
      actualStartAt: event?.actualStartAt,
      actualEndAt: event?.actualEndAt,
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
}): PlannerSleepEvent {
  const rule = sleepRuleForWakeDate(normalizeSleepSchedule(input.profile.sleepSchedule), input.wakeDate);
  const actualStartAt = new Date(input.actualStartAt).toISOString();
  const actualEndAt = input.actualEndAt ? new Date(input.actualEndAt).toISOString() : undefined;
  return {
    wakeDate: input.wakeDate,
    actualStartAt,
    projectedEndAt: actualEndAt ?? addIsoMinutes(actualStartAt, rule.durationMinutes),
    actualEndAt,
  };
}
