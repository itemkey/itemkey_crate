export type DictionaryPromptSide = "side1" | "side2";
export type DictionaryMotivationAdvanceMode = "auto" | "manual";
export type DictionaryColumnKind = "word" | "note";
export type DictionaryNoteDisplayMode = "continuous" | "separate";
export type DictionarySpeechLanguage = string;

export type DictionaryColumn = {
  id: string;
  side: DictionaryPromptSide;
  kind: DictionaryColumnKind;
  label: string;
  wordIndex?: number;
};

export type DictionaryEntry = {
  id: string;
  values: Record<string, string>;
  side1?: string;
  side1Note?: string;
  side2?: string;
  side2Note?: string;
};

export type DictionaryFieldLabels = Record<string, string>;

export type DictionaryEntryField = string;

export type DictionaryLabelField = string;

export type DictionaryBlock = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  promptSide: DictionaryPromptSide;
  shuffle: boolean;
  autoSpeak: boolean;
  autoSpeakFields: DictionaryEntryField[];
  manualSpeakFields: DictionaryEntryField[];
  speechLanguage: DictionarySpeechLanguage;
  noteDisplayMode: DictionaryNoteDisplayMode;
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: DictionaryMotivationAdvanceMode;
  motivationAutoSeconds: number;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  entries: DictionaryEntry[];
};

export type MessageDictionaryPayload = {
  description: string;
  tags: string[];
  promptSide: DictionaryPromptSide;
  shuffle: boolean;
  autoSpeak: boolean;
  autoSpeakFields: DictionaryEntryField[];
  manualSpeakFields: DictionaryEntryField[];
  speechLanguage: DictionarySpeechLanguage;
  noteDisplayMode: DictionaryNoteDisplayMode;
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: DictionaryMotivationAdvanceMode;
  motivationAutoSeconds: number;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  entries: DictionaryEntry[];
};

export type DictionarySearchResult = {
  id: string;
  entry: DictionaryEntry;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  matchedFields: DictionaryEntryField[];
  hasFuzzyMatch: boolean;
  sourceCategoryId: string;
  sourceMessageId: string | null;
  dictionaryId: string | null;
  dictionaryTitle: string;
  categoryPath: string;
};

export type DictionaryEntryIdentity = {
  sourceCategoryId: string;
  sourceMessageId: string | null;
  dictionaryId: string | null;
  entryId: string;
};

export type DictionaryWordGroupSummary = {
  id: string;
  title: string;
};

export type DictionaryGroupResolvedResult = DictionaryEntryIdentity & {
  id: string;
  entry: DictionaryEntry;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  sourceExists: boolean;
  dictionaryTitle: string;
  categoryPath: string;
  groups: DictionaryWordGroupSummary[];
  itemIds: string[];
  isCurrent: boolean;
};

export type DictionaryWordGroupItemSnapshot = {
  entry: DictionaryEntry;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  dictionaryTitle: string;
  categoryPath: string;
};

export type DictionaryWordGroupItem = DictionaryEntryIdentity & {
  id: string;
  groupId: string;
  entrySnapshot: DictionaryWordGroupItemSnapshot;
  position: number;
  createdAt: string;
  updatedAt: string;
  resolvedResult: DictionaryGroupResolvedResult;
};

export type DictionaryWordGroup = {
  id: string;
  title: string;
  description: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  items: DictionaryWordGroupItem[];
};

export const CONTINUOUS_CONTENT_KIND = "itemkey-continuous-v1";
export const MESSAGE_DICTIONARY_KIND = "itemkey-message-dictionary-v1";
export const DICTIONARY_EXPORT_KIND = "itemkey-dict-export";
export const DICTIONARY_EXPORT_SCHEMA_VERSION = 2;
export const DICTIONARY_LABEL_MAX_LENGTH = 42;

export const DEFAULT_DICTIONARY_FIELD_LABELS: DictionaryFieldLabels = {
  side1: "сторона 1",
  side1Note: "пояснение 1",
  side2: "сторона 2",
  side2Note: "пояснение 2",
};

export const DEFAULT_DICTIONARY_COLUMNS: DictionaryColumn[] = [
  {
    id: "side1",
    side: "side1",
    kind: "word",
    label: DEFAULT_DICTIONARY_FIELD_LABELS.side1,
  },
  {
    id: "side1Note",
    side: "side1",
    kind: "note",
    label: DEFAULT_DICTIONARY_FIELD_LABELS.side1Note,
    wordIndex: 0,
  },
  {
    id: "side2",
    side: "side2",
    kind: "word",
    label: DEFAULT_DICTIONARY_FIELD_LABELS.side2,
  },
  {
    id: "side2Note",
    side: "side2",
    kind: "note",
    label: DEFAULT_DICTIONARY_FIELD_LABELS.side2Note,
    wordIndex: 0,
  },
];

