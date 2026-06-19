export type DictionaryStudyAnswerResult = "correct" | "wrong";

export type DictionaryStudyProgressSourceIdentity = {
  sourceCategoryId: string;
  sourceMessageId: string | null;
  dictionaryId: string | null;
};

export type DictionaryStudyProgressSettings = {
  promptSide: "side1" | "side2";
  shuffle: boolean;
  autoSpeak: boolean;
  autoSpeakFields: string[];
  manualSpeakFields: string[];
  speechLanguage: string;
  noteDisplayMode: "continuous" | "separate";
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: "auto" | "manual";
  motivationAutoSeconds: number;
};

export type PersistedDictionaryStudyProgress = {
  schemaVersion: number;
  savedAt: number | null;
  currentIndex: number;
  isAnswerRevealed: boolean;
  cardIds: string[];
  shuffle: boolean;
  progressMode: boolean;
  progressStartedAt: number;
  progressCompletedAt: number | null;
  correctCount: number;
  wrongCount: number;
  answerResultsByEntryId: Record<string, DictionaryStudyAnswerResult>;
  isProgressComplete: boolean;
  settings: DictionaryStudyProgressSettings | null;
};

export const DICTIONARY_STUDY_PROGRESS_SCHEMA_VERSION = 2;
export const DEFAULT_DICTIONARY_STUDY_MOTIVATION_AUTO_SECONDS = 3;
export const DEFAULT_DICTIONARY_STUDY_SPEECH_LANGUAGE = "auto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeTextId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizePromptSide(
  value: unknown
): DictionaryStudyProgressSettings["promptSide"] {
  return value === "side2" ? "side2" : "side1";
}

function normalizeNoteDisplayMode(
  value: unknown
): DictionaryStudyProgressSettings["noteDisplayMode"] {
  return value === "separate" ? "separate" : "continuous";
}

function normalizeMotivationAdvanceMode(
  value: unknown
): DictionaryStudyProgressSettings["motivationAdvanceMode"] {
  return value === "manual" ? "manual" : "auto";
}

function normalizeMotivationAutoSeconds(value: unknown): number {
  const numericValue = normalizeFiniteNumber(value);
  if (numericValue === null) {
    return DEFAULT_DICTIONARY_STUDY_MOTIVATION_AUTO_SECONDS;
  }

  return Math.min(30, Math.max(1, numericValue));
}

function normalizeSpeechLanguage(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_DICTIONARY_STUDY_SPEECH_LANGUAGE;
}

export function normalizeDictionaryStudyProgressSettings(
  value: unknown
): DictionaryStudyProgressSettings | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  return {
    promptSide: normalizePromptSide(value.promptSide),
    shuffle: Boolean(value.shuffle),
    autoSpeak: Boolean(value.autoSpeak),
    autoSpeakFields: normalizeStringList(value.autoSpeakFields),
    manualSpeakFields: normalizeStringList(value.manualSpeakFields),
    speechLanguage: normalizeSpeechLanguage(value.speechLanguage),
    noteDisplayMode: normalizeNoteDisplayMode(value.noteDisplayMode),
    progressMode: Boolean(value.progressMode),
    motivateOnCorrect: Boolean(value.motivateOnCorrect),
    cardMode: Boolean(value.cardMode),
    adhdMode: Boolean(value.adhdMode),
    motivationAdvanceMode: normalizeMotivationAdvanceMode(
      value.motivationAdvanceMode
    ),
    motivationAutoSeconds: normalizeMotivationAutoSeconds(
      value.motivationAutoSeconds
    ),
  };
}

export function normalizeDictionaryStudyProgressSource(
  value: unknown
): DictionaryStudyProgressSourceIdentity | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const sourceCategoryId = normalizeUuid(value.sourceCategoryId);
  const sourceMessageId = normalizeUuid(value.sourceMessageId);
  const dictionaryId = normalizeTextId(value.dictionaryId);

  if (!sourceCategoryId || Boolean(sourceMessageId) === Boolean(dictionaryId)) {
    return null;
  }

  return {
    sourceCategoryId,
    sourceMessageId,
    dictionaryId,
  };
}

export function normalizeDictionaryStudyAnswerResultsByEntryId(
  value: unknown
): Record<string, DictionaryStudyAnswerResult> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const result: Record<string, DictionaryStudyAnswerResult> = {};
  for (const [entryId, answerResult] of Object.entries(value)) {
    if (
      typeof entryId === "string" &&
      entryId.trim() &&
      (answerResult === "correct" || answerResult === "wrong")
    ) {
      result[entryId] = answerResult;
    }
  }

  return result;
}

export function normalizePersistedDictionaryStudyProgress(
  value: unknown
): PersistedDictionaryStudyProgress | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const cardIds = normalizeStringList(value.cardIds);
  const answerResultsByEntryId =
    normalizeDictionaryStudyAnswerResultsByEntryId(value.answerResultsByEntryId);
  const settings = normalizeDictionaryStudyProgressSettings(value.settings);
  const savedAt = normalizeFiniteNumber(value.savedAt);

  return {
    schemaVersion:
      typeof value.schemaVersion === "number" && Number.isFinite(value.schemaVersion)
        ? Math.max(1, Math.floor(value.schemaVersion))
        : 1,
    savedAt: savedAt === null ? null : Math.max(0, savedAt),
    currentIndex:
      typeof value.currentIndex === "number" && Number.isFinite(value.currentIndex)
        ? Math.max(0, Math.floor(value.currentIndex))
        : 0,
    isAnswerRevealed: Boolean(value.isAnswerRevealed),
    cardIds,
    shuffle: Boolean(value.shuffle),
    progressMode: Boolean(value.progressMode),
    progressStartedAt:
      typeof value.progressStartedAt === "number" &&
      Number.isFinite(value.progressStartedAt)
        ? Math.max(0, value.progressStartedAt)
        : Date.now(),
    progressCompletedAt:
      typeof value.progressCompletedAt === "number" &&
      Number.isFinite(value.progressCompletedAt)
        ? Math.max(0, value.progressCompletedAt)
        : null,
    correctCount:
      typeof value.correctCount === "number" && Number.isFinite(value.correctCount)
        ? Math.max(0, Math.floor(value.correctCount))
        : 0,
    wrongCount:
      typeof value.wrongCount === "number" && Number.isFinite(value.wrongCount)
        ? Math.max(0, Math.floor(value.wrongCount))
        : 0,
    answerResultsByEntryId,
    isProgressComplete: Boolean(value.isProgressComplete),
    settings,
  };
}
