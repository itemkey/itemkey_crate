import assert from "node:assert/strict";
import test from "node:test";

import { commitmentToPlannerDraft, normalizeStructuredCommitment, plannerCommitmentDuration } from "./commitments.ts";

test("structured commitment becomes a fixed recurring event with protected travel", () => {
  const draft = commitmentToPlannerDraft(normalizeStructuredCommitment({
    id: "art-class",
    title: "Вечерние курсы",
    category: "education",
    weekdays: [4],
    startTime: "17:00",
    endTime: "19:00",
    travel: {
      enabled: true,
      originLabel: "Дом",
      originAddress: "Минск, улица А",
      destinationLabel: "Курсы",
      destinationAddress: "Минск, улица Б",
      mode: "transit",
      direction: "one_way",
      durationMinutes: 35,
      bufferMinutes: 10,
      estimatedByNavigator: true,
    },
  }), "ru");

  assert.equal(draft.kind, "fixed_event");
  assert.equal(draft.estimateMinutes, 120);
  assert.equal(draft.bufferBeforeMinutes, 45);
  assert.equal(draft.bufferAfterMinutes, 0);
  assert.equal(draft.location, "Минск, улица Б");
  assert.deepEqual(draft.recurrence, {
    frequency: "weekly",
    weekdays: [4],
    startTime: "17:00",
    endTime: "19:00",
  });
  assert.match(draft.notes ?? "", /Дом.*Курсы.*общественный транспорт.*35 мин/);
});

test("commitment duration supports an overnight event", () => {
  assert.equal(plannerCommitmentDuration("22:30", "00:30"), 120);
});

test("flexible recurring commitment keeps its duration, hard window and return trip", () => {
  const draft = commitmentToPlannerDraft(normalizeStructuredCommitment({
    id: "free-school",
    title: "Свободное посещение",
    category: "education",
    occurrenceMode: "recurring",
    weekdays: [5],
    timeMode: "flexible",
    startTime: "",
    endTime: "",
    durationMinutes: 180,
    allowedStartTime: "10:00",
    allowedEndTime: "18:00",
    priority: "normal",
    deadlineType: "none",
    canSplit: false,
    minChunkMinutes: 25,
    travel: {
      enabled: true,
      originLabel: "Дом",
      originAddress: "Минск, улица А",
      destinationAddress: "Минск, улица Б",
      mode: "transit",
      direction: "round_trip",
      durationMinutes: 35,
      bufferMinutes: 10,
    },
  }), "ru");

  assert.equal(draft.kind, "routine");
  assert.equal(draft.estimateMinutes, 180);
  assert.deepEqual(draft.allowedWindows, [{ start: "10:00", end: "18:00" }]);
  assert.equal(draft.bufferBeforeMinutes, 45);
  assert.equal(draft.bufferAfterMinutes, 35);
  assert.deepEqual(draft.recurrence, { frequency: "weekly", weekdays: [5], durationMode: "per_occurrence" });
  assert.match(draft.notes ?? "", /туда и обратно/);
});

test("recurring commitment can keep one total duration across selected weekdays", () => {
  const draft = commitmentToPlannerDraft(normalizeStructuredCommitment({
    id: "weekly-reading",
    title: "Чтение",
    occurrenceMode: "recurring",
    weekdays: [1, 3, 5],
    timeMode: "flexible",
    startTime: "",
    endTime: "",
    durationMinutes: 180,
    durationMode: "per_cycle",
  }), "ru");

  assert.equal(draft.estimateMinutes, 180);
  assert.deepEqual(draft.recurrence, {
    frequency: "custom",
    weekdays: [1, 3, 5],
    durationMode: "per_cycle",
  });
});
