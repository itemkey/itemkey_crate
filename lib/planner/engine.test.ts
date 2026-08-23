import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProposalChanges,
  analyzePlannerDeadlines,
  annotateTentativeBlocks,
  buildPlannerProposal,
  normalizePlannerItem,
  plannerCalibrationProgress,
  plannerCompletionSuggestion,
  plannerCompletionRangeSuggestion,
  plannerItemPlanningStates,
  resolvePlannerTargetFinish,
  suggestPlannerMilestones,
} from "./engine.ts";
import {
  availabilityFromSleepSchedule,
  buildPlannerSleepBlocks,
  buildSleepRecoveryAdvice,
  chooseAdaptiveSleepTarget,
  createAdaptiveSleepSchedule,
  createPlannerSleepEvent,
  createTentativeSleepEvent,
  deriveAdaptiveWakeAnchor,
  plannerSleepDurationSuggestion,
  plannerSleepHealthNotice,
  sleepRuleForWakeDate,
  normalizeSleepSchedule,
} from "./sleep.ts";
import { createDefaultPlannerProfile, type PlannerBlock, type PlannerItem } from "./types.ts";
import { addIsoMinutes, formatDateInTimeZone, formatTimeInTimeZone, isoDurationMinutes, plannerTimeToMinutes, zonedPlannerDateTimeToUtc } from "./time.ts";

const profile = {
  ...createDefaultPlannerProfile("Europe/Minsk"),
  onboardingCompleted: true,
  revision: 4,
};

function item(overrides: Partial<PlannerItem> = {}): PlannerItem {
  return normalizePlannerItem({
    id: "task-1",
    kind: "flexible_task",
    title: "Сделать важную работу",
    priority: "high",
    energy: "high",
    estimateMinutes: 60,
    deadlineType: "none",
    targetFinishMode: "auto",
    estimateConfidence: "normal",
    deadlinePolicy: { chainMode: "inherit" },
    milestones: [],
    allowedWindows: [],
    preferredWindows: [],
    avoidedWindows: [],
    canSplit: false,
    minChunkMinutes: 25,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    autoPlan: true,
    status: "active",
    ...overrides,
  });
}

test("constructor adds a structured fixed event without interpreting text", () => {
  const proposal = buildPlannerProposal({
    profile,
    items: [],
    blocks: [],
    now: new Date("2026-08-19T08:00:00Z"),
    operation: {
      kind: "add_item",
      draft: { title: "Встреча 18 до 20", kind: "fixed_event", date: "2026-08-20", start: "18:00", end: "20:00", estimateMinutes: 120 },
    },
  });
  const added = proposal.changes.find((change) => change.kind === "add_block");
  assert.equal(proposal.trigger, "constructor");
  assert.equal(proposal.operation?.kind, "add_item");
  assert.ok(added?.kind === "add_block");
  assert.equal(added.block.title, "Встреча 18 до 20");
  assert.equal(isoDurationMinutes(added.block.startAt, added.block.endAt), 120);
});

test("autoplan respects a fixed block and never overlaps it", () => {
  const fixed: PlannerBlock = {
    id: "fixed",
    title: "Врач",
    startAt: "2026-08-20T07:00:00.000Z",
    endAt: "2026-08-20T08:00:00.000Z",
    status: "planned",
    source: "manual",
    fixed: true,
  };
  const proposal = buildPlannerProposal({ profile, items: [item()], blocks: [fixed], now: new Date("2026-08-19T04:00:00Z") });
  const added = proposal.changes.find((change) => change.kind === "add_block");
  assert.ok(added && added.kind === "add_block");
  assert.ok(new Date(added.block.endAt) <= new Date(fixed.startAt) || new Date(added.block.startAt) >= new Date(fixed.endAt));
});

test("plans changed moves flexible work and keeps fixed work", () => {
  const flexible: PlannerBlock = {
    id: "flex",
    itemId: "task-1",
    title: "Сделать важную работу",
    startAt: "2026-08-19T15:00:00.000Z",
    endAt: "2026-08-19T16:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [item()],
    blocks: [flexible],
    now: new Date("2026-08-19T08:00:00Z"),
    trigger: "plans_changed",
    draft: { title: "Прогулка", kind: "fixed_event", date: "2026-08-19", start: "18:00", end: "20:00", estimateMinutes: 120 },
  });
  assert.equal(proposal.conflicts.length, 0);
  assert.ok(proposal.changes.some((change) => change.kind === "move_block" && change.blockId === "flex"));
  const applied = applyProposalChanges([item()], [flexible], proposal);
  const moved = applied.blocks.find((block) => block.id === "flex");
  assert.ok(moved);
  assert.notEqual(moved.startAt, flexible.startAt);
});

test("fixed overlap is reported instead of silently moved", () => {
  const fixed: PlannerBlock = {
    id: "fixed",
    title: "Встреча",
    startAt: "2026-08-19T15:00:00.000Z",
    endAt: "2026-08-19T16:00:00.000Z",
    status: "planned",
    source: "manual",
    fixed: true,
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [],
    blocks: [fixed],
    now: new Date("2026-08-19T08:00:00Z"),
    draft: { title: "Прогулка", kind: "fixed_event", date: "2026-08-19", start: "18:00", end: "20:00", estimateMinutes: 120 },
  });
  assert.equal(proposal.conflicts[0]?.kind, "fixed_overlap");
  assert.throws(() => applyProposalChanges([], [fixed], proposal));
});

test("splitting never produces a part below minimum", () => {
  const proposal = buildPlannerProposal({
    profile,
    items: [item({ estimateMinutes: 150, canSplit: true, minChunkMinutes: 45 })],
    blocks: [],
    now: new Date("2026-08-19T04:00:00Z"),
  });
  const durations = proposal.changes.flatMap((change) =>
    change.kind === "add_block"
      ? [(new Date(change.block.endAt).getTime() - new Date(change.block.startAt).getTime()) / 60_000]
      : []
  );
  assert.ok(durations.length >= 1);
  assert.ok(durations.every((duration) => duration >= 45));
  assert.equal(durations.reduce((sum, duration) => sum + duration, 0), 150);
});

test("a three-hour trial uses the largest safe 150 + 30 minute split", () => {
  const limitedProfile = {
    ...profile,
    reserveRatio: 0,
    defaultBufferMinutes: 15,
    energyWindows: [],
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
      String(index + 1),
      index === 2 ? [{ start: "08:00", end: "12:00" }] : index === 3 ? [{ start: "08:00", end: "09:00" }] : [],
    ])),
  };
  const base = item({ id: "three-hour-trial", estimateMinutes: 180, canSplit: true, minChunkMinutes: 25 });
  const trial = normalizePlannerItem({
    ...base,
    uncertaintyPolicy: {
      ...base.uncertaintyPolicy,
      duration: { mode: "unknown", minMinutes: 180, likelyMinutes: 180, maxMinutes: 180, calibrationMinutes: 180, source: "user" },
    },
  });
  const fixed: PlannerBlock = {
    id: "fixed-after-window",
    title: "Фиксированное событие",
    startAt: zonedPlannerDateTimeToUtc("2026-08-19", "11:00", limitedProfile.timezone),
    endAt: zonedPlannerDateTimeToUtc("2026-08-19", "12:00", limitedProfile.timezone),
    status: "planned",
    source: "manual",
    fixed: true,
  };
  const proposal = buildPlannerProposal({
    profile: limitedProfile,
    items: [trial],
    blocks: [fixed],
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  const durations = proposal.changes.flatMap((change) => change.kind === "add_block" && change.block.itemId === trial.id && !change.block.soft
    ? [isoDurationMinutes(change.block.startAt, change.block.endAt)]
    : []).sort((left, right) => right - left);
  assert.deepEqual(durations, [150, 30]);
  assert.equal(proposal.unplaced.some((entry) => entry.itemId === trial.id), false);
});

test("actual duration suggestion starts after three completed samples", () => {
  const blocks = [55, 60, 65].map((duration, index): PlannerBlock => ({
    id: `done-${index}`,
    itemId: "task-1",
    title: "Работа",
    startAt: `2026-08-1${index + 1}T08:00:00.000Z`,
    endAt: `2026-08-1${index + 1}T09:00:00.000Z`,
    actualStartAt: `2026-08-1${index + 1}T08:00:00.000Z`,
    actualEndAt: new Date(new Date(`2026-08-1${index + 1}T08:00:00.000Z`).getTime() + duration * 60_000).toISOString(),
    status: "done",
    source: "manual",
    fixed: false,
  }));
  assert.equal(plannerCompletionSuggestion(item({ estimateMinutes: 30 }), blocks), 60);
});

test("several displaced blocks are each moved once without double booking", () => {
  const displaced: PlannerBlock[] = [
    { id: "part-a", itemId: "task-1", title: "Работа", startAt: "2026-08-19T15:00:00.000Z", endAt: "2026-08-19T15:30:00.000Z", status: "planned", source: "auto", fixed: false },
    { id: "part-b", itemId: "task-1", title: "Работа", startAt: "2026-08-19T15:30:00.000Z", endAt: "2026-08-19T16:00:00.000Z", status: "planned", source: "auto", fixed: false },
  ];
  const proposal = buildPlannerProposal({
    profile,
    items: [item({ estimateMinutes: 60, canSplit: true })],
    blocks: displaced,
    now: new Date("2026-08-19T08:00:00Z"),
    trigger: "plans_changed",
    draft: { title: "Прогулка", kind: "fixed_event", date: "2026-08-19", start: "18:00", end: "20:00", estimateMinutes: 120 },
  });
  assert.equal(proposal.changes.filter((change) => change.kind === "move_block").length, 2);
  const applied = applyProposalChanges([item({ estimateMinutes: 60, canSplit: true })], displaced, proposal);
  const live = applied.blocks.filter((block) => !["cancelled", "skipped"].includes(block.status));
  for (let left = 0; left < live.length; left += 1) {
    for (let right = left + 1; right < live.length; right += 1) {
      assert.ok(new Date(live[left].endAt) <= new Date(live[right].startAt) || new Date(live[right].endAt) <= new Date(live[left].startAt));
    }
  }
  assert.equal(live.filter((block) => block.itemId === "task-1").reduce((sum, block) => sum + (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000, 0), 60);
});

test("a skipped routine occurrence remains an exception and is not recreated", () => {
  const routine = item({ kind: "routine", recurrence: { frequency: "daily" }, estimateMinutes: 30 });
  const skipped: PlannerBlock = {
    id: "skip-1", itemId: routine.id, title: routine.title,
    startAt: "2026-08-19T06:00:00.000Z", endAt: "2026-08-19T06:30:00.000Z",
    status: "skipped", source: "auto", fixed: false, occurrenceKey: `${routine.id}:2026-08-19`,
  };
  const proposal = buildPlannerProposal({ profile, items: [routine], blocks: [skipped], now: new Date("2026-08-19T04:00:00Z") });
  assert.ok(!proposal.changes.some((change) => change.kind === "add_block" && change.block.occurrenceKey === `${routine.id}:2026-08-19`));
});

test("a task cannot cross an avoided interval", () => {
  const proposal = buildPlannerProposal({
    profile,
    items: [item({ estimateMinutes: 60, avoidedWindows: [{ start: "08:30", end: "09:15" }] })],
    blocks: [],
    now: new Date("2026-08-19T04:00:00Z"),
  });
  const added = proposal.changes.find((change) => change.kind === "add_block");
  assert.ok(added && added.kind === "add_block");
  const date = formatDateInTimeZone(new Date(added.block.startAt), profile.timezone);
  if (date === "2026-08-19") {
    const start = plannerTimeToMinutes(formatTimeInTimeZone(new Date(added.block.startAt), profile.timezone));
    const end = plannerTimeToMinutes(formatTimeInTimeZone(new Date(added.block.endAt), profile.timezone));
    assert.ok(end <= 8 * 60 + 30 || start >= 9 * 60 + 15);
  }
});

test("reserve can make a task impossible instead of silently overfilling the day", () => {
  const tight = {
    ...profile,
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), [{ start: "08:00", end: "09:00" }]])),
    reserveRatio: 0.2,
  };
  const impossible = item({ estimateMinutes: 60 });
  const proposal = buildPlannerProposal({ profile: tight, items: [impossible], blocks: [], now: new Date("2026-08-19T04:00:00Z") });
  assert.equal(proposal.changes.filter((change) => change.kind === "add_block").length, 0);
  assert.match(proposal.unplaced[0]?.reason ?? "", /резерв/i);
  assert.ok(proposal.decisionGroups?.some((group) => group.blocking));
  assert.throws(() => applyProposalChanges([impossible], [], proposal), /нерешёнными/);
});