export const DICTIONARY_EDITOR_SEARCH_FIELDS: DictionaryEntryField[] = [
  "side1",
  "side1Note",
  "side2",
  "side2Note",
];

export const DEFAULT_DICTIONARY_AUTO_SPEAK_FIELDS: DictionaryEntryField[] = [
  "side1",
  "side2",
];

export const DEFAULT_DICTIONARY_MANUAL_SPEAK_FIELDS: DictionaryEntryField[] = [
  ...DICTIONARY_EDITOR_SEARCH_FIELDS,
];

export const DEFAULT_DICTIONARY_SPEECH_LANGUAGE = "auto";
export const DICTIONARY_SPEECH_LANGUAGE_VALUES = [
  DEFAULT_DICTIONARY_SPEECH_LANGUAGE,
  "ru-RU",
  "en-US",
  "en-GB",
  "en-AU",
  "en-CA",
  "en-IN",
  "fr-FR",
  "fr-CA",
  "de-DE",
  "de-AT",
  "de-CH",
  "es-ES",
  "es-MX",
  "es-US",
  "ca-ES",
  "it-IT",
  "pt-PT",
  "pt-BR",
  "nl-NL",
  "pl-PL",
  "uk-UA",
  "be-BY",
  "cs-CZ",
  "sk-SK",
  "ro-RO",
  "hu-HU",
  "bg-BG",
  "hr-HR",
  "sr-RS",
  "sl-SI",
  "lt-LT",
  "lv-LV",
  "et-EE",
  "sv-SE",
  "da-DK",
  "nb-NO",
  "fi-FI",
  "is-IS",
  "ga-IE",
  "cy-GB",
  "el-GR",
  "tr-TR",
  "ar-SA",
  "fa-IR",
  "he-IL",
  "hi-IN",
  "bn-IN",
  "ur-PK",
  "ta-IN",
  "te-IN",
  "mr-IN",
  "gu-IN",
  "kn-IN",
  "ml-IN",
  "pa-IN",
  "id-ID",
  "ms-MY",
  "fil-PH",
  "vi-VN",
  "th-TH",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
  "af-ZA",
  "sw-KE",
  "am-ET",
  "hy-AM",
  "ka-GE",
  "az-AZ",
  "sq-AL",
  "mk-MK",
  "kk-KZ",
  "uz-UZ",
] as const;

export const DEFAULT_DICTIONARY_MOTIVATION_ADVANCE_MODE: DictionaryMotivationAdvanceMode =
  "auto";
export const DEFAULT_DICTIONARY_NOTE_DISPLAY_MODE: DictionaryNoteDisplayMode =
  "continuous";
export const DEFAULT_DICTIONARY_MOTIVATION_AUTO_SECONDS = 3;
export const MIN_DICTIONARY_MOTIVATION_AUTO_SECONDS = 1;
export const MAX_DICTIONARY_MOTIVATION_AUTO_SECONDS = 30;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dedupeDictionaryList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeDictionaryText(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function normalizeDictionaryPromptSide(value: unknown): DictionaryPromptSide {
  return value === "side2" ? "side2" : "side1";
}

export function normalizeDictionaryMotivationAdvanceMode(
  value: unknown
): DictionaryMotivationAdvanceMode {
  return value === "manual" ? "manual" : DEFAULT_DICTIONARY_MOTIVATION_ADVANCE_MODE;
}

export function normalizeDictionaryColumnKind(value: unknown): DictionaryColumnKind {
  return value === "word" ? "word" : "note";
}

export function normalizeDictionaryNoteDisplayMode(
  value: unknown
): DictionaryNoteDisplayMode {
  return value === "separate" ? "separate" : DEFAULT_DICTIONARY_NOTE_DISPLAY_MODE;
}

export function normalizeDictionarySpeechLanguage(
  value: unknown
): DictionarySpeechLanguage {
  if (typeof value !== "string") {
    return DEFAULT_DICTIONARY_SPEECH_LANGUAGE;
  }

  return DICTIONARY_SPEECH_LANGUAGE_VALUES.includes(
    value as (typeof DICTIONARY_SPEECH_LANGUAGE_VALUES)[number]
  )
    ? value
    : DEFAULT_DICTIONARY_SPEECH_LANGUAGE;
}

export function normalizeDictionaryMotivationAutoSeconds(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_DICTIONARY_MOTIVATION_AUTO_SECONDS;
  }

  const clamped = Math.min(
    MAX_DICTIONARY_MOTIVATION_AUTO_SECONDS,
    Math.max(MIN_DICTIONARY_MOTIVATION_AUTO_SECONDS, numericValue)
  );
  return Math.round(clamped * 10) / 10;
}

