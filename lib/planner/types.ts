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
export type PlannerBlockRole = "work" | "uncertainty_reserve" | "calibration" | "protected_free";

export type PlannerEstimateMode = "exact" | "approximate" | "range" | "unknown";
export type PlannerEstimateSource = "user" | "calibration" | "statistics";
export type PlannerOutcomeMode = "deliverable" | "time_budget";
export type PlannerCommitmentLevel = "must_not_skip" | "required" | "desired" | "if_time";
export type PlannerUncertainDateMode = "exact" | "preferred" | "range" | "any";
export type PlannerUncertainTimeMode = "exact" | "preferred" | "range" | "any";
export type PlannerTravelEstimateMode = "exact" | "approximate" | "range";
export type PlannerMissedOccurrencePolicy = "ask" | "carry_remaining" | "cancel_occurrence" | "reestimate_total";

export type PlannerDurationEstimate = {
  mode: PlannerEstimateMode;
  minMinutes: number;
  likelyMinutes: number;
  maxMinutes: number;
  tolerancePercent?: 15 | 30 | 50;
  calibrationMinutes?: number;
  source: PlannerEstimateSource;
};

export type PlannerUncertaintyPolicy = {
  outcomeMode: PlannerOutcomeMode;
  duration: PlannerDurationEstimate;
  date: {
    mode: PlannerUncertainDateMode;
    exactDate?: string;
    preferredDate?: string;
    earliestDate?: string;
    latestDate?: string;
  };
  time: {
    mode: PlannerUncertainTimeMode;
    exactStart?: string;
    preferredStart?: string;
    earliestStart?: string;
    latestEnd?: string;
  };
  recurrence: {
    mode: "exact_days" | "count_range";
    period: "week" | "month";
    minOccurrences: number;
    likelyOccurrences: number;
    maxOccurrences: number;
    allowedWeekdays: number[];
  };
  deadline?: {
    mode: "none" | "preferred_range" | "hard";
    preferredFromAt?: string;
    latestAt?: string;
  };
  travel?: {
    mode: PlannerTravelEstimateMode;
    minMinutes: number;
    likelyMinutes: number;
    maxMinutes: number;
    tolerancePercent?: 15 | 30 | 50;
    punctuality: "strict" | "normal" | "flexible";
  };
  /** What to do after a skipped occurrence. Old items default to asking every time. */
  missedOccurrencePolicy?: PlannerMissedOccurrencePolicy;
  /** Explicit permission for the planner to reduce scope while resolving a conflict. */
  reduction?:
    | { mode: "forbidden" }
    | { mode: "to_minimum"; minimumMinutes: number };
};

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
  code: "preferred_window" | "auto_default" | "sleep_history" | "recurring_commitment" | "plan_fit" | "fixed_conflict";
  relatedTitle?: string;
  relatedTime?: string;
  placedMinutes?: number;
  unplacedMinutes?: number;
};
export type PlannerSleepRestedness = "not_rested" | "okay" | "well_rested";
export type PlannerSleepinessLevel = 0 | 1 | 2 | 3 | 4;
export type PlannerSleepEventKind = "sleep_change" | "check_in" | "planned_adjustment";
export type PlannerSleepEventState = "planned" | "tentative" | "confirmed" | "completed";
export type PlannerPlanningFocus = "sleep" | "work";

export type PlannerRemainderDistribution =
  | { mode: "asap" }
  | { mode: "date"; date: string }
  | { mode: "spread_week" };

export type PlannerRemainderTransferInput = {
  /** Current block for a new transfer, or the original block retained by an existing queue entry. */
  blockId: string;
  /** Present when taking an already deferred remainder back out of the queue. */
  deferredRemainderId?: string;
  amount:
    | { mode: "percent"; percent: 25 | 50 | 75 | 100 }
    | { mode: "minutes"; minutes: number };
  distribution: PlannerRemainderDistribution;
};

export type PlannerDeferredRemainder = {
  id: string;
  itemId?: string;
  sourceBlockId?: string;
  occurrenceKey?: string;
  title: string;
  totalMinutes: number;
  pendingMinutes: number;
  scheduledMinutes: number;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  resolution?: "scheduled" | "cancelled";
};

