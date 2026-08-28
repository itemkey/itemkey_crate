"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import LocaleSwitcher from "@/components/locale-switcher";
import { useI18n } from "@/components/i18n-provider";
import DurationInput from "@/components/planner/duration-input";
import type { ConstructorAction } from "@/components/planner/plan-constructor-modal";
import type { SleepMode } from "@/components/planner/sleep-changed-modal";
import type { Locale } from "@/lib/i18n";
import type { PlannerTravelEstimateResult } from "@/lib/planner/commitments";
import { groupPlannerPlacementsByDay, layoutCalendarEntries } from "@/lib/planner/presentation";
import { availabilityFromSleepSchedule, buildPlannerSleepBlocks, createPlannerSleepEvent, fixedScheduleView } from "@/lib/planner/sleep";
import {
  createDefaultPlannerProfile,
  type PlannerArchiverEntry,
  type PlannerBlock,
  type PlannerBlockStatus,
  type PlannerBootstrap,
  type PlannerDraft,
  type PlannerDeadlineChainMode,
  type PlannerDeadlineType,
  type PlannerCommitmentLevel,
  type PlannerConstructorOperation,
  type PlannerEnergy,
  type PlannerEstimateConfidence,
  type PlannerEstimateMode,
  type PlannerHorizon,
  type PlannerItem,
  type PlannerItemKind,
  type PlannerMissedOccurrencePolicy,
  type PlannerOperationTarget,
  type PlannerPriority,
  type PlannerProfile,
  type PlannerProposal,
  type PlannerProposalInput,
  type PlannerRecurrence,
  type PlannerSleepBlock,
  type PlannerSleepEvent,
  type PlannerSleepinessLevel,
} from "@/lib/planner/types";
import {
  addIsoMinutes,
  addPlannerDays,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  horizonDays,
  isoDurationMinutes,
  plannerTimeToMinutes,
  plannerWeekday,
  zonedPlannerDateTimeToUtc,
} from "@/lib/planner/time";
import styles from "./planner-workspace.module.css";

const AutoplannerModal = dynamic(() => import("@/components/planner/autoplanner-modal"));
const ItemDetailsModal = dynamic(() => import("@/components/planner/item-details-modal"));
const PlanConstructorModal = dynamic(() => import("@/components/planner/plan-constructor-modal"));
const SleepChangedModal = dynamic(() => import("@/components/planner/sleep-changed-modal"));

type PlannerView = "day" | "week" | "month" | "agenda";
type Modal = "constructor" | "details" | "item" | "proposal" | "settings" | "stats" | "import" | "assistant" | "sleep" | "missed" | "archiver" | "extension" | null;
type CalendarBlock = PlannerBlock | PlannerSleepBlock;

function subscribeMobileViewport(onChange: () => void) {
  const query = window.matchMedia("(max-width: 760px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function mobileViewportSnapshot() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function isSleepBlock(block: CalendarBlock): block is PlannerSleepBlock {
  return "kind" in block && block.kind === "sleep";
}

function actionForOperation(kind: PlannerConstructorOperation["kind"]): ConstructorAction {
  return kind === "add_item" ? "add"
    : kind === "schedule_item" ? "schedule"
    : kind === "edit_item" ? "edit"
      : kind === "bulk_update_items" ? "priorities"
        : kind === "move_item" ? "move"
          : kind === "cancel_item" ? "cancel"
            : kind === "replace_item" ? "replace"
              : kind === "change_block_time" ? "time"
                : kind === "change_item_duration" ? "duration"
                  : kind === "resolve_archiver_entry" ? "schedule"
                  : kind === "protect_interval" ? "protect"
                    : kind === "occupy_interval" ? "occupy"
                      : kind === "set_sleep_boundary" ? "sleep"
                        : kind === "set_day_bounds" ? "day_bounds"
                          : "rebuild";
}

function blockForOperation(operation: PlannerConstructorOperation): string | undefined {
  switch (operation.kind) {
    case "move_item":
    case "replace_item":
    case "change_block_time":
      return operation.blockId;
    case "cancel_item":
      return operation.blockId;
    default:
      return undefined;
  }
}

function splitSleepBlocksByDate(blocks: PlannerSleepBlock[], dates: string[], timezone: string): PlannerSleepBlock[] {
  return blocks.flatMap((block) => dates.flatMap((date) => {
    const dayStart = new Date(zonedPlannerDateTimeToUtc(date, "00:00", timezone)).getTime();
    const dayEnd = new Date(zonedPlannerDateTimeToUtc(addPlannerDays(date, 1), "00:00", timezone)).getTime();
    const start = Math.max(dayStart, new Date(block.startAt).getTime());
    const end = Math.min(dayEnd, new Date(block.endAt).getTime());
    return end > start ? [{ ...block, id: `${block.id}:${date}`, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() }] : [];
  }));
}

type LegacySource = {
  sourceKey: string;
  title: string;
  location: string;
  itemCount: number;
  blockCount: number;
  alreadyImported: boolean;
};

type LegacyImportResult = {
  revision: number;
  importedSources: number;
  importedItems: number;
  importedBlocks: number;
};

type ItemForm = {
  id: string;
  title: string;
  kind: PlannerItemKind;
  estimateMinutes: string;
  durationEstimateMode: PlannerEstimateMode;
  minimumDurationMinutes: string;
  maximumDurationMinutes: string;
  durationTolerancePercent: "15" | "30" | "50";
  calibrationMinutes: string;
  outcomeMode: "deliverable" | "time_budget";
  commitmentLevel: PlannerCommitmentLevel;
  planningRank: string;
  date: string;
  start: string;
  end: string;
  deadlineEarliest: string;
  deadline: string;
  deadlineTime: string;
  deadlineType: PlannerDeadlineType;
  targetFinishMode: "auto" | "manual";
  targetFinishDate: string;
  targetFinishTime: string;
  estimateConfidence: PlannerEstimateConfidence;
  deadlineChainMode: PlannerDeadlineChainMode;
  deadlineChainGap: "0" | "5" | "15";
  nextItemId: string;
  createMilestones: boolean;
  priority: PlannerPriority;
  energy: PlannerEnergy;
  canSplit: boolean;
  minChunkMinutes: string;
  allowedStart: string;
  allowedEnd: string;
  preferredStart: string;
  preferredEnd: string;
  avoidedStart: string;
  avoidedEnd: string;
  location: string;
  area: string;
  notes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  recurrenceFrequency: "daily" | "weekly" | "custom";
  recurrenceWeekdays: number[];
  recurrenceDurationMode: "per_occurrence" | "per_cycle";
  recurrenceSchedulingMode: "required" | "spare_time";
  minimumEstimateMinutes: string;
  recurrencePolicyMode: "exact_days" | "count_range";
  recurrencePeriod: "week" | "month";
  minOccurrences: string;
  likelyOccurrences: string;
  maxOccurrences: string;
  dateFlexibility: "exact" | "preferred" | "range" | "any";
  preferredDate: string;
  earliestDate: string;
  latestDate: string;
  timeFlexibility: "preferred" | "range" | "any";
};

const text = {
  ru: {
    title: "Планировщик",
    subtitle: "Реалистичный план, который выдерживает изменения.",
    today: "Сегодня",
    day: "День",
    week: "Неделя",
    month: "Месяц",
    agenda: "Список",
    inbox: "Архиватор дел",
    now: "Сейчас",
    next: "Дальше",
    add: "Добавить дело",
    changed: "Планы изменились",
    autoplan: "Собрать план",
    stats: "Статистика",
    settings: "Настройки",
    legacy: "Перенести старые",
    empty: "Здесь пока свободно",
    noInbox: "Все активные дела уже получили время.",
    start: "Начать",
    done: "Готово",
    skip: "Пропустить",
    pause: "Поставить на паузу",
    editTime: "Изменить новое событие",
    finishFirst: "Закончить сначала",
    free: "Свободное окно",
    overloaded: "День перегружен",
    balanced: "Есть резерв",
    undo: "Отменить последний автоплан",
    back: "Crate",
  },
  en: {
    title: "Planner",
    subtitle: "A realistic plan that can handle change.",
    today: "Today",
    day: "Day",
    week: "Week",
    month: "Month",
    agenda: "Agenda",
    inbox: "Task Archiver",
    now: "Now",
    next: "Next",
    add: "Add item",
    changed: "Plans changed",
    autoplan: "Build plan",
    stats: "Statistics",
    settings: "Settings",
    legacy: "Import old plans",
    empty: "This time is open",
    noInbox: "Every active item has a time.",
    start: "Start",
    done: "Done",
    skip: "Skip",
    pause: "Pause current item",
    editTime: "Edit the new event",
    finishFirst: "Finish it first",
    free: "Free window",
    overloaded: "Day is overloaded",
    balanced: "Buffer protected",
    undo: "Undo last auto-plan",
    back: "Crate",
  },
} as const;

const plannerClientId = typeof window === "undefined"
  ? "planner-server"
  : globalThis.crypto.randomUUID();

const kindLabel: Record<Locale, Record<PlannerItemKind, string>> = {
  ru: { fixed_event: "Фиксированное событие", flexible_task: "Гибкая задача", routine: "Регулярное дело" },
  en: { fixed_event: "Fixed event", flexible_task: "Flexible task", routine: "Routine" },
};

const priorityLabel: Record<Locale, Record<PlannerPriority, string>> = {
  ru: { low: "Низкий", normal: "Обычный", high: "Высокий", critical: "Критический" },
  en: { low: "Low", normal: "Normal", high: "High", critical: "Critical" },
};

const energyLabel: Record<Locale, Record<PlannerEnergy, string>> = {
  ru: { low: "Низкая", normal: "Обычная", high: "Высокая" },
  en: { low: "Low", normal: "Normal", high: "High" },
};

const blockStatusLabel: Record<Locale, Record<PlannerBlockStatus, string>> = {
  ru: { planned: "запланировано", in_progress: "выполняется", done: "выполнено", skipped: "пропущено", cancelled: "отменено" },
  en: { planned: "planned", in_progress: "in progress", done: "done", skipped: "skipped", cancelled: "cancelled" },
};

function archiverResolutionLabel(resolution: NonNullable<PlannerArchiverEntry["resolution"]>, locale: Locale): string {
  const labels: Record<NonNullable<PlannerArchiverEntry["resolution"]>, [string, string]> = {
    late_completed: ["исправлено на выполненное", "corrected to done"],
    scheduled: ["возвращено в план", "returned to plan"],
    cancelled_occurrence: ["выполнение отменено", "occurrence cancelled"],
    cancelled_future: ["будущие повторы отменены", "future occurrences cancelled"],
    cancelled_item: ["всё дело отменено", "item cancelled"],
  };
  return labels[resolution][locale === "ru" ? 0 : 1];
}

function todayIn(timezone: string): string {
  return formatDateInTimeZone(new Date(), timezone);
}

function startOfWeek(date: string): string {
  return addPlannerDays(date, 1 - plannerWeekday(date));
}

function monthDates(date: string): string[] {
  const first = `${date.slice(0, 7)}-01`;
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addPlannerDays(gridStart, index));
}

function addPlannerMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function localDate(block: { startAt: string }, timezone: string): string {
  return formatDateInTimeZone(new Date(block.startAt), timezone);
}

function minutesInZone(value: string, timezone: string): number {
  return plannerTimeToMinutes(formatTimeInTimeZone(new Date(value), timezone));
}

