export type DictionaryPromptSide = "side1" | "side2";
export type DictionaryMotivationAdvanceMode = "auto" | "manual";

export type DictionaryEntry = {
  id: string;
  side1: string;
  side1Note: string;
  side2: string;
  side2Note: string;
};

export type DictionaryFieldLabels = {
  side1: string;
  side1Note: string;
  side2: string;
  side2Note: string;
};

export type DictionaryEntryField = Exclude<keyof DictionaryEntry, "id">;

export type DictionaryLabelField = keyof DictionaryFieldLabels;

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
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: DictionaryMotivationAdvanceMode;
  motivationAutoSeconds: number;
  labels: DictionaryFieldLabels;
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
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: DictionaryMotivationAdvanceMode;
  motivationAutoSeconds: number;
  labels: DictionaryFieldLabels;
  entries: DictionaryEntry[];
};

export type DictionarySearchResult = {
  id: string;
  entry: DictionaryEntry;
  labels: DictionaryFieldLabels;
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
export const DICTIONARY_EXPORT_SCHEMA_VERSION = 1;
export const DICTIONARY_LABEL_MAX_LENGTH = 42;

export const DEFAULT_DICTIONARY_FIELD_LABELS: DictionaryFieldLabels = {
  side1: "сторона 1",
  side1Note: "пояснение 1",
  side2: "сторона 2",
  side2Note: "пояснение 2",
};

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

export const DEFAULT_DICTIONARY_MOTIVATION_ADVANCE_MODE: DictionaryMotivationAdvanceMode =
  "auto";
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

export function createDefaultDictionaryLabels(): DictionaryFieldLabels {
  return { ...DEFAULT_DICTIONARY_FIELD_LABELS };
}

function normalizeDictionaryLabel(value: unknown, fallback: string): string {
  const normalized =
    typeof value === "string"
      ? normalizeDictionaryText(value).slice(0, DICTIONARY_LABEL_MAX_LENGTH)
      : "";

  return normalized || fallback;
}

export function normalizeDictionaryLabels(value: unknown): DictionaryFieldLabels {
  const raw = isObjectRecord(value) ? value : {};

  return {
    side1: normalizeDictionaryLabel(
      raw.side1,
      DEFAULT_DICTIONARY_FIELD_LABELS.side1
    ),
    side1Note: normalizeDictionaryLabel(
      raw.side1Note,
      DEFAULT_DICTIONARY_FIELD_LABELS.side1Note
    ),
    side2: normalizeDictionaryLabel(
      raw.side2,
      DEFAULT_DICTIONARY_FIELD_LABELS.side2
    ),
    side2Note: normalizeDictionaryLabel(
      raw.side2Note,
      DEFAULT_DICTIONARY_FIELD_LABELS.side2Note
    ),
  };
}

export function normalizeDictionaryEntries(
  entries: DictionaryEntry[]
): DictionaryEntry[] {
  const seen = new Set<string>();
  const result: DictionaryEntry[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const side1 = normalizeDictionaryText(entry.side1);
    const side1Note = normalizeDictionaryText(entry.side1Note);
    const side2 = normalizeDictionaryText(entry.side2);
    const side2Note = normalizeDictionaryText(entry.side2Note);

    if (!side1 || !side2) {
      continue;
    }

    const rawId = normalizeDictionaryText(entry.id);
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
      side1,
      side1Note,
      side2,
      side2Note,
    });
  }

  return result;
}

export function isDictionaryEntryField(
  value: unknown
): value is DictionaryEntryField {
  return (
    typeof value === "string" &&
    DICTIONARY_EDITOR_SEARCH_FIELDS.includes(value as DictionaryEntryField)
  );
}

export function normalizeDictionaryAutoSpeakFields(
  value: unknown,
  fallback: DictionaryEntryField[] = DEFAULT_DICTIONARY_AUTO_SPEAK_FIELDS
): DictionaryEntryField[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const result: DictionaryEntryField[] = [];
  for (const field of value) {
    if (!isDictionaryEntryField(field) || result.includes(field)) {
      continue;
    }

    result.push(field);
  }

  return result;
}

export function normalizeDictionaryManualSpeakFields(
  value: unknown,
  fallback: DictionaryEntryField[] = DEFAULT_DICTIONARY_MANUAL_SPEAK_FIELDS
): DictionaryEntryField[] {
  return normalizeDictionaryAutoSpeakFields(value, fallback);
}

