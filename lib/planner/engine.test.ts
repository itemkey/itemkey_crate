import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProposalChanges,
  analyzePlannerDeadlines,
  buildPlannerProposal,
  normalizePlannerItem,
  parsePlannerCommand,
  parsePlannerCommands,
  parseSleepCommand,
  plannerCompletionSuggestion,
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
import { formatDateInTimeZone, formatTimeInTimeZone, plannerTimeToMinutes, zonedPlannerDateTimeToUtc } from "./time.ts";

const profile = {
  ...createDefaultPlannerProfile("Europe/Minsk"),
  onboardingCompleted: true,
  revision: 4,
};

function item(overrides: Partial<PlannerItem> = {}): PlannerItem {
  return {
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
    preferredWindows: [],
    avoidedWindows: [],
    canSplit: false,
    minChunkMinutes: 25,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    autoPlan: true,
    status: "active",
    ...overrides,
  };
}

test("quick command extracts date, time and fixed event", () => {
  const draft = parsePlannerCommand("сегодня позвали гулять с 18 до 20", profile, new Date("2026-08-19T10:00:00Z"));
  assert.equal(draft.date, "2026-08-19");
  assert.equal(draft.start, "18:00");
  assert.equal(draft.end, "20:00");
  assert.equal(draft.estimateMinutes, 120);
  assert.equal(draft.kind, "fixed_event");
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
  assert.ok(durations.length >= 2);
  assert.ok(durations.every((duration) => duration >= 45));
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
  const applied = applyProposalChanges([impossible], [], proposal);
  assert.match(applied.items[0].unplacedReason ?? "", /резерв/i);
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

test("multiline RU and EN parsing marks only genuinely ambiguous rows", () => {
  const parsed = parsePlannerCommands(
    "Каждый понедельник спорт с 19 до 20\nSubmit report tomorrow 2 hours urgent\nПрочитать книгу",
    profile,
    new Date("2026-08-19T10:00:00.000Z")
  );
  assert.equal(parsed.drafts.length, 3);
  assert.equal(parsed.drafts[0].kind, "fixed_event");
  assert.deepEqual(parsed.drafts[0].recurrence?.weekdays, [1]);
  assert.equal(parsed.drafts[1].priority, "critical");
  assert.equal(parsed.drafts[1].estimateMinutes, 120);
  assert.equal(formatDateInTimeZone(new Date(parsed.drafts[1].deadlineAt!), profile.timezone), "2026-08-20");
  assert.ok(parsed.ambiguities.some((entry) => entry.index === 2 && entry.field === "duration"));
  assert.ok(!parsed.ambiguities.some((entry) => entry.index === 0));
});

test("sleep phrases parse deterministically and require missing fields", () => {
  assert.deepEqual(parseSleepCommand("Ложусь спать в 23:30, сплю 8 часов"), {
    mode: "fixed",
    bedtime: "23:30",
    durationMinutes: 480,
    durationRange: undefined,
    exactDurationsMinutes: undefined,
    planningFocus: undefined,
    sleepinessLevel: undefined,
    wakeDayPart: undefined,
    changeKind: undefined,
    estimatedBedtimeRange: undefined,
    ambiguities: [],
  });
  assert.ok(parseSleepCommand("обычный сон").ambiguities.length >= 2);
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
  assert.equal(proposal.wakeAnchorDecision?.candidatesEvaluated, 23);
  assert.deepEqual(proposal, buildPlannerProposal(input));
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

test("automatic wake uses workload fit while keeping a single stable anchor", () => {
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
  assert.equal(proposal.wakeAnchorDecision?.wakeTime, "06:45");
  assert.equal(proposal.wakeAnchorDecision?.reason.code, "plan_fit");
  assert.equal(proposal.wakeAnchorDecision?.reason.relatedTitle, "Утренняя подача");
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

test("adaptive RU and EN sleep phrases expose ranges, day parts and tentative changes", () => {
  const adaptive = parseSleepCommand("Графика сна нет, обычно хватает 7–9 часов, хочу вставать утром");
  assert.equal(adaptive.mode, "adaptive");
  assert.deepEqual(adaptive.durationRange, { minMinutes: 420, maxMinutes: 540 });
  assert.equal(adaptive.wakeDayPart, "morning");
  assert.equal(adaptive.ambiguities.length, 0);

  const english = parseSleepCommand("No regular sleep schedule, 7 to 9 hours, early morning");
  assert.equal(english.mode, "adaptive");
  assert.equal(english.wakeDayPart, "early_morning");

  const automaticRu = parseSleepCommand("Графика сна нет, хватает 7–9 часов, без разницы когда вставать");
  assert.equal(automaticRu.mode, "adaptive");
  assert.equal(automaticRu.wakeDayPart, "auto");
  assert.equal(automaticRu.ambiguities.length, 0);

  const automaticEn = parseSleepCommand("No sleep schedule, 7 to 9 hours, choose for me");
  assert.equal(automaticEn.wakeDayPart, "auto");
  assert.equal(automaticEn.ambiguities.length, 0);

  const late = parseSleepCommand("Сегодня лягу примерно с 3 до 6");
  assert.equal(late.changeKind, "later_unknown");
  assert.deepEqual(late.estimatedBedtimeRange, { start: "03:00", end: "06:00" });
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

test("deadline buffer, milestones, risk and parser use deterministic deadline rules", () => {
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
  const parsedTask = parsePlannerCommand("жёсткий дедлайн завтра к 18:00, отчёт 2 часа", profile, new Date("2026-08-19T04:00:00.000Z"));
  assert.equal(parsedTask.deadlineType, "hard");
  assert.equal(formatTimeInTimeZone(new Date(parsedTask.deadlineAt!), profile.timezone), "18:00");
  const parsedSleep = parseSleepCommand("Мне подходит 7 или 9 часов, работа важнее сна");
  assert.deepEqual(parsedSleep.exactDurationsMinutes, [420, 540]);
  assert.equal(parsedSleep.planningFocus, "work");
  assert.equal(parseSleepCommand("Еле держусь и засыпаю на ходу").sleepinessLevel, 4);
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