function formatDuration(minutes: number, locale: Locale): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} ${locale === "ru" ? "мин" : "min"}`;
  return rest ? `${hours} ${locale === "ru" ? "ч" : "h"} ${rest} ${locale === "ru" ? "мин" : "min"}` : `${hours} ${locale === "ru" ? "ч" : "h"}`;
}

function plannerItemDurationLabel(item: PlannerItem, locale: Locale): string {
  const estimate = item.uncertaintyPolicy.duration;
  const prefix = item.recurrence?.schedulingMode === "spare_time" ? `${locale === "ru" ? "в свободное время" : "in spare time"} · ` : "";
  if (estimate.mode === "unknown") return `${prefix}${locale === "ru" ? "пробная сессия" : "calibration"} ${formatDuration(estimate.calibrationMinutes ?? estimate.likelyMinutes, locale)}`;
  if (estimate.mode === "exact") return `${prefix}${formatDuration(estimate.likelyMinutes, locale)}`;
  return `${prefix}${formatDuration(estimate.minMinutes, locale)} — ${formatDuration(estimate.likelyMinutes, locale)} — ${formatDuration(estimate.maxMinutes, locale)}`;
}

function formatCountdown(endAt: string, now: Date, locale: Locale): string {
  const minutes = Math.ceil((new Date(endAt).getTime() - now.getTime()) / 60_000);
  if (minutes >= 0) return `${formatDuration(minutes, locale)} ${locale === "ru" ? "осталось" : "left"}`;
  return `${locale === "ru" ? "опоздание" : "overdue by"} ${formatDuration(Math.abs(minutes), locale)}`;
}

function formatDay(date: string, locale: Locale, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    timeZone: "UTC", day: "numeric", month: "short", ...options,
  }).format(new Date(`${date}T12:00:00Z`));
}

function defaultItemForm(date: string): ItemForm {
  return {
    id: "", title: "", kind: "flexible_task", estimateMinutes: "60",
    durationEstimateMode: "exact", minimumDurationMinutes: "60", maximumDurationMinutes: "60",
    durationTolerancePercent: "30", calibrationMinutes: "30", outcomeMode: "deliverable",
    commitmentLevel: "required", planningRank: "0", date,
    start: "", end: "", deadlineEarliest: "", deadline: "", deadlineTime: "23:59", deadlineType: "none",
    targetFinishMode: "auto", targetFinishDate: "", targetFinishTime: "23:59",
    estimateConfidence: "normal", deadlineChainMode: "inherit", deadlineChainGap: "5",
    nextItemId: "", createMilestones: false, priority: "normal", energy: "normal",
    canSplit: false, minChunkMinutes: "25", allowedStart: "", allowedEnd: "",
    preferredStart: "", preferredEnd: "",
    avoidedStart: "", avoidedEnd: "", location: "", area: "", notes: "",
    bufferBeforeMinutes: "0", bufferAfterMinutes: "0", recurrenceFrequency: "daily",
    recurrenceWeekdays: [plannerWeekday(date)],
    recurrenceDurationMode: "per_occurrence",
    recurrenceSchedulingMode: "required", minimumEstimateMinutes: "30",
    recurrencePolicyMode: "exact_days", recurrencePeriod: "week",
    minOccurrences: "2", likelyOccurrences: "3", maxOccurrences: "4",
    dateFlexibility: "any", preferredDate: "", earliestDate: "", latestDate: "", timeFlexibility: "any",
  };
}

function formFromDraft(draft: PlannerDraft, date: string, timezone: string): ItemForm {
  const form = defaultItemForm(date);
  const preferred = draft.preferredWindows?.[0];
  const avoided = draft.avoidedWindows?.[0];
  const allowed = draft.allowedWindows?.[0];
  return {
    ...form,
    id: draft.id ?? "",
    title: draft.title,
    kind: draft.kind ?? form.kind,
    estimateMinutes: String(draft.uncertaintyPolicy?.duration.likelyMinutes ?? draft.estimateMinutes ?? 60),
    durationEstimateMode: draft.uncertaintyPolicy?.duration.mode ?? "exact",
    minimumDurationMinutes: String(draft.uncertaintyPolicy?.duration.minMinutes ?? draft.estimateMinutes ?? 60),
    maximumDurationMinutes: String(draft.uncertaintyPolicy?.duration.maxMinutes ?? draft.estimateMinutes ?? 60),
    durationTolerancePercent: String(draft.uncertaintyPolicy?.duration.tolerancePercent ?? 30) as ItemForm["durationTolerancePercent"],
    calibrationMinutes: String(draft.uncertaintyPolicy?.duration.calibrationMinutes ?? 30),
    outcomeMode: draft.uncertaintyPolicy?.outcomeMode ?? (draft.recurrence?.durationMode === "per_cycle" ? "deliverable" : "time_budget"),
    commitmentLevel: draft.commitmentLevel ?? "required",
    planningRank: String(draft.planningRank ?? 0),
    date: draft.date ?? date,
    start: draft.start ?? "",
    end: draft.end ?? "",
    deadlineEarliest: draft.uncertaintyPolicy?.deadline?.preferredFromAt
      ? formatDateInTimeZone(new Date(draft.uncertaintyPolicy.deadline.preferredFromAt), timezone)
      : "",
    deadline: draft.deadlineAt ? formatDateInTimeZone(new Date(draft.deadlineAt), timezone) : "",
    deadlineTime: draft.deadlineAt ? formatTimeInTimeZone(new Date(draft.deadlineAt), timezone) : "23:59",
    deadlineType: draft.deadlineType ?? (draft.deadlineAt ? "target" : "none"),
    targetFinishMode: draft.targetFinishMode ?? "auto",
    targetFinishDate: draft.targetFinishAt ? formatDateInTimeZone(new Date(draft.targetFinishAt), timezone) : "",
    targetFinishTime: draft.targetFinishAt ? formatTimeInTimeZone(new Date(draft.targetFinishAt), timezone) : "23:59",
    estimateConfidence: draft.estimateConfidence ?? "normal",
    deadlineChainMode: draft.deadlinePolicy?.chainMode ?? "inherit",
    deadlineChainGap: String(draft.deadlinePolicy?.gapMinutes ?? 5) as ItemForm["deadlineChainGap"],
    nextItemId: draft.deadlinePolicy?.nextItemId ?? "",
    createMilestones: Boolean(draft.milestones?.length),
    priority: draft.priority ?? "normal",
    energy: draft.energy ?? "normal",
    canSplit: draft.canSplit ?? false,
    minChunkMinutes: String(draft.minChunkMinutes ?? 25),
    allowedStart: allowed?.start ?? "",
    allowedEnd: allowed?.end ?? "",
    preferredStart: preferred?.start ?? "",
    preferredEnd: preferred?.end ?? "",
    avoidedStart: avoided?.start ?? "",
    avoidedEnd: avoided?.end ?? "",
    location: draft.location ?? "",
    area: draft.area ?? "",
    notes: draft.notes ?? "",
    bufferBeforeMinutes: String(draft.bufferBeforeMinutes ?? 0),
    bufferAfterMinutes: String(draft.bufferAfterMinutes ?? 0),
    recurrenceFrequency: draft.recurrence?.frequency === "once" ? "daily" : draft.recurrence?.frequency ?? "daily",
    recurrenceWeekdays: draft.recurrence?.weekdays ?? form.recurrenceWeekdays,
    recurrenceDurationMode: draft.recurrence?.durationMode ?? "per_occurrence",
    recurrenceSchedulingMode: draft.recurrence?.schedulingMode ?? "required",
    minimumEstimateMinutes: String(draft.recurrence?.minimumMinutes ?? 30),
    recurrencePolicyMode: draft.uncertaintyPolicy?.recurrence.mode ?? "exact_days",
    recurrencePeriod: draft.uncertaintyPolicy?.recurrence.period ?? "week",
    minOccurrences: String(draft.uncertaintyPolicy?.recurrence.minOccurrences ?? 2),
    likelyOccurrences: String(draft.uncertaintyPolicy?.recurrence.likelyOccurrences ?? 3),
    maxOccurrences: String(draft.uncertaintyPolicy?.recurrence.maxOccurrences ?? 4),
    dateFlexibility: draft.uncertaintyPolicy?.date.mode ?? "any",
    preferredDate: draft.uncertaintyPolicy?.date.preferredDate ?? "",
    earliestDate: draft.uncertaintyPolicy?.date.earliestDate ?? "",
    latestDate: draft.uncertaintyPolicy?.date.latestDate ?? "",
    timeFlexibility: draft.uncertaintyPolicy?.time.mode === "preferred" || draft.uncertaintyPolicy?.time.mode === "range" ? draft.uncertaintyPolicy.time.mode : "any",
  };
}

function asDraft(form: ItemForm, profile: PlannerProfile, locale: Locale): PlannerDraft {
  const recurrence: PlannerRecurrence | undefined = form.kind === "routine"
    ? {
        frequency: form.recurrenceFrequency,
        durationMode: form.outcomeMode === "deliverable" ? "per_cycle" : form.recurrenceDurationMode,
        schedulingMode: form.recurrenceSchedulingMode,
        minimumMinutes: form.recurrenceSchedulingMode === "spare_time"
          ? Math.min(Number(form.minimumEstimateMinutes) || 30, Number(form.estimateMinutes) || 60)
          : undefined,
        weekdays: form.recurrenceFrequency === "custom"
          ? form.recurrenceWeekdays
          : form.recurrenceFrequency === "weekly" ? [plannerWeekday(form.date)] : undefined,
      }
    : undefined;
  const deadlineAt = form.kind !== "fixed_event" && form.deadlineType !== "none" && form.deadline
    ? zonedPlannerDateTimeToUtc(form.deadline, form.deadlineTime || "23:59", profile.timezone)
    : undefined;
  const preferredDeadlineFromAt = form.deadlineType === "target" && form.deadlineEarliest
    ? zonedPlannerDateTimeToUtc(form.deadlineEarliest, "00:00", profile.timezone)
    : undefined;
  const targetFinishAt = form.deadlineType === "hard" && form.targetFinishMode === "manual" && form.targetFinishDate
    ? zonedPlannerDateTimeToUtc(form.targetFinishDate, form.targetFinishTime || "23:59", profile.timezone)
    : undefined;
  const estimateMinutes = form.durationEstimateMode === "unknown"
    ? Number(form.calibrationMinutes) || 30
    : Number(form.estimateMinutes) || 60;
  const minimumDurationMinutes = form.durationEstimateMode === "exact" || form.durationEstimateMode === "unknown"
    ? estimateMinutes
    : Math.min(estimateMinutes, Number(form.minimumDurationMinutes) || estimateMinutes);
  const maximumDurationMinutes = form.durationEstimateMode === "exact" || form.durationEstimateMode === "unknown"
    ? estimateMinutes
    : Math.max(estimateMinutes, Number(form.maximumDurationMinutes) || estimateMinutes);
  const milestoneCount = form.createMilestones && deadlineAt && estimateMinutes >= 120
    ? Math.min(5, Math.max(2, Math.ceil(estimateMinutes / 120)))
    : 0;
  const milestoneStart = Date.now();
  const milestoneEnd = deadlineAt ? new Date(targetFinishAt ?? deadlineAt).getTime() : milestoneStart;
  const milestoneChunk = milestoneCount ? Math.ceil(estimateMinutes / milestoneCount / 15) * 15 : 0;
  return {
    id: form.id || undefined,
    title: form.title.trim(), kind: form.kind,
    estimateMinutes,
    uncertaintyPolicy: {
      outcomeMode: form.outcomeMode,
      duration: {
        mode: form.durationEstimateMode,
        minMinutes: minimumDurationMinutes,
        likelyMinutes: estimateMinutes,
        maxMinutes: maximumDurationMinutes,
        tolerancePercent: form.durationEstimateMode === "approximate" ? Number(form.durationTolerancePercent) as 15 | 30 | 50 : undefined,
        calibrationMinutes: form.durationEstimateMode === "unknown" ? Number(form.calibrationMinutes) || 30 : undefined,
        source: "user",
      },
      date: {
        mode: form.kind === "fixed_event" ? "exact" : form.dateFlexibility,
        exactDate: form.dateFlexibility === "exact" ? form.date || undefined : undefined,
        preferredDate: form.preferredDate || undefined,
        earliestDate: form.earliestDate || undefined,
        latestDate: form.latestDate || undefined,
      },
      time: {
        mode: form.kind === "fixed_event" ? "exact" : form.timeFlexibility,
        exactStart: form.kind === "fixed_event" ? form.start || undefined : undefined,
        preferredStart: form.preferredStart || undefined,
        earliestStart: form.allowedStart || undefined,
        latestEnd: form.allowedEnd || undefined,
      },
      recurrence: {
        mode: form.recurrencePolicyMode,
        period: form.recurrencePeriod,
        minOccurrences: Math.max(0, Number(form.minOccurrences) || 0),
        likelyOccurrences: Math.max(0, Number(form.likelyOccurrences) || 0),
        maxOccurrences: Math.max(0, Number(form.maxOccurrences) || 0),
        allowedWeekdays: form.recurrenceWeekdays,
      },
      deadline: form.deadlineType === "none" ? { mode: "none" } : {
        mode: form.deadlineType === "hard" ? "hard" : "preferred_range",
        preferredFromAt: preferredDeadlineFromAt,
        latestAt: deadlineAt,
      },
    },
    commitmentLevel: form.deadlineType === "hard" ? "must_not_skip" : form.commitmentLevel,
    planningRank: Math.max(0, Number(form.planningRank) || 0),
    date: form.kind === "fixed_event" ? form.date : undefined,
    start: form.kind === "fixed_event" ? form.start || undefined : undefined,
    end: form.kind === "fixed_event" ? form.end || undefined : undefined,
    deadlineAt,
    deadlineType: deadlineAt ? form.deadlineType : "none",
    targetFinishAt,
    targetFinishMode: form.targetFinishMode,
    estimateConfidence: form.estimateConfidence,
    deadlinePolicy: {
      chainMode: form.deadlineChainMode,
      gapMinutes: Number(form.deadlineChainGap) as 0 | 5 | 15,
      nextItemId: form.deadlineChainMode === "pinned" ? form.nextItemId || undefined : undefined,
    },
    milestones: Array.from({ length: milestoneCount }, (_, index) => ({
      id: `milestone-${index + 1}`,
      title: locale === "ru" ? `Этап ${index + 1} из ${milestoneCount}` : `Milestone ${index + 1} of ${milestoneCount}`,
      estimateMinutes: index === milestoneCount - 1
        ? Math.max(15, estimateMinutes - milestoneChunk * (milestoneCount - 1))
        : milestoneChunk,
      targetAt: new Date(milestoneStart + (milestoneEnd - milestoneStart) * ((index + 1) / milestoneCount)).toISOString(),
      order: index + 1,
    })),
    priority: form.priority, energy: form.energy, canSplit: form.canSplit,
    minChunkMinutes: Number(form.minChunkMinutes) || 25,
    allowedWindows: form.allowedStart && form.allowedEnd ? [{ start: form.allowedStart, end: form.allowedEnd }] : [],
    preferredWindows: form.preferredStart && form.preferredEnd ? [{ start: form.preferredStart, end: form.preferredEnd }] : [],
    avoidedWindows: form.avoidedStart && form.avoidedEnd ? [{ start: form.avoidedStart, end: form.avoidedEnd }] : [],
    location: form.location.trim() || undefined, area: form.area.trim() || undefined,
    notes: form.notes.trim() || undefined,
    bufferBeforeMinutes: Number(form.bufferBeforeMinutes) || 0,
    bufferAfterMinutes: Number(form.bufferAfterMinutes) || 0,
    recurrence, autoPlan: form.kind !== "fixed_event", status: "active",
  };
}

export default function PlannerWorkspace({ accountLocale, initialLegacyImport = false }: { accountLocale: Locale; initialLegacyImport?: boolean }) {
  const { locale, setLocale } = useI18n();
  const copy = text[locale];
  const csrfRef = useRef<string | null>(null);
  const clientIdRef = useRef(plannerClientId);
  const initializedDateRef = useRef(false);
  const reconcilingRef = useRef(false);
  const reconciledRevisionRef = useRef<number | null>(null);
  const [data, setData] = useState<PlannerBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replanSuggested, setReplanSuggested] = useState(false);
  const [calibrationItemId, setCalibrationItemId] = useState<string | null>(null);
  const [view, setView] = useState<PlannerView>("week");
  const mobileViewport = useSyncExternalStore(subscribeMobileViewport, mobileViewportSnapshot, () => false);
  const displayedView: PlannerView = mobileViewport && view === "week" ? "day" : view;
  const [selectedDate, setSelectedDate] = useState(() => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Minsk"));
  const [mobileTab, setMobileTab] = useState<"now" | "calendar" | "inbox">("calendar");
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(initialLegacyImport ? "import" : null);
  const [sleepModalMode, setSleepModalMode] = useState<SleepMode>("later");
  const [sleepModalWakeDate, setSleepModalWakeDate] = useState<string | undefined>();
  const [quickTrigger, setQuickTrigger] = useState<PlannerProposal["trigger"]>("quick_add");
  const [constructorAction, setConstructorAction] = useState<ConstructorAction | undefined>();
  const [constructorBlockId, setConstructorBlockId] = useState<string | undefined>();
  const [constructorLocalTarget, setConstructorLocalTarget] = useState<PlannerOperationTarget | undefined>();
  const [detailsBlockId, setDetailsBlockId] = useState<string | undefined>();
  const [itemForm, setItemForm] = useState(() => defaultItemForm(selectedDate));
  const [proposal, setProposal] = useState<PlannerProposal | null>(null);
  const [missedBlock, setMissedBlock] = useState<PlannerBlock | null>(null);
  const [extensionBlock, setExtensionBlock] = useState<PlannerBlock | null>(null);
  const [archiverEntry, setArchiverEntry] = useState<PlannerArchiverEntry | null>(null);
  const [archiverTab, setArchiverTab] = useState<"missed" | "no_slot" | "resolved">("missed");
  const [legacySources, setLegacySources] = useState<LegacySource[]>([]);
  const [legacyLoading, setLegacyLoading] = useState(initialLegacyImport);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => setLocale(accountLocale), [accountLocale, setLocale]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ensureCsrf = useCallback(async () => {
    if (csrfRef.current) return csrfRef.current;
    const response = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin" });
    const payload = (await response.json()) as { data?: { token?: string }; error?: string };
    if (!response.ok || !payload.data?.token) throw new Error(payload.error ?? "CSRF error");
    csrfRef.current = payload.data.token;
    return payload.data.token;
  }, []);

  const api = useCallback(async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("x-client-id", clientIdRef.current);
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers.set("x-csrf-token", await ensureCsrf());
      headers.set("content-type", "application/json");
    }
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    init.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers, signal: controller.signal, credentials: "same-origin", cache: "no-store" });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new Error(locale === "ru"
          ? "План считался слишком долго. Форма снова доступна — попробуйте ещё раз."
          : "Planning took too long. The form is available again — please retry.");
      }
      throw cause;
    } finally {
      window.clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abortFromCaller);
    }
    const rawPayload = await response.text();
    let payload: { data?: T; error?: string } = {};
    try {
      payload = rawPayload ? JSON.parse(rawPayload) as { data?: T; error?: string } : {};
    } catch { /* an upstream server can return a plain error page */ }
    if (!response.ok || !("data" in payload)) {
      if (response.status === 403) csrfRef.current = null;
      const fallback = response.status === 413
        ? (locale === "ru" ? "Список дел оказался слишком большим для одного запроса." : "The item list is too large for one request.")
        : locale === "ru"
          ? `Сервер не смог подготовить план (HTTP ${response.status}). Форма разблокирована.`
          : `The server could not prepare the plan (HTTP ${response.status}). The form has been unlocked.`;
      throw new Error(payload.error?.trim() || fallback);
    }
    return payload.data as T;
  }, [ensureCsrf, locale]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const bootstrap = await api<PlannerBootstrap>("/api/planner/bootstrap");
      const profileToday = todayIn(bootstrap.profile.onboardingCompleted
        ? bootstrap.profile.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone || bootstrap.profile.timezone);
      setData(bootstrap);
      if (!initializedDateRef.current) {
        initializedDateRef.current = true;
        setSelectedDate(profileToday);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить планировщик.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!initialLegacyImport) return;
    let active = true;
    void api<LegacySource[]>("/api/planner/legacy-import")
      .then((sources) => { if (active) setLegacySources(sources); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Не удалось найти старые расписания."); })
      .finally(() => { if (active) setLegacyLoading(false); });
    return () => { active = false; };
  }, [api, initialLegacyImport]);
  useEffect(() => {
    const source = new EventSource(`/api/sync/events?clientId=${encodeURIComponent(clientIdRef.current)}`);
    source.addEventListener("itemkey", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { kind?: string };
        if (payload.kind === "planner") void load(true);
      } catch { /* ignore malformed event */ }
    });
    return () => source.close();
  }, [load]);

  const profile = data?.profile ?? createDefaultPlannerProfile();
  const blocks = useMemo(() => data?.blocks ?? [], [data?.blocks]);
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const archiverEntries = useMemo(() => data?.archiverEntries ?? [], [data?.archiverEntries]);
  const activeArchiverEntries = useMemo(() => archiverEntries.filter((entry) => !entry.resolvedAt
    && entry.pendingMinutes > 0), [archiverEntries]);
  const tentativeSleepEvent = data?.sleepEvents.find((event) => event.state === "tentative");
  const visibleDates = useMemo(() => {
    if (displayedView === "day") return [selectedDate];
    if (displayedView === "week") {
      const start = startOfWeek(selectedDate);
      return Array.from({ length: 7 }, (_, index) => addPlannerDays(start, index));
    }
    if (displayedView === "month") return monthDates(selectedDate);
    return Array.from({ length: horizonDays(profile.horizon) }, (_, index) => addPlannerDays(selectedDate, index));
  }, [displayedView, profile.horizon, selectedDate]);
  const mobileWeekDates = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addPlannerDays(start, index));
  }, [selectedDate]);
  const sleepBlocks = useMemo(() => data && visibleDates.length
    ? buildPlannerSleepBlocks(profile, data.sleepEvents, visibleDates[0], visibleDates[visibleDates.length - 1])
    : [], [data, profile, visibleDates]);

  const activeBlocks = useMemo(() => blocks.filter((block) => !block.soft && !["cancelled", "skipped"].includes(block.status)), [blocks]);
  const actionableBlocks = useMemo(() => activeBlocks.filter((block) => block.status === "planned" || block.status === "in_progress"), [activeBlocks]);
  const futureItemIds = useMemo(() => new Set(actionableBlocks.filter((block) => new Date(block.endAt) > now).map((block) => block.itemId)), [actionableBlocks, now]);
  const planningStateByItem = useMemo(() => new Map((data?.planningStates ?? []).map((state) => [state.itemId, state])), [data?.planningStates]);
  const inbox = useMemo(() => items.filter((item) => item.status === "active" && item.kind !== "fixed_event"
    && (!futureItemIds.has(item.id) || (planningStateByItem.get(item.id)?.remainingMinutes ?? 0) > 0)), [futureItemIds, items, planningStateByItem]);
  const currentBlock = useMemo(() => actionableBlocks.find((block) => block.status === "in_progress")
    ?? actionableBlocks.find((block) => new Date(block.startAt) <= now && new Date(block.endAt) > now)
    ?? null, [actionableBlocks, now]);
  const graceBlocks = useMemo(() => blocks.filter((block) => block.status === "planned" && !block.soft && block.itemId
    && new Date(block.endAt).getTime() <= now.getTime()
    && new Date(block.endAt).getTime() + 15 * 60_000 > now.getTime())
    .sort((left, right) => right.endAt.localeCompare(left.endAt)), [blocks, now]);
  useEffect(() => {
    const currentTime = Date.now();
    const nextThreshold = blocks
      .filter((block) => block.status === "planned" && !block.soft && block.itemId)
      .map((block) => new Date(block.endAt).getTime() + 15 * 60_000)
      .filter((threshold) => threshold > currentTime)
      .sort((left, right) => left - right)[0];
    if (!nextThreshold) return;
    const timer = window.setTimeout(() => setNow(new Date()), Math.min(2_147_000_000, nextThreshold - currentTime + 25));
    return () => window.clearTimeout(timer);
  }, [blocks, now]);
  const currentItem = useMemo(() => currentBlock?.itemId ? items.find((item) => item.id === currentBlock.itemId) : undefined, [currentBlock, items]);
  const currentProgress = useMemo(() => {
    if (!currentBlock || currentBlock.status !== "in_progress") return 0;
    const start = new Date(currentBlock.actualStartAt ?? currentBlock.startAt).getTime();
    const duration = Math.max(1, new Date(currentBlock.endAt).getTime() - new Date(currentBlock.startAt).getTime());
    return Math.max(0, (now.getTime() - start) / duration);
  }, [currentBlock, now]);
  const nextBlock = useMemo(() => actionableBlocks.filter((block) => block.status === "planned" && new Date(block.startAt) > now).sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null, [actionableBlocks, now]);
  const detailsBlock = detailsBlockId ? blocks.find((block) => block.id === detailsBlockId) : undefined;
  const detailsItem = detailsBlock?.itemId ? items.find((item) => item.id === detailsBlock.itemId) : undefined;
  const rawFreeMinutes = nextBlock ? Math.max(0, Math.floor((new Date(nextBlock.startAt).getTime() - now.getTime()) / 60_000)) : 0;
  const transitionMinutes = nextBlock ? Math.min(rawFreeMinutes, profile.defaultBufferMinutes) : 0;
  const afterTransitionMinutes = Math.max(0, rawFreeMinutes - transitionMinutes);
  const protectedReserveMinutes = Math.round(afterTransitionMinutes * profile.reserveRatio);
  const safeFreeMinutes = Math.max(0, afterTransitionMinutes - protectedReserveMinutes);
  const fittingInboxItem = inbox.find((item) => item.canSplit
    ? item.minChunkMinutes <= safeFreeMinutes
    : item.uncertaintyPolicy.duration.likelyMinutes <= safeFreeMinutes);
  const todayHealth = useMemo(() => {
    const date = todayIn(profile.timezone);
    const planned = activeBlocks.filter((block) => localDate(block, profile.timezone) === date).reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
    const available = (profile.availabilityOverrides[date] ?? profile.availability[String(plannerWeekday(date))] ?? []).reduce((sum, window) => {
      const start = plannerTimeToMinutes(window.start);
      const end = plannerTimeToMinutes(window.end);
      return sum + ((end - start + 1440) % 1440 || 1440);
    }, 0);
    const freePercent = available ? Math.max(0, Math.round((1 - planned / available) * 100)) : 0;
    return { overloaded: available > 0 && freePercent < Math.round(profile.reserveRatio * 100), freePercent };
  }, [activeBlocks, profile]);

  useEffect(() => {
    if (!data || reconcilingRef.current) return;
    const hasOverdueCandidate = blocks.some((block) => block.status === "planned" && !block.soft && block.itemId
      && new Date(block.endAt).getTime() + 15 * 60_000 <= now.getTime());
    if (!hasOverdueCandidate && reconciledRevisionRef.current === profile.revision) return;
    reconcilingRef.current = true;
    void api<{ revision: number; created: number }>("/api/planner/archiver/reconcile", {
      method: "POST",
      body: JSON.stringify({ expectedRevision: profile.revision }),
    }).then(async (result) => {
      reconciledRevisionRef.current = result.revision;
      if (result.created > 0) await load(true);
    }).catch(async () => {
      await load(true);
    }).finally(() => {
      reconcilingRef.current = false;
    });
  }, [api, blocks, data, load, now, profile.revision]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      reconciledRevisionRef.current = null;
      setNow(new Date());
      void load(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load]);

  async function run(task: () => Promise<void>, success?: string) {
    setBusy(true); setError(null);
    try {
      await task();
      if (success) { setNotice(success); window.setTimeout(() => setNotice(null), 3500); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
    } finally { setBusy(false); }
  }

  async function createProposal(input: PlannerProposalInput) {
    const created = await api<PlannerProposal>("/api/planner/proposals", { method: "POST", body: JSON.stringify(input) });
    setProposal(created); setModal("proposal");
  }

  function replayProposalInput(current: PlannerProposal): PlannerProposalInput {
    if (current.operation) return { operation: current.operation, decisions: current.decisions, trigger: "constructor" };
    const profileChange = current.changes.find((change) => change.kind === "update_profile");
    const sleepChange = current.changes.find((change) => change.kind === "upsert_sleep_event");
    return {
      drafts: current.normalizedDrafts ?? (current.normalizedDraft ? [current.normalizedDraft] : undefined),
      profilePatch: profileChange?.kind === "update_profile" ? profileChange.profile : undefined,
      sleepEvent: sleepChange?.kind === "upsert_sleep_event" ? sleepChange.event : undefined,
      trigger: current.trigger,
      rebuildFuture: current.trigger === "sleep_changed" || current.trigger === "assistant_setup" || current.trigger === "assistant_update",
      blockExtension: current.blockExtension,
      removedItemIds: current.removedItemIds,
      missedOccurrence: current.missedOccurrence,
      remainderTransfer: current.remainderTransfer,
    };
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault();
    if (!itemForm.title.trim()) return;
    await run(async () => createProposal({ draft: asDraft(itemForm, profile, locale), trigger: quickTrigger }));
  }

  function openArchiverEntry(entry: PlannerArchiverEntry) {
    setArchiverEntry(entry);
    setModal("archiver");
  }

  async function applyProposal() {
    if (!proposal?.id || proposal.conflicts.length > 0 || proposal.decisionGroups?.some((group) => group.blocking)) return;
    await run(async () => {
      await api(`/api/planner/proposals/${proposal.id}/apply`, { method: "POST", body: "{}" });
      try { window.localStorage.removeItem("itemkey.planner.autoplanner.v2"); } catch { /* optional draft storage */ }
      setModal(null); setProposal(null); await load(true);
    }, locale === "ru" ? "План применён." : "Plan applied.");
  }

  async function blockAction(block: PlannerBlock, action: string, minutes?: number) {
    if (action === "skip") {
      const item = block.itemId ? items.find((candidate) => candidate.id === block.itemId) : undefined;
      const remembered = item?.uncertaintyPolicy.missedOccurrencePolicy;
      if (remembered && remembered !== "ask") {
        await run(() => createProposal({
          trigger: "plans_changed",
          rebuildFuture: true,
          missedOccurrence: { blockId: block.id, disposition: remembered },
        }));
      } else {
        setMissedBlock(block);
        setModal("missed");
      }
      return true;
    }
    let succeeded = false;
    await run(async () => {
      const result = await api<{ block: PlannerBlock; revision: number }>(`/api/planner/blocks/${encodeURIComponent(block.id)}/action`, { method: "POST", body: JSON.stringify({ action, minutes, expectedRevision: profile.revision }) });
      await load(true);
      succeeded = true;
      if (action === "done") {
        if (new Date(block.endAt).getTime() > Date.now()) setReplanSuggested(true);
        const completedItem = block.itemId ? items.find((item) => item.id === block.itemId) : undefined;
        if (completedItem?.uncertaintyPolicy.duration.mode === "unknown") {
          const target = completedItem.uncertaintyPolicy.duration.calibrationMinutes ?? completedItem.estimateMinutes;
          const completedMinutes = blocks.filter((candidate) => candidate.itemId === completedItem.id && candidate.role === "calibration" && candidate.status === "done" && candidate.id !== block.id)
            .reduce((sum, candidate) => sum + isoDurationMinutes(candidate.actualStartAt ?? candidate.startAt, candidate.actualEndAt ?? candidate.endAt), 0)
            + isoDurationMinutes(result.block.actualStartAt ?? result.block.startAt, result.block.actualEndAt ?? result.block.endAt);
          if (completedMinutes >= target) setCalibrationItemId(completedItem.id);
        }
      }
    });
    return succeeded;
  }

  async function reviewBlockExtension(block: PlannerBlock, rawMinutes: number) {
    const minutes = Math.round(Number(rawMinutes));
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
      setError(locale === "ru" ? "Укажите от 5 минут до 24 часов." : "Enter between 5 minutes and 24 hours.");
      return;
    }
    await run(() => createProposal({ trigger: "plans_changed", blockExtension: { blockId: block.id, minutes } }));
  }

  async function undo() {
    if (!data?.latestChangeSetId) return;
    await run(async () => {
      await api(`/api/planner/change-sets/${data.latestChangeSetId}/undo`, { method: "POST", body: "{}" });
      await load(true);
    });
  }

  async function openLegacyImport() {
    setLegacyLoading(true);
    setModal("import");
    await run(async () => setLegacySources(await api<LegacySource[]>("/api/planner/legacy-import")));
    setLegacyLoading(false);
  }

  async function importLegacy(sourceKeys: string[]) {
    if (sourceKeys.length === 0) return;
    await run(async () => {
      const result = await api<LegacyImportResult>("/api/planner/legacy-import", {
        method: "POST",
        body: JSON.stringify({ sourceKeys, expectedRevision: profile.revision }),
      });
      setLegacySources(await api<LegacySource[]>("/api/planner/legacy-import"));
      await load(true);
      setNotice(locale === "ru"
        ? `Перенесено расписаний: ${result.importedSources}, дел: ${result.importedItems}. Оригиналы сохранены.`
        : `Imported ${result.importedSources} plan(s) and ${result.importedItems} item(s). Originals were kept.`);
    });
  }

  async function acceptDurationSuggestion(itemId: string, suggestedMinutes: number) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const suggestedRange = data?.durationSuggestions?.find((candidate) => candidate.itemId === itemId)?.suggestedRange;
    const nextItem = {
      ...item,
      estimateMinutes: suggestedRange?.likelyMinutes ?? suggestedMinutes,
      uncertaintyPolicy: {
        ...item.uncertaintyPolicy,
        duration: suggestedRange ? {
          mode: "range" as const,
          minMinutes: suggestedRange.minMinutes,
          likelyMinutes: suggestedRange.likelyMinutes,
          maxMinutes: suggestedRange.maxMinutes,
          source: "statistics" as const,
        } : {
          ...item.uncertaintyPolicy.duration,
          minMinutes: suggestedMinutes,
          likelyMinutes: suggestedMinutes,
          maxMinutes: suggestedMinutes,
          source: "statistics" as const,
        },
      },
    };
    await run(async () => {
      await createProposal({
        operation: {
          kind: "change_item_duration",
          itemId,
          duration: nextItem.uncertaintyPolicy.duration,
          reduction: nextItem.uncertaintyPolicy.reduction,
        },
        trigger: "constructor",
      });
    });
  }

  async function acceptSleepDurationSuggestion(suggestedMinutes: number) {
    if (profile.sleepSchedule.mode !== "adaptive") return;
    const sleepSchedule = { ...profile.sleepSchedule, targetDurationMinutes: suggestedMinutes };
    await run(() => createProposal({
      profilePatch: {
        sleepSchedule,
        availability: availabilityFromSleepSchedule(sleepSchedule),
      },
      trigger: "assistant_update",
      rebuildFuture: true,
    }));
  }

  function openSleep(mode: SleepMode = "later", wakeDate?: string) {
    setSleepModalMode(mode);
    setSleepModalWakeDate(wakeDate);
    setModal("sleep");
  }

  async function checkInSleep(wakeDate: string, sleepinessLevel: PlannerSleepinessLevel, feedbackText?: string) {
    await run(async () => {
      await api("/api/planner/sleep/check-in", {
        method: "POST",
        body: JSON.stringify({ wakeDate, sleepinessLevel, feedbackText, expectedRevision: profile.revision }),
      });
      setModal(null);
      await load(true);
    }, locale === "ru" ? "Оценка сна сохранена." : "Sleep rating saved.");
  }

  function openConstructor(action?: ConstructorAction, blockId?: string, localTarget?: PlannerOperationTarget) {
    setConstructorAction(action);
    setConstructorBlockId(blockId);
    setConstructorLocalTarget(localTarget);
    setModal("constructor");
  }

  function openBlockDetails(block: PlannerBlock) {
    setDetailsBlockId(block.id);
    setModal("details");
  }

  function openItemConstructor(item: PlannerItem, action?: ConstructorAction) {
    openConstructor(action, undefined, { itemId: item.id });
  }

  function openItem(draft?: PlannerDraft) {
    setQuickTrigger(draft ? "plans_changed" : "quick_add");
    setItemForm(draft ? formFromDraft(draft, selectedDate, profile.timezone) : defaultItemForm(selectedDate));
    setModal("item");
  }

  function openCalibrationEstimate(itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const trial = item.uncertaintyPolicy.duration.calibrationMinutes ?? item.estimateMinutes;
    setQuickTrigger("plans_changed");
    setItemForm({
      ...formFromDraft(item, selectedDate, profile.timezone),
      durationEstimateMode: "range",
      minimumDurationMinutes: String(trial),
      estimateMinutes: String(Math.max(trial, trial * 2)),
      maximumDurationMinutes: String(Math.max(trial, trial * 3)),
    });
    setCalibrationItemId(null);
    setModal("item");
  }

  if (loading) return <div className={styles.loading}>Собираем ваш план…</div>;
  if (!data) return <div className={styles.fatal}><p>{error}</p><button onClick={() => void load()}>Повторить</button></div>;

  const showAssistantSetup = profile.assistantSetupVersion < 5 && modal !== "proposal" && modal !== "import";
  const unresolvedArchiverItemIds = new Set(activeArchiverEntries.flatMap((entry) => entry.itemId ? [entry.itemId] : []));
  const legacyUnplacedItems = inbox.filter((item) => !unresolvedArchiverItemIds.has(item.id));
  const visibleArchiverEntries = archiverTab === "resolved"
    ? archiverEntries.filter((entry) => Boolean(entry.resolvedAt))
    : activeArchiverEntries.filter((entry) => entry.category === archiverTab);

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>IK</div>
          <div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
        </div>
        <div className={styles.headerActions}>
          <LocaleSwitcher compact />
          <Link href="/crate" className={styles.ghostButton}>{copy.back}</Link>
          <button className={styles.iconButton} onClick={() => setModal("stats")}>{copy.stats}</button>
          <button className={styles.iconButton} onClick={() => setModal("settings")}>{copy.settings}</button>
        </div>
      </header>

      <section className={styles.commandBar}>
        <button className={styles.primaryButton} onClick={() => openConstructor()}>＋ {locale === "ru" ? "Конструктор" : "Constructor"}</button>
        <button className={styles.ghostButton} onClick={() => setModal("assistant")}>▣ {locale === "ru" ? "Автоплан" : "Autoplan"}</button>
        <button className={`${styles.ghostButton} ${styles.desktopCommand}`} onClick={() => void openLegacyImport()}>↗ {copy.legacy}</button>
        {data.latestChangeSetId && <button className={`${styles.linkButton} ${styles.desktopCommand}`} onClick={() => void undo()} disabled={busy}>{copy.undo}</button>}
        <button className={styles.mobileMoreButton} type="button" aria-expanded={mobileToolsOpen} onClick={() => setMobileToolsOpen((current) => !current)}>{locale === "ru" ? "Ещё" : "More"} ▾</button>
        {mobileToolsOpen && <div className={styles.mobileToolsMenu}>
          {data.latestChangeSetId && <button onClick={() => { setMobileToolsOpen(false); void undo(); }} disabled={busy}>{copy.undo}</button>}
          <button onClick={() => { setMobileToolsOpen(false); void openLegacyImport(); }}>↗ {copy.legacy}</button>
          <button onClick={() => { setMobileToolsOpen(false); setModal("stats"); }}>{copy.stats}</button>
          <button onClick={() => { setMobileToolsOpen(false); setModal("settings"); }}>{copy.settings}</button>
          <button onClick={() => { setMobileToolsOpen(false); openConstructor("protect"); }}>{locale === "ru" ? "Инструменты плана: освободить промежуток" : "Plan tools: protect interval"}</button>
          <button onClick={() => { setMobileToolsOpen(false); openConstructor("occupy"); }}>{locale === "ru" ? "Инструменты плана: занять промежуток" : "Plan tools: occupy interval"}</button>
          <button onClick={() => { setMobileToolsOpen(false); openConstructor("sleep"); }}>{locale === "ru" ? "Инструменты плана: сон" : "Plan tools: sleep"}</button>
          <button onClick={() => { setMobileToolsOpen(false); openConstructor("day_bounds"); }}>{locale === "ru" ? "Инструменты плана: границы дня" : "Plan tools: day bounds"}</button>
          <button onClick={() => { setMobileToolsOpen(false); openConstructor("rebuild"); }}>{locale === "ru" ? "Инструменты плана: пересборка" : "Plan tools: rebuild"}</button>
          <Link href="/crate" onClick={() => setMobileToolsOpen(false)}>{copy.back}</Link>
          <div className={styles.mobileLocale}><LocaleSwitcher compact /></div>
        </div>}
      </section>

      {error && <div className={styles.errorBanner}>{error}<button onClick={() => setError(null)}>×</button></div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      {replanSuggested && <div className={styles.suggestionBanner}><span>{locale === "ru" ? "Дело завершилось раньше. Освободившееся время можно оставить свободным или пересобрать оставшуюся часть дня." : "The item finished early. Keep the time free or rebuild the rest of the day."}</span><button onClick={() => { setReplanSuggested(false); openConstructor("rebuild"); }}>{locale === "ru" ? "Настроить пересборку" : "Configure rebuild"}</button><button onClick={() => setReplanSuggested(false)}>{locale === "ru" ? "Оставить свободным" : "Keep free"}</button></div>}
      {calibrationItemId && <div className={styles.suggestionBanner}><span>{locale === "ru" ? "Пробная сессия завершена. Сколько работы осталось? Укажите первую оценку минимум — обычно — максимум; она применится только после вашего подтверждения." : "Calibration finished. How much work remains? Enter the first minimum — usual — maximum estimate; it applies only after confirmation."}</span><button onClick={() => openCalibrationEstimate(calibrationItemId)}>{locale === "ru" ? "Уточнить оценку" : "Refine estimate"}</button></div>}
      {tentativeSleepEvent && <div className={styles.suggestionBanner}><span>{tentativeSleepEvent.actualStartAt
        ? (locale === "ru" ? `Сон перед ${tentativeSleepEvent.wakeDate} рассчитан предварительно по середине указанного диапазона. Подтвердите фактическое засыпание.` : `Sleep before ${tentativeSleepEvent.wakeDate} is tentative and uses the midpoint of your range. Confirm the actual bedtime.`)
        : (locale === "ru" ? `Время сна перед ${tentativeSleepEvent.wakeDate} пока неизвестно. Постоянный режим защищён, но задачи не перестраивались по выдуманному времени.` : `Bedtime before ${tentativeSleepEvent.wakeDate} is still unknown. The regular schedule remains protected and no speculative task moves were made.`)}</span><button onClick={() => openSleep("bedtime", tentativeSleepEvent.wakeDate)}>{locale === "ru" ? "Ложусь сейчас" : "Going to bed now"}</button></div>}
      {data.durationSuggestions?.[0] && <div className={styles.suggestionBanner}><span>{data.durationSuggestions[0].suggestedRange
        ? (locale === "ru" ? `После ${data.durationSuggestions[0].suggestedRange.sampleCount} сопоставимых выполнений «${data.durationSuggestions[0].title}» предлагается диапазон ${formatDuration(data.durationSuggestions[0].suggestedRange.minMinutes, locale)} — ${formatDuration(data.durationSuggestions[0].suggestedRange.likelyMinutes, locale)} — ${formatDuration(data.durationSuggestions[0].suggestedRange.maxMinutes, locale)}. Ничего не изменится без подтверждения.` : `After ${data.durationSuggestions[0].suggestedRange.sampleCount} comparable completions, “${data.durationSuggestions[0].title}” is suggested as ${formatDuration(data.durationSuggestions[0].suggestedRange.minMinutes, locale)} — ${formatDuration(data.durationSuggestions[0].suggestedRange.likelyMinutes, locale)} — ${formatDuration(data.durationSuggestions[0].suggestedRange.maxMinutes, locale)}. Nothing changes without confirmation.`)
        : (locale === "ru" ? `После трёх выполнений «${data.durationSuggestions[0].title}» обычно занимает ${formatDuration(data.durationSuggestions[0].suggestedMinutes, locale)}.` : `After three completions, “${data.durationSuggestions[0].title}” usually takes ${formatDuration(data.durationSuggestions[0].suggestedMinutes, locale)}.`)}</span><button onClick={() => void acceptDurationSuggestion(data.durationSuggestions![0].itemId, data.durationSuggestions![0].suggestedMinutes)}>{locale === "ru" ? "Применить предложение" : "Apply suggestion"}</button></div>}
      {data.sleepDurationSuggestion && <div className={styles.suggestionBanner}><span>{locale === "ru" ? `${data.sleepDurationSuggestion.reason} Предлагаем увеличить цель сна с ${formatDuration(data.sleepDurationSuggestion.currentMinutes, locale)} до ${formatDuration(data.sleepDurationSuggestion.suggestedMinutes, locale)}.` : `Your last seven comparable nights suggest increasing the sleep target from ${formatDuration(data.sleepDurationSuggestion.currentMinutes, locale)} to ${formatDuration(data.sleepDurationSuggestion.suggestedMinutes, locale)}.`}</span><button onClick={() => void acceptSleepDurationSuggestion(data.sleepDurationSuggestion!.suggestedMinutes)}>{locale === "ru" ? "Посмотреть изменение" : "Review change"}</button></div>}
      {data.sleepHealthNotice && <div className={styles.warningBanner}>{locale === "ru" ? data.sleepHealthNotice : "Your sleep schedule has shifted sharply several times in the last two weeks. The planner can protect recovery time, but persistent sleepiness or sleep problems are worth discussing with a professional."}</div>}

      <nav className={styles.mobileTabs} aria-label="Planner sections">
        <button className={mobileTab === "now" ? styles.mobileTabActive : ""} onClick={() => setMobileTab("now")}>{copy.now}</button>
        <button className={mobileTab === "calendar" ? styles.mobileTabActive : ""} onClick={() => { setMobileTab("calendar"); setView("day"); }}>{locale === "ru" ? "Расписание" : "Schedule"}</button>
        <button className={mobileTab === "inbox" ? styles.mobileTabActive : ""} onClick={() => setMobileTab("inbox")}>{copy.inbox}</button>
      </nav>

      <div className={styles.workspace}>
        <aside className={`${styles.inbox} ${mobileTab !== "inbox" ? styles.mobileHidden : ""}`}>
          <div className={styles.panelHead}><h2>{copy.inbox}</h2><span>{activeArchiverEntries.length + legacyUnplacedItems.length}</span></div>
          <p className={styles.panelHint}>{locale === "ru"
            ? "Сюда попадают дела, которым не нашлось места в плане: новые, пропущенные без отметки или оставшиеся без времени после переноса. Каждая запись останется здесь, пока вы не решите, что с ней сделать — вернуть в план, перестроить другие дела, отметить выполненной или отменить. Причина и итог попадут в статистику."
            : "Items that found no room in the plan come here: new items, missed items without a confirmation, and work left without time after a move. Every entry stays until you return it to the plan, rebuild other items, mark it done, or cancel it. Both the reason and outcome appear in statistics."}</p>
          <div className={styles.archiverTabs} role="tablist" aria-label={locale === "ru" ? "Разделы Архиватора дел" : "Task Archiver sections"}>
            <button className={archiverTab === "missed" ? styles.viewTabActive : ""} onClick={() => setArchiverTab("missed")}>{locale === "ru" ? "Пропущенные" : "Missed"}<span>{activeArchiverEntries.filter((entry) => entry.category === "missed").length}</span></button>
            <button className={archiverTab === "no_slot" ? styles.viewTabActive : ""} onClick={() => setArchiverTab("no_slot")}>{locale === "ru" ? "Без места" : "No slot"}<span>{activeArchiverEntries.filter((entry) => entry.category === "no_slot").length + legacyUnplacedItems.length}</span></button>
            <button className={archiverTab === "resolved" ? styles.viewTabActive : ""} onClick={() => setArchiverTab("resolved")}>{locale === "ru" ? "Разобранные" : "Resolved"}<span>{archiverEntries.filter((entry) => entry.resolvedAt).length}</span></button>
          </div>
          <div className={styles.inboxList}>
            {visibleArchiverEntries.map((entry) => <article key={entry.id} className={`${styles.inboxItem} ${entry.category === "missed" && !entry.resolvedAt ? styles.remainderUrgent : ""}`}>
              <span className={`${styles.priorityDot} ${entry.category === "missed" ? styles.critical : styles.high}`} />
              <div><strong>{entry.title}</strong><small>{entry.category === "missed" ? (locale === "ru" ? "Пропущено" : "Missed") : (locale === "ru" ? "Без места" : "No slot")} · {formatDuration(entry.pendingMinutes || entry.totalMinutes, locale)}</small><small>{formatDay(formatDateInTimeZone(new Date(entry.occurredAt), profile.timezone), locale)} · {formatTimeInTimeZone(new Date(entry.occurredAt), profile.timezone)}</small>{entry.itemId && items.find((item) => item.id === entry.itemId)?.deadlineAt && <small>{locale === "ru" ? "Срок" : "Due"}: {formatDay(formatDateInTimeZone(new Date(items.find((item) => item.id === entry.itemId)!.deadlineAt!), profile.timezone), locale)} · {formatTimeInTimeZone(new Date(items.find((item) => item.id === entry.itemId)!.deadlineAt!), profile.timezone)}</small>}<small className={styles.unplacedReason}>{entry.reason}</small>{entry.resolution
                ? <small>{locale === "ru" ? "Итог" : "Outcome"}: {archiverResolutionLabel(entry.resolution, locale)}{entry.outcomeNote ? ` · ${entry.outcomeNote}` : ""}</small>
                : entry.outcomeNote ? <small>{locale === "ru" ? "Текущее состояние" : "Current state"}: {entry.outcomeNote}</small> : null}</div>
              {!entry.resolvedAt && <button onClick={() => openArchiverEntry(entry)} aria-label={locale === "ru" ? `Разобрать ${entry.title}` : `Resolve ${entry.title}`}>→</button>}
            </article>)}
            {archiverTab === "no_slot" && legacyUnplacedItems.map((item) => (
              <article key={item.id} className={styles.inboxItem}>
                <span className={`${styles.priorityDot} ${styles[item.priority]}`} />
                <div><strong>{item.title}</strong><small>{kindLabel[locale][item.kind]} · {plannerItemDurationLabel(item, locale)}</small>{planningStateByItem.get(item.id) && <small>{locale === "ru" ? "Запрошено" : "Requested"}: {formatDuration(planningStateByItem.get(item.id)!.requestedMinutes, locale)} · {locale === "ru" ? "стоит" : "planned"}: {formatDuration(planningStateByItem.get(item.id)!.plannedMinutes, locale)} · {locale === "ru" ? "осталось" : "remaining"}: {formatDuration(planningStateByItem.get(item.id)!.remainingMinutes, locale)}</small>}{item.unplacedReason && <small className={styles.unplacedReason}>{locale === "ru" ? item.unplacedReason : "No safe slot matches availability, buffers and reserve."}</small>}</div>
                <button onClick={() => openItemConstructor(item, "schedule")} aria-label={locale === "ru" ? `Найти время для ${item.title}` : `Find time for ${item.title}`}>→</button>
              </article>
            ))}
            {visibleArchiverEntries.length === 0 && (archiverTab !== "no_slot" || legacyUnplacedItems.length === 0) && <p className={styles.emptyState}>{copy.noInbox}</p>}
          </div>
        </aside>

        <section className={`${styles.calendarPanel} ${mobileTab !== "calendar" ? styles.mobileHidden : ""}`}>
          <div className={styles.calendarToolbar}>
            <div className={styles.dateNav}>
              <button onClick={() => setSelectedDate(displayedView === "month" ? addPlannerMonths(selectedDate, -1) : addPlannerDays(selectedDate, displayedView === "week" ? -7 : -1))}>‹</button>
              <button className={styles.todayButton} onClick={() => setSelectedDate(todayIn(profile.timezone))}>{copy.today}</button>
              <button onClick={() => setSelectedDate(displayedView === "month" ? addPlannerMonths(selectedDate, 1) : addPlannerDays(selectedDate, displayedView === "week" ? 7 : 1))}>›</button>
              <strong>{formatDay(selectedDate, locale, { year: "numeric", month: "long" })}</strong>
            </div>
            <div className={styles.viewTabs} role="tablist">
              {(["day", "week", "month", "agenda"] as PlannerView[]).map((mode) => (
                <button key={mode} className={displayedView === mode ? styles.viewTabActive : ""} onClick={() => setView(mode)}>
                  {mode === "day" ? copy.day : mode === "week" ? copy.week : mode === "month" ? copy.month : copy.agenda}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.calendarLegend} aria-label={locale === "ru" ? "Обозначения календаря" : "Calendar legend"}>
            <span><i className={styles.legendFlexible} />{locale === "ru" ? "Гибкое дело" : "Flexible item"}</span>
            <span><i className={styles.legendFixed} />{locale === "ru" ? "Фиксированное" : "Fixed"}</span>
            <span><i className={styles.legendReserve} />{locale === "ru" ? "Запас времени" : "Time reserve"}</span>
            <span><i className={styles.legendTentative} />{locale === "ru" ? "Может сдвинуться" : "May move"}</span>
          </div>
          <div className={styles.mobileDateStrip} aria-label={locale === "ru" ? "Дни текущей недели" : "Current week days"}>
            {mobileWeekDates.map((date) => <button type="button" key={date} className={date === selectedDate ? styles.mobileDateActive : ""} onClick={() => { setSelectedDate(date); setView("day"); }}><span>{formatDay(date, locale, { weekday: "short" })}</span><strong>{date.slice(-2)}</strong></button>)}
          </div>

          {(displayedView === "day" || displayedView === "week") && (
            <TimeGrid
              dates={visibleDates} blocks={blocks} items={items} sleepBlocks={sleepBlocks} profile={profile} locale={locale}
              selectedDate={selectedDate} setSelectedDate={setSelectedDate}
              onSelect={openBlockDetails}
            />
          )}
          {displayedView === "month" && (
            <MonthGrid dates={visibleDates} blocks={blocks} sleepBlocks={sleepBlocks} profile={profile} locale={locale} selectedDate={selectedDate}
              onSelect={(date) => { setSelectedDate(date); setView("day"); }} />
          )}
          {displayedView === "agenda" && (
            <Agenda blocks={blocks} sleepBlocks={sleepBlocks} dates={visibleDates} profile={profile} locale={locale} onSelect={openBlockDetails} />
          )}
        </section>

        <aside className={`${styles.nowPanel} ${mobileTab !== "now" ? styles.mobileHidden : ""}`}>
          <div className={styles.panelHead}><h2>{copy.now}</h2><span className={styles.liveDot} /></div>
          <p className={styles.nowTime}>{formatTimeInTimeZone(now, profile.timezone)}</p>
          {graceBlocks.map((block) => {
            const secondsLeft = Math.max(0, Math.ceil((new Date(block.endAt).getTime() + 15 * 60_000 - now.getTime()) / 1000));
            const minutesLeft = Math.max(1, Math.ceil(secondsLeft / 60));
            return <article className={styles.graceCard} key={block.id}>
              <span>{locale === "ru" ? "Ждёт отметки" : "Awaiting confirmation"}</span>
              <h3>{block.title}</h3>
              <p>{locale === "ru" ? `Через ${minutesLeft} мин дело попадёт в Архиватор.` : `Moves to the Task Archiver in ${minutesLeft} min.`}</p>
              <div className={styles.quickActions}>
                <button className={styles.doneButton} onClick={() => void blockAction(block, "done")}>{copy.done}</button>
                <button onClick={() => { setMissedBlock(block); setModal("missed"); }}>{locale === "ru" ? "Перенести" : "Reschedule"}</button>
                <button onClick={() => void blockAction(block, "skip")}>{locale === "ru" ? "Пропустить" : "Miss"}</button>
                <button onClick={() => openConstructor("cancel", block.id)}>{locale === "ru" ? "Отменить" : "Cancel"}</button>
              </div>
            </article>;
          })}
          {currentBlock ? (
            <article className={styles.currentCard}>
              <span>{currentBlock.status === "in_progress" ? (locale === "ru" ? "В процессе" : "In progress") : (locale === "ru" ? "По плану сейчас" : "Scheduled now")}</span>
              <h3>{currentBlock.title}</h3>
              <p>{formatCountdown(currentBlock.endAt, now, locale)}</p>
              {currentProgress >= .8 && currentProgress < 1 && <div className={styles.progressPrompt}>{locale === "ru" ? "Вы использовали около 80% обычной длительности. Блок скоро закончится — ничего переносить пока не нужно." : "You have used about 80% of the usual duration. The block is nearing its end; nothing moves yet."}</div>}
              {currentProgress >= 1 && <div className={styles.progressPrompt}><strong>{locale === "ru" ? "Обычная длительность закончилась. Как продолжить?" : "The usual duration has elapsed. What next?"}</strong><div><button onClick={() => void blockAction(currentBlock, "done")}>{locale === "ru" ? "Готово" : "Done"}</button><button onClick={() => openConstructor("time", currentBlock.id)}>{locale === "ru" ? "Изменить окончание" : "Change end time"}</button><button onClick={() => setNotice(locale === "ru" ? "Оценка пока не меняется. Дело останется активным, а вы сможете уточнить время позже." : "The estimate stays unchanged. The item remains active and can be refined later.")}>{locale === "ru" ? "Пока не могу оценить" : "Can't estimate yet"}</button></div></div>}
              {currentItem?.deadlineAt && <div className={styles.nowDeadline}><span>{currentItem.deadlineType === "hard" ? (locale === "ru" ? "Жёсткий срок" : "Hard deadline") : (locale === "ru" ? "Целевой срок" : "Target deadline")}</span>{currentItem.targetFinishAt && <small>{locale === "ru" ? "Внутренняя цель" : "Internal target"}: {formatDay(formatDateInTimeZone(new Date(currentItem.targetFinishAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(currentItem.targetFinishAt), profile.timezone)}</small>}<small>{locale === "ru" ? "Окончательный срок" : "Final deadline"}: {formatDay(formatDateInTimeZone(new Date(currentItem.deadlineAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(currentItem.deadlineAt), profile.timezone)}</small>{currentItem.deadlinePolicy.nextItemId && <small>{locale === "ru" ? "Следом" : "Next"}: {items.find((item) => item.id === currentItem.deadlinePolicy.nextItemId)?.title ?? (locale === "ru" ? "выбранное дело" : "selected item")}</small>}</div>}
              <div className={styles.quickActions}>
                {currentBlock.status !== "in_progress" && <button onClick={() => void blockAction(currentBlock, "start")}>{copy.start}</button>}
                {currentBlock.status === "in_progress" && <button onClick={() => void blockAction(currentBlock, "pause")}>{copy.pause}</button>}
                <button className={styles.doneButton} onClick={() => void blockAction(currentBlock, "done")}>{copy.done}</button>
                <button onClick={() => openConstructor("replace", currentBlock.id)}>{locale === "ru" ? "Заменить" : "Replace"}</button>
                <button onClick={() => openConstructor("move", currentBlock.id)}>{locale === "ru" ? "Перенести" : "Move"}</button>
                {currentItem && <button onClick={() => openConstructor("duration", currentBlock.id)}>{locale === "ru" ? "Длительность" : "Duration"}</button>}
                <button onClick={() => openConstructor("cancel", currentBlock.id)}>{locale === "ru" ? "Отменить" : "Cancel"}</button>
              </div>
            </article>
          ) : <div className={styles.freeCard}><strong>{copy.free}</strong><p>{nextBlock ? formatDuration(rawFreeMinutes, locale) : copy.empty}</p>{nextBlock && <><small>{locale === "ru" ? `После перехода доступно ${formatDuration(afterTransitionMinutes, locale)}; резерв защищает ${formatDuration(protectedReserveMinutes, locale)}; полезная ёмкость — ${formatDuration(safeFreeMinutes, locale)}.` : `${formatDuration(afterTransitionMinutes, locale)} remains after transition; ${formatDuration(protectedReserveMinutes, locale)} is protected reserve; usable capacity is ${formatDuration(safeFreeMinutes, locale)}.`}</small>{fittingInboxItem ? <small>{locale === "ru" ? `Окно может занять «${fittingInboxItem.title}».` : `“${fittingInboxItem.title}” can use this window.`}</small> : <small>{locale === "ru" ? "В Архиваторе нет дела, которое безопасно поместится целиком или минимальной частью." : "No Task Archiver item safely fits as a whole or minimum chunk."}</small>}</>}</div>}

          <div className={styles.nextSection}>
            <h3>{copy.next}</h3>
            {nextBlock ? <BlockSummary block={nextBlock} profile={profile} locale={locale} /> : <p className={styles.emptyState}>{copy.empty}</p>}
          </div>
          <div className={styles.healthCard}>
            <span>{todayHealth.overloaded ? copy.overloaded : copy.balanced}</span><strong>{todayHealth.freePercent}%</strong>
            <div><i style={{ width: `${todayHealth.freePercent}%` }} /></div>
            <small>{locale === "ru" ? `свободно сегодня; цель резерва — ${Math.round(profile.reserveRatio * 100)}%` : `free today; reserve target is ${Math.round(profile.reserveRatio * 100)}%`}</small>
          </div>
          <button className={styles.changeWide} onClick={() => openConstructor()}>＋ {locale === "ru" ? "Конструктор плана" : "Plan constructor"}</button>
          <div className={styles.sleepQuickGrid}>
            <button onClick={() => openConstructor("sleep")}>■ {locale === "ru" ? "Изменить сон" : "Change sleep"}</button>
            <button onClick={() => openSleep("checkin")}>? {locale === "ru" ? "Как я выспался" : "How I slept"}</button>
          </div>
        </aside>
      </div>

      {(showAssistantSetup || modal === "assistant") && <AutoplannerModal
        profile={profile}
        items={items}
        blocks={blocks}
        sleepEventsCount={data.sleepEvents.length}
        locale={locale}
        firstRun={showAssistantSetup}
        upgradeOnly={showAssistantSetup && profile.assistantSetupVersion > 0}
        busy={busy}
        onClose={showAssistantSetup ? undefined : () => setModal(null)}
        onEstimateTravel={(input) => api<PlannerTravelEstimateResult>("/api/planner/travel/estimate", { method: "POST", body: JSON.stringify(input) })}
        onPrepare={(input) => run(() => createProposal(input))}
        requestError={error}
        onClearRequestError={() => setError(null)}
        onOpenSleep={() => openConstructor("sleep")}
        onReset={(password) => run(async () => {
          await api("/api/planner/reset", { method: "POST", body: JSON.stringify({ password, expectedRevision: profile.revision }) });
          try {
            window.localStorage.removeItem("itemkey.planner.autoplanner.v2");
            window.localStorage.removeItem("itemkey.planner.saved-places.v1");
          } catch { /* optional draft storage */ }
          setModal(null);
          await load(true);
        })}
      />}
      {modal === "details" && detailsBlock && <ItemDetailsModal
        key={detailsBlock.id}
        block={detailsBlock}
        item={detailsItem}
        blocks={blocks}
        profile={profile}
        planningState={data.planningStates?.find((entry) => entry.itemId === detailsBlock.itemId)}
        calibration={data.calibrationProgress?.find((entry) => entry.itemId === detailsBlock.itemId)}
        now={now}
        locale={locale}
        onClose={() => setModal(null)}
        onConstruct={() => openConstructor(undefined, detailsBlock.soft
          ? blocks.find((candidate) => candidate.itemId === detailsBlock.itemId && !candidate.soft && candidate.status === "planned" && new Date(candidate.endAt) > now)?.id
          : detailsBlock.id, {
          itemId: detailsBlock.itemId!,
          blockId: detailsBlock.soft ? undefined : detailsBlock.id,
          occurrenceKey: detailsBlock.soft ? undefined : detailsBlock.occurrenceKey,
        })}
      />}
      {modal === "details" && detailsBlockId && !detailsBlock && <div className={styles.modalBackdrop} role="presentation"><section className={`${styles.modal} ${styles.itemDetailsModal}`} role="dialog" aria-modal="true" aria-label={locale === "ru" ? "Устаревшее выполнение" : "Stale occurrence"}><header><div><h2>{locale === "ru" ? "Выполнение изменилось" : "Occurrence changed"}</h2><small>{locale === "ru" ? "Нужны свежие данные" : "Fresh data required"}</small></div></header><div className={styles.itemDetailsBody}><p className={styles.inlineError}>{locale === "ru" ? "Выбранный блок исчез или был изменён в другой версии плана. Ближайшее дело не подставлено — закройте карточку и выберите выполнение снова." : "The selected block disappeared or changed in another plan revision. No nearest item was substituted; close this card and select the occurrence again."}</p></div><div className={styles.modalActions}><button type="button" onClick={() => { setModal(null); setDetailsBlockId(undefined); }}>{locale === "ru" ? "Закрыть" : "Close"}</button></div></section></div>}
      {modal === "constructor" && <PlanConstructorModal
        key={`${constructorLocalTarget?.itemId ?? "plan"}:${constructorBlockId ?? "none"}:${constructorAction ?? "catalog"}`}
        profile={profile}
        items={items}
        blocks={blocks}
        currentBlock={currentBlock}
        selectedDate={selectedDate}
        now={now}
        locale={locale}
        busy={busy}
        initialAction={constructorAction}
        initialBlockId={constructorBlockId}
        localTarget={constructorLocalTarget}
        onEstimateTravel={(input) => api<PlannerTravelEstimateResult>("/api/planner/travel/estimate", { method: "POST", body: JSON.stringify(input) })}
        onClose={() => setModal(null)}
        onReview={(operation) => run(() => createProposal({ operation, trigger: "constructor" }))}
      />}
      {modal === "sleep" && <SleepChangedModal profile={profile} locale={locale} busy={busy} initialMode={sleepModalMode} initialWakeDate={sleepModalWakeDate} onClose={() => setModal(null)} onSubmit={(sleepEvent: PlannerSleepEvent) => run(() => createProposal({ sleepEvent, trigger: "sleep_changed", rebuildFuture: Boolean(sleepEvent.actualStartAt) }))} onCheckIn={checkInSleep} />}
      {modal === "extension" && extensionBlock && <ExtensionDurationModal
        block={extensionBlock}
        locale={locale}
        busy={busy}
        onClose={() => { setExtensionBlock(null); setModal(null); }}
        onReview={(minutes) => reviewBlockExtension(extensionBlock, minutes)}
      />}
      {modal === "archiver" && archiverEntry && <ArchiverResolutionModal
        entry={archiverEntry}
        blocks={blocks}
        item={archiverEntry.itemId ? items.find((item) => item.id === archiverEntry.itemId) : undefined}
        profile={profile}
        now={now}
        locale={locale}
        busy={busy}
        onClose={() => { setArchiverEntry(null); setModal(null); }}
        onEditItem={() => {
          const item = archiverEntry.itemId ? items.find((candidate) => candidate.id === archiverEntry.itemId) : undefined;
          if (item) { setArchiverEntry(null); openItemConstructor(item); }
        }}
        onReview={(operation) => run(() => createProposal({ trigger: "constructor", operation }))}
      />}
      {modal === "missed" && missedBlock && <MissedOccurrenceModal
        block={missedBlock}
        item={missedBlock.itemId ? items.find((item) => item.id === missedBlock.itemId) : undefined}
        locale={locale}
        busy={busy}
        onClose={() => { setMissedBlock(null); setModal(null); }}
        onReview={(missedOccurrence) => run(() => createProposal({ trigger: "plans_changed", rebuildFuture: true, missedOccurrence }))}
      />}
      {modal === "item" && <ItemModal value={itemForm} setValue={setItemForm} items={items} profile={profile} now={now} onSubmit={submitItem} onClose={() => setModal(null)} busy={busy} locale={locale} />}
      {modal === "proposal" && proposal && <ProposalModal proposal={proposal} profile={profile} items={items} locale={locale} busy={busy}
        onClose={() => setModal(null)} onApply={applyProposal} onEdit={() => {
          const operation = proposal.operation;
          if (operation?.kind === "resolve_archiver_entry") {
            const entry = archiverEntries.find((candidate) => candidate.id === operation.entryId);
            if (entry) { setArchiverEntry(entry); setModal("archiver"); }
          } else if (operation) openConstructor(actionForOperation(operation.kind), blockForOperation(operation));
          else if (proposal.normalizedDraft) openItem(proposal.normalizedDraft);
          else setModal(proposal.trigger === "sleep_changed" ? "sleep" : "settings");
        }}
        onResolve={(groupId, optionId) => run(() => {
          const replay = replayProposalInput(proposal);
          let operation = replay.operation;
          if (operation?.kind === "resolve_archiver_entry" && operation.resolution.kind === "schedule"
            && groupId.startsWith("archiver-conflict:")) {
            const blockId = groupId.slice("archiver-conflict:".length);
            const disposition = optionId.slice(0, optionId.indexOf(":")) as "move" | "shorten" | "archive" | "cancel" | "keep";
            operation = {
              ...operation,
              resolution: {
                ...operation.resolution,
                conflictDecisions: [
                  ...(operation.resolution.conflictDecisions ?? []).filter((decision) => decision.blockId !== blockId),
                  { blockId, disposition },
                ],
              },
            };
          }
          return createProposal({
            ...replay,
            operation,
            decisions: [...(proposal.decisions ?? []).filter((decision) => decision.groupId !== groupId), { groupId, optionId }],
          });
        })}
        onSwitchFocus={(planningFocusOverride) => run(() => createProposal({ ...replayProposalInput(proposal), planningFocusOverride }))}
        onAddRecoveryNap={async (nap) => {
          const replay = replayProposalInput(proposal);
          await run(() => createProposal({
            ...replay,
            drafts: [...(replay.drafts ?? []), {
              title: locale === "ru" ? "Короткий восстановительный сон" : "Short recovery nap",
              kind: "fixed_event",
              date: formatDateInTimeZone(new Date(nap.startAt), profile.timezone),
              start: formatTimeInTimeZone(new Date(nap.startAt), profile.timezone),
              end: formatTimeInTimeZone(new Date(nap.endAt), profile.timezone),
              estimateMinutes: 20,
            }],
            trigger: "sleep_changed",
            rebuildFuture: true,
          }));
        }}
        onFinishFirst={async (blockId, protectedId) => {
          const block = blocks.find((candidate) => candidate.id === blockId);
          const draft = proposal.normalizedDraft;
          if (!block) return;
          if (!draft) {
            const replay = replayProposalInput(proposal);
            const wakeDate = replay.sleepEvent?.wakeDate ?? (protectedId.startsWith("sleep-") ? protectedId.slice(6) : undefined);
            if (!wakeDate) { setModal(proposal.trigger === "sleep_changed" ? "sleep" : "settings"); return; }
            const nextProfile = replay.profilePatch ? { ...profile, ...replay.profilePatch } : profile;
            await run(() => createProposal({
              ...replay,
              sleepEvent: createPlannerSleepEvent({ profile: nextProfile, wakeDate, actualStartAt: block.endAt }),
              rebuildFuture: true,
            }));
            return;
          }
          const duration = draft.estimateMinutes ?? 60;
          const delayedEnd = addIsoMinutes(block.endAt, duration);
          await run(() => createProposal({
            draft: {
              ...draft,
              title: draft.title,
              date: formatDateInTimeZone(new Date(block.endAt), profile.timezone),
              start: formatTimeInTimeZone(new Date(block.endAt), profile.timezone),
              end: formatTimeInTimeZone(new Date(delayedEnd), profile.timezone),
            },
            trigger: "plans_changed",
          }));
        }}
        onPause={async (blockId) => {
          const block = blocks.find((candidate) => candidate.id === blockId);
          if (!block) return;
          if (!await blockAction(block, "pause")) return;
          await run(() => createProposal(replayProposalInput(proposal)));
        }} />}
      {modal === "settings" && <SettingsModal profile={profile} locale={locale} busy={busy} onClose={() => setModal(null)} onOpenSleepSettings={() => setModal("assistant")} onSave={(profilePatch) => run(() => createProposal({ profilePatch, trigger: "assistant_update", rebuildFuture: true }))} />}
      {modal === "stats" && <StatsModal blocks={blocks} items={items} archiverEntries={archiverEntries} profile={profile} locale={locale} onClose={() => setModal(null)} />}
      {modal === "import" && <LegacyImportModal key={legacySources.map((source) => `${source.sourceKey}:${source.alreadyImported}`).join("|")} sources={legacySources} locale={locale} busy={busy} loading={legacyLoading} onClose={() => setModal(null)} onImport={importLegacy} />}
    </main>
  );
}

function TimeGrid({ dates, blocks, items, sleepBlocks, profile, locale, selectedDate, setSelectedDate, onSelect }: {
  dates: string[]; blocks: PlannerBlock[]; items: PlannerItem[]; sleepBlocks: PlannerSleepBlock[]; profile: PlannerProfile; locale: Locale;
  selectedDate: string; setSelectedDate: (date: string) => void;
  onSelect: (block: PlannerBlock) => void;
}) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const technicalTravelBlocks = blocks.flatMap((block): PlannerBlock[] => {
    if (block.soft || ["cancelled", "skipped"].includes(block.status) || !block.itemId) return [];
    const item = itemById.get(block.itemId);
    const travel = item?.uncertaintyPolicy.travel;
    if (!item || !travel || travel.likelyMinutes <= 0) return [];
    const outboundMinutes = Math.min(travel.likelyMinutes, item.bufferBeforeMinutes);
    const preparationMinutes = Math.max(0, item.bufferBeforeMinutes - outboundMinutes);
    const before: PlannerBlock[] = [];
    if (preparationMinutes > 0) before.push({
      id: `technical-travel-buffer:${block.id}`,
      title: locale === "ru" ? `Техническое время · запас перед дорогой — ${item.title}` : `Technical time · pre-travel buffer — ${item.title}`,
      startAt: addIsoMinutes(block.startAt, -item.bufferBeforeMinutes),
      endAt: addIsoMinutes(block.startAt, -outboundMinutes),
      status: "planned", source: "auto", fixed: true, role: "protected_free",
    });
    if (outboundMinutes > 0) before.push({
      id: `technical-travel-out:${block.id}`,
      title: locale === "ru" ? `Техническое время · дорога туда — ${item.title}` : `Technical time · outbound travel — ${item.title}`,
      startAt: addIsoMinutes(block.startAt, -outboundMinutes),
      endAt: block.startAt,
      status: "planned", source: "auto", fixed: true, role: "protected_free",
    });
    if (item.bufferAfterMinutes > 0) before.push({
      id: `technical-travel-back:${block.id}`,
      title: locale === "ru" ? `Техническое время · дорога домой — ${item.title}` : `Technical time · return travel — ${item.title}`,
      startAt: block.endAt,
      endAt: addIsoMinutes(block.endAt, item.bufferAfterMinutes),
      status: "planned", source: "auto", fixed: true, role: "protected_free",
    });
    return before;
  });
  const calendarBlocks: CalendarBlock[] = [...blocks, ...technicalTravelBlocks, ...splitSleepBlocksByDate(sleepBlocks, dates, profile.timezone)];
  const relevantWindows = dates.flatMap((date) => profile.availabilityOverrides[date] ?? profile.availability[String(plannerWeekday(date))] ?? []);
  const relevantBlocks = calendarBlocks.filter((block) => dates.includes(localDate(block, profile.timezone)));
  const starts = [
    ...relevantWindows.map((window) => plannerTimeToMinutes(window.start)),
    ...relevantBlocks.map((block) => minutesInZone(block.startAt, profile.timezone)),
  ];
  const ends = [
    ...relevantWindows.map((window) => {
      const start = plannerTimeToMinutes(window.start);
      const end = plannerTimeToMinutes(window.end);
      return end <= start ? 1440 : end;
    }),
    ...relevantBlocks.map((block) => Math.min(1440, minutesInZone(block.startAt, profile.timezone) + isoDurationMinutes(block.startAt, block.endAt))),
  ];
  const dayStart = Math.max(0, Math.floor(((starts.length ? Math.min(...starts) : 8 * 60) - 60) / 60) * 60);
  const dayEnd = Math.min(1440, Math.ceil(((ends.length ? Math.max(...ends) : 22 * 60) + 60) / 60) * 60);
  const height = Math.max(720, dayEnd - dayStart);
  const hours = Array.from({ length: Math.floor((dayEnd - dayStart) / 60) + 1 }, (_, index) => dayStart / 60 + index);
  const minimumVisualMinutes = Math.max(18, Math.ceil(((dayEnd - dayStart) / height) * 28));
  return (
    <div className={styles.timeGridShell}>
      <div className={styles.dayHeaders} style={{ gridTemplateColumns: `4.2rem repeat(${dates.length}, minmax(8rem, 1fr))` }}>
        <span />{dates.map((date) => <button key={date} className={date === selectedDate ? styles.selectedDay : ""} onClick={() => setSelectedDate(date)}>{formatDay(date, locale, { weekday: "short" })}</button>)}
      </div>
      <div className={styles.timeGrid} style={{ gridTemplateColumns: `4.2rem repeat(${dates.length}, minmax(8rem, 1fr))`, minWidth: `${4.2 + dates.length * 8}rem` }}>
        <div className={styles.timeAxis} style={{ height }}>{hours.map((hour) => <span key={hour} style={{ top: `${((hour * 60 - dayStart) / (dayEnd - dayStart)) * 100}%` }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
        {dates.map((date) => {
          const dayBlocks = calendarBlocks
            .filter((block) => localDate(block, profile.timezone) === date && (isSleepBlock(block) || !["cancelled", "skipped"].includes(block.status)))
            .sort((left, right) => left.startAt.localeCompare(right.startAt) || left.endAt.localeCompare(right.endAt));
          const layout = new Map(layoutCalendarEntries(dayBlocks.map((block) => ({
            id: block.id,
            startMinute: minutesInZone(block.startAt, profile.timezone),
            durationMinutes: isoDurationMinutes(block.startAt, block.endAt),
            soft: !isSleepBlock(block) && Boolean(block.soft),
          })), minimumVisualMinutes).map((entry) => [entry.id, entry]));
          const occurrenceParts = new Map<string, PlannerBlock[]>();
          for (const block of dayBlocks) {
            if (isSleepBlock(block) || block.soft || !block.itemId || !block.occurrenceKey) continue;
            const key = `${block.itemId}:${block.occurrenceKey}`;
            occurrenceParts.set(key, [...(occurrenceParts.get(key) ?? []), block]);
          }
          return <div key={date} className={`${styles.dayColumn} ${date === selectedDate ? styles.selectedDayColumn : ""}`} style={{ height }}>
            {hours.map((hour) => <i key={hour} style={{ top: `${((hour * 60 - dayStart) / (dayEnd - dayStart)) * 100}%` }} />)}
            {dayBlocks.map((block) => {
              const sleep = isSleepBlock(block);
              const technicalTravel = !sleep && block.id.startsWith("technical-travel-");
              const start = minutesInZone(block.startAt, profile.timezone);
              const duration = isoDurationMinutes(block.startAt, block.endAt);
              const top = ((start - dayStart) / (dayEnd - dayStart)) * 100;
              const size = Math.max(2.3, (duration / (dayEnd - dayStart)) * 100);
              const position = layout.get(block.id) ?? { lane: 0, laneCount: 1 };
              const leftPercent = (position.lane / position.laneCount) * 100;
              const widthPercent = 100 / position.laneCount;
              const partKey = !sleep && block.itemId && block.occurrenceKey ? `${block.itemId}:${block.occurrenceKey}` : "";
              const parts = partKey ? occurrenceParts.get(partKey) ?? [] : [];
              const partIndex = !sleep && parts.length > 1 ? parts.findIndex((candidate) => candidate.id === block.id) + 1 : 0;
              const className = `${styles.calendarBlock} ${duration <= minimumVisualMinutes ? styles.compactCalendarBlock : ""} ${technicalTravel ? styles.technicalTravelBlock : sleep ? styles.sleepBlock : styles[block.fixed ? "fixedBlock" : "flexibleBlock"]} ${sleep && block.tentative ? styles.sleepTentative : ""} ${sleep && block.recoveryNight ? styles.sleepRecovery : ""} ${!sleep && block.soft ? styles.softReserveBlock : ""} ${!sleep && block.tentative ? styles.tentativeWorkBlock : ""} ${!sleep && block.status !== "planned" ? styles[block.status] ?? "" : ""}`;
              const title = sleep
                ? block.recoveryNight ? (locale === "ru" ? "Сон · восстановление" : "Sleep · recovery") : (locale === "ru" ? "Сон" : "Sleep")
                : block.soft ? `${locale === "ru" ? "Технический запас" : "Technical reserve"} · ${block.title}` : block.title;
              const content = <><strong>{title}</strong><small>{sleep ? "■" : technicalTravel ? "⇄" : block.soft ? "≈" : block.fixed ? "◆" : "↝"} {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)} · {formatDuration(duration, locale)}</small>{partIndex > 0 && <small>{locale === "ru" ? `Часть ${partIndex} из ${parts.length} одного выполнения` : `Part ${partIndex} of ${parts.length} of one occurrence`}</small>}{technicalTravel ? <small>{locale === "ru" ? "Не считается выполнением дела" : "Not counted as an item occurrence"}</small> : !sleep && block.soft ? <small>{locale === "ru" ? "Не отдельное дело · запас до" : "Not a separate item · reserve until"} {formatTimeInTimeZone(new Date(block.endAt), profile.timezone)}</small> : !sleep && block.tentative ? <small>{locale === "ru" ? "Может сдвинуться" : "May move"}</small> : sleep ? <small>{locale === "ru" ? "Защищено" : "Protected"}</small> : null}</>;
              const blockStyle = { top: `${top}%`, height: `${size}%`, left: `calc(${leftPercent}% + 2px)`, width: `calc(${widthPercent}% - 4px)`, right: "auto" };
              return sleep || technicalTravel
                ? <article key={block.id} className={className} style={blockStyle}>{content}</article>
                : <button type="button" key={block.id} className={className} style={blockStyle} onClick={() => onSelect(block)} aria-label={locale === "ru" ? `Открыть сведения: ${block.title}, ${formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}` : `Open details: ${block.title}, ${formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}`}>{content}</button>;
            })}
            {date === todayIn(profile.timezone) && <div className={styles.nowLine} style={{ top: `${((minutesInZone(new Date().toISOString(), profile.timezone) - dayStart) / (dayEnd - dayStart)) * 100}%` }} />}
          </div>;
        })}
      </div>
    </div>
  );
}

function MonthGrid({ dates, blocks, sleepBlocks, profile, locale, selectedDate, onSelect }: {
  dates: string[]; blocks: PlannerBlock[]; sleepBlocks: PlannerSleepBlock[]; profile: PlannerProfile; locale: Locale; selectedDate: string; onSelect: (date: string) => void;
}) {
  return <div className={styles.monthGrid}>{dates.map((date) => {
    const dayBlocks: CalendarBlock[] = [...blocks.filter((block) => localDate(block, profile.timezone) === date && !["cancelled", "skipped"].includes(block.status)), ...splitSleepBlocksByDate(sleepBlocks, [date], profile.timezone)];
    return <button key={date} onClick={() => onSelect(date)} className={`${styles.monthDay} ${date === selectedDate ? styles.monthSelected : ""} ${date.slice(0, 7) !== selectedDate.slice(0, 7) ? styles.otherMonth : ""}`}>
      <span>{formatDay(date, locale, { weekday: "short" })}</span><strong>{date.slice(-2)}</strong>
      <div>{dayBlocks.slice(0, 3).map((block) => <i key={block.id} className={isSleepBlock(block) ? styles.sleepPill : block.soft ? styles.softPill : block.fixed ? styles.fixedPill : styles.flexPill}>{isSleepBlock(block) ? "■" : block.soft ? "≈" : block.fixed ? "◆" : "↝"} {isSleepBlock(block) ? (locale === "ru" ? "Сон" : "Sleep") : block.soft ? (locale === "ru" ? "Мягкий резерв" : "Soft reserve") : block.title}</i>)}</div>
      {dayBlocks.length > 3 && <small>+{dayBlocks.length - 3}</small>}
    </button>;
  })}</div>;
}

function Agenda({ blocks, sleepBlocks, dates, profile, locale, onSelect }: {
  blocks: PlannerBlock[]; sleepBlocks: PlannerSleepBlock[]; dates: string[]; profile: PlannerProfile; locale: Locale;
  onSelect: (block: PlannerBlock) => void;
}) {
  const selected: CalendarBlock[] = [...blocks.filter((block) => dates.includes(localDate(block, profile.timezone)) && block.status !== "cancelled"), ...splitSleepBlocksByDate(sleepBlocks, dates, profile.timezone)].sort((a, b) => a.startAt.localeCompare(b.startAt));
  return <div className={styles.agenda}>{selected.map((block) => isSleepBlock(block) ? <article key={block.id}>
    <time>{formatDay(localDate(block, profile.timezone), locale)} · {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}</time>
    <div><strong>{locale === "ru" ? "Сон · защищено" : "Sleep · protected"}</strong><small>{formatDuration(isoDurationMinutes(block.startAt, block.endAt), locale)}</small></div>
  </article> : <button type="button" key={block.id} className={styles.agendaItemButton} onClick={() => onSelect(block)}>
    <time>{formatDay(localDate(block, profile.timezone), locale)} · {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}</time>
    <div><strong>{block.soft ? `${block.title} · ${locale === "ru" ? "запас" : "reserve"}` : block.title}</strong><small>{formatDuration(isoDurationMinutes(block.startAt, block.endAt), locale)}{block.tentative ? ` · ${locale === "ru" ? "может сдвинуться" : "may move"}` : block.soft ? ` · ${locale === "ru" ? "не блокирует" : "non-blocking"}` : ` · ${blockStatusLabel[locale][block.status]}`}</small></div>
  </button>)}</div>;
}

function BlockSummary({ block, profile, locale }: { block: PlannerBlock; profile: PlannerProfile; locale: Locale }) {
  return <article className={styles.blockSummary}><span>{formatDay(localDate(block, profile.timezone), locale)}</span><strong>{block.title}</strong><small>{formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(block.endAt), profile.timezone)}</small></article>;
}

function ModalShell({ children, onClose, title, locale }: { children: React.ReactNode; onClose?: () => void; title: string; locale: Locale }) {
  return <div className={styles.modalBackdrop} role="presentation"><section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2>{onClose && <button onClick={onClose} aria-label={locale === "ru" ? "Закрыть" : "Close"}>×</button>}</header>{children}
  </section></div>;
}

function ItemModal({ value, setValue, items, profile, now, onSubmit, onClose, busy, locale }: {
  value: ItemForm; setValue: React.Dispatch<React.SetStateAction<ItemForm>>;
  items: PlannerItem[];
  profile: PlannerProfile;
  now: Date;
  onSubmit: (event: FormEvent) => Promise<void>; onClose: () => void; busy: boolean; locale: Locale;
}) {
  const update = <K extends keyof ItemForm>(key: K, next: ItemForm[K]) => setValue((current) => ({ ...current, [key]: next }));
  const updateLikelyDuration = (minutes: number) => setValue((current) => {
    if (current.durationEstimateMode !== "approximate") return { ...current, estimateMinutes: String(minutes) };
    const tolerance = Number(current.durationTolerancePercent) / 100;
    return {
      ...current,
      estimateMinutes: String(minutes),
      minimumDurationMinutes: String(Math.max(5, Math.round(minutes * (1 - tolerance)))),
      maximumDurationMinutes: String(Math.max(minutes, Math.round(minutes * (1 + tolerance)))),
    };
  });
  const deadlinePreview = value.deadlineType !== "none" && value.deadline
    ? (() => {
        const deadlineAt = new Date(zonedPlannerDateTimeToUtc(value.deadline, value.deadlineTime || "23:59", profile.timezone)).getTime();
        const remaining = Math.max(0, Math.floor((deadlineAt - now.getTime()) / 60_000));
        const estimate = Number(value.estimateMinutes) || 60;
        return remaining < estimate
          ? (locale === "ru" ? "Физически не помещается" : "Cannot physically fit")
          : remaining < estimate * 2
            ? (locale === "ru" ? "Под угрозой" : "At risk")
            : remaining < estimate * 3
              ? (locale === "ru" ? "Плотно" : "Tight")
              : (locale === "ru" ? "Успеваем" : "On track");
      })()
    : undefined;
  return <ModalShell title={locale === "ru" ? "Дело и его ограничения" : "Item and constraints"} onClose={onClose} locale={locale}>
    <form onSubmit={(event) => void onSubmit(event)} className={styles.form}>
      <div className={styles.formGrid}>
        <label className={styles.wide}>{locale === "ru" ? "Название" : "Title"}<input autoFocus required value={value.title} onChange={(e) => update("title", e.target.value)} /></label>
        <label>{locale === "ru" ? "Вид" : "Type"}<select value={value.kind} onChange={(e) => update("kind", e.target.value as PlannerItemKind)}>{Object.entries(kindLabel[locale]).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
        {value.kind !== "fixed_event" && <><label>{locale === "ru" ? "Что планируем" : "Planning goal"}<select value={value.outcomeMode} onChange={(e) => update("outcomeMode", e.target.value as ItemForm["outcomeMode"])}><option value="deliverable">{locale === "ru" ? "Закончить результат — общий объём" : "Finish a result — total workload"}</option><option value="time_budget">{locale === "ru" ? "Просто выделять время" : "Simply allocate time"}</option></select></label><label>{locale === "ru" ? "Точность длительности" : "Duration certainty"}<select value={value.durationEstimateMode} onChange={(e) => { const mode = e.target.value as PlannerEstimateMode; setValue((current) => ({ ...current, durationEstimateMode: mode, canSplit: mode === "range" ? true : current.canSplit })); }}><option value="exact">{locale === "ru" ? "Точно" : "Exact"}</option><option value="approximate">{locale === "ru" ? "Примерно" : "Approximate"}</option><option value="range">{locale === "ru" ? "Диапазон" : "Range"}</option><option value="unknown">{locale === "ru" ? "Не знаю — пробная сессия" : "Unknown — calibration session"}</option></select></label></>}
        {value.kind !== "fixed_event" && value.durationEstimateMode !== "unknown" && <DurationInput label={value.durationEstimateMode === "exact" ? (locale === "ru" ? "Длительность" : "Duration") : (locale === "ru" ? "Обычно" : "Usually")} valueMinutes={value.estimateMinutes} minMinutes={5} maxMinutes={value.outcomeMode === "deliverable" ? 600000 : 1440} locale={locale} onChangeMinutes={updateLikelyDuration} />}
        {value.kind !== "fixed_event" && value.durationEstimateMode === "unknown" && <DurationInput label={locale === "ru" ? "Пробная сессия" : "Calibration session"} valueMinutes={value.calibrationMinutes} minMinutes={5} maxMinutes={1440} locale={locale} onChangeMinutes={(minutes) => update("calibrationMinutes", String(minutes))} />}
        {value.kind !== "fixed_event" && (value.durationEstimateMode === "approximate" || value.durationEstimateMode === "range") && <><DurationInput label={locale === "ru" ? "Минимум" : "Minimum"} valueMinutes={value.minimumDurationMinutes} minMinutes={5} maxMinutes={Number(value.estimateMinutes) || 600000} locale={locale} onChangeMinutes={(minutes) => update("minimumDurationMinutes", String(minutes))} /><DurationInput label={locale === "ru" ? "Максимум" : "Maximum"} valueMinutes={value.maximumDurationMinutes} minMinutes={Number(value.estimateMinutes) || 5} maxMinutes={value.outcomeMode === "deliverable" ? 600000 : 1440} locale={locale} onChangeMinutes={(minutes) => update("maximumDurationMinutes", String(minutes))} />{value.durationEstimateMode === "approximate" && <label>{locale === "ru" ? "Погрешность" : "Uncertainty"}<select value={value.durationTolerancePercent} onChange={(e) => { const tolerance = e.target.value as ItemForm["durationTolerancePercent"]; const likely = Number(value.estimateMinutes) || 60; setValue((current) => ({ ...current, durationTolerancePercent: tolerance, minimumDurationMinutes: String(Math.max(5, Math.round(likely * (1 - Number(tolerance) / 100)))), maximumDurationMinutes: String(Math.round(likely * (1 + Number(tolerance) / 100))) })); }}><option value="15">±15%</option><option value="30">±30%</option><option value="50">±50%</option></select></label>}</>}
        {value.kind === "fixed_event" && <><label>{locale === "ru" ? "Дата" : "Date"}<input type="date" required value={value.date} onChange={(e) => update("date", e.target.value)} /></label><label>{locale === "ru" ? "Начало" : "Start"}<input type="time" required value={value.start} onChange={(e) => update("start", e.target.value)} /></label><label>{locale === "ru" ? "Конец" : "End"}<input type="time" value={value.end} onChange={(e) => update("end", e.target.value)} /></label></>}
        {value.kind !== "fixed_event" && <>
          <label>{locale === "ru" ? "Насколько обязательно" : "Commitment level"}<select value={value.deadlineType === "hard" ? "must_not_skip" : value.commitmentLevel} disabled={value.deadlineType === "hard"} onChange={(e) => update("commitmentLevel", e.target.value as PlannerCommitmentLevel)}><option value="must_not_skip">{locale === "ru" ? "Нельзя пропустить" : "Must not skip"}</option><option value="required">{locale === "ru" ? "Нужно сделать" : "Need to do"}</option><option value="desired">{locale === "ru" ? "Желательно" : "Desired"}</option><option value="if_time">{locale === "ru" ? "Только если останется время" : "Only if time remains"}</option></select></label>
          <label>{locale === "ru" ? "Вид срока" : "Deadline type"}<select value={value.deadlineType} onChange={(e) => update("deadlineType", e.target.value as PlannerDeadlineType)}><option value="none">{locale === "ru" ? "Без срока" : "No deadline"}</option><option value="target">{locale === "ru" ? "Целевой" : "Target"}</option><option value="hard">{locale === "ru" ? "Жёсткий" : "Hard"}</option></select></label>
          {value.deadlineType === "target" && <label>{locale === "ru" ? "Желательно не раньше" : "Prefer not before"}<input type="date" value={value.deadlineEarliest} max={value.deadline || undefined} onChange={(e) => update("deadlineEarliest", e.target.value)} /></label>}
          {value.deadlineType !== "none" && <><label>{value.deadlineType === "target" ? (locale === "ru" ? "Желательно не позже" : "Prefer not after") : (locale === "ru" ? "Не позже" : "Not after")}<input type="date" required min={value.deadlineType === "target" ? value.deadlineEarliest || undefined : undefined} value={value.deadline} onChange={(e) => update("deadline", e.target.value)} /></label><label>{locale === "ru" ? "Время границы" : "Boundary time"}<input type="time" required value={value.deadlineTime} onChange={(e) => update("deadlineTime", e.target.value)} /></label></>}
          {value.kind === "flexible_task" && <><label>{locale === "ru" ? "Точность даты" : "Date flexibility"}<select value={value.dateFlexibility} onChange={(e) => update("dateFlexibility", e.target.value as ItemForm["dateFlexibility"])}><option value="exact">{locale === "ru" ? "Точно" : "Exact"}</option><option value="preferred">{locale === "ru" ? "Предпочтительно" : "Preferred"}</option><option value="range">{locale === "ru" ? "Допустимый период" : "Allowed range"}</option><option value="any">{locale === "ru" ? "Без разницы" : "Any"}</option></select></label>{value.dateFlexibility === "exact" && <label>{locale === "ru" ? "Дата" : "Date"}<input type="date" value={value.date} onChange={(e) => update("date", e.target.value)} /></label>}{value.dateFlexibility === "preferred" && <label>{locale === "ru" ? "Желательная дата" : "Preferred date"}<input type="date" value={value.preferredDate} onChange={(e) => update("preferredDate", e.target.value)} /></label>}{value.dateFlexibility === "range" && <><label>{locale === "ru" ? "Не раньше" : "Not before"}<input type="date" value={value.earliestDate} onChange={(e) => update("earliestDate", e.target.value)} /></label><label>{locale === "ru" ? "Не позже" : "Not after"}<input type="date" value={value.latestDate} onChange={(e) => update("latestDate", e.target.value)} /></label></>}</>}
          <label>{locale === "ru" ? "Точность времени" : "Time flexibility"}<select value={value.timeFlexibility} onChange={(e) => update("timeFlexibility", e.target.value as ItemForm["timeFlexibility"])}><option value="any">{locale === "ru" ? "Без разницы" : "Any"}</option><option value="preferred">{locale === "ru" ? "Предпочтительно" : "Preferred"}</option><option value="range">{locale === "ru" ? "Допустимый интервал" : "Allowed range"}</option></select></label>
        </>}
        {value.kind === "routine" && <><label>{locale === "ru" ? "Режим" : "Mode"}<select value={value.recurrenceSchedulingMode} onChange={(e) => { const mode = e.target.value as ItemForm["recurrenceSchedulingMode"]; setValue((current) => ({ ...current, recurrenceSchedulingMode: mode, commitmentLevel: mode === "spare_time" ? "if_time" : current.commitmentLevel, canSplit: mode === "spare_time" ? true : current.canSplit })); }}><option value="required">{locale === "ru" ? "Обычное дело" : "Regular item"}</option><option value="spare_time">{locale === "ru" ? "В свободное время" : "In spare time"}</option></select></label><label>{locale === "ru" ? "Повтор" : "Repeat"}<select value={value.recurrenceFrequency} onChange={(e) => update("recurrenceFrequency", e.target.value as ItemForm["recurrenceFrequency"])}><option value="daily">{locale === "ru" ? "Каждый день" : "Daily"}</option><option value="weekly">{locale === "ru" ? "Раз в неделю" : "Weekly"}</option><option value="custom">{locale === "ru" ? "По допустимым дням" : "Allowed weekdays"}</option></select></label><label>{locale === "ru" ? "Количество повторов" : "Recurrence count"}<select value={value.recurrencePolicyMode} onChange={(e) => update("recurrencePolicyMode", e.target.value as ItemForm["recurrencePolicyMode"])}><option value="exact_days">{locale === "ru" ? "В каждый выбранный день" : "Every selected day"}</option><option value="count_range">{locale === "ru" ? "От–обычно–до раз" : "Min–usual–max times"}</option></select></label>{value.recurrencePolicyMode === "count_range" && <><label>{locale === "ru" ? "Период" : "Period"}<select value={value.recurrencePeriod} onChange={(e) => update("recurrencePeriod", e.target.value as ItemForm["recurrencePeriod"])}><option value="week">{locale === "ru" ? "Неделя" : "Week"}</option><option value="month">{locale === "ru" ? "Месяц" : "Month"}</option></select></label><label>{locale === "ru" ? "Не меньше раз" : "At least"}<input type="number" min={0} max={31} value={value.minOccurrences} onChange={(e) => update("minOccurrences", e.target.value)} /></label><label>{locale === "ru" ? "Обычно раз" : "Usually"}<input type="number" min={0} max={31} value={value.likelyOccurrences} onChange={(e) => update("likelyOccurrences", e.target.value)} /></label><label>{locale === "ru" ? "Не больше раз" : "At most"}<input type="number" min={0} max={31} value={value.maxOccurrences} onChange={(e) => update("maxOccurrences", e.target.value)} /></label></>}<label>{locale === "ru" ? "Длительность означает" : "Duration means"}<select value={value.outcomeMode === "deliverable" ? "per_cycle" : value.recurrenceDurationMode} onChange={(e) => update("recurrenceDurationMode", e.target.value as ItemForm["recurrenceDurationMode"])} disabled={value.outcomeMode === "deliverable"}><option value="per_occurrence">{locale === "ru" ? "Столько в каждое выполнение" : "This much each time"}</option><option value="per_cycle">{locale === "ru" ? "Столько всего за период" : "This much per period"}</option></select></label></>}
      </div>
      {deadlinePreview && <p className={styles.deadlinePreview}><strong>{deadlinePreview}</strong><span>{locale === "ru" ? "Предварительная оценка по оставшемуся времени. Точный риск с доступными окнами, сном и обязательствами появится в предпросмотре." : "A preliminary wall-clock estimate. The preview calculates exact risk using availability, sleep and commitments."}</span></p>}
      {value.kind === "routine" && value.recurrenceFrequency === "custom" && <div className={styles.weekdays}>{[1,2,3,4,5,6,7].map((day) => <button type="button" key={day} className={value.recurrenceWeekdays.includes(day) ? styles.weekdayActive : ""} onClick={() => update("recurrenceWeekdays", value.recurrenceWeekdays.includes(day) ? value.recurrenceWeekdays.filter((candidate) => candidate !== day) : [...value.recurrenceWeekdays, day])}>{locale === "ru" ? ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"][day-1] : ["M","T","W","T","F","S","S"][day-1]}</button>)}</div>}
      <details className={styles.advanced}><summary>{locale === "ru" ? "Дополнительно" : "Advanced"}</summary><div className={styles.formGrid}>
        <label>{locale === "ru" ? "Приоритет" : "Priority"}<select value={value.priority} onChange={(e) => update("priority", e.target.value as PlannerPriority)}>{(["low", "normal", "high", "critical"] as const).map((priority) => <option key={priority} value={priority}>{priorityLabel[locale][priority]}</option>)}</select></label>
        <label>{locale === "ru" ? "Порядок внутри группы" : "Order within group"}<input type="number" min={0} max={1000000} value={value.planningRank} onChange={(e) => update("planningRank", e.target.value)} /><small>{locale === "ru" ? "Меньшее число планируется раньше; общий экран иерархии позволяет менять порядок перетаскиванием." : "Lower values plan first; the hierarchy screen also supports drag ordering."}</small></label>
        <label>{locale === "ru" ? "Энергия" : "Energy"}<select value={value.energy} onChange={(e) => update("energy", e.target.value as PlannerEnergy)}>{(["low", "normal", "high"] as const).map((energy) => <option key={energy} value={energy}>{energyLabel[locale][energy]}</option>)}</select></label>
        {value.deadlineType === "hard" && <>
          <label>{locale === "ru" ? "Уверенность в длительности" : "Estimate confidence"}<select value={value.estimateConfidence} onChange={(e) => update("estimateConfidence", e.target.value as PlannerEstimateConfidence)}><option value="high">{locale === "ru" ? "Высокая" : "High"}</option><option value="normal">{locale === "ru" ? "Обычная" : "Normal"}</option><option value="low">{locale === "ru" ? "Низкая" : "Low"}</option></select><small>{locale === "ru" ? "Чем ниже уверенность, тем раньше будет внутренняя цель." : "Lower confidence creates an earlier internal target."}</small></label>
          <label>{locale === "ru" ? "Внутренняя цель" : "Internal target"}<select value={value.targetFinishMode} onChange={(e) => update("targetFinishMode", e.target.value as ItemForm["targetFinishMode"])}><option value="auto">{locale === "ru" ? "Рассчитать автоматически" : "Calculate automatically"}</option><option value="manual">{locale === "ru" ? "Указать вручную" : "Set manually"}</option></select></label>
          {value.targetFinishMode === "manual" && <><label>{locale === "ru" ? "Дата внутренней цели" : "Internal target date"}<input type="date" required value={value.targetFinishDate} onChange={(e) => update("targetFinishDate", e.target.value)} /></label><label>{locale === "ru" ? "Время внутренней цели" : "Internal target time"}<input type="time" required value={value.targetFinishTime} onChange={(e) => update("targetFinishTime", e.target.value)} /></label></>}
          <label>{locale === "ru" ? "Следующее дело" : "Next item"}<select value={value.deadlineChainMode} onChange={(e) => update("deadlineChainMode", e.target.value as PlannerDeadlineChainMode)}><option value="inherit">{locale === "ru" ? "По общему правилу" : "Use global rule"}</option><option value="off">{locale === "ru" ? "Не связывать" : "Do not chain"}</option><option value="auto">{locale === "ru" ? "Выбрать автоматически" : "Choose automatically"}</option><option value="pinned">{locale === "ru" ? "Выбрать конкретное" : "Choose a specific item"}</option></select></label>
          {value.deadlineChainMode === "pinned" && <label>{locale === "ru" ? "Какое дело начать дальше" : "Item to start next"}<select required value={value.nextItemId} onChange={(e) => update("nextItemId", e.target.value)}><option value="">—</option>{items.filter((item) => item.status === "active" && item.title !== value.title).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          <label>{locale === "ru" ? "Перерыв в цепочке" : "Chain break"}<select value={value.deadlineChainGap} onChange={(e) => update("deadlineChainGap", e.target.value as ItemForm["deadlineChainGap"])}><option value="0">0 {locale === "ru" ? "мин" : "min"}</option><option value="5">5 {locale === "ru" ? "мин" : "min"}</option><option value="15">15 {locale === "ru" ? "мин" : "min"}</option></select></label>
          {Number(value.estimateMinutes) >= 120 && <label className={`${styles.checkbox} ${styles.wide}`}><input type="checkbox" checked={value.createMilestones} onChange={(e) => update("createMilestones", e.target.checked)} />{locale === "ru" ? `Создать ${Math.min(5, Math.max(2, Math.ceil(Number(value.estimateMinutes) / 120)))} редактируемых этапа после подтверждения` : `Create ${Math.min(5, Math.max(2, Math.ceil(Number(value.estimateMinutes) / 120)))} editable milestones after confirmation`}</label>}
        </>}
        {value.timeFlexibility === "range" && <><label>{locale === "ru" ? "Допустимо с" : "Allowed from"}<input type="time" value={value.allowedStart} onChange={(e) => update("allowedStart", e.target.value)} /></label><label>{locale === "ru" ? "до" : "to"}<input type="time" value={value.allowedEnd} onChange={(e) => update("allowedEnd", e.target.value)} /></label></>}
        {value.timeFlexibility === "preferred" && <><label>{locale === "ru" ? "Предпочитать с" : "Prefer from"}<input type="time" value={value.preferredStart} onChange={(e) => update("preferredStart", e.target.value)} /></label><label>{locale === "ru" ? "до" : "to"}<input type="time" value={value.preferredEnd} onChange={(e) => update("preferredEnd", e.target.value)} /></label></>}
        <label>{locale === "ru" ? "Не ставить с" : "Avoid from"}<input type="time" value={value.avoidedStart} onChange={(e) => update("avoidedStart", e.target.value)} /></label><label>{locale === "ru" ? "до" : "to"}<input type="time" value={value.avoidedEnd} onChange={(e) => update("avoidedEnd", e.target.value)} /></label>
        <DurationInput label={locale === "ru" ? "Буфер до" : "Buffer before"} valueMinutes={value.bufferBeforeMinutes} maxMinutes={1440} locale={locale} onChangeMinutes={(minutes) => update("bufferBeforeMinutes", String(minutes))} /><DurationInput label={locale === "ru" ? "Буфер после" : "Buffer after"} valueMinutes={value.bufferAfterMinutes} maxMinutes={1440} locale={locale} onChangeMinutes={(minutes) => update("bufferAfterMinutes", String(minutes))} />
        <label>{locale === "ru" ? "Область" : "Area"}<input value={value.area} onChange={(e) => update("area", e.target.value)} /></label><label>{locale === "ru" ? "Место" : "Location"}<input value={value.location} onChange={(e) => update("location", e.target.value)} /></label>
        {value.kind !== "fixed_event" && <label className={styles.checkbox}><input type="checkbox" checked={value.canSplit} onChange={(e) => update("canSplit", e.target.checked)} />{locale === "ru" ? "Можно делить" : "Can split"}</label>}
        {value.canSplit && <DurationInput label={locale === "ru" ? "Минимальная часть" : "Minimum chunk"} valueMinutes={value.minChunkMinutes} minMinutes={5} maxMinutes={value.durationEstimateMode === "unknown" ? Number(value.calibrationMinutes) || 30 : Number(value.maximumDurationMinutes) || Number(value.estimateMinutes) || 1440} locale={locale} onChangeMinutes={(minutes) => update("minChunkMinutes", String(minutes))} />}
        <label className={styles.wide}>{locale === "ru" ? "Заметки" : "Notes"}<textarea value={value.notes} onChange={(e) => update("notes", e.target.value)} /></label>
      </div></details>
      <div className={styles.modalActions}><button type="button" onClick={onClose}>{locale === "ru" ? "Отмена" : "Cancel"}</button><button className={styles.primaryButton} disabled={busy || !value.title.trim()}>{locale === "ru" ? "Показать изменения" : "Review changes"}</button></div>
    </form>
  </ModalShell>;
}

function ExtensionDurationModal({ block, locale, busy, onClose, onReview }: {
  block: PlannerBlock;
  locale: Locale;
  busy: boolean;
  onClose: () => void;
  onReview: (minutes: number) => Promise<void>;
}) {
  const ru = locale === "ru";
  const [minutes, setMinutes] = useState("60");
  return <ModalShell title={ru ? "Сколько времени добавить?" : "How much time should be added?"} onClose={onClose} locale={locale}>
    <div className={styles.form}>
      <p className={styles.modalLead}>{ru
        ? `Продлеваем «${block.title}». Сначала вы увидите, какие дела сдвинутся; до подтверждения расписание не изменится.`
        : `Extending “${block.title}”. You will review every affected move before anything changes.`}</p>
      <div className={styles.segmented}>{[15, 30, 60, 120].map((value) => <button type="button" key={value} className={Number(minutes) === value ? styles.segmentedActive : ""} onClick={() => setMinutes(String(value))}>{formatDuration(value, locale)}</button>)}</div>
      <DurationInput label={ru ? "Дополнительное время" : "Extra time"} valueMinutes={minutes} minMinutes={5} maxMinutes={1440} minuteStep={5} locale={locale} onChangeMinutes={(value) => setMinutes(String(value))} />
      <p className={styles.fieldHelp}>{ru ? "Можно вводить часы и минуты отдельно. Пересечения будут не ошибкой, а понятным предпросмотром переносов." : "Enter hours and minutes separately. Overlaps become a clear move preview instead of a dead end."}</p>
      <div className={styles.modalActions}><button type="button" onClick={onClose}>{ru ? "Отмена" : "Cancel"}</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void onReview(Number(minutes))}>{ru ? "Показать последствия" : "Preview effects"}</button></div>
    </div>
  </ModalShell>;
}

function ArchiverResolutionModal({ entry, item, blocks, profile, now, locale, busy, onClose, onEditItem, onReview }: {
  entry: PlannerArchiverEntry;
  item?: PlannerItem;
  blocks: PlannerBlock[];
  profile: PlannerProfile;
  now: Date;
  locale: Locale;
  busy: boolean;
  onClose: () => void;
  onEditItem: () => void;
  onReview: (value: PlannerConstructorOperation) => Promise<void>;
}) {
  const ru = locale === "ru";
  const remainingMinutes = Math.max(1, entry.pendingMinutes);
  const [action, setAction] = useState<"schedule" | "done" | "reestimate" | "cancel">(entry.category === "missed" ? "done" : "schedule");
  const [amountMode, setAmountMode] = useState<"percent" | "minutes">("percent");
  const [percent, setPercent] = useState<25 | 50 | 75 | 100>(100);
  const [customMinutes, setCustomMinutes] = useState(String(remainingMinutes));
  const [placementMode, setPlacementMode] = useState<"first_free" | "date" | "exact" | "before" | "after" | "spread_week" | "replace">("first_free");
  const [strategy, setStrategy] = useState<"safe" | "priority">("safe");
  const [scope, setScope] = useState<"occurrence" | "future" | "item">("occurrence");
  const [actualMinutes, setActualMinutes] = useState(String(entry.totalMinutes));
  const [reestimatedMinutes, setReestimatedMinutes] = useState(String(remainingMinutes));
  const earliestDate = formatDateInTimeZone(now, profile.timezone);
  const latestDate = addPlannerDays(formatDateInTimeZone(now, profile.timezone), horizonDays(profile.horizon) - 1);
  const [targetDate, setTargetDate] = useState(earliestDate);
  const [targetTime, setTargetTime] = useState("09:00");
  const futureAnchors = blocks.filter((block) => block.status === "planned" && new Date(block.startAt) > now
    && block.id !== entry.sourceBlockId && block.itemId && !block.soft && (!block.role || block.role === "work"));
  const [anchorBlockId, setAnchorBlockId] = useState(futureAnchors[0]?.id ?? "");
  const selectedMinutes = amountMode === "minutes"
    ? Math.min(remainingMinutes, Math.max(5, Number(customMinutes) || 5))
    : percent === 100
      ? remainingMinutes
      : Math.max(5, Math.round(remainingMinutes * percent / 100 / 15) * 15);
  const placement = placementMode === "spread_week" ? { mode: "spread_week" as const }
    : placementMode === "replace" ? { mode: "replace" as const, targetBlockId: anchorBlockId }
    : placementMode === "date" ? { mode: "date" as const, date: targetDate }
      : placementMode === "exact" ? { mode: "exact" as const, date: targetDate, start: targetTime }
        : placementMode === "before" || placementMode === "after"
          ? { mode: placementMode, anchorBlockId, gapMinutes: profile.defaultBufferMinutes } as const
          : { mode: "first_free" as const };
  return <ModalShell title={ru ? "Разобрать дело" : "Resolve item"} onClose={onClose} locale={locale}>
    <div className={styles.form}>
      <section className={styles.remainderSummary}><span>{entry.category === "missed" ? (ru ? "ПРОПУЩЕНО" : "MISSED") : (ru ? "БЕЗ МЕСТА" : "NO SLOT")}</span><strong>{entry.title} · {formatDuration(remainingMinutes, locale)}</strong><p>{entry.reason}</p></section>
      <fieldset><legend>{ru ? "Что сделать" : "Action"}</legend><div className={styles.segmented}>
        {entry.category === "missed" && <button type="button" className={action === "done" ? styles.segmentedActive : ""} onClick={() => setAction("done")}>{ru ? "Было выполнено" : "Actually done"}</button>}
        <button type="button" className={action === "schedule" ? styles.segmentedActive : ""} onClick={() => setAction("schedule")}>{ru ? "Вернуть в план" : "Return to plan"}</button>
        <button type="button" className={action === "reestimate" ? styles.segmentedActive : ""} onClick={() => setAction("reestimate")}>{ru ? "Переоценить" : "Re-estimate"}</button>
        <button type="button" className={action === "cancel" ? styles.segmentedActive : ""} onClick={() => setAction("cancel")}>{ru ? "Отменить" : "Cancel"}</button>
      </div></fieldset>
      {action === "done" && <><DurationInput label={ru ? "Фактическая длительность" : "Actual duration"} valueMinutes={actualMinutes} minMinutes={1} maxMinutes={600000} minuteStep={5} locale={locale} onChangeMinutes={(minutes) => setActualMinutes(String(minutes))} /><p className={styles.fieldHelp}>{ru ? "Пропуск будет заменён выполнением в статистике." : "The missed outcome will be corrected to completed."}</p></>}
      {action === "reestimate" && <><DurationInput label={ru ? "Новый оставшийся объём" : "New remaining amount"} valueMinutes={reestimatedMinutes} minMinutes={5} maxMinutes={600000} minuteStep={5} locale={locale} onChangeMinutes={(minutes) => setReestimatedMinutes(String(minutes))} /><p className={styles.fieldHelp}>{ru ? "Исходная причина сохранится, а дальнейшее размещение будет считать этот объём актуальным." : "The original reason stays intact and future placement will use this amount."}</p></>}
      {action === "schedule" && <>
        <fieldset><legend>{ru ? "Сколько вернуть" : "Amount"}</legend><div className={styles.segmented}>{([100, 75, 50, 25] as const).map((value) => <button type="button" key={value} className={amountMode === "percent" && percent === value ? styles.segmentedActive : ""} onClick={() => { setAmountMode("percent"); setPercent(value); }}>{value}%</button>)}<button type="button" className={amountMode === "minutes" ? styles.segmentedActive : ""} onClick={() => setAmountMode("minutes")}>{ru ? "Своё время" : "Custom"}</button></div>{amountMode === "minutes" && <DurationInput label={ru ? "Вернуть" : "Return"} valueMinutes={customMinutes} minMinutes={5} maxMinutes={remainingMinutes} minuteStep={5} locale={locale} onChangeMinutes={(minutes) => setCustomMinutes(String(minutes))} />}<p className={styles.fieldHelp}>{ru ? `Будет запрошено ${formatDuration(selectedMinutes, locale)}. Неразмещённая часть останется в Архиваторе без срока истечения.` : `${formatDuration(selectedMinutes, locale)} will be requested. Any remainder stays in the Task Archiver without expiring.`}</p></fieldset>
        <fieldset><legend>{ru ? "Куда поставить" : "Placement"}</legend><select value={placementMode} onChange={(event) => { const mode = event.target.value as typeof placementMode; setPlacementMode(mode); if (mode === "replace") setStrategy("priority"); }}><option value="first_free">{ru ? "Первое безопасное окно" : "First safe slot"}</option><option value="date">{ru ? "Выбранная дата" : "Chosen date"}</option><option value="exact">{ru ? "Точное время" : "Exact time"}</option><option value="before">{ru ? "Перед другим делом" : "Before another item"}</option><option value="after">{ru ? "После другого дела" : "After another item"}</option><option value="replace">{ru ? "Заменить другое дело" : "Replace another item"}</option><option value="spread_week">{ru ? "Распределить по неделе" : "Spread across week"}</option></select>{(placementMode === "date" || placementMode === "exact") && <div className={styles.formGrid}><label>{ru ? "Дата" : "Date"}<input type="date" min={earliestDate} max={latestDate} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>{placementMode === "exact" && <label>{ru ? "Начало" : "Start"}<input type="time" value={targetTime} onChange={(event) => setTargetTime(event.target.value)} /></label>}</div>}{(placementMode === "before" || placementMode === "after" || placementMode === "replace") && <label>{placementMode === "replace" ? (ru ? "Какое дело заменить" : "Item to replace") : (ru ? "Опорное дело" : "Anchor item")}<select value={anchorBlockId} onChange={(event) => setAnchorBlockId(event.target.value)}>{futureAnchors.map((block) => <option key={block.id} value={block.id}>{block.title} · {formatDay(formatDateInTimeZone(new Date(block.startAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}</option>)}</select></label>}{placementMode === "replace" && <p className={styles.fieldHelp}>{ru ? "Выбранное дело не изменится без отдельного подтверждения его судьбы в предпросмотре." : "The selected item will not change until you separately confirm its fate in the preview."}</p>}</fieldset>
        <fieldset><legend>{ru ? "Стратегия" : "Strategy"}</legend><div className={styles.assistantChoices}><button type="button" className={strategy === "safe" ? styles.segmentedActive : ""} onClick={() => setStrategy("safe")}><strong>{ru ? "Бережно" : "Safe"}</strong><small>{ru ? "Использовать только свободное место" : "Use free capacity only"}</small></button><button type="button" className={strategy === "priority" ? styles.segmentedActive : ""} onClick={() => setStrategy("priority")}><strong>{ru ? "Вставить приоритетно" : "Insert with priority"}</strong><small>{ru ? "Показать переносы и сокращения других дел" : "Preview moves and reductions of other items"}</small></button></div></fieldset>
      </>}
      {action === "cancel" && <fieldset><legend>{ru ? "Масштаб отмены" : "Cancellation scope"}</legend><div className={styles.segmented}><button type="button" className={scope === "occurrence" ? styles.segmentedActive : ""} onClick={() => setScope("occurrence")}>{ru ? "Это выполнение" : "Occurrence"}</button>{item?.recurrence && <button type="button" className={scope === "future" ? styles.segmentedActive : ""} onClick={() => setScope("future")}>{ru ? "Это и будущие" : "This and future"}</button>}<button type="button" className={scope === "item" ? styles.segmentedActive : ""} onClick={() => setScope("item")}>{ru ? "Всё дело" : "Whole item"}</button></div><p className={styles.fieldHelp}>{ru ? "Причина попадания останется в истории и статистике." : "The original reason remains in history and statistics."}</p></fieldset>}
      <div className={styles.modalActions}>{item && <button type="button" onClick={onEditItem}>{ru ? "Изменить дело" : "Edit item"}</button>}<button type="button" onClick={onClose}>{ru ? "Оставить без решения" : "Keep unresolved"}</button><button type="button" className={styles.primaryButton} disabled={busy || action === "schedule" && (placementMode === "before" || placementMode === "after" || placementMode === "replace") && !anchorBlockId} onClick={() => void onReview({
        kind: "resolve_archiver_entry", entryId: entry.id, scope,
        resolution: action === "done" ? { kind: "late_complete", actualMinutes: Math.max(1, Number(actualMinutes) || entry.totalMinutes) }
          : action === "reestimate" ? { kind: "reestimate", remainingMinutes: Math.max(5, Number(reestimatedMinutes) || remainingMinutes) }
          : action === "cancel" ? { kind: "cancel" }
            : { kind: "schedule", amount: amountMode === "percent" ? { mode: "percent", percent } : { mode: "minutes", minutes: selectedMinutes }, placement, strategy },
      })}>{ru ? "Показать последствия" : "Preview consequences"}</button></div>
    </div>
  </ModalShell>;
}

function MissedOccurrenceModal({ block, item, locale, busy, onClose, onReview }: {
  block: PlannerBlock;
  item?: PlannerItem;
  locale: Locale;
  busy: boolean;
  onClose: () => void;
  onReview: (value: NonNullable<PlannerProposalInput["missedOccurrence"]>) => Promise<void>;
}) {
  const ru = locale === "ru";
  const suggested: Exclude<PlannerMissedOccurrencePolicy, "ask"> = item?.uncertaintyPolicy.outcomeMode === "deliverable"
    ? "carry_remaining"
    : "cancel_occurrence";
  const [disposition, setDisposition] = useState<Exclude<PlannerMissedOccurrencePolicy, "ask">>(suggested);
  const [rememberPolicy, setRememberPolicy] = useState(false);
  const [remainingMinutes, setRemainingMinutes] = useState(String(item?.estimateMinutes ?? isoDurationMinutes(block.startAt, block.endAt)));
  return <ModalShell title={ru ? "Что делать с пропущенным делом?" : "What should happen to this missed item?"} onClose={onClose} locale={locale}>
    <div className={styles.form}>
      <p className={styles.modalLead}>{ru
        ? `«${block.title}» не будет отмечено долгом автоматически. Сначала выберите реальный смысл пропуска.`
        : `“${block.title}” will not silently become debt. Choose what the missed occurrence means.`}</p>
      <div className={styles.assistantChoices}>
        <button type="button" className={disposition === "carry_remaining" ? styles.segmentedActive : ""} onClick={() => setDisposition("carry_remaining")}><strong>{ru ? "Перенести оставшуюся работу" : "Carry remaining work"}</strong><small>{ru ? "Вернуть объём в будущий план" : "Return the volume to the future plan"}</small></button>
        <button type="button" className={disposition === "cancel_occurrence" ? styles.segmentedActive : ""} onClick={() => setDisposition("cancel_occurrence")}><strong>{ru ? "Отменить только это выполнение" : "Cancel this occurrence"}</strong><small>{ru ? "Следующие повторения останутся" : "Future occurrences remain"}</small></button>
        <button type="button" className={disposition === "reestimate_total" ? styles.segmentedActive : ""} onClick={() => setDisposition("reestimate_total")}><strong>{ru ? "Уточнить общий остаток" : "Re-estimate total"}</strong><small>{ru ? "Задать, сколько работы осталось сейчас" : "Enter how much work remains now"}</small></button>
      </div>
      {disposition === "reestimate_total" && <DurationInput label={ru ? "Теперь осталось" : "Remaining now"} valueMinutes={remainingMinutes} minMinutes={5} maxMinutes={600_000} minuteStep={5} locale={locale} onChangeMinutes={(minutes) => setRemainingMinutes(String(minutes))} />}
      {item && <label className={styles.choiceCheck}><input type="checkbox" checked={rememberPolicy} onChange={(event) => setRememberPolicy(event.target.checked)} />{ru ? "Запомнить этот выбор только для данного дела" : "Remember this choice for this item"}</label>}
      <p className={styles.fieldHelp}>{ru ? "На следующем экране будут только затронутые переносы. Пока ничего не изменится." : "The next screen previews affected moves. Nothing changes yet."}</p>
      <div className={styles.modalActions}><button type="button" onClick={onClose}>{ru ? "Не пропускать" : "Keep item"}</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void onReview({ blockId: block.id, disposition, rememberPolicy, revisedRemainingMinutes: disposition === "reestimate_total" ? Number(remainingMinutes) : undefined })}>{ru ? "Показать последствия" : "Review consequences"}</button></div>
    </div>
  </ModalShell>;
}

function proposalChangeReason(change: PlannerProposal["changes"][number], locale: Locale): string {
  if (locale === "ru") return change.reason;
  if (change.kind === "upsert_archiver_entry") return "The Task Archiver keeps both the original reason and the reviewed outcome.";
  if (change.kind === "add_deferred_remainder" || change.kind === "update_deferred_remainder") return "The unscheduled part stays in the Task Archiver until it is explicitly resolved.";
  if (change.kind === "update_profile") return "Planner settings were confirmed in the reviewed assistant flow.";
  if (change.kind === "update_block_status") return "The missed occurrence was recorded with the selected carry or cancellation rule.";
  if (change.kind === "upsert_sleep_event") return "This night was adjusted without changing the regular sleep schedule.";
  if (change.kind === "add_item") return "The new item was confirmed from the reviewed form.";
  if (change.kind === "update_item") return change.item.unplacedReason
    ? "The reason was saved with the item in the inbox."
    : "A safe slot was found and the previous inbox reason was cleared.";
  if (change.kind === "update_block") return "Only the selected occurrence was updated; the series rule stays unchanged.";
  if (change.kind === "move_block") return "Flexible work was moved around the new fixed commitment.";
  if (change.kind === "remove_block") return "No safe replacement slot was found, so the item returns to the inbox.";
  if ("block" in change) return change.block.fixed
    ? "The fixed event keeps the exact reviewed time."
    : "A free slot was selected using priority, energy, preferences and workload.";
  return "The reviewed planner change is ready to apply.";
}

function proposalChangeTitle(change: PlannerProposal["changes"][number], locale: Locale): string {
  if (change.kind === "upsert_archiver_entry") return locale === "ru" ? `Архиватор: ${change.entry.title}` : `Task Archiver: ${change.entry.title}`;
  if (change.kind === "add_deferred_remainder" || change.kind === "update_deferred_remainder") return locale === "ru" ? `Архиватор: ${change.remainder.title}` : `Task Archiver: ${change.remainder.title}`;
  if (change.kind === "update_profile") return locale === "ru" ? "Настройки плана" : "Planner settings";
  if (change.kind === "update_block_status") return change.title;
  if (change.kind === "upsert_sleep_event") return locale === "ru" ? `Сон перед ${change.event.wakeDate}` : `Sleep before ${change.event.wakeDate}`;
  if (change.kind === "add_block" || change.kind === "update_block") return change.block.title;
  if (change.kind === "move_block" || change.kind === "remove_block") return change.title;
  return "item" in change ? change.item.title : (locale === "ru" ? "Изменение плана" : "Plan change");
}

function wakeDecisionReason(proposal: PlannerProposal, locale: Locale): string {
  const reason = proposal.wakeAnchorDecision?.reason;
  if (!reason) return "";
  const ru = locale === "ru";
  if (reason.code === "recurring_commitment") return ru
    ? `Подъём сдвинут раньше из-за постоянного дела${reason.relatedTitle ? ` «${reason.relatedTitle}»` : ""}${reason.relatedTime ? ` в ${reason.relatedTime}` : ""} и времени на подготовку.`
    : `Wake-up moved earlier for the recurring commitment${reason.relatedTitle ? ` “${reason.relatedTitle}”` : ""}${reason.relatedTime ? ` at ${reason.relatedTime}` : ""} and preparation time.`;
  if (reason.code === "plan_fit") return ru
    ? `Этот устойчивый подъём оставляет более подходящие окна для нагрузки${reason.relatedTitle ? `, включая «${reason.relatedTitle}»` : ""}. Размещено ${formatDuration(reason.placedMinutes ?? 0, locale)}, останется в Архиваторе дел ${formatDuration(reason.unplacedMinutes ?? 0, locale)}.`
    : `This stable wake time leaves better workload slots${reason.relatedTitle ? `, including “${reason.relatedTitle}”` : ""}. ${formatDuration(reason.placedMinutes ?? 0, locale)} placed; ${formatDuration(reason.unplacedMinutes ?? 0, locale)} remains in the Task Archiver.`;
  if (reason.code === "sleep_history") return ru
    ? "Подъём выбран по медиане последних фактических ночей. Переходные и восстановительные ночи не влияют на этот ориентир."
    : "Wake-up follows the median of recent actual nights. Transition and recovery nights do not affect it.";
  if (reason.code === "fixed_conflict") return ru
    ? "Защищённый сон конфликтует с постоянным обязательством. План нельзя применить, пока вы не измените вводные."
    : "Protected sleep conflicts with a recurring commitment. The plan cannot be applied until the input is changed.";
  return ru
    ? "Условия не требуют более раннего или позднего подъёма, поэтому выбран нейтральный устойчивый ориентир 09:00."
    : "Nothing requires an earlier or later wake time, so the neutral stable anchor of 09:00 was selected.";
}

function ProposalModal({ proposal, profile, items, locale, busy, onClose, onApply, onEdit, onResolve, onPause, onFinishFirst, onAddRecoveryNap, onSwitchFocus }: {
  proposal: PlannerProposal; profile: PlannerProfile; items: PlannerItem[]; locale: Locale; busy: boolean;
  onClose: () => void; onApply: () => Promise<void>; onEdit: () => void; onPause: (blockId: string) => Promise<void>; onFinishFirst: (blockId: string, protectedId: string) => Promise<void>;
  onResolve: (groupId: string, optionId: string) => Promise<void>;
  onAddRecoveryNap: (nap: NonNullable<PlannerProposal["recoveryAdvice"]>["nap"] & {}) => Promise<void>;
  onSwitchFocus: (focus: "sleep" | "work") => Promise<void>;
}) {
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const transferImpact = proposal.impact?.kind === "remainder_transfer" ? proposal.impact : undefined;
  const extensionInput = proposal.blockExtension;
  const rawExtensionChange = extensionInput
    ? proposal.changes.find((change) => change.kind === "move_block" && change.blockId === extensionInput.blockId)
    : undefined;
  const extensionChange = rawExtensionChange?.kind === "move_block" ? rawExtensionChange : undefined;
  const focusedAction = Boolean(transferImpact || extensionInput);
  const compact = proposal.trigger === "sleep_changed" || Boolean(proposal.missedOccurrence);
  const activation = new Date(proposal.effectiveFromAt ?? zonedPlannerDateTimeToUtc(proposal.horizonStart, "00:00", profile.timezone));
  const activationDate = formatDateInTimeZone(activation, profile.timezone);
  const compactEnd = addPlannerDays(activationDate, 1);
  const changeDate = (change: PlannerProposal["changes"][number]): string | undefined => {
    const at = change.kind === "add_block" || change.kind === "update_block" ? change.block.startAt
      : change.kind === "move_block" ? change.toStartAt
        : change.kind === "upsert_sleep_event" ? change.event.actualStartAt ?? change.event.plannedStartAt
          : undefined;
    return at ? formatDateInTimeZone(new Date(at), profile.timezone) : undefined;
  };
  const scopedChanges = compact && !showAllChanges
    ? proposal.changes.filter((change) => !changeDate(change) || changeDate(change)! <= compactEnd)
    : proposal.changes;
  const groupedChanges = scopedChanges.reduce<Array<{ change: PlannerProposal["changes"][number]; count: number }>>((groups, change) => {
    if (change.kind !== "add_block" || !change.block.soft) return [...groups, { change, count: 1 }];
    const date = localDate(change.block, profile.timezone);
    const existing = groups.find((group) => group.change.kind === "add_block"
      && group.change.block.soft
      && group.change.block.itemId === change.block.itemId
      && group.change.block.role === change.block.role
      && localDate(group.change.block, profile.timezone) === date);
    if (existing) existing.count += 1;
    else groups.push({ change, count: 1 });
    return groups;
  }, []);
  const hiddenChanges = proposal.changes.length - scopedChanges.length;
  const nextWork = proposal.changes.flatMap((change) => change.kind === "add_block" && !change.block.soft && new Date(change.block.startAt) >= activation ? [change.block] : [])
    .sort((left, right) => left.startAt.localeCompare(right.startAt))[0];
  const proposedProfile = proposal.changes.find((change) => change.kind === "update_profile");
  const proposedSchedule = proposedProfile?.kind === "update_profile" ? proposedProfile.profile.sleepSchedule : profile.sleepSchedule;
  const wakePreferenceLabel = proposedSchedule.mode === "adaptive"
    ? proposedSchedule.wakePreference.source === "history"
      ? (locale === "ru" ? "по фактической истории сна" : "from actual sleep history")
      : proposedSchedule.wakePreference.source === "commitment"
        ? (locale === "ru" ? "из-за фиксированного обязательства" : "from a fixed commitment")
        : proposedSchedule.wakePreference.mode === "exact"
          ? (locale === "ru" ? "точное время пользователя" : "user exact time")
          : proposedSchedule.wakePreference.mode === "range"
            ? (locale === "ru" ? "в жёстком диапазоне пользователя" : "inside the user's hard range")
            : proposedSchedule.wakePreference.mode === "approximate"
              ? (locale === "ru" ? "примерное время пользователя" : "user approximate time")
              : (locale === "ru" ? "нейтральный автоматический выбор" : "neutral automatic choice")
    : (locale === "ru" ? "фиксированный режим" : "fixed schedule");
  const workPlacements = proposal.impact?.placements ?? [];
  const reservePlacements = proposal.changes.flatMap((change) => change.kind === "add_block" && change.block.soft ? [{
    title: `${locale === "ru" ? "Технический резерв" : "Technical reserve"} · ${change.block.title}`,
    startAt: change.block.startAt,
    endAt: change.block.endAt,
  }] : []);
  const travelPlacements = workPlacements.flatMap((placement) => {
    const item = placement.itemId ? items.find((candidate) => candidate.id === placement.itemId) : undefined;
    const travel = item?.uncertaintyPolicy.travel;
    if (!item || !travel || travel.likelyMinutes <= 0) return [];
    const outboundMinutes = Math.min(travel.likelyMinutes, item.bufferBeforeMinutes);
    const preparationMinutes = Math.max(0, item.bufferBeforeMinutes - outboundMinutes);
    return [
      ...(preparationMinutes > 0 ? [{
        title: `${locale === "ru" ? "Техническое время · запас перед дорогой" : "Technical time · pre-travel buffer"} — ${item.title}`,
        startAt: addIsoMinutes(placement.startAt, -item.bufferBeforeMinutes),
        endAt: addIsoMinutes(placement.startAt, -outboundMinutes),
      }] : []),
      ...(outboundMinutes > 0 ? [{
        title: `${locale === "ru" ? "Техническое время · дорога туда" : "Technical time · outbound travel"} — ${item.title}`,
        startAt: addIsoMinutes(placement.startAt, -outboundMinutes),
        endAt: placement.startAt,
      }] : []),
      ...(item.bufferAfterMinutes > 0 ? [{
        title: `${locale === "ru" ? "Техническое время · дорога домой" : "Technical time · return travel"} — ${item.title}`,
        startAt: placement.endAt,
        endAt: addIsoMinutes(placement.endAt, item.bufferAfterMinutes),
      }] : []),
    ];
  });
  const semanticPlacementDays = groupPlannerPlacementsByDay([...workPlacements, ...travelPlacements, ...reservePlacements], profile.timezone);
  const impactMoves = (proposal.impact?.moves ?? []).filter((move) => !extensionChange
    || move.fromStartAt !== extensionChange.fromStartAt
    || move.fromEndAt !== extensionChange.fromEndAt
    || move.toStartAt !== extensionChange.toStartAt
    || move.toEndAt !== extensionChange.toEndAt);
  const secondaryImpactCount = impactMoves.length
    + (proposal.impact?.reductions.length ?? 0)
    + (proposal.impact?.sleepChanges.length ?? 0);
  const cancelledChanges = proposal.changes.flatMap((change) => change.kind === "update_block_status" && change.status === "cancelled" ? [change] : []);
  const archivedDisplacedBlockIds = new Set(proposal.changes.flatMap((change) => change.kind === "upsert_archiver_entry"
    && change.entry.origin === "displaced" && change.entry.sourceBlockId ? [change.entry.sourceBlockId] : []));
  const freedChanges = proposal.changes.flatMap((change) => change.kind === "remove_block" ? [change] : []);
  return <ModalShell title={extensionInput ? (locale === "ru" ? "Продление дела" : "Extend item") : (locale === "ru" ? "Предпросмотр нового плана" : "Plan preview")} onClose={onClose} locale={locale}>
    <div className={styles.proposal}>
      {!focusedAction && <section className={styles.wakeDecision}><span>{locale === "ru" ? "План начинается с реальной текущей ситуации" : "The plan starts from real life now"}</span><div><strong>{formatDay(activationDate, locale)} · {formatTimeInTimeZone(activation, profile.timezone)}</strong>{nextWork && <strong>{locale === "ru" ? "Первое дело" : "First item"}: {nextWork.title} · {formatTimeInTimeZone(new Date(nextWork.startAt), profile.timezone)}</strong>}</div><p>{locale === "ru" ? "Время до этого момента не считается долгом. Разовые проекты и жёсткие сроки сохраняют свой реальный оставшийся объём." : "Time before this instant is not debt. One-time projects and hard deadlines keep their real remaining volume."}</p></section>}
      {extensionInput && extensionChange && <section className={proposal.conflicts.length > 0 ? styles.transferFailed : styles.transferResult}><span>{locale === "ru" ? "ПРОДЛЕНИЕ ТЕКУЩЕГО ДЕЛА" : "CURRENT ITEM EXTENSION"}</span><h3>{extensionChange.title}</h3><div className={styles.transferNumbers}><strong>{locale === "ru" ? "Добавляем" : "Adding"}: {formatDuration(extensionInput.minutes, locale)}</strong><strong>{locale === "ru" ? "Было до" : "Was until"}: {formatTimeInTimeZone(new Date(extensionChange.fromEndAt), profile.timezone)}</strong><strong>{locale === "ru" ? "Станет до" : "Will run until"}: {formatDay(formatDateInTimeZone(new Date(extensionChange.toEndAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(extensionChange.toEndAt), profile.timezone)}</strong></div><p>{proposal.conflicts.length > 0
        ? (locale === "ru" ? "Такое продление упирается в защищённое время. Ни одно изменение пока не применено — ниже указано конкретное пересечение." : "This extension reaches protected time. Nothing has changed; the exact conflict is shown below.")
        : (locale === "ru" ? "До подтверждения текущее дело и всё остальное расписание остаются без изменений." : "Nothing changes until you confirm the extension.")}</p></section>}
      {transferImpact && <section className={transferImpact.scheduledMinutes === 0 ? styles.transferFailed : styles.transferResult}><span>{locale === "ru" ? "РЕЗУЛЬТАТ ПЕРЕНОСА" : "TRANSFER RESULT"}</span><h3>{transferImpact.title}</h3><div className={styles.transferNumbers}><strong>{locale === "ru" ? "Осталось" : "Remaining"}: {formatDuration(transferImpact.sourceRemainingMinutes ?? 0, locale)}</strong><strong>{locale === "ru" ? "Запрошено" : "Requested"}: {formatDuration(transferImpact.requestedMinutes ?? 0, locale)}</strong><strong>{locale === "ru" ? "Получит время" : "Scheduled"}: {formatDuration(transferImpact.scheduledMinutes ?? 0, locale)}</strong></div><p>{transferImpact.scheduledMinutes === 0
        ? (locale === "ru" ? "Перенести сейчас не удалось. Остаток не потеряется и останется в Архиваторе дел." : "No suitable slot was found. The remainder stays safely in the Task Archiver.")
        : (locale === "ru" ? "До подтверждения текущее дело и остальное расписание остаются без изменений." : "Nothing changes until you confirm this preview.")}</p></section>}
      {semanticPlacementDays.length > 0 && <section><h3>{transferImpact ? (locale === "ru" ? "Куда переносим" : "New placement") : extensionInput ? (locale === "ru" ? "Новые места затронутых дел" : "New slots for affected items") : (locale === "ru" ? "Итоговое размещение" : "Final placement")}</h3><div className={styles.placementDays}>{semanticPlacementDays.map((day) => <section key={day.date} className={styles.placementDay}><h4>{formatDay(day.date, locale, { weekday: "long", year: "numeric", month: "long" })}</h4><div className={styles.semanticChanges}>{day.items.map((group) => <article key={`${day.date}-${group.title}`}><strong>{group.title}</strong><span>{group.entries.length > 1 ? (locale === "ru" ? `${group.entries.length} части одного выполнения` : `${group.entries.length} parts of one occurrence`) : ""}</span>{group.entries.map((entry, index) => <small key={`${entry.startAt}-${entry.endAt}`}>{group.entries.length > 1 ? `${locale === "ru" ? "Часть" : "Part"} ${index + 1}: ` : ""}{formatTimeInTimeZone(new Date(entry.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(entry.endAt), profile.timezone)} · {formatDuration(isoDurationMinutes(entry.startAt, entry.endAt), locale)}</small>)}</article>)}</div></section>)}</div></section>}
      {transferImpact?.queuedMinutes ? <section className={styles.unplaced}><h3>{locale === "ru" ? "Останется в Архиваторе" : "Will remain in the Task Archiver"}</h3><article><strong>{transferImpact.title} · {formatDuration(transferImpact.queuedMinutes, locale)}</strong><p>{locale === "ru" ? "Запись не истечёт и останется до явного решения." : "The entry does not expire and remains until explicitly resolved."}</p></article></section> : null}
      {proposal.impact && <section><h3>{locale === "ru" ? "Что ещё изменится" : "Other effects"}</h3>{secondaryImpactCount === 0 ? <p className={styles.noSecondaryImpact}>{locale === "ru" ? "Другие дела и сон не изменятся." : "Other items and sleep will not change."}</p> : <div className={styles.semanticChanges}>{impactMoves.map((move) => <article key={`${move.title}-${move.fromStartAt}`}><strong>{move.title}</strong><span>{formatDay(formatDateInTimeZone(new Date(move.fromStartAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(move.fromStartAt), profile.timezone)}–{formatTimeInTimeZone(new Date(move.fromEndAt), profile.timezone)} → {formatDay(formatDateInTimeZone(new Date(move.toStartAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(move.toStartAt), profile.timezone)}–{formatTimeInTimeZone(new Date(move.toEndAt), profile.timezone)}</span></article>)}{proposal.impact.reductions.map((reduction, index) => <article key={`${reduction.title}-${index}`}><strong>{reduction.title}</strong><span>{locale === "ru" ? `Сократится на ${formatDuration(reduction.minutes, locale)}` : `Reduced by ${formatDuration(reduction.minutes, locale)}`}</span></article>)}{proposal.impact.sleepChanges.map((sleep) => <article key={sleep.wakeDate}><strong>{locale === "ru" ? `Сон перед ${formatDay(sleep.wakeDate, locale)}` : `Sleep before ${formatDay(sleep.wakeDate, locale)}`}</strong><span>{formatDuration(sleep.fromMinutes, locale)} → {formatDuration(sleep.toMinutes, locale)}</span></article>)}</div>}</section>}
      {(cancelledChanges.length > 0 || freedChanges.length > 0) && <section><h3>{locale === "ru" ? "Освободившееся время" : "Freed time"}</h3><div className={styles.semanticChanges}>{cancelledChanges.map((change) => <article key={change.id}><strong>{change.title}</strong><span>{archivedDisplacedBlockIds.has(change.blockId)
        ? (locale === "ru" ? "Выполнение уйдёт в Архиватор дел и не будет считаться отменой" : "The occurrence moves to the Task Archiver and is not counted as cancelled")
        : (locale === "ru" ? "Выполнение будет отменено, история сохранится" : "The occurrence will be cancelled and its history kept")}</span></article>)}{freedChanges.map((change) => <article key={change.id}><strong>{change.title}</strong><span>{locale === "ru" ? "Прежний интервал станет свободным" : "The previous interval becomes free"}</span></article>)}</div></section>}
      {proposal.normalizedDraft && <section className={styles.parsed}><span>{locale === "ru" ? "Параметры нового дела" : "New item parameters"}</span><strong>{proposal.normalizedDraft.title}</strong><p>{kindLabel[locale][proposal.normalizedDraft.kind ?? "flexible_task"]} · {formatDuration(proposal.normalizedDraft.estimateMinutes ?? 60, locale)}{proposal.normalizedDraft.date ? ` · ${formatDay(proposal.normalizedDraft.date, locale)}` : ""}{proposal.normalizedDraft.start ? ` · ${proposal.normalizedDraft.start}` : ""}{proposal.normalizedDraft.end ? `–${proposal.normalizedDraft.end}` : ""} · {locale === "ru" ? "приоритет" : "priority"}: {priorityLabel[locale][proposal.normalizedDraft.priority ?? "normal"]}</p><button onClick={onEdit}>{locale === "ru" ? "Изменить поля" : "Edit fields"}</button></section>}
      {proposal.wakeAnchorDecision && <section className={styles.wakeDecision}><span>{locale === "ru" ? "Автоматически выбран устойчивый режим" : "Stable schedule selected automatically"}</span><div><strong>{locale === "ru" ? "Подъём" : "Wake"} {proposal.wakeAnchorDecision.wakeTime}</strong><strong>{locale === "ru" ? "Сон с" : "Sleep from"} {proposal.wakeAnchorDecision.bedtime}</strong><strong>{formatDuration(proposal.wakeAnchorDecision.targetDurationMinutes, locale)}</strong></div><p>{wakeDecisionReason(proposal, locale)}</p><small>{locale === "ru" ? `Проверено вариантов: ${proposal.wakeAnchorDecision.candidatesEvaluated}. Диапазон сна: ${formatDuration(proposal.wakeAnchorDecision.durationRange.minMinutes, locale)}–${formatDuration(proposal.wakeAnchorDecision.durationRange.maxMinutes, locale)}. Это предложение ещё не применено.` : `${proposal.wakeAnchorDecision.candidatesEvaluated} options checked. Sleep range: ${formatDuration(proposal.wakeAnchorDecision.durationRange.minMinutes, locale)}–${formatDuration(proposal.wakeAnchorDecision.durationRange.maxMinutes, locale)}. This proposal has not been applied.`}</small></section>}
      {!focusedAction && proposal.effectiveFocus && <section className={styles.focusOverride}><h3>{locale === "ru" ? "Приоритет только для этого предпросмотра" : "Priority for this preview only"}</h3><p>{locale === "ru" ? "Переключение пересчитает предложение, но не изменит постоянную настройку." : "Switching recalculates this proposal without changing your saved preference."}</p><div className={styles.segmented}><button type="button" disabled={busy} className={proposal.effectiveFocus === "sleep" ? styles.segmentedActive : ""} onClick={() => void onSwitchFocus("sleep")}>{locale === "ru" ? "Сон важнее" : "Sleep first"}</button><button type="button" disabled={busy} className={proposal.effectiveFocus === "work" ? styles.segmentedActive : ""} onClick={() => void onSwitchFocus("work")}>{locale === "ru" ? "Дедлайны важнее" : "Deadlines first"}</button></div></section>}
      {!focusedAction && proposal.sleepPlan?.length && (proposal.trigger === "sleep_changed" || proposal.trigger === "assistant_setup" || proposal.trigger === "assistant_update") ? <section><h3>{locale === "ru" ? "Защищённый сон" : "Protected sleep"}</h3><p className={styles.fieldHelp}>{locale === "ru" ? "Источник подъёма" : "Wake-up source"}: {wakePreferenceLabel}</p><div className={styles.sleepPlanList}>{proposal.sleepPlan.map((night) => <article key={night.wakeDate}><strong>{night.wakeDate} · {formatDuration(night.durationMinutes, locale)}</strong><span>{night.transitionNight ? (locale === "ru" ? `Переходная ночь: обычное время уже прошло, поэтому сон начинается только после подготовки. Долг и восстановительный штраф не создаются.${night.durationMinutes < profile.planningPolicy.minimumNightMinutes ? " Эта ночь короче вашего защищённого минимума; применение плана подтверждает это только один раз." : ""}` : `Transition night: the usual bedtime has passed, so sleep starts after wind-down. No debt or recovery penalty is created.${night.durationMinutes < profile.planningPolicy.minimumNightMinutes ? " This night is below your protected minimum; applying confirms it once only." : ""}`) : night.borrowedMinutes > 0 ? (locale === "ru" ? `Сокращение на ${formatDuration(night.borrowedMinutes, locale)} ради жёсткого срока` : `${formatDuration(night.borrowedMinutes, locale)} borrowed for a hard deadline`) : night.reason === "workload" ? (locale === "ru" ? "Более короткий допустимый вариант улучшает план" : "A shorter allowed option improves the plan") : night.reason === "recovery" ? (locale === "ru" ? "Восстановительная ночь" : "Recovery night") : (locale === "ru" ? "Предпочтительный вариант" : "Preferred option")}</span><small>{formatTimeInTimeZone(new Date(night.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(night.endAt), profile.timezone)}</small></article>)}</div></section> : null}
      {!focusedAction && proposal.deadlineAnalysis?.length ? <section><h3>{locale === "ru" ? "Сроки и риск" : "Deadlines and risk"}</h3><div className={styles.deadlineList}>{proposal.deadlineAnalysis.map((entry) => <article key={entry.itemId} data-risk={entry.risk}><div><strong>{entry.title}</strong><span>{entry.risk === "on_track" ? (locale === "ru" ? "Успеваем" : "On track") : entry.risk === "tight" ? (locale === "ru" ? "Плотно" : "Tight") : entry.risk === "at_risk" ? (locale === "ru" ? "Под угрозой" : "At risk") : (locale === "ru" ? "Физически не помещается" : "Cannot physically fit")}</span></div><p>{locale === "ru" ? "Внутренняя цель" : "Internal target"}: {formatDay(formatDateInTimeZone(new Date(entry.targetFinishAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(entry.targetFinishAt), profile.timezone)} · {locale === "ru" ? "жёсткий срок" : "deadline"}: {formatDay(formatDateInTimeZone(new Date(entry.deadlineAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(entry.deadlineAt), profile.timezone)}</p><small>{locale === "ru" ? "Осталось работы" : "Work remaining"}: {formatDuration(entry.remainingMinutes, locale)} · {locale === "ru" ? "доступно" : "available"}: {formatDuration(entry.availableMinutes, locale)}{entry.latestSafeStartAt ? ` · ${locale === "ru" ? "последний безопасный старт" : "latest safe start"}: ${formatDay(formatDateInTimeZone(new Date(entry.latestSafeStartAt), profile.timezone), locale)} ${formatTimeInTimeZone(new Date(entry.latestSafeStartAt), profile.timezone)}` : ""}</small>{entry.likelyScenario && entry.maximumScenario && <small>{locale === "ru" ? "Обычный сценарий" : "Likely scenario"}: {entry.likelyScenario.risk} · {locale === "ru" ? "максимальный сценарий" : "maximum scenario"}: {entry.maximumScenario.risk} ({formatDuration(entry.maximumScenario.remainingMinutes, locale)})</small>}{entry.nextItemTitle && <p>{locale === "ru" ? "Следом" : "Next"}: {entry.nextItemTitle}</p>}</article>)}</div></section> : null}
      {proposal.conflicts.length > 0 && <section className={styles.conflicts}><h3>{locale === "ru" ? "Нужно ваше решение" : "Your decision is needed"}</h3>{proposal.conflicts.map((conflict) => <article key={conflict.id}><strong>{conflict.title}</strong><p>{locale === "ru" ? conflict.message : conflict.kind === "active_overlap" ? "The protected time overlaps work already in progress. Pause it, finish first, or edit the new input." : conflict.blockIds.some((id) => id.startsWith("sleep-")) ? "A fixed event overlaps protected sleep. Edit the event or sleep input." : "Two fixed events overlap and cannot be moved automatically."}</p>{extensionInput ? <div><button onClick={onClose}>{locale === "ru" ? "Вернуться и выбрать меньше времени" : "Go back and choose less time"}</button></div> : conflict.kind === "active_overlap" ? <div><button onClick={() => void onPause(conflict.blockIds[0])}>{locale === "ru" ? "Поставить текущее на паузу" : "Pause current"}</button><button onClick={() => void onFinishFirst(conflict.blockIds[0], conflict.blockIds[1])}>{locale === "ru" ? "Закончить текущее сначала" : "Finish current first"}</button><button onClick={onEdit}>{proposal.trigger === "sleep_changed" ? (locale === "ru" ? "Исправить сон" : "Edit sleep") : (locale === "ru" ? "Изменить вводные" : "Edit input")}</button></div> : <div><button onClick={onEdit}>{locale === "ru" ? "Исправить конфликт" : "Edit conflict"}</button></div>}</article>)}</section>}
      {proposal.decisionGroups?.length ? <section className={styles.conflicts}><h3>{locale === "ru" ? "Нужно выбрать решение" : "Choose a resolution"}</h3>{proposal.decisionGroups.map((group) => <article key={group.id}><strong>{group.title}</strong><p>{group.message}</p><div>{group.options.map((option) => <button key={option.id} type="button" className={group.selectedOptionId === option.id ? styles.segmentedActive : ""} onClick={option.kind === "edit" ? onEdit : () => void onResolve(group.id, option.id)}>{option.title}</button>)}</div></article>)}</section> : null}
      <button type="button" className={styles.technicalToggle} onClick={() => setShowTechnical((current) => !current)}>{showTechnical ? (locale === "ru" ? "Скрыть технические подробности" : "Hide technical details") : (locale === "ru" ? `Технические подробности (${proposal.changes.length})` : `Technical details (${proposal.changes.length})`)}</button>
      {showTechnical && <section><h3>{compact ? (locale === "ru" ? "Изменения сегодня и завтра" : "Changes today and tomorrow") : (locale === "ru" ? "Все внутренние изменения" : "All internal changes")}</h3><div className={styles.changeList}>{groupedChanges.map(({ change, count }) => <article key={change.id}>
        <span>{change.kind === "add_block" ? "+" : change.kind === "move_block" ? "→" : change.kind === "remove_block" ? "−" : change.kind === "upsert_sleep_event" || change.kind === "update_block_status" ? "■" : "•"}</span>
        <div><strong>{proposalChangeTitle(change, locale)}{count > 1 ? ` ×${count}` : ""}</strong><p>{proposalChangeReason(change, locale)}</p>{(change.kind === "add_block" || change.kind === "update_block") && <small>{formatDay(localDate(change.block, profile.timezone), locale)} · {formatTimeInTimeZone(new Date(change.block.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(change.block.endAt), profile.timezone)}</small>}{change.kind === "move_block" && <small>{formatTimeInTimeZone(new Date(change.fromStartAt), profile.timezone)} → {formatDay(formatDateInTimeZone(new Date(change.toStartAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(change.toStartAt), profile.timezone)}</small>}{change.kind === "upsert_sleep_event" && <small>{change.event.plannedStartAt && change.event.plannedEndAt ? `${locale === "ru" ? "запланировано" : "planned"} · ${formatTimeInTimeZone(new Date(change.event.plannedStartAt), profile.timezone)}–${formatTimeInTimeZone(new Date(change.event.plannedEndAt), profile.timezone)} · ${formatDuration(change.event.plannedDurationMinutes ?? isoDurationMinutes(change.event.plannedStartAt, change.event.plannedEndAt), locale)}` : change.event.actualStartAt && (change.event.actualEndAt ?? change.event.projectedEndAt) ? `${change.event.state === "tentative" ? (locale === "ru" ? "предварительно · " : "tentative · ") : ""}${formatTimeInTimeZone(new Date(change.event.actualStartAt), profile.timezone)}–${formatTimeInTimeZone(new Date(change.event.actualEndAt ?? change.event.projectedEndAt!), profile.timezone)}` : (locale === "ru" ? "Время неизвестно: расписание пока не перестраивается" : "Time unknown: schedule is not rebuilt yet")}</small>}</div>
      </article>)}</div>{compact && (hiddenChanges > 0 || showAllChanges) && <button type="button" onClick={() => setShowAllChanges((current) => !current)}>{showAllChanges ? (locale === "ru" ? "Скрыть дальние изменения" : "Hide later changes") : (locale === "ru" ? `Показать ещё ${hiddenChanges}` : `Show ${hiddenChanges} later changes`)}</button>}</section>}
      {proposal.unplaced.length > 0 && <section className={styles.unplaced}><h3>{locale === "ru" ? "Останется в Архиваторе" : "Will stay in the Task Archiver"}</h3>{proposal.unplaced.map((item, index) => <article key={`${item.itemId}-${item.remainingMinutes}-${index}`}><strong>{item.title} · {locale === "ru" ? "запрошено" : "requested"} {formatDuration(item.requestedMinutes ?? item.remainingMinutes, locale)} · {locale === "ru" ? "размещено" : "placed"} {formatDuration(item.placedMinutes ?? 0, locale)} · {locale === "ru" ? "осталось" : "remaining"} {formatDuration(item.remainingMinutes, locale)}</strong><p>{locale === "ru" ? item.reason : "No free slot satisfies availability, buffers and the protected reserve. The duration was not shortened."}</p></article>)}</section>}
      {proposal.recoveryAdvice && <section className={styles.recoveryPanel}><h3>{locale === "ru" ? "Восстановление" : "Recovery"}</h3><p>{locale === "ru" ? `Недосып относительно цели: ${formatDuration(proposal.recoveryAdvice.deficitMinutes, locale)}. Дополнительное время распределяется максимум на ${proposal.recoveryAdvice.recoveryNights} ночи.` : `Sleep below target: ${formatDuration(proposal.recoveryAdvice.deficitMinutes, locale)}. Extra sleep opportunity is spread across up to ${proposal.recoveryAdvice.recoveryNights} nights.`}</p>{proposal.recoveryAdvice.nap ? <article><strong>{locale === "ru" ? "Можно добавить короткий сон" : "A short nap is available"}</strong><small>{formatDay(formatDateInTimeZone(new Date(proposal.recoveryAdvice.nap.startAt), profile.timezone), locale)} · {formatTimeInTimeZone(new Date(proposal.recoveryAdvice.nap.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(proposal.recoveryAdvice.nap.endAt), profile.timezone)}</small><p>{locale === "ru" ? proposal.recoveryAdvice.nap.reason : "The slot ends before 15:00 and stays at least six hours away from night sleep."}</p><button type="button" onClick={() => void onAddRecoveryNap(proposal.recoveryAdvice!.nap!)}>{locale === "ru" ? "Добавить в этот план" : "Add to this plan"}</button></article> : <p>{locale === "ru" ? "Безопасного окна для короткого дневного сна сейчас нет — оно не будет добавлено автоматически." : "There is no suitable short-nap window, so none will be added automatically."}</p>}</section>}
      <div className={styles.modalActions}><button onClick={onClose}>{focusedAction ? (locale === "ru" ? "Оставить как есть" : "Keep as is") : (locale === "ru" ? "Не применять" : "Cancel")}</button><button className={styles.primaryButton} disabled={busy || proposal.conflicts.length > 0 || Boolean(proposal.decisionGroups?.some((group) => group.blocking))} onClick={() => void onApply()}>{transferImpact ? (locale === "ru" ? "Подтвердить перенос" : "Confirm transfer") : extensionInput ? (locale === "ru" ? "Подтвердить продление" : "Confirm extension") : (locale === "ru" ? "Применить изменения" : "Apply changes")}</button></div>
    </div>
  </ModalShell>;
}

function SettingsModal({ profile, locale, busy, onClose, onOpenSleepSettings, onSave }: { profile: PlannerProfile; locale: Locale; busy: boolean; onClose: () => void; onOpenSleepSettings: () => void; onSave: (patch: Partial<PlannerProfile>) => Promise<void> }) {
  const fixedSleep = fixedScheduleView(profile.sleepSchedule);
  const [sleepTouched, setSleepTouched] = useState(false);
  const [availabilityTouched, setAvailabilityTouched] = useState(false);
  const [form, setForm] = useState({
    timezone: profile.timezone,
    horizon: profile.horizon,
    reserve: String(Math.round(profile.reserveRatio * 100)),
    buffer: String(profile.defaultBufferMinutes),
    weekdayBedtime: fixedSleep.weekdays.bedtime,
    weekdaySleep: String(fixedSleep.weekdays.durationMinutes),
    weekendBedtime: fixedSleep.weekends.bedtime,
    weekendSleep: String(fixedSleep.weekends.durationMinutes),
    availability: Object.fromEntries(Object.entries(profile.availability).map(([day, windows]) => [day, windows.map((window) => ({ ...window }))])),
    energyWindows: profile.energyWindows.map((window) => ({ ...window })),
  });
  const weekdays = locale === "ru" ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const updateAvailability = (day: string, field: "start" | "end", next: string) => {
    setAvailabilityTouched(true);
    setForm((current) => ({
      ...current,
      availability: { ...current.availability, [day]: [{ ...(current.availability[day]?.[0] ?? { start: "08:00", end: "22:00" }), [field]: next }] },
    }));
  };
  const updateEnergy = (index: number, field: "start" | "end", next: string) => setForm((current) => ({
    ...current,
    energyWindows: current.energyWindows.map((window, candidate) => candidate === index ? { ...window, [field]: next } : window),
  }));
  return <ModalShell title={locale === "ru" ? "Настройки плана" : "Planner settings"} onClose={onClose} locale={locale}><form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    const sleepSchedule = sleepTouched
      ? { mode: "fixed" as const, weekdays: { bedtime: form.weekdayBedtime, durationMinutes: Number(form.weekdaySleep) }, weekends: { bedtime: form.weekendBedtime, durationMinutes: Number(form.weekendSleep) } }
      : profile.sleepSchedule;
    void onSave({ timezone: form.timezone, horizon: form.horizon, reserveRatio: Number(form.reserve) / 100, defaultBufferMinutes: Number(form.buffer), availability: sleepTouched && !availabilityTouched ? availabilityFromSleepSchedule(sleepSchedule) : form.availability, energyWindows: form.energyWindows, sleepSchedule });
  }}>{profile.sleepSchedule.mode === "adaptive" && <div className={styles.fieldExplanation}><strong>{locale === "ru" ? "Адаптивный сон" : "Adaptive sleep"}</strong><p>{locale === "ru" ? "Точное, примерное, диапазонное и нейтральное время сна и подъёма настраиваются в отдельном понятном экране." : "Exact, approximate, ranged and neutral bedtime and wake-up preferences use the dedicated sleep editor."}</p><button type="button" onClick={onOpenSleepSettings}>{locale === "ru" ? "Изменить сон и подъём" : "Edit sleep and wake-up"}</button></div>}<div className={styles.formGrid}>
    <label>{locale === "ru" ? "Часовой пояс" : "Time zone"}<input value={form.timezone} onChange={(e) => setForm((v) => ({ ...v, timezone: e.target.value }))} /></label><label>{locale === "ru" ? "Горизонт" : "Horizon"}<select value={form.horizon} onChange={(e) => setForm((v) => ({ ...v, horizon: e.target.value as PlannerHorizon }))}><option value="week">{locale === "ru" ? "7 дней" : "7 days"}</option><option value="two_weeks">{locale === "ru" ? "14 дней" : "14 days"}</option><option value="month">{locale === "ru" ? "30 дней" : "30 days"}</option></select></label>
    <label>{locale === "ru" ? "Резерв, %" : "Reserve, %"}<input type="number" min="0" max="60" value={form.reserve} onChange={(e) => setForm((v) => ({ ...v, reserve: e.target.value }))} /></label><DurationInput label={locale === "ru" ? "Буфер между делами" : "Buffer between items"} valueMinutes={form.buffer} maxMinutes={120} locale={locale} onChangeMinutes={(minutes) => setForm((value) => ({ ...value, buffer: String(minutes) }))} />
    {profile.sleepSchedule.mode === "fixed" && <><label>{locale === "ru" ? "Сон перед буднями" : "Weekday bedtime"}<input type="time" value={form.weekdayBedtime} onChange={(e) => { setSleepTouched(true); setForm((v) => ({ ...v, weekdayBedtime: e.target.value })); }} /></label><DurationInput label={locale === "ru" ? "Длительность сна" : "Sleep duration"} valueMinutes={form.weekdaySleep} minMinutes={180} maxMinutes={960} minuteStep={15} locale={locale} onChangeMinutes={(minutes) => { setSleepTouched(true); setForm((value) => ({ ...value, weekdaySleep: String(minutes) })); }} />
    <label>{locale === "ru" ? "Сон перед выходными" : "Weekend bedtime"}<input type="time" value={form.weekendBedtime} onChange={(e) => { setSleepTouched(true); setForm((v) => ({ ...v, weekendBedtime: e.target.value })); }} /></label><DurationInput label={locale === "ru" ? "Длительность сна" : "Sleep duration"} valueMinutes={form.weekendSleep} minMinutes={180} maxMinutes={960} minuteStep={15} locale={locale} onChangeMinutes={(minutes) => { setSleepTouched(true); setForm((value) => ({ ...value, weekendSleep: String(minutes) })); }} /></>}
  </div><details open><summary>{locale === "ru" ? "Доступные часы" : "Available hours"}</summary><div className={styles.availabilityRows}>{weekdays.map((label, index) => { const day = String(index + 1); const window = form.availability[day]?.[0] ?? { start: "08:00", end: "22:00" }; return <div key={day}><strong>{label}</strong><input type="time" value={window.start} onChange={(event) => updateAvailability(day, "start", event.target.value)} /><span>—</span><input type="time" value={window.end} onChange={(event) => updateAvailability(day, "end", event.target.value)} /></div>; })}</div></details>
  <details><summary>{locale === "ru" ? "Энергия в течение дня" : "Energy throughout the day"}</summary><div className={styles.energyRows}>{form.energyWindows.map((window, index) => <div key={window.energy}><strong>{window.energy === "high" ? (locale === "ru" ? "Высокая" : "High") : window.energy === "normal" ? (locale === "ru" ? "Обычная" : "Normal") : (locale === "ru" ? "Низкая" : "Low")}</strong><input type="time" value={window.start} onChange={(event) => updateEnergy(index, "start", event.target.value)} /><span>—</span><input type="time" value={window.end} onChange={(event) => updateEnergy(index, "end", event.target.value)} /></div>)}</div></details>
  <div className={styles.modalActions}><button type="button" onClick={onClose}>{locale === "ru" ? "Отмена" : "Cancel"}</button><button className={styles.primaryButton} disabled={busy}>{locale === "ru" ? "Сохранить" : "Save"}</button></div></form></ModalShell>;
}

function LegacyImportModal({ sources, locale, busy, loading, onClose, onImport }: {
  sources: LegacySource[];
  locale: Locale;
  busy: boolean;
  loading: boolean;
  onClose: () => void;
  onImport: (sourceKeys: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState(() => new Set(sources.filter((source) => !source.alreadyImported).map((source) => source.sourceKey)));
  const available = sources.filter((source) => !source.alreadyImported);
  const toggle = (sourceKey: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(sourceKey)) next.delete(sourceKey); else next.add(sourceKey);
    return next;
  });
  return <ModalShell title={locale === "ru" ? "Перенос старых расписаний" : "Import old plans"} onClose={onClose} locale={locale}>
    <div className={styles.importBody}>
      <p className={styles.modalLead}>{locale === "ru"
        ? "Выберите источники. Дела, блоки и статусы будут скопированы, а исходные карточки останутся без изменений. Один источник нельзя перенести дважды."
        : "Choose sources to copy. Items, blocks and statuses will be imported without changing the original cards. A source can only be imported once."}</p>
      {loading && sources.length === 0 ? <p className={styles.emptyState}>{locale === "ru" ? "Ищем расписания…" : "Looking for plans…"}</p>
        : sources.length === 0 ? <p className={styles.emptyState}>{locale === "ru" ? "Старые расписания не найдены." : "No old plans found."}</p>
        : <div className={styles.importList}>{sources.map((source) => <label key={source.sourceKey} className={source.alreadyImported ? styles.importedSource : ""}>
          <input type="checkbox" disabled={source.alreadyImported || busy} checked={!source.alreadyImported && selected.has(source.sourceKey)} onChange={() => toggle(source.sourceKey)} />
          <span><strong>{source.title}</strong><small>{source.location} · {source.itemCount} {locale === "ru" ? "дел" : "items"} · {source.blockCount} {locale === "ru" ? "блоков" : "blocks"}</small></span>
          {source.alreadyImported && <em>{locale === "ru" ? "Уже перенесено" : "Imported"}</em>}
        </label>)}</div>}
      <div className={styles.modalActions}><button type="button" onClick={onClose}>{locale === "ru" ? "Закрыть" : "Close"}</button><button className={styles.primaryButton} disabled={busy || available.length === 0 || selected.size === 0} onClick={() => void onImport(Array.from(selected))}>{locale === "ru" ? `Перенести (${selected.size})` : `Import (${selected.size})`}</button></div>
    </div>
  </ModalShell>;
}

function StatsModal({ blocks, items, archiverEntries, profile, locale, onClose }: {
  blocks: PlannerBlock[];
  items: PlannerItem[];
  archiverEntries: PlannerArchiverEntry[];
  profile: PlannerProfile;
  locale: Locale;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const today = todayIn(profile.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [year, month] = today.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const from = period === "day"
    ? today
    : period === "week"
      ? addPlannerDays(today, 1 - plannerWeekday(today))
      : monthStart;
  const until = period === "day"
    ? today
    : period === "week"
      ? addPlannerDays(from, 6)
      : addPlannerDays(nextMonth, -1);
  const scopedBlocks = blocks.filter((block) => {
    const date = localDate(block, profile.timezone);
    return date >= from && date <= until;
  });
  const done = scopedBlocks.filter((block) => block.status === "done");
  const skipped = scopedBlocks.filter((block) => block.status === "skipped");
  const displacedBlockIds = new Set(archiverEntries.filter((entry) => entry.origin === "displaced")
    .flatMap((entry) => entry.sourceBlockId ? [entry.sourceBlockId] : []));
  const cancelled = scopedBlocks.filter((block) => block.status === "cancelled" && !displacedBlockIds.has(block.id));
  const scopedArchiverEntries = archiverEntries.filter((entry) => {
    const date = formatDateInTimeZone(new Date(entry.occurredAt), profile.timezone);
    return date >= from && date <= until;
  });
  const pendingEntries = archiverEntries.filter((entry) => !entry.resolvedAt && entry.pendingMinutes > 0);
  const noSlotEntries = pendingEntries.filter((entry) => entry.category === "no_slot");
  const legacyMissedEntries = scopedArchiverEntries.filter((entry) => entry.category === "missed"
    && entry.origin === "legacy_remainder" && entry.resolution !== "late_completed");
  const resolvedInPeriod = archiverEntries.filter((entry) => entry.resolvedAt && (() => {
    const date = formatDateInTimeZone(new Date(entry.resolvedAt!), profile.timezone);
    return date >= from && date <= until;
  })());
  const rescued = archiverEntries.filter((entry) => entry.returnedAt && (() => {
    const date = formatDateInTimeZone(new Date(entry.returnedAt!), profile.timezone);
    return date >= from && date <= until;
  })());
  const corrected = resolvedInPeriod.filter((entry) => entry.resolution === "late_completed");
  const cancelledBlockIds = new Set(cancelled.map((block) => block.id));
  const cancelledArchiverEntries = scopedArchiverEntries.filter((entry) => entry.resolution?.startsWith("cancelled_")
    && (!entry.sourceBlockId || !cancelledBlockIds.has(entry.sourceBlockId)));
  const actual = done.filter((block) => block.actualStartAt && block.actualEndAt);
  const accuracy = actual.length ? Math.round(actual.reduce((sum, block) => {
    const planned = isoDurationMinutes(block.startAt, block.endAt);
    const fact = isoDurationMinutes(block.actualStartAt!, block.actualEndAt!);
    return sum + Math.max(0, 100 - Math.abs(fact - planned) / planned * 100);
  }, 0) / actual.length) : 0;
  const routineIds = new Set(items.filter((item) => item.kind === "routine").map((item) => item.id));
  const routineBlocks = scopedBlocks.filter((block) => block.itemId && routineIds.has(block.itemId));
  const routineRate = routineBlocks.length ? Math.round(routineBlocks.filter((block) => block.status === "done").length / routineBlocks.length * 100) : 0;
  const byDate = new Map<string, number>();
  for (const block of scopedBlocks.filter((candidate) => !["cancelled", "skipped"].includes(candidate.status))) {
    const date = localDate(block, profile.timezone);
    byDate.set(date, (byDate.get(date) ?? 0) + isoDurationMinutes(block.startAt, block.endAt));
  }
  const overloaded = Array.from(byDate.entries()).filter(([date, minutes]) => {
    const available = (profile.availabilityOverrides[date] ?? profile.availability[String(plannerWeekday(date))] ?? []).reduce((sum, window) => {
      const start = plannerTimeToMinutes(window.start);
      const end = plannerTimeToMinutes(window.end);
      return sum + ((end - start + 1440) % 1440 || 1440);
    }, 0);
    return available > 0 && minutes > available * (1 - profile.reserveRatio);
  }).length;
  const plannedMinutes = done.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
  const actualMinutes = actual.reduce((sum, block) => sum + isoDurationMinutes(block.actualStartAt!, block.actualEndAt!), 0);
  const legacyMissedMinutes = legacyMissedEntries.reduce((sum, entry) => sum + entry.totalMinutes, 0);
  const skippedMinutes = skipped.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
  const pendingMinutes = pendingEntries.reduce((sum, entry) => sum + entry.pendingMinutes, 0);
  const noSlotMinutes = noSlotEntries.reduce((sum, entry) => sum + entry.pendingMinutes, 0);
  return <ModalShell title={locale === "ru" ? "План и факт" : "Plan vs actual"} onClose={onClose} locale={locale}><div className={styles.statsPeriod}>
    <button className={period === "day" ? styles.viewTabActive : ""} onClick={() => setPeriod("day")}>{locale === "ru" ? "День" : "Day"}</button>
    <button className={period === "week" ? styles.viewTabActive : ""} onClick={() => setPeriod("week")}>{locale === "ru" ? "Неделя" : "Week"}</button>
    <button className={period === "month" ? styles.viewTabActive : ""} onClick={() => setPeriod("month")}>{locale === "ru" ? "Месяц" : "Month"}</button>
  </div><p className={styles.fieldHelp}>{formatDay(from, locale)}{from !== until ? ` — ${formatDay(until, locale)}` : ""}</p><div className={styles.statsGrid}>
    <article><span>{locale === "ru" ? "Выполнено" : "Done"}</span><strong>{done.length}</strong></article>
    <article><span>{locale === "ru" ? "Пропущено" : "Missed"}</span><strong>{skipped.length + legacyMissedEntries.length}</strong><small>{formatDuration(skippedMinutes + legacyMissedMinutes, locale)}</small></article>
    <article><span>{locale === "ru" ? "Отменено" : "Cancelled"}</span><strong>{cancelled.length + cancelledArchiverEntries.length}</strong></article>
    <article><span>{locale === "ru" ? "Ждёт разбора" : "Awaiting review"}</span><strong>{pendingEntries.length}</strong><small>{formatDuration(pendingMinutes, locale)}</small></article>
    <article><span>{locale === "ru" ? "Без места" : "No slot"}</span><strong>{noSlotEntries.length}</strong><small>{formatDuration(noSlotMinutes, locale)} · {locale === "ru" ? "без штрафа" : "not penalized"}</small></article>
    <article><span>{locale === "ru" ? "Возвращено в план" : "Returned to plan"}</span><strong>{rescued.length}</strong></article>
    <article><span>{locale === "ru" ? "Исправлено на выполненное" : "Corrected to done"}</span><strong>{corrected.length}</strong></article>
    <article><span>{locale === "ru" ? "План / факт" : "Plan / actual"}</span><strong>{formatDuration(plannedMinutes, locale)} / {formatDuration(actualMinutes, locale)}</strong></article>
    <article><span>{locale === "ru" ? "Точность оценки" : "Estimate accuracy"}</span><strong>{accuracy}%</strong></article>
    <article><span>{locale === "ru" ? "Регулярные дела" : "Routines"}</span><strong>{routineRate}%</strong></article>
    <article><span>{locale === "ru" ? "Перегруженные дни" : "Overloaded days"}</span><strong>{overloaded}</strong></article>
    <article><span>{locale === "ru" ? "Защищённый резерв" : "Protected reserve"}</span><strong>{Math.round(profile.reserveRatio * 100)}%</strong></article>
  </div></ModalShell>;
}