test("the 20 percent reserve is calculated after fixed commitments", () => {
  const weekday = {
    ...profile,
    defaultBufferMinutes: 0,
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), index === 2 ? [{ start: "08:00", end: "10:00" }] : []])),
    reserveRatio: 0.2,
  };
  const fixed: PlannerBlock = {
    id: "fixed-morning", title: "Обязательство",
    startAt: "2026-08-19T05:00:00.000Z", endAt: "2026-08-19T06:00:00.000Z",
    status: "planned", source: "manual", fixed: true,
  };
  const proposal = buildPlannerProposal({ profile: weekday, items: [item({ estimateMinutes: 50 })], blocks: [fixed], now: new Date("2026-08-19T04:00:00Z") });
  assert.equal(proposal.changes.filter((change) => change.kind === "add_block").length, 0);
  assert.equal(proposal.unplaced[0]?.remainingMinutes, 50);
});

test("profile timezone round-trips correctly across a daylight-saving transition", () => {
  const instant = zonedPlannerDateTimeToUtc("2026-03-29", "03:30", "Europe/Berlin");
  assert.equal(formatDateInTimeZone(new Date(instant), "Europe/Berlin"), "2026-03-29");
  assert.equal(formatTimeInTimeZone(new Date(instant), "Europe/Berlin"), "03:30");
});

test("a fixed event ending after midnight keeps its real duration", () => {
  const proposal = buildPlannerProposal({
    profile,
    items: [],
    blocks: [],
    now: new Date("2026-08-19T04:00:00Z"),
    draft: { title: "Ночной поезд", kind: "fixed_event", date: "2026-08-19", start: "23:00", end: "01:00", estimateMinutes: 120 },
  });
  const added = proposal.changes.find((change) => change.kind === "add_block");
  assert.ok(added && added.kind === "add_block");
  assert.equal((new Date(added.block.endAt).getTime() - new Date(added.block.startAt).getTime()) / 60_000, 120);
});

test("past and completed blocks are never displaced by a new event", () => {
  const protectedBlocks: PlannerBlock[] = [
    { id: "past", itemId: "past-item", title: "Прошлое дело", startAt: "2026-08-19T15:00:00.000Z", endAt: "2026-08-19T15:30:00.000Z", status: "planned", source: "auto", fixed: false },
    { id: "done", itemId: "done-item", title: "Готовое дело", startAt: "2026-08-20T15:00:00.000Z", endAt: "2026-08-20T15:30:00.000Z", status: "done", source: "auto", fixed: false },
  ];
  for (const [index, block] of protectedBlocks.entries()) {
    const date = index === 0 ? "2026-08-19" : "2026-08-20";
    const proposal = buildPlannerProposal({
      profile,
      items: [],
      blocks: [block],
      now: new Date("2026-08-19T15:15:00Z"),
      draft: { title: "Новое событие", kind: "fixed_event", date, start: "18:00", end: "18:30", estimateMinutes: 30 },
    });
    assert.equal(proposal.conflicts[0]?.kind, "fixed_overlap");
    assert.ok(!proposal.changes.some((change) => change.kind === "move_block"));
  }
});

test("autoplan keeps the standard buffer and honors preferred time", () => {
  const fixed: PlannerBlock = {
    id: "fixed-buffer", title: "Встреча",
    startAt: "2026-08-19T07:00:00.000Z", endAt: "2026-08-19T08:00:00.000Z",
    status: "planned", source: "manual", fixed: true,
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [item({ energy: "normal", estimateMinutes: 60, preferredWindows: [{ start: "14:00", end: "16:00" }] })],
    blocks: [fixed],
    now: new Date("2026-08-19T04:00:00Z"),
  });
  const added = proposal.changes.find((change) => change.kind === "add_block");
  assert.ok(added && added.kind === "add_block");
  assert.equal(formatTimeInTimeZone(new Date(added.block.startAt), profile.timezone), "14:00");
  assert.ok(new Date(added.block.startAt).getTime() - new Date(fixed.endAt).getTime() >= 15 * 60_000);
});

test("protected sleep excludes task placement", () => {
  const allDay = {
    ...profile,
    defaultBufferMinutes: 0,
    reserveRatio: 0,
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), [{ start: "00:00", end: "23:59" }]])),
  };
  const sleepEvent = createPlannerSleepEvent({
    profile: allDay,
    wakeDate: "2026-08-20",
    actualStartAt: "2026-08-19T22:00:00.000Z",
  });
  const proposal = buildPlannerProposal({
    profile: allDay,
    items: [item()],
    blocks: [],
    sleepEvents: [sleepEvent],
    now: new Date("2026-08-19T20:30:00.000Z"),
  });
  const added = proposal.changes.find((change) => change.kind === "add_block");
  assert.ok(added && added.kind === "add_block");
  assert.ok(
    new Date(added.block.endAt) <= new Date(sleepEvent.actualStartAt!)
      || new Date(added.block.startAt) >= new Date(sleepEvent.projectedEndAt!)
  );
});

test("late bedtime preserves sleep duration without changing the regular schedule", () => {
  const before = structuredClone(profile.sleepSchedule);
  const event = createPlannerSleepEvent({
    profile,
    wakeDate: "2026-08-20",
    actualStartAt: "2026-08-19T23:15:00.000Z",
  });
  assert.equal(
    (new Date(event.projectedEndAt!).getTime() - new Date(event.actualStartAt!).getTime()) / 60_000,
    sleepRuleForWakeDate(profile.sleepSchedule, "2026-08-20").durationMinutes
  );
  assert.deepEqual(profile.sleepSchedule, before);
});

test("full future rebuild keeps every task minute or reports it in the queue", () => {
  const future: PlannerBlock = {
    id: "future-task",
    itemId: "task-1",
    title: "Сделать важную работу",
    startAt: "2026-08-20T07:00:00.000Z",
    endAt: "2026-08-20T08:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [item()],
    blocks: [future],
    now: new Date("2026-08-19T08:00:00.000Z"),
    trigger: "sleep_changed",
    rebuildFuture: true,
    sleepEvent: createPlannerSleepEvent({
      profile,
      wakeDate: "2026-08-20",
      actualStartAt: "2026-08-19T23:00:00.000Z",
    }),
  });
  const applied = applyProposalChanges([item()], [future], proposal);
  const scheduledMinutes = applied.blocks
    .filter((block) => block.itemId === "task-1" && !["cancelled", "skipped"].includes(block.status))
    .reduce((sum, block) => sum + (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000, 0);
  const queuedMinutes = proposal.unplaced
    .filter((entry) => entry.itemId === "task-1")
    .reduce((sum, entry) => sum + entry.remainingMinutes, 0);
  assert.equal(scheduledMinutes + queuedMinutes, 60);
  assert.equal(applied.items.find((entry) => entry.id === "task-1")?.estimateMinutes, 60);
});

test("a flexible recurring item stays on its weekday and inside its allowed window", () => {
  const school = item({
    id: "free-school",
    kind: "routine",
    title: "Свободное посещение",
    energy: "normal",
    estimateMinutes: 180,
    allowedWindows: [{ start: "10:00", end: "18:00" }],
    bufferBeforeMinutes: 45,
    bufferAfterMinutes: 35,
    recurrence: { frequency: "weekly", weekdays: [5] },
  });
  const proposal = buildPlannerProposal({
    profile: { ...profile, reserveRatio: 0 },
    items: [school],
    blocks: [],
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  const blocks = proposal.changes.flatMap((change) =>
    change.kind === "add_block" && change.block.itemId === school.id ? [change.block] : []
  );
  assert.equal(blocks.length, 1);
  assert.equal(formatDateInTimeZone(new Date(blocks[0].startAt), profile.timezone), "2026-08-21");
  const start = plannerTimeToMinutes(formatTimeInTimeZone(new Date(blocks[0].startAt), profile.timezone));
  const end = plannerTimeToMinutes(formatTimeInTimeZone(new Date(blocks[0].endAt), profile.timezone));
  assert.ok(start >= 10 * 60);
  assert.ok(end <= 18 * 60);
  assert.equal(blocks[0].occurrenceKey, "free-school:2026-08-21");
});

test("recurring duration can be one weekly total instead of repeating on every selected day", () => {
  const selectedDays = [1, 3, 5];
  const weeklyTotal = item({
    id: "weekly-total",
    kind: "routine",
    title: "Практика",
    energy: "normal",
    estimateMinutes: 180,
    canSplit: true,
    minChunkMinutes: 60,
    recurrence: { frequency: "custom", weekdays: selectedDays, durationMode: "per_cycle" },
  });
  const oneHourOnSelectedDays = {
    ...profile,
    reserveRatio: 0,
    defaultBufferMinutes: 0,
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
      String(index + 1),
      selectedDays.includes(index + 1) ? [{ start: "10:00", end: "11:00" }] : [],
    ])),
  };
  const totalProposal = buildPlannerProposal({
    profile: oneHourOnSelectedDays,
    items: [weeklyTotal],
    blocks: [],
    now: new Date("2026-08-16T04:00:00.000Z"),
  });
  const totalBlocks = totalProposal.changes.flatMap((change) =>
    change.kind === "add_block" && change.block.itemId === weeklyTotal.id ? [change.block] : []
  );
  assert.equal(totalBlocks.reduce((sum, block) => sum + (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000, 0), 180);
  assert.deepEqual(totalBlocks.map((block) => formatDateInTimeZone(new Date(block.startAt), profile.timezone)), [
    "2026-08-17",
    "2026-08-19",
    "2026-08-21",
  ]);
  assert.ok(totalBlocks.every((block) => block.occurrenceKey === "weekly-total:cycle:2026-08-17"));
  const repeatedProposal = buildPlannerProposal({
    profile: oneHourOnSelectedDays,
    items: [weeklyTotal],
    blocks: totalBlocks,
    now: new Date("2026-08-16T04:00:00.000Z"),
  });
  assert.ok(!repeatedProposal.changes.some((change) => change.kind === "add_block" && change.block.itemId === weeklyTotal.id));

  const everyDay = item({
    ...weeklyTotal,
    id: "every-selected-day",
    canSplit: false,
    recurrence: { frequency: "custom", weekdays: selectedDays, durationMode: "per_occurrence" },
  });
  const threeHoursOnSelectedDays = {
    ...oneHourOnSelectedDays,
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
      String(index + 1),
      selectedDays.includes(index + 1) ? [{ start: "10:00", end: "13:00" }] : [],
    ])),
  };
  const dailyProposal = buildPlannerProposal({
    profile: threeHoursOnSelectedDays,
    items: [everyDay],
    blocks: [],
    now: new Date("2026-08-16T04:00:00.000Z"),
  });
  const dailyMinutes = dailyProposal.changes.reduce((sum, change) => change.kind === "add_block" && change.block.itemId === everyDay.id
    ? sum + (new Date(change.block.endAt).getTime() - new Date(change.block.startAt).getTime()) / 60_000
    : sum, 0);
  assert.equal(dailyMinutes, 540);
});

test("spare-time work keeps its minimum but only uses extra capacity up to its maximum", () => {
  const hobby = item({
    id: "hobby",
    kind: "routine",
    title: "Собирать модель",
    priority: "low",
    energy: "normal",
    estimateMinutes: 60,
    canSplit: true,
    minChunkMinutes: 15,
    recurrence: {
      frequency: "weekly",
      weekdays: [1],
      durationMode: "per_cycle",
      schedulingMode: "spare_time",
      minimumMinutes: 30,
    },
  });
  const ordinary = item({ id: "ordinary", title: "Обычное гибкое дело", priority: "high", energy: "normal", estimateMinutes: 90 });
  const availability = (end: string) => ({
    ...profile,
    reserveRatio: 0,
    defaultBufferMinutes: 0,
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
      String(index + 1),
      index === 0 ? [{ start: "10:00", end }] : [],
    ])),
  });
  const minutesFor = (proposal: ReturnType<typeof buildPlannerProposal>, itemId: string) => proposal.changes.reduce(
    (sum, change) => change.kind === "add_block" && change.block.itemId === itemId
      ? sum + (new Date(change.block.endAt).getTime() - new Date(change.block.startAt).getTime()) / 60_000
      : sum,
    0
  );

  const tight = buildPlannerProposal({
    profile: availability("12:00"),
    items: [ordinary, hobby],
    blocks: [],
    now: new Date("2026-08-16T04:00:00.000Z"),
  });
  assert.equal(minutesFor(tight, hobby.id), 30);
  assert.equal(minutesFor(tight, ordinary.id), 90);
  const tightRemainder = tight.unplaced.find((entry) => entry.itemId === hobby.id);
  assert.equal(tightRemainder?.remainingMinutes, 30);
  assert.equal(tightRemainder?.blocking, false);

  const roomier = buildPlannerProposal({
    profile: availability("12:30"),
    items: [ordinary, hobby],
    blocks: [],
    now: new Date("2026-08-16T04:00:00.000Z"),
  });
  assert.equal(minutesFor(roomier, ordinary.id), 90);
  assert.equal(minutesFor(roomier, hobby.id), 60);
});

