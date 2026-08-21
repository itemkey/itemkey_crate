import type { Locale } from "../i18n.ts";
import { formatDateInTimeZone, formatTimeInTimeZone, zonedPlannerDateTimeToUtc } from "./time.ts";
import type {
  PlannerDeadlineType,
  PlannerDraft,
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
export type PlannerCommitmentOccurrenceMode = "once" | "recurring";
export type PlannerCommitmentTimeMode = "fixed" | "flexible";

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
  allowedStartTime?: string;
  allowedEndTime?: string;
  priority: PlannerPriority;
  deadlineType: PlannerDeadlineType;
  deadlineDate?: string;
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

export function plannerCommitmentDuration(startTime: string, endTime: string): number {
  const [startHours = 0, startMinutes = 0] = startTime.split(":").map(Number);
  const [endHours = 0, endMinutes = 0] = endTime.split(":").map(Number);
  const start = startHours * 60 + startMinutes;
  const end = endHours * 60 + endMinutes;
  return Math.max(5, (end - start + 24 * 60) % (24 * 60) || 24 * 60);
}

export function normalizeStructuredCommitment(value: Partial<PlannerStructuredCommitment> & {
  id: string;
  title: string;
}): PlannerStructuredCommitment {
  const legacyFixed = value.timeMode === undefined;
  return {
    id: value.id,
    title: value.title,
    category: value.category ?? "other",
    occurrenceMode: value.occurrenceMode ?? (value.weekdays?.length ? "recurring" : "once"),
    date: value.date,
    weekdays: Array.isArray(value.weekdays) ? value.weekdays : [],
    timeMode: value.timeMode ?? "fixed",
    startTime: value.startTime ?? "",
    endTime: value.endTime ?? "",
    durationMinutes: Math.max(5, Math.round(value.durationMinutes
      ?? (legacyFixed && value.startTime && value.endTime
        ? plannerCommitmentDuration(value.startTime, value.endTime)
        : 60))),
    allowedStartTime: value.allowedStartTime,
    allowedEndTime: value.allowedEndTime,
    priority: value.priority ?? (legacyFixed ? "high" : "normal"),
    deadlineType: value.deadlineType ?? "none",
    deadlineDate: value.deadlineDate,
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
      ? `Дорога: ${commitment.travel.originLabel || commitment.travel.originAddress || "точка отправления"} → ${commitment.travel.destinationLabel || commitment.travel.destinationAddress || "место дела"}; ${plannerTravelModeLabel(commitment.travel.mode, locale)}; ${routeMinutes} мин в одну сторону; ${roundTrip ? "туда и обратно" : "только туда"}${bufferMinutes ? `; ${bufferMinutes} мин запаса перед выходом` : ""}.`
      : `Travel: ${commitment.travel.originLabel || commitment.travel.originAddress || "origin"} → ${commitment.travel.destinationLabel || commitment.travel.destinationAddress || "destination"}; ${plannerTravelModeLabel(commitment.travel.mode, locale)}; ${routeMinutes} min each way; ${roundTrip ? "round trip" : "outbound only"}${bufferMinutes ? `; ${bufferMinutes} min outbound buffer` : ""}.`
    : "";
  const fixed = commitment.timeMode === "fixed";
  const recurring = commitment.occurrenceMode === "recurring";
  const deadlineAt = !fixed && commitment.deadlineType !== "none" && commitment.deadlineDate
    ? zonedPlannerDateTimeToUtc(commitment.deadlineDate, commitment.deadlineTime || "23:59", timezone)
    : undefined;

  return {
    title: commitment.title.trim(),
    kind: fixed ? "fixed_event" : recurring ? "routine" : "flexible_task",
    area: plannerCommitmentCategoryLabel(commitment.category, locale),
    location: commitment.travel.destinationAddress?.trim() || undefined,
    notes: [routeNote, commitment.notes?.trim()].filter(Boolean).join("\n") || undefined,
    priority: commitment.priority,
    energy: "normal",
    estimateMinutes: fixed
      ? plannerCommitmentDuration(commitment.startTime, commitment.endTime)
      : commitment.durationMinutes,
    estimateConfidence: "high",
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
    bufferBeforeMinutes: Math.min(240, routeMinutes + bufferMinutes),
    bufferAfterMinutes: Math.min(240, roundTrip ? routeMinutes : 0),
    recurrence: recurrenceForCommitment(commitment, weekdays),
    autoPlan: !fixed,
    status: "active",
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
  const deadline = draft.deadlineAt ? new Date(draft.deadlineAt) : undefined;
  return normalizeStructuredCommitment({
    id,
    title: draft.title,
    category: "other",
    occurrenceMode: recurring ? "recurring" : "once",
    date: recurrence?.frequency === "once" ? recurrence.startDate : fixed ? draft.date : undefined,
    weekdays: recurrence?.weekdays ?? (recurrence?.frequency === "daily" ? [1, 2, 3, 4, 5, 6, 7] : []),
    timeMode: fixed ? "fixed" : "flexible",
    startTime: draft.start ?? recurrence?.startTime ?? "",
    endTime: draft.end ?? recurrence?.endTime ?? "",
    durationMinutes: draft.estimateMinutes ?? 60,
    allowedStartTime: draft.allowedWindows?.[0]?.start,
    allowedEndTime: draft.allowedWindows?.[0]?.end,
    priority: draft.priority ?? "normal",
    deadlineType: draft.deadlineType ?? (draft.deadlineAt ? "target" : "none"),
    deadlineDate: deadline ? formatDateInTimeZone(deadline, timezone) : undefined,
    deadlineTime: deadline ? formatTimeInTimeZone(deadline, timezone) : "23:59",
    canSplit: Boolean(draft.canSplit),
    minChunkMinutes: draft.minChunkMinutes ?? 25,
    travel: {
      enabled: false,
      mode: "transit",
      direction: "one_way",
      durationMinutes: 30,
      bufferMinutes: 10,
    },
    notes: draft.notes,
  });
}
