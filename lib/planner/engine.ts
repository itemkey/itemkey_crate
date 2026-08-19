import {
  createDefaultPlannerProfile,
  type PlannerBlock,
  type PlannerConflict,
  type PlannerDraft,
  type PlannerEnergy,
  type PlannerAssistantParseResult,
  type PlannerItem,
  type PlannerPriority,
  type PlannerProfile,
  type PlannerProposal,
  type PlannerProposalInput,
  type PlannerProposalChange,
  type PlannerSleepEvent,
  type PlannerSleepParseResult,
  type PlannerTimeWindow,
  type PlannerUnplaced,
} from "./types.ts";
import { buildPlannerSleepBlocks, normalizeSleepSchedule } from "./sleep.ts";
import {
  addIsoMinutes,
  addPlannerDays,
  formatDateInTimeZone,
  horizonDays,
  isoDurationMinutes,
  normalizePlannerDate,
  normalizePlannerTime,
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
  now?: Date;
};

type PlacementRequest = {
  item: PlannerItem;
  occurrenceKey: string;
  durationMinutes: number;
  sourceBlock?: PlannerBlock;
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
  return {
    userId: value.userId,
    timezone,
    horizon:
      value.horizon === "two_weeks" || value.horizon === "month" ? value.horizon : "week",
    reserveRatio: clamp(Number(value.reserveRatio ?? 0.2), 0, 0.6),
    defaultBufferMinutes: clamp(Math.round(Number(value.defaultBufferMinutes ?? 15)), 0, 120),
    availability,
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
    assistantSetupVersion: Math.max(0, Math.round(Number(value.assistantSetupVersion ?? 0))),
    revision: Math.max(0, Math.round(Number(value.revision ?? 0))),
    onboardingCompleted: Boolean(value.onboardingCompleted),
  };
}

export function normalizePlannerItem(value: Partial<PlannerItem> & { id: string; title: string }): PlannerItem {
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
    estimateMinutes: clamp(Math.round(Number(value.estimateMinutes ?? 60)), 5, 24 * 60),
    earliestAt: value.earliestAt,
    deadlineAt: value.deadlineAt,
    preferredWindows: normalizeWindows(value.preferredWindows),
    avoidedWindows: normalizeWindows(value.avoidedWindows),
    canSplit: Boolean(value.canSplit),
    minChunkMinutes: clamp(Math.round(Number(value.minChunkMinutes ?? 25)), 5, 24 * 60),
    bufferBeforeMinutes: clamp(Math.round(Number(value.bufferBeforeMinutes ?? 0)), 0, 240),
    bufferAfterMinutes: clamp(Math.round(Number(value.bufferAfterMinutes ?? 0)), 0, 240),
    recurrence: value.recurrence,
    autoPlan: value.autoPlan !== false,
    status:
      value.status === "completed" || value.status === "archived" ? value.status : "active",
    unplacedReason: value.unplacedReason?.trim().slice(0, 500) || undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function inferDateFromText(text: string, baseDate: string): string | undefined {
  const lower = text.toLocaleLowerCase();
  const iso = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return normalizePlannerDate(iso);
  if (lower.includes("послезавтра") || lower.includes("day after tomorrow")) return addPlannerDays(baseDate, 2);
  if (lower.includes("завтра") || lower.includes("tomorrow")) return addPlannerDays(baseDate, 1);
  if (lower.includes("сегодня") || lower.includes("today")) return baseDate;
  const names = [
    ["понедель", 1], ["monday", 1], ["вторник", 2], ["tuesday", 2],
    ["сред", 3], ["wednesday", 3], ["четвер", 4], ["thursday", 4],
    ["пятниц", 5], ["friday", 5], ["суббот", 6], ["saturday", 6],
    ["воскрес", 7], ["sunday", 7],
  ] as const;
  for (const [fragment, weekday] of names) {
    if (!lower.includes(fragment)) continue;
    const offset = (weekday - plannerWeekday(baseDate) + 7) % 7;
    return addPlannerDays(baseDate, offset || 7);
  }
  return undefined;
}

function parseDuration(text: string): number | undefined {
  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*(?:ч(?:ас(?:а|ов)?)?|h(?:ours?)?)/i)?.[1];
  const minutes = text.match(/(\d+)\s*(?:мин(?:ут[аы]?)?|m(?:in(?:utes?)?)?)/i)?.[1];
  if (hours) return Math.round(Number(hours.replace(",", ".")) * 60);
  if (minutes) return Number(minutes);
  return undefined;
}

