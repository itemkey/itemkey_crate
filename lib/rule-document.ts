import { createRuntimeId } from "./runtime-id.ts";

export const RULE_FORMAT = "rule" as const;
export const RULE_VERSION = "1.0" as const;
export const MESSAGE_RULE_KIND = "itemkey-message-rule-v1" as const;

export type RuleTextKind = "text" | "example" | "note" | "mistake" | "exception";
export type RuleExerciseType =
  | "question"
  | "gap"
  | "choice"
  | "translation"
  | "correction"
  | "matching"
  | "free-response";

export type RuleHeadingBlock = {
  id: string;
  kind: "heading";
  level: 1 | 2;
  text: string;
  hidden: boolean;
};

export type RuleTextBlock = {
  id: string;
  kind: RuleTextKind;
  text: string;
  hidden: boolean;
};

export type RuleMatchPair = {
  id: string;
  left: string;
  right: string;
};

export type RuleExerciseBlock = {
  id: string;
  kind: "exercise";
  exerciseType: RuleExerciseType;
  prompt: string;
  options: string[];
  pairs: RuleMatchPair[];
  answer: string;
  explanation: string;
  hidden: boolean;
  answerHidden: boolean;
};

export type RuleBlock = RuleHeadingBlock | RuleTextBlock | RuleExerciseBlock;

export type RuleAnnotation = {
  id: string;
  blockId: string;
  start: number;
  end: number;
  targetText: string;
  translation: string;
  explanation: string;
  example: string;
  resolved: boolean;
};

export type RuleGlossaryEntry = {
  id: string;
  term: string;
  translation: string;
  explanation: string;
  examples: string[];
  tags: string[];
  annotationIds: string[];
};

export type RuleDisplaySettings = {
  textScale: number;
  compact: boolean;
  showToc: boolean;
  showGlossary: boolean;
  showAnswers: boolean;
  collapsedHeadingIds: string[];
};

export type RuleDocument = {
  format: typeof RULE_FORMAT;
  version: typeof RULE_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  blocks: RuleBlock[];
  glossary: RuleGlossaryEntry[];
  annotations: RuleAnnotation[];
  tags: string[];
  settings: RuleDisplaySettings;
};

export type RuleParseResult = {
  document: RuleDocument;
  warnings: string[];
};

export type RuleSearchResult = {
  id: string;
  kind: "block" | "annotation" | "glossary";
  blockId: string | null;
  label: string;
  preview: string;
  start: number;
  end: number;
};

export type RuleHeadingRange = {
  headingId: string;
  level: 1 | 2;
  startIndex: number;
  endIndex: number;
};

export type RuleAnnotationSegment = {
  text: string;
  annotationId: string | null;
};

export class RuleImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleImportError";
  }
}

const DEFAULT_RULE_SETTINGS: RuleDisplaySettings = {
  textScale: 100,
  compact: false,
  showToc: true,
  showGlossary: true,
  showAnswers: false,
  collapsedHeadingIds: [],
};

const RULE_TEXT_KINDS = new Set<RuleTextKind>([
  "text",
  "example",
  "note",
  "mistake",
  "exception",
]);

const RULE_EXERCISE_TYPES = new Set<RuleExerciseType>([
  "question",
  "gap",
  "choice",
  "translation",
  "correction",
  "matching",
  "free-response",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized.toLocaleLowerCase())) continue;
    seen.add(normalized.toLocaleLowerCase());
    result.push(normalized);
  }
  return result;
}

function normalizeIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function createRuleId(prefix: string): string {
  const safePrefix = prefix.trim().replace(/[^a-z0-9_-]/gi, "-") || "rule";
  return `${safePrefix}-${createRuntimeId()}`;
}

export function createRuleBlock(kind: "heading"): RuleHeadingBlock;
export function createRuleBlock(kind: RuleTextKind): RuleTextBlock;
export function createRuleBlock(
  kind: "exercise",
  exerciseType?: RuleExerciseType
): RuleExerciseBlock;
export function createRuleBlock(
  kind: RuleTextKind | "heading" | "exercise",
  exerciseType: RuleExerciseType = "question"
): RuleBlock {
  if (kind === "heading") {
    return {
      id: createRuleId("block"),
      kind: "heading",
      level: 1,
      text: "Новая глава",
      hidden: false,
    };
  }
  if (kind === "exercise") {
    return {
      id: createRuleId("block"),
      kind: "exercise",
      exerciseType,
      prompt: "",
      options: exerciseType === "choice" ? ["", ""] : [],
      pairs:
        exerciseType === "matching"
          ? [{ id: createRuleId("pair"), left: "", right: "" }]
          : [],
      answer: "",
      explanation: "",
      hidden: false,
      answerHidden: true,
    };
  }
  return { id: createRuleId("block"), kind, text: "", hidden: false };
}

