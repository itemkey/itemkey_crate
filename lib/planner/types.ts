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

export type PlannerProfile = {
  userId?: string;
  timezone: string;
  horizon: PlannerHorizon;
  reserveRatio: number;
  defaultBufferMinutes: number;
  availability: PlannerAvailability;
  energyWindows: PlannerEnergyWindow[];
  revision: number;
  onboardingCompleted: boolean;
};

export type PlannerRecurrence = {
  frequency: "daily" | "weekly" | "custom";
  weekdays?: number[];
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
  trigger: "autoplan" | "quick_add" | "plans_changed" | "day_refresh";
  normalizedDraft?: PlannerDraft;
  changes: PlannerProposalChange[];
  conflicts: PlannerConflict[];
  unplaced: PlannerUnplaced[];
  horizonStart: string;
  horizonEnd: string;
  expiresAt?: string;
};

export type PlannerBootstrap = {
  profile: PlannerProfile;
  items: PlannerItem[];
  blocks: PlannerBlock[];
  latestChangeSetId?: string;
  durationSuggestions?: Array<{
    itemId: string;
    title: string;
    currentMinutes: number;
    suggestedMinutes: number;
  }>;
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

export function createDefaultPlannerProfile(timezone = "Europe/Minsk"): PlannerProfile {
  return {
    timezone,
    horizon: "week",
    reserveRatio: 0.2,
    defaultBufferMinutes: 15,
    availability: DEFAULT_PLANNER_AVAILABILITY,
    energyWindows: DEFAULT_PLANNER_ENERGY_WINDOWS,
    revision: 0,
    onboardingCompleted: false,
  };
}
