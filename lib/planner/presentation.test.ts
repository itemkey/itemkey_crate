import assert from "node:assert/strict";
import test from "node:test";

import { groupPlannerPlacementsByDay, layoutCalendarEntries } from "./presentation.ts";

test("calendar layout separates real and visual overlaps while reserves stay behind", () => {
  const layout = layoutCalendarEntries([
    { id: "short", startMinute: 600, durationMinutes: 10 },
    { id: "next", startMinute: 615, durationMinutes: 30 },
    { id: "later", startMinute: 645, durationMinutes: 30 },
    { id: "reserve", startMinute: 605, durationMinutes: 90, soft: true },
  ], 24);
  const byId = new Map(layout.map((entry) => [entry.id, entry]));

  assert.equal(byId.get("short")?.laneCount, 2, "the short block's readable height overlaps the next block");
  assert.equal(byId.get("next")?.laneCount, 2);
  assert.notEqual(byId.get("short")?.lane, byId.get("next")?.lane);
  assert.equal(byId.get("later")?.laneCount, 1, "touching real intervals are not overlaps");
  assert.deepEqual({ lane: byId.get("reserve")?.lane, laneCount: byId.get("reserve")?.laneCount }, { lane: 0, laneCount: 1 });
});

test("proposal placements are grouped by day and sorted chronologically", () => {
  const grouped = groupPlannerPlacementsByDay([
    { itemId: "later", title: "Позже", startAt: "2026-09-02T12:00:00.000Z", endAt: "2026-09-02T13:00:00.000Z" },
    { itemId: "same", title: "Художка", startAt: "2026-08-28T13:45:00.000Z", endAt: "2026-08-28T14:15:00.000Z" },
    { itemId: "earlier", title: "Кино", startAt: "2026-08-27T19:30:00.000Z", endAt: "2026-08-27T21:30:00.000Z" },
    { itemId: "same", title: "Художка", startAt: "2026-08-28T08:30:00.000Z", endAt: "2026-08-28T11:00:00.000Z" },
  ], "Europe/Minsk");

  assert.deepEqual(grouped.map((day) => day.date), ["2026-08-27", "2026-08-28", "2026-09-02"]);
  assert.equal(grouped[1].items.length, 1);
  assert.deepEqual(grouped[1].items[0].entries.map((entry) => entry.startAt), [
    "2026-08-28T08:30:00.000Z",
    "2026-08-28T13:45:00.000Z",
  ]);
});
