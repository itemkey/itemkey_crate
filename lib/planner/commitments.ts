import type { Locale } from "../i18n.ts";
import { formatDateInTimeZone, formatTimeInTimeZone, zonedPlannerDateTimeToUtc } from "./time.ts";
import type {
  PlannerDeadlineType,
  PlannerDraft,
  PlannerCommitmentLevel,
  PlannerEstimateMode,
  PlannerOutcomeMode,
  PlannerPriority,
  PlannerRecurrence,
} from "./types.ts";

export type PlannerCommitmentCategory =
  | "work"
  | "education"
  | "health"
  | "sport"
  | "personal"
  | "other";

export type PlannerTravelMode = "walk" | "transit" | "car";
export type PlannerTravelDirection = "one_way" | "round_trip";
export type PlannerCommitmentOccurrenceMode = "once" | "recurring" | "spare_time";
export type PlannerCommitmentTimeMode = "fixed" | "flexible";
export type PlannerCommitmentDurationMode = "per_occurrence" | "per_cycle";
export type PlannerCommitmentDurationType = PlannerEstimateMode;

export type PlannerSavedPlace = {
  id: string;
  label: string;
  address: string;
  kind: "home" | "saved";
};

export type PlannerCommitmentTravel = {
  enabled: boolean;
  originLabel?: string;
  originAddress?: string;
  originPlaceId?: string;
  destinationLabel?: string;
  destinationAddress?: string;
  destinationPlaceId?: string;
  mode: PlannerTravelMode;
  direction: PlannerTravelDirection;
  /** Duration of one trip. */
  durationMinutes: number;
  estimateMode: "exact" | "approximate" | "range";
  minDurationMinutes: number;
  maxDurationMinutes: number;
  tolerancePercent: 15 | 30 | 50;
  punctuality: "strict" | "normal" | "flexible";
  /** Applied only before the outbound trip. */
  bufferMinutes: number;
  distanceKm?: number;
  estimatedByNavigator?: boolean;
};

export type PlannerStructuredCommitment = {
  id: string;
  title: string;
  category: PlannerCommitmentCategory;
  occurrenceMode: PlannerCommitmentOccurrenceMode;
  date?: string;
  weekdays: number[];
  timeMode: PlannerCommitmentTimeMode;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  outcomeMode: PlannerOutcomeMode;
  /** For recurring flexible items: repeat this duration each day, or complete it once across the selected week. */
  durationMode: PlannerCommitmentDurationMode;
  durationType: PlannerCommitmentDurationType;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  tolerancePercent: 15 | 30 | 50;
  calibrationMinutes: number;
  recurrenceMode: "exact_days" | "count_range";
  recurrencePeriod: "week" | "month";
  minOccurrences: number;
  likelyOccurrences: number;
  maxOccurrences: number;
  dateMode: "exact" | "preferred" | "range" | "any";
  preferredDate?: string;
  earliestDate?: string;
  latestDate?: string;
  flexibleTimeMode: "preferred" | "range" | "any";
  preferredStartTime?: string;
  allowedStartTime?: string;
  allowedEndTime?: string;
  priority: PlannerPriority;
  commitmentLevel: PlannerCommitmentLevel;
  planningRank: number;
  deadlineType: PlannerDeadlineType;
  deadlineDate?: string;
  deadlineEarliestDate?: string;
  deadlineTime?: string;
  canSplit: boolean;
  minChunkMinutes: number;
  travel: PlannerCommitmentTravel;
  notes?: string;
};

export type PlannerTravelEstimateInput = {
  origin: string;
  destination: string;
  mode: PlannerTravelMode;
};

export type PlannerTravelEstimateResult = {
  minutes: number;
  distanceKm: number;
  originLabel: string;
  destinationLabel: string;
  provider: "OpenStreetMap";
};

