export type PlannerHorizon = "week" | "two_weeks" | "month";
export type PlannerItemKind = "fixed_event" | "flexible_task" | "routine";
export type PlannerPriority = "low" | "normal" | "high" | "critical";
export type PlannerEnergy = "low" | "normal" | "high";
export type PlannerBlockStatus =
  | "planned"
  | "in_progress"
  | "done"
  | "skipped"
  | "cancelled";
export type PlannerBlockSource = "manual" | "auto" | "migrated";

export type PlannerTimeWindow = {
  start: string;
  end: string;
};

export type PlannerAvailability = Record<string, PlannerTimeWindow[]>;

export type PlannerEnergyWindow = PlannerTimeWindow & {
  energy: PlannerEnergy;
};

export type PlannerSleepRule = {
  bedtime: string;
  durationMinutes: number;
};

export type PlannerWakeDayPart = "early_morning" | "morning" | "late_morning" | "auto";
export type PlannerWakeAnchorReason = {
  code: "preferred_window" | "auto_default" | "recurring_commitment" | "plan_fit" | "fixed_conflict";
  relatedTitle?: string;
  relatedTime?: string;
  placedMinutes?: number;
  unplacedMinutes?: number;
};
export type PlannerSleepRestedness = "not_rested" | "okay" | "well_rested";
export type PlannerSleepEventKind = "sleep_change" | "check_in";
export type PlannerSleepEventState = "tentative" | "confirmed" | "completed";

export type PlannerFixedSleepSchedule = {
  mode: "fixed";
  weekdays: PlannerSleepRule;
  weekends: PlannerSleepRule;
};

export type PlannerAdaptiveSleepSchedule = {
  mode: "adaptive";
  durationRange: {
    minMinutes: number;
    maxMinutes: number;
  };
  targetDurationMinutes: number;
  wakeAnchor: {
    dayPart: PlannerWakeDayPart;
    localTime: string;
    toleranceMinutes: number;
    selectionReason?: PlannerWakeAnchorReason;
  };
  morningPreparationMinutes: number;
  recovery: {
    horizonNights: 3;
    maxNightExtensionMinutes: 60;
    maxDailyAnchorShiftMinutes: 60;
    suggestShortNap: boolean;
  };
  requiresHealthyMinimumConfirmation?: boolean;
};

export type PlannerSleepSchedule = PlannerFixedSleepSchedule | PlannerAdaptiveSleepSchedule;