export type PlannerProposalImpact = {
  kind: "remainder_transfer" | "general";
  itemId?: string;
  title?: string;
  sourceRemainingMinutes?: number;
  requestedMinutes?: number;
  scheduledMinutes?: number;
  queuedMinutes?: number;
  queueExpiresAt?: string;
  placements: Array<{
    itemId?: string;
    title: string;
    startAt: string;
    endAt: string;
  }>;
  moves: Array<{
    itemId?: string;
    title: string;
    fromStartAt: string;
    fromEndAt: string;
    toStartAt: string;
    toEndAt: string;
  }>;
  reductions: Array<{
    itemId?: string;
    title: string;
    minutes: number;
    reason: "soft_reserve" | "optional_work";
  }>;
  sleepChanges: Array<{
    wakeDate: string;
    fromMinutes: number;
    toMinutes: number;
  }>;
};

export type PlannerSleepDurationPreference =
  | {
      mode: "range";
      minMinutes: number;
      maxMinutes: number;
    }
  | {
      mode: "exact";
      optionsMinutes: number[];
    };

export type PlannerSleepClockPreference = {
  mode: "exact" | "approximate" | "range" | "any";
  /** Exact or usual local clock time. */
  time?: string;
  /** Soft distance around an approximate time. */
  toleranceMinutes?: number;
  /** Hard local-clock bounds. A pair may cross midnight for bedtime. */
  notBefore?: string;
  notAfter?: string;
  source?: "user" | "history" | "neutral_default" | "commitment";
};

export type PlannerPlanningPolicy = {
  focus: PlannerPlanningFocus;
  minimumNightMinutes: 360;
  maxNightDeficitMinutes: 120;
  maxRollingSevenDayDeficitMinutes: 180;
  recoveryHorizonNights: 3;
  deadlineChainGapMinutes: 0 | 5 | 15;
  /** First instant covered by the current plan. Time before it never becomes setup debt. */
  effectiveFromAt?: string;
};

export type PlannerFixedSleepSchedule = {
  mode: "fixed";
  weekdays: PlannerSleepRule;
  weekends: PlannerSleepRule;
};