test("a one-time flexible item with a date cannot move to another day", () => {
  const dated = item({
    id: "dated-flexible",
    title: "Разовое дело",
    energy: "normal",
    recurrence: { frequency: "once", startDate: "2026-08-20" },
  });
  const proposal = buildPlannerProposal({
    profile,
    items: [dated],
    blocks: [],
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  const added = proposal.changes.find((change) => change.kind === "add_block" && change.block.itemId === dated.id);
  assert.ok(added && added.kind === "add_block");
  assert.equal(formatDateInTimeZone(new Date(added.block.startAt), profile.timezone), "2026-08-20");
  assert.equal(added.block.occurrenceKey, "dated-flexible:2026-08-20");
});

test("travel may sit outside the item window but remains inside daily availability", () => {
  const visit = item({
    id: "opening-hours",
    title: "Учёба",
    energy: "normal",
    estimateMinutes: 180,
    allowedWindows: [{ start: "10:00", end: "13:00" }],
    bufferBeforeMinutes: 60,
    bufferAfterMinutes: 30,
    recurrence: { frequency: "once", startDate: "2026-08-20" },
  });
  const proposal = buildPlannerProposal({
    profile: { ...profile, reserveRatio: 0 },
    items: [visit],
    blocks: [],
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  const added = proposal.changes.find((change) => change.kind === "add_block" && change.block.itemId === visit.id);
  assert.ok(added && added.kind === "add_block");
  assert.equal(formatTimeInTimeZone(new Date(added.block.startAt), profile.timezone), "10:00");
  assert.equal(formatTimeInTimeZone(new Date(added.block.endAt), profile.timezone), "13:00");
});

test("return travel creates a conflict even when fixed item bodies do not overlap", () => {
  const first = item({
    id: "first-fixed",
    kind: "fixed_event",
    title: "Первое место",
    autoPlan: false,
    bufferAfterMinutes: 30,
  });
  const firstBlock: PlannerBlock = {
    id: "first-block",
    itemId: first.id,
    title: first.title,
    startAt: "2026-08-19T07:00:00.000Z",
    endAt: "2026-08-19T08:00:00.000Z",
    status: "planned",
    source: "manual",
    fixed: true,
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [first],
    blocks: [firstBlock],
    now: new Date("2026-08-19T04:00:00.000Z"),
    draft: {
      title: "Второе место",
      kind: "fixed_event",
      date: "2026-08-19",
      start: "11:15",
      end: "12:00",
      estimateMinutes: 45,
    },
  });
  assert.ok(proposal.conflicts.some((conflict) => conflict.kind === "fixed_overlap"));
});

test("empty energy windows do not favor a time of day", () => {
  const neutralProfile = {
    ...profile,
    reserveRatio: 0,
    energyWindows: [],
  };
  const eveningProfile = {
    ...neutralProfile,
    energyWindows: [{ start: "18:00", end: "22:00", energy: "high" as const }],
  };
  const hardWork = item({ id: "hard-work", energy: "high", estimateMinutes: 60 });
  const input = { items: [hardWork], blocks: [], now: new Date("2026-08-19T04:00:00.000Z") };
  const neutral = buildPlannerProposal({ profile: neutralProfile, ...input });
  const evening = buildPlannerProposal({ profile: eveningProfile, ...input });
  const neutralBlock = neutral.changes.find((change) => change.kind === "add_block");
  const eveningBlock = evening.changes.find((change) => change.kind === "add_block");
  assert.ok(neutralBlock?.kind === "add_block" && eveningBlock?.kind === "add_block");
  assert.equal(formatTimeInTimeZone(new Date(neutralBlock.block.startAt), profile.timezone), "08:00");
  assert.equal(formatTimeInTimeZone(new Date(eveningBlock.block.startAt), profile.timezone), "18:00");
});

test("recurring fixed commitments fill missing occurrences without duplicates", () => {
  const commitment = item({
    id: "school",
    kind: "fixed_event",
    title: "Занятие",
    estimateMinutes: 60,
    autoPlan: false,
    recurrence: {
      frequency: "custom",
      weekdays: [1, 2, 3, 4, 5],
      startDate: "2026-08-19",
      startTime: "09:00",
      endTime: "10:00",
    },
  });
  const existing: PlannerBlock = {
    id: "school-existing",
    itemId: commitment.id,
    title: commitment.title,
    startAt: "2026-08-19T06:00:00.000Z",
    endAt: "2026-08-19T07:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: true,
    occurrenceKey: "school:2026-08-19",
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [commitment],
    blocks: [existing],
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  const occurrences = proposal.changes.flatMap((change) =>
    change.kind === "add_block" && change.block.itemId === commitment.id
      ? [change.block.occurrenceKey]
      : []
  );
  assert.ok(!occurrences.includes(existing.occurrenceKey));
  assert.equal(new Set(occurrences).size, occurrences.length);
});

test("constructor moves an occurrence relative to another block", () => {
  const source: PlannerBlock = { id: "move-source", itemId: "task-1", title: "Источник", startAt: "2026-08-20T12:00:00.000Z", endAt: "2026-08-20T13:00:00.000Z", status: "planned", source: "auto", fixed: false };
  const anchor: PlannerBlock = { id: "move-anchor", title: "Опора", startAt: "2026-08-20T08:00:00.000Z", endAt: "2026-08-20T09:00:00.000Z", status: "planned", source: "manual", fixed: true };
  const proposal = buildPlannerProposal({
    profile,
    items: [item()],
    blocks: [source, anchor],
    now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "move_item", blockId: source.id, scope: "occurrence", placement: { mode: "after", anchorBlockId: anchor.id } },
  });
  const move = proposal.changes.find((change) => change.kind === "move_block" && change.blockId === source.id);
  assert.ok(move?.kind === "move_block");
  assert.equal(move.toStartAt, addIsoMinutes(anchor.endAt, profile.defaultBufferMinutes));
});

test("constructor protects a midnight sleep boundary from later work", () => {
  const late: PlannerBlock = { id: "after-midnight", itemId: "task-1", title: "Позднее дело", startAt: "2026-08-19T21:30:00.000Z", endAt: "2026-08-19T22:30:00.000Z", status: "planned", source: "auto", fixed: false };
  const proposal = buildPlannerProposal({
    profile,
    items: [item()],
    blocks: [late],
    now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "set_sleep_boundary", boundary: "bedtime", date: "2026-08-20", time: "00:00" },
  });
  const sleep = proposal.changes.find((change) => change.kind === "upsert_sleep_event");
  assert.ok(sleep?.kind === "upsert_sleep_event");
  assert.equal(formatTimeInTimeZone(new Date(sleep.event.plannedStartAt!), profile.timezone), "00:00");
  assert.ok(proposal.changes.some((change) => change.kind === "move_block" || change.kind === "remove_block"));
  const sleepStart = new Date(sleep.event.plannedStartAt!).getTime();
  const sleepEnd = new Date(sleep.event.plannedEndAt!).getTime();
  for (const change of proposal.changes) {
    const startAt = change.kind === "add_block" ? change.block.startAt : change.kind === "move_block" ? change.toStartAt : undefined;
    const endAt = change.kind === "add_block" ? change.block.endAt : change.kind === "move_block" ? change.toEndAt : undefined;
    if (startAt && endAt && (change.kind !== "add_block" || change.block.role === "work")) {
      assert.ok(new Date(endAt).getTime() <= sleepStart || new Date(startAt).getTime() >= sleepEnd);
    }
  }
});

test("one-off late wake shifts that day's energy window", () => {
  const energyProfile = {
    ...profile,
    defaultBufferMinutes: 0,
    reserveRatio: 0,
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), [{ start: "07:00", end: "18:00" }]])),
    energyWindows: [
      { start: "08:00", end: "10:00", energy: "high" as const },
      { start: "10:00", end: "18:00", energy: "normal" as const },
    ],
  };
  const proposal = buildPlannerProposal({
    profile: energyProfile,
    items: [item({ estimateMinutes: 60, energy: "high" })],
    blocks: [],
    sleepEvents: [createPlannerSleepEvent({
      profile: energyProfile,
      wakeDate: "2026-08-20",
      actualStartAt: "2026-08-19T22:00:00.000Z",
    })],
    now: new Date("2026-08-20T06:00:00.000Z"),
  });
  const added = proposal.changes.find((change) => change.kind === "add_block");
  assert.ok(added && added.kind === "add_block");
  assert.equal(formatTimeInTimeZone(new Date(added.block.startAt), energyProfile.timezone), "10:00");
});

test("identical input creates an identical proposal", () => {
  const input = {
    profile,
    items: [item()],
    blocks: [] as PlannerBlock[],
    now: new Date("2026-08-19T04:00:00.000Z"),
    drafts: [{ title: "Важный отчёт", kind: "flexible_task" as const, estimateMinutes: 90 }],
    trigger: "assistant_update" as const,
    rebuildFuture: true,
  };
  assert.deepEqual(buildPlannerProposal(input), buildPlannerProposal(input));
});

test("adaptive sleep target follows the healthy deterministic range rules", () => {
  assert.deepEqual(chooseAdaptiveSleepTarget(5 * 60, 10 * 60), {
    minMinutes: 300, maxMinutes: 600, targetDurationMinutes: 480, requiresHealthyMinimumConfirmation: false,
  });
  assert.equal(chooseAdaptiveSleepTarget(6 * 60, 7 * 60).targetDurationMinutes, 420);
  assert.equal(chooseAdaptiveSleepTarget(7 * 60, 9 * 60).targetDurationMinutes, 480);
  assert.equal(chooseAdaptiveSleepTarget(9 * 60, 10 * 60).targetDurationMinutes, 540);
  assert.equal(chooseAdaptiveSleepTarget(5 * 60, 6 * 60).requiresHealthyMinimumConfirmation, true);
  assert.equal(chooseAdaptiveSleepTarget(5 * 60, 6 * 60).targetDurationMinutes, 420);
  const unconfirmed = createAdaptiveSleepSchedule({ minMinutes: 5 * 60, maxMinutes: 6 * 60, dayPart: "morning" });
  assert.throws(() => buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule: unconfirmed },
    items: [],
    blocks: [],
    trigger: "assistant_setup",
    now: new Date("2026-08-19T04:00:00.000Z"),
  }), /Подтвердите/);
});

test("adaptive anchor uses a day part and moves earlier for a recurring morning commitment", () => {
  assert.equal(deriveAdaptiveWakeAnchor("morning", 60), "09:00");
  assert.equal(deriveAdaptiveWakeAnchor("late_morning", 60, [{
    kind: "fixed_event",
    recurrence: { frequency: "custom", weekdays: [1, 2, 3, 4, 5], startTime: "08:30" },
  }]), "07:30");
});

test("automatic wake uses a stable 09:00 anchor when nothing requires another time", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 7 * 60, maxMinutes: 9 * 60, dayPart: "auto" });
  const input = {
    profile,
    profilePatch: {
      sleepSchedule,
      availability: availabilityFromSleepSchedule(sleepSchedule),
    },
    items: [] as PlannerItem[],
    blocks: [] as PlannerBlock[],
    trigger: "assistant_setup" as const,
    rebuildFuture: true,
    now: new Date("2026-08-19T04:00:00.000Z"),
  };
  const proposal = buildPlannerProposal(input);
  assert.equal(proposal.wakeAnchorDecision?.wakeTime, "09:00");
  assert.equal(proposal.wakeAnchorDecision?.bedtime, "01:00");
  assert.equal(proposal.wakeAnchorDecision?.reason.code, "auto_default");
  assert.equal(proposal.wakeAnchorDecision?.candidatesEvaluated, 1);
  assert.deepEqual(proposal, buildPlannerProposal(input));
});

test("automatic wake prepares several unconstrained uncertain items without scanning every anchor", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 7 * 60, maxMinutes: 9 * 60, dayPart: "auto" });
  const flexibleItems = Array.from({ length: 7 }, (_, index) => item({
    id: `floating-${index}`,
    title: `Плавающее дело ${index + 1}`,
    estimateMinutes: 90,
    canSplit: true,
    minChunkMinutes: 30,
    uncertaintyPolicy: {
      outcomeMode: "deliverable",
      duration: { mode: "range", minMinutes: 60, likelyMinutes: 90, maxMinutes: 150, source: "user" },
      date: { mode: "any" },
      time: { mode: "any" },
      recurrence: { mode: "exact_days", period: "week", minOccurrences: 1, likelyOccurrences: 1, maxOccurrences: 1, allowedWeekdays: [] },
    },
  }));
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule), energyWindows: [] },
    items: flexibleItems,
    blocks: [],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  assert.equal(proposal.wakeAnchorDecision?.wakeTime, "09:00");
  assert.equal(proposal.wakeAnchorDecision?.candidatesEvaluated, 1);
  assert.ok(proposal.changes.some((change) => change.kind === "add_block"));
});