const CATEGORY_LABELS: Record<Locale, Record<PlannerCommitmentCategory, string>> = {
  ru: {
    work: "Работа",
    education: "Учёба",
    health: "Здоровье",
    sport: "Спорт",
    personal: "Личное",
    other: "Другое",
  },
  en: {
    work: "Work",
    education: "Education",
    health: "Health",
    sport: "Sport",
    personal: "Personal",
    other: "Other",
  },
};

const TRAVEL_LABELS: Record<Locale, Record<PlannerTravelMode, string>> = {
  ru: { walk: "пешком", transit: "общественный транспорт", car: "машина" },
  en: { walk: "walking", transit: "public transit", car: "car" },
};

export function plannerCommitmentCategoryLabel(category: PlannerCommitmentCategory, locale: Locale): string {
  return CATEGORY_LABELS[locale][category];
}

export function plannerTravelModeLabel(mode: PlannerTravelMode, locale: Locale): string {
  return TRAVEL_LABELS[locale][mode];
}

export function plannerDurationLabel(totalMinutes: number, locale: Locale): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} ${locale === "ru" ? "мин" : "min"}`;
  return `${hours} ${locale === "ru" ? "ч" : "h"}${remainder ? ` ${remainder} ${locale === "ru" ? "мин" : "min"}` : ""}`;
}

export function plannerCommitmentDuration(startTime: string, endTime: string): number {
  const [startHours = 0, startMinutes = 0] = startTime.split(":").map(Number);
  const [endHours = 0, endMinutes = 0] = endTime.split(":").map(Number);
  const start = startHours * 60 + startMinutes;
  const end = endHours * 60 + endMinutes;
  return Math.max(5, (end - start + 24 * 60) % (24 * 60) || 24 * 60);
}

export function normalizeStructuredCommitment(value: Partial<Omit<PlannerStructuredCommitment, "travel">> & {
  id: string;
  title: string;
  travel?: Partial<PlannerCommitmentTravel>;
}): PlannerStructuredCommitment {
  const legacyFixed = value.timeMode === undefined;
  const rawDurationType = value.durationType as string | undefined;
  const durationType: PlannerCommitmentDurationType = rawDurationType === "approximate" || rawDurationType === "range" || rawDurationType === "unknown"
    ? rawDurationType
    : "exact";
  const likelyDuration = Math.max(5, Math.round(value.durationMinutes
    ?? (rawDurationType === "range" ? value.maxDurationMinutes : undefined)
    ?? 60));
  const tolerancePercent = value.tolerancePercent === 15 || value.tolerancePercent === 50 ? value.tolerancePercent : 30;
  const calculatedMinimum = Math.max(5, Math.round(likelyDuration * (1 - tolerancePercent / 100)));
  const calculatedMaximum = Math.max(likelyDuration, Math.round(likelyDuration * (1 + tolerancePercent / 100)));
  const minimumDuration = durationType === "exact" || durationType === "unknown"
    ? likelyDuration
    : Math.min(likelyDuration, Math.max(5, Math.round(value.minDurationMinutes ?? calculatedMinimum)));
  const maximumDuration = durationType === "exact" || durationType === "unknown"
    ? likelyDuration
    : Math.max(likelyDuration, Math.round(value.maxDurationMinutes ?? calculatedMaximum));
  const minOccurrences = Math.max(0, Math.min(31, Math.round(value.minOccurrences ?? 2)));
  const likelyOccurrences = Math.max(minOccurrences, Math.min(31, Math.round(value.likelyOccurrences ?? Math.max(3, minOccurrences))));
  const maxOccurrences = Math.max(likelyOccurrences, Math.min(31, Math.round(value.maxOccurrences ?? Math.max(4, likelyOccurrences))));
  return {
    id: value.id,
    title: value.title,
    category: value.category ?? "other",
    occurrenceMode: value.occurrenceMode === "spare_time"
      ? "spare_time"
      : value.occurrenceMode ?? (value.weekdays?.length ? "recurring" : "once"),
    date: value.date,
    weekdays: Array.isArray(value.weekdays) ? value.weekdays : [],
    timeMode: value.timeMode ?? "fixed",
    startTime: value.startTime ?? "",
    endTime: value.endTime ?? "",
    durationMinutes: legacyFixed && value.startTime && value.endTime
      ? plannerCommitmentDuration(value.startTime, value.endTime)
      : likelyDuration,
    outcomeMode: value.outcomeMode === "deliverable" || value.durationMode === "per_cycle" ? "deliverable" : "time_budget",
    durationMode: value.outcomeMode === "deliverable" || value.durationMode === "per_cycle" ? "per_cycle" : "per_occurrence",
    durationType,
    minDurationMinutes: minimumDuration,
    maxDurationMinutes: maximumDuration,
    tolerancePercent,
    calibrationMinutes: Math.max(5, Math.min(1440, Math.round(value.calibrationMinutes ?? 30))),
    recurrenceMode: value.recurrenceMode === "count_range" ? "count_range" : "exact_days",
    recurrencePeriod: value.recurrencePeriod === "month" ? "month" : "week",
    minOccurrences,
    likelyOccurrences,
    maxOccurrences,
    dateMode: value.dateMode === "preferred" || value.dateMode === "range" || value.dateMode === "any"
      ? value.dateMode
      : "exact",
    preferredDate: value.preferredDate,
    earliestDate: value.earliestDate,
    latestDate: value.latestDate,
    flexibleTimeMode: value.flexibleTimeMode === "preferred" || value.flexibleTimeMode === "range"
      ? value.flexibleTimeMode
      : "any",
    preferredStartTime: value.preferredStartTime,
    allowedStartTime: value.allowedStartTime,
    allowedEndTime: value.allowedEndTime,
    priority: value.priority ?? (legacyFixed ? "high" : "normal"),
    commitmentLevel: value.commitmentLevel === "must_not_skip" || value.commitmentLevel === "desired" || value.commitmentLevel === "if_time"
      ? value.commitmentLevel
      : value.occurrenceMode === "spare_time" ? "if_time" : "required",
    planningRank: Math.max(0, Math.min(1_000_000, Math.round(value.planningRank ?? 0))),
    deadlineType: value.deadlineType ?? "none",
    deadlineDate: value.deadlineDate,
    deadlineEarliestDate: value.deadlineEarliestDate,
    deadlineTime: value.deadlineTime ?? "23:59",
    canSplit: Boolean(value.canSplit),
    minChunkMinutes: Math.max(5, Math.round(value.minChunkMinutes ?? 25)),
    travel: {
      enabled: Boolean(value.travel?.enabled),
      originLabel: value.travel?.originLabel,
      originAddress: value.travel?.originAddress,
      originPlaceId: value.travel?.originPlaceId,
      destinationLabel: value.travel?.destinationLabel,
      destinationAddress: value.travel?.destinationAddress,
      destinationPlaceId: value.travel?.destinationPlaceId,
      mode: value.travel?.mode ?? "transit",
      direction: value.travel?.direction ?? "one_way",
      durationMinutes: Math.max(1, Math.round(value.travel?.durationMinutes ?? 30)),
      estimateMode: value.travel?.estimateMode === "approximate" || value.travel?.estimateMode === "range"
        ? value.travel.estimateMode
        : "exact",
      minDurationMinutes: Math.max(1, Math.round(value.travel?.minDurationMinutes ?? value.travel?.durationMinutes ?? 30)),
      maxDurationMinutes: Math.max(1, Math.round(value.travel?.maxDurationMinutes ?? value.travel?.durationMinutes ?? 30)),
      tolerancePercent: value.travel?.tolerancePercent === 15 || value.travel?.tolerancePercent === 50 ? value.travel.tolerancePercent : 30,
      punctuality: value.travel?.punctuality === "strict" || value.travel?.punctuality === "flexible" ? value.travel.punctuality : "normal",
      bufferMinutes: Math.max(0, Math.round(value.travel?.bufferMinutes ?? 10)),
      distanceKm: value.travel?.distanceKm,
      estimatedByNavigator: value.travel?.estimatedByNavigator,
    },
    notes: value.notes,
  };
}

function recurrenceForCommitment(
  commitment: PlannerStructuredCommitment,
  weekdays: number[]
): PlannerRecurrence | undefined {
  if (commitment.occurrenceMode === "once") {
    return commitment.timeMode === "flexible" && commitment.date
      ? { frequency: "once", startDate: commitment.date }
      : undefined;
  }
  const recurrence: PlannerRecurrence = {
    frequency: weekdays.length === 7 ? "daily" : weekdays.length === 1 ? "weekly" : "custom",
    weekdays,
  };
  if (commitment.timeMode === "fixed") {
    recurrence.startTime = commitment.startTime;
    recurrence.endTime = commitment.endTime;
  } else {
    recurrence.durationMode = commitment.outcomeMode === "deliverable" ? "per_cycle" : "per_occurrence";
    if (commitment.occurrenceMode === "spare_time") {
      recurrence.schedulingMode = "spare_time";
      recurrence.minimumMinutes = commitment.durationType === "range" || commitment.durationType === "approximate"
        ? Math.min(commitment.minDurationMinutes, commitment.maxDurationMinutes)
        : commitment.durationMinutes;
    }
  }
  return recurrence;
}

export function commitmentToPlannerDraft(
  rawCommitment: PlannerStructuredCommitment,
  locale: Locale,
  timezone = "Europe/Minsk"
): PlannerDraft {
  const commitment = normalizeStructuredCommitment(rawCommitment);
  const weekdays = [...new Set(commitment.weekdays)]
    .filter((day) => day >= 1 && day <= 7)
    .sort((left, right) => left - right);
  const routeMinutes = commitment.travel.enabled ? commitment.travel.durationMinutes : 0;
  const bufferMinutes = commitment.travel.enabled ? commitment.travel.bufferMinutes : 0;
  const roundTrip = commitment.travel.enabled && commitment.travel.direction === "round_trip";
  const routeNote = commitment.travel.enabled
    ? locale === "ru"
      ? `Дорога: ${commitment.travel.originLabel || commitment.travel.originAddress || "точка отправления"} → ${commitment.travel.destinationLabel || commitment.travel.destinationAddress || "место дела"}; ${plannerTravelModeLabel(commitment.travel.mode, locale)}; ${plannerDurationLabel(routeMinutes, locale)} в одну сторону; ${roundTrip ? "туда и обратно" : "только туда"}${bufferMinutes ? `; ${plannerDurationLabel(bufferMinutes, locale)} запаса перед выходом` : ""}.`
      : `Travel: ${commitment.travel.originLabel || commitment.travel.originAddress || "origin"} → ${commitment.travel.destinationLabel || commitment.travel.destinationAddress || "destination"}; ${plannerTravelModeLabel(commitment.travel.mode, locale)}; ${plannerDurationLabel(routeMinutes, locale)} each way; ${roundTrip ? "round trip" : "outbound only"}${bufferMinutes ? `; ${plannerDurationLabel(bufferMinutes, locale)} outbound buffer` : ""}.`
    : "";
  const fixed = commitment.timeMode === "fixed";
  const recurring = commitment.occurrenceMode !== "once";
  const deadlineAt = !fixed && commitment.deadlineType !== "none" && commitment.deadlineDate
    ? zonedPlannerDateTimeToUtc(commitment.deadlineDate, commitment.deadlineTime || "23:59", timezone)
    : undefined;

  const likelyMinutes = fixed
    ? plannerCommitmentDuration(commitment.startTime, commitment.endTime)
    : commitment.durationType === "unknown"
      ? commitment.calibrationMinutes
      : commitment.durationMinutes;
  const minimumMinutes = fixed || commitment.durationType === "exact" || commitment.durationType === "unknown"
    ? likelyMinutes
    : commitment.minDurationMinutes;
  const maximumMinutes = fixed || commitment.durationType === "exact" || commitment.durationType === "unknown"
    ? likelyMinutes
    : commitment.maxDurationMinutes;
  return {
    id: commitment.id,
    title: commitment.title.trim(),
    kind: fixed ? "fixed_event" : recurring ? "routine" : "flexible_task",
    area: plannerCommitmentCategoryLabel(commitment.category, locale),
    location: commitment.travel.destinationAddress?.trim() || undefined,
    notes: [routeNote, commitment.notes?.trim()].filter(Boolean).join("\n") || undefined,
    priority: commitment.priority,
    energy: "normal",
    estimateMinutes: likelyMinutes,
    uncertaintyPolicy: {
      outcomeMode: commitment.outcomeMode,
      duration: {
        mode: fixed ? "exact" : commitment.durationType,
        minMinutes: minimumMinutes,
        likelyMinutes,
        maxMinutes: maximumMinutes,
        tolerancePercent: commitment.durationType === "approximate" ? commitment.tolerancePercent : undefined,
        calibrationMinutes: commitment.durationType === "unknown" ? commitment.calibrationMinutes : undefined,
        source: "user",
      },
      date: {
        mode: fixed ? "exact" : commitment.dateMode,
        exactDate: commitment.date,
        preferredDate: commitment.preferredDate,
        earliestDate: commitment.earliestDate,
        latestDate: commitment.latestDate,
      },
      time: {
        mode: fixed ? "exact" : commitment.flexibleTimeMode,
        exactStart: fixed ? commitment.startTime : undefined,
        preferredStart: commitment.preferredStartTime,
        earliestStart: commitment.allowedStartTime,
        latestEnd: commitment.allowedEndTime,
      },
      recurrence: {
        mode: commitment.recurrenceMode,
        period: commitment.recurrencePeriod,
        minOccurrences: commitment.minOccurrences,
        likelyOccurrences: commitment.likelyOccurrences,
        maxOccurrences: commitment.maxOccurrences,
        allowedWeekdays: weekdays,
      },
      deadline: commitment.deadlineType === "none" ? { mode: "none" } : {
        mode: commitment.deadlineType === "hard" ? "hard" : "preferred_range",
        preferredFromAt: commitment.deadlineType === "target" && commitment.deadlineEarliestDate
          ? zonedPlannerDateTimeToUtc(commitment.deadlineEarliestDate, "00:00", timezone)
          : undefined,
        latestAt: deadlineAt,
      },
      travel: commitment.travel.enabled ? {
        mode: commitment.travel.estimateMode,
        minMinutes: commitment.travel.minDurationMinutes,
        likelyMinutes: commitment.travel.durationMinutes,
        maxMinutes: commitment.travel.maxDurationMinutes,
        tolerancePercent: commitment.travel.estimateMode === "approximate" ? commitment.travel.tolerancePercent : undefined,
        punctuality: commitment.travel.punctuality,
      } : undefined,
    },
    commitmentLevel: commitment.deadlineType === "hard" ? "must_not_skip" : commitment.commitmentLevel,
    planningRank: commitment.planningRank,
    estimateConfidence: commitment.durationType === "exact" ? "high" : commitment.durationType === "approximate" ? "normal" : "low",
    deadlineAt,
    deadlineType: deadlineAt ? commitment.deadlineType : "none",
    targetFinishMode: "auto",
    deadlinePolicy: { chainMode: "inherit" },
    milestones: [],
    date: fixed && !recurring ? commitment.date : undefined,
    start: fixed ? commitment.startTime : undefined,
    end: fixed ? commitment.endTime : undefined,
    canSplit: !fixed && commitment.canSplit,
    minChunkMinutes: commitment.minChunkMinutes,
    allowedWindows: !fixed && commitment.allowedStartTime && commitment.allowedEndTime
      ? [{ start: commitment.allowedStartTime, end: commitment.allowedEndTime }]
      : [],
    preferredWindows: [],
    avoidedWindows: [],
    bufferBeforeMinutes: Math.min(1440, routeMinutes + bufferMinutes),
    bufferAfterMinutes: Math.min(1440, roundTrip ? routeMinutes : 0),
    recurrence: recurrenceForCommitment(commitment, weekdays),
    autoPlan: !fixed,
    status: "active",
  };
}

function categoryFromPlannerArea(area: string | undefined): PlannerCommitmentCategory {
  const normalized = area?.trim().toLocaleLowerCase() ?? "";
  if (normalized === "работа" || normalized === "work") return "work";
  if (normalized === "учёба" || normalized === "education") return "education";
  if (normalized === "здоровье" || normalized === "health") return "health";
  if (normalized === "спорт" || normalized === "sport") return "sport";
  if (normalized === "личное" || normalized === "personal") return "personal";
  return "other";
}

function parseStoredTravelNote(notes: string | undefined): {
  origin?: string;
  destination?: string;
  mode?: PlannerTravelMode;
  direction?: PlannerTravelDirection;
  notes?: string;
} {
  if (!notes) return {};
  const lines = notes.split("\n");
  const route = lines[0]?.match(/^(?:Дорога|Travel):\s*(.*?)\s*→\s*(.*?);\s*(.*?);/i);
  if (!route) return { notes };
  const modeText = route[3].toLocaleLowerCase();
  return {
    origin: route[1]?.trim(),
    destination: route[2]?.trim(),
    mode: modeText.includes("пеш") || modeText.includes("walk")
      ? "walk"
      : modeText.includes("маш") || modeText.includes("car")
        ? "car"
        : "transit",
    direction: /туда и обратно|round trip/i.test(lines[0]) ? "round_trip" : "one_way",
    notes: lines.slice(1).join("\n").trim() || undefined,
  };
}

export function plannerDraftToCommitment(
  draft: PlannerDraft,
  timezone: string,
  id: string
): PlannerStructuredCommitment {
  const fixed = draft.kind === "fixed_event";
  const recurrence = draft.recurrence;
  const recurring = Boolean(recurrence && recurrence.frequency !== "once");
  const spareTime = recurring && recurrence?.schedulingMode === "spare_time";
  const uncertainty = draft.uncertaintyPolicy;
  const deadline = draft.deadlineAt ? new Date(draft.deadlineAt) : undefined;
  const storedTravel = parseStoredTravelNote(draft.notes);
  const travelEnabled = Boolean(uncertainty?.travel)
    || (draft.bufferBeforeMinutes ?? 0) > 0
    || (draft.bufferAfterMinutes ?? 0) > 0;
  const bufferedTravelMinutes = (draft.bufferAfterMinutes ?? 0) > 0
    ? draft.bufferAfterMinutes!
    : (draft.bufferBeforeMinutes ?? 0) > 0
      ? draft.bufferBeforeMinutes!
      : 30;
  const travelMinutes = Math.max(1, Math.round(uncertainty?.travel?.likelyMinutes ?? bufferedTravelMinutes));
  return normalizeStructuredCommitment({
    id,
    title: draft.title,
    category: categoryFromPlannerArea(draft.area),
    occurrenceMode: spareTime ? "spare_time" : recurring ? "recurring" : "once",
    date: recurrence?.frequency === "once" ? recurrence.startDate : fixed ? draft.date : undefined,
    weekdays: recurrence?.weekdays ?? (recurrence?.frequency === "daily" ? [1, 2, 3, 4, 5, 6, 7] : []),
    timeMode: fixed ? "fixed" : "flexible",
    startTime: draft.start ?? recurrence?.startTime ?? "",
    endTime: draft.end ?? recurrence?.endTime ?? "",
    durationMinutes: uncertainty?.duration.likelyMinutes ?? draft.estimateMinutes ?? 60,
    outcomeMode: uncertainty?.outcomeMode ?? (recurrence?.durationMode === "per_cycle" ? "deliverable" : "time_budget"),
    durationMode: uncertainty?.outcomeMode === "deliverable" || recurrence?.durationMode === "per_cycle" ? "per_cycle" : "per_occurrence",
    durationType: uncertainty?.duration.mode ?? (spareTime && recurrence?.minimumMinutes !== undefined
      && recurrence.minimumMinutes < (draft.estimateMinutes ?? 60) ? "range" : "exact"),
    minDurationMinutes: uncertainty?.duration.minMinutes ?? recurrence?.minimumMinutes ?? draft.estimateMinutes ?? 30,
    maxDurationMinutes: uncertainty?.duration.maxMinutes ?? draft.estimateMinutes ?? 120,
    tolerancePercent: uncertainty?.duration.tolerancePercent ?? 30,
    calibrationMinutes: uncertainty?.duration.calibrationMinutes ?? 30,
    recurrenceMode: uncertainty?.recurrence.mode ?? "exact_days",
    recurrencePeriod: uncertainty?.recurrence.period ?? "week",
    minOccurrences: uncertainty?.recurrence.minOccurrences ?? 2,
    likelyOccurrences: uncertainty?.recurrence.likelyOccurrences ?? 3,
    maxOccurrences: uncertainty?.recurrence.maxOccurrences ?? 4,
    dateMode: uncertainty?.date.mode ?? (draft.date ? "exact" : "any"),
    preferredDate: uncertainty?.date.preferredDate,
    earliestDate: uncertainty?.date.earliestDate,
    latestDate: uncertainty?.date.latestDate,
    flexibleTimeMode: uncertainty?.time.mode === "preferred" || uncertainty?.time.mode === "range" ? uncertainty.time.mode : "any",
    preferredStartTime: uncertainty?.time.preferredStart,
    allowedStartTime: draft.allowedWindows?.[0]?.start,
    allowedEndTime: draft.allowedWindows?.[0]?.end,
    priority: draft.priority ?? "normal",
    commitmentLevel: draft.commitmentLevel ?? "required",
    planningRank: draft.planningRank ?? 0,
    deadlineType: draft.deadlineType ?? (draft.deadlineAt ? "target" : "none"),
    deadlineDate: deadline ? formatDateInTimeZone(deadline, timezone) : undefined,
    deadlineEarliestDate: uncertainty?.deadline?.preferredFromAt
      ? formatDateInTimeZone(new Date(uncertainty.deadline.preferredFromAt), timezone)
      : undefined,
    deadlineTime: deadline ? formatTimeInTimeZone(deadline, timezone) : "23:59",
    canSplit: Boolean(draft.canSplit),
    minChunkMinutes: draft.minChunkMinutes ?? 25,
    travel: {
      enabled: travelEnabled,
      originLabel: storedTravel.origin,
      originAddress: storedTravel.origin,
      destinationLabel: storedTravel.destination,
      destinationAddress: draft.location ?? storedTravel.destination,
      mode: storedTravel.mode ?? "transit",
      direction: (draft.bufferAfterMinutes ?? 0) > 0 ? "round_trip" : storedTravel.direction ?? "one_way",
      durationMinutes: travelMinutes,
      estimateMode: uncertainty?.travel?.mode ?? "exact",
      minDurationMinutes: uncertainty?.travel?.minMinutes ?? travelMinutes,
      maxDurationMinutes: uncertainty?.travel?.maxMinutes ?? travelMinutes,
      tolerancePercent: uncertainty?.travel?.tolerancePercent ?? 30,
      punctuality: uncertainty?.travel?.punctuality ?? "normal",
      bufferMinutes: Math.max(0, (draft.bufferBeforeMinutes ?? 0) - travelMinutes),
    },
    notes: storedTravel.notes,
  });
}