export type PlannerAdaptiveSleepSchedule = {
  mode: "adaptive";
  durationPreference: PlannerSleepDurationPreference;
  /** Kept in normalized output for compatibility with older clients. */
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
  bedtimePreference: PlannerSleepClockPreference;
  wakePreference: PlannerSleepClockPreference;
  windDownMinutes: number;
  weekendOverride?: {
    bedtimePreference: PlannerSleepClockPreference;
    wakePreference: PlannerSleepClockPreference;
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
  sleepinessLevel?: PlannerSleepinessLevel;
  feedbackText?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  plannedDurationMinutes?: number;
  selectionReason?: "preference" | "workload" | "hard_deadline" | "recovery" | "manual" | "activation_transition";
  borrowedMinutes?: number;
  recoveryNight?: boolean;
  transitionNight?: boolean;
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
  selectedDurationMinutes: number;
  preferredDurationMatched: boolean;
  borrowedMinutes: number;
  selectionReason: "preference" | "workload" | "hard_deadline" | "recovery" | "manual" | "activation_transition";
  tentative?: boolean;
  recoveryNight?: boolean;
  transitionNight?: boolean;
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
  /** One-off availability for a calendar date. It overrides the regular weekday window. */
  availabilityOverrides: Record<string, PlannerTimeWindow[]>;
  energyWindows: PlannerEnergyWindow[];
  sleepSchedule: PlannerSleepSchedule;
  planningPolicy: PlannerPlanningPolicy;
  assistantSetupVersion: number;
  revision: number;
  onboardingCompleted: boolean;
};

export type PlannerRecurrence = {
  frequency: "once" | "daily" | "weekly" | "custom";
  weekdays?: number[];
  /** Whether estimateMinutes applies to every selected day or once to the whole calendar-week cycle. */
  durationMode?: "per_occurrence" | "per_cycle";
  /** Spare-time items yield to required work but keep a small protected minimum when capacity exists. */
  schedulingMode?: "required" | "spare_time";
  /** Lower bound for a spare-time item; estimateMinutes remains its upper bound. */
  minimumMinutes?: number;
  startDate?: string;
  startTime?: string;
  endTime?: string;
};

export type PlannerDeadlineType = "none" | "target" | "hard";
export type PlannerEstimateConfidence = "high" | "normal" | "low";
export type PlannerTargetFinishMode = "auto" | "manual";
export type PlannerDeadlineChainMode = "inherit" | "off" | "auto" | "pinned";

export type PlannerDeadlinePolicy = {
  chainMode: PlannerDeadlineChainMode;
  gapMinutes?: 0 | 5 | 15;
  nextItemId?: string;
};

export type PlannerMilestone = {
  id: string;
  title: string;
  estimateMinutes: number;
  targetAt: string;
  order: number;
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
  /** Unified scheduling uncertainty. estimateMinutes mirrors duration.likelyMinutes for compatibility. */
  uncertaintyPolicy: PlannerUncertaintyPolicy;
  commitmentLevel: PlannerCommitmentLevel;
  /** Lower values are planned first inside the same commitment group. */
  planningRank: number;
  earliestAt?: string;
  deadlineAt?: string;
  deadlineType: PlannerDeadlineType;
  targetFinishAt?: string;
  targetFinishMode: PlannerTargetFinishMode;
  estimateConfidence: PlannerEstimateConfidence;
  deadlinePolicy: PlannerDeadlinePolicy;
  milestones: PlannerMilestone[];
  allowedWindows: PlannerTimeWindow[];
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

export type PlannerOccurrenceOverride = Partial<Pick<PlannerItem,
  | "title"
  | "notes"
  | "location"
  | "priority"
  | "commitmentLevel"
  | "uncertaintyPolicy"
  | "canSplit"
  | "minChunkMinutes"
  | "bufferBeforeMinutes"
  | "bufferAfterMinutes"
>>;

export type PlannerTentativeReason = {
  reserveBlockId: string;
  reserveItemId?: string;
  reserveTitle: string;
  latestAt: string;
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
  role?: PlannerBlockRole;
  /** Structured certainty shown by the constructor for fixed-event endings. */
  endEstimate?: PlannerBlockEndEstimate;
  /** Soft blocks reserve likely-to-maximum capacity without making the interval unavailable. */
  soft?: boolean;
  /** A lower-priority block currently using another item's soft reserve. */
  tentative?: boolean;
  /** Exact higher-priority reserve which can displace this block. Computed for bootstrap responses. */
  tentativeReason?: PlannerTentativeReason;
  occurrenceKey?: string;
  /** Rules changed only for this occurrence; the recurring item remains unchanged. */
  occurrenceOverride?: PlannerOccurrenceOverride;
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
  endEstimate?: PlannerBlockEndEstimate;
};

export type PlannerBlockEndEstimate = {
  mode: "exact" | "approximate" | "range" | "unknown";
  earliestAt?: string;
  likelyAt?: string;
  latestAt?: string;
  toleranceMinutes?: number;
};

export type PlannerOperationScope = "occurrence" | "future" | "item";

export type PlannerOperationTarget = {
  itemId: string;
  blockId?: string;
  occurrenceKey?: string;
};

export type PlannerPlacement =
  | { mode: "date"; date: string }
  | { mode: "exact"; date: string; start: string }
  | { mode: "before" | "after"; anchorBlockId: string; gapMinutes?: number }
  | { mode: "first_free"; date?: string };

export type PlannerConstructorOperation =
  | { kind: "add_item"; draft: PlannerDraft }
  | { kind: "schedule_item"; target: PlannerOperationTarget; scope?: Exclude<PlannerOperationScope, "item"> }
  | { kind: "edit_item"; draft: PlannerDraft; scope?: PlannerOperationScope; blockId?: string; target?: PlannerOperationTarget }
  | { kind: "bulk_update_items"; drafts: PlannerDraft[]; archiveItemIds?: string[] }
  | { kind: "move_item"; blockId: string; scope: PlannerOperationScope; placement: PlannerPlacement; target?: PlannerOperationTarget }
  | { kind: "cancel_item"; blockId?: string; itemId?: string; scope: PlannerOperationScope; target?: PlannerOperationTarget }
  | {
      kind: "replace_item";
      blockId: string;
      scope: PlannerOperationScope;
      target?: PlannerOperationTarget;
      replacement: PlannerDraft;
      duration:
        | { mode: "same" }
        | { mode: "minutes"; minutes: number }
        | { mode: "until_next" }
        | { mode: "until"; date: string; time: string };
    }
  | { kind: "change_block_time"; blockId: string; scope?: PlannerOperationScope; startAt: string; endAt: string; target?: PlannerOperationTarget }
  | { kind: "change_item_duration"; itemId: string; blockId?: string; scope?: PlannerOperationScope; duration: PlannerDurationEstimate; reduction?: PlannerUncertaintyPolicy["reduction"]; target?: PlannerOperationTarget }
  | { kind: "protect_interval"; date: string; start: string; end: string; title?: string }
  | { kind: "occupy_interval"; draft: PlannerDraft }
  | { kind: "set_sleep_boundary"; boundary: "bedtime" | "wake"; date: string; time: string }
  | { kind: "set_day_bounds"; date: string; start: string; end: string }
  | {
      kind: "rebuild_remaining";
      fromAt: string;
      decisions: Array<{ itemId: string; disposition: "required" | "desired" | "if_time" | "cancel" }>;
      bedtime?: { date: string; time: string };
    };

export type PlannerDecisionOption = {
  id: string;
  kind: "move" | "shorten" | "cancel" | "queue" | "edit";
  title: string;
  description: string;
};

export type PlannerDecisionSelection = {
  groupId: string;
  optionId: string;
};

export type PlannerDecisionGroup = {
  id: string;
  title: string;
  message: string;
  blocking: boolean;
  options: PlannerDecisionOption[];
  selectedOptionId?: string;
};

export type PlannerHumanSummary = {
  additions: string[];
  cancellations: string[];
  moves: string[];
  reductions: string[];
  sleepChanges: string[];
  freedIntervals: string[];
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
      kind: "update_block_status";
      blockId: string;
      title: string;
      status: PlannerBlockStatus;
      actualStartAt?: string;
      actualEndAt?: string;
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
      kind: "update_block";
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
    }
  | {
      id: string;
      kind: "add_deferred_remainder" | "update_deferred_remainder";
      remainder: PlannerDeferredRemainder;
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
  requestedMinutes?: number;
  placedMinutes?: number;
  remainingMinutes: number;
  reason: string;
  reasonCode?: "reserve" | "transition" | "sleep" | "day_bounds" | "fixed_event" | "window";
  blocking?: boolean;
};

export type PlannerCalibrationProgress = {
  itemId: string;
  targetMinutes: number;
  completedMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
  complete: boolean;
};

export type PlannerItemPlanningState = {
  itemId: string;
  requestedMinutes: number;
  plannedMinutes: number;
  completedMinutes: number;
  remainingMinutes: number;
  state: "planned" | "partial" | "queued" | "complete";
  reason?: string;
  reasonCode?: PlannerUnplaced["reasonCode"];
};

export type PlannerDeadlineRisk = "on_track" | "tight" | "at_risk" | "impossible";

export type PlannerDeadlineAnalysis = {
  itemId: string;
  title: string;
  deadlineType: Exclude<PlannerDeadlineType, "none">;
  deadlineAt: string;
  targetFinishAt: string;
  remainingMinutes: number;
  availableMinutes: number;
  slackMinutes: number;
  latestSafeStartAt?: string;
  risk: PlannerDeadlineRisk;
  likelyScenario?: {
    remainingMinutes: number;
    slackMinutes: number;
    risk: PlannerDeadlineRisk;
  };
  maximumScenario?: {
    remainingMinutes: number;
    slackMinutes: number;
    risk: PlannerDeadlineRisk;
  };
  nextItemId?: string;
  nextItemTitle?: string;
};

export type PlannerSleepPlanSummary = {
  wakeDate: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  preferredDurationMatched: boolean;
  borrowedMinutes: number;
  reason: PlannerSleepEvent["selectionReason"];
  transitionNight?: boolean;
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
    | "sleep_changed"
    | "constructor";
  operation?: PlannerConstructorOperation;
  normalizedDraft?: PlannerDraft;
  normalizedDrafts?: PlannerDraft[];
  removedItemIds?: string[];
  blockExtension?: PlannerProposalInput["blockExtension"];
  missedOccurrence?: PlannerProposalInput["missedOccurrence"];
  remainderTransfer?: PlannerRemainderTransferInput & {
    sourceRemainingMinutes: number;
    requestedMinutes: number;
  };
  impact?: PlannerProposalImpact;
  changes: PlannerProposalChange[];
  conflicts: PlannerConflict[];
  decisionGroups?: PlannerDecisionGroup[];
  decisions?: PlannerDecisionSelection[];
  humanSummary?: PlannerHumanSummary;
  unplaced: PlannerUnplaced[];
  effectiveFocus?: PlannerPlanningFocus;
  deadlineAnalysis?: PlannerDeadlineAnalysis[];
  sleepPlan?: PlannerSleepPlanSummary[];
  effectiveFromAt?: string;
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
  deferredRemainders: PlannerDeferredRemainder[];
  calibrationProgress: PlannerCalibrationProgress[];
  planningStates: PlannerItemPlanningState[];
  latestChangeSetId?: string;
  durationSuggestions?: Array<{
    itemId: string;
    title: string;
    currentMinutes: number;
    suggestedMinutes: number;
    suggestedRange?: {
      minMinutes: number;
      likelyMinutes: number;
      maxMinutes: number;
      sampleCount: number;
    };
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
  operation?: PlannerConstructorOperation;
  decisions?: PlannerDecisionSelection[];
  draft?: PlannerDraft;
  drafts?: PlannerDraft[];
  /** Existing active items removed in the unified all-items editor. */
  removedItemIds?: string[];
  profilePatch?: Partial<PlannerProfile>;
  sleepEvent?: PlannerSleepEvent;
  trigger?: PlannerProposal["trigger"];
  rebuildFuture?: boolean;
  rebuildFromAt?: string;
  planningFocusOverride?: PlannerPlanningFocus;
  blockExtension?: {
    blockId: string;
    minutes: number;
  };
  remainderTransfer?: PlannerRemainderTransferInput;
  missedOccurrence?: {
    blockId: string;
    disposition: Exclude<PlannerMissedOccurrencePolicy, "ask">;
    rememberPolicy?: boolean;
    revisedRemainingMinutes?: number;
  };
};

export type PlannerSleepCheckInInput = {
  wakeDate: string;
  /** Compatibility summary derived from sleepinessLevel by the server. */
  restedness?: PlannerSleepRestedness;
  sleepinessLevel: PlannerSleepinessLevel;
  feedbackText?: string;
  expectedRevision: number;
  actualStartAt?: string;
  actualEndAt?: string;
};

export type PlannerSleepCheckInResult = {
  event: PlannerSleepEvent;
  revision: number;
  suggestion?: PlannerBootstrap["sleepDurationSuggestion"];
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

export const DEFAULT_PLANNER_PLANNING_POLICY: PlannerPlanningPolicy = {
  focus: "sleep",
  minimumNightMinutes: 360,
  maxNightDeficitMinutes: 120,
  maxRollingSevenDayDeficitMinutes: 180,
  recoveryHorizonNights: 3,
  deadlineChainGapMinutes: 5,
};

export function createDefaultPlannerProfile(timezone = "Europe/Minsk"): PlannerProfile {
  return {
    timezone,
    horizon: "week",
    reserveRatio: 0.2,
    defaultBufferMinutes: 15,
    availability: DEFAULT_PLANNER_AVAILABILITY,
    availabilityOverrides: {},
    energyWindows: DEFAULT_PLANNER_ENERGY_WINDOWS,
    sleepSchedule: DEFAULT_PLANNER_SLEEP_SCHEDULE,
    planningPolicy: DEFAULT_PLANNER_PLANNING_POLICY,
    assistantSetupVersion: 0,
    revision: 0,
    onboardingCompleted: false,
  };
}
