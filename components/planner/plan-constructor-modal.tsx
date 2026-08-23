"use client";

import { useMemo, useState } from "react";

import type { Locale } from "@/lib/i18n";
import {
  type PlannerBlock,
  type PlannerCommitmentLevel,
  type PlannerConstructorOperation,
  type PlannerDraft,
  type PlannerEstimateMode,
  type PlannerItem,
  type PlannerPriority,
  type PlannerProfile,
  type PlannerUncertaintyPolicy,
} from "@/lib/planner/types";
import {
  addIsoMinutes,
  addPlannerDays,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  isoDurationMinutes,
  plannerTimeToMinutes,
  zonedPlannerDateTimeToUtc,
} from "@/lib/planner/time";
import styles from "./planner-workspace.module.css";

export type ConstructorAction =
  | "add" | "edit" | "priorities" | "move" | "cancel" | "replace" | "time" | "duration"
  | "protect" | "occupy" | "sleep" | "day_bounds" | "rebuild";

type Props = {
  profile: PlannerProfile;
  items: PlannerItem[];
  blocks: PlannerBlock[];
  currentBlock?: PlannerBlock | null;
  selectedDate: string;
  now: Date;
  locale: Locale;
  busy: boolean;
  initialAction?: ConstructorAction;
  initialBlockId?: string;
  onClose: () => void;
  onReview: (operation: PlannerConstructorOperation) => Promise<void>;
};

const actionGroups: Array<{ titleRu: string; titleEn: string; actions: Array<{ id: ConstructorAction; ru: string; en: string; hintRu: string; hintEn: string }> }> = [
  { titleRu: "Дела", titleEn: "Items", actions: [
    { id: "add", ru: "Добавить дело", en: "Add item", hintRu: "Новое гибкое дело или событие", hintEn: "A flexible item or fixed event" },
    { id: "edit", ru: "Изменить дело", en: "Edit item", hintRu: "Название, обязательность и гибкость", hintEn: "Title, commitment and flexibility" },
    { id: "move", ru: "Перенести дело", en: "Move item", hintRu: "Дата, время, до или после другого дела", hintEn: "Date, time, before or after another item" },
    { id: "replace", ru: "Заменить дело", en: "Replace item", hintRu: "В том числе текущее", hintEn: "Including the current item" },
    { id: "cancel", ru: "Отменить дело", en: "Cancel item", hintRu: "Одно выполнение или всё дело", hintEn: "One occurrence or the whole item" },
    { id: "duration", ru: "Изменить длительность", en: "Change duration", hintRu: "Точно, примерно или диапазоном", hintEn: "Exact, approximate or range" },
    { id: "time", ru: "Изменить начало или конец", en: "Change start or end", hintRu: "Для конкретного блока календаря", hintEn: "For a specific calendar block" },
  ] },
  { titleRu: "Время и день", titleEn: "Time and day", actions: [
    { id: "protect", ru: "Освободить промежуток", en: "Protect free interval", hintRu: "Автоплан не займёт это время", hintEn: "Autoplanning will keep it free" },
    { id: "occupy", ru: "Занять промежуток", en: "Occupy interval", hintRu: "Добавить новое фиксированное дело", hintEn: "Add a new fixed event" },
    { id: "day_bounds", ru: "Изменить границы дня", en: "Change day boundaries", hintRu: "Разово для выбранной даты", hintEn: "One-off for a selected date" },
  ] },
  { titleRu: "Сон и пересборка", titleEn: "Sleep and rebuild", actions: [
    { id: "sleep", ru: "Установить сон или подъём", en: "Set bedtime or wake-up", hintRu: "Жёсткая граница выбранной ночи", hintEn: "A hard boundary for the selected night" },
    { id: "rebuild", ru: "Пересобрать остаток дня", en: "Rebuild the rest of the day", hintRu: "Сейчас или с выбранного момента", hintEn: "From now or a selected moment" },
    { id: "priorities", ru: "Приоритеты и порядок", en: "Priorities and order", hintRu: "Настроить обязательность всех дел", hintEn: "Set commitment for all items" },
  ] },
];

function endOnDate(date: string, start: string, end: string, timezone: string): string {
  return zonedPlannerDateTimeToUtc(
    plannerTimeToMinutes(end) <= plannerTimeToMinutes(start) ? addPlannerDays(date, 1) : date,
    end,
    timezone
  );
}