function parseTimeRange(text: string): { start: string; end: string } | undefined {
  const match = text.match(/(?:с|from)?\s*(\d{1,2})(?::([0-5]\d))?\s*(?:-|—|–|до|to)\s*(\d{1,2})(?::([0-5]\d))?/i);
  if (!match) return undefined;
  const start = normalizePlannerTime(`${String(Number(match[1])).padStart(2, "0")}:${match[2] ?? "00"}`);
  const end = normalizePlannerTime(`${String(Number(match[3])).padStart(2, "0")}:${match[4] ?? "00"}`);
  return start && end ? { start, end } : undefined;
}

function parseRecurrence(text: string): PlannerDraft["recurrence"] | undefined {
  const lower = text.toLocaleLowerCase();
  if (!/(?:кажд|every|по будням|weekdays|ежеднев)/i.test(lower)) return undefined;
  if (/(?:каждый день|ежеднев|every day|daily)/i.test(lower)) return { frequency: "daily" };
  if (/(?:по будням|weekdays)/i.test(lower)) return { frequency: "custom", weekdays: [1, 2, 3, 4, 5] };
  const names = [
    [/(?:понедель|monday)/i, 1], [/(?:вторник|tuesday)/i, 2],
    [/(?:сред|wednesday)/i, 3], [/(?:четвер|thursday)/i, 4],
    [/(?:пятниц|friday)/i, 5], [/(?:суббот|saturday)/i, 6],
    [/(?:воскрес|sunday)/i, 7],
  ] as const;
  const weekdays = names.filter(([pattern]) => pattern.test(lower)).map(([, day]) => day);
  return weekdays.length === 1
    ? { frequency: "weekly", weekdays }
    : { frequency: "custom", weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5, 6, 7] };
}

export function parsePlannerCommand(
  command: string,
  profile: PlannerProfile,
  now = new Date()
): PlannerDraft {
  const text = command.trim();
  const baseDate = formatDateInTimeZone(now, profile.timezone);
  const range = parseTimeRange(text);
  const duration = range
    ? Math.max(5, (plannerTimeToMinutes(range.end) - plannerTimeToMinutes(range.start) + 1440) % 1440)
    : parseDuration(text) ?? 60;
  const lower = text.toLocaleLowerCase();
  const recurrence = parseRecurrence(text);
  const inferredDate = inferDateFromText(text, baseDate);
  const kind = range || lower.includes("встреч") || lower.includes("appointment")
    ? "fixed_event"
    : recurrence || lower.includes("routine")
      ? "routine"
      : "flexible_task";
  const title = text
    .replace(/\b(?:сегодня|завтра|послезавтра|today|tomorrow)\b/gi, "")
    .replace(/(?:с|from)?\s*\d{1,2}(?::[0-5]\d)?\s*(?:-|—|–|до|to)\s*\d{1,2}(?::[0-5]\d)?/gi, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:час(?:а|ов)?|ч|мин(?:ут[аы]?)?|hours?|h|minutes?|min)\b/gi, "")
    .replace(/\b(?:каждый|каждая|каждое|каждые|every|daily|ежедневно|по будням|weekdays)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:\-–—]+|[,.;:\-–—]+$/g, "") || "Новое дело";
  const priority: PlannerPriority = lower.includes("сроч") || lower.includes("urgent")
    ? "critical"
    : lower.includes("важ") || lower.includes("important")
      ? "high"
      : "normal";
  return {
    title,
    kind,
    estimateMinutes: duration,
    priority,
    energy: "normal",
    date: inferredDate ?? baseDate,
    deadlineAt: kind === "flexible_task" && inferredDate
      ? zonedPlannerDateTimeToUtc(inferredDate, "23:59", profile.timezone)
      : undefined,
    start: range?.start,
    end: range?.end,
    canSplit: kind === "flexible_task" && duration >= 60,
    minChunkMinutes: 25,
    preferredWindows: [],
    avoidedWindows: [],
    recurrence: recurrence ? {
      ...recurrence,
      startDate: inferredDate ?? baseDate,
      startTime: range?.start,
      endTime: range?.end,
    } : undefined,
    autoPlan: kind !== "fixed_event",
    status: "active",
  };
}