test("assistant setup prepares seven ranged recurring items in a single wake calculation", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 7 * 60, maxMinutes: 9 * 60, dayPart: "auto" });
  const recurringItems = Array.from({ length: 7 }, (_, index) => item({
    id: `recurring-floating-${index}`,
    kind: "routine",
    title: `Регулярное дело ${index + 1}`,
    estimateMinutes: 90,
    canSplit: true,
    minChunkMinutes: 30,
    recurrence: { frequency: "custom", weekdays: [1, 2, 3, 4, 5], durationMode: "per_occurrence" },
    uncertaintyPolicy: {
      outcomeMode: "time_budget",
      duration: { mode: "range", minMinutes: 60, likelyMinutes: 90, maxMinutes: 150, source: "user" },
      date: { mode: "any" },
      time: { mode: "any" },
      recurrence: { mode: "count_range", period: "week", minOccurrences: 2, likelyOccurrences: 3, maxOccurrences: 4, allowedWeekdays: [1, 2, 3, 4, 5] },
    },
  }));
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule), energyWindows: [] },
    items: recurringItems,
    blocks: [],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now: new Date("2026-08-17T04:00:00.000Z"),
  });
  assert.equal(proposal.wakeAnchorDecision?.candidatesEvaluated, 1);
  assert.ok(proposal.changes.some((change) => change.kind === "add_block"));
});

test("automatic wake moves exactly early enough for a recurring morning commitment", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 7 * 60, maxMinutes: 9 * 60, dayPart: "auto" });
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule) },
    items: [],
    blocks: [],
    drafts: [{
      title: "Работа",
      kind: "fixed_event",
      estimateMinutes: 8 * 60,
      recurrence: { frequency: "custom", weekdays: [1, 2, 3, 4, 5], startDate: "2026-08-19", startTime: "08:00", endTime: "16:00" },
    }],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  assert.equal(proposal.wakeAnchorDecision?.wakeTime, "07:00");
  assert.equal(proposal.wakeAnchorDecision?.reason.code, "recurring_commitment");
  assert.equal(proposal.wakeAnchorDecision?.reason.relatedTitle, "Работа");
});

test("automatic wake can move before 06:30 only when a recurring commitment requires it", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 7 * 60, maxMinutes: 9 * 60, dayPart: "auto" });
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule) },
    items: [item({
      id: "early-train",
      title: "Ранний поезд",
      kind: "fixed_event",
      estimateMinutes: 60,
      recurrence: { frequency: "weekly", weekdays: [1], startDate: "2026-08-19", startTime: "05:00", endTime: "06:00" },
      autoPlan: false,
    })],
    blocks: [],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  assert.equal(proposal.wakeAnchorDecision?.wakeTime, "04:00");
  assert.equal(proposal.wakeAnchorDecision?.reason.code, "recurring_commitment");
});

test("automatic wake does not move earlier only to fit an ordinary flexible task", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 7 * 60, maxMinutes: 9 * 60, dayPart: "auto" });
  const urgent = item({
    id: "early-deadline",
    title: "Утренняя подача",
    estimateMinutes: 60,
    earliestAt: "2026-08-20T03:00:00.000Z",
    deadlineAt: "2026-08-20T05:00:00.000Z",
  });
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule) },
    items: [urgent],
    blocks: [],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  assert.equal(proposal.wakeAnchorDecision?.wakeTime, "09:00");
  assert.equal(proposal.wakeAnchorDecision?.reason.code, "auto_default");
});

test("automatic wake reports a recurring fixed conflict instead of applying it", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 7 * 60, maxMinutes: 9 * 60, dayPart: "auto" });
  const overnight = item({
    id: "night-shift",
    title: "Ночное обязательство",
    kind: "fixed_event",
    estimateMinutes: 180,
    recurrence: { frequency: "daily", startDate: "2026-08-19", startTime: "02:00", endTime: "05:00" },
    autoPlan: false,
  });
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule) },
    items: [overnight],
    blocks: [],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  assert.equal(proposal.wakeAnchorDecision?.reason.code, "fixed_conflict");
  assert.ok(proposal.conflicts.some((conflict) => conflict.kind === "fixed_overlap"));
  assert.throws(() => applyProposalChanges([overnight], [], proposal));
});

test("assistant setup starts a passed bedtime as a debt-free transition night", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({
    minMinutes: 9 * 60,
    maxMinutes: 9 * 60,
    exactDurationsMinutes: [9 * 60],
    dayPart: "morning",
    bedtimePreference: { mode: "exact", time: "21:30", source: "user" },
    wakePreference: { mode: "exact", time: "06:30", source: "user" },
    windDownMinutes: 30,
  });
  const now = new Date("2026-08-21T18:38:00.000Z");
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule), assistantSetupVersion: 5 },
    items: [],
    blocks: [],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now,
  });
  assert.equal(proposal.effectiveFromAt, now.toISOString());
  assert.equal(proposal.sleepPlan?.[0]?.transitionNight, true);
  assert.equal(proposal.sleepPlan?.[0]?.reason, "activation_transition");
  assert.equal(formatTimeInTimeZone(new Date(proposal.sleepPlan![0].startAt), profile.timezone), "22:15");
  assert.equal(proposal.sleepPlan?.[0]?.borrowedMinutes, 0);
  assert.ok(proposal.sleepPlan!.every((night) => new Date(night.endAt) > now));
});

test("sleep clock preferences keep approximate tolerance and overnight hard ranges", () => {
  const schedule = normalizeSleepSchedule(createAdaptiveSleepSchedule({
    minMinutes: 7 * 60,
    maxMinutes: 9 * 60,
    dayPart: "morning",
    bedtimePreference: { mode: "range", notBefore: "23:30", notAfter: "01:30", source: "user" },
    wakePreference: { mode: "approximate", time: "09:00", toleranceMinutes: 60, notBefore: "08:00", source: "user" },
  }));
  assert.equal(schedule.mode, "adaptive");
  if (schedule.mode !== "adaptive") return;
  assert.equal(schedule.wakePreference.toleranceMinutes, 60);
  assert.equal(schedule.wakePreference.notBefore, "08:00");
  assert.equal(sleepRuleForWakeDate(schedule, "2026-08-22").bedtime, "00:30");
});

test("neutral wake uses recent actual history but ignores transition nights", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 8 * 60, maxMinutes: 8 * 60, dayPart: "auto" });
  const sleepEvents = [
    { wakeDate: "2026-08-17", eventKind: "sleep_change" as const, state: "completed" as const, actualStartAt: "2026-08-16T23:00:00.000Z", projectedEndAt: "2026-08-17T07:00:00.000Z", actualEndAt: "2026-08-17T07:00:00.000Z" },
    { wakeDate: "2026-08-18", eventKind: "sleep_change" as const, state: "completed" as const, actualStartAt: "2026-08-17T23:30:00.000Z", projectedEndAt: "2026-08-18T07:30:00.000Z", actualEndAt: "2026-08-18T07:30:00.000Z" },
    { wakeDate: "2026-08-19", eventKind: "sleep_change" as const, state: "completed" as const, actualStartAt: "2026-08-18T23:15:00.000Z", projectedEndAt: "2026-08-19T07:15:00.000Z", actualEndAt: "2026-08-19T07:15:00.000Z" },
    { wakeDate: "2026-08-20", eventKind: "planned_adjustment" as const, state: "completed" as const, actualStartAt: "2026-08-19T18:00:00.000Z", projectedEndAt: "2026-08-20T03:00:00.000Z", actualEndAt: "2026-08-20T03:00:00.000Z", transitionNight: true },
  ];
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule) },
    items: [],
    blocks: [],
    sleepEvents,
    trigger: "assistant_update",
    rebuildFuture: true,
    now: new Date("2026-08-20T12:00:00.000Z"),
  });
  assert.equal(proposal.wakeAnchorDecision?.wakeTime, "10:15");
  assert.equal(proposal.wakeAnchorDecision?.reason.code, "sleep_history");
});

test("a selected recurring day before setup does not become an unplaced debt", () => {
  const routine = item({
    id: "friday-routine",
    kind: "routine",
    commitmentLevel: "required",
    estimateMinutes: 60,
    recurrence: { frequency: "custom", weekdays: [5], durationMode: "per_occurrence" },
  });
  const now = new Date("2026-08-21T18:38:00.000Z");
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { assistantSetupVersion: 5 },
    items: [routine],
    blocks: [],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now,
  });
  assert.equal(proposal.unplaced.some((entry) => entry.itemId === routine.id), false);
});

test("the first weekly count range is prorated to the remaining eligible days", () => {
  const routine = item({
    id: "weekly-range",
    kind: "routine",
    estimateMinutes: 30,
    recurrence: { frequency: "daily", durationMode: "per_occurrence" },
    uncertaintyPolicy: {
      outcomeMode: "time_budget",
      duration: { mode: "exact", minMinutes: 30, likelyMinutes: 30, maxMinutes: 30, source: "user" },
      date: { mode: "any" },
      time: { mode: "any" },
      recurrence: { mode: "count_range", period: "week", minOccurrences: 2, likelyOccurrences: 3, maxOccurrences: 4, allowedWeekdays: [1, 2, 3, 4, 5, 6, 7] },
      deadline: { mode: "none" },
    },
  });
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { assistantSetupVersion: 5 },
    items: [routine],
    blocks: [],
    trigger: "assistant_setup",
    rebuildFuture: true,
    now: new Date("2026-08-21T18:38:00.000Z"),
  });
  const currentWeekBlocks = proposal.changes.filter((change) => change.kind === "add_block"
    && change.block.itemId === routine.id
    && change.block.occurrenceKey?.includes("2026-08-17")
    && change.block.role !== "uncertainty_reserve");
  assert.ok(currentWeekBlocks.length <= 2);
  assert.equal(proposal.unplaced.some((entry) => entry.itemId === routine.id), false);
});

test("missed occurrence can be cancelled once or carried with a remembered rule", () => {
  const project = item({ id: "project", estimateMinutes: 60 });
  const block: PlannerBlock = {
    id: "project-block",
    itemId: project.id,
    title: project.title,
    startAt: "2026-08-21T10:00:00.000Z",
    endAt: "2026-08-21T11:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const cancelled = buildPlannerProposal({
    profile,
    items: [project],
    blocks: [block],
    trigger: "plans_changed",
    rebuildFuture: true,
    missedOccurrence: { blockId: block.id, disposition: "cancel_occurrence" },
    now: new Date("2026-08-21T09:00:00.000Z"),
  });
  assert.equal(cancelled.changes.some((change) => change.kind === "update_block_status" && change.status === "skipped"), true);
  assert.equal(cancelled.changes.some((change) => change.kind === "add_block" && change.block.itemId === project.id), false);

  const carried = buildPlannerProposal({
    profile,
    items: [project],
    blocks: [block],
    trigger: "plans_changed",
    rebuildFuture: true,
    missedOccurrence: { blockId: block.id, disposition: "carry_remaining", rememberPolicy: true },
    now: new Date("2026-08-21T09:00:00.000Z"),
  });
  assert.equal(carried.changes.some((change) => change.kind === "add_block" && change.block.itemId === project.id), true);
  assert.equal(carried.changes.some((change) => change.kind === "update_item" && change.item.uncertaintyPolicy.missedOccurrencePolicy === "carry_remaining"), true);
});

test("a one-off morning event does not silently replace the permanent automatic anchor", () => {
  const sleepSchedule = createAdaptiveSleepSchedule({ minMinutes: 7 * 60, maxMinutes: 9 * 60, dayPart: "auto" });
  const proposal = buildPlannerProposal({
    profile,
    profilePatch: { sleepSchedule, availability: availabilityFromSleepSchedule(sleepSchedule) },
    items: [],
    blocks: [],
    draft: { title: "Разовая встреча", kind: "fixed_event", date: "2026-08-20", start: "08:00", end: "09:00", estimateMinutes: 60 },
    trigger: "assistant_setup",
    rebuildFuture: true,
    now: new Date("2026-08-19T04:00:00.000Z"),
  });
  assert.equal(proposal.wakeAnchorDecision?.wakeTime, "09:00");
  assert.ok(proposal.conflicts.some((conflict) => conflict.kind === "fixed_overlap"));
});

test("fixed event endings keep exact, approximate, range and unknown structure", () => {
  const estimates = [
    { mode: "exact" as const, likelyAt: "2026-08-20T16:00:00.000Z" },
    { mode: "approximate" as const, earliestAt: "2026-08-20T15:30:00.000Z", likelyAt: "2026-08-20T16:00:00.000Z", latestAt: "2026-08-20T16:30:00.000Z", toleranceMinutes: 30 },
    { mode: "range" as const, earliestAt: "2026-08-20T15:30:00.000Z", likelyAt: "2026-08-20T16:00:00.000Z", latestAt: "2026-08-20T17:00:00.000Z" },
    { mode: "unknown" as const },
  ];
  for (const [index, endEstimate] of estimates.entries()) {
    const proposal = buildPlannerProposal({
      profile,
      items: [],
      blocks: [],
      now: new Date("2026-08-19T04:00:00.000Z"),
      operation: { kind: "add_item", draft: { title: `Событие ${index}`, kind: "fixed_event", date: "2026-08-20", start: "18:00", end: "19:00", estimateMinutes: 60, endEstimate } },
    });
    const block = proposal.changes.find((change) => change.kind === "add_block" && !change.block.soft);
    assert.ok(block?.kind === "add_block");
    assert.equal(block.block.endEstimate?.mode, endEstimate.mode);
    if (endEstimate.mode === "unknown") assert.equal(block.block.tentative, true);
    if (endEstimate.mode === "approximate" || endEstimate.mode === "range") {
      assert.ok(proposal.changes.some((change) => change.kind === "add_block" && change.block.soft && change.block.role === "uncertainty_reserve"));
    }
  }
});