export function normalizeDictionaryText(value: string | null | undefined): string {
  return (typeof value === "string" ? value : "").trim();
}

export function normalizeDictionaryTitle(value: string | null | undefined): string {
  const normalized = normalizeDictionaryText(value);
  return (normalized || "Словарь").slice(0, 80);
}

export function normalizeDictionaryDescription(
  value: string | null | undefined
): string {
  return normalizeDictionaryText(value).slice(0, 420);
}

function normalizeDictionaryLabel(value: unknown, fallback: string): string {
  const normalized =
    typeof value === "string"
      ? normalizeDictionaryText(value).slice(0, DICTIONARY_LABEL_MAX_LENGTH)
      : "";

  return normalized || fallback;
}

function readDictionaryLabels(value: unknown): DictionaryFieldLabels {
  if (!isObjectRecord(value)) {
    return {};
  }

  const labels: DictionaryFieldLabels = {};
  for (const [key, label] of Object.entries(value)) {
    if (typeof label === "string") {
      labels[key] = label;
    }
  }

  return labels;
}

function normalizeDictionaryColumnId(value: unknown, fallback: string): string {
  const normalized =
    typeof value === "string"
      ? normalizeDictionaryText(value).slice(0, 64)
      : "";
  return normalized || fallback;
}

function readDictionaryColumnWordIndex(value: unknown): number | null {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, Math.floor(numericValue));
}

function clampDictionaryColumnWordIndex(
  value: unknown,
  wordCount: number,
  fallback = 0
): number {
  const parsed = readDictionaryColumnWordIndex(value);
  const maxIndex = Math.max(0, wordCount - 1);
  return Math.min(maxIndex, parsed ?? fallback);
}

function normalizeDictionaryColumnWordIndexes(
  columns: DictionaryColumn[]
): DictionaryColumn[] {
  const wordCountBySide: Record<DictionaryPromptSide, number> = {
    side1: getDictionarySideColumns(columns, "side1", "word").length,
    side2: getDictionarySideColumns(columns, "side2", "word").length,
  };
  const seenWordCountBySide: Record<DictionaryPromptSide, number> = {
    side1: 0,
    side2: 0,
  };

  return columns.map((column) => {
    if (column.kind === "word") {
      seenWordCountBySide[column.side] += 1;
      const wordColumn = { ...column };
      delete wordColumn.wordIndex;
      return wordColumn;
    }

    const fallbackWordIndex = Math.max(0, seenWordCountBySide[column.side] - 1);
    return {
      ...column,
      wordIndex: clampDictionaryColumnWordIndex(
        column.wordIndex,
        wordCountBySide[column.side],
        fallbackWordIndex
      ),
    };
  });
}

function makeDictionaryColumnFallbackId(
  side: DictionaryPromptSide,
  kind: DictionaryColumnKind,
  index: number
): string {
  return `${side}-${kind}-${index + 1}`;
}

function makeDictionaryColumnFallbackLabel(
  side: DictionaryPromptSide,
  kind: DictionaryColumnKind,
  index: number
): string {
  if (side === "side1" && kind === "word" && index === 0) {
    return DEFAULT_DICTIONARY_FIELD_LABELS.side1;
  }
  if (side === "side1" && kind === "note" && index === 1) {
    return DEFAULT_DICTIONARY_FIELD_LABELS.side1Note;
  }
  if (side === "side2" && kind === "word" && index === 2) {
    return DEFAULT_DICTIONARY_FIELD_LABELS.side2;
  }
  if (side === "side2" && kind === "note" && index === 3) {
    return DEFAULT_DICTIONARY_FIELD_LABELS.side2Note;
  }

  const sideNumber = side === "side1" ? "1" : "2";
  const typeLabel = kind === "word" ? "ÑÐ»Ð¾Ð²Ð¾" : "Ð¿Ð¾ÑÑÐ½ÐµÐ½Ð¸Ðµ";
  return `${typeLabel} ${sideNumber}.${index + 1}`;
}

export function createDefaultDictionaryColumns(
  labels: unknown = DEFAULT_DICTIONARY_FIELD_LABELS
): DictionaryColumn[] {
  const rawLabels = isObjectRecord(labels) ? labels : {};
  return DEFAULT_DICTIONARY_COLUMNS.map((column) => ({
    ...column,
    label: normalizeDictionaryLabel(rawLabels[column.id], column.label),
  }));
}