export function parsePlannerCommands(
  command: string,
  profile: PlannerProfile,
  now = new Date()
): PlannerAssistantParseResult {
  const lines = command.split(/\r?\n|;/).map((line) => line.trim()).filter(Boolean).slice(0, 100);
  const drafts: PlannerDraft[] = [];
  const ambiguities: PlannerAssistantParseResult["ambiguities"] = [];
  lines.forEach((line, index) => {
    const draft = parsePlannerCommand(line, profile, now);
    drafts.push(draft);
    if (!parseDuration(line) && !parseTimeRange(line)) {
      ambiguities.push({ index, field: "duration", message: "Длительность не указана; временно поставлен 1 час." });
    }
    if (draft.kind === "fixed_event" && !draft.start) {
      ambiguities.push({ index, field: "time", message: "Для фиксированного события нужно указать начало и конец." });
    }
    if (draft.kind === "fixed_event" && !inferDateFromText(line, formatDateInTimeZone(now, profile.timezone))) {
      ambiguities.push({ index, field: "date", message: "Дата не указана; временно выбрано сегодня." });
    }
    if (!draft.title.trim()) {
      ambiguities.push({ index, field: "title", message: "У дела нет понятного названия." });
    }
  });
  return { drafts, ambiguities };
}

export function parseSleepCommand(command: string): PlannerSleepParseResult {
  const text = command.trim();
  const timeMatch = text.match(/(?:лож(?:усь|иться|усь спать)|спать|bed(?:time)?|sleep)\D{0,20}(\d{1,2})(?::([0-5]\d))?/i)
    ?? text.match(/\b(?:в|at)\s*(\d{1,2})(?::([0-5]\d))?/i);
  const bedtime = timeMatch
    ? normalizePlannerTime(`${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2] ?? "00"}`)
    : undefined;
  const durationMinutes = parseDuration(text);
  const ambiguities: string[] = [];
  if (!bedtime) ambiguities.push("Не удалось определить время отхода ко сну.");
  if (!durationMinutes) ambiguities.push("Не удалось определить обычную длительность сна.");
  return { bedtime, durationMinutes, ambiguities };
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
  return profile.availability[String(plannerWeekday(date))] ?? [];
}

function getRoutineDates(item: PlannerItem, startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addPlannerDays(date, 1)) {
    if (item.recurrence?.startDate && date < item.recurrence.startDate) continue;
    if (!item.recurrence || item.recurrence.frequency === "daily") dates.push(date);
    else if (item.recurrence.frequency === "weekly" && plannerWeekday(date) === (item.recurrence.weekdays?.[0] ?? 1)) dates.push(date);
    else if (item.recurrence.frequency === "custom" && item.recurrence.weekdays?.includes(plannerWeekday(date))) dates.push(date);
  }
  return dates;
}