export function createDefaultRuleDocument(title = "Rule — учебный текст"): RuleDocument {
  const now = new Date().toISOString();
  return {
    format: RULE_FORMAT,
    version: RULE_VERSION,
    id: createRuleId("rule"),
    title: title.trim() || "Rule — учебный текст",
    createdAt: now,
    updatedAt: now,
    blocks: [createRuleBlock("heading"), createRuleBlock("text")],
    glossary: [],
    annotations: [],
    tags: [],
    settings: { ...DEFAULT_RULE_SETTINGS },
  };
}

function normalizeBlock(raw: unknown, index: number): RuleBlock | null {
  if (!isRecord(raw)) return null;
  const kind = asString(raw.kind);
  const id = asString(raw.id).trim() || `block-${index + 1}`;
  const hidden = Boolean(raw.hidden);
  if (kind === "heading") {
    return { id, kind, level: raw.level === 2 ? 2 : 1, text: asString(raw.text), hidden };
  }
  if (RULE_TEXT_KINDS.has(kind as RuleTextKind)) {
    return { id, kind: kind as RuleTextKind, text: asString(raw.text), hidden };
  }
  if (kind !== "exercise") return null;

  const exerciseType = RULE_EXERCISE_TYPES.has(raw.exerciseType as RuleExerciseType)
    ? (raw.exerciseType as RuleExerciseType)
    : "question";
  const options = Array.isArray(raw.options)
    ? raw.options.filter((item): item is string => typeof item === "string")
    : [];
  const pairs = Array.isArray(raw.pairs)
    ? raw.pairs.flatMap((pair, pairIndex): RuleMatchPair[] => {
        if (!isRecord(pair)) return [];
        return [{
          id: asString(pair.id).trim() || `pair-${index + 1}-${pairIndex + 1}`,
          left: asString(pair.left),
          right: asString(pair.right),
        }];
      })
    : [];
  return {
    id,
    kind,
    exerciseType,
    prompt: asString(raw.prompt),
    options,
    pairs,
    answer: asString(raw.answer),
    explanation: asString(raw.explanation),
    hidden,
    answerHidden: raw.answerHidden === undefined ? true : Boolean(raw.answerHidden),
  };
}

function normalizeGlossaryEntry(raw: unknown, index: number): RuleGlossaryEntry | null {
  if (!isRecord(raw)) return null;
  const term = asString(raw.term).trim();
  if (!term) return null;
  return {
    id: asString(raw.id).trim() || `term-${index + 1}`,
    term,
    translation: asString(raw.translation),
    explanation: asString(raw.explanation),
    examples: asStringList(raw.examples),
    tags: asStringList(raw.tags),
    annotationIds: asStringList(raw.annotationIds),
  };
}

function normalizeAnnotation(raw: unknown, index: number): RuleAnnotation | null {
  if (!isRecord(raw)) return null;
  const blockId = asString(raw.blockId).trim();
  const targetText = asString(raw.targetText);
  if (!blockId || !targetText) return null;
  const start = clampInteger(raw.start, 0, Number.MAX_SAFE_INTEGER);
  const end = Math.max(start, clampInteger(raw.end, start, Number.MAX_SAFE_INTEGER));
  return {
    id: asString(raw.id).trim() || `annotation-${index + 1}`,
    blockId,
    start,
    end,
    targetText,
    translation: asString(raw.translation),
    explanation: asString(raw.explanation),
    example: asString(raw.example),
    resolved: raw.resolved === undefined ? true : Boolean(raw.resolved),
  };
}

function uniqueIds<T extends { id: string }>(items: T[], prefix: string): T[] {
  const seen = new Set<string>();
  return items.map((item, index) => {
    let id = item.id.trim() || `${prefix}-${index + 1}`;
    const baseId = id;
    let suffix = 2;
    while (seen.has(id.toLocaleLowerCase())) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(id.toLocaleLowerCase());
    return id === item.id ? item : { ...item, id };
  });
}

