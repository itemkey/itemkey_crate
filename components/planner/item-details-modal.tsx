"use client";

import { useEffect, useMemo } from "react";

import type { Locale } from "@/lib/i18n";
import type {
  PlannerBlock,
  PlannerCalibrationProgress,
  PlannerItem,
  PlannerItemPlanningState,
  PlannerProfile,
} from "@/lib/planner/types";
import { formatDateInTimeZone, formatTimeInTimeZone, isoDurationMinutes } from "@/lib/planner/time";
import styles from "./planner-workspace.module.css";

type Props = {
  block: PlannerBlock;
  item?: PlannerItem;
  blocks: PlannerBlock[];
  profile: PlannerProfile;
  planningState?: PlannerItemPlanningState;
  calibration?: PlannerCalibrationProgress;
  now: Date;
  locale: Locale;
  onClose: () => void;
  onConstruct: () => void;
};

function durationLabel(minutes: number, locale: Locale): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} ${locale === "ru" ? "мин" : "min"}`;
  return rest ? `${hours} ${locale === "ru" ? "ч" : "h"} ${rest} ${locale === "ru" ? "мин" : "min"}` : `${hours} ${locale === "ru" ? "ч" : "h"}`;
}

function priorityLabel(value: PlannerItem["priority"] | undefined, locale: Locale): string {
  const ru = locale === "ru";
  if (value === "low") return ru ? "Низкий" : "Low";
  if (value === "normal") return ru ? "Обычный" : "Normal";
  if (value === "high") return ru ? "Высокий" : "High";
  if (value === "critical") return ru ? "Критический" : "Critical";
  return "—";
}

function commitmentLabel(value: PlannerItem["commitmentLevel"] | undefined, locale: Locale): string {
  const ru = locale === "ru";
  if (value === "must_not_skip") return ru ? "Нельзя пропустить" : "Must not skip";
  if (value === "required") return ru ? "Нужно сделать" : "Need to do";
  if (value === "desired") return ru ? "Желательно" : "Desired";
  if (value === "if_time") return ru ? "Если останется время" : "If time remains";
  return "—";
}

function estimateModeLabel(value: "exact" | "approximate" | "range" | "unknown" | undefined, locale: Locale): string {
  const ru = locale === "ru";
  if (value === "exact") return ru ? "Точная" : "Exact";
  if (value === "approximate") return ru ? "Примерная" : "Approximate";
  if (value === "range") return ru ? "Диапазон" : "Range";
  if (value === "unknown") return ru ? "Пока неизвестна" : "Not known yet";
  return "—";
}

function dateModeLabel(value: PlannerItem["uncertaintyPolicy"]["date"]["mode"], locale: Locale): string {
  const ru = locale === "ru";
  if (value === "exact") return ru ? "Точная дата" : "Exact date";
  if (value === "preferred") return ru ? "Предпочтительная дата" : "Preferred date";
  if (value === "range") return ru ? "Диапазон дат" : "Date range";
  return ru ? "Любая дата" : "Any date";
}

function timeModeLabel(value: PlannerItem["uncertaintyPolicy"]["time"]["mode"], locale: Locale): string {
  const ru = locale === "ru";
  if (value === "exact") return ru ? "Точное время" : "Exact time";
  if (value === "preferred") return ru ? "Предпочтительное время" : "Preferred time";
  if (value === "range") return ru ? "Диапазон времени" : "Time range";
  return ru ? "Любое время" : "Any time";
}

function recurrenceLabel(recurrence: NonNullable<PlannerItem["recurrence"]>, locale: Locale): string {
  const ru = locale === "ru";
  if (recurrence.frequency === "once") return ru ? "Один раз" : "Once";
  if (recurrence.frequency === "daily") return ru ? "Каждый день" : "Every day";
  const weekdayNames = ru
    ? ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    : ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = recurrence.weekdays?.map((weekday) => weekdayNames[weekday]).filter(Boolean).join(", ");
  const frequency = recurrence.frequency === "weekly"
    ? (ru ? "Каждую неделю" : "Every week")
    : (ru ? "По выбранным дням" : "On selected days");
  return days ? `${frequency}: ${days}` : frequency;
}

function blockStatusLabel(status: PlannerBlock["status"], locale: Locale): string {
  const ru = locale === "ru";
  if (status === "in_progress") return ru ? "В процессе" : "In progress";
  if (status === "done") return ru ? "Выполнено" : "Done";
  if (status === "skipped") return ru ? "Пропущено" : "Missed";
  if (status === "cancelled") return ru ? "Отменено" : "Cancelled";
  return ru ? "Запланировано" : "Planned";
}

function planningReasonLabel(state: PlannerItemPlanningState, locale: Locale): string | undefined {
  const ru = locale === "ru";
  if (state.reasonCode === "reserve") return ru ? "часть окна защищена резервом" : "part of the window is protected reserve";
  if (state.reasonCode === "transition") return ru ? "нужно оставить время на переход" : "transition time must be kept";
  if (state.reasonCode === "sleep") return ru ? "дальше начинается сон" : "sleep starts next";
  if (state.reasonCode === "day_bounds") return ru ? "достигнута граница дня" : "the day boundary was reached";
  if (state.reasonCode === "fixed_event") return ru ? "мешает фиксированное событие" : "a fixed event occupies the time";
  if (state.reasonCode === "window") return ru ? "нет достаточно большого свободного окна" : "there is no large enough free window";
  return state.reason;
}

function calendarDateLabel(at: Date, profile: PlannerProfile, locale: Locale): string {
  const date = formatDateInTimeZone(at, profile.timezone);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function dateTime(block: PlannerBlock, profile: PlannerProfile, locale: Locale): string {
  const date = formatDateInTimeZone(new Date(block.startAt), profile.timezone);
  return `${new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`))}, ${formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}–${formatTimeInTimeZone(new Date(block.endAt), profile.timezone)}`;
}