export function normalizeMessageDictionaryPayload(
  payload: MessageDictionaryPayload
): MessageDictionaryPayload {
  return {
    description: normalizeDictionaryDescription(payload.description),
    tags: dedupeDictionaryList(Array.isArray(payload.tags) ? payload.tags : []),
    promptSide: normalizeDictionaryPromptSide(payload.promptSide),
    shuffle: Boolean(payload.shuffle),
    autoSpeak: Boolean(payload.autoSpeak),
    autoSpeakFields: normalizeDictionaryAutoSpeakFields(payload.autoSpeakFields),
    manualSpeakFields: normalizeDictionaryManualSpeakFields(
      payload.manualSpeakFields
    ),
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
    labels: normalizeDictionaryLabels(payload.labels),
    entries: normalizeDictionaryEntries(payload.entries),
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

    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .filter(isObjectRecord)
          .map((entry): DictionaryEntry => ({
            id: typeof entry.id === "string" ? entry.id : "",
            side1: typeof entry.side1 === "string" ? entry.side1 : "",
            side1Note: typeof entry.side1Note === "string" ? entry.side1Note : "",
            side2: typeof entry.side2 === "string" ? entry.side2 : "",
            side2Note: typeof entry.side2Note === "string" ? entry.side2Note : "",
          }))
      : [];

    return normalizeMessageDictionaryPayload({
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      promptSide: normalizeDictionaryPromptSide(parsed.promptSide),
      shuffle: Boolean(parsed.shuffle),
      autoSpeak: Boolean(parsed.autoSpeak),
      autoSpeakFields: normalizeDictionaryAutoSpeakFields(parsed.autoSpeakFields),
      manualSpeakFields: normalizeDictionaryManualSpeakFields(
        parsed.manualSpeakFields
      ),
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
      labels: normalizeDictionaryLabels(parsed.labels),
      entries,
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
    progressMode: normalized.progressMode,
    motivateOnCorrect: normalized.motivateOnCorrect,
    cardMode: normalized.cardMode,
    adhdMode: normalized.adhdMode,
    motivationAdvanceMode: normalized.motivationAdvanceMode,
    motivationAutoSeconds: normalized.motivationAutoSeconds,
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

    const entries = Array.isArray(rawDictionary.entries)
      ? rawDictionary.entries
          .filter(isObjectRecord)
          .map((entry): DictionaryEntry => ({
            id: typeof entry.id === "string" ? entry.id : "",
            side1: typeof entry.side1 === "string" ? entry.side1 : "",
            side1Note: typeof entry.side1Note === "string" ? entry.side1Note : "",
            side2: typeof entry.side2 === "string" ? entry.side2 : "",
            side2Note: typeof entry.side2Note === "string" ? entry.side2Note : "",
          }))
      : [];

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
      autoSpeakFields: normalizeDictionaryAutoSpeakFields(
        rawDictionary.autoSpeakFields
      ),
      manualSpeakFields: normalizeDictionaryManualSpeakFields(
        rawDictionary.manualSpeakFields
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
      labels: normalizeDictionaryLabels(rawDictionary.labels),
      entries,
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
  return [
    payload.description,
    payload.tags.join(" "),
    payload.entries
      .map((entry) =>
        [
          entry.side1,
          entry.side1Note ? `(${entry.side1Note})` : "",
          "-",
          entry.side2,
          entry.side2Note ? `(${entry.side2Note})` : "",
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
  labels: DictionaryFieldLabels = DEFAULT_DICTIONARY_FIELD_LABELS
): string {
  const normalizedLabels = normalizeDictionaryLabels(labels);
  return side === "side1" ? normalizedLabels.side1 : normalizedLabels.side2;
}

export function toDictionaryNoteSideLabel(
  side: DictionaryPromptSide,
  labels: DictionaryFieldLabels = DEFAULT_DICTIONARY_FIELD_LABELS
): string {
  const normalizedLabels = normalizeDictionaryLabels(labels);
  return side === "side1"
    ? normalizedLabels.side1Note
    : normalizedLabels.side2Note;
}

export function getDictionaryFieldLabel(
  field: DictionaryEntryField,
  labels: DictionaryFieldLabels = DEFAULT_DICTIONARY_FIELD_LABELS
): string {
  const normalizedLabels = normalizeDictionaryLabels(labels);
  return normalizedLabels[field];
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

export function normalizeDictionarySearchText(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

export function getDictionarySearchTokens(value: string): DictionarySearchToken[] {
  const tokens: DictionarySearchToken[] = [];
  const wordPattern = /[0-9A-Za-zА-Яа-яЁё]+/g;
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
  query: string
): CompiledDictionarySearchQuery | null {
  const tokens = getDictionarySearchTokens(query).map((token) => token.text);
  const significantLength = tokens.join("").length;
  if (significantLength < 2 || tokens.length === 0) {
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