export function normalizeDictionaryColumns(
  value: unknown,
  labels: unknown = DEFAULT_DICTIONARY_FIELD_LABELS
): DictionaryColumn[] {
  if (!Array.isArray(value) || value.length === 0) {
    return createDefaultDictionaryColumns(labels);
  }

  const rawLabels = isObjectRecord(labels) ? labels : {};
  const seen = new Set<string>();
  const result: DictionaryColumn[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const rawColumn = value[index];
    if (!isObjectRecord(rawColumn)) {
      continue;
    }

    const side = normalizeDictionaryPromptSide(rawColumn.side);
    const kind = normalizeDictionaryColumnKind(rawColumn.kind);
    const baseId = normalizeDictionaryColumnId(
      rawColumn.id,
      makeDictionaryColumnFallbackId(side, kind, index)
    );
    let resolvedId = baseId;
    let suffix = 2;
    while (seen.has(resolvedId.toLocaleLowerCase())) {
      resolvedId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(resolvedId.toLocaleLowerCase());

    const fallbackColumn = DEFAULT_DICTIONARY_COLUMNS.find(
      (column) => column.id === resolvedId
    );
    const fallbackLabel =
      fallbackColumn?.label ?? makeDictionaryColumnFallbackLabel(side, kind, index);

    const column: DictionaryColumn = {
      id: resolvedId,
      side,
      kind,
      label: normalizeDictionaryLabel(
        rawColumn.label ?? rawLabels[resolvedId],
        fallbackLabel
      ),
    };

    if (kind === "note") {
      column.wordIndex = readDictionaryColumnWordIndex(rawColumn.wordIndex) ?? undefined;
    }

    result.push(column);
  }

  if (result.length === 0) {
    return createDefaultDictionaryColumns(labels);
  }

  for (const side of ["side1", "side2"] as const) {
    if (result.some((column) => column.side === side && column.kind === "word")) {
      continue;
    }

    const fallbackColumn = DEFAULT_DICTIONARY_COLUMNS.find(
      (column) => column.side === side && column.kind === "word"
    );
    if (fallbackColumn && !seen.has(fallbackColumn.id.toLocaleLowerCase())) {
      result.unshift({ ...fallbackColumn });
    }
  }

  return normalizeDictionaryColumnWordIndexes(result);
}

export function createDefaultDictionaryLabels(
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryFieldLabels {
  return Object.fromEntries(columns.map((column) => [column.id, column.label]));
}

export function normalizeDictionaryLabels(
  value: unknown,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryFieldLabels {
  const raw = isObjectRecord(value) ? value : {};
  return Object.fromEntries(
    columns.map((column) => [
      column.id,
      normalizeDictionaryLabel(raw[column.id] ?? column.label, column.label),
    ])
  );
}

function normalizeDictionaryEntryValues(
  entry: unknown,
  columns: DictionaryColumn[]
): Record<string, string> {
  const rawEntry = isObjectRecord(entry) ? entry : {};
  const rawValues = isObjectRecord(rawEntry.values) ? rawEntry.values : {};
  const values: Record<string, string> = {};

  for (const column of columns) {
    const rawValue = rawValues[column.id];
    const directValue = rawEntry[column.id];
    values[column.id] = normalizeDictionaryText(
      typeof rawValue === "string"
        ? rawValue
        : typeof directValue === "string"
          ? directValue
          : ""
    );
  }

  return values;
}

export function normalizeDictionaryEntries(
  entries: unknown,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set<string>();
  const result: DictionaryEntry[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const values = normalizeDictionaryEntryValues(entry, columns);
    const hasSide1Word = columns.some(
      (column) =>
        column.side === "side1" && column.kind === "word" && Boolean(values[column.id])
    );
    const hasSide2Word = columns.some(
      (column) =>
        column.side === "side2" && column.kind === "word" && Boolean(values[column.id])
    );

    if (!hasSide1Word || !hasSide2Word) {
      continue;
    }

    const rawId = normalizeDictionaryText(
      isObjectRecord(entry) && typeof entry.id === "string" ? entry.id : ""
    );
    const baseId = rawId || `entry-${index + 1}`;
    let resolvedId = baseId;
    let suffix = 2;
    while (seen.has(resolvedId.toLocaleLowerCase())) {
      resolvedId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(resolvedId.toLocaleLowerCase());

    result.push({
      id: resolvedId,
      values,
    });
  }

  return result;
}

export function isDictionaryEntryField(
  value: unknown,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): value is DictionaryEntryField {
  return (
    typeof value === "string" &&
    columns.some((column) => column.id === value)
  );
}

export function getDictionarySideColumns(
  columns: DictionaryColumn[],
  side: DictionaryPromptSide,
  kind?: DictionaryColumnKind
): DictionaryColumn[] {
  return columns.filter(
    (column) => column.side === side && (!kind || column.kind === kind)
  );
}

export function getDictionaryFieldLabel(
  field: DictionaryEntryField,
  labels: DictionaryFieldLabels = DEFAULT_DICTIONARY_FIELD_LABELS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): string {
  const column = columns.find((candidate) => candidate.id === field);
  return labels[field] ?? column?.label ?? field;
}

export function getDictionaryEntryFieldText(
  entry: DictionaryEntry,
  field: DictionaryEntryField
): string {
  return normalizeDictionaryText(
    entry.values?.[field] ??
      (typeof entry[field as keyof DictionaryEntry] === "string"
        ? (entry[field as keyof DictionaryEntry] as string)
        : "")
  );
}

function getDefaultDictionaryAutoSpeakFields(
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntryField[] {
  return columns
    .filter((column) => column.kind === "word")
    .map((column) => column.id);
}

function getDefaultDictionaryManualSpeakFields(
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntryField[] {
  return columns.map((column) => column.id);
}

function normalizeDictionarySpeakFields(
  value: unknown,
  columns: DictionaryColumn[],
  fallback: DictionaryEntryField[]
): DictionaryEntryField[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const result: DictionaryEntryField[] = [];
  for (const field of value) {
    if (!isDictionaryEntryField(field, columns) || result.includes(field)) {
      continue;
    }

    result.push(field);
  }

  return result.length > 0 ? result : [...fallback];
}

export function normalizeDictionaryAutoSpeakFields(
  value: unknown,
  fallback: DictionaryEntryField[] = DEFAULT_DICTIONARY_AUTO_SPEAK_FIELDS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntryField[] {
  return normalizeDictionarySpeakFields(value, columns, fallback);
}

export function normalizeDictionaryManualSpeakFields(
  value: unknown,
  fallback: DictionaryEntryField[] = DEFAULT_DICTIONARY_MANUAL_SPEAK_FIELDS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntryField[] {
  return normalizeDictionarySpeakFields(value, columns, fallback);
}

export function normalizeMessageDictionaryPayload(
  payload: MessageDictionaryPayload
): MessageDictionaryPayload {
  const columns = normalizeDictionaryColumns(payload.columns, payload.labels);
  const labels = normalizeDictionaryLabels(payload.labels, columns);

  return {
    description: normalizeDictionaryDescription(payload.description),
    tags: dedupeDictionaryList(Array.isArray(payload.tags) ? payload.tags : []),
    promptSide: normalizeDictionaryPromptSide(payload.promptSide),
    shuffle: Boolean(payload.shuffle),
    autoSpeak: Boolean(payload.autoSpeak),
    autoSpeakFields: normalizeDictionaryAutoSpeakFields(
      payload.autoSpeakFields,
      getDefaultDictionaryAutoSpeakFields(columns),
      columns
    ),
    manualSpeakFields: normalizeDictionaryManualSpeakFields(
      payload.manualSpeakFields,
      getDefaultDictionaryManualSpeakFields(columns),
      columns
    ),
    speechLanguage: normalizeDictionarySpeechLanguage(payload.speechLanguage),
    noteDisplayMode: normalizeDictionaryNoteDisplayMode(payload.noteDisplayMode),
    progressMode: Boolean(payload.progressMode),
    motivateOnCorrect: Boolean(payload.motivateOnCorrect),
    cardMode: Boolean(payload.cardMode),
    adhdMode: Boolean(payload.adhdMode),
    motivationAdvanceMode: normalizeDictionaryMotivationAdvanceMode(
      payload.motivationAdvanceMode
    ),
    motivationAutoSeconds: normalizeDictionaryMotivationAutoSeconds(
      payload.motivationAutoSeconds
    ),
    labels,
    columns,
    entries: normalizeDictionaryEntries(payload.entries, columns),
  };
}

export function normalizeDictionaryBlocks(
  dictionaries: DictionaryBlock[]
): DictionaryBlock[] {
  const seen = new Set<string>();
  const result: DictionaryBlock[] = [];

  for (let index = 0; index < dictionaries.length; index += 1) {
    const dictionary = dictionaries[index];
    const rawId = normalizeDictionaryText(dictionary.id);
    const baseId = rawId || `dictionary-${index + 1}`;
    let resolvedId = baseId;
    let suffix = 2;
    while (seen.has(resolvedId.toLocaleLowerCase())) {
      resolvedId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(resolvedId.toLocaleLowerCase());

    const normalizedPayload = normalizeMessageDictionaryPayload(dictionary);
    if (normalizedPayload.entries.length === 0) {
      continue;
    }

    result.push({
      id: resolvedId,
      title: normalizeDictionaryTitle(dictionary.title),
      ...normalizedPayload,
    });
  }

  return result;
}

export function parseMessageDictionaryContent(
  value: string | null | undefined
): MessageDictionaryPayload | null {
  const raw = typeof value === "string" ? value : "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObjectRecord(parsed) || parsed.kind !== MESSAGE_DICTIONARY_KIND) {
      return null;
    }

    return normalizeMessageDictionaryPayload({
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      promptSide: normalizeDictionaryPromptSide(parsed.promptSide),
      shuffle: Boolean(parsed.shuffle),
      autoSpeak: Boolean(parsed.autoSpeak),
      autoSpeakFields: Array.isArray(parsed.autoSpeakFields)
        ? parsed.autoSpeakFields.filter((field): field is string => typeof field === "string")
        : [],
      manualSpeakFields: Array.isArray(parsed.manualSpeakFields)
        ? parsed.manualSpeakFields.filter((field): field is string => typeof field === "string")
        : [],
      speechLanguage: normalizeDictionarySpeechLanguage(parsed.speechLanguage),
      noteDisplayMode: normalizeDictionaryNoteDisplayMode(parsed.noteDisplayMode),
      progressMode: Boolean(parsed.progressMode),
      motivateOnCorrect: Boolean(parsed.motivateOnCorrect),
      cardMode: Boolean(parsed.cardMode),
      adhdMode: Boolean(parsed.adhdMode),
      motivationAdvanceMode: normalizeDictionaryMotivationAdvanceMode(
        parsed.motivationAdvanceMode
      ),
      motivationAutoSeconds: normalizeDictionaryMotivationAutoSeconds(
        parsed.motivationAutoSeconds
      ),
      labels: readDictionaryLabels(parsed.labels),
      columns: normalizeDictionaryColumns(parsed.columns, parsed.labels),
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    });
  } catch {
    return null;
  }
}

export function serializeMessageDictionaryContent(
  payload: MessageDictionaryPayload
): string {
  const normalized = normalizeMessageDictionaryPayload(payload);
  return JSON.stringify({
    kind: MESSAGE_DICTIONARY_KIND,
    description: normalized.description,
    tags: normalized.tags,
    promptSide: normalized.promptSide,
    shuffle: normalized.shuffle,
    autoSpeak: normalized.autoSpeak,
    autoSpeakFields: normalized.autoSpeakFields,
    manualSpeakFields: normalized.manualSpeakFields,
    speechLanguage: normalized.speechLanguage,
    noteDisplayMode: normalized.noteDisplayMode,
    progressMode: normalized.progressMode,
    motivateOnCorrect: normalized.motivateOnCorrect,
    cardMode: normalized.cardMode,
    adhdMode: normalized.adhdMode,
    motivationAdvanceMode: normalized.motivationAdvanceMode,
    motivationAutoSeconds: normalized.motivationAutoSeconds,
    columns: normalized.columns,
    labels: normalized.labels,
    entries: normalized.entries,
  });
}

export function parseContinuousDictionaryCollection(
  value: unknown
): DictionaryBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsedDictionaries: DictionaryBlock[] = [];
  for (const rawDictionary of value) {
    if (!isObjectRecord(rawDictionary)) {
      continue;
    }

    parsedDictionaries.push({
      id: typeof rawDictionary.id === "string" ? rawDictionary.id : "",
      title: typeof rawDictionary.title === "string" ? rawDictionary.title : "",
      description:
        typeof rawDictionary.description === "string"
          ? rawDictionary.description
          : "",
      tags: Array.isArray(rawDictionary.tags)
        ? rawDictionary.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      promptSide: normalizeDictionaryPromptSide(rawDictionary.promptSide),
      shuffle: Boolean(rawDictionary.shuffle),
      autoSpeak: Boolean(rawDictionary.autoSpeak),
      autoSpeakFields: Array.isArray(rawDictionary.autoSpeakFields)
        ? rawDictionary.autoSpeakFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [],
      manualSpeakFields: Array.isArray(rawDictionary.manualSpeakFields)
        ? rawDictionary.manualSpeakFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [],
      speechLanguage: normalizeDictionarySpeechLanguage(
        rawDictionary.speechLanguage
      ),
      noteDisplayMode: normalizeDictionaryNoteDisplayMode(
        rawDictionary.noteDisplayMode
      ),
      progressMode: Boolean(rawDictionary.progressMode),
      motivateOnCorrect: Boolean(rawDictionary.motivateOnCorrect),
      cardMode: Boolean(rawDictionary.cardMode),
      adhdMode: Boolean(rawDictionary.adhdMode),
      motivationAdvanceMode: normalizeDictionaryMotivationAdvanceMode(
        rawDictionary.motivationAdvanceMode
      ),
      motivationAutoSeconds: normalizeDictionaryMotivationAutoSeconds(
        rawDictionary.motivationAutoSeconds
      ),
      labels: readDictionaryLabels(rawDictionary.labels),
      columns: normalizeDictionaryColumns(
        rawDictionary.columns,
        rawDictionary.labels
      ),
      entries: Array.isArray(rawDictionary.entries) ? rawDictionary.entries : [],
    });
  }

  return normalizeDictionaryBlocks(parsedDictionaries);
}

export function parseContinuousDictionariesFromContent(
  value: string | null | undefined
): DictionaryBlock[] {
  const raw = typeof value === "string" ? value : "";
  const trimmed = raw.trim();

  if (!trimmed.startsWith("{")) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      !isObjectRecord(parsed) ||
      parsed.kind !== CONTINUOUS_CONTENT_KIND ||
      !Array.isArray(parsed.dictionaries)
    ) {
      return [];
    }

    return parseContinuousDictionaryCollection(parsed.dictionaries);
  } catch {
    return [];
  }
}

export function dictionaryPayloadToPlainText(
  payload: MessageDictionaryPayload
): string {
  const normalized = normalizeMessageDictionaryPayload(payload);
  return [
    normalized.description,
    normalized.tags.join(" "),
    normalized.entries
      .map((entry) =>
        [
          getDictionarySideColumns(normalized.columns, "side1")
            .map((column) => getDictionaryEntryFieldText(entry, column.id))
            .filter(Boolean)
            .join(" / "),
          "-",
          getDictionarySideColumns(normalized.columns, "side2")
            .map((column) => getDictionaryEntryFieldText(entry, column.id))
            .filter(Boolean)
            .join(" / "),
        ]
          .filter(Boolean)
          .join(" ")
      )
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

export function toDictionaryPromptSideLabel(
  side: DictionaryPromptSide,
  labels: DictionaryFieldLabels = DEFAULT_DICTIONARY_FIELD_LABELS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): string {
  const wordColumn = columns.find(
    (column) => column.side === side && column.kind === "word"
  );
  return wordColumn
    ? getDictionaryFieldLabel(wordColumn.id, labels, columns)
    : side === "side1"
      ? DEFAULT_DICTIONARY_FIELD_LABELS.side1
      : DEFAULT_DICTIONARY_FIELD_LABELS.side2;
}

export function toDictionaryNoteSideLabel(
  side: DictionaryPromptSide,
  labels: DictionaryFieldLabels = DEFAULT_DICTIONARY_FIELD_LABELS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): string {
  const noteColumn = columns.find(
    (column) => column.side === side && column.kind === "note"
  );
  return noteColumn
    ? getDictionaryFieldLabel(noteColumn.id, labels, columns)
    : side === "side1"
      ? DEFAULT_DICTIONARY_FIELD_LABELS.side1Note
      : DEFAULT_DICTIONARY_FIELD_LABELS.side2Note;
}

export type DictionarySearchToken = {
  text: string;
  start: number;
  end: number;
};

export type DictionarySearchMatchKind = "phrase" | "exact" | "prefix" | "substring" | "fuzzy";

export type DictionarySearchMatch = {
  start: number;
  end: number;
  isFuzzy: boolean;
  kind: DictionarySearchMatchKind;
  score: number;
};

export type CompiledDictionarySearchQuery = {
  query: string;
  tokens: string[];
  significantLength: number;
};

const DICTIONARY_SEARCH_FUZZY_MIN_LENGTH = 5;
const DICTIONARY_SEARCH_MIN_SIGNIFICANT_LENGTH = 2;

export function normalizeDictionarySearchText(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

export function getDictionarySearchTokens(value: string): DictionarySearchToken[] {
  const tokens: DictionarySearchToken[] = [];
  const wordPattern = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null = wordPattern.exec(value);

  while (match) {
    const rawText = match[0];
    tokens.push({
      text: normalizeDictionarySearchText(rawText),
      start: match.index,
      end: match.index + rawText.length,
    });
    match = wordPattern.exec(value);
  }

  return tokens.filter((token) => token.text.length > 0);
}

export function findDictionaryEditorSearchMatch(
  value: string,
  query: CompiledDictionarySearchQuery
): DictionarySearchMatch | null {
  const valueTokens = getDictionarySearchTokens(value);
  if (query.tokens.length === 0 || valueTokens.length === 0) {
    return null;
  }

  if (query.tokens.length > 1) {
    return findDictionaryPhraseSearchMatch(valueTokens, query.tokens);
  }

  return findDictionarySingleTokenSearchMatch(valueTokens, query.tokens[0] ?? "");
}

export function compileDictionarySearchQuery(
  query: string,
  options: { minSignificantLength?: number } = {}
): CompiledDictionarySearchQuery | null {
  const tokens = getDictionarySearchTokens(query).map((token) => token.text);
  const significantLength = tokens.join("").length;
  const minSignificantLength =
    options.minSignificantLength ?? DICTIONARY_SEARCH_MIN_SIGNIFICANT_LENGTH;
  if (significantLength < minSignificantLength || tokens.length === 0) {
    return null;
  }

  return {
    query: normalizeDictionarySearchText(query),
    tokens,
    significantLength,
  };
}

function findDictionaryPhraseSearchMatch(
  valueTokens: DictionarySearchToken[],
  queryTokens: string[]
): DictionarySearchMatch | null {
  if (queryTokens.length > valueTokens.length) {
    return null;
  }

  for (
    let valueStartIndex = 0;
    valueStartIndex <= valueTokens.length - queryTokens.length;
    valueStartIndex += 1
  ) {
    const isExactPhrase = queryTokens.every(
      (queryToken, queryIndex) =>
        valueTokens[valueStartIndex + queryIndex]?.text === queryToken
    );

    if (!isExactPhrase) {
      continue;
    }

    const firstToken = valueTokens[valueStartIndex];
    const lastToken = valueTokens[valueStartIndex + queryTokens.length - 1];
    if (!firstToken || !lastToken) {
      return null;
    }

    return {
      start: firstToken.start,
      end: lastToken.end,
      isFuzzy: false,
      kind: "phrase",
      score: 600,
    };
  }

  return null;
}

function findDictionarySingleTokenSearchMatch(
  valueTokens: DictionarySearchToken[],
  queryToken: string
): DictionarySearchMatch | null {
  if (!queryToken) {
    return null;
  }

  const exactToken = valueTokens.find((valueToken) => valueToken.text === queryToken);
  if (exactToken) {
    return {
      start: exactToken.start,
      end: exactToken.end,
      isFuzzy: false,
      kind: "exact",
      score: 500,
    };
  }

  if (queryToken.length <= 2) {
    return null;
  }

  const prefixToken = valueTokens.find((valueToken) =>
    valueToken.text.startsWith(queryToken)
  );
  if (prefixToken) {
    return {
      start: prefixToken.start,
      end: prefixToken.end,
      isFuzzy: false,
      kind: "prefix",
      score: 400,
    };
  }

  if (queryToken.length >= DICTIONARY_SEARCH_FUZZY_MIN_LENGTH) {
    const substringToken = valueTokens.find((valueToken) =>
      valueToken.text.includes(queryToken)
    );
    if (substringToken) {
      return {
        start: substringToken.start,
        end: substringToken.end,
        isFuzzy: false,
        kind: "substring",
        score: 300,
      };
    }
  }

  if (queryToken.length < DICTIONARY_SEARCH_FUZZY_MIN_LENGTH) {
    return null;
  }

  const maxDistance = getDictionarySearchMaxDistance(queryToken.length);
  let bestFuzzyToken: DictionarySearchToken | null = null;
  let bestDistance = maxDistance + 1;

  for (const valueToken of valueTokens) {
    if (Math.abs(queryToken.length - valueToken.text.length) > maxDistance) {
      continue;
    }

    const distance = getBoundedLevenshteinDistance(
      queryToken,
      valueToken.text,
      maxDistance
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestFuzzyToken = valueToken;
    }
  }

  if (!bestFuzzyToken || bestDistance > maxDistance) {
    return null;
  }

  return {
    start: bestFuzzyToken.start,
    end: bestFuzzyToken.end,
    isFuzzy: true,
    kind: "fuzzy",
    score: 100 - bestDistance,
  };
}

function getDictionarySearchMaxDistance(length: number): number {
  if (length <= 8) {
    return 1;
  }

  return 2;
}

function getBoundedLevenshteinDistance(
  left: string,
  right: string,
  maxDistance: number
): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const nextDistance = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );

      current[rightIndex] = nextDistance;
      rowMinimum = Math.min(rowMinimum, nextDistance);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[right.length];
}

