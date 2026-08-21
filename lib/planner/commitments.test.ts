import assert from "node:assert/strict";
import test from "node:test";

import { commitmentToPlannerDraft, plannerCommitmentDuration } from "./commitments.ts";

test("structured commitment becomes a fixed recurring event with protected travel", () => {
  const draft = commitmentToPlannerDraft({
    id: "art-class",
    title: "Художка",
    category: "education",
    weekdays: [4],
    startTime: "17:00",
    endTime: "19:00",
    travel: {
      enabled: true,
      originLabel: "Дом",
      originAddress: "Минск, улица А",
      destinationAddress: "Минск, улица Б",
      mode: "transit",
      durationMinutes: 35,
      bufferMinutes: 10,
      estimatedByNavigator: true,
    },
  }, "ru");

  assert.equal(draft.kind, "fixed_event");
  assert.equal(draft.estimateMinutes, 120);
  assert.equal(draft.bufferBeforeMinutes, 45);
  assert.equal(draft.location, "Минск, улица Б");
  assert.deepEqual(draft.recurrence, {
    frequency: "weekly",
    weekdays: [4],
    startTime: "17:00",
    endTime: "19:00",
  });
  assert.match(draft.notes ?? "", /Дом.*общественный транспорт.*35 мин/);
});

test("commitment duration supports an overnight event", () => {
  assert.equal(plannerCommitmentDuration("22:30", "00:30"), 120);
});
