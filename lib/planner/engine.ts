import {
  createDefaultPlannerProfile,
  type PlannerBlock,
  type PlannerConflict,
  type PlannerDeadlineAnalysis,
  type PlannerDraft,
  type PlannerEnergy,
  type PlannerAssistantParseResult,
  type PlannerItem,
  type PlannerMilestone,
  type PlannerPriority,
  type PlannerProfile,
  type PlannerProposal,
  type PlannerProposalInput,
  type PlannerProposalChange,
  type PlannerSleepEvent,
  type PlannerSleepParseResult,
  type PlannerTimeWindow,
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
  sleepWindowForWakeDate,
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
  now?: Date;
  /** A transient profile used to compare sleep choices without changing saved preferences. */
  calculationProfile?: PlannerProfile;
  persistCalculatedSleep?: boolean;
  calculatedSleepReason?: PlannerSleepEvent["selectionReason"];
};

type PlacementRequest = {
  item: PlannerItem;
  occurrenceKey: string;
  durationMinutes: number;
  tier?: "required" | "minimum" | "extra";
  targetDate?: string;
  allowedDates?: string[];
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
  const rawPolicy = value.planningPolicy;
  const planningPolicy: PlannerProfile["planningPolicy"] = {
    focus: rawPolicy?.focus === "work" ? "work" : "sleep",
    minimumNightMinutes: 360,
    maxNightDeficitMinutes: 120,
    maxRollingSevenDayDeficitMinutes: 180,
    recoveryHorizonNights: 3,
    deadlineChainGapMinutes: rawPolicy?.deadlineChainGapMinutes === 0 || rawPolicy?.deadlineChainGapMinutes === 15 ? rawPolicy.deadlineChainGapMinutes : 5,
  };
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
    bufferBeforeMinutes: clamp(Math.round(Number(value.bufferBeforeMinutes ?? 0)), 0, 240),
    bufferAfterMinutes: clamp(Math.round(Number(value.bufferAfterMinutes ?? 0)), 0, 240),
    recurrence: value.recurrence
      ? {
          ...value.recurrence,
          durationMode: value.recurrence.durationMode === "per_cycle" ? "per_cycle" : "per_occurrence",
          schedulingMode: value.recurrence.schedulingMode === "spare_time" ? "spare_time" : "required",
          minimumMinutes: value.recurrence.schedulingMode === "spare_time"
            ? clamp(
                Math.round(Number(value.recurrence.minimumMinutes ?? 30)),
                5,
                clamp(Math.round(Number(value.estimateMinutes ?? 60)), 5, 24 * 60)
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

function parseSleepDurationRange(text: string): { minMinutes: number; maxMinutes: number } | undefined {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:-|—|–|до|to)\s*(\d+(?:[.,]\d+)?)\s*(?:ч(?:ас(?:а|ов)?)?|h(?:ours?)?)/i);
  if (!match) return undefined;
  const first = Math.round(Number(match[1].replace(",", ".")) * 60);
  const second = Math.round(Number(match[2].replace(",", ".")) * 60);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  return { minMinutes: Math.min(first, second), maxMinutes: Math.max(first, second) };
}

function parseExactSleepDurations(text: string): number[] | undefined {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:ч(?:ас(?:а|ов)?)?|h(?:ours?)?)?\s*(?:,|\/|или|либо|и|or|and)\s*(\d+(?:[.,]\d+)?)\s*(?:ч(?:ас(?:а|ов)?)?|h(?:ours?)?)/i);
  if (!match) return undefined;
  const values = [match[1], match[2]]
    .map((value) => Math.round(Number(value.replace(",", ".")) * 60 / 15) * 15)
    .filter((value) => Number.isFinite(value) && value >= 3 * 60 && value <= 16 * 60);
  return values.length === 2 ? Array.from(new Set(values)).sort((left, right) => left - right) : undefined;
}

