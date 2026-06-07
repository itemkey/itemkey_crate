export const MESSAGE_SCHEDULE_KIND = "itemkey-message-schedule-v1";

export type ScheduleViewMode = "day" | "week" | "list";
export type ScheduleEventType = "fixed" | "flexible" | "habit" | "spontaneous";
export type SchedulePriority = "low" | "medium" | "high";
export type ScheduleStatus = "planned" | "done" | "skipped";
export type ScheduleGoalPeriod = "day" | "week";
export type ScheduleEnergyMode = "low" | "normal" | "high";
export type ScheduleDayMode = "normal" | "shifted" | "recovery";
export type ScheduleRescheduleMode = "soft" | "normal" | "strict";

export type ScheduleEvent = {
  id: string;
  title: string;
  description?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  date?: string;
  type: ScheduleEventType;
  category?: string;
  priority?: SchedulePriority;
  status: ScheduleStatus;
  canMove?: boolean;
  canSplit?: boolean;
  deadline?: string;
  recurrence?: string;
};

export type ScheduleGoal = {
  id: string;
  title: string;
  category?: string;
  period: ScheduleGoalPeriod;
  targetCount?: number;
  targetMinutes?: number;
  currentCount?: number;
  currentMinutes?: number;
};

export type ScheduleSettings = {
  defaultDayStart?: string;
  defaultDayEnd?: string;
  bufferMinutes?: number;
  energyMode?: ScheduleEnergyMode;
  dayMode?: ScheduleDayMode;
  rescheduleMode?: ScheduleRescheduleMode;
  preserveFreeTime?: boolean;
};

export type SchedulePayload = {
  viewMode: ScheduleViewMode;
  selectedDate: string;
  events: ScheduleEvent[];
  goals: ScheduleGoal[];
  settings: ScheduleSettings;
};

export type ScheduleBlock = SchedulePayload & {
  id: string;
  title: string;
};

export type SchedulePlanningInput = {
  text?: string;
  title?: string;
  description?: string;
  durationMinutes?: number;
  date?: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  preferredTime?: string;
  avoidedTime?: string;
  deadline?: string;
  priority?: SchedulePriority;
  category?: string;
  canMove?: boolean;
  canSplit?: boolean;
  type?: ScheduleEventType;
};

export type ScheduleSuggestion = {
  id: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  title: string;
  reason: string;
  event: ScheduleEvent;
};

export type ScheduleSpontaneousInput = {
  text?: string;
  date?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  priority?: SchedulePriority;
  canCancel?: boolean;
  scope?: "today" | "near";
};

export type SchedulePreviewChange =
  | {
      id: string;
      kind: "add";
      event: ScheduleEvent;
      reason: string;
    }
  | {
      id: string;
      kind: "move";
      eventId: string;
      title: string;
      fromDate?: string;
      fromStart?: string;
      fromEnd?: string;
      toDate: string;
      toStart: string;
      toEnd: string;
      reason: string;
    }
  | {
      id: string;
      kind: "note";
      title: string;
      reason: string;
    };

export type ScheduleSpontaneousPreview = {
  changes: SchedulePreviewChange[];
  message: string;
};

export type ScheduleSummary = {
  plannedMinutes: number;
  doneMinutes: number;
  skippedMinutes: number;
  freeMinutes: number;
  eventCount: number;
};

export type ScheduleGoalProgress = ScheduleGoal & {
  currentCount: number;
  currentMinutes: number;
};

type FreeWindow = {
  date: string;
  start: number;
  end: number;
};

const DEFAULT_DAY_START = "08:00";
const DEFAULT_DAY_END = "22:00";
const DEFAULT_BUFFER_MINUTES = 15;
const MIN_EVENT_DURATION = 5;
const MAX_EVENT_DURATION = 24 * 60;

export function todayLocalDate(): string {
  return toLocalDateString(new Date());
}

export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addScheduleDays(date: string, days: number): string {
  const base = parseLocalDate(date) ?? parseLocalDate(todayLocalDate()) ?? new Date();
  base.setDate(base.getDate() + days);
  return toLocalDateString(base);
}

export function getScheduleWeekDates(date: string): string[] {
  const base = parseLocalDate(normalizeScheduleDate(date));
  if (!base) {
    return [];
  }

  const day = base.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(base);
    next.setDate(base.getDate() + index);
    return toLocalDateString(next);
  });
}

export function createDefaultSchedulePayload(
  selectedDate = todayLocalDate()
): SchedulePayload {
  return {
    viewMode: "day",
    selectedDate: normalizeScheduleDate(selectedDate),
    events: [],
    goals: [],
    settings: {
      defaultDayStart: DEFAULT_DAY_START,
      defaultDayEnd: DEFAULT_DAY_END,
      bufferMinutes: DEFAULT_BUFFER_MINUTES,
      energyMode: "normal",
      dayMode: "normal",
      rescheduleMode: "normal",
      preserveFreeTime: true,
    },
  };
}