export type PlannerSleepEvent = {
  wakeDate: string;
  eventKind: PlannerSleepEventKind;
  state: PlannerSleepEventState;
  actualStartAt?: string;
  projectedEndAt?: string;
  actualEndAt?: string;
  estimatedStartFromAt?: string;
  estimatedStartToAt?: string;
  restedness?: PlannerSleepRestedness;
  recoveryNight?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PlannerSleepBlock = {
  id: string;
  wakeDate: string;
  title: string;
  startAt: string;
  endAt: string;
  plannedStartAt: string;
  plannedEndAt: string;
  actualStartAt?: string;
  actualEndAt?: string;
  tentative?: boolean;
  recoveryNight?: boolean;
  fixed: true;
  locked: true;
  kind: "sleep";
};

export type PlannerProfile = {
  userId?: string;
  timezone: string;
  horizon: PlannerHorizon;
  reserveRatio: number;
  defaultBufferMinutes: number;
  availability: PlannerAvailability;
  energyWindows: PlannerEnergyWindow[];
  sleepSchedule: PlannerSleepSchedule;
  assistantSetupVersion: number;
  revision: number;
  onboardingCompleted: boolean;
};

export type PlannerRecurrence = {
  frequency: "daily" | "weekly" | "custom";
  weekdays?: number[];
  startDate?: string;
  startTime?: string;
  endTime?: string;
};

export type PlannerItem = {
  id: string;
  kind: PlannerItemKind;
  title: string;
  notes?: string;
  area?: string;
  location?: string;
  priority: PlannerPriority;
  energy: PlannerEnergy;
  estimateMinutes: number;
  earliestAt?: string;
  deadlineAt?: string;
  preferredWindows: PlannerTimeWindow[];
  avoidedWindows: PlannerTimeWindow[];
  canSplit: boolean;
  minChunkMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  recurrence?: PlannerRecurrence;
  autoPlan: boolean;
  status: "active" | "completed" | "archived";
  unplacedReason?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PlannerBlock = {
  id: string;
  itemId?: string;
  title: string;
  startAt: string;
  endAt: string;
  status: PlannerBlockStatus;
  source: PlannerBlockSource;
  fixed: boolean;
  occurrenceKey?: string;
  actualStartAt?: string;
  actualEndAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PlannerDraft = Partial<PlannerItem> & {
  title: string;
  date?: string;
  start?: string;
  end?: string;
};

export type PlannerProposalChange =
  | {
      id: string;
      kind: "update_profile";
      profile: PlannerProfile;
      reason: string;
    }
  | {
      id: string;
      kind: "upsert_sleep_event";
      event: PlannerSleepEvent;
      reason: string;
    }
  | {
      id: string;
      kind: "add_item";
      item: PlannerItem;
      reason: string;
    }
  | {
      id: string;
      kind: "add_block";
      block: PlannerBlock;
      reason: string;
    }
  | {
      id: string;
      kind: "move_block";
      blockId: string;
      title: string;
      fromStartAt: string;
      fromEndAt: string;
      toStartAt: string;
      toEndAt: string;
      reason: string;
    }
  | {
      id: string;
      kind: "remove_block";
      blockId: string;
      title: string;
      reason: string;
    }
  | {
      id: string;
      kind: "update_item";
      item: PlannerItem;
      reason: string;
    };

export type PlannerConflict = {
  id: string;
  kind: "fixed_overlap" | "active_overlap" | "stale";
  title: string;
  message: string;
  blockIds: string[];
};

export type PlannerUnplaced = {
  itemId: string;
  title: string;
  remainingMinutes: number;
  reason: string;
};

export type PlannerProposal = {
  id?: string;
  baseRevision: number;
  trigger:
    | "autoplan"
    | "quick_add"
    | "plans_changed"
    | "day_refresh"
    | "assistant_setup"
    | "assistant_update"
    | "sleep_changed";
  normalizedDraft?: PlannerDraft;
  normalizedDrafts?: PlannerDraft[];
  changes: PlannerProposalChange[];
  conflicts: PlannerConflict[];
  unplaced: PlannerUnplaced[];
  horizonStart: string;
  horizonEnd: string;
  recoveryAdvice?: {
    deficitMinutes: number;
    recoveryNights: number;
    nap?: {
      startAt: string;
      endAt: string;
      reason: string;
    };
  };
  wakeAnchorDecision?: {
    preference: "auto";
    wakeTime: string;
    bedtime: string;
    targetDurationMinutes: number;
    durationRange: {
      minMinutes: number;
      maxMinutes: number;
    };
    reason: PlannerWakeAnchorReason;
    candidatesEvaluated: number;
  };
  expiresAt?: string;
};

export type PlannerBootstrap = {
  profile: PlannerProfile;
  items: PlannerItem[];
  blocks: PlannerBlock[];
  sleepEvents: PlannerSleepEvent[];
  sleepBlocks: PlannerSleepBlock[];
  latestChangeSetId?: string;
  durationSuggestions?: Array<{
    itemId: string;
    title: string;
    currentMinutes: number;
    suggestedMinutes: number;
  }>;
  sleepDurationSuggestion?: {
    currentMinutes: number;
    suggestedMinutes: number;
    sampleCount: number;
    reason: string;
  };
  sleepHealthNotice?: string;
};

export type PlannerProposalInput = {
  command?: string;
  draft?: PlannerDraft;
  drafts?: PlannerDraft[];
  profilePatch?: Partial<PlannerProfile>;
  sleepEvent?: PlannerSleepEvent;
  trigger?: PlannerProposal["trigger"];
  rebuildFuture?: boolean;
};

export type PlannerSleepCheckInInput = {
  wakeDate: string;
  restedness: PlannerSleepRestedness;
  expectedRevision: number;
  actualStartAt?: string;
  actualEndAt?: string;
};

export type PlannerSleepCheckInResult = {
  event: PlannerSleepEvent;
  revision: number;
  suggestion?: PlannerBootstrap["sleepDurationSuggestion"];
};

export type PlannerAssistantAmbiguity = {
  index: number;
  field: "title" | "kind" | "duration" | "date" | "time";
  message: string;
};

export type PlannerAssistantParseResult = {
  drafts: PlannerDraft[];
  ambiguities: PlannerAssistantAmbiguity[];
};

export type PlannerSleepParseResult = {
  mode?: "fixed" | "adaptive";
  bedtime?: string;
  durationMinutes?: number;
  durationRange?: {
    minMinutes: number;
    maxMinutes: number;
  };
  wakeDayPart?: PlannerWakeDayPart;
  changeKind?: "later_unknown" | "bedtime_now" | "wake_now";
  estimatedBedtimeRange?: PlannerTimeWindow;
  ambiguities: string[];
};

export const DEFAULT_PLANNER_AVAILABILITY: PlannerAvailability = {
  "1": [{ start: "08:00", end: "22:00" }],
  "2": [{ start: "08:00", end: "22:00" }],
  "3": [{ start: "08:00", end: "22:00" }],
  "4": [{ start: "08:00", end: "22:00" }],
  "5": [{ start: "08:00", end: "22:00" }],
  "6": [{ start: "09:00", end: "22:00" }],
  "7": [{ start: "09:00", end: "22:00" }],
};

export const DEFAULT_PLANNER_ENERGY_WINDOWS: PlannerEnergyWindow[] = [
  { start: "08:00", end: "12:00", energy: "high" },
  { start: "12:00", end: "18:00", energy: "normal" },
  { start: "18:00", end: "22:00", energy: "low" },
];

export const DEFAULT_PLANNER_SLEEP_SCHEDULE: PlannerFixedSleepSchedule = {
  mode: "fixed",
  weekdays: { bedtime: "23:00", durationMinutes: 8 * 60 },
  weekends: { bedtime: "23:00", durationMinutes: 8 * 60 },
};

export function createDefaultPlannerProfile(timezone = "Europe/Minsk"): PlannerProfile {
  return {
    timezone,
    horizon: "week",
    reserveRatio: 0.2,
    defaultBufferMinutes: 15,
    availability: DEFAULT_PLANNER_AVAILABILITY,
    energyWindows: DEFAULT_PLANNER_ENERGY_WINDOWS,
    sleepSchedule: DEFAULT_PLANNER_SLEEP_SCHEDULE,
    assistantSetupVersion: 0,
    revision: 0,
    onboardingCompleted: false,
  };
}