function durationPolicy(mode: PlannerEstimateMode, likely: number, minimum: number, maximum: number, canReduce: boolean): PlannerUncertaintyPolicy {
  const safeLikely = Math.max(5, Math.round(likely));
  const safeMinimum = mode === "exact" || mode === "unknown" ? safeLikely : Math.max(5, Math.min(safeLikely, Math.round(minimum)));
  const safeMaximum = mode === "exact" || mode === "unknown" ? safeLikely : Math.max(safeLikely, Math.round(maximum));
  return {
    outcomeMode: "deliverable",
    duration: {
      mode,
      minMinutes: safeMinimum,
      likelyMinutes: safeLikely,
      maxMinutes: safeMaximum,
      tolerancePercent: mode === "approximate" ? 30 : undefined,
      calibrationMinutes: mode === "unknown" ? safeLikely : undefined,
      source: "user",
    },
    date: { mode: "any" },
    time: { mode: "any" },
    recurrence: { mode: "exact_days", period: "week", minOccurrences: 1, likelyOccurrences: 1, maxOccurrences: 1, allowedWeekdays: [] },
    deadline: { mode: "none" },
    reduction: canReduce ? { mode: "to_minimum", minimumMinutes: safeMinimum } : { mode: "forbidden" },
  };
}

export default function PlanConstructorModal({
  profile, items, blocks, currentBlock, selectedDate, now, locale, busy,
  initialAction, initialBlockId, onClose, onReview,
}: Props) {
  const ru = locale === "ru";
  const activeItems = useMemo(() => items.filter((item) => item.status === "active"), [items]);
  const futureBlocks = useMemo(() => blocks.filter((block) => !["done", "cancelled", "skipped"].includes(block.status) && new Date(block.endAt) > now), [blocks, now]);
  const [action, setAction] = useState<ConstructorAction | null>(initialAction ?? null);
  const [targetBlockId, setTargetBlockId] = useState(initialBlockId ?? currentBlock?.id ?? futureBlocks[0]?.id ?? "");
  const targetBlock = futureBlocks.find((block) => block.id === targetBlockId);
  const [targetItemId, setTargetItemId] = useState(targetBlock?.itemId ?? activeItems[0]?.id ?? "");
  const targetItem = activeItems.find((item) => item.id === targetItemId);
  const targetItemBlocks = useMemo(() => futureBlocks.filter((block) => block.itemId === targetItemId), [futureBlocks, targetItemId]);
  const editingInitialItem = initialAction === "edit" || initialAction === "duration" ? targetItem : undefined;
  const [scope, setScope] = useState<"occurrence" | "future" | "item">("occurrence");
  const [title, setTitle] = useState(initialAction === "edit" ? targetItem?.title ?? "" : "");
  const [location, setLocation] = useState(initialAction === "edit" ? targetItem?.location ?? "" : "");
  const [notes, setNotes] = useState(initialAction === "edit" ? targetItem?.notes ?? "" : "");
  const [kind, setKind] = useState<"flexible_task" | "fixed_event">(targetItem?.kind === "fixed_event" && initialAction === "edit" ? "fixed_event" : "flexible_task");
  const [date, setDate] = useState(targetBlock ? formatDateInTimeZone(new Date(targetBlock.startAt), profile.timezone) : selectedDate);
  const [start, setStart] = useState(targetBlock ? formatTimeInTimeZone(new Date(targetBlock.startAt), profile.timezone) : "18:00");
  const [end, setEnd] = useState(targetBlock ? formatTimeInTimeZone(new Date(targetBlock.endAt), profile.timezone) : "19:00");
  const [endMode, setEndMode] = useState<"exact" | "approximate" | "range" | "duration" | "unknown">("exact");
  const [endFrom, setEndFrom] = useState("18:45");
  const [endTo, setEndTo] = useState("19:30");
  const [tolerance, setTolerance] = useState("30");
  const [durationMode, setDurationMode] = useState<PlannerEstimateMode>(editingInitialItem?.uncertaintyPolicy.duration.mode ?? "exact");
  const [duration, setDuration] = useState(String(editingInitialItem?.uncertaintyPolicy.duration.likelyMinutes ?? 60));
  const [minimumDuration, setMinimumDuration] = useState(String(editingInitialItem?.uncertaintyPolicy.duration.minMinutes ?? 30));
  const [maximumDuration, setMaximumDuration] = useState(String(editingInitialItem?.uncertaintyPolicy.duration.maxMinutes ?? 90));
  const [canReduce, setCanReduce] = useState(editingInitialItem?.uncertaintyPolicy.reduction?.mode === "to_minimum");
  const [priority, setPriority] = useState<PlannerPriority>(editingInitialItem?.priority ?? "normal");
  const [commitment, setCommitment] = useState<PlannerCommitmentLevel>(editingInitialItem?.commitmentLevel ?? "required");
  const [canMoveDay, setCanMoveDay] = useState(editingInitialItem ? editingInitialItem.uncertaintyPolicy.date.mode !== "exact" : true);
  const [timeFlexibility, setTimeFlexibility] = useState<"exact" | "preferred" | "any">(editingInitialItem?.uncertaintyPolicy.time.mode === "preferred" ? "preferred" : editingInitialItem?.uncertaintyPolicy.time.mode === "any" || !editingInitialItem ? "any" : "exact");
  const [placementMode, setPlacementMode] = useState<"date" | "exact" | "before" | "after" | "first_free">("date");
  const [firstFreeInHorizon, setFirstFreeInHorizon] = useState(false);
  const [anchorBlockId, setAnchorBlockId] = useState("");
  const [replaceDurationMode, setReplaceDurationMode] = useState<"same" | "minutes" | "until_next" | "until">("same");
  const [sleepBoundary, setSleepBoundary] = useState<"bedtime" | "wake">("bedtime");
  const [bulkCommitments, setBulkCommitments] = useState<Record<string, PlannerCommitmentLevel>>(() => Object.fromEntries(activeItems.map((item) => [item.id, item.commitmentLevel])));
  const [bulkRanks, setBulkRanks] = useState<Record<string, number>>(() => Object.fromEntries(activeItems.map((item) => [item.id, item.planningRank])));
  const [bulkMoveDays, setBulkMoveDays] = useState<Record<string, boolean>>(() => Object.fromEntries(activeItems.map((item) => [item.id, item.uncertaintyPolicy.date.mode !== "exact"])));
  const [bulkReductions, setBulkReductions] = useState<Record<string, boolean>>(() => Object.fromEntries(activeItems.map((item) => [item.id, item.uncertaintyPolicy.reduction?.mode === "to_minimum"])));
  const [rebuildDecisions, setRebuildDecisions] = useState<Record<string, "required" | "desired" | "if_time" | "cancel">>({});
  const [rebuildBedtime, setRebuildBedtime] = useState(false);
  const [error, setError] = useState("");

  function populateItem(nextItem: PlannerItem) {
    setTitle(nextItem.title);
    setLocation(nextItem.location ?? "");
    setNotes(nextItem.notes ?? "");
    setKind(nextItem.kind === "fixed_event" ? "fixed_event" : "flexible_task");
    setDuration(String(nextItem.uncertaintyPolicy.duration.likelyMinutes));
    setMinimumDuration(String(nextItem.uncertaintyPolicy.duration.minMinutes));
    setMaximumDuration(String(nextItem.uncertaintyPolicy.duration.maxMinutes));
    setDurationMode(nextItem.uncertaintyPolicy.duration.mode);
    setPriority(nextItem.priority);
    setCommitment(nextItem.commitmentLevel);
    setCanMoveDay(nextItem.uncertaintyPolicy.date.mode !== "exact");
    setTimeFlexibility(nextItem.uncertaintyPolicy.time.mode === "preferred" ? "preferred" : nextItem.uncertaintyPolicy.time.mode === "any" ? "any" : "exact");
    setCanReduce(nextItem.uncertaintyPolicy.reduction?.mode === "to_minimum");
  }

  function selectBlock(blockId: string) {
    setTargetBlockId(blockId);
    const block = futureBlocks.find((candidate) => candidate.id === blockId);
    if (!block) return;
    setTargetItemId(block.itemId ?? "");
    setDate(formatDateInTimeZone(new Date(block.startAt), profile.timezone));
    setStart(formatTimeInTimeZone(new Date(block.startAt), profile.timezone));
    setEnd(formatTimeInTimeZone(new Date(block.endAt), profile.timezone));
    const item = block.itemId ? activeItems.find((candidate) => candidate.id === block.itemId) : undefined;
    if (item && (action === "edit" || action === "duration")) populateItem(item);
  }

  function selectItem(itemId: string) {
    setTargetItemId(itemId);
    const item = activeItems.find((candidate) => candidate.id === itemId);
    if (item) populateItem(item);
    setTargetBlockId(futureBlocks.find((block) => block.itemId === itemId)?.id ?? "");
  }

  function chooseAction(nextAction: ConstructorAction) {
    setAction(nextAction);
    if ((nextAction === "edit" || nextAction === "duration") && targetItem) populateItem(targetItem);
  }

  function fixedDraft(forceTitle?: string): PlannerDraft {
    const startAt = zonedPlannerDateTimeToUtc(date, start, profile.timezone);
    let likelyEnd = endOnDate(date, start, end, profile.timezone);
    let estimate: PlannerDraft["endEstimate"] = { mode: "exact", likelyAt: likelyEnd };
    if (endMode === "duration") {
      likelyEnd = addIsoMinutes(startAt, Math.max(5, Number(duration) || 60));
      estimate = { mode: "exact", likelyAt: likelyEnd };
    } else if (endMode === "approximate") {
      const minutes = Math.max(5, Number(tolerance) || 30);
      estimate = { mode: "approximate", earliestAt: addIsoMinutes(likelyEnd, -minutes), likelyAt: likelyEnd, latestAt: addIsoMinutes(likelyEnd, minutes), toleranceMinutes: minutes };
    } else if (endMode === "range") {
      const earliestAt = endOnDate(date, start, endFrom, profile.timezone);
      const latestAt = endOnDate(date, start, endTo, profile.timezone);
      if (new Date(latestAt) <= new Date(earliestAt)) throw new Error(ru ? "Конец диапазона должен быть позже начала." : "The range end must be later than its start.");
      likelyEnd = new Date((new Date(earliestAt).getTime() + new Date(latestAt).getTime()) / 2).toISOString();
      estimate = { mode: "range", earliestAt, likelyAt: likelyEnd, latestAt };
    } else if (endMode === "unknown") {
      const windows = profile.availabilityOverrides[date] ?? profile.availability[String(new Date(`${date}T00:00:00Z`).getUTCDay() || 7)] ?? [];
      const boundary = windows.at(-1)?.end ?? (profile.sleepSchedule.mode === "fixed" ? profile.sleepSchedule.weekdays.bedtime : "23:00");
      likelyEnd = endOnDate(date, start, boundary, profile.timezone);
      estimate = { mode: "unknown" };
    }
    const likelyMinutes = Math.max(5, isoDurationMinutes(startAt, likelyEnd));
    return {
      title: forceTitle ?? title.trim(),
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      kind: "fixed_event",
      date,
      start,
      end: formatTimeInTimeZone(new Date(likelyEnd), profile.timezone),
      endEstimate: estimate,
      estimateMinutes: likelyMinutes,
      priority,
      commitmentLevel: commitment,
      uncertaintyPolicy: durationPolicy(endMode === "range" ? "range" : endMode === "approximate" ? "approximate" : endMode === "unknown" ? "unknown" : "exact", likelyMinutes, likelyMinutes, estimate.latestAt ? isoDurationMinutes(startAt, estimate.latestAt) : likelyMinutes, false),
    };
  }

  function flexibleDraft(existing?: PlannerItem): PlannerDraft {
    const likely = Math.max(5, Number(duration) || 60);
    const policy = durationPolicy(durationMode, likely, Number(minimumDuration) || likely, Number(maximumDuration) || likely, canReduce);
    policy.date = canMoveDay ? { mode: "any", preferredDate: date } : { mode: "exact", exactDate: date };
    policy.time = timeFlexibility === "preferred" ? { mode: "preferred", preferredStart: start } : timeFlexibility === "exact" ? { mode: "exact", exactStart: start } : { mode: "any" };
    return {
      ...existing,
      title: title.trim(),
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      kind: "flexible_task",
      estimateMinutes: likely,
      priority,
      commitmentLevel: commitment,
      uncertaintyPolicy: policy,
      date,
      start: timeFlexibility === "exact" ? start : undefined,
    };
  }

  function buildOperation(): PlannerConstructorOperation {
    if (!action) throw new Error(ru ? "Выберите действие." : "Choose an action.");
    if ((action === "add" || action === "occupy" || action === "replace") && !title.trim()) throw new Error(ru ? "Укажите название дела." : "Enter an item title.");
    if (action === "add") return { kind: "add_item", draft: kind === "fixed_event" ? fixedDraft() : flexibleDraft() };
    if (action === "occupy") return { kind: "occupy_interval", draft: fixedDraft() };
    if (action === "edit") {
      if (!targetItem) throw new Error(ru ? "Выберите дело." : "Choose an item.");
      return { kind: "edit_item", draft: targetItem.kind === "fixed_event" ? { ...targetItem, title: title.trim(), location: location.trim() || undefined, notes: notes.trim() || undefined, priority, commitmentLevel: commitment } : flexibleDraft(targetItem), scope: targetItem.recurrence ? scope : "item", blockId: targetItem.recurrence ? targetBlockId : undefined };
    }
    if (action === "priorities") return {
      kind: "bulk_update_items",
      drafts: activeItems.map((item) => ({
        ...item,
        commitmentLevel: bulkCommitments[item.id] ?? item.commitmentLevel,
        planningRank: bulkRanks[item.id] ?? item.planningRank,
        uncertaintyPolicy: {
          ...item.uncertaintyPolicy,
          date: bulkMoveDays[item.id]
            ? item.uncertaintyPolicy.date.mode === "exact" ? { mode: "any" as const } : item.uncertaintyPolicy.date
            : { mode: "exact" as const, exactDate: item.uncertaintyPolicy.date.exactDate ?? date },
          reduction: bulkReductions[item.id]
            ? { mode: "to_minimum" as const, minimumMinutes: Math.min(item.uncertaintyPolicy.duration.likelyMinutes, item.uncertaintyPolicy.duration.minMinutes) }
            : { mode: "forbidden" as const },
        },
      })),
    };
    if (action === "duration") {
      if (!targetItem) throw new Error(ru ? "Выберите дело." : "Choose an item.");
      const policy = durationPolicy(durationMode, Number(duration), Number(minimumDuration), Number(maximumDuration), canReduce);
      return { kind: "change_item_duration", itemId: targetItem.id, duration: policy.duration, reduction: policy.reduction, scope: targetItem.recurrence ? scope : "item", blockId: targetItem.recurrence ? targetBlockId : undefined };
    }
    if (action === "protect") return { kind: "protect_interval", date, start, end };
    if (action === "day_bounds") return { kind: "set_day_bounds", date, start, end };
    if (action === "sleep") return { kind: "set_sleep_boundary", boundary: sleepBoundary, date, time: start };
    if (action === "rebuild") return {
      kind: "rebuild_remaining",
      fromAt: zonedPlannerDateTimeToUtc(date, start, profile.timezone),
      decisions: Object.entries(rebuildDecisions).map(([itemId, disposition]) => ({ itemId, disposition })),
      bedtime: rebuildBedtime ? { date, time: end } : undefined,
    };
    if (!targetBlock) throw new Error(ru ? "Выберите выполнение в календаре." : "Choose a calendar occurrence.");
    if (action === "cancel") return { kind: "cancel_item", blockId: targetBlock.id, itemId: targetBlock.itemId, scope };
    if (action === "time") return {
      kind: "change_block_time",
      blockId: targetBlock.id,
      scope,
      startAt: zonedPlannerDateTimeToUtc(date, start, profile.timezone),
      endAt: endOnDate(date, start, end, profile.timezone),
    };
    if (action === "move") {
      const placement = placementMode === "exact" ? { mode: "exact" as const, date, start }
        : placementMode === "date" ? { mode: "date" as const, date }
          : placementMode === "first_free" ? { mode: "first_free" as const, date: firstFreeInHorizon ? undefined : date }
            : { mode: placementMode, anchorBlockId, gapMinutes: profile.defaultBufferMinutes } as const;
      return { kind: "move_item", blockId: targetBlock.id, scope, placement };
    }
    const replaceDuration = replaceDurationMode === "same" ? { mode: "same" as const }
      : replaceDurationMode === "minutes" ? { mode: "minutes" as const, minutes: Math.max(5, Number(duration) || 60) }
        : replaceDurationMode === "until_next" ? { mode: "until_next" as const }
          : { mode: "until" as const, date, time: end };
    return { kind: "replace_item", blockId: targetBlock.id, scope, replacement: flexibleDraft(), duration: replaceDuration };
  }

  async function submit() {
    setError("");
    try {
      await onReview(buildOperation());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (ru ? "Проверьте параметры." : "Check the parameters."));
    }
  }

  const needsBlock = action === "move" || action === "cancel" || action === "replace" || action === "time";
  const needsItem = action === "edit" || action === "duration";
  const showCommonItem = action === "add" || action === "edit";

  return <div className={styles.modalBackdrop} role="presentation"><section className={`${styles.modal} ${styles.constructorModal}`} role="dialog" aria-modal="true" aria-label={ru ? "Конструктор плана" : "Plan constructor"}>
    <header><div><h2>{ru ? "Конструктор плана" : "Plan constructor"}</h2><small>{action ? (ru ? "2 из 3 · параметры" : "2 of 3 · parameters") : (ru ? "1 из 3 · действие" : "1 of 3 · action")}</small></div><button type="button" onClick={onClose} aria-label={ru ? "Закрыть" : "Close"}>×</button></header>
    {!action ? <div className={styles.constructorCatalog}>{actionGroups.map((group) => <section key={group.titleEn}><h3>{ru ? group.titleRu : group.titleEn}</h3><div className={styles.constructorActions}>{group.actions.map((entry) => <button type="button" key={entry.id} onClick={() => chooseAction(entry.id)}><strong>{ru ? entry.ru : entry.en}</strong><small>{ru ? entry.hintRu : entry.hintEn}</small></button>)}</div></section>)}</div> : <div className={styles.form}>
      <button type="button" className={styles.constructorBack} onClick={() => { setAction(null); setError(""); }}>← {ru ? "Все действия" : "All actions"}</button>
      {error && <p className={styles.inlineError} role="alert">{error}</p>}
      {needsBlock && <label>{ru ? "Выполнение" : "Occurrence"}<select value={targetBlockId} onChange={(event) => selectBlock(event.target.value)}>{futureBlocks.map((block) => <option value={block.id} key={block.id}>{block.id === currentBlock?.id ? (ru ? "Текущее — " : "Current — ") : ""}{block.title} · {formatDateInTimeZone(new Date(block.startAt), profile.timezone)} {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}</option>)}</select></label>}
      {needsItem && <label>{ru ? "Дело" : "Item"}<select value={targetItemId} onChange={(event) => selectItem(event.target.value)}>{activeItems.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}
      {needsItem && targetItem?.recurrence && <label>{ru ? "Выполнение" : "Occurrence"}<select value={targetBlockId} onChange={(event) => selectBlock(event.target.value)}>{targetItemBlocks.map((block) => <option value={block.id} key={block.id}>{formatDateInTimeZone(new Date(block.startAt), profile.timezone)} · {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}</option>)}</select></label>}
      {((needsBlock || needsItem) && targetItem?.recurrence) && <fieldset><legend>{ru ? "Область изменения" : "Change scope"}</legend><div className={styles.segmented}>{(["occurrence", "future", "item"] as const).map((value) => <button type="button" key={value} className={scope === value ? styles.segmentedActive : ""} onClick={() => setScope(value)}>{value === "occurrence" ? (ru ? "Только это" : "This occurrence") : value === "future" ? (ru ? "Будущие" : "Future") : (ru ? "Всё дело" : "Whole item")}</button>)}</div></fieldset>}
      {(action === "add" || action === "occupy" || action === "replace") && <label>{ru ? "Название" : "Title"}<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label>}
      {(action === "add" || action === "edit" || action === "occupy" || action === "replace") && <div className={styles.formGrid}><label>{ru ? "Адрес или место (не интерпретируется)" : "Address or place (not interpreted)"}<input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={240} /></label><label>{ru ? "Заметка (не интерпретируется)" : "Note (not interpreted)"}<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} /></label></div>}
      {showCommonItem && <>
        {action === "add" && <fieldset><legend>{ru ? "Тип" : "Type"}</legend><div className={styles.segmented}><button type="button" className={kind === "flexible_task" ? styles.segmentedActive : ""} onClick={() => setKind("flexible_task")}>{ru ? "Гибкое дело" : "Flexible item"}</button><button type="button" className={kind === "fixed_event" ? styles.segmentedActive : ""} onClick={() => setKind("fixed_event")}>{ru ? "Фиксированное событие" : "Fixed event"}</button></div></fieldset>}
        <div className={styles.formGrid}><label>{ru ? "Обязательность" : "Commitment"}<select value={commitment} onChange={(event) => setCommitment(event.target.value as PlannerCommitmentLevel)}><option value="must_not_skip">{ru ? "Нельзя пропустить" : "Must not skip"}</option><option value="required">{ru ? "Обязательное" : "Required"}</option><option value="desired">{ru ? "Желательное" : "Desired"}</option><option value="if_time">{ru ? "Если останется время" : "If time remains"}</option></select></label><label>{ru ? "Приоритет" : "Priority"}<select value={priority} onChange={(event) => setPriority(event.target.value as PlannerPriority)}><option value="low">{ru ? "Низкий" : "Low"}</option><option value="normal">{ru ? "Обычный" : "Normal"}</option><option value="high">{ru ? "Высокий" : "High"}</option><option value="critical">{ru ? "Критический" : "Critical"}</option></select></label></div>
      </>}
      {((action === "add" && kind === "flexible_task") || action === "edit" || action === "duration") && <>
        <div className={styles.formGrid}><label>{ru ? "Точность длительности" : "Duration certainty"}<select value={durationMode} onChange={(event) => setDurationMode(event.target.value as PlannerEstimateMode)}><option value="exact">{ru ? "Точно" : "Exact"}</option><option value="approximate">{ru ? "Примерно" : "Approximate"}</option><option value="range">{ru ? "Диапазон" : "Range"}</option><option value="unknown">{ru ? "Пока неизвестно" : "Unknown"}</option></select></label><label>{durationMode === "unknown" ? (ru ? "Пробная сессия, мин" : "Trial session, min") : (ru ? "Обычно, мин" : "Usually, min")}<input type="number" min="5" value={duration} onChange={(event) => setDuration(event.target.value)} /></label></div>
        {(durationMode === "approximate" || durationMode === "range") && <div className={styles.formGrid}><label>{ru ? "Минимум, мин" : "Minimum, min"}<input type="number" min="5" value={minimumDuration} onChange={(event) => setMinimumDuration(event.target.value)} /></label><label>{ru ? "Максимум, мин" : "Maximum, min"}<input type="number" min="5" value={maximumDuration} onChange={(event) => setMaximumDuration(event.target.value)} /></label></div>}
        <label className={styles.choiceCheck}><input type="checkbox" checked={canReduce} onChange={(event) => setCanReduce(event.target.checked)} />{ru ? "При конфликте можно сокращать только до указанного минимума" : "Conflicts may reduce it only to the stated minimum"}</label>
        {action !== "duration" && <><label className={styles.choiceCheck}><input type="checkbox" checked={canMoveDay} onChange={(event) => setCanMoveDay(event.target.checked)} />{ru ? "Можно переносить на другой день" : "May move to another day"}</label><label>{ru ? "Гибкость времени" : "Time flexibility"}<select value={timeFlexibility} onChange={(event) => setTimeFlexibility(event.target.value as typeof timeFlexibility)}><option value="any">{ru ? "Полностью гибкое" : "Fully flexible"}</option><option value="preferred">{ru ? "Можно немного двигать" : "May move a little"}</option><option value="exact">{ru ? "Фиксированное время" : "Fixed time"}</option></select></label></>}
      </>}
      {((action === "add" && kind === "fixed_event") || action === "occupy") && <><div className={styles.formGrid}><label>{ru ? "Дата" : "Date"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>{ru ? "Начало" : "Start"}<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label></div><label>{ru ? "Когда закончится" : "When it ends"}<select value={endMode} onChange={(event) => setEndMode(event.target.value as typeof endMode)}><option value="exact">{ru ? "Точное время" : "Exact time"}</option><option value="approximate">{ru ? "Примерно в…" : "Approximately at…"}</option><option value="range">{ru ? "Диапазон" : "Range"}</option><option value="duration">{ru ? "Указать продолжительность" : "Enter duration"}</option><option value="unknown">{ru ? "Пока неизвестно" : "Unknown"}</option></select></label>{(endMode === "exact" || endMode === "approximate") && <div className={styles.formGrid}><label>{ru ? "Окончание" : "End"}<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>{endMode === "approximate" && <label>{ru ? "Погрешность, мин" : "Tolerance, min"}<select value={tolerance} onChange={(event) => setTolerance(event.target.value)}><option value="15">±15</option><option value="30">±30</option><option value="60">±60</option></select></label>}</div>}{endMode === "range" && <div className={styles.formGrid}><label>{ru ? "Не раньше" : "Not before"}<input type="time" value={endFrom} onChange={(event) => setEndFrom(event.target.value)} /></label><label>{ru ? "Не позже" : "Not after"}<input type="time" value={endTo} onChange={(event) => setEndTo(event.target.value)} /></label></div>}{endMode === "duration" && <label>{ru ? "Продолжительность, мин" : "Duration, min"}<input type="number" min="5" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>}{endMode === "unknown" && <p className={styles.fieldHelp}>{ru ? "Конец не будет придуман: оставшееся время до границы дня станет предварительно занятым." : "No end is invented: the remaining day is provisionally protected."}</p>}</>}
      {(action === "protect" || action === "day_bounds" || action === "time") && <div className={styles.formGrid}><label>{ru ? "Дата" : "Date"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>{action === "day_bounds" ? (ru ? "Начало дня" : "Day start") : (ru ? "Начало" : "Start")}<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>{action === "day_bounds" ? (ru ? "Конец дня" : "Day end") : (ru ? "Окончание" : "End")}<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>}
      {action === "move" && <><label>{ru ? "Способ переноса" : "Placement"}<select value={placementMode} onChange={(event) => setPlacementMode(event.target.value as typeof placementMode)}><option value="date">{ru ? "На выбранную дату, в то же время" : "Chosen date, same time"}</option><option value="exact">{ru ? "На точное время" : "Exact time"}</option><option value="before">{ru ? "Перед другим делом" : "Before another item"}</option><option value="after">{ru ? "После другого дела" : "After another item"}</option><option value="first_free">{ru ? "В первое свободное окно" : "First free slot"}</option></select></label>{placementMode === "first_free" && <label className={styles.choiceCheck}><input type="checkbox" checked={firstFreeInHorizon} onChange={(event) => setFirstFreeInHorizon(event.target.checked)} />{ru ? "Искать во всём горизонте, начиная с выбранной даты" : "Search the whole horizon from the chosen date"}</label>}{(placementMode === "date" || placementMode === "exact" || placementMode === "first_free") && <div className={styles.formGrid}><label>{ru ? "Дата" : "Date"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>{placementMode === "exact" && <label>{ru ? "Начало" : "Start"}<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>}</div>}{(placementMode === "before" || placementMode === "after") && <label>{ru ? "Опорное дело" : "Anchor item"}<select value={anchorBlockId} onChange={(event) => setAnchorBlockId(event.target.value)}><option value="">—</option>{futureBlocks.filter((block) => block.id !== targetBlockId).map((block) => <option value={block.id} key={block.id}>{block.title} · {formatDateInTimeZone(new Date(block.startAt), profile.timezone)} {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}</option>)}</select></label>}</>}
      {action === "replace" && <><label>{ru ? "Длительность замены" : "Replacement duration"}<select value={replaceDurationMode} onChange={(event) => setReplaceDurationMode(event.target.value as typeof replaceDurationMode)}><option value="same">{ru ? "Оставить прежнюю" : "Keep the same"}</option><option value="minutes">{ru ? "Указать новую" : "Enter a new duration"}</option><option value="until_next">{ru ? "До следующего дела" : "Until the next item"}</option><option value="until">{ru ? "До точного времени" : "Until an exact time"}</option></select></label>{replaceDurationMode === "minutes" && <label>{ru ? "Минут" : "Minutes"}<input type="number" min="5" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>}{replaceDurationMode === "until" && <div className={styles.formGrid}><label>{ru ? "Дата" : "Date"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>{ru ? "Окончание" : "End"}<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>}</>}
      {action === "sleep" && <><fieldset><legend>{ru ? "Граница сна" : "Sleep boundary"}</legend><div className={styles.segmented}><button type="button" className={sleepBoundary === "bedtime" ? styles.segmentedActive : ""} onClick={() => setSleepBoundary("bedtime")}>{ru ? "Лечь спать" : "Bedtime"}</button><button type="button" className={sleepBoundary === "wake" ? styles.segmentedActive : ""} onClick={() => setSleepBoundary("wake")}>{ru ? "Проснуться" : "Wake-up"}</button></div></fieldset><div className={styles.formGrid}><label>{ru ? "Дата" : "Date"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>{ru ? "Время" : "Time"}<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label></div><p className={styles.fieldHelp}>{ru ? "Сон станет жёсткой границей: дела после неё не будут применены молча." : "Sleep becomes a hard boundary; later work is never silently applied."}</p></>}
      {action === "rebuild" && <><div className={styles.formGrid}><label>{ru ? "Дата" : "Date"}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>{ru ? "Начать новый план" : "Start the new plan"}<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label></div><fieldset><legend>{ru ? "Что важно в остатке дня" : "What matters for the rest of the day"}</legend><div className={styles.constructorDecisionList}>{activeItems.map((item) => <label key={item.id}><span>{item.title}</span><select value={rebuildDecisions[item.id] ?? ""} onChange={(event) => setRebuildDecisions((current) => ({ ...current, [item.id]: event.target.value as "required" | "desired" | "if_time" | "cancel" }))}><option value="">{ru ? "Не менять" : "Keep current"}</option><option value="required">{ru ? "Обязательно" : "Required"}</option><option value="desired">{ru ? "Желательно" : "Desired"}</option><option value="if_time">{ru ? "Если останется время" : "If time remains"}</option><option value="cancel">{ru ? "Отменить сегодня" : "Cancel today"}</option></select></label>)}</div></fieldset><label className={styles.choiceCheck}><input type="checkbox" checked={rebuildBedtime} onChange={(event) => setRebuildBedtime(event.target.checked)} />{ru ? "Задать жёсткое время сна" : "Set a hard bedtime"}</label>{rebuildBedtime && <label>{ru ? "Лечь спать" : "Bedtime"}<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>}</>}
      {action === "priorities" && <div className={styles.constructorDecisionList}>{activeItems.map((item) => <article key={item.id} className={styles.constructorBulkItem}><strong>{item.title}</strong><label>{ru ? "Обязательность" : "Commitment"}<select value={bulkCommitments[item.id] ?? item.commitmentLevel} onChange={(event) => setBulkCommitments((current) => ({ ...current, [item.id]: event.target.value as PlannerCommitmentLevel }))}><option value="must_not_skip">{ru ? "Нельзя пропустить" : "Must not skip"}</option><option value="required">{ru ? "Обязательное" : "Required"}</option><option value="desired">{ru ? "Желательное" : "Desired"}</option><option value="if_time">{ru ? "Если останется время" : "If time remains"}</option></select></label><label>{ru ? "Порядок (меньше — раньше)" : "Order (lower is earlier)"}<input type="number" min="0" max="1000000" value={bulkRanks[item.id] ?? item.planningRank} onChange={(event) => setBulkRanks((current) => ({ ...current, [item.id]: Math.max(0, Number(event.target.value) || 0) }))} /></label><label className={styles.choiceCheck}><input type="checkbox" checked={bulkMoveDays[item.id] ?? false} onChange={(event) => setBulkMoveDays((current) => ({ ...current, [item.id]: event.target.checked }))} />{ru ? "Можно переносить между днями" : "May move between days"}</label><label className={styles.choiceCheck}><input type="checkbox" checked={bulkReductions[item.id] ?? false} onChange={(event) => setBulkReductions((current) => ({ ...current, [item.id]: event.target.checked }))} />{ru ? "Можно сокращать до минимума" : "May shorten to minimum"}</label></article>)}</div>}
      <div className={styles.modalActions}><button type="button" onClick={onClose}>{ru ? "Отмена" : "Cancel"}</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void submit()}>{ru ? "Показать изменения" : "Preview changes"}</button></div>
    </div>}
  </section></div>;
}