function normalizeSettings(value: unknown): RuleDisplaySettings {
  const raw = isRecord(value) ? value : {};
  return {
    textScale: clampInteger(raw.textScale ?? 100, 70, 250),
    compact: Boolean(raw.compact),
    showToc: raw.showToc === undefined ? true : Boolean(raw.showToc),
    showGlossary: raw.showGlossary === undefined ? true : Boolean(raw.showGlossary),
    showAnswers: Boolean(raw.showAnswers),
    collapsedHeadingIds: asStringList(raw.collapsedHeadingIds),
  };
}

export function normalizeRuleDocument(value: unknown): RuleParseResult {
  if (!isRecord(value)) throw new RuleImportError("Файл Rule должен содержать JSON-объект.");
  if (value.format !== RULE_FORMAT) throw new RuleImportError("Файл не является документом Rule.");
  if (value.version !== RULE_VERSION) {
    throw new RuleImportError(`Версия Rule ${asString(value.version, "не указана")} не поддерживается.`);
  }

  const warnings: string[] = [];
  const now = new Date().toISOString();
  const rawBlocks = Array.isArray(value.blocks) ? value.blocks : [];
  const blocks = uniqueIds(
    rawBlocks.flatMap((block, index): RuleBlock[] => {
      const normalized = normalizeBlock(block, index);
      if (!normalized) {
        warnings.push(`Блок ${index + 1} пропущен: неизвестный или повреждённый тип.`);
        return [];
      }
      return [normalized];
    }),
    "block"
  );
  const rawGlossary = Array.isArray(value.glossary) ? value.glossary : [];
  const glossary = uniqueIds(
    rawGlossary.flatMap((entry, index): RuleGlossaryEntry[] => {
      const normalized = normalizeGlossaryEntry(entry, index);
      if (!normalized) {
        warnings.push(`Словарная запись ${index + 1} пропущена.`);
        return [];
      }
      return [normalized];
    }),
    "term"
  );
  const rawAnnotations = Array.isArray(value.annotations) ? value.annotations : [];
  const annotations = uniqueIds(
    rawAnnotations.flatMap((annotation, index): RuleAnnotation[] => {
      const normalized = normalizeAnnotation(annotation, index);
      if (!normalized) {
        warnings.push(`Пометка ${index + 1} пропущена.`);
        return [];
      }
      return [normalized];
    }),
    "annotation"
  );
  const blockIds = new Set(blocks.map((block) => block.id));
  return {
    document: {
      format: RULE_FORMAT,
      version: RULE_VERSION,
      id: asString(value.id).trim() || createRuleId("rule"),
      title: asString(value.title).trim() || "Rule — учебный текст",
      createdAt: normalizeIsoDate(value.createdAt, now),
      updatedAt: normalizeIsoDate(value.updatedAt, now),
      blocks,
      glossary,
      annotations: annotations.map((annotation) =>
        blockIds.has(annotation.blockId) ? annotation : { ...annotation, resolved: false }
      ),
      tags: asStringList(value.tags),
      settings: normalizeSettings(value.settings),
    },
    warnings,
  };
}

export function parseRuleDocumentJson(value: string): RuleParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new RuleImportError("Файл не удалось прочитать. Проверьте формат JSON.");
  }
  return normalizeRuleDocument(parsed);
}

export function serializeRuleDocument(document: RuleDocument): string {
  return JSON.stringify(normalizeRuleDocument(document).document, null, 2);
}

export function parseMessageRuleContent(value: string | null | undefined): RuleDocument | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.kind !== MESSAGE_RULE_KIND) return null;
    return normalizeRuleDocument(parsed.document).document;
  } catch {
    return null;
  }
}

export function serializeMessageRuleContent(document: RuleDocument): string {
  return JSON.stringify({ kind: MESSAGE_RULE_KIND, document: normalizeRuleDocument(document).document });
}

export function normalizeRuleDocuments(value: unknown): RuleDocument[] {
  if (!Array.isArray(value)) return [];
  const documents = value.flatMap((item): RuleDocument[] => {
    try {
      return [normalizeRuleDocument(item).document];
    } catch {
      return [];
    }
  });
  return uniqueIds(documents, "rule");
}