function buildPlacementRequests(
  items: PlannerItem[],
  blocks: PlannerBlock[],
  startDate: string,
  endDate: string
): PlacementRequest[] {
  const requests: PlacementRequest[] = [];
  const activeBlocks = blocks.filter((block) => block.status !== "cancelled" && block.status !== "skipped");
  for (const item of items) {
    if (item.status !== "active" || !item.autoPlan || item.kind === "fixed_event") continue;
    if (item.kind === "routine") {
      for (const date of getRoutineDates(item, startDate, endDate)) {
        const key = `${item.id}:${date}`;
        if (blocks.some((block) => block.itemId === item.id && block.occurrenceKey === key)) continue;
        requests.push({ item, occurrenceKey: key, durationMinutes: item.estimateMinutes });
      }
      continue;
    }
    const alreadyPlanned = activeBlocks
      .filter((block) => block.itemId === item.id)
      .reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
    const remaining = Math.max(0, item.estimateMinutes - alreadyPlanned);
    if (remaining > 0) requests.push({ item, occurrenceKey: item.id, durationMinutes: remaining });
  }
  return requests.sort((left, right) => {
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
  if (item.deadlineAt) {
    const slackHours = (new Date(item.deadlineAt).getTime() - startAt) / 3_600_000;
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
  energyShiftByDate: Map<string, number>
): { startAt: string; endAt: string; date: string } | null {
  let best: { startAt: string; endAt: string; date: string; score: number } | null = null;
  const horizonStartMs = new Date(zonedPlannerDateTimeToUtc(startDate, "00:00", profile.timezone)).getTime();
  for (let date = startDate; date <= endDate; date = addPlannerDays(date, 1)) {
    const windows = availabilityForDate(profile, date);
    const totalAvailable = windows.reduce((sum, window) => sum + durationForLocalRange(window.start, window.end), 0);
    const fixedMinutes = occupied
      .filter((block) => block.fixed && !["cancelled", "skipped"].includes(block.status))
      .reduce((sum, block) => sum + windows.reduce(
        (windowSum, window) => windowSum + blockMinutesInsideWindow(block, date, window, profile.timezone),
        0
      ), 0);
    const capacity = Math.floor(Math.max(0, totalAvailable - fixedMinutes) * (1 - profile.reserveRatio));
    if ((autoMinutesByDate.get(date) ?? 0) + durationMinutes > capacity) continue;
    for (const window of windows) {
      const windowStart = plannerTimeToMinutes(window.start);
      let windowEnd = plannerTimeToMinutes(window.end);
      if (windowEnd <= windowStart) windowEnd += 1440;
      for (let minute = Math.ceil(windowStart / STEP_MINUTES) * STEP_MINUTES; minute + durationMinutes <= windowEnd; minute += STEP_MINUTES) {
        const localDate = minute >= 1440 ? addPlannerDays(date, 1) : date;
        const localMinute = minute % 1440;
        if (request.item.avoidedWindows.some((candidate) => windowOverlapsRange(candidate, localMinute, localMinute + durationMinutes))) continue;
        const startAt = zonedPlannerDateTimeToUtc(
          localDate,
          `${String(Math.floor(localMinute / 60)).padStart(2, "0")}:${String(localMinute % 60).padStart(2, "0")}`,
          profile.timezone
        );
        const endAt = addIsoMinutes(startAt, durationMinutes);
        const candidate = { start: new Date(startAt).getTime(), end: new Date(endAt).getTime() };
        const candidateBefore = Math.max(profile.defaultBufferMinutes, request.item.bufferBeforeMinutes);
        const candidateAfter = Math.max(profile.defaultBufferMinutes, request.item.bufferAfterMinutes);
        if (candidate.start < nowMs) continue;
        if (occupied.some((block) => {
          if (block.status === "cancelled" || block.status === "skipped") return false;
          const interval = blockInterval(block);
          const occupiedItem = block.itemId ? itemById.get(block.itemId) : undefined;
          const occupiedBefore = Math.max(profile.defaultBufferMinutes, occupiedItem?.bufferBeforeMinutes ?? 0);
          const occupiedAfter = Math.max(profile.defaultBufferMinutes, occupiedItem?.bufferAfterMinutes ?? 0);
          if (candidate.end <= interval.start) {
            return candidate.end + Math.max(candidateAfter, occupiedBefore) * 60_000 > interval.start;
          }
          if (candidate.start >= interval.end) {
            return candidate.start - Math.max(candidateBefore, occupiedAfter) * 60_000 < interval.end;
          }
          return true;
        })) continue;
        const score = scoreCandidate(
          request.item,
          profile,
          date,
          localMinute,
          candidate.start,
          horizonStartMs,
          energyShiftByDate.get(date) ?? 0
        );
        if (!best || score > best.score) best = { startAt, endAt, date, score };
      }
    }
  }
  return best;
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
    occurrenceKey: item.id,
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

export function buildPlannerProposal(input: PlannerEngineInput): PlannerProposal {
  const baseProfile = normalizePlannerProfile(input.profile);
  const profile = normalizePlannerProfile({
    ...baseProfile,
    ...(input.profilePatch ?? {}),
    revision: baseProfile.revision,
  });
  const now = input.now ?? new Date();
  const startDate = formatDateInTimeZone(now, profile.timezone);
  const endDate = addPlannerDays(startDate, horizonDays(profile.horizon) - 1);
  const trigger = input.trigger ?? (input.command || input.draft || input.drafts?.length ? "quick_add" : "autoplan");
  const normalizedDrafts = input.drafts?.length
    ? input.drafts
    : input.draft
      ? [input.draft]
      : input.command
        ? [parsePlannerCommand(input.command, profile, now)]
        : [];
  const normalizedDraft = normalizedDrafts.length === 1 ? normalizedDrafts[0] : undefined;
  const changes: PlannerProposalChange[] = [];
  const conflicts: PlannerConflict[] = [];
  const unplaced: PlannerUnplaced[] = [];
  const items = input.items.map((item) => normalizePlannerItem(item));
  const movableBlocks = new Map<string, PlannerBlock>();
  let workingBlocks = [...input.blocks];

  if (input.profilePatch) {
    changes.push({
      id: uniqueId("change-profile", baseProfile.revision, trigger),
      kind: "update_profile",
      profile,
      reason: "Настройки подтверждены в автопланировщике.",
    });
  }

  const sleepEvents = [...(input.sleepEvents ?? [])];
  if (input.sleepEvent) {
    const index = sleepEvents.findIndex((event) => event.wakeDate === input.sleepEvent!.wakeDate);
    if (index >= 0) sleepEvents[index] = input.sleepEvent;
    else sleepEvents.push(input.sleepEvent);
    changes.push({
      id: uniqueId("change-sleep", input.sleepEvent.wakeDate),
      kind: "upsert_sleep_event",
      event: input.sleepEvent,
      reason: "Фактический сон учтён; обычный режим следующих ночей не меняется.",
    });
  }

  const calculatedSleepBlocks = buildPlannerSleepBlocks(profile, sleepEvents, startDate, endDate);
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

  if (input.rebuildFuture) {
    const rebuilding = workingBlocks.filter((block) =>
      !block.fixed
      && block.status === "planned"
      && new Date(block.startAt).getTime() >= now.getTime()
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
    const incoming = blockInterval(fixedBlock);
    for (const block of [...workingBlocks, ...sleepBlocks]) {
      if (block.id === fixedBlock.id || block.status === "cancelled" || block.status === "skipped" || !rangesOverlap(incoming, blockInterval(block))) continue;
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

  normalizedDrafts.forEach((draft, index) => {
    const item = normalizePlannerItem({
      ...draft,
      id: draft.id || uniqueId("item", index, draft.title, draft.date, draft.start),
      title: draft.title,
    });
    const existingIndex = items.findIndex((candidate) => candidate.id === item.id);
    if (existingIndex >= 0) items[existingIndex] = item;
    else items.push(item);
    changes.push({ id: uniqueId("change-item", item.id), kind: "add_item", item, reason: "Новое дело подтверждено из формы." });
    const fixedBlocks = item.recurrence?.startTime
      ? recurringFixedBlocks(item, profile, startDate, endDate)
      : [blockFromDraft(draft, item, profile)].filter((block): block is PlannerBlock => Boolean(block));
    fixedBlocks.forEach((block) => considerFixedBlock(block, item.recurrence
      ? "Создано повторение постоянного обязательства."
      : "Фиксированное событие занимает выбранное время."));
  });

  for (const item of items.filter((candidate) => candidate.kind === "fixed_event" && candidate.recurrence?.startTime)) {
    for (const block of recurringFixedBlocks(item, profile, startDate, endDate)) {
      if (workingBlocks.some((candidate) => candidate.itemId === item.id && candidate.occurrenceKey === block.occurrenceKey)) continue;
      considerFixedBlock(block, "Добавлено недостающее повторение постоянного обязательства.");
    }
  }

  for (const sleep of sleepBlocks) {
    for (const block of workingBlocks.filter((candidate) => (candidate.fixed || candidate.status === "in_progress") && candidate.status !== "cancelled" && candidate.status !== "skipped")) {
      if (!rangesOverlap(blockInterval(sleep), blockInterval(block))) continue;
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

  const requests = buildPlacementRequests(items, [...workingBlocks, ...movableBlocks.values()], startDate, endDate);
  for (const block of movableBlocks.values()) {
    const item = items.find((candidate) => candidate.id === block.itemId);
    if (item) requests.unshift({ item, occurrenceKey: block.occurrenceKey ?? item.id, durationMinutes: isoDurationMinutes(block.startAt, block.endAt), sourceBlock: block });
  }

  const autoMinutesByDate = new Map<string, number>();
  for (const block of workingBlocks.filter((candidate) => !candidate.fixed && !["cancelled", "skipped", "done"].includes(candidate.status))) {
    const date = formatDateInTimeZone(new Date(block.startAt), profile.timezone);
    const windows = availabilityForDate(profile, date);
    const minutes = windows.reduce(
      (sum, window) => sum + blockMinutesInsideWindow(block, date, window, profile.timezone),
      0
    );
    autoMinutesByDate.set(date, (autoMinutesByDate.get(date) ?? 0) + minutes);
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const request of requests) {
    let remaining = request.durationMinutes;
    let part = 0;
    while (remaining > 0) {
      const minimum = Math.min(remaining, request.item.minChunkMinutes);
      const duration = request.item.canSplit && remaining >= request.item.minChunkMinutes * 2
        ? Math.min(
            remaining - request.item.minChunkMinutes,
            Math.max(minimum, Math.ceil(remaining / 2 / STEP_MINUTES) * STEP_MINUTES)
          )
        : remaining;
      const placement = findPlacement(
        request,
        duration,
        profile,
        [...workingBlocks, ...sleepBlocks],
        startDate,
        endDate,
        now.getTime(),
        autoMinutesByDate,
        itemById,
        energyShiftByDate
      );
      if (!placement) break;
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
          reason: request.item.preferredWindows.length
            ? "Подобрано свободное окно с учётом предпочтительного времени и нагрузки."
            : "Подобрано свободное окно с учётом приоритета, энергии и нагрузки.",
        });
      }
      workingBlocks.push(block);
      autoMinutesByDate.set(placement.date, (autoMinutesByDate.get(placement.date) ?? 0) + duration);
      remaining -= duration;
      if (!request.item.canSplit) break;
    }
    if (remaining > 0) {
      if (request.sourceBlock && part === 0) {
        changes.push({
          id: uniqueId("remove", request.sourceBlock.id),
          kind: "remove_block",
          blockId: request.sourceBlock.id,
          title: request.sourceBlock.title,
          reason: "Вытеснённый блок возвращён в очередь: безопасного нового времени пока нет.",
        });
      }
      const reason = "Не найдено свободного окна без нарушения доступности, буферов или резерва времени.";
      unplaced.push({
        itemId: request.item.id,
        title: request.item.title,
        remainingMinutes: remaining,
        reason,
      });
      const addedItem = changes.find((change) => change.kind === "add_item" && change.item.id === request.item.id);
      if (addedItem?.kind === "add_item") addedItem.item.unplacedReason = reason;
      else if (!changes.some((change) => change.kind === "update_item" && change.item.id === request.item.id)) {
        changes.push({
          id: uniqueId("update-unplaced", request.item.id),
          kind: "update_item",
          item: { ...request.item, unplacedReason: reason },
          reason: "Причина сохранена вместе с делом в очереди.",
        });
      }
    }
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

  return {
    baseRevision: baseProfile.revision,
    trigger,
    normalizedDraft,
    normalizedDrafts: normalizedDrafts.length > 1 ? normalizedDrafts : undefined,
    changes,
    conflicts,
    unplaced,
    horizonStart: startDate,
    horizonEnd: endDate,
  };
}

export function applyProposalChanges(
  items: PlannerItem[],
  blocks: PlannerBlock[],
  proposal: PlannerProposal
): { items: PlannerItem[]; blocks: PlannerBlock[] } {
  if (proposal.conflicts.length > 0) throw new Error("Нельзя применить предложение с нерешёнными конфликтами.");
  let nextItems = [...items];
  let nextBlocks = [...blocks];
  for (const change of proposal.changes) {
    if (change.kind === "add_item" || change.kind === "update_item") nextItems = [...nextItems.filter((item) => item.id !== change.item.id), change.item];
    else if (change.kind === "add_block") nextBlocks = [...nextBlocks.filter((block) => block.id !== change.block.id), change.block];
    else if (change.kind === "move_block") {
      nextBlocks = nextBlocks.map((block) => block.id === change.blockId
        ? { ...block, startAt: change.toStartAt, endAt: change.toEndAt, source: "auto" }
        : block);
    } else if (change.kind === "remove_block") nextBlocks = nextBlocks.filter((block) => block.id !== change.blockId);
  }
  return { items: nextItems, blocks: nextBlocks };
}

export function plannerCompletionSuggestion(item: PlannerItem, blocks: PlannerBlock[]): number | null {
  const samples = blocks
    .filter((block) => block.itemId === item.id && block.status === "done" && block.actualStartAt && block.actualEndAt)
    .map((block) => isoDurationMinutes(block.actualStartAt!, block.actualEndAt!))
    .filter((duration) => duration >= 5)
    .sort((left, right) => left - right);
  if (samples.length < 3) return null;
  const median = samples[Math.floor(samples.length / 2)];
  return Math.abs(median - item.estimateMinutes) >= 10 ? median : null;
}