test("tentative late bedtime uses the midpoint and stays explicitly tentative", () => {
  const adaptiveProfile = {
    ...profile,
    sleepSchedule: createAdaptiveSleepSchedule({
      minMinutes: 5 * 60,
      maxMinutes: 10 * 60,
      dayPart: "morning",
    }),
  };
  const event = createTentativeSleepEvent({
    profile: adaptiveProfile,
    wakeDate: "2026-08-20",
    estimatedStartFromAt: "2026-08-20T00:00:00.000Z",
    estimatedStartToAt: "2026-08-20T03:00:00.000Z",
  });
  assert.equal(event.state, "tentative");
  assert.equal(event.actualStartAt, "2026-08-20T01:30:00.000Z");
  const block = buildPlannerSleepBlocks(adaptiveProfile, [event], "2026-08-20", "2026-08-20")
    .find((candidate) => candidate.wakeDate === "2026-08-20");
  assert.equal(block?.tentative, true);
  assert.equal((new Date(block!.endAt).getTime() - new Date(block!.startAt).getTime()) / 60_000, 480);
});

test("late adaptive sleep returns to the wake anchor by no more than one hour per day", () => {
  const adaptiveProfile = {
    ...profile,
    sleepSchedule: createAdaptiveSleepSchedule({
      minMinutes: 7 * 60,
      maxMinutes: 10 * 60,
      dayPart: "morning",
    }),
  };
  const disruption = createPlannerSleepEvent({
    profile: adaptiveProfile,
    wakeDate: "2026-08-20",
    actualStartAt: "2026-08-20T03:00:00.000Z",
    actualEndAt: "2026-08-20T11:00:00.000Z",
  });
  const blocks = buildPlannerSleepBlocks(adaptiveProfile, [disruption], "2026-08-20", "2026-08-23");
  const wakeTimes = ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map((date) =>
    new Date(blocks.find((block) => block.wakeDate === date)!.endAt).getTime()
  );
  const localWakeMinutes = wakeTimes.map((instant) => plannerTimeToMinutes(formatTimeInTimeZone(new Date(instant), adaptiveProfile.timezone)));
  assert.deepEqual(localWakeMinutes, [14 * 60, 13 * 60, 12 * 60, 11 * 60]);
  assert.deepEqual(adaptiveProfile.sleepSchedule.wakeAnchor.localTime, "09:00");
});

test("short adaptive sleep creates a bounded three-night recovery opportunity", () => {
  const adaptiveProfile = {
    ...profile,
    sleepSchedule: createAdaptiveSleepSchedule({
      minMinutes: 5 * 60,
      maxMinutes: 10 * 60,
      dayPart: "morning",
    }),
  };
  const shortNight = createPlannerSleepEvent({
    profile: adaptiveProfile,
    wakeDate: "2026-08-20",
    actualStartAt: "2026-08-20T03:00:00.000Z",
    actualEndAt: "2026-08-20T07:00:00.000Z",
  });
  const blocks = buildPlannerSleepBlocks(adaptiveProfile, [shortNight], "2026-08-20", "2026-08-24");
  const durations = ["2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24"].map((date) => {
    const block = blocks.find((candidate) => candidate.wakeDate === date)!;
    return (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000;
  });
  assert.deepEqual(durations, [540, 480, 480, 480]);
});

test("seven comparable check-ins only suggest a longer target", () => {
  const schedule = createAdaptiveSleepSchedule({
    minMinutes: 7 * 60,
    maxMinutes: 10 * 60,
    dayPart: "morning",
  });
  const events = Array.from({ length: 7 }, (_, index) => ({
    wakeDate: `2026-08-${String(13 + index).padStart(2, "0")}`,
    eventKind: "check_in" as const,
    state: "completed" as const,
    actualStartAt: `2026-08-${String(12 + index).padStart(2, "0")}T22:00:00.000Z`,
    projectedEndAt: `2026-08-${String(13 + index).padStart(2, "0")}T06:00:00.000Z`,
    actualEndAt: `2026-08-${String(13 + index).padStart(2, "0")}T06:00:00.000Z`,
    restedness: index < 4 ? "not_rested" as const : "okay" as const,
  }));
  assert.equal(plannerSleepDurationSuggestion(schedule, events, "2026-08-19")?.suggestedMinutes, 510);
  assert.equal(schedule.targetDurationMinutes, 480);
});

test("a short completed night offers at most a twenty minute early nap without adding it", () => {
  const adaptiveProfile = {
    ...profile,
    availability: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), [{ start: "08:00", end: "22:00" }]])),
    sleepSchedule: createAdaptiveSleepSchedule({ minMinutes: 5 * 60, maxMinutes: 10 * 60, dayPart: "morning" }),
  };
  const event = createPlannerSleepEvent({
    profile: adaptiveProfile,
    wakeDate: "2026-08-20",
    actualStartAt: "2026-08-20T02:00:00.000Z",
    actualEndAt: "2026-08-20T06:00:00.000Z",
  });
  const advice = buildSleepRecoveryAdvice(adaptiveProfile, event, []);
  assert.equal(advice?.deficitMinutes, 60);
  assert.ok(advice?.nap);
  assert.equal((new Date(advice!.nap!.endAt).getTime() - new Date(advice!.nap!.startAt).getTime()) / 60_000, 20);
  const proposal = buildPlannerProposal({
    profile: adaptiveProfile,
    items: [],
    blocks: [],
    sleepEvent: event,
    trigger: "sleep_changed",
    now: new Date("2026-08-20T06:01:00.000Z"),
  });
  assert.ok(proposal.recoveryAdvice?.nap);
  assert.ok(!proposal.changes.some((change) => change.kind === "add_item" && /восстановитель/i.test(change.item.title)));
});

test("exact sleep options are unique, sorted and old ranges remain compatible", () => {
  const exact = createAdaptiveSleepSchedule({
    minMinutes: 7 * 60,
    maxMinutes: 9 * 60,
    exactDurationsMinutes: [9 * 60, 7 * 60, 9 * 60],
    dayPart: "morning",
  });
  assert.deepEqual(exact.durationPreference, { mode: "exact", optionsMinutes: [420, 540] });
  assert.equal(exact.targetDurationMinutes, 540);
  const confirmedShort = createAdaptiveSleepSchedule({
    minMinutes: 300, maxMinutes: 360, exactDurationsMinutes: [300, 360], dayPart: "morning", healthyMinimumConfirmed: true,
  });
  assert.ok(confirmedShort.durationPreference.mode === "exact" && confirmedShort.durationPreference.optionsMinutes.includes(420));
  const old = normalizeSleepSchedule({
    mode: "adaptive",
    durationRange: { minMinutes: 420, maxMinutes: 540 },
    targetDurationMinutes: 480,
    wakeAnchor: { dayPart: "morning", localTime: "09:00", toleranceMinutes: 60 },
    morningPreparationMinutes: 60,
    recovery: { horizonNights: 3, maxNightExtensionMinutes: 60, maxDailyAnchorShiftMinutes: 60, suggestShortNap: true },
  });
  assert.equal(old.mode, "adaptive");
  assert.deepEqual(old.mode === "adaptive" ? old.durationPreference : undefined, { mode: "range", minMinutes: 420, maxMinutes: 540 });
});

test("sleep priority keeps 9 hours while work priority chooses 7 only when it fits more work", () => {
  const schedule = createAdaptiveSleepSchedule({
    minMinutes: 420,
    maxMinutes: 540,
    exactDurationsMinutes: [420, 540],
    dayPart: "morning",
  });
  const base = {
    ...profile,
    reserveRatio: 0.2,
    defaultBufferMinutes: 0,
    sleepSchedule: schedule,
    availability: availabilityFromSleepSchedule(schedule),
  };
  const longTask = item({ id: "long-exact", estimateMinutes: 13 * 60, energy: "normal" });
  const strict = buildPlannerProposal({
    profile: { ...base, planningPolicy: { ...base.planningPolicy, focus: "sleep" } },
    items: [longTask], blocks: [], now: new Date("2026-08-19T03:00:00.000Z"),
  });
  assert.ok(strict.sleepPlan?.every((night) => night.durationMinutes >= 540));
  assert.ok(strict.unplaced.some((entry) => entry.itemId === longTask.id));
  const work = buildPlannerProposal({
    profile: { ...base, planningPolicy: { ...base.planningPolicy, focus: "work" } },
    items: [longTask], blocks: [], now: new Date("2026-08-19T03:00:00.000Z"),
  });
  assert.ok(work.sleepPlan?.some((night) => night.durationMinutes === 420));
  assert.ok(!work.unplaced.some((entry) => entry.itemId === longTask.id));
});

test("only a hard deadline can borrow below the minimum and creates recovery nights", () => {
  const schedule = createAdaptiveSleepSchedule({
    minMinutes: 420,
    maxMinutes: 420,
    exactDurationsMinutes: [420],
    dayPart: "morning",
  });
  const workProfile = {
    ...profile,
    reserveRatio: 0,
    defaultBufferMinutes: 15,
    sleepSchedule: schedule,
    availability: availabilityFromSleepSchedule(schedule),
    planningPolicy: { ...profile.planningPolicy, focus: "work" as const },
  };
  const hard = item({
    id: "hard-borrow",
    estimateMinutes: 17 * 60,
    energy: "normal",
    deadlineType: "hard",
    deadlineAt: "2026-08-20T05:00:00.000Z",
  });
  const proposal = buildPlannerProposal({ profile: workProfile, items: [hard], blocks: [], now: new Date("2026-08-19T03:00:00.000Z") });
  const borrowed = proposal.sleepPlan?.find((night) => night.borrowedMinutes > 0);
  assert.ok(borrowed);
  assert.ok(borrowed!.durationMinutes >= 360);
  assert.ok(borrowed!.borrowedMinutes <= 120);
  assert.ok(proposal.sleepPlan?.some((night) => night.reason === "recovery"));
  assert.ok(!proposal.unplaced.some((entry) => entry.itemId === hard.id));
});

test("deadline rules stay deterministic while date bounds remain structured", () => {
  const hard = normalizePlannerItem({
    ...item({ id: "deadline-core", estimateMinutes: 500 }),
    deadlineType: "hard",
    deadlineAt: "2026-08-21T18:00:00.000Z",
    estimateConfidence: "low",
  });
  const target = resolvePlannerTargetFinish(hard, profile, [], new Date("2026-08-19T04:00:00.000Z"));
  assert.ok(target && target < hard.deadlineAt!);
  assert.equal(suggestPlannerMilestones(hard, target, new Date("2026-08-19T04:00:00.000Z")).length, 5);
  assert.equal(analyzePlannerDeadlines([hard], [], profile, new Date("2026-08-19T04:00:00.000Z"))[0].deadlineType, "hard");
  const protectedFree = buildPlannerProposal({
    profile, items: [], blocks: [], now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "protect_interval", date: "2026-08-20", start: "12:00", end: "13:00" },
  });
  assert.ok(protectedFree.changes.some((change) => change.kind === "add_block" && change.block.role === "protected_free"));
  const bounds = buildPlannerProposal({
    profile, items: [], blocks: [], now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "set_day_bounds", date: "2026-08-21", start: "10:00", end: "17:00" },
  });
  const profileChange = bounds.changes.find((change) => change.kind === "update_profile");
  assert.ok(profileChange?.kind === "update_profile");
  assert.deepEqual(profileChange.profile.availabilityOverrides["2026-08-21"], [{ start: "10:00", end: "17:00" }]);
});

test("sleepiness levels create bounded recovery without treating an exact 8-hour fact as debt", () => {
  const schedule = createAdaptiveSleepSchedule({ minMinutes: 420, maxMinutes: 540, exactDurationsMinutes: [420, 540], dayPart: "morning" });
  const adaptiveProfile = { ...profile, sleepSchedule: schedule };
  const eightHours = createPlannerSleepEvent({
    profile: adaptiveProfile,
    wakeDate: "2026-08-20",
    actualStartAt: "2026-08-19T22:00:00.000Z",
    actualEndAt: "2026-08-20T06:00:00.000Z",
    sleepinessLevel: 0,
  });
  assert.equal(buildSleepRecoveryAdvice(adaptiveProfile, eightHours, []), undefined);
  const sleepy = { ...eightHours, sleepinessLevel: 3 as const };
  const recovered = buildPlannerSleepBlocks(adaptiveProfile, [sleepy], "2026-08-20", "2026-08-23");
  assert.equal(recovered.filter((block) => block.wakeDate > sleepy.wakeDate && block.recoveryNight).length, 3);
});

