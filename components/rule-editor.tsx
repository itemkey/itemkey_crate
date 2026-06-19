"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createRuleBlock,
  createRuleId,
  exportRuleMarkdown,
  getCollapsedRuleBlockIds,
  getRuleAnnotationSegments,
  getRuleHeadingRanges,
  parseRuleDocumentJson,
  reanchorRuleAnnotations,
  replaceRuleDocumentPreservingIdentity,
  ruleAnnotationsOverlap,
  searchRuleDocument,
  serializeRuleDocument,
  type RuleAnnotation,
  type RuleBlock,
  type RuleDocument,
  type RuleExerciseBlock,
  type RuleExerciseType,
  type RuleGlossaryEntry,
  type RuleTextKind,
} from "@/lib/rule-document";

type RuleEditorMode = "edit" | "read";
type RuleSidebarTab = "toc" | "search" | "glossary";
type RuleSaveState = "saved" | "saving" | "error";

type RuleEditorProps = {
  document: RuleDocument;
  canEdit: boolean;
  saveState: RuleSaveState;
  onChange(document: RuleDocument): void;
  onSave(): void | Promise<void>;
  onClose(): void;
};

type RuleCardProps = {
  document: RuleDocument;
  canEdit: boolean;
  onOpen(): void;
  onDelete(): void;
};

type AnnotationDraft = {
  id: string | null;
  blockId: string;
  start: number;
  end: number;
  targetText: string;
  translation: string;
  explanation: string;
  example: string;
  addToGlossary: boolean;
};

const EMPTY_ANNOTATION_DRAFT: AnnotationDraft = {
  id: null,
  blockId: "",
  start: 0,
  end: 0,
  targetText: "",
  translation: "",
  explanation: "",
  example: "",
  addToGlossary: false,
};

const BLOCK_OPTIONS: Array<{ value: RuleTextKind | "heading" | "exercise"; label: string }> = [
  { value: "text", label: "Обычный текст" },
  { value: "heading", label: "Глава / подраздел" },
  { value: "example", label: "Пример" },
  { value: "note", label: "Важная заметка" },
  { value: "mistake", label: "Ошибка" },
  { value: "exception", label: "Исключение" },
  { value: "exercise", label: "Упражнение" },
];

const EXERCISE_OPTIONS: Array<{ value: RuleExerciseType; label: string }> = [
  { value: "question", label: "Текстовый вопрос" },
  { value: "gap", label: "Пропуск" },
  { value: "choice", label: "Выбор ответа" },
  { value: "translation", label: "Перевод" },
  { value: "correction", label: "Исправление ошибки" },
  { value: "matching", label: "Сопоставление" },
  { value: "free-response", label: "Свободный ответ" },
];

const BLOCK_LABELS: Record<RuleTextKind | "heading" | "exercise", string> = {
  heading: "Заголовок",
  text: "Текст",
  example: "Пример",
  note: "Важная заметка",
  mistake: "Ошибка",
  exception: "Исключение",
  exercise: "Упражнение",
};

function downloadRuleFile(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function fileSafeTitle(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 90);
  return normalized || "rule-document";
}