export function replaceRuleDocumentPreservingIdentity(
  current: RuleDocument,
  imported: RuleDocument
): RuleDocument {
  return {
    ...normalizeRuleDocument(imported).document,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

export function dedupeRuleTitle(title: string, existingTitles: string[]): string {
  const normalized = title.trim() || "Rule — учебный текст";
  const used = new Set(existingTitles.map((item) => item.trim().toLocaleLowerCase()));
  if (!used.has(normalized.toLocaleLowerCase())) return normalized;
  let suffix = 2;
  let candidate = `${normalized} (копия)`;
  while (used.has(candidate.toLocaleLowerCase())) {
    candidate = `${normalized} (копия ${suffix})`;
    suffix += 1;
  }
  return candidate;
}

export function getRuleBlockText(block: RuleBlock): string {
  if (block.kind !== "exercise") return block.text;
  return [
    block.prompt,
    ...block.options,
    ...block.pairs.flatMap((pair) => [pair.left, pair.right]),
    block.answer,
    block.explanation,
  ].filter(Boolean).join("\n");
}

export function getRuleHeadingRanges(blocks: RuleBlock[]): RuleHeadingRange[] {
  const ranges: RuleHeadingRange[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "heading") return;
    let endIndex = blocks.length;
    for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
      const candidate = blocks[cursor];
      if (candidate.kind === "heading" && candidate.level <= block.level) {
        endIndex = cursor;
        break;
      }
    }
    ranges.push({ headingId: block.id, level: block.level, startIndex: index, endIndex });
  });
  return ranges;
}

export function getCollapsedRuleBlockIds(
  blocks: RuleBlock[],
  collapsedHeadingIds: string[]
): Set<string> {
  const collapsed = new Set(collapsedHeadingIds);
  const hidden = new Set<string>();
  for (const range of getRuleHeadingRanges(blocks)) {
    if (!collapsed.has(range.headingId)) continue;
    for (let index = range.startIndex + 1; index < range.endIndex; index += 1) {
      hidden.add(blocks[index].id);
    }
  }
  return hidden;
}

export function ruleAnnotationsOverlap(
  annotations: RuleAnnotation[], blockId: string, start: number, end: number, ignoredId?: string
): boolean {
  return annotations.some((annotation) =>
    annotation.id !== ignoredId && annotation.blockId === blockId && annotation.resolved &&
    start < annotation.end && end > annotation.start
  );
}

export function reanchorRuleAnnotations(
  annotations: RuleAnnotation[], blockId: string, text: string
): RuleAnnotation[] {
  return annotations.map((annotation) => {
    if (annotation.blockId !== blockId) return annotation;
    if (text.slice(annotation.start, annotation.end) === annotation.targetText) {
      return annotation.resolved ? annotation : { ...annotation, resolved: true };
    }
    const indexes: number[] = [];
    let cursor = 0;
    while (cursor <= text.length) {
      const match = text.indexOf(annotation.targetText, cursor);
      if (match < 0) break;
      indexes.push(match);
      cursor = match + Math.max(1, annotation.targetText.length);
    }
    if (indexes.length === 0) return { ...annotation, resolved: false };
    const nearest = indexes.reduce((best, candidate) =>
      Math.abs(candidate - annotation.start) < Math.abs(best - annotation.start) ? candidate : best
    );
    return { ...annotation, start: nearest, end: nearest + annotation.targetText.length, resolved: true };
  });
}

export function getRuleAnnotationSegments(
  text: string,
  annotations: RuleAnnotation[]
): RuleAnnotationSegment[] {
  const valid = annotations
    .filter((annotation) =>
      annotation.resolved && annotation.start >= 0 && annotation.end <= text.length &&
      annotation.start < annotation.end && text.slice(annotation.start, annotation.end) === annotation.targetText
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const segments: RuleAnnotationSegment[] = [];
  let cursor = 0;
  for (const annotation of valid) {
    if (annotation.start < cursor) continue;
    if (annotation.start > cursor) {
      segments.push({ text: text.slice(cursor, annotation.start), annotationId: null });
    }
    segments.push({ text: text.slice(annotation.start, annotation.end), annotationId: annotation.id });
    cursor = annotation.end;
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ text: text.slice(cursor), annotationId: null });
  }
  return segments;
}