export function createDefaultScheduleBlock(
  id = createScheduleId("schedule"),
  title = "Расписание",
  selectedDate = todayLocalDate()
): ScheduleBlock {
  return {
    id,
    title: normalizeScheduleTitle(title),
    ...createDefaultSchedulePayload(selectedDate),
  };
}

export function createScheduleId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function normalizeScheduleTitle(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || "Расписание").slice(0, 90);
}

export function normalizeSchedulePayload(value: unknown): SchedulePayload {
  const raw = isObjectRecord(value) ? value : {};
  const defaults = createDefaultSchedulePayload();

  return {
    viewMode: normalizeScheduleViewMode(raw.viewMode),
    selectedDate: normalizeScheduleDate(raw.selectedDate, defaults.selectedDate),
    events: normalizeScheduleEvents(raw.events),
    goals: normalizeScheduleGoals(raw.goals),
    settings: normalizeScheduleSettings(raw.settings),
  };
}

export function normalizeScheduleBlocks(value: unknown): ScheduleBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const schedules: ScheduleBlock[] = [];

  value.forEach((entry, index) => {
    if (!isObjectRecord(entry)) {
      return;
    }

    const rawId = typeof entry.id === "string" ? entry.id.trim() : "";
    const baseId = rawId || `schedule-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (seen.has(id.toLocaleLowerCase())) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(id.toLocaleLowerCase());

    schedules.push({
      id,
      title: normalizeScheduleTitle(entry.title),
      ...normalizeSchedulePayload(entry),
    });
  });

  return schedules;
}

export function parseMessageScheduleContent(
  value: string | null | undefined
): SchedulePayload | null {
  const raw = typeof value === "string" ? value : "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObjectRecord(parsed) || parsed.kind !== MESSAGE_SCHEDULE_KIND) {
      return null;
    }

    return normalizeSchedulePayload(parsed);
  } catch {
    return null;
  }
}

export function serializeMessageScheduleContent(payload: SchedulePayload): string {
  const normalized = normalizeSchedulePayload(payload);
  return JSON.stringify({
    kind: MESSAGE_SCHEDULE_KIND,
    viewMode: normalized.viewMode,
    selectedDate: normalized.selectedDate,
    events: normalized.events,
    goals: normalized.goals,
    settings: normalized.settings,
  });
}

export function normalizeScheduleEvent(value: unknown, index = 0): ScheduleEvent {
  const raw = isObjectRecord(value) ? value : {};
  const type = normalizeScheduleEventType(raw.type);
  const start = normalizeOptionalTime(raw.start);
  const rawDuration =
    typeof raw.durationMinutes === "number" ? raw.durationMinutes : raw.duration;
  const duration = normalizeScheduleDuration(rawDuration, getDurationFromRange(start, raw.end));
  const end =
    normalizeOptionalTime(raw.end) ??
    (start ? minutesToTime(timeToMinutes(start) + duration) : undefined);

  return {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : createScheduleId(`event-${index + 1}`),
    title: normalizeScheduleEventTitle(raw.title),
    description: normalizeOptionalText(raw.description, 600),
    date: normalizeScheduleDate(raw.date),
    start,
    end,
    durationMinutes: duration,
    type,
    category: normalizeOptionalText(raw.category, 80),
    priority: normalizeSchedulePriority(raw.priority),
    status: normalizeScheduleStatus(raw.status),
    canMove:
      typeof raw.canMove === "boolean"
        ? raw.canMove
        : type !== "fixed" && type !== "spontaneous",
    canSplit:
      typeof raw.canSplit === "boolean" ? raw.canSplit : type === "flexible",
    deadline: normalizeOptionalDate(raw.deadline),
    recurrence: normalizeOptionalText(raw.recurrence, 100),
  };
}

export function normalizeScheduleEvents(value: unknown): ScheduleEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const events: ScheduleEvent[] = [];
  value.forEach((entry, index) => {
    const event = normalizeScheduleEvent(entry, index);
    let id = event.id;
    const baseId = id;
    let suffix = 2;
    while (seen.has(id.toLocaleLowerCase())) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(id.toLocaleLowerCase());
    events.push({ ...event, id });
  });
  return events;
}

export function normalizeScheduleGoal(value: unknown, index = 0): ScheduleGoal {
  const raw = isObjectRecord(value) ? value : {};
  return {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : createScheduleId(`goal-${index + 1}`),
    title: normalizeScheduleEventTitle(raw.title || raw.category || "Норма"),
    category: normalizeOptionalText(raw.category, 80),
    period: raw.period === "day" ? "day" : "week",
    targetCount: normalizeOptionalPositiveInteger(raw.targetCount),
    targetMinutes: normalizeOptionalPositiveInteger(raw.targetMinutes),
    currentCount: normalizeOptionalPositiveInteger(raw.currentCount),
    currentMinutes: normalizeOptionalPositiveInteger(raw.currentMinutes),
  };
}

export function normalizeScheduleGoals(value: unknown): ScheduleGoal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const goals: ScheduleGoal[] = [];
  value.forEach((entry, index) => {
    const goal = normalizeScheduleGoal(entry, index);
    let id = goal.id;
    const baseId = id;
    let suffix = 2;
    while (seen.has(id.toLocaleLowerCase())) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(id.toLocaleLowerCase());
    goals.push({ ...goal, id });
  });
  return goals;
}

export function normalizeScheduleSettings(value: unknown): ScheduleSettings {
  const raw = isObjectRecord(value) ? value : {};
  const bufferValue =
    typeof raw.bufferMinutes === "number" ? raw.bufferMinutes : Number(raw.bufferMinutes);
  const bufferMinutes = Number.isFinite(bufferValue)
    ? Math.min(120, Math.max(0, Math.round(bufferValue)))
    : DEFAULT_BUFFER_MINUTES;

  return {
    defaultDayStart: normalizeOptionalTime(raw.defaultDayStart) ?? DEFAULT_DAY_START,
    defaultDayEnd: normalizeOptionalTime(raw.defaultDayEnd) ?? DEFAULT_DAY_END,
    bufferMinutes,
    energyMode: normalizeScheduleEnergyMode(raw.energyMode),
    dayMode: normalizeScheduleDayMode(raw.dayMode),
    rescheduleMode: normalizeScheduleRescheduleMode(raw.rescheduleMode),
    preserveFreeTime:
      typeof raw.preserveFreeTime === "boolean" ? raw.preserveFreeTime : true,
  };
}

export function getScheduleDayEvents(
  payload: SchedulePayload,
  date = payload.selectedDate
): ScheduleEvent[] {
  const targetDate = normalizeScheduleDate(date, payload.selectedDate);
  return payload.events
    .filter((event) => normalizeScheduleDate(event.date, payload.selectedDate) === targetDate)
    .sort(compareScheduleEvents);
}

export function getScheduleListEvents(payload: SchedulePayload): ScheduleEvent[] {
  return [...payload.events].sort(compareScheduleEvents);
}

export function getScheduleSummary(
  payload: SchedulePayload,
  dates: string[] = [payload.selectedDate]
): ScheduleSummary {
  const dateSet = new Set(dates.map((date) => normalizeScheduleDate(date)));
  const settings = normalizeScheduleSettings(payload.settings);
  const dayStart = timeToMinutes(settings.defaultDayStart ?? DEFAULT_DAY_START);
  const dayEnd = timeToMinutes(settings.defaultDayEnd ?? DEFAULT_DAY_END);
  const availablePerDay = Math.max(0, dayEnd - dayStart);
  let plannedMinutes = 0;
  let doneMinutes = 0;
  let skippedMinutes = 0;
  let eventCount = 0;

  for (const event of payload.events) {
    if (!event.date || !dateSet.has(normalizeScheduleDate(event.date))) {
      continue;
    }

    const duration = getEventDurationMinutes(event);
    eventCount += 1;
    if (event.status === "done") {
      doneMinutes += duration;
    } else if (event.status === "skipped") {
      skippedMinutes += duration;
    } else {
      plannedMinutes += duration;
    }
  }

  return {
    plannedMinutes,
    doneMinutes,
    skippedMinutes,
    freeMinutes: Math.max(0, availablePerDay * dateSet.size - plannedMinutes),
    eventCount,
  };
}

export function getScheduleFreeWindows(
  payload: SchedulePayload,
  date = payload.selectedDate
): Array<{ date: string; start: string; end: string; durationMinutes: number }> {
  return buildFreeWindowsForDate(payload, normalizeScheduleDate(date)).map((window) => ({
    date: window.date,
    start: minutesToTime(window.start),
    end: minutesToTime(window.end),
    durationMinutes: Math.max(0, window.end - window.start),
  }));
}

export function getScheduleGoalProgress(
  payload: SchedulePayload,
  selectedDate = payload.selectedDate
): ScheduleGoalProgress[] {
  const weekDates = getScheduleWeekDates(selectedDate);
  const selected = normalizeScheduleDate(selectedDate);

  return payload.goals.map((goal) => {
    const targetDates = goal.period === "day" ? [selected] : weekDates;
    const categoryKey = normalizeGoalCategoryKey(goal);
    let currentCount = 0;
    let currentMinutes = 0;

    for (const event of payload.events) {
      if (event.status !== "done") {
        continue;
      }

      if (!event.date || !targetDates.includes(normalizeScheduleDate(event.date))) {
        continue;
      }

      if (categoryKey && normalizeComparable(event.category || event.title) !== categoryKey) {
        continue;
      }

      currentCount += 1;
      currentMinutes += getEventDurationMinutes(event);
    }

    return {
      ...goal,
      currentCount,
      currentMinutes,
    };
  });
}

export function buildScheduleSuggestions(
  payload: SchedulePayload,
  input: SchedulePlanningInput,
  baseDate = payload.selectedDate
): ScheduleSuggestion[] {
  const normalizedPayload = normalizeSchedulePayload(payload);
  const parsed = inferPlanningInput(input, baseDate);
  if (!parsed.title && !parsed.durationMinutes) {
    return [];
  }

  const durationMinutes = normalizeScheduleDuration(parsed.durationMinutes, 60);
  const dateRange = resolveSuggestionDateRange(normalizedPayload, parsed, baseDate);
  const preferredRange = preferredRangeForInput(parsed.preferredTime || parsed.text);
  const suggestions: ScheduleSuggestion[] = [];

  for (const date of dateRange) {
    const windows = buildFreeWindowsForDate(normalizedPayload, date);
    for (const window of windows) {
      const candidateStarts = getCandidateStarts(window, durationMinutes, preferredRange);
      for (const start of candidateStarts) {
        const end = start + durationMinutes;
        if (end > window.end) {
          continue;
        }

        const load = getScheduledMinutesForDate(normalizedPayload, date);
        const preferredBonus =
          preferredRange && rangesOverlap(start, end, preferredRange.start, preferredRange.end)
            ? 300
            : 0;
        const deadlineBonus = parsed.deadline && date <= parsed.deadline ? 80 : 0;
        const priorityBonus = parsed.priority === "high" ? 60 : parsed.priority === "medium" ? 30 : 0;
        const score = preferredBonus + deadlineBonus + priorityBonus - load / 4 - suggestions.length;

        const event: ScheduleEvent = {
          id: createScheduleId("event"),
          title: parsed.title || "Новое дело",
          description: parsed.description || undefined,
          date,
          start: minutesToTime(start),
          end: minutesToTime(end),
          durationMinutes,
          type: parsed.type ?? "flexible",
          category: parsed.category || undefined,
          priority: parsed.priority ?? "medium",
          status: "planned",
          canMove: parsed.canMove ?? true,
          canSplit: parsed.canSplit ?? false,
          deadline: parsed.deadline || undefined,
        };

        suggestions.push({
          id: createScheduleId("suggestion"),
          date,
          start: event.start ?? minutesToTime(start),
          end: event.end ?? minutesToTime(end),
          durationMinutes,
          title: event.title,
          reason: buildSuggestionReason({
            preferred: preferredBonus > 0,
            lowLoad: load < 4 * 60,
            deadline: Boolean(parsed.deadline && date <= parsed.deadline),
          }),
          event,
          score,
        } as ScheduleSuggestion & { score: number });
      }
    }
  }

  return suggestions
    .sort((left, right) => {
      const leftScore = "score" in left ? Number(left.score) : 0;
      const rightScore = "score" in right ? Number(right.score) : 0;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      if (left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }
      return left.start.localeCompare(right.start);
    })
    .slice(0, 3)
    .map(({ id, date, start, end, durationMinutes, title, reason, event }) => ({
      id,
      date,
      start,
      end,
      durationMinutes,
      title,
      reason,
      event,
    }));
}

export function buildSpontaneousSchedulePreview(
  payload: SchedulePayload,
  input: ScheduleSpontaneousInput,
  baseDate = payload.selectedDate
): ScheduleSpontaneousPreview {
  const normalizedPayload = normalizeSchedulePayload(payload);
  const inferred = inferSpontaneousInput(input, baseDate);
  const spontaneousEvent = createSpontaneousEvent(inferred);
  const changes: SchedulePreviewChange[] = [
    {
      id: createScheduleId("change"),
      kind: "add",
      event: spontaneousEvent,
      reason: "Добавить внезапное событие в расписание.",
    },
  ];

  const conflictStart = eventStartMinute(spontaneousEvent);
  const conflictEnd = eventEndMinute(spontaneousEvent);
  const scopeDays = inferred.scope === "today" ? 1 : 3;
  const payloadWithSpontaneous: SchedulePayload = {
    ...normalizedPayload,
    events: [...normalizedPayload.events, spontaneousEvent],
  };

  for (const event of normalizedPayload.events) {
    if (
      event.id === spontaneousEvent.id ||
      event.status !== "planned" ||
      normalizeScheduleDate(event.date, baseDate) !== spontaneousEvent.date ||
      !rangesOverlap(eventStartMinute(event), eventEndMinute(event), conflictStart, conflictEnd)
    ) {
      continue;
    }

    if (event.type === "fixed" || event.canMove === false) {
      changes.push({
        id: createScheduleId("change"),
        kind: "note",
        title: event.title,
        reason: "Фиксированное дело пересекается, но не будет перенесено автоматически.",
      });
      continue;
    }

    const suggestions = buildScheduleSuggestions(
      {
        ...payloadWithSpontaneous,
        events: payloadWithSpontaneous.events.filter((candidate) => candidate.id !== event.id),
      },
      {
        title: event.title,
        description: event.description,
        durationMinutes: getEventDurationMinutes(event),
        dateRangeStart: addScheduleDays(spontaneousEvent.date ?? baseDate, 0),
        dateRangeEnd: addScheduleDays(spontaneousEvent.date ?? baseDate, scopeDays),
        preferredTime: event.start,
        deadline: event.deadline,
        priority: event.priority,
        category: event.category,
        canMove: event.canMove,
        canSplit: event.canSplit,
        type: event.type,
      },
      spontaneousEvent.date ?? baseDate
    );

    const suggestion = suggestions[0];
    if (!suggestion) {
      changes.push({
        id: createScheduleId("change"),
        kind: "note",
        title: event.title,
        reason: "Свободное окно для переноса не найдено, лучше изменить вручную.",
      });
      continue;
    }

    changes.push({
      id: createScheduleId("change"),
      kind: "move",
      eventId: event.id,
      title: event.title,
      fromDate: event.date,
      fromStart: event.start,
      fromEnd: event.end,
      toDate: suggestion.date,
      toStart: suggestion.start,
      toEnd: suggestion.end,
      reason: suggestion.reason,
    });
  }

  return {
    changes,
    message:
      changes.length === 1
        ? "Будет добавлено внезапное действие. Переносов не требуется."
        : "Будет изменено:",
  };
}

export function applyScheduleSpontaneousPreview(
  payload: SchedulePayload,
  preview: ScheduleSpontaneousPreview
): SchedulePayload {
  let nextPayload = normalizeSchedulePayload(payload);

  for (const change of preview.changes) {
    if (change.kind === "add") {
      nextPayload = {
        ...nextPayload,
        events: normalizeScheduleEvents([...nextPayload.events, change.event]),
      };
      continue;
    }

    if (change.kind === "move") {
      nextPayload = {
        ...nextPayload,
        events: normalizeScheduleEvents(
          nextPayload.events.map((event) =>
            event.id === change.eventId
              ? {
                  ...event,
                  date: change.toDate,
                  start: change.toStart,
                  end: change.toEnd,
                  durationMinutes:
                    timeToMinutes(change.toEnd) - timeToMinutes(change.toStart),
                }
              : event
          )
        ),
      };
    }
  }

  return nextPayload;
}

export function formatScheduleMinutes(minutes: number): string {
  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  if (hours === 0) {
    return `${rest}м`;
  }
  if (rest === 0) {
    return `${hours}ч`;
  }
  return `${hours}ч ${rest}м`;
}

export function formatScheduleDateShort(date: string): string {
  const parsed = parseLocalDate(date);
  if (!parsed) {
    return date;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
  }).format(parsed);
}

export function formatScheduleTimeRange(event: ScheduleEvent): string {
  if (event.start && event.end) {
    return `${event.start}-${event.end}`;
  }
  if (event.start) {
    return `${event.start} · ${formatScheduleMinutes(getEventDurationMinutes(event))}`;
  }
  return formatScheduleMinutes(getEventDurationMinutes(event));
}

export function getEventDurationMinutes(event: ScheduleEvent): number {
  return normalizeScheduleDuration(
    event.durationMinutes,
    getDurationFromRange(event.start, event.end) ?? 60
  );
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }
  return Math.min(24 * 60, Math.max(0, hours * 60 + minutes));
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.min(24 * 60 - 1, Math.max(0, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${`${hours}`.padStart(2, "0")}:${`${rest}`.padStart(2, "0")}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeScheduleViewMode(value: unknown): ScheduleViewMode {
  return value === "week" || value === "list" ? value : "day";
}

function normalizeScheduleEventType(value: unknown): ScheduleEventType {
  return value === "fixed" ||
    value === "habit" ||
    value === "spontaneous" ||
    value === "flexible"
    ? value
    : "flexible";
}

function normalizeSchedulePriority(value: unknown): SchedulePriority {
  return value === "low" || value === "high" ? value : "medium";
}

function normalizeScheduleStatus(value: unknown): ScheduleStatus {
  return value === "done" || value === "skipped" ? value : "planned";
}

function normalizeScheduleEnergyMode(value: unknown): ScheduleEnergyMode {
  return value === "low" || value === "high" ? value : "normal";
}

function normalizeScheduleDayMode(value: unknown): ScheduleDayMode {
  return value === "shifted" || value === "recovery" ? value : "normal";
}

function normalizeScheduleRescheduleMode(value: unknown): ScheduleRescheduleMode {
  return value === "soft" || value === "strict" ? value : "normal";
}

function normalizeScheduleDate(value: unknown, fallback = todayLocalDate()): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return fallback;
}

function normalizeOptionalDate(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined;
}

function normalizeOptionalTime(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return undefined;
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizeScheduleDuration(value: unknown, fallback = 60): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  const minutes = Number.isFinite(numericValue) ? numericValue : fallback;
  return Math.min(MAX_EVENT_DURATION, Math.max(MIN_EVENT_DURATION, Math.round(minutes)));
}

function normalizeScheduleEventTitle(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || "Дело").slice(0, 120);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeOptionalPositiveInteger(value: unknown): number | undefined {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }
  return Math.round(numericValue);
}

function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDurationFromRange(start: unknown, end: unknown): number | undefined {
  const normalizedStart = normalizeOptionalTime(start);
  const normalizedEnd = normalizeOptionalTime(end);
  if (!normalizedStart || !normalizedEnd) {
    return undefined;
  }

  const duration = timeToMinutes(normalizedEnd) - timeToMinutes(normalizedStart);
  return duration > 0 ? duration : undefined;
}

function eventStartMinute(event: ScheduleEvent): number {
  return event.start ? timeToMinutes(event.start) : timeToMinutes(DEFAULT_DAY_START);
}

function eventEndMinute(event: ScheduleEvent): number {
  if (event.end) {
    return timeToMinutes(event.end);
  }
  return eventStartMinute(event) + getEventDurationMinutes(event);
}

function compareScheduleEvents(left: ScheduleEvent, right: ScheduleEvent): number {
  const leftDate = left.date ?? "";
  const rightDate = right.date ?? "";
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }
  const leftStart = left.start ?? "99:99";
  const rightStart = right.start ?? "99:99";
  if (leftStart !== rightStart) {
    return leftStart.localeCompare(rightStart);
  }
  return left.title.localeCompare(right.title, "ru-RU");
}

function buildFreeWindowsForDate(payload: SchedulePayload, date: string): FreeWindow[] {
  const settings = normalizeScheduleSettings(payload.settings);
  let dayStart = timeToMinutes(settings.defaultDayStart ?? DEFAULT_DAY_START);
  let dayEnd = timeToMinutes(settings.defaultDayEnd ?? DEFAULT_DAY_END);
  const buffer = settings.preserveFreeTime ? settings.bufferMinutes ?? DEFAULT_BUFFER_MINUTES : 0;

  if (settings.energyMode === "low" || settings.dayMode === "recovery") {
    dayStart += 60;
    dayEnd -= 30;
  }
  if (settings.dayMode === "shifted") {
    dayStart += 90;
    dayEnd = Math.min(24 * 60 - 1, dayEnd + 60);
  }

  const busy = payload.events
    .filter((event) => {
      if (event.status === "skipped") {
        return false;
      }
      return normalizeScheduleDate(event.date, payload.selectedDate) === date;
    })
    .map((event) => ({
      start: Math.max(dayStart, eventStartMinute(event) - buffer),
      end: Math.min(dayEnd, eventEndMinute(event) + buffer),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);

  const windows: FreeWindow[] = [];
  let cursor = dayStart;
  for (const range of busy) {
    if (range.start > cursor) {
      windows.push({ date, start: cursor, end: range.start });
    }
    cursor = Math.max(cursor, range.end);
  }

  if (cursor < dayEnd) {
    windows.push({ date, start: cursor, end: dayEnd });
  }

  return windows.filter((window) => window.end - window.start >= MIN_EVENT_DURATION);
}

function inferPlanningInput(
  input: SchedulePlanningInput,
  baseDate: string
): Required<Pick<SchedulePlanningInput, "text">> & SchedulePlanningInput {
  const text = input.text?.trim() ?? "";
  const durationMinutes =
    input.durationMinutes && input.durationMinutes > 0
      ? input.durationMinutes
      : parseDurationFromText(text);
  return {
    ...input,
    text,
    title: normalizeAssistantTitle(input.title || text),
    durationMinutes,
    date: input.date || inferDateFromText(text, baseDate),
    deadline: input.deadline || inferDeadlineFromText(text, baseDate),
    preferredTime: input.preferredTime || inferPreferredTimeFromText(text),
    priority: input.priority ?? inferPriorityFromText(text),
    type: input.type ?? (text.toLocaleLowerCase().includes("привыч") ? "habit" : "flexible"),
  };
}

function inferSpontaneousInput(
  input: ScheduleSpontaneousInput,
  baseDate: string
): ScheduleSpontaneousInput & {
  title: string;
  date: string;
  start: string;
  durationMinutes: number;
  priority: SchedulePriority;
  scope: "today" | "near";
} {
  const text = input.text?.trim() ?? "";
  const inferredRange = parseTimeRangeFromText(text);
  const start =
    normalizeOptionalTime(input.start) ??
    inferredRange?.start ??
    normalizeOptionalTime(inferPreferredTimeFromText(text)) ??
    "18:00";
  const durationMinutes = normalizeScheduleDuration(
    input.durationMinutes,
    input.end
      ? getDurationFromRange(start, input.end)
      : inferredRange
      ? timeToMinutes(inferredRange.end) - timeToMinutes(inferredRange.start)
      : parseDurationFromText(text) || 60
  );

  return {
    ...input,
    title: normalizeAssistantTitle(text || "Спонтанное действие"),
    date: input.date || inferDateFromText(text, baseDate) || baseDate,
    start,
    durationMinutes,
    priority: input.priority ?? "high",
    scope: input.scope ?? "near",
  };
}

function createSpontaneousEvent(
  input: ReturnType<typeof inferSpontaneousInput>
): ScheduleEvent {
  const startMinutes = timeToMinutes(input.start);
  return {
    id: createScheduleId("event"),
    title: input.title || "Спонтанное действие",
    description: input.text || undefined,
    date: input.date,
    start: input.start,
    end: minutesToTime(startMinutes + input.durationMinutes),
    durationMinutes: input.durationMinutes,
    type: "spontaneous",
    priority: input.priority,
    status: "planned",
    canMove: Boolean(input.canCancel),
    canSplit: false,
  };
}

function resolveSuggestionDateRange(
  payload: SchedulePayload,
  input: SchedulePlanningInput,
  baseDate: string
): string[] {
  const startDate = normalizeScheduleDate(
    input.dateRangeStart || input.date || baseDate,
    payload.selectedDate
  );
  const endDate = normalizeScheduleDate(
    input.dateRangeEnd || input.deadline || addScheduleDays(startDate, 6),
    startDate
  );

  const dates: string[] = [];
  let cursor = startDate;
  for (let index = 0; index < 14; index += 1) {
    dates.push(cursor);
    if (cursor >= endDate) {
      break;
    }
    cursor = addScheduleDays(cursor, 1);
  }

  return dates;
}

function getCandidateStarts(
  window: FreeWindow,
  durationMinutes: number,
  preferredRange: { start: number; end: number } | null
): number[] {
  const starts = new Set<number>();
  const roundedStart = Math.ceil(window.start / 15) * 15;
  starts.add(roundedStart);

  if (preferredRange) {
    starts.add(Math.max(roundedStart, Math.ceil(preferredRange.start / 15) * 15));
    starts.add(
      Math.max(
        roundedStart,
        Math.ceil((preferredRange.end - durationMinutes) / 15) * 15
      )
    );
  }

  return Array.from(starts)
    .filter((start) => start >= window.start && start + durationMinutes <= window.end)
    .sort((left, right) => left - right);
}

function preferredRangeForInput(value: string | undefined): { start: number; end: number } | null {
  if (!value) {
    return null;
  }

  const time = normalizeOptionalTime(value);
  if (time) {
    const minutes = timeToMinutes(time);
    return { start: Math.max(0, minutes - 90), end: Math.min(24 * 60, minutes + 150) };
  }

  const lower = value.toLocaleLowerCase();
  if (lower.includes("утр") || lower.includes("morning")) {
    return { start: timeToMinutes("08:00"), end: timeToMinutes("12:00") };
  }
  if (lower.includes("дн") || lower.includes("day")) {
    return { start: timeToMinutes("12:00"), end: timeToMinutes("17:00") };
  }
  if (lower.includes("веч") || lower.includes("evening")) {
    return { start: timeToMinutes("17:00"), end: timeToMinutes("22:00") };
  }

  return null;
}

function getScheduledMinutesForDate(payload: SchedulePayload, date: string): number {
  return payload.events.reduce((total, event) => {
    if (event.status === "skipped" || normalizeScheduleDate(event.date) !== date) {
      return total;
    }
    return total + getEventDurationMinutes(event);
  }, 0);
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function parseDurationFromText(text: string): number | undefined {
  const lower = text.toLocaleLowerCase();
  const hourMatch = lower.match(
    /(\d+(?:[,.]\d+)?)\s*(?:часов|часа|час|ч|hours?|h)(?=$|\s|[.,;:!?])/
  );
  if (hourMatch) {
    return Math.round(Number(hourMatch[1].replace(",", ".")) * 60);
  }

  const minuteMatch = lower.match(
    /(\d+)\s*(?:минут|минуты|мин|м|minutes?|m)(?=$|\s|[.,;:!?])/
  );
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }

  return undefined;
}

function parseTimeRangeFromText(text: string): { start: string; end: string } | null {
  const match = text.match(/([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|до|—|–)\s*([01]?\d|2[0-3]):([0-5]\d)/i);
  if (!match) {
    return null;
  }

  const start = `${match[1].padStart(2, "0")}:${match[2]}`;
  const end = `${match[3].padStart(2, "0")}:${match[4]}`;
  return timeToMinutes(end) > timeToMinutes(start) ? { start, end } : null;
}

function inferPreferredTimeFromText(text: string): string | undefined {
  const range = parseTimeRangeFromText(text);
  if (range) {
    return range.start;
  }

  const timeMatch = text.match(/([01]?\d|2[0-3]):([0-5]\d)/);
  if (timeMatch) {
    return `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  }

  const lower = text.toLocaleLowerCase();
  if (lower.includes("утр")) {
    return "09:00";
  }
  if (lower.includes("дн") || lower.includes("после обеда")) {
    return "14:00";
  }
  if (lower.includes("веч")) {
    return "18:00";
  }

  return undefined;
}

