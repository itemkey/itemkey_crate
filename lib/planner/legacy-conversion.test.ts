import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultScheduleBlock,
  createDefaultSchedulePayload,
  parseMessageScheduleContent,
  serializeMessageScheduleContent,
  type SchedulePayload,
} from "../schedules.ts";
import { convertLegacyScheduleSource, parseLegacyContinuousSchedules } from "./legacy-conversion.ts";
import { createDefaultPlannerProfile } from "./types.ts";

const profile = { ...createDefaultPlannerProfile("Europe/Minsk"), onboardingCompleted: true };

function legacyPayload(): SchedulePayload {
  return {
    ...createDefaultSchedulePayload("2026-08-19"),
    taskBase: [{
      id: "task-old",
      title: "Старая задача",
      type: "flexible",
      durationMinutes: 45,
      priority: "high",
      canSplit: true,
    }],
    events: [{
      id: "event-old",
      taskId: "task-old",
      title: "Старая задача",
      date: "2026-08-19",
      start: "10:00",
      end: "10:45",
      type: "flexible",
      status: "done",
    }],
  };
}

test("message schedule keeps task/block links and statuses during conversion", () => {
  const original = legacyPayload();
  const serialized = serializeMessageScheduleContent(original);
  const parsed = parseMessageScheduleContent(serialized);
  assert.ok(parsed);
  const converted = convertLegacyScheduleSource({ sourceKey: "message:one", title: "Message plan", payload: parsed }, profile);
  assert.equal(converted.items.length, 1);
  assert.equal(converted.blocks.length, 1);
  assert.equal(converted.blocks[0].itemId, converted.items[0].id);
  assert.equal(converted.blocks[0].status, "done");
  assert.equal(converted.items[0].status, "completed");
});

test("continuous schedule format is found and converted without changing its source", () => {
  const block = { ...createDefaultScheduleBlock("schedule-old", "Старое расписание", "2026-08-19"), ...legacyPayload() };
  const content = JSON.stringify({ kind: "itemkey-continuous-v1", schedules: [block] });
  const before = JSON.parse(content) as unknown;
  const parsed = parseLegacyContinuousSchedules(content);
  assert.equal(parsed.length, 1);
  const converted = convertLegacyScheduleSource({ sourceKey: "continuous:category:schedule-old", title: parsed[0].title, payload: parsed[0].payload }, profile);
  assert.equal(converted.blocks[0].source, "migrated");
  assert.deepEqual(JSON.parse(content), before);
});

test("legacy ids are deterministic per source and isolated between conflicting sources", () => {
  const payload = legacyPayload();
  const first = convertLegacyScheduleSource({ sourceKey: "message:first", title: "A", payload }, profile);
  const repeated = convertLegacyScheduleSource({ sourceKey: "message:first", title: "A", payload }, profile);
  const conflict = convertLegacyScheduleSource({ sourceKey: "message:second", title: "B", payload }, profile);
  assert.deepEqual(first.items.map((item) => item.id), repeated.items.map((item) => item.id));
  assert.deepEqual(first.blocks.map((block) => block.id), repeated.blocks.map((block) => block.id));
  assert.notEqual(first.items[0].id, conflict.items[0].id);
  assert.notEqual(first.blocks[0].id, conflict.blocks[0].id);
});
