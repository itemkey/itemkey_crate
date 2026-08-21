import type { Locale } from "@/lib/i18n";
import type { PlannerDraft } from "@/lib/planner/types";

export type PlannerCommitmentCategory =
  | "work"
  | "education"
  | "health"
  | "sport"
  | "personal"
  | "other";

export type PlannerTravelMode = "walk" | "transit" | "car";

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
  destinationAddress?: string;
  mode: PlannerTravelMode;
  durationMinutes: number;
  bufferMinutes: number;
  distanceKm?: number;
  estimatedByNavigator?: boolean;
};

export type PlannerStructuredCommitment = {
  id: string;
  title: string;
  category: PlannerCommitmentCategory;
  weekdays: number[];
  startTime: string;
  endTime: string;
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

export function commitmentToPlannerDraft(
  commitment: PlannerStructuredCommitment,
  locale: Locale
): PlannerDraft {
  const weekdays = [...new Set(commitment.weekdays)]
    .filter((day) => day >= 1 && day <= 7)
    .sort((left, right) => left - right);
  const routeMinutes = commitment.travel.enabled
    ? Math.max(0, Math.round(commitment.travel.durationMinutes))
    : 0;
  const bufferMinutes = commitment.travel.enabled
    ? Math.max(0, Math.round(commitment.travel.bufferMinutes))
    : 0;
  const routeNote = commitment.travel.enabled
    ? locale === "ru"
      ? `Дорога: ${commitment.travel.originLabel || commitment.travel.originAddress || "точка отправления"} → ${commitment.travel.destinationAddress || "место дела"}; ${plannerTravelModeLabel(commitment.travel.mode, locale)}; ${routeMinutes} мин${bufferMinutes ? ` + ${bufferMinutes} мин запаса` : ""}.`
      : `Travel: ${commitment.travel.originLabel || commitment.travel.originAddress || "origin"} → ${commitment.travel.destinationAddress || "destination"}; ${plannerTravelModeLabel(commitment.travel.mode, locale)}; ${routeMinutes} min${bufferMinutes ? ` + ${bufferMinutes} min buffer` : ""}.`
    : "";

  return {
    title: commitment.title.trim(),
    kind: "fixed_event",
    area: plannerCommitmentCategoryLabel(commitment.category, locale),
    location: commitment.travel.destinationAddress?.trim() || undefined,
    notes: [routeNote, commitment.notes?.trim()].filter(Boolean).join("\n") || undefined,
    priority: "high",
    energy: "normal",
    estimateMinutes: plannerCommitmentDuration(commitment.startTime, commitment.endTime),
    estimateConfidence: "high",
    deadlineType: "none",
    targetFinishMode: "auto",
    deadlinePolicy: { chainMode: "inherit" },
    milestones: [],
    start: commitment.startTime,
    end: commitment.endTime,
    canSplit: false,
    minChunkMinutes: 5,
    preferredWindows: [],
    avoidedWindows: [],
    bufferBeforeMinutes: Math.min(240, routeMinutes + bufferMinutes),
    bufferAfterMinutes: 0,
    recurrence: {
      frequency: weekdays.length === 7 ? "daily" : weekdays.length === 1 ? "weekly" : "custom",
      weekdays,
      startTime: commitment.startTime,
      endTime: commitment.endTime,
    },
    autoPlan: false,
    status: "active",
  };
}