function inferDateFromText(text: string, baseDate: string): string | undefined {
  const lower = text.toLocaleLowerCase();
  if (lower.includes("сегодня")) {
    return baseDate;
  }
  if (lower.includes("завтра")) {
    return addScheduleDays(baseDate, 1);
  }
  if (lower.includes("послезавтра")) {
    return addScheduleDays(baseDate, 2);
  }

  const weekdays = [
    ["воскрес", 0],
    ["понедель", 1],
    ["вторник", 2],
    ["сред", 3],
    ["четвер", 4],
    ["пятниц", 5],
    ["суббот", 6],
  ] as const;
  const base = parseLocalDate(baseDate);
  if (!base) {
    return undefined;
  }

  for (const [fragment, targetDay] of weekdays) {
    if (!lower.includes(fragment)) {
      continue;
    }
    const currentDay = base.getDay();
    const offset = (targetDay - currentDay + 7) % 7;
    return addScheduleDays(baseDate, offset);
  }

  return undefined;
}

function inferDeadlineFromText(text: string, baseDate: string): string | undefined {
  const lower = text.toLocaleLowerCase();
  if (!lower.includes("дедлайн") && !lower.includes("до ")) {
    return undefined;
  }
  return inferDateFromText(text, baseDate);
}

function inferPriorityFromText(text: string): SchedulePriority {
  const lower = text.toLocaleLowerCase();
  if (lower.includes("сроч") || lower.includes("важн")) {
    return "high";
  }
  if (lower.includes("неваж") || lower.includes("низк")) {
    return "low";
  }
  return "medium";
}

function normalizeAssistantTitle(value: string): string {
  const cleaned = value
    .replace(/мне нужно/gi, "")
    .replace(/надо/gi, "")
    .replace(/примерно/gi, "")
    .replace(
      /\d+(?:[,.]\d+)?\s*(?:часов|часа|час|ч|минут|минуты|мин|м|hours?|minutes?|m|h)(?=$|\s|[.,;:!?])/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  return normalizeScheduleEventTitle(cleaned || value || "Новое дело");
}

function buildSuggestionReason(options: {
  preferred: boolean;
  lowLoad: boolean;
  deadline: boolean;
}): string {
  const reasons: string[] = [];
  if (options.preferred) {
    reasons.push("попадает в предпочтительное время");
  }
  if (options.lowLoad) {
    reasons.push("день не перегружен");
  }
  if (options.deadline) {
    reasons.push("успевает до дедлайна");
  }
  return reasons.length > 0 ? reasons.join(", ") : "свободное окно без пересечений";
}

function normalizeComparable(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeGoalCategoryKey(goal: ScheduleGoal): string {
  return normalizeComparable(goal.category || goal.title);
}