test("repeated extreme sleep changes produce a neutral health notice", () => {
  const adaptiveProfile = {
    ...profile,
    sleepSchedule: createAdaptiveSleepSchedule({ minMinutes: 5 * 60, maxMinutes: 10 * 60, dayPart: "morning" }),
  };
  const events = [17, 18, 19].map((day) => createPlannerSleepEvent({
    profile: adaptiveProfile,
    wakeDate: `2026-08-${day}`,
    actualStartAt: `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    actualEndAt: `2026-08-${String(day).padStart(2, "0")}T04:00:00.000Z`,
  }));
  assert.match(plannerSleepHealthNotice(adaptiveProfile, events, "2026-08-19") ?? "", /специалист/i);
});

test("old items normalize to an exact uncertainty policy without changing behavior", () => {
  const legacy = normalizePlannerItem({ id: "legacy-exact", title: "Старое дело", estimateMinutes: 75 });
  assert.deepEqual(legacy.uncertaintyPolicy.duration, {
    mode: "exact",
    minMinutes: 75,
    likelyMinutes: 75,
    maxMinutes: 75,
    tolerancePercent: undefined,
    calibrationMinutes: undefined,
    source: "user",
  });
  assert.equal(legacy.commitmentLevel, "required");
  assert.deepEqual(legacy.uncertaintyPolicy.reduction, { mode: "forbidden" });
});

test("constructor changes duration and explicit reduction rules together", () => {
  const source = item({ id: "duration-change" });
  const proposal = buildPlannerProposal({
    profile,
    items: [source],
    blocks: [],
    now: new Date("2026-08-19T04:00:00.000Z"),
    operation: {
      kind: "change_item_duration",
      itemId: source.id,
      duration: { mode: "range", minMinutes: 45, likelyMinutes: 90, maxMinutes: 120, source: "user" },
      reduction: { mode: "to_minimum", minimumMinutes: 45 },
    },
  });
  const changed = proposal.changes.find((change) => change.kind === "update_item" && change.item.id === source.id);
  assert.ok(changed?.kind === "update_item");
  assert.equal(changed.item.estimateMinutes, 90);
  assert.deepEqual(changed.item.uncertaintyPolicy.reduction, { mode: "to_minimum", minimumMinutes: 45 });
});

test("an occurrence override updates the exact selected block and rejects mismatched context", () => {
  const recurring = item({ id: "series-item", kind: "routine", title: "Серия", recurrence: { frequency: "daily" } });
  const selected: PlannerBlock = {
    id: "series-2026-08-23",
    itemId: recurring.id,
    title: recurring.title,
    startAt: "2026-08-23T15:45:00.000Z",
    endAt: "2026-08-23T16:45:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
    occurrenceKey: `${recurring.id}:2026-08-23`,
  };
  const similar: PlannerBlock = {
    ...selected,
    id: "series-2026-08-25",
    startAt: "2026-08-25T15:45:00.000Z",
    endAt: "2026-08-25T16:45:00.000Z",
    occurrenceKey: `${recurring.id}:2026-08-25`,
  };
  const target = { itemId: recurring.id, blockId: selected.id, occurrenceKey: selected.occurrenceKey };
  const proposal = buildPlannerProposal({
    profile,
    items: [recurring],
    blocks: [selected, similar],
    now: new Date("2026-08-22T04:00:00.000Z"),
    operation: {
      kind: "edit_item",
      blockId: selected.id,
      scope: "occurrence",
      target,
      draft: { ...recurring, title: "Только 23 августа", notes: "Разовая заметка", priority: "critical" },
    },
  });
  const update = proposal.changes.find((change) => change.kind === "update_block" && change.block.id === selected.id);
  assert.ok(update?.kind === "update_block");
  assert.equal(update.block.occurrenceOverride?.title, "Только 23 августа");
  const applied = applyProposalChanges([recurring], [selected, similar], proposal);
  assert.equal(applied.blocks.find((block) => block.id === selected.id)?.title, "Только 23 августа");
  assert.equal(applied.blocks.find((block) => block.id === similar.id)?.title, "Серия");
  assert.equal(applied.items.find((candidate) => candidate.id === recurring.id)?.title, "Серия");

  assert.throws(() => buildPlannerProposal({
    profile,
    items: [recurring],
    blocks: [selected, similar],
    now: new Date("2026-08-22T04:00:00.000Z"),
    operation: {
      kind: "move_item",
      blockId: selected.id,
      scope: "occurrence",
      placement: { mode: "date", date: "2026-08-24" },
      target: { itemId: recurring.id, blockId: similar.id, occurrenceKey: similar.occurrenceKey },
    },
  }), /не совпадает|устарело/i);
});

test("future scope starts at the exact selected recurring occurrence", () => {
  const recurring = item({ id: "future-scope", kind: "routine", recurrence: { frequency: "daily" } });
  const first: PlannerBlock = { id: "future-first", itemId: recurring.id, title: recurring.title, startAt: "2026-08-23T10:00:00.000Z", endAt: "2026-08-23T11:00:00.000Z", status: "planned", source: "auto", fixed: false, occurrenceKey: `${recurring.id}:2026-08-23` };
  const selected: PlannerBlock = { ...first, id: "future-selected", startAt: "2026-08-25T10:00:00.000Z", endAt: "2026-08-25T11:00:00.000Z", occurrenceKey: `${recurring.id}:2026-08-25` };
  const proposal = buildPlannerProposal({
    profile,
    items: [recurring],
    blocks: [first, selected],
    now: new Date("2026-08-22T04:00:00.000Z"),
    operation: { kind: "cancel_item", blockId: selected.id, itemId: recurring.id, scope: "future", target: { itemId: recurring.id, blockId: selected.id, occurrenceKey: selected.occurrenceKey } },
  });
  assert.equal(proposal.changes.some((change) => change.kind === "update_block_status" && change.blockId === first.id), false);
  assert.equal(proposal.changes.some((change) => change.kind === "update_block_status" && change.blockId === selected.id && change.status === "cancelled"), true);
});

test("constructor edits an item through a typed operation", () => {
  const source = item({ id: "edit-typed" });
  const proposal = buildPlannerProposal({
    profile, items: [source], blocks: [], now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "edit_item", scope: "item", draft: { ...source, title: "Новое точное название" } },
  });
  assert.ok(proposal.changes.some((change) => change.kind === "update_item" && change.item.id === source.id && change.item.title === "Новое точное название"));
});

test("constructor applies bulk commitment and order changes together", () => {
  const first = item({ id: "bulk-first", planningRank: 10 });
  const second = item({ id: "bulk-second", planningRank: 20 });
  const proposal = buildPlannerProposal({
    profile, items: [first, second], blocks: [], now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "bulk_update_items", drafts: [{ ...first, commitmentLevel: "desired", planningRank: 2 }, { ...second, commitmentLevel: "must_not_skip", planningRank: 1 }] },
  });
  const updates = proposal.changes.flatMap((change) => change.kind === "update_item" ? [change.item] : []);
  assert.equal(updates.find((entry) => entry.id === first.id)?.commitmentLevel, "desired");
  assert.equal(updates.find((entry) => entry.id === second.id)?.planningRank, 1);
});

test("constructor cancels a selected occurrence without deleting its history", () => {
  const source = item({ id: "cancel-occurrence", kind: "routine", recurrence: { frequency: "daily" } });
  const block: PlannerBlock = { id: "cancel-block", itemId: source.id, title: source.title, startAt: "2026-08-20T10:00:00.000Z", endAt: "2026-08-20T11:00:00.000Z", status: "planned", source: "auto", fixed: false, occurrenceKey: `${source.id}:2026-08-20` };
  const proposal = buildPlannerProposal({
    profile, items: [source], blocks: [block], now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "cancel_item", blockId: block.id, itemId: source.id, scope: "occurrence" },
  });
  assert.ok(proposal.changes.some((change) => change.kind === "update_block_status" && change.blockId === block.id && change.status === "cancelled"));
  assert.ok(!proposal.changes.some((change) => change.kind === "remove_block" && change.blockId === block.id));
});

test("constructor changes a calendar block time through proposal changes", () => {
  const source = item({ id: "time-change" });
  const block: PlannerBlock = { id: "time-block", itemId: source.id, title: source.title, startAt: "2026-08-20T10:00:00.000Z", endAt: "2026-08-20T11:00:00.000Z", status: "planned", source: "auto", fixed: false };
  const proposal = buildPlannerProposal({
    profile, items: [source], blocks: [block], now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "change_block_time", blockId: block.id, scope: "occurrence", startAt: "2026-08-20T12:00:00.000Z", endAt: "2026-08-20T13:30:00.000Z" },
  });
  const move = proposal.changes.find((change) => change.kind === "move_block" && change.blockId === block.id);
  assert.ok(move?.kind === "move_block");
  assert.equal(move.toEndAt, "2026-08-20T13:30:00.000Z");
});

test("constructor occupies an interval with a new fixed event", () => {
  const proposal = buildPlannerProposal({
    profile, items: [], blocks: [], now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "occupy_interval", draft: { title: "Занятый интервал", date: "2026-08-20", start: "14:00", end: "15:00", estimateMinutes: 60 } },
  });
  const block = proposal.changes.find((change) => change.kind === "add_block" && change.block.title === "Занятый интервал");
  assert.ok(block?.kind === "add_block");
  assert.equal(block.block.fixed, true);
});

test("constructor replaces the current item atomically and preserves its completed history", () => {
  const current: PlannerBlock = {
    id: "current-replace",
    itemId: "task-1",
    title: "Старое дело",
    startAt: "2026-08-19T10:00:00.000Z",
    endAt: "2026-08-19T11:00:00.000Z",
    actualStartAt: "2026-08-19T10:00:00.000Z",
    status: "in_progress",
    source: "manual",
    fixed: false,
  };
  const now = new Date("2026-08-19T10:30:00.000Z");
  const proposal = buildPlannerProposal({
    profile,
    items: [item()],
    blocks: [current],
    now,
    operation: {
      kind: "replace_item",
      blockId: current.id,
      scope: "occurrence",
      replacement: { title: "Новое текущее дело", kind: "flexible_task", estimateMinutes: 60 },
      duration: { mode: "same" },
    },
  });
  const finished = proposal.changes.find((change) => change.kind === "update_block_status" && change.blockId === current.id);
  const replacement = proposal.changes.find((change) => change.kind === "add_block" && change.block.title === "Новое текущее дело");
  assert.ok(finished?.kind === "update_block_status");
  assert.equal(finished.status, "done");
  assert.equal(finished.actualEndAt, now.toISOString());
  assert.ok(replacement?.kind === "add_block");
  assert.equal(replacement.block.status, "in_progress");
  assert.equal(replacement.block.startAt, now.toISOString());
});

test("rebuild from 17:20 leaves the past and completed blocks unchanged", () => {
  const required = item({ id: "required-rebuild", title: "Обязательное", commitmentLevel: "required" });
  const optional = item({ id: "optional-rebuild", title: "Необязательное", commitmentLevel: "desired" });
  const past: PlannerBlock = { id: "past-rebuild", itemId: required.id, title: required.title, startAt: "2026-08-19T11:00:00.000Z", endAt: "2026-08-19T12:00:00.000Z", status: "planned", source: "manual", fixed: false };
  const done: PlannerBlock = { id: "done-rebuild", itemId: required.id, title: required.title, startAt: "2026-08-19T12:00:00.000Z", endAt: "2026-08-19T13:00:00.000Z", status: "done", source: "manual", fixed: false, actualStartAt: "2026-08-19T12:00:00.000Z", actualEndAt: "2026-08-19T12:45:00.000Z" };
  const future: PlannerBlock = { id: "future-rebuild", itemId: optional.id, title: optional.title, startAt: "2026-08-19T16:00:00.000Z", endAt: "2026-08-19T17:00:00.000Z", status: "planned", source: "auto", fixed: false };
  const fromAt = zonedPlannerDateTimeToUtc("2026-08-19", "17:20", profile.timezone);
  const proposal = buildPlannerProposal({
    profile,
    items: [required, optional],
    blocks: [past, done, future],
    now: new Date("2026-08-19T13:30:00.000Z"),
    operation: { kind: "rebuild_remaining", fromAt, decisions: [{ itemId: optional.id, disposition: "cancel" }] },
  });
  assert.ok(proposal.changes.some((change) => change.kind === "update_block_status" && change.blockId === future.id && change.status === "cancelled"));
  assert.ok(!proposal.changes.some((change) => "blockId" in change && (change.blockId === past.id || change.blockId === done.id)));
  assert.ok(!proposal.changes.some((change) => change.kind === "move_block" && new Date(change.fromStartAt) < new Date(fromAt)));
});

test("future recurrence scope moves the selected and later executions together", () => {
  const routine = item({ id: "routine-scope", kind: "routine", recurrence: { frequency: "daily" } });
  const first: PlannerBlock = { id: "routine-first", itemId: routine.id, title: routine.title, startAt: "2026-08-20T10:00:00.000Z", endAt: "2026-08-20T11:00:00.000Z", status: "planned", source: "auto", fixed: false };
  const second: PlannerBlock = { ...first, id: "routine-second", startAt: "2026-08-21T10:00:00.000Z", endAt: "2026-08-21T11:00:00.000Z" };
  const proposal = buildPlannerProposal({
    profile,
    items: [routine],
    blocks: [first, second],
    now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "move_item", blockId: first.id, scope: "future", placement: { mode: "exact", date: "2026-08-20", start: "14:00" } },
  });
  const moves = proposal.changes.flatMap((change) => change.kind === "move_block" && [first.id, second.id].includes(change.blockId) ? [change] : []);
  assert.equal(moves.length, 2);
  assert.equal(isoDurationMinutes(first.startAt, moves[0].toStartAt), 60);
  assert.equal(isoDurationMinutes(second.startAt, moves[1].toStartAt), 60);
});

test("range duration plans the likely volume and adds a non-blocking reserve to the maximum", () => {
  const creative = item({
    id: "creative-range",
    title: "Монтаж",
    estimateMinutes: 180,
    canSplit: true,
    minChunkMinutes: 30,
    uncertaintyPolicy: {
      outcomeMode: "deliverable",
      duration: { mode: "range", minMinutes: 120, likelyMinutes: 180, maxMinutes: 300, source: "user" },
      date: { mode: "any" },
      time: { mode: "any" },
      recurrence: { mode: "exact_days", period: "week", minOccurrences: 1, likelyOccurrences: 1, maxOccurrences: 1, allowedWeekdays: [] },
    },
  });
  const proposal = buildPlannerProposal({ profile: { ...profile, reserveRatio: 0 }, items: [creative], blocks: [], now: new Date("2026-08-19T04:00:00.000Z") });
  const added = proposal.changes.flatMap((change) => change.kind === "add_block" ? [change.block] : []);
  const work = added.filter((block) => !block.soft);
  const reserves = added.filter((block) => block.soft);
  assert.equal(work.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0), 180);
  assert.equal(reserves.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0), 120);
  assert.ok(reserves.every((block) => block.role === "uncertainty_reserve"));
  assert.equal(reserves[0]?.startAt, [...work].sort((left, right) => right.endAt.localeCompare(left.endAt))[0]?.endAt);
});

test("a two-to-four-times weekly routine places minimum, likely and optional occurrences once each", () => {
  const routine = item({
    id: "routine-count-range",
    kind: "routine",
    title: "Творческая практика",
    estimateMinutes: 30,
    recurrence: { frequency: "custom", weekdays: [1, 2, 3, 4, 5], durationMode: "per_occurrence" },
    uncertaintyPolicy: {
      outcomeMode: "time_budget",
      duration: { mode: "exact", minMinutes: 30, likelyMinutes: 30, maxMinutes: 30, source: "user" },
      date: { mode: "any" },
      time: { mode: "any" },
      recurrence: { mode: "count_range", period: "week", minOccurrences: 2, likelyOccurrences: 3, maxOccurrences: 4, allowedWeekdays: [1, 2, 3, 4, 5] },
    },
  });
  const proposal = buildPlannerProposal({ profile: { ...profile, reserveRatio: 0 }, items: [routine], blocks: [], now: new Date("2026-08-17T04:00:00.000Z") });
  const blocks = proposal.changes.flatMap((change) => change.kind === "add_block" && !change.block.soft ? [change.block] : []);
  assert.equal(blocks.length, 4);
  assert.equal(new Set(blocks.map((block) => formatDateInTimeZone(new Date(block.startAt), profile.timezone))).size, 4);
});

test("unknown recurring duration creates one calibration session and never repeats it automatically", () => {
  const unknown = item({
    id: "unknown-calibration",
    kind: "routine",
    title: "Новый вид работы",
    estimateMinutes: 30,
    recurrence: { frequency: "daily", durationMode: "per_occurrence" },
    uncertaintyPolicy: {
      outcomeMode: "time_budget",
      duration: { mode: "unknown", minMinutes: 30, likelyMinutes: 30, maxMinutes: 30, calibrationMinutes: 30, source: "user" },
      date: { mode: "any" },
      time: { mode: "any" },
      recurrence: { mode: "exact_days", period: "week", minOccurrences: 7, likelyOccurrences: 7, maxOccurrences: 7, allowedWeekdays: [1, 2, 3, 4, 5, 6, 7] },
    },
  });
  const first = buildPlannerProposal({ profile, items: [unknown], blocks: [], now: new Date("2026-08-19T04:00:00.000Z") });
  const calibration = first.changes.find((change) => change.kind === "add_block" && change.block.role === "calibration");
  assert.ok(calibration?.kind === "add_block");
  const second = buildPlannerProposal({ profile, items: [unknown], blocks: [calibration.block], now: new Date("2026-08-19T04:00:00.000Z") });
  assert.ok(!second.changes.some((change) => change.kind === "add_block" && change.block.itemId === unknown.id));
});

test("calibration progress counts actual completed minutes, ignores missed past blocks and schedules the remainder", () => {
  const base = item({ id: "cumulative-calibration", estimateMinutes: 180, canSplit: true, minChunkMinutes: 25 });
  const unknown = normalizePlannerItem({
    ...base,
    uncertaintyPolicy: {
      ...base.uncertaintyPolicy,
      duration: { mode: "unknown", minMinutes: 180, likelyMinutes: 180, maxMinutes: 180, calibrationMinutes: 180, source: "user" },
    },
  });
  const done: PlannerBlock = {
    id: "calibration-done",
    itemId: unknown.id,
    title: unknown.title,
    startAt: "2026-08-18T08:00:00.000Z",
    endAt: "2026-08-18T09:00:00.000Z",
    actualStartAt: "2026-08-18T08:05:00.000Z",
    actualEndAt: "2026-08-18T08:50:00.000Z",
    status: "done",
    source: "auto",
    fixed: false,
    role: "calibration",
  };
  const missedPast: PlannerBlock = { ...done, id: "calibration-missed", status: "planned", startAt: "2026-08-19T08:00:00.000Z", endAt: "2026-08-19T09:00:00.000Z", actualStartAt: undefined, actualEndAt: undefined };
  const skipped: PlannerBlock = { ...done, id: "calibration-skipped", status: "skipped", startAt: "2026-08-20T08:00:00.000Z", endAt: "2026-08-20T08:40:00.000Z", actualStartAt: undefined, actualEndAt: undefined };
  const future: PlannerBlock = { ...done, id: "calibration-future", status: "planned", startAt: "2026-08-24T08:00:00.000Z", endAt: "2026-08-24T08:30:00.000Z", actualStartAt: undefined, actualEndAt: undefined };
  const now = new Date("2026-08-23T04:00:00.000Z");
  const progress = plannerCalibrationProgress([unknown], [done, missedPast, skipped, future], now)[0];
  assert.deepEqual(progress, { itemId: unknown.id, targetMinutes: 180, completedMinutes: 45, plannedMinutes: 30, remainingMinutes: 105, complete: false });
  const planning = plannerItemPlanningStates([unknown], [done, missedPast, skipped, future], now)[0];
  assert.equal(planning.requestedMinutes, 180);
  assert.equal(planning.remainingMinutes, 105);

  const proposal = buildPlannerProposal({ profile, items: [unknown], blocks: [done, missedPast, skipped, future], now });
  const added = proposal.changes.flatMap((change) => change.kind === "add_block" && change.block.itemId === unknown.id && !change.block.soft
    ? [change.block]
    : []);
  assert.equal(added.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0), 105);
  assert.equal(new Set(added.map((block) => block.id)).size, added.length);
});

test("an unknown duration is re-estimated only after the full trial was actually completed", () => {
  const base = item({ id: "estimate-after-trial", estimateMinutes: 180 });
  const unknown = normalizePlannerItem({
    ...base,
    uncertaintyPolicy: {
      ...base.uncertaintyPolicy,
      duration: { mode: "unknown", minMinutes: 180, likelyMinutes: 180, maxMinutes: 180, calibrationMinutes: 180, source: "user" },
    },
  });
  const completed = [30, 30, 30, 90].map((minutes, index): PlannerBlock => ({
    id: `trial-sample-${index}`,
    itemId: unknown.id,
    title: unknown.title,
    startAt: `2026-08-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`,
    endAt: `2026-08-${String(10 + index).padStart(2, "0")}T09:30:00.000Z`,
    actualStartAt: `2026-08-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`,
    actualEndAt: addIsoMinutes(`2026-08-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`, minutes),
    status: "done",
    source: "auto",
    fixed: false,
    role: "calibration",
  }));
  assert.equal(plannerCompletionSuggestion(unknown, completed.slice(0, 3)), null);
  assert.equal(plannerCompletionRangeSuggestion(unknown, completed.slice(0, 3)), null);
  assert.equal(plannerCalibrationProgress([unknown], completed)[0].complete, true);
  assert.equal(plannerCompletionSuggestion(unknown, completed), 30);
});

test("schedule_item plans only the selected item even when its automatic flag is off", () => {
  const selected = item({ id: "schedule-selected", autoPlan: false, estimateMinutes: 60 });
  const other = item({ id: "schedule-other", estimateMinutes: 60 });
  const proposal = buildPlannerProposal({
    profile,
    items: [selected, other],
    blocks: [],
    now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "schedule_item", target: { itemId: selected.id } },
  });
  assert.equal(proposal.changes.some((change) => change.kind === "add_block" && change.block.itemId === selected.id), true);
  assert.equal(proposal.changes.some((change) => change.kind === "add_block" && change.block.itemId === other.id), false);
});

test("schedule_item occurrence scope does not fill a similar later occurrence", () => {
  const recurring = item({ id: "schedule-series", kind: "routine", estimateMinutes: 60, canSplit: true, minChunkMinutes: 15, recurrence: { frequency: "daily", durationMode: "per_occurrence" } });
  const first: PlannerBlock = { id: "schedule-series-first", itemId: recurring.id, title: recurring.title, startAt: "2026-08-20T08:00:00.000Z", endAt: "2026-08-20T08:30:00.000Z", status: "planned", source: "auto", fixed: false, occurrenceKey: `${recurring.id}:2026-08-20` };
  const later: PlannerBlock = { ...first, id: "schedule-series-later", startAt: "2026-08-21T08:00:00.000Z", endAt: "2026-08-21T08:30:00.000Z", occurrenceKey: `${recurring.id}:2026-08-21` };
  const proposal = buildPlannerProposal({
    profile,
    items: [recurring],
    blocks: [first, later],
    now: new Date("2026-08-19T04:00:00.000Z"),
    operation: { kind: "schedule_item", scope: "occurrence", target: { itemId: recurring.id, blockId: first.id, occurrenceKey: first.occurrenceKey } },
  });
  const added = proposal.changes.flatMap((change) => change.kind === "add_block" && change.block.itemId === recurring.id ? [change.block] : []);
  assert.ok(added.length > 0);
  assert.ok(added.every((block) => block.occurrenceKey?.startsWith(first.occurrenceKey!)));
});

test("lower-priority work inside a higher-priority soft reserve is marked tentative", () => {
  const important = item({ id: "important", commitmentLevel: "must_not_skip", planningRank: 0 });
  const optional = item({ id: "optional", commitmentLevel: "if_time", planningRank: 0 });
  const annotated = annotateTentativeBlocks([important, optional], [{
    id: "reserve", itemId: important.id, title: important.title, startAt: "2026-08-19T10:00:00.000Z", endAt: "2026-08-19T12:00:00.000Z",
    status: "planned", source: "auto", fixed: false, role: "uncertainty_reserve", soft: true,
  }, {
    id: "optional-block", itemId: optional.id, title: optional.title, startAt: "2026-08-19T11:00:00.000Z", endAt: "2026-08-19T12:00:00.000Z",
    status: "planned", source: "auto", fixed: false, role: "work", soft: false,
  }]);
  const tentative = annotated.find((block) => block.id === "optional-block");
  assert.equal(tentative?.tentative, true);
  assert.deepEqual(tentative?.tentativeReason, {
    reserveBlockId: "reserve",
    reserveItemId: important.id,
    reserveTitle: important.title,
    latestAt: "2026-08-19T12:00:00.000Z",
  });
});

test("hard deadline analysis reports separate likely and maximum risks", () => {
  const deadline = item({
    id: "deadline-range",
    title: "Сдать монтаж",
    estimateMinutes: 60,
    deadlineType: "hard",
    deadlineAt: "2026-08-19T07:00:00.000Z",
    uncertaintyPolicy: {
      outcomeMode: "deliverable",
      duration: { mode: "range", minMinutes: 45, likelyMinutes: 60, maxMinutes: 240, source: "user" },
      date: { mode: "any" },
      time: { mode: "any" },
      recurrence: { mode: "exact_days", period: "week", minOccurrences: 1, likelyOccurrences: 1, maxOccurrences: 1, allowedWeekdays: [] },
    },
  });
  const deadlineProfile = { ...profile, availability: { ...profile.availability, "3": [{ start: "08:00", end: "10:00" }] } };
  const analysis = analyzePlannerDeadlines([deadline], [], deadlineProfile, new Date("2026-08-19T04:00:00.000Z"))[0];
  assert.notEqual(analysis.likelyScenario?.risk, "impossible");
  assert.equal(analysis.maximumScenario?.risk, "impossible");
});

test("three comparable completions suggest a range but never apply it automatically", () => {
  const learned = item({ id: "learned-range", estimateMinutes: 60 });
  const samples: PlannerBlock[] = [45, 70, 95].map((minutes, index) => ({
    id: `sample-${index}`, itemId: learned.id, title: learned.title,
    startAt: `2026-08-${16 + index}T10:00:00.000Z`, endAt: `2026-08-${16 + index}T11:00:00.000Z`,
    actualStartAt: `2026-08-${16 + index}T10:00:00.000Z`, actualEndAt: addIsoMinutes(`2026-08-${16 + index}T10:00:00.000Z`, minutes),
    status: "done", source: "auto", fixed: false,
  }));
  const suggestion = plannerCompletionRangeSuggestion(learned, samples);
  assert.ok(suggestion);
  assert.equal(learned.uncertaintyPolicy.duration.mode, "exact");
});

test("remainder transfer is atomic and a fifty-percent choice keeps the rest queued", () => {
  const now = new Date("2026-08-21T19:07:00.000Z");
  const project = item({ id: "editing", title: "Монтаж проекта", estimateMinutes: 180, canSplit: true, minChunkMinutes: 15 });
  const current: PlannerBlock = {
    id: "editing-current",
    itemId: project.id,
    title: project.title,
    startAt: "2026-08-21T18:00:00.000Z",
    endAt: "2026-08-21T21:00:00.000Z",
    actualStartAt: "2026-08-21T18:00:00.000Z",
    status: "in_progress",
    source: "auto",
    fixed: false,
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [project],
    blocks: [current],
    now,
    remainderTransfer: {
      blockId: current.id,
      amount: { mode: "percent", percent: 50 },
      distribution: { mode: "asap" },
    },
  });
  assert.equal(current.status, "in_progress", "building a preview must not mutate the current block");
  assert.equal(proposal.remainderTransfer?.sourceRemainingMinutes, 113);
  assert.equal(proposal.remainderTransfer?.requestedMinutes, 60);
  assert.equal(proposal.impact?.scheduledMinutes, 60);
  assert.equal(proposal.impact?.queuedMinutes, 53);
  assert.ok(proposal.changes.some((change) => change.kind === "update_block_status" && change.blockId === current.id));
  const applied = applyProposalChanges([project], [current], proposal);
  assert.equal(applied.blocks.find((block) => block.id === current.id)?.status, "done");
});

test("weekly remainder transfer starts tomorrow and spreads work across remaining days", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const project = item({ id: "weekly-editing", title: "Монтаж", estimateMinutes: 180, canSplit: true, minChunkMinutes: 30 });
  const source: PlannerBlock = {
    id: "weekly-source",
    itemId: project.id,
    title: project.title,
    startAt: "2026-08-21T10:00:00.000Z",
    endAt: "2026-08-21T13:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const proposal = buildPlannerProposal({
    profile: { ...profile, reserveRatio: 0 },
    items: [project],
    blocks: [source],
    now,
    remainderTransfer: {
      blockId: source.id,
      amount: { mode: "percent", percent: 100 },
      distribution: { mode: "spread_week" },
    },
  });
  const placements = proposal.impact?.placements ?? [];
  const dates = new Set(placements.map((placement) => formatDateInTimeZone(new Date(placement.startAt), profile.timezone)));
  assert.equal(proposal.impact?.scheduledMinutes, 180);
  assert.equal(dates.size, 2);
  assert.ok([...dates].every((date) => date > "2026-08-21"));
  assert.ok(!proposal.changes.some((change) => change.kind === "remove_block" && change.blockId !== source.id));
});

test("remainder transfer moves a less important flexible block before shortening it", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const project = item({
    id: "important-transfer",
    title: "Важный монтаж",
    estimateMinutes: 120,
    minChunkMinutes: 120,
    commitmentLevel: "required",
    planningRank: 0,
  });
  const optional = item({
    id: "movable-hobby",
    title: "Хобби",
    estimateMinutes: 60,
    minChunkMinutes: 30,
    commitmentLevel: "desired",
    planningRank: 10,
  });
  const source: PlannerBlock = {
    id: "important-source",
    itemId: project.id,
    title: project.title,
    startAt: "2026-08-21T10:00:00.000Z",
    endAt: "2026-08-21T12:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const hobbyBlock: PlannerBlock = {
    id: "hobby-block",
    itemId: optional.id,
    title: optional.title,
    startAt: "2026-08-22T07:00:00.000Z",
    endAt: "2026-08-22T08:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const availability = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
    String(index + 1),
    index === 5 ? [{ start: "09:00", end: "12:30" }] : [],
  ]));
  const proposal = buildPlannerProposal({
    profile: {
      ...profile,
      availability,
      reserveRatio: 0,
      sleepSchedule: {
        mode: "fixed",
        weekdays: { bedtime: "00:00", durationMinutes: 360 },
        weekends: { bedtime: "00:00", durationMinutes: 360 },
      },
    },
    items: [project, optional],
    blocks: [source, hobbyBlock],
    now,
    remainderTransfer: {
      blockId: source.id,
      amount: { mode: "percent", percent: 100 },
      distribution: { mode: "date", date: "2026-08-22" },
    },
  });
  assert.equal(proposal.impact?.scheduledMinutes, 120);
  assert.equal(proposal.impact?.moves.length, 1);
  assert.equal(proposal.impact?.moves[0]?.title, optional.title);
  assert.equal(proposal.impact?.reductions.length, 0);
  const moved = proposal.changes.find((change) => change.kind === "move_block" && change.blockId === hobbyBlock.id);
  assert.ok(moved?.kind === "move_block");
  assert.equal(isoDurationMinutes(moved.toStartAt, moved.toEndAt), 60);
});

test("queued remainder is not silently recreated by a later full autoplan", () => {
  const project = item({ id: "queued-project", title: "Отложенный монтаж", estimateMinutes: 90, canSplit: true });
  const deferred = {
    id: "queued-remainder",
    itemId: project.id,
    sourceBlockId: "old-source",
    title: project.title,
    totalMinutes: 90,
    pendingMinutes: 90,
    scheduledMinutes: 0,
    createdAt: "2026-08-19T10:00:00.000Z",
    expiresAt: "2026-08-26T10:00:00.000Z",
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [project],
    blocks: [],
    deferredRemainders: [deferred],
    now: new Date("2026-08-21T10:00:00.000Z"),
  });
  assert.ok(!proposal.changes.some((change) => change.kind === "add_block" && change.block.itemId === project.id));
});

test("expired remainder leaves active planning and is counted once in deadline volume", () => {
  const deadline = item({
    id: "expired-project",
    title: "Истёкший проект",
    estimateMinutes: 60,
    deadlineType: "hard",
    deadlineAt: "2026-08-23T18:00:00.000Z",
  });
  const expired = {
    id: "expired-remainder",
    itemId: deadline.id,
    sourceBlockId: "expired-source",
    title: deadline.title,
    totalMinutes: 60,
    pendingMinutes: 60,
    scheduledMinutes: 0,
    createdAt: "2026-08-13T10:00:00.000Z",
    expiresAt: "2026-08-20T10:00:00.000Z",
  };
  const analysis = analyzePlannerDeadlines(
    [deadline],
    [],
    profile,
    new Date("2026-08-21T10:00:00.000Z"),
    [expired]
  )[0];
  assert.equal(analysis.remainingMinutes, 0);
  const proposal = buildPlannerProposal({
    profile,
    items: [deadline],
    blocks: [],
    deferredRemainders: [expired],
    now: new Date("2026-08-21T10:00:00.000Z"),
  });
  assert.ok(!proposal.changes.some((change) => change.kind === "add_block" && change.block.itemId === deadline.id));
});

test("a queued hard-deadline remainder expires at the earlier deadline", () => {
  const deadlineAt = "2026-08-23T18:00:00.000Z";
  const project = item({
    id: "deadline-transfer",
    title: "Срочный монтаж",
    estimateMinutes: 60,
    deadlineType: "hard",
    deadlineAt,
    commitmentLevel: "must_not_skip",
  });
  const source: PlannerBlock = {
    id: "deadline-source",
    itemId: project.id,
    title: project.title,
    startAt: "2026-08-21T10:00:00.000Z",
    endAt: "2026-08-21T11:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const noAvailability = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index + 1), []]));
  const proposal = buildPlannerProposal({
    profile: { ...profile, availability: noAvailability },
    items: [project],
    blocks: [source],
    now: new Date("2026-08-21T10:00:00.000Z"),
    remainderTransfer: {
      blockId: source.id,
      amount: { mode: "percent", percent: 100 },
      distribution: { mode: "asap" },
    },
  });
  assert.equal(proposal.impact?.scheduledMinutes, 0);
  assert.equal(proposal.impact?.queueExpiresAt, deadlineAt);
});

test("a sixty-minute live extension previews and moves later flexible work atomically", () => {
  const currentItem = item({ id: "live-editing", title: "Монтаж проекта", estimateMinutes: 60, commitmentLevel: "required", planningRank: 0 });
  const laterItem = item({ id: "later-music", title: "Музыка", estimateMinutes: 60, commitmentLevel: "desired", planningRank: 10 });
  const current: PlannerBlock = {
    id: "live-editing-block",
    itemId: currentItem.id,
    title: currentItem.title,
    startAt: "2026-08-21T10:00:00.000Z",
    endAt: "2026-08-21T11:00:00.000Z",
    actualStartAt: "2026-08-21T10:00:00.000Z",
    status: "in_progress",
    source: "auto",
    fixed: false,
  };
  const later: PlannerBlock = {
    id: "later-music-block",
    itemId: laterItem.id,
    title: laterItem.title,
    startAt: "2026-08-21T11:00:00.000Z",
    endAt: "2026-08-21T12:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const proposal = buildPlannerProposal({
    profile: { ...profile, reserveRatio: 0 },
    items: [currentItem, laterItem],
    blocks: [current, later],
    now: new Date("2026-08-21T10:30:00.000Z"),
    trigger: "plans_changed",
    blockExtension: { blockId: current.id, minutes: 60 },
  });
  assert.equal(current.endAt, "2026-08-21T11:00:00.000Z", "preview must not mutate the live block");
  assert.equal(proposal.conflicts.length, 0);
  assert.equal(proposal.blockExtension?.minutes, 60);
  const extension = proposal.changes.find((change) => change.kind === "move_block" && change.blockId === current.id);
  assert.ok(extension?.kind === "move_block");
  assert.equal(extension.toEndAt, "2026-08-21T12:00:00.000Z");
  const laterMove = proposal.changes.find((change) => change.kind === "move_block" && change.blockId === later.id);
  assert.ok(laterMove?.kind === "move_block");
  assert.ok(new Date(laterMove.toStartAt) >= new Date(extension.toEndAt));
  const applied = applyProposalChanges([currentItem, laterItem], [current, later], proposal);
  assert.equal(applied.blocks.find((block) => block.id === current.id)?.endAt, extension.toEndAt);
  assert.equal(applied.blocks.find((block) => block.id === later.id)?.startAt, laterMove.toStartAt);
});

test("the all-items editor updates a saved item by id instead of duplicating it", () => {
  const existing = item({ id: "saved-item", title: "Старое название" });
  const proposal = buildPlannerProposal({
    profile,
    items: [existing],
    blocks: [],
    now: new Date("2026-08-22T08:00:00.000Z"),
    trigger: "assistant_update",
    draft: { ...existing, id: existing.id, title: "Новое название" },
  });

  assert.ok(proposal.changes.some((change) => change.kind === "update_item"
    && change.item.id === existing.id
    && change.item.title === "Новое название"));
  assert.ok(!proposal.changes.some((change) => change.kind === "add_item" && change.item.id === existing.id));
  const applied = applyProposalChanges([existing], [], proposal);
  assert.equal(applied.items.length, 1);
  assert.equal(applied.items[0].title, "Новое название");
});

test("removing a saved card archives the item and removes only its future planned blocks", () => {
  const existing = item({ id: "removed-item", title: "Больше не нужно" });
  const pastDone: PlannerBlock = {
    id: "past-done",
    itemId: existing.id,
    title: existing.title,
    startAt: "2026-08-21T08:00:00.000Z",
    endAt: "2026-08-21T09:00:00.000Z",
    status: "done",
    source: "auto",
    fixed: false,
  };
  const future: PlannerBlock = {
    id: "future-planned",
    itemId: existing.id,
    title: existing.title,
    startAt: "2026-08-23T08:00:00.000Z",
    endAt: "2026-08-23T09:00:00.000Z",
    status: "planned",
    source: "auto",
    fixed: false,
  };
  const proposal = buildPlannerProposal({
    profile,
    items: [existing],
    blocks: [pastDone, future],
    now: new Date("2026-08-22T08:00:00.000Z"),
    trigger: "assistant_update",
    removedItemIds: [existing.id],
  });

  assert.deepEqual(proposal.removedItemIds, [existing.id]);
  const applied = applyProposalChanges([existing], [pastDone, future], proposal);
  assert.equal(applied.items[0].status, "archived");
  assert.ok(applied.blocks.some((block) => block.id === pastDone.id));
  assert.ok(!applied.blocks.some((block) => block.id === future.id));
});