function splitList(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getBlockTitle(block: RuleBlock, index: number): string {
  if (block.kind === "heading") return block.text.trim() || `Заголовок ${index + 1}`;
  if (block.kind === "exercise") {
    return EXERCISE_OPTIONS.find((option) => option.value === block.exerciseType)?.label ?? "Упражнение";
  }
  return `${BLOCK_LABELS[block.kind]} ${index + 1}`;
}

function cloneExerciseForType(block: RuleExerciseBlock, exerciseType: RuleExerciseType): RuleExerciseBlock {
  return {
    ...block,
    exerciseType,
    options: exerciseType === "choice" ? (block.options.length > 0 ? block.options : ["", ""]) : [],
    pairs:
      exerciseType === "matching"
        ? block.pairs.length > 0
          ? block.pairs
          : [{ id: createRuleId("pair"), left: "", right: "" }]
        : [],
  };
}

export function RuleCard({ document, canEdit, onOpen, onDelete }: RuleCardProps) {
  const chapterCount = document.blocks.filter(
    (block) => block.kind === "heading" && block.level === 1
  ).length;
  const exerciseCount = document.blocks.filter((block) => block.kind === "exercise").length;

  return (
    <div className="rule-card" onClick={(event) => event.stopPropagation()}>
      <div className="rule-card-mark">Rule</div>
      <div className="rule-card-copy">
        <strong>{document.title}</strong>
        <span>
          {chapterCount} глав · {document.blocks.length} блоков · {exerciseCount} упражнений
        </span>
      </div>
      <div className="rule-card-actions">
        <button type="button" className="mini-action" onClick={onOpen}>
          открыть
        </button>
        {canEdit && (
          <button type="button" className="mini-action danger-action" onClick={onDelete}>
            удалить
          </button>
        )}
      </div>
    </div>
  );
}

export default function RuleEditor({
  document,
  canEdit,
  saveState,
  onChange,
  onSave,
  onClose,
}: RuleEditorProps) {
  const [mode, setMode] = useState<RuleEditorMode>(canEdit ? "edit" : "read");
  const [sidebarTab, setSidebarTab] = useState<RuleSidebarTab>("toc");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [newBlockKind, setNewBlockKind] = useState<RuleTextKind | "heading" | "exercise">("text");
  const [newExerciseType, setNewExerciseType] = useState<RuleExerciseType>("question");
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft>(EMPTY_ANNOTATION_DRAFT);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [revealedHiddenIds, setRevealedHiddenIds] = useState<string[]>([]);
  const [revealedAnswerIds, setRevealedAnswerIds] = useState<string[]>([]);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const collapsedBlockIds = useMemo(
    () => getCollapsedRuleBlockIds(document.blocks, document.settings.collapsedHeadingIds),
    [document.blocks, document.settings.collapsedHeadingIds]
  );
  const searchResults = useMemo(
    () => searchRuleDocument(document, searchQuery),
    [document, searchQuery]
  );
  const unresolvedAnnotationCount = document.annotations.filter(
    (annotation) => !annotation.resolved
  ).length;

  useEffect(() => {
    if (sidebarTab === "search") {
      searchInputRef.current?.focus();
    }
  }, [sidebarTab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        setSidebarTab("search");
      }
      if (event.key === "Escape" && !annotationDraft.blockId && !showSettings) {
        void Promise.resolve(onSave()).finally(onClose);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [annotationDraft.blockId, onClose, onSave, showSettings]);

  function updateDocument(mutator: (current: RuleDocument) => RuleDocument): void {
    if (!canEdit) return;
    const next = mutator(document);
    onChange({ ...next, updatedAt: new Date().toISOString() });
  }

  function updateSettings(patch: Partial<RuleDocument["settings"]>): void {
    updateDocument((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
  }

  function updateBlock(blockId: string, updater: (block: RuleBlock) => RuleBlock): void {
    updateDocument((current) => {
      const previous = current.blocks.find((block) => block.id === blockId);
      if (!previous) return current;
      const nextBlock = updater(previous);
      const previousText = previous.kind === "exercise" ? null : previous.text;
      const nextText = nextBlock.kind === "exercise" ? null : nextBlock.text;
      return {
        ...current,
        blocks: current.blocks.map((block) => (block.id === blockId ? nextBlock : block)),
        annotations:
          previousText !== null && nextText !== null && previousText !== nextText
            ? reanchorRuleAnnotations(current.annotations, blockId, nextText)
            : current.annotations,
      };
    });
  }

  function addBlock(): void {
    const block =
      newBlockKind === "exercise"
        ? createRuleBlock("exercise", newExerciseType)
        : newBlockKind === "heading"
          ? createRuleBlock("heading")
          : createRuleBlock(newBlockKind);
    updateDocument((current) => ({ ...current, blocks: [...current.blocks, block] }));
    window.requestAnimationFrame(() => {
      window.document.getElementById(`rule-block-${block.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  function deleteBlock(blockId: string): void {
    updateDocument((current) => {
      const removedAnnotationIds = current.annotations
        .filter((annotation) => annotation.blockId === blockId)
        .map((annotation) => annotation.id);
      return {
        ...current,
        blocks: current.blocks.filter((block) => block.id !== blockId),
        annotations: current.annotations.filter((annotation) => annotation.blockId !== blockId),
        glossary: current.glossary.map((entry) => ({
          ...entry,
          annotationIds: entry.annotationIds.filter((id) => !removedAnnotationIds.includes(id)),
        })),
        settings: {
          ...current.settings,
          collapsedHeadingIds: current.settings.collapsedHeadingIds.filter((id) => id !== blockId),
        },
      };
    });
  }

  function moveBlock(blockId: string, targetId: string): void {
    if (blockId === targetId) return;
    updateDocument((current) => {
      const sourceIndex = current.blocks.findIndex((block) => block.id === blockId);
      const targetIndex = current.blocks.findIndex((block) => block.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const source = current.blocks[sourceIndex];
      const range = source.kind === "heading"
        ? getRuleHeadingRanges(current.blocks).find((item) => item.headingId === source.id)
        : null;
      const endIndex = range?.endIndex ?? sourceIndex + 1;
      const moving = current.blocks.slice(sourceIndex, endIndex);
      const remaining = current.blocks.filter((_, index) => index < sourceIndex || index >= endIndex);
      const targetRemainingIndex = remaining.findIndex((block) => block.id === targetId);
      const insertionIndex = targetRemainingIndex < 0 ? remaining.length : targetRemainingIndex;
      return {
        ...current,
        blocks: [
          ...remaining.slice(0, insertionIndex),
          ...moving,
          ...remaining.slice(insertionIndex),
        ],
      };
    });
  }

  function moveBlockByOffset(blockId: string, offset: number): void {
    updateDocument((current) => {
      const index = current.blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return current;
      const source = current.blocks[index];
      if (source.kind !== "heading") {
        const targetIndex = index + offset;
        if (targetIndex < 0 || targetIndex >= current.blocks.length) return current;
        const blocks = [...current.blocks];
        [blocks[index], blocks[targetIndex]] = [blocks[targetIndex], blocks[index]];
        return { ...current, blocks };
      }

      const ranges = getRuleHeadingRanges(current.blocks);
      const sourceRange = ranges.find((range) => range.headingId === source.id);
      if (!sourceRange) return current;
      const sourceChunk = current.blocks.slice(sourceRange.startIndex, sourceRange.endIndex);
      if (offset > 0) {
        const nextStart = sourceRange.endIndex;
        if (nextStart >= current.blocks.length) return current;
        const nextBlock = current.blocks[nextStart];
        const nextRange = nextBlock.kind === "heading"
          ? ranges.find((range) => range.headingId === nextBlock.id)
          : null;
        const nextEnd = nextRange?.endIndex ?? nextStart + 1;
        return {
          ...current,
          blocks: [
            ...current.blocks.slice(0, sourceRange.startIndex),
            ...current.blocks.slice(nextStart, nextEnd),
            ...sourceChunk,
            ...current.blocks.slice(nextEnd),
          ],
        };
      }

      if (sourceRange.startIndex === 0) return current;
      const previousIndex = sourceRange.startIndex - 1;
      const previousRange = [...ranges]
        .reverse()
        .find((range) => range.startIndex <= previousIndex && previousIndex < range.endIndex);
      const previousStart = previousRange?.startIndex ?? previousIndex;
      return {
        ...current,
        blocks: [
          ...current.blocks.slice(0, previousStart),
          ...sourceChunk,
          ...current.blocks.slice(previousStart, sourceRange.startIndex),
          ...current.blocks.slice(sourceRange.endIndex),
        ],
      };
    });
  }

  function toggleHeading(headingId: string): void {
    const collapsed = document.settings.collapsedHeadingIds.includes(headingId);
    updateSettings({
      collapsedHeadingIds: collapsed
        ? document.settings.collapsedHeadingIds.filter((id) => id !== headingId)
        : [...document.settings.collapsedHeadingIds, headingId],
    });
  }

  function openSelectionAnnotation(blockId: string, target: HTMLTextAreaElement): void {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (end <= start) return;
    const targetText = target.value.slice(start, end);
    if (!targetText.trim()) return;
    if (ruleAnnotationsOverlap(document.annotations, blockId, start, end)) {
      setLocalNotice("Пометки не могут пересекаться. Выберите другой фрагмент.");
      return;
    }
    setAnnotationDraft({
      ...EMPTY_ANNOTATION_DRAFT,
      blockId,
      start,
      end,
      targetText,
    });
    setLocalNotice(null);
  }

  function editAnnotation(annotation: RuleAnnotation): void {
    setAnnotationDraft({
      id: annotation.id,
      blockId: annotation.blockId,
      start: annotation.start,
      end: annotation.end,
      targetText: annotation.targetText,
      translation: annotation.translation,
      explanation: annotation.explanation,
      example: annotation.example,
      addToGlossary: document.glossary.some((entry) => entry.annotationIds.includes(annotation.id)),
    });
  }

  function saveAnnotation(): void {
    if (!annotationDraft.blockId || !annotationDraft.targetText.trim()) return;
    const annotationId = annotationDraft.id ?? createRuleId("annotation");
    const nextAnnotation: RuleAnnotation = {
      id: annotationId,
      blockId: annotationDraft.blockId,
      start: annotationDraft.start,
      end: annotationDraft.end,
      targetText: annotationDraft.targetText,
      translation: annotationDraft.translation.trim(),
      explanation: annotationDraft.explanation.trim(),
      example: annotationDraft.example.trim(),
      resolved: true,
    };
    updateDocument((current) => {
      const annotations = annotationDraft.id
        ? current.annotations.map((annotation) =>
            annotation.id === annotationDraft.id ? nextAnnotation : annotation
          )
        : [...current.annotations, nextAnnotation];
      let glossary = current.glossary.map((entry) => ({
        ...entry,
        annotationIds: annotationDraft.addToGlossary
          ? entry.annotationIds
          : entry.annotationIds.filter((id) => id !== annotationId),
      }));
      if (annotationDraft.addToGlossary) {
        const existing = glossary.find(
          (entry) => entry.term.toLocaleLowerCase() === annotationDraft.targetText.trim().toLocaleLowerCase()
        );
        if (existing) {
          glossary = glossary.map((entry) =>
            entry.id === existing.id
              ? {
                  ...entry,
                  translation: entry.translation || annotationDraft.translation.trim(),
                  explanation: entry.explanation || annotationDraft.explanation.trim(),
                  annotationIds: Array.from(new Set([...entry.annotationIds, annotationId])),
                }
              : entry
          );
        } else {
          glossary = [
            ...glossary,
            {
              id: createRuleId("term"),
              term: annotationDraft.targetText.trim(),
              translation: annotationDraft.translation.trim(),
              explanation: annotationDraft.explanation.trim(),
              examples: annotationDraft.example.trim() ? [annotationDraft.example.trim()] : [],
              tags: [],
              annotationIds: [annotationId],
            },
          ];
        }
      }
      return { ...current, annotations, glossary };
    });
    setAnnotationDraft(EMPTY_ANNOTATION_DRAFT);
  }

  function deleteAnnotation(annotationId: string): void {
    updateDocument((current) => ({
      ...current,
      annotations: current.annotations.filter((annotation) => annotation.id !== annotationId),
      glossary: current.glossary.map((entry) => ({
        ...entry,
        annotationIds: entry.annotationIds.filter((id) => id !== annotationId),
      })),
    }));
    setActiveAnnotationId(null);
    setAnnotationDraft(EMPTY_ANNOTATION_DRAFT);
  }

  function addGlossaryEntry(): void {
    const entry: RuleGlossaryEntry = {
      id: createRuleId("term"),
      term: "Новое слово",
      translation: "",
      explanation: "",
      examples: [],
      tags: [],
      annotationIds: [],
    };
    updateDocument((current) => ({ ...current, glossary: [...current.glossary, entry] }));
    setSidebarTab("glossary");
  }

  function updateGlossaryEntry(entryId: string, patch: Partial<RuleGlossaryEntry>): void {
    updateDocument((current) => ({
      ...current,
      glossary: current.glossary.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry
      ),
    }));
  }

  function deleteGlossaryEntry(entryId: string): void {
    updateDocument((current) => ({
      ...current,
      glossary: current.glossary.filter((entry) => entry.id !== entryId),
    }));
  }

  function navigateToBlock(blockId: string): void {
    const blockIndex = document.blocks.findIndex((block) => block.id === blockId);
    if (blockIndex < 0) return;
    const collapsedAncestors = getRuleHeadingRanges(document.blocks)
      .filter((range) => range.startIndex < blockIndex && blockIndex < range.endIndex)
      .map((range) => range.headingId);
    if (collapsedAncestors.length > 0) {
      updateSettings({
        collapsedHeadingIds: document.settings.collapsedHeadingIds.filter(
          (id) => !collapsedAncestors.includes(id)
        ),
      });
    }
    setRevealedHiddenIds((current) => Array.from(new Set([...current, blockId])));
    window.requestAnimationFrame(() => {
      window.document.getElementById(`rule-block-${blockId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseRuleDocumentJson(await file.text());
      if (!window.confirm("Заменить открытый Rule содержимым выбранного файла?")) return;
      onChange(replaceRuleDocumentPreservingIdentity(document, parsed.document));
      setLocalNotice(
        parsed.warnings.length > 0
          ? `Импорт завершён. ${parsed.warnings.join(" ")}`
          : "Rule импортирован."
      );
    } catch (error) {
      setLocalNotice(error instanceof Error ? error.message : "Файл не удалось импортировать.");
    }
  }

  function handleExportJson(): void {
    downloadRuleFile(
      `${fileSafeTitle(document.title)}.rule.json`,
      serializeRuleDocument(document),
      "application/json;charset=utf-8"
    );
  }

  function handleExportMarkdown(): void {
    downloadRuleFile(
      `${fileSafeTitle(document.title)}.rule.md`,
      exportRuleMarkdown(document),
      "text/markdown;charset=utf-8"
    );
  }

  function closeEditor(): void {
    void Promise.resolve(onSave()).finally(onClose);
  }

  function renderAnnotationForm() {
    if (!annotationDraft.blockId || !canEdit) return null;
    return (
      <div className="rule-annotation-form">
        <div className="rule-annotation-form-head">
          <strong>{annotationDraft.id ? "Редактирование пометки" : "Новая пометка"}</strong>
          <span>«{annotationDraft.targetText}»</span>
        </div>
        <div className="rule-form-grid">
          <input
            value={annotationDraft.translation}
            onChange={(event) => setAnnotationDraft((current) => ({ ...current, translation: event.target.value }))}
            placeholder="Перевод"
          />
          <input
            value={annotationDraft.example}
            onChange={(event) => setAnnotationDraft((current) => ({ ...current, example: event.target.value }))}
            placeholder="Пример"
          />
        </div>
        <textarea
          value={annotationDraft.explanation}
          onChange={(event) => setAnnotationDraft((current) => ({ ...current, explanation: event.target.value }))}
          placeholder="Пояснение"
          rows={2}
        />
        <label className="rule-check-label">
          <input
            type="checkbox"
            checked={annotationDraft.addToGlossary}
            onChange={(event) => setAnnotationDraft((current) => ({ ...current, addToGlossary: event.target.checked }))}
          />
          добавить в локальный словарь
        </label>
        <div className="rule-inline-actions">
          <button type="button" className="mini-action" onClick={saveAnnotation}>сохранить пометку</button>
          {annotationDraft.id && (
            <button type="button" className="mini-action danger-action" onClick={() => deleteAnnotation(annotationDraft.id!)}>
              удалить
            </button>
          )}
          <button type="button" className="mini-action" onClick={() => setAnnotationDraft(EMPTY_ANNOTATION_DRAFT)}>
            отмена
          </button>
        </div>
      </div>
    );
  }

  function renderAnnotatedText(block: Exclude<RuleBlock, RuleExerciseBlock>) {
    const annotations = document.annotations.filter((annotation) => annotation.blockId === block.id);
    const segments = getRuleAnnotationSegments(block.text, annotations);
    return (
      <div className="rule-read-text">
        {segments.map((segment, index) => {
          if (!segment.annotationId) return <span key={`${block.id}-plain-${index}`}>{segment.text}</span>;
          const annotation = annotations.find((item) => item.id === segment.annotationId);
          const tooltip = [annotation?.translation, annotation?.explanation].filter(Boolean).join(" — ");
          return (
            <button
              key={segment.annotationId}
              type="button"
              className="rule-annotation-mark"
              title={tooltip}
              onClick={() => setActiveAnnotationId((current) => current === segment.annotationId ? null : segment.annotationId)}
            >
              {segment.text}
            </button>
          );
        })}
        {activeAnnotationId && annotations.some((annotation) => annotation.id === activeAnnotationId) && (() => {
          const annotation = annotations.find((item) => item.id === activeAnnotationId)!;
          return (
            <div className="rule-annotation-popover">
              <strong>{annotation.targetText}</strong>
              {annotation.translation && <span>{annotation.translation}</span>}
              {annotation.explanation && <p>{annotation.explanation}</p>}
              {annotation.example && <small>Пример: {annotation.example}</small>}
            </div>
          );
        })()}
      </div>
    );
  }

  function renderExerciseEditor(block: RuleExerciseBlock) {
    return (
      <div className="rule-exercise-editor">
        <label>
          тип упражнения
          <select
            value={block.exerciseType}
            onChange={(event) => updateBlock(block.id, (current) =>
              current.kind === "exercise"
                ? cloneExerciseForType(current, event.target.value as RuleExerciseType)
                : current
            )}
          >
            {EXERCISE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          задание
          <textarea
            value={block.prompt}
            onChange={(event) => updateBlock(block.id, (current) =>
              current.kind === "exercise" ? { ...current, prompt: event.target.value } : current
            )}
            rows={3}
            placeholder={block.exerciseType === "gap" ? "The phone is ___ the desk." : "Текст задания"}
          />
        </label>
        {block.exerciseType === "choice" && (
          <div className="rule-list-editor">
            <span>варианты ответа</span>
            {block.options.map((option, optionIndex) => (
              <div key={`${block.id}-option-${optionIndex}`} className="rule-list-row">
                <input
                  value={option}
                  onChange={(event) => updateBlock(block.id, (current) =>
                    current.kind === "exercise"
                      ? { ...current, options: current.options.map((item, index) => index === optionIndex ? event.target.value : item) }
                      : current
                  )}
                  placeholder={`Вариант ${optionIndex + 1}`}
                />
                <button type="button" className="mini-action" onClick={() => updateBlock(block.id, (current) =>
                  current.kind === "exercise"
                    ? { ...current, options: current.options.filter((_, index) => index !== optionIndex) }
                    : current
                )}>−</button>
              </div>
            ))}
            <button type="button" className="mini-action" onClick={() => updateBlock(block.id, (current) =>
              current.kind === "exercise" ? { ...current, options: [...current.options, ""] } : current
            )}>+ вариант</button>
          </div>
        )}
        {block.exerciseType === "matching" && (
          <div className="rule-list-editor">
            <span>пары</span>
            {block.pairs.map((pair, pairIndex) => (
              <div key={pair.id} className="rule-match-row">
                <input
                  value={pair.left}
                  onChange={(event) => updateBlock(block.id, (current) =>
                    current.kind === "exercise"
                      ? { ...current, pairs: current.pairs.map((item, index) => index === pairIndex ? { ...item, left: event.target.value } : item) }
                      : current
                  )}
                  placeholder="Левая часть"
                />
                <span>↔</span>
                <input
                  value={pair.right}
                  onChange={(event) => updateBlock(block.id, (current) =>
                    current.kind === "exercise"
                      ? { ...current, pairs: current.pairs.map((item, index) => index === pairIndex ? { ...item, right: event.target.value } : item) }
                      : current
                  )}
                  placeholder="Правая часть"
                />
                <button type="button" className="mini-action" onClick={() => updateBlock(block.id, (current) =>
                  current.kind === "exercise"
                    ? { ...current, pairs: current.pairs.filter((_, index) => index !== pairIndex) }
                    : current
                )}>−</button>
              </div>
            ))}
            <button type="button" className="mini-action" onClick={() => updateBlock(block.id, (current) =>
              current.kind === "exercise"
                ? { ...current, pairs: [...current.pairs, { id: createRuleId("pair"), left: "", right: "" }] }
                : current
            )}>+ пара</button>
          </div>
        )}
        <div className="rule-form-grid">
          <label>
            правильный / образцовый ответ
            <textarea
              value={block.answer}
              onChange={(event) => updateBlock(block.id, (current) =>
                current.kind === "exercise" ? { ...current, answer: event.target.value } : current
              )}
              rows={2}
            />
          </label>
          <label>
            пояснение
            <textarea
              value={block.explanation}
              onChange={(event) => updateBlock(block.id, (current) =>
                current.kind === "exercise" ? { ...current, explanation: event.target.value } : current
              )}
              rows={2}
            />
          </label>
        </div>
        <label className="rule-check-label">
          <input
            type="checkbox"
            checked={block.answerHidden}
            onChange={(event) => updateBlock(block.id, (current) =>
              current.kind === "exercise" ? { ...current, answerHidden: event.target.checked } : current
            )}
          />
          скрывать ответ в режиме чтения
        </label>
      </div>
    );
  }

  function renderExerciseRead(block: RuleExerciseBlock) {
    const answerVisible =
      document.settings.showAnswers || !block.answerHidden || revealedAnswerIds.includes(block.id);
    return (
      <div className="rule-exercise-read">
        <span className="rule-block-kicker">
          {EXERCISE_OPTIONS.find((option) => option.value === block.exerciseType)?.label}
        </span>
        <p>{block.prompt || "Задание пока не заполнено."}</p>
        {block.options.length > 0 && (
          <ol>{block.options.map((option, index) => <li key={`${block.id}-read-${index}`}>{option}</li>)}</ol>
        )}
        {block.pairs.length > 0 && (
          <div className="rule-match-read">
            {block.pairs.map((pair) => <span key={pair.id}>{pair.left}</span>)}
          </div>
        )}
        {answerVisible ? (
          <div className="rule-answer">
            <strong>Ответ:</strong> {block.answer || "—"}
            {block.explanation && <p>{block.explanation}</p>}
            {block.pairs.length > 0 && (
              <ul>{block.pairs.map((pair) => <li key={`${pair.id}-answer`}>{pair.left} — {pair.right}</li>)}</ul>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="mini-action"
            onClick={() => setRevealedAnswerIds((current) => [...current, block.id])}
          >
            показать ответ
          </button>
        )}
      </div>
    );
  }

  function renderBlock(block: RuleBlock, index: number) {
    if (collapsedBlockIds.has(block.id)) return null;
    const isHiddenInRead = mode === "read" && block.hidden && !revealedHiddenIds.includes(block.id);
    const blockAnnotations = document.annotations.filter((annotation) => annotation.blockId === block.id);
    return (
      <article
        id={`rule-block-${block.id}`}
        key={block.id}
        className={`rule-block rule-block-${block.kind} ${document.settings.compact ? "rule-block-compact" : ""}`}
        draggable={mode === "edit" && canEdit}
        onDragStart={() => setDragBlockId(block.id)}
        onDragEnd={() => setDragBlockId(null)}
        onDragOver={(event: DragEvent<HTMLElement>) => {
          if (dragBlockId && dragBlockId !== block.id) event.preventDefault();
        }}
        onDrop={(event: DragEvent<HTMLElement>) => {
          event.preventDefault();
          if (dragBlockId) moveBlock(dragBlockId, block.id);
          setDragBlockId(null);
        }}
      >
        <div className="rule-block-head">
          <span className="rule-block-kicker">{getBlockTitle(block, index)}</span>
          {block.kind === "heading" && (
            <button type="button" className="rule-collapse-button" onClick={() => toggleHeading(block.id)}>
              {document.settings.collapsedHeadingIds.includes(block.id) ? "+" : "−"}
            </button>
          )}
          {mode === "edit" && canEdit && (
            <div className="rule-block-actions">
              <button type="button" className="mini-action" onClick={() => moveBlockByOffset(block.id, -1)} disabled={index === 0}>↑</button>
              <button type="button" className="mini-action" onClick={() => moveBlockByOffset(block.id, 1)} disabled={index === document.blocks.length - 1}>↓</button>
              <button type="button" className={`mini-action ${block.hidden ? "text-tool-button-active" : ""}`} onClick={() => updateBlock(block.id, (current) => ({ ...current, hidden: !current.hidden }))}>
                {block.hidden ? "скрыт" : "скрыть"}
              </button>
              <button type="button" className="mini-action danger-action" onClick={() => deleteBlock(block.id)}>удалить</button>
            </div>
          )}
        </div>

        {isHiddenInRead ? (
          <div className="rule-hidden-placeholder">
            <span>Скрытый учебный блок</span>
            <button type="button" className="mini-action" onClick={() => setRevealedHiddenIds((current) => [...current, block.id])}>
              показать
            </button>
          </div>
        ) : block.kind === "exercise" ? (
          mode === "edit" && canEdit ? renderExerciseEditor(block) : renderExerciseRead(block)
        ) : mode === "edit" && canEdit ? (
          <>
            {block.kind === "heading" && (
              <label className="rule-heading-level">
                уровень
                <select value={block.level} onChange={(event) => updateBlock(block.id, (current) =>
                  current.kind === "heading" ? { ...current, level: event.target.value === "2" ? 2 : 1 } : current
                )}>
                  <option value="1">глава</option>
                  <option value="2">подраздел</option>
                </select>
              </label>
            )}
            <textarea
              className={block.kind === "heading" ? `rule-heading-input rule-heading-input-${block.level}` : "rule-textarea"}
              value={block.text}
              onChange={(event) => updateBlock(block.id, (current) =>
                current.kind !== "exercise" ? { ...current, text: event.target.value } : current
              )}
              onSelect={(event) => openSelectionAnnotation(block.id, event.currentTarget)}
              rows={block.kind === "heading" ? 1 : 5}
              placeholder={block.kind === "heading" ? "Название главы" : "Текст блока"}
            />
            {blockAnnotations.length > 0 && (
              <div className="rule-annotation-list">
                {blockAnnotations.map((annotation) => (
                  <button
                    key={annotation.id}
                    type="button"
                    className={!annotation.resolved ? "rule-annotation-unresolved" : ""}
                    onClick={() => editAnnotation(annotation)}
                  >
                    {annotation.resolved ? "✦" : "!"} {annotation.targetText}
                  </button>
                ))}
              </div>
            )}
            {annotationDraft.blockId === block.id && renderAnnotationForm()}
          </>
        ) : block.kind === "heading" ? (
          block.level === 1
            ? <h2>{renderAnnotatedText(block)}</h2>
            : <h3>{renderAnnotatedText(block)}</h3>
        ) : (
          renderAnnotatedText(block)
        )}
      </article>
    );
  }

  return (
    <div className="rule-editor-shell" role="dialog" aria-modal="true" aria-label="Rule editor">
      <header className="rule-editor-header">
        <button type="button" className="mini-action" onClick={closeEditor}>← назад</button>
        <input
          className="rule-title-input"
          value={document.title}
          onChange={(event) => updateDocument((current) => ({ ...current, title: event.target.value }))}
          readOnly={!canEdit}
          aria-label="Название Rule-документа"
        />
        <span className={`rule-save-state rule-save-state-${saveState}`}>
          {saveState === "saving" ? "сохраняется…" : saveState === "error" ? "ошибка сохранения" : "сохранено"}
        </span>
        <div className="rule-header-actions">
          {canEdit && <button type="button" className="mini-action" onClick={() => void onSave()}>сохранить</button>}
          <button type="button" className="mini-action" onClick={handleExportJson}>.rule.json</button>
          <button type="button" className="mini-action" onClick={handleExportMarkdown}>.rule.md</button>
          {canEdit && <button type="button" className="mini-action" onClick={() => importInputRef.current?.click()}>импорт</button>}
          <button type="button" className="mini-action" onClick={() => setSidebarTab("search")}>поиск</button>
          <button type="button" className="mini-action" onClick={() => setMode((current) => current === "edit" ? "read" : canEdit ? "edit" : "read")}>
            {mode === "edit" ? "чтение" : canEdit ? "редактирование" : "только чтение"}
          </button>
          <button type="button" className="mini-action" onClick={() => setShowSettings((current) => !current)}>настройки</button>
        </div>
        <input ref={importInputRef} type="file" accept=".json,.rule.json,application/json" hidden onChange={(event) => void handleImport(event)} />
      </header>

      {(localNotice || unresolvedAnnotationCount > 0) && (
        <div className="rule-editor-notice">
          {localNotice || `${unresolvedAnnotationCount} пометок требуют повторной привязки.`}
          <button type="button" onClick={() => setLocalNotice(null)}>×</button>
        </div>
      )}

      {showSettings && (
        <section className="rule-settings-panel">
          <label>
            масштаб текста
            <input
              type="range"
              min="70"
              max="250"
              step="10"
              value={document.settings.textScale}
              onChange={(event) => updateSettings({ textScale: Number(event.target.value) })}
            />
            <span>{document.settings.textScale}%</span>
          </label>
          <label className="rule-check-label"><input type="checkbox" checked={document.settings.compact} onChange={(event) => updateSettings({ compact: event.target.checked })} /> компактный режим</label>
          <label className="rule-check-label"><input type="checkbox" checked={document.settings.showToc} onChange={(event) => updateSettings({ showToc: event.target.checked })} /> показывать оглавление</label>
          <label className="rule-check-label"><input type="checkbox" checked={document.settings.showGlossary} onChange={(event) => updateSettings({ showGlossary: event.target.checked })} /> показывать словарь</label>
          <label className="rule-check-label"><input type="checkbox" checked={document.settings.showAnswers} onChange={(event) => updateSettings({ showAnswers: event.target.checked })} /> сразу показывать ответы</label>
          <label className="rule-settings-tags">
            теги документа
            <input value={document.tags.join(", ")} onChange={(event) => updateDocument((current) => ({ ...current, tags: splitList(event.target.value) }))} placeholder="grammar, english" />
          </label>
        </section>
      )}

      <div className="rule-editor-layout">
        <aside className="rule-sidebar">
          <div className="rule-sidebar-tabs">
            <button type="button" className={sidebarTab === "toc" ? "active" : ""} onClick={() => setSidebarTab("toc")}>оглавление</button>
            <button type="button" className={sidebarTab === "search" ? "active" : ""} onClick={() => setSidebarTab("search")}>поиск</button>
            <button type="button" className={sidebarTab === "glossary" ? "active" : ""} onClick={() => setSidebarTab("glossary")}>словарь</button>
          </div>
          {sidebarTab === "toc" && (
            <div className="rule-sidebar-content">
              {!document.settings.showToc ? <p>Оглавление скрыто в настройках.</p> : document.blocks.filter((block) => block.kind === "heading").length === 0 ? <p>Добавьте заголовки, чтобы собрать оглавление.</p> : document.blocks.map((block) => block.kind === "heading" && (
                <button key={block.id} type="button" className={`rule-toc-item rule-toc-level-${block.level}`} onClick={() => navigateToBlock(block.id)}>
                  {block.text || "Без названия"}
                </button>
              ))}
            </div>
          )}
          {sidebarTab === "search" && (
            <div className="rule-sidebar-content">
              <input ref={searchInputRef} className="rule-search-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Поиск по Rule…" />
              <small>{searchQuery ? `${searchResults.length} совпадений` : "Текст, упражнения, пометки и словарь"}</small>
              <div className="rule-search-results">
                {searchResults.map((result) => (
                  <button key={result.id} type="button" onClick={() => result.blockId && navigateToBlock(result.blockId)}>
                    <strong>{result.label}</strong>
                    <span>{result.preview}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {sidebarTab === "glossary" && (
            <div className="rule-sidebar-content rule-glossary-panel">
              {!document.settings.showGlossary ? <p>Словарь скрыт в настройках.</p> : (
                <>
                  {document.glossary.map((entry) => (
                    <div key={entry.id} className="rule-glossary-entry">
                      {mode === "edit" && canEdit ? (
                        <>
                          <input value={entry.term} onChange={(event) => updateGlossaryEntry(entry.id, { term: event.target.value })} placeholder="Слово или выражение" />
                          <input value={entry.translation} onChange={(event) => updateGlossaryEntry(entry.id, { translation: event.target.value })} placeholder="Перевод" />
                          <textarea value={entry.explanation} onChange={(event) => updateGlossaryEntry(entry.id, { explanation: event.target.value })} placeholder="Пояснение" rows={2} />
                          <textarea value={entry.examples.join("\n")} onChange={(event) => updateGlossaryEntry(entry.id, { examples: splitList(event.target.value) })} placeholder="Примеры, каждый с новой строки" rows={2} />
                          <input value={entry.tags.join(", ")} onChange={(event) => updateGlossaryEntry(entry.id, { tags: splitList(event.target.value) })} placeholder="Теги" />
                          <button type="button" className="mini-action danger-action" onClick={() => deleteGlossaryEntry(entry.id)}>удалить</button>
                        </>
                      ) : (
                        <>
                          <strong>{entry.term}</strong>
                          <span>{entry.translation}</span>
                          {entry.explanation && <p>{entry.explanation}</p>}
                          {entry.examples.map((example) => <small key={example}>{example}</small>)}
                        </>
                      )}
                    </div>
                  ))}
                  {mode === "edit" && canEdit && <button type="button" className="mini-action" onClick={addGlossaryEntry}>+ слово</button>}
                </>
              )}
            </div>
          )}
        </aside>

        <main className="rule-document" style={{ fontSize: `${document.settings.textScale}%` }}>
          {mode === "edit" && canEdit && (
            <div className="rule-add-toolbar">
              <select value={newBlockKind} onChange={(event) => setNewBlockKind(event.target.value as RuleTextKind | "heading" | "exercise")}>
                {BLOCK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {newBlockKind === "exercise" && (
                <select value={newExerciseType} onChange={(event) => setNewExerciseType(event.target.value as RuleExerciseType)}>
                  {EXERCISE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              )}
              <button type="button" className="mini-action" onClick={addBlock}>+ добавить блок</button>
              <span>Блоки можно перетаскивать.</span>
            </div>
          )}
          <div className="rule-block-list">
            {document.blocks.length === 0 ? <p className="rule-empty">Документ пуст. Добавьте первый блок.</p> : document.blocks.map(renderBlock)}
          </div>
        </main>
      </div>
    </div>
  );
}
