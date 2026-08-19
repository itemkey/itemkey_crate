import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProposalChanges,
  buildPlannerProposal,
  parsePlannerCommand,
  parsePlannerCommands,
  parseSleepCommand,
  plannerCompletionSuggestion,
} from "./engine.ts";
import { createPlannerSleepEvent } from "./sleep.ts";
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
    new Date(added.block.endAt) <= new Date(sleepEvent.actualStartAt)
      || new Date(added.block.startAt) >= new Date(sleepEvent.projectedEndAt)
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
    (new Date(event.projectedEndAt).getTime() - new Date(event.actualStartAt).getTime()) / 60_000,
    profile.sleepSchedule.weekdays.durationMinutes
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
    bedtime: "23:30",
    durationMinutes: 480,
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