function parseDeadlineClock(text: string): string | undefined {
  const match = text.match(/(?:дедлайн|срок|сдать|закончить|готово|due|deadline)[^\d]{0,28}(?:к|до|by|at)?\s*(\d{1,2})(?::([0-5]\d))?/i);
  if (!match) return undefined;
  return normalizePlannerTime(`${String(Number(match[1])).padStart(2, "0")}:${match[2] ?? "00"}`) ?? undefined;
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
  const deadlineType = /(?:ж[её]стк(?:ий|ого)?\s+(?:дедлайн|срок)|обязательн.{0,12}(?:сдать|закончить)|hard deadline|must be done)/i.test(lower)
    ? "hard" as const
    : inferredDate && kind === "flexible_task"
      ? "target" as const
      : "none" as const;
  const deadlineClock = parseDeadlineClock(text) ?? "23:59";
  return {
    title,
    kind,
    estimateMinutes: duration,
    priority,
    energy: "normal",
    date: inferredDate ?? baseDate,
    deadlineAt: deadlineType !== "none" && inferredDate
      ? zonedPlannerDateTimeToUtc(inferredDate, deadlineClock, profile.timezone)
      : undefined,
    deadlineType,
    targetFinishMode: "auto",
    estimateConfidence: "normal",
    deadlinePolicy: { chainMode: "inherit" },
    milestones: [],
    start: range?.start,
    end: range?.end,
    canSplit: kind === "flexible_task" && duration >= 60,
    minChunkMinutes: 25,
    allowedWindows: [],
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
  const lower = text.toLocaleLowerCase();
  const durationRange = parseSleepDurationRange(text);
  const exactDurationsMinutes = durationRange ? undefined : parseExactSleepDurations(text);
  const automaticWake = /(?:без разниц|не\s*важно|неважно|выбери сам|выберите сами|любое время).{0,32}(?:встав|подъ[её]м)?|(?:any wake time|wake whenever|choose for me|no wake preference)/i.test(lower);
  const adaptive = /(?:нет|без|не имею|нестабильн|шатк|плавающ).{0,24}(?:график|режим)|(?:no|without|irregular|unstable|flexible).{0,24}(?:schedule|sleep)/i.test(lower)
    || automaticWake
    || Boolean(durationRange)
    || Boolean(exactDurationsMinutes);
  const timeMatch = text.match(/(?:лож(?:усь|иться|усь спать)|спать|bed(?:time)?|sleep)\D{0,20}(\d{1,2})(?::([0-5]\d))?/i)
    ?? text.match(/\b(?:в|at)\s*(\d{1,2})(?::([0-5]\d))?/i);
  const bedtime = timeMatch
    ? normalizePlannerTime(`${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2] ?? "00"}`)
    : undefined;
  const durationMinutes = durationRange ? undefined : parseDuration(text);
  const planningFocus = /(?:работа|дедлайн|дела).{0,24}важн.{0,16}(?:сна|сон)|(?:work|deadlines?).{0,24}(?:over|before|more important).{0,12}sleep/i.test(lower)
    ? "work" as const
    : /(?:сон).{0,24}важн|(?:sleep).{0,24}(?:first|priority|more important)/i.test(lower)
      ? "sleep" as const
      : undefined;
  const sleepinessLevel = /(?:еле держ|вырубает|засыпаю на ходу|extremely sleepy|can barely stay awake)/i.test(lower)
    ? 4 as const
    : /(?:очень сонн|очень плохо|сильно хочу спать|very sleepy)/i.test(lower)
      ? 3 as const
      : /(?:не высп|хренов|плохо|заметно сонн|tired|not rested)/i.test(lower)
        ? 2 as const
        : /(?:немного сонн|слегка сонн|a little sleepy)/i.test(lower)
          ? 1 as const
          : /(?:бодр|хорошо высп|alert|well rested)/i.test(lower)
            ? 0 as const
            : undefined;
  const wakeDayPart = automaticWake
    ? "auto" as const
    : /(?:ранн.{0,8}утр|early morning)/i.test(lower)
      ? "early_morning" as const
      : /(?:ближе к полуд|поздн.{0,8}утр|late morning|near noon)/i.test(lower)
        ? "late_morning" as const
        : /(?:утр|morning)/i.test(lower)
          ? "morning" as const
          : undefined;
  const estimatedBedtimeRange = !durationRange && /(?:лягу|ложусь|усну|bed|sleep)/i.test(lower)
    ? parseTimeRange(text)
    : undefined;
  const changeKind = /(?:ложусь сейчас|иду спать|going to bed now)/i.test(lower)
    ? "bedtime_now" as const
    : /(?:проснул|проснулась|уже проснулся|woke up|already awake)/i.test(lower)
      ? "wake_now" as const
      : /(?:лягу позже|поздно лягу|лягу примерно|время неизвестно|sleep later|rough bedtime|bedtime unknown)/i.test(lower) || Boolean(estimatedBedtimeRange)
        ? "later_unknown" as const
        : undefined;
  const ambiguities: string[] = [];
  if (!adaptive && !bedtime && !changeKind) ambiguities.push("Не удалось определить время отхода ко сну.");
  if (!durationMinutes && !durationRange && !exactDurationsMinutes && !changeKind && sleepinessLevel === undefined) ambiguities.push("Не удалось определить обычную длительность сна, диапазон или точные варианты.");
  if (adaptive && !wakeDayPart) ambiguities.push("Укажите удобную часть дня для подъёма или выберите «Без разницы — выбери сам».");
  return {
    mode: changeKind ? undefined : adaptive ? "adaptive" : bedtime || durationMinutes ? "fixed" : undefined,
    bedtime,
    durationMinutes,
    durationRange,
    exactDurationsMinutes,
    planningFocus,
    sleepinessLevel,
    wakeDayPart,
    changeKind,
    estimatedBedtimeRange,
    ambiguities,
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

function placementFootprintMinutes(item: PlannerItem, durationMinutes: number): number {
  return durationMinutes + item.bufferBeforeMinutes + item.bufferAfterMinutes;
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

function deadlineBufferMinutes(item: PlannerItem): number {
  const ratio = item.estimateConfidence === "high" ? 0.15 : item.estimateConfidence === "low" ? 0.5 : 0.3;
  const minimum = item.estimateConfidence === "high" ? 30 : item.estimateConfidence === "low" ? 120 : 60;
  const maximum = item.estimateConfidence === "high" ? 240 : item.estimateConfidence === "low" ? 960 : 480;
  return Math.ceil(clamp(item.estimateMinutes * ratio, minimum, maximum) / STEP_MINUTES) * STEP_MINUTES;
}

function plannerSlotAvailable(profile: PlannerProfile, occupied: PlannerBlock[], start: number, end: number): boolean {
  const instant = new Date(start);
  const date = formatDateInTimeZone(instant, profile.timezone);
  const minute = plannerTimeToMinutes(formatTimeInTimeZone(instant, profile.timezone));
  const insideAvailability = availabilityForDate(profile, date).some((window) => windowContainsMinute(window, minute));
  if (!insideAvailability) return false;
  return !occupied.some((block) => {
    if (block.status === "cancelled" || block.status === "skipped") return false;
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
  now = new Date()
): PlannerDeadlineAnalysis[] {
  return items.flatMap((item): PlannerDeadlineAnalysis[] => {
    if (item.status !== "active" || item.deadlineType === "none" || !item.deadlineAt) return [];
    const completedMinutes = blocks
      .filter((block) => block.itemId === item.id && block.status === "done")
      .reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
    const remainingMinutes = Math.max(0, item.estimateMinutes - completedMinutes);
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
  timezone: string
): PlacementRequest[] {
  const requests: PlacementRequest[] = [];
  const activeBlocks = blocks.filter((block) => block.status !== "cancelled" && block.status !== "skipped");
  const recurrenceBlocks = blocks.filter((block) => block.status !== "cancelled");
  const pushRecurringRequest = (
    item: PlannerItem,
    occurrenceKey: string,
    alreadyPlanned: number,
    constraints: Pick<PlacementRequest, "targetDate" | "allowedDates">
  ) => {
    if (item.recurrence?.schedulingMode !== "spare_time") {
      const remaining = Math.max(0, item.estimateMinutes - alreadyPlanned);
      if (remaining > 0) requests.push({ item, occurrenceKey, durationMinutes: remaining, tier: "required", ...constraints });
      return;
    }
    const minimumTarget = Math.min(item.estimateMinutes, item.recurrence.minimumMinutes ?? 30);
    const minimumRemaining = Math.max(0, minimumTarget - alreadyPlanned);
    const extraRemaining = Math.max(0, item.estimateMinutes - Math.max(alreadyPlanned, minimumTarget));
    if (minimumRemaining > 0) requests.push({
      item,
      occurrenceKey: `${occurrenceKey}:minimum`,
      durationMinutes: minimumRemaining,
      tier: "minimum",
      ...constraints,
    });
    if (extraRemaining > 0) requests.push({
      item,
      occurrenceKey: `${occurrenceKey}:extra`,
      durationMinutes: extraRemaining,
      tier: "extra",
      ...constraints,
    });
  };
  for (const item of items) {
    if (item.status !== "active" || !item.autoPlan || item.kind === "fixed_event") continue;
    if (item.kind === "routine" || item.recurrence?.frequency === "once") {
      const routineDates = getRoutineDates(item, startDate, endDate);
      if (item.kind === "routine" && item.recurrence?.durationMode === "per_cycle") {
        const datesByWeek = new Map<string, string[]>();
        for (const date of routineDates) {
          const weekStart = calendarWeekStart(date);
          datesByWeek.set(weekStart, [...(datesByWeek.get(weekStart) ?? []), date]);
        }
        for (const [weekStart, allowedDates] of datesByWeek) {
          const weekEnd = addPlannerDays(weekStart, 6);
          const alreadyPlanned = recurrenceBlocks
            .filter((block) => {
              if (block.itemId !== item.id) return false;
              const date = blockLocalDate(block, timezone);
              return date >= weekStart && date <= weekEnd;
            })
            .reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
          pushRecurringRequest(item, `${item.id}:cycle:${weekStart}`, alreadyPlanned, { allowedDates });
        }
        continue;
      }
      for (const date of routineDates) {
        const key = `${item.id}:${date}`;
        const alreadyPlanned = recurrenceBlocks
          .filter((block) => block.itemId === item.id && blockLocalDate(block, timezone) === date)
          .reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
        pushRecurringRequest(item, key, alreadyPlanned, { targetDate: date });
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
    const placementRank = (request: PlacementRequest) => {
      if (request.item.deadlineType === "hard") return 0;
      if (request.tier === "required" || request.item.deadlineType === "target") return 1;
      if (request.tier === "minimum") return 2;
      if (request.tier === "extra") return 4;
      return 3;
    };
    const rank = placementRank(left) - placementRank(right);
    if (rank) return rank;
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
  for (let date = startDate; date <= endDate; date = addPlannerDays(date, 1)) {
    if (request.targetDate && date !== request.targetDate) continue;
    if (request.allowedDates && !request.allowedDates.includes(date)) continue;
    const windows = availabilityForDate(profile, date);
    const totalAvailable = windows.reduce((sum, window) => sum + durationForLocalRange(window.start, window.end), 0);
    const fixedMinutes = occupied
      .filter((block) => block.fixed && !["cancelled", "skipped"].includes(block.status))
      .reduce((sum, block) => {
        const bodyMinutes = windows.reduce(
          (windowSum, window) => windowSum + blockMinutesInsideWindow(block, date, window, profile.timezone),
          0
        );
        if (!bodyMinutes) return sum;
        const blockItem = block.itemId ? itemById.get(block.itemId) : undefined;
        return sum + bodyMinutes + (blockItem?.bufferBeforeMinutes ?? 0) + (blockItem?.bufferAfterMinutes ?? 0);
      }, 0);
    const capacity = Math.floor(Math.max(0, totalAvailable - fixedMinutes) * (1 - profile.reserveRatio));
    if ((autoMinutesByDate.get(date) ?? 0) + placementFootprintMinutes(request.item, durationMinutes) > capacity) continue;
    for (const window of windows) {
      const windowStart = plannerTimeToMinutes(window.start);
      let windowEnd = plannerTimeToMinutes(window.end);
      if (windowEnd <= windowStart) windowEnd += 1440;
      for (let minute = Math.ceil(windowStart / STEP_MINUTES) * STEP_MINUTES; minute + durationMinutes <= windowEnd; minute += STEP_MINUTES) {
        const localDate = minute >= 1440 ? addPlannerDays(date, 1) : date;
        const localMinute = minute % 1440;
        if (request.item.allowedWindows.length > 0
          && !request.item.allowedWindows.some((candidate) => rangeInsideWindow(candidate, localMinute, localMinute + durationMinutes))) continue;
        if (minute - request.item.bufferBeforeMinutes < windowStart
          || minute + durationMinutes + request.item.bufferAfterMinutes > windowEnd) continue;
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
        if (candidate.start - request.item.bufferBeforeMinutes * 60_000 < nowMs) continue;
        if (request.item.earliestAt && candidate.start < new Date(request.item.earliestAt).getTime()) continue;
        if (occupied.some((block) => {
          if (block.status === "cancelled" || block.status === "skipped") return false;
          const interval = blockInterval(block);
          const occupiedItem = block.itemId ? itemById.get(block.itemId) : undefined;
          const occupiedBefore = occupiedItem?.bufferBeforeMinutes ?? 0;
          const occupiedAfter = occupiedItem?.bufferAfterMinutes ?? 0;
          if (candidate.end <= interval.start) {
            return candidate.end + requiredPlannerGap(
              profile.defaultBufferMinutes,
              request.item.bufferAfterMinutes,
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
              request.item.bufferBeforeMinutes
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
      }
    }
  }
  return best;
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

function buildPlannerProposalResolved(input: PlannerEngineInput): PlannerProposal {
  const baseProfile = normalizePlannerProfile(input.profile);
  const storedProfile = normalizePlannerProfile({
    ...baseProfile,
    ...(input.profilePatch ?? {}),
    revision: baseProfile.revision,
  });
  const profile = input.calculationProfile
    ? normalizePlannerProfile({ ...input.calculationProfile, revision: baseProfile.revision })
    : storedProfile;
  const effectiveFocus = input.planningFocusOverride ?? storedProfile.planningPolicy.focus;
  if (storedProfile.sleepSchedule.mode === "adaptive" && storedProfile.sleepSchedule.requiresHealthyMinimumConfirmation) {
    throw new Error("Подтвердите пробную цель 7 часов или выберите ручной фиксированный режим.");
  }
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
      normalizedDraft,
      normalizedDrafts: normalizedDrafts.length > 1 ? normalizedDrafts : undefined,
      blockExtension: input.blockExtension,
      changes,
      conflicts,
      unplaced,
      effectiveFocus,
      horizonStart: startDate,
      horizonEnd: endDate,
    };
  }

  const durationBounds = sleepDurationBounds(profile.sleepSchedule);
  const calculatedSleepBlocks = buildPlannerSleepBlocks(profile, sleepEvents, startDate, endDate).map((block) => ({
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
    const fixedItem = fixedBlock.itemId ? items.find((item) => item.id === fixedBlock.itemId) : undefined;
    const rawIncoming = blockInterval(fixedBlock);
    const incoming = {
      start: rawIncoming.start - (fixedItem?.bufferBeforeMinutes ?? 0) * 60_000,
      end: rawIncoming.end + (fixedItem?.bufferAfterMinutes ?? 0) * 60_000,
    };
    for (const block of [...workingBlocks, ...sleepBlocks]) {
      const occupiedItem = block.itemId ? items.find((item) => item.id === block.itemId) : undefined;
      const rawOccupied = blockInterval(block);
      const occupied = {
        start: rawOccupied.start - (occupiedItem?.bufferBeforeMinutes ?? 0) * 60_000,
        end: rawOccupied.end + (occupiedItem?.bufferAfterMinutes ?? 0) * 60_000,
      };
      if (block.id === fixedBlock.id || block.status === "cancelled" || block.status === "skipped" || !rangesOverlap(incoming, occupied)) continue;
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

  if (input.blockExtension) {
    const original = workingBlocks.find((block) => block.id === input.blockExtension!.blockId);
    if (!original || !["planned", "in_progress"].includes(original.status) || original.fixed) {
      throw new Error("Продлить можно только текущее или будущее гибкое дело.");
    }
    const extended = { ...original, endAt: addIsoMinutes(original.endAt, input.blockExtension.minutes) };
    for (const block of [...workingBlocks, ...sleepBlocks]) {
      if (block.id === original.id || !rangesOverlap(blockInterval(extended), blockInterval(block))) continue;
      if (block.fixed || block.status === "done" || block.status === "in_progress" || new Date(block.startAt).getTime() < now.getTime()) {
        conflicts.push({
          id: uniqueId("extension-conflict", original.id, block.id),
          kind: block.status === "in_progress" ? "active_overlap" : "fixed_overlap",
          title: original.title,
          message: block.id.startsWith("sleep-")
            ? "Дополнительные 15 минут пересекаются с защищённым сном. Продление не применено."
            : "Дополнительные 15 минут пересекаются с защищённым или уже начатым делом.",
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
      reason: "Добавлено 15 минут; всё последующее пересчитано без молчаливого сдвига сна или другого срока.",
    });
    const itemIndex = items.findIndex((item) => item.id === original.itemId);
    if (itemIndex >= 0) {
      items[itemIndex] = { ...items[itemIndex], estimateMinutes: items[itemIndex].estimateMinutes + input.blockExtension.minutes };
      changes.push({
        id: uniqueId("extend-item", items[itemIndex].id, items[itemIndex].estimateMinutes),
        kind: "update_item",
        item: items[itemIndex],
        reason: "Оценка длительности увеличена на подтверждаемые 15 минут.",
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
      const blockItem = block.itemId ? items.find((item) => item.id === block.itemId) : undefined;
      const rawBlock = blockInterval(block);
      const protectedBlock = {
        start: rawBlock.start - (blockItem?.bufferBeforeMinutes ?? 0) * 60_000,
        end: rawBlock.end + (blockItem?.bufferAfterMinutes ?? 0) * 60_000,
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

  const requests = buildPlacementRequests(
    items,
    [...workingBlocks, ...movableBlocks.values()],
    startDate,
    endDate,
    profile.timezone
  );
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

  const autoMinutesByDate = new Map<string, number>();
  const itemById = new Map(items.map((item) => [item.id, item]));
  for (const block of workingBlocks.filter((candidate) => !candidate.fixed && !["cancelled", "skipped", "done"].includes(candidate.status))) {
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
    let part = 0;
    while (remaining > 0) {
      const minimum = Math.min(remaining, request.item.minChunkMinutes);
      const duration = request.item.canSplit && remaining >= request.item.minChunkMinutes * 2
        ? Math.min(
            remaining - request.item.minChunkMinutes,
            Math.max(
              minimum,
              Math.ceil(
                remaining / (request.allowedDates?.length ?? 2) / STEP_MINUTES
              ) * STEP_MINUTES
            )
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
        energyShiftByDate,
        chainByItemId.get(request.item.id)
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
          reason: request.tier === "extra"
            ? "Свободное время добавлено после размещения обязательств, сроков и защищённого минимума."
            : request.tier === "minimum"
              ? "Минимальное время хобби защищено от вытеснения обычными гибкими делами."
              : request.item.preferredWindows.length
            ? "Подобрано свободное окно с учётом предпочтительного времени и нагрузки."
            : "Подобрано свободное окно с учётом приоритета, энергии и нагрузки.",
        });
      }
      workingBlocks.push(block);
      autoMinutesByDate.set(
        placement.date,
        (autoMinutesByDate.get(placement.date) ?? 0) + placementFootprintMinutes(request.item, duration)
      );
      remaining -= duration;
      if (!request.item.canSplit) break;
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
          reason: "Вытеснённый блок возвращён в очередь: безопасного нового времени пока нет.",
        });
      }
      if (request.tier === "extra") continue;
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

  const deadlineAnalysis = analyzePlannerDeadlines(items, [...workingBlocks, ...sleepBlocks], profile, now);
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

  return {
    baseRevision: baseProfile.revision,
    trigger,
    normalizedDraft,
    normalizedDrafts: normalizedDrafts.length > 1 ? normalizedDrafts : undefined,
    blockExtension: input.blockExtension,
    changes,
    conflicts,
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
    })),
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
    ...draftsForProposal(input, requestedProfile, input.now ?? new Date()).map((draft, index) => normalizePlannerItem({
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

function draftsForProposal(input: PlannerEngineInput, profile: PlannerProfile, now: Date): PlannerDraft[] {
  if (input.drafts?.length) return input.drafts;
  if (input.draft) return [input.draft];
  if (input.command) return [parsePlannerCommand(input.command, profile, now)];
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

function compareAutoWakeCandidates(left: AutoWakeCandidate, right: AutoWakeCandidate): number {
  const comparisons = [
    left.recurringConflictCount - right.recurringConflictCount,
    left.deadlineViolations - right.deadlineViolations,
    left.unplacedMinutes - right.unplacedMinutes,
    left.peakLoadMinutes - right.peakLoadMinutes,
    left.energyMismatchMinutes - right.energyMismatchMinutes,
    right.placedMinutes - left.placedMinutes,
    Math.abs(left.minute - 9 * 60) - Math.abs(right.minute - 9 * 60),
    left.minute - right.minute,
  ];
  return comparisons.find((value) => value !== 0) ?? 0;
}

function resolveAutomaticWake(input: PlannerEngineInput): PlannerProposal | null {
  const now = input.now ?? new Date();
  const baseProfile = normalizePlannerProfile(input.profile);
  const requestedProfile = normalizePlannerProfile({
    ...baseProfile,
    ...(input.profilePatch ?? {}),
    revision: baseProfile.revision,
  });
  const schedule = requestedProfile.sleepSchedule;
  if (schedule.mode !== "adaptive" || schedule.wakeAnchor.dayPart !== "auto") return null;
  const trigger = input.trigger ?? (input.command || input.draft || input.drafts?.length ? "quick_add" : "autoplan");
  const shouldResolve = Boolean(input.profilePatch?.sleepSchedule)
    || Boolean(input.rebuildFuture && ["autoplan", "assistant_setup", "assistant_update"].includes(trigger));
  if (!shouldResolve) return null;

  const drafts = draftsForProposal(input, requestedProfile, now);
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
  const candidateMinutes = Array.from({ length: (12 * 60 - 6 * 60 - 30) / STEP_MINUTES + 1 }, (_, index) => 6 * 60 + 30 + index * STEP_MINUTES)
    .filter((minute) => !requirement || minute <= requirement.minute);
  if (requirement && requirement.minute < 6 * 60 + 30) candidateMinutes.splice(0, candidateMinutes.length, requirement.minute);
  if (candidateMinutes.length === 0) candidateMinutes.push(requirement?.minute ?? 9 * 60);

  const initialWakeMinute = plannerTimeToMinutes(schedule.wakeAnchor.localTime);
  const derivedAvailability = availabilityFromSleepSchedule(schedule);
  const availabilityFollowsSleep = Boolean(input.profilePatch?.availability)
    || sameAvailability(requestedProfile.availability, derivedAvailability);
  const candidates = candidateMinutes.map((minute) => {
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
  }).sort(compareAutoWakeCandidates);
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

export function buildPlannerProposal(input: PlannerEngineInput): PlannerProposal {
  return resolveAutomaticWake(input) ?? resolvePreferredSleepDuration(input);
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