function makePreview(text: string, query: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const position = compact.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, position - 48);
  const end = Math.min(compact.length, position + query.length + 72);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

export function searchRuleDocument(document: RuleDocument, query: string): RuleSearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const results: RuleSearchResult[] = [];
  const pushMatch = (
    id: string, kind: RuleSearchResult["kind"], blockId: string | null, label: string, text: string
  ) => {
    const start = text.toLocaleLowerCase().indexOf(normalizedQuery);
    if (start < 0) return;
    results.push({
      id, kind, blockId, label,
      preview: makePreview(text, normalizedQuery),
      start,
      end: start + normalizedQuery.length,
    });
  };
  document.blocks.forEach((block, index) => {
    const label = block.kind === "heading"
      ? block.text || `Заголовок ${index + 1}`
      : block.kind === "exercise" ? `Упражнение ${index + 1}` : `Блок ${index + 1}: ${block.kind}`;
    pushMatch(`block-${block.id}`, "block", block.id, label, getRuleBlockText(block));
  });
  document.annotations.forEach((annotation) => {
    pushMatch(
      `annotation-${annotation.id}`, "annotation", annotation.blockId,
      `Пометка: ${annotation.targetText}`,
      [annotation.targetText, annotation.translation, annotation.explanation, annotation.example].join("\n")
    );
  });
  document.glossary.forEach((entry) => {
    const linked = document.annotations.find((annotation) => entry.annotationIds.includes(annotation.id));
    pushMatch(
      `glossary-${entry.id}`, "glossary", linked?.blockId ?? null,
      `Словарь: ${entry.term}`,
      [entry.term, entry.translation, entry.explanation, ...entry.examples, ...entry.tags].join("\n")
    );
  });
  return results;
}

const EXERCISE_LABELS: Record<RuleExerciseType, string> = {
  question: "Текстовый вопрос",
  gap: "Заполни пропуск",
  choice: "Выбор ответа",
  translation: "Перевод",
  correction: "Исправление ошибки",
  matching: "Сопоставление",
  "free-response": "Свободный ответ",
};

export function exportRuleMarkdown(document: RuleDocument): string {
  const lines: string[] = [`# Rule Document: ${document.title}`, ""];
  if (document.tags.length > 0) lines.push(`Tags: ${document.tags.join(", ")}`, "");
  for (const block of document.blocks) {
    const hiddenPrefix = block.hidden ? "[Скрытый блок] " : "";
    if (block.kind === "heading") {
      lines.push(`${"#".repeat(block.level + 1)} ${hiddenPrefix}${block.text}`, "");
      continue;
    }
    if (block.kind === "exercise") {
      lines.push(`### ${hiddenPrefix}Упражнение: ${EXERCISE_LABELS[block.exerciseType]}`, "");
      lines.push(block.prompt || "_(задание не заполнено)_", "");
      if (block.options.length > 0) lines.push(...block.options.map((option) => `- ${option}`), "");
      if (block.pairs.length > 0) {
        lines.push("Pairs:", ...block.pairs.map((pair) => `- ${pair.left} — ${pair.right}`), "");
      }
      lines.push(`**Answer:** ${block.answer}`, "");
      if (block.explanation) lines.push(`**Explanation:** ${block.explanation}`, "");
      continue;
    }
    const labels: Record<RuleTextKind, string> = {
      text: "Текст", example: "Пример", note: "Важная заметка",
      mistake: "Ошибка", exception: "Исключение",
    };
    lines.push(`### ${hiddenPrefix}${labels[block.kind]}`, "", block.text, "");
  }
  if (document.glossary.length > 0) {
    lines.push("## Glossary", "");
    for (const entry of document.glossary) {
      lines.push(`- **${entry.term}** — ${entry.translation}`);
      if (entry.explanation) lines.push(`  - ${entry.explanation}`);
      for (const example of entry.examples) lines.push(`  - Example: ${example}`);
    }
    lines.push("");
  }
  if (document.annotations.length > 0) {
    lines.push("## Annotations", "");
    for (const annotation of document.annotations) {
      lines.push(`- **${annotation.targetText}** — ${annotation.translation}`);
      if (annotation.explanation) lines.push(`  - ${annotation.explanation}`);
      if (annotation.example) lines.push(`  - Example: ${annotation.example}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}