function countdown(block: PlannerBlock, now: Date, locale: Locale): string {
  const start = new Date(block.startAt).getTime();
  const end = new Date(block.endAt).getTime();
  if (now.getTime() < start) return `${locale === "ru" ? "Начнётся через" : "Starts in"} ${durationLabel((start - now.getTime()) / 60_000, locale)}`;
  if (now.getTime() < end) return `${locale === "ru" ? "Закончится примерно через" : "Expected to end in"} ${durationLabel((end - now.getTime()) / 60_000, locale)}`;
  return locale === "ru" ? "Время выполнения прошло" : "Scheduled time has passed";
}

function effectiveItem(item: PlannerItem | undefined, block: PlannerBlock): PlannerItem | undefined {
  return item ? { ...item, ...block.occurrenceOverride, uncertaintyPolicy: block.occurrenceOverride?.uncertaintyPolicy ?? item.uncertaintyPolicy } : undefined;
}

export default function ItemDetailsModal({
  block, item, blocks, profile, planningState, calibration, now, locale, onClose, onConstruct,
}: Props) {
  const ru = locale === "ru";
  const effective = effectiveItem(item, block);
  const related = useMemo(() => blocks.filter((candidate) => candidate.itemId && candidate.itemId === block.itemId && !candidate.soft), [block.itemId, blocks]);
  const completed = related.filter((candidate) => candidate.status === "done");
  const missed = related.filter((candidate) => candidate.status === "skipped");
  const cancelled = related.filter((candidate) => candidate.status === "cancelled");
  const actualDurations = completed.flatMap((candidate) => candidate.actualStartAt && candidate.actualEndAt
    ? [isoDurationMinutes(candidate.actualStartAt, candidate.actualEndAt)]
    : []);
  const sortedDurations = [...actualDurations].sort((left, right) => left - right);
  const average = actualDurations.length ? actualDurations.reduce((sum, value) => sum + value, 0) / actualDurations.length : 0;
  const median = sortedDurations.length ? sortedDurations[Math.floor(sortedDurations.length / 2)] : 0;
  const decidedCount = completed.length + missed.length + cancelled.length;
  const completionRate = decidedCount ? Math.round(completed.length / decidedCount * 100) : 0;
  const plannedVsActual = completed.flatMap((candidate) => candidate.actualStartAt && candidate.actualEndAt
    ? [Math.abs(isoDurationMinutes(candidate.startAt, candidate.endAt) - isoDurationMinutes(candidate.actualStartAt, candidate.actualEndAt))]
    : []);
  const averageError = plannedVsActual.length ? plannedVsActual.reduce((sum, value) => sum + value, 0) / plannedVsActual.length : 0;
  const recent = [...related].filter((candidate) => new Date(candidate.endAt) <= now).sort((left, right) => right.startAt.localeCompare(left.startAt)).slice(0, 5);
  const upcoming = [...related].filter((candidate) => candidate.status === "planned" && new Date(candidate.endAt) > now).sort((left, right) => left.startAt.localeCompare(right.startAt)).slice(0, 5);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const status = block.soft ? (ru ? "Мягкий резерв" : "Soft reserve")
    : block.status === "in_progress" ? (ru ? "В процессе" : "In progress")
    : block.status === "done" ? (ru ? "Выполнено" : "Done")
      : block.status === "skipped" ? (ru ? "Пропущено" : "Missed")
        : block.status === "cancelled" ? (ru ? "Отменено" : "Cancelled")
          : block.tentative ? (ru ? "Может сдвинуться" : "May move")
            : ru ? "Запланировано" : "Planned";
  const recurrence = effective?.recurrence;
  const duration = effective?.uncertaintyPolicy.duration;
  const planningReason = planningState ? planningReasonLabel(planningState, locale) : undefined;
  const canConstruct = !["done", "skipped", "cancelled"].includes(block.status)
    && (block.status === "in_progress" || new Date(block.endAt) > now);

  return <div className={styles.modalBackdrop} role="presentation"><section className={`${styles.modal} ${styles.itemDetailsModal}`} role="dialog" aria-modal="true" aria-labelledby="item-details-title">
    <header><div><h2 id="item-details-title">{effective?.title ?? block.title}</h2><small>{status}</small></div></header>
    <div className={styles.itemDetailsBody}>
      <section className={styles.itemDetailsHero}>
        <div><span>{ru ? "Выбранное выполнение" : "Selected occurrence"}</span><strong>{dateTime(block, profile, locale)}</strong><small>{durationLabel(isoDurationMinutes(block.startAt, block.endAt), locale)} · {countdown(block, now, locale)}</small></div>
        <div><span>{ru ? "Почему оно здесь" : "Why it is here"}</span><strong>{block.source === "manual" ? (ru ? "Поставлено вручную" : "Placed manually") : block.fixed ? (ru ? "Зафиксировано правилами" : "Fixed by its rules") : (ru ? "Подобрано автопланом" : "Chosen by autoplan")}</strong><small>{block.tentativeReason
          ? (ru ? `Может сдвинуться, если «${block.tentativeReason.reserveTitle}» займёт резерв до ${formatTimeInTimeZone(new Date(block.tentativeReason.latestAt), profile.timezone)}.` : `May move if “${block.tentativeReason.reserveTitle}” uses its reserve until ${formatTimeInTimeZone(new Date(block.tentativeReason.latestAt), profile.timezone)}.`)
          : block.soft ? (ru ? "Это запас до максимальной оценки, а не отдельное дело." : "This is capacity up to the maximum estimate, not another item.")
            : (ru ? "Конфликтов с жёсткими границами нет." : "No hard-boundary conflicts.")}</small></div>
      </section>

      <section className={styles.itemDetailsSection}><h3>{ru ? "О деле" : "About"}</h3><dl>
        <div><dt>{ru ? "Тип" : "Type"}</dt><dd>{effective?.kind === "fixed_event" ? (ru ? "Фиксированное событие" : "Fixed event") : effective?.kind === "routine" ? (ru ? "Повторяющееся дело" : "Recurring item") : (ru ? "Гибкое дело" : "Flexible item")}</dd></div>
        <div><dt>{ru ? "Категория" : "Category"}</dt><dd>{effective?.area || "—"}</dd></div>
        <div><dt>{ru ? "Место" : "Place"}</dt><dd>{effective?.location || "—"}</dd></div>
        <div><dt>{ru ? "Заметка" : "Note"}</dt><dd>{effective?.notes || "—"}</dd></div>
        <div><dt>{ru ? "Приоритет" : "Priority"}</dt><dd>{priorityLabel(effective?.priority, locale)}</dd></div>
        <div><dt>{ru ? "Обязательность" : "Commitment"}</dt><dd>{commitmentLabel(effective?.commitmentLevel, locale)}</dd></div>
      </dl></section>

      {effective && <section className={styles.itemDetailsSection}><h3>{ru ? "Правила планирования" : "Planning rules"}</h3><dl>
        <div><dt>{ru ? "Длительность" : "Duration"}</dt><dd>{duration ? `${ru ? "минимум" : "minimum"} ${durationLabel(duration.minMinutes, locale)} · ${ru ? "обычно" : "usually"} ${durationLabel(duration.likelyMinutes, locale)} · ${ru ? "максимум" : "maximum"} ${durationLabel(duration.maxMinutes, locale)}` : "—"}</dd></div>
        <div><dt>{ru ? "Точность" : "Certainty"}</dt><dd>{estimateModeLabel(duration?.mode, locale)}</dd></div>
        <div><dt>{ru ? "Разделение" : "Splitting"}</dt><dd>{effective.canSplit ? `${ru ? "Можно, минимум" : "Allowed, minimum"} ${durationLabel(effective.minChunkMinutes, locale)}` : (ru ? "Только целиком" : "Whole only")}</dd></div>
        <div><dt>{ru ? "Сокращение" : "Reduction"}</dt><dd>{effective.uncertaintyPolicy.reduction?.mode === "to_minimum" ? `${ru ? "До" : "To"} ${durationLabel(effective.uncertaintyPolicy.reduction.minimumMinutes, locale)}` : (ru ? "Запрещено" : "Forbidden")}</dd></div>
        <div><dt>{ru ? "Дата и время" : "Date and time"}</dt><dd>{dateModeLabel(effective.uncertaintyPolicy.date.mode, locale)} · {timeModeLabel(effective.uncertaintyPolicy.time.mode, locale)}</dd></div>
        <div><dt>{ru ? "Переходы" : "Buffers"}</dt><dd>{durationLabel(effective.bufferBeforeMinutes, locale)} / {durationLabel(effective.bufferAfterMinutes, locale)}</dd></div>
        <div><dt>{ru ? "Дорога" : "Travel"}</dt><dd>{effective.uncertaintyPolicy.travel ? `${estimateModeLabel(effective.uncertaintyPolicy.travel.mode, locale)} · ${ru ? "минимум" : "minimum"} ${durationLabel(effective.uncertaintyPolicy.travel.minMinutes, locale)} · ${ru ? "обычно" : "usually"} ${durationLabel(effective.uncertaintyPolicy.travel.likelyMinutes, locale)} · ${ru ? "максимум" : "maximum"} ${durationLabel(effective.uncertaintyPolicy.travel.maxMinutes, locale)}` : (ru ? "Не указана" : "Not set")}</dd></div>
        <div><dt>{ru ? "Повтор" : "Repeat"}</dt><dd>{recurrence ? recurrenceLabel(recurrence, locale) : (ru ? "Нет" : "None")}</dd></div>
        <div><dt>{ru ? "Срок" : "Deadline"}</dt><dd>{effective.deadlineAt ? `${calendarDateLabel(new Date(effective.deadlineAt), profile, locale)}, ${formatTimeInTimeZone(new Date(effective.deadlineAt), profile.timezone)}` : (ru ? "Нет" : "None")}</dd></div>
      </dl>{effective.milestones.length > 0 && <ul>{effective.milestones.map((milestone) => <li key={milestone.id}>{milestone.title} · {calendarDateLabel(new Date(milestone.targetAt), profile, locale)}</li>)}</ul>}</section>}

      <section className={styles.itemDetailsSection}><h3>{ru ? "План и статистика" : "Plan and statistics"}</h3><div className={styles.itemStatsGrid}>
        <article><span>{ru ? "Выполнено" : "Completed"}</span><strong>{completed.length}</strong></article>
        <article><span>{ru ? "Пропущено / отменено" : "Missed / cancelled"}</span><strong>{missed.length} / {cancelled.length}</strong></article>
        <article><span>{ru ? "Фактическое время" : "Actual time"}</span><strong>{durationLabel(actualDurations.reduce((sum, value) => sum + value, 0), locale)}</strong></article>
        <article><span>{ru ? "Среднее / медиана" : "Average / median"}</span><strong>{actualDurations.length ? `${durationLabel(average, locale)} / ${durationLabel(median, locale)}` : "—"}</strong></article>
        <article><span>{ru ? "Завершение" : "Completion"}</span><strong>{decidedCount ? `${completionRate}%` : "—"}</strong></article>
        <article><span>{ru ? "Средняя ошибка оценки" : "Average estimate error"}</span><strong>{plannedVsActual.length ? durationLabel(averageError, locale) : "—"}</strong></article>
      </div>{planningState && <p className={styles.itemPlanningState}>{ru ? "Запрошено" : "Requested"}: {durationLabel(planningState.requestedMinutes, locale)} · {ru ? "запланировано" : "planned"}: {durationLabel(planningState.plannedMinutes, locale)} · {ru ? "без места" : "unplaced"}: {durationLabel(planningState.remainingMinutes, locale)}{planningReason ? ` — ${planningReason}` : ""}</p>}{calibration && <p className={styles.itemPlanningState}>{ru ? "Пробная сессия" : "Trial session"}: {durationLabel(calibration.completedMinutes, locale)} / {durationLabel(calibration.targetMinutes, locale)} {ru ? "выполнено" : "completed"}; {durationLabel(calibration.plannedMinutes, locale)} {ru ? "уже стоит в плане" : "already planned"}; {durationLabel(calibration.remainingMinutes, locale)} {ru ? "ещё без места" : "still unplaced"}.</p>}</section>

      <section className={styles.itemDetailsColumns}><div><h3>{ru ? "Последние выполнения" : "Recent occurrences"}</h3>{recent.length ? recent.map((candidate) => <p key={candidate.id}>{calendarDateLabel(new Date(candidate.startAt), profile, locale)} · {formatTimeInTimeZone(new Date(candidate.startAt), profile.timezone)} · {blockStatusLabel(candidate.status, locale)}</p>) : <p>—</p>}</div><div><h3>{ru ? "Ближайшие выполнения" : "Upcoming occurrences"}</h3>{upcoming.length ? upcoming.map((candidate) => <p key={candidate.id}>{calendarDateLabel(new Date(candidate.startAt), profile, locale)} · {formatTimeInTimeZone(new Date(candidate.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(candidate.endAt), profile.timezone)}</p>) : <p>—</p>}</div></section>
    </div>
    <div className={`${styles.modalActions} ${styles.itemDetailsActions}`}>{effective && !canConstruct && <span className={styles.immutableNotice}>{ru ? "История этого выполнения неизменна" : "This occurrence history is immutable"}</span>}<button type="button" onClick={onClose}>{ru ? "Закрыть" : "Close"}</button>{effective && canConstruct && <button type="button" className={styles.primaryButton} onClick={onConstruct}>{ru ? "Конструктор дела" : "Item constructor"}</button>}</div>
  </section></div>;
}
