import assert from "node:assert/strict";
import test from "node:test";

import { commitmentToPlannerDraft, normalizeStructuredCommitment, plannerCommitmentDuration, plannerDraftToCommitment } from "./commitments.ts";

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

test("spare-time commitment stores a protected minimum and a weekly maximum", () => {
  const draft = commitmentToPlannerDraft(normalizeStructuredCommitment({
    id: "model-building",
    title: "Собирать модель",
    occurrenceMode: "spare_time",
    weekdays: [2, 4, 6],
    timeMode: "flexible",
    startTime: "",
    endTime: "",
    durationType: "range",
    durationMode: "per_cycle",
    minDurationMinutes: 30,
    maxDurationMinutes: 240,
    canSplit: true,
  }), "ru");

  assert.equal(draft.kind, "routine");
  assert.equal(draft.estimateMinutes, 240);
  assert.deepEqual(draft.recurrence, {
    frequency: "custom",
    weekdays: [2, 4, 6],
    durationMode: "per_cycle",
    schedulingMode: "spare_time",
    minimumMinutes: 30,
  });
  assert.deepEqual(draft.uncertaintyPolicy?.duration, {
    mode: "range",
    minMinutes: 30,
    likelyMinutes: 240,
    maxMinutes: 240,
    tolerancePercent: undefined,
    calibrationMinutes: undefined,
    source: "user",
  });
});

test("approximate duration and travel remain independent of occurrence mode", () => {
  const draft = commitmentToPlannerDraft(normalizeStructuredCommitment({
    id: "approx-editing",
    title: "Монтаж",
    occurrenceMode: "once",
    timeMode: "flexible",
    durationType: "approximate",
    durationMinutes: 180,
    tolerancePercent: 30,
    minDurationMinutes: 125,
    maxDurationMinutes: 250,
    commitmentLevel: "must_not_skip",
    travel: {
      enabled: true,
      originAddress: "Дом",
      destinationAddress: "Студия",
      mode: "transit",
      direction: "round_trip",
      durationMinutes: 40,
      estimateMode: "range",
      minDurationMinutes: 30,
      maxDurationMinutes: 65,
      punctuality: "strict",
      bufferMinutes: 10,
    },
  }), "ru");
  assert.equal(draft.uncertaintyPolicy?.duration.mode, "approximate");
  assert.equal(draft.uncertaintyPolicy?.duration.likelyMinutes, 180);
  assert.equal(draft.uncertaintyPolicy?.travel?.maxMinutes, 65);
  assert.equal(draft.commitmentLevel, "must_not_skip");
  assert.equal(draft.bufferAfterMinutes, 40);
});

test("recurrence count range keeps allowed days and min-usual-max counts", () => {
  const draft = commitmentToPlannerDraft(normalizeStructuredCommitment({
    id: "weekly-practice",
    title: "Практика",
    occurrenceMode: "recurring",
    weekdays: [1, 2, 3, 4, 5],
    timeMode: "flexible",
    recurrenceMode: "count_range",
    recurrencePeriod: "week",
    minOccurrences: 2,
    likelyOccurrences: 3,
    maxOccurrences: 4,
    durationType: "exact",
    durationMinutes: 45,
  }), "ru");
  assert.deepEqual(draft.uncertaintyPolicy?.recurrence, {
    mode: "count_range",
    period: "week",
    minOccurrences: 2,
    likelyOccurrences: 3,
    maxOccurrences: 4,
    allowedWeekdays: [1, 2, 3, 4, 5],
  });
});

test("a saved item round-trips through the unified editor without changing its id or travel", () => {
  const original = commitmentToPlannerDraft(normalizeStructuredCommitment({
    id: "saved-class",
    title: "Учёба",
    category: "education",
    occurrenceMode: "recurring",
    weekdays: [2, 4],
    timeMode: "flexible",
    durationMinutes: 180,
    travel: {
      enabled: true,
      originLabel: "Дом",
      originAddress: "Минск, дом",
      destinationLabel: "Университет",
      destinationAddress: "Минск, университет",
      mode: "transit",
      direction: "round_trip",
      durationMinutes: 35,
      bufferMinutes: 10,
    },
  }), "ru");
  const restored = plannerDraftToCommitment(original, "Europe/Minsk", "saved-class");
  const roundTrip = commitmentToPlannerDraft(restored, "ru");

  assert.equal(roundTrip.id, "saved-class");
  assert.equal(restored.category, "education");
  assert.equal(restored.travel.enabled, true);
  assert.equal(restored.travel.originAddress, "Дом");
  assert.equal(restored.travel.destinationAddress, "Минск, университет");
  assert.equal(roundTrip.bufferBeforeMinutes, 45);
  assert.equal(roundTrip.bufferAfterMinutes, 35);
});
