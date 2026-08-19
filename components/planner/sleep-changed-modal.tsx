"use client";

import { useState } from "react";

import type { Locale } from "@/lib/i18n";
import { createOpenSleepEvent, createPlannerSleepEvent, createTentativeSleepEvent } from "@/lib/planner/sleep";
import type { PlannerProfile, PlannerSleepEvent, PlannerSleepRestedness } from "@/lib/planner/types";
import { addPlannerDays, formatDateInTimeZone, formatTimeInTimeZone, plannerTimeToMinutes, zonedPlannerDateTimeToUtc } from "@/lib/planner/time";
import styles from "./planner-workspace.module.css";

export type SleepMode = "later" | "bedtime" | "woke" | "checkin";

export default function SleepChangedModal({ profile, locale, busy, initialMode = "later", initialWakeDate, onClose, onSubmit, onCheckIn }: {
  profile: PlannerProfile;
  locale: Locale;
  busy: boolean;
  initialMode?: SleepMode;
  initialWakeDate?: string;
  onClose: () => void;
  onSubmit: (event: PlannerSleepEvent) => Promise<void>;
  onCheckIn: (wakeDate: string, restedness: PlannerSleepRestedness) => Promise<void>;
}) {
  const ru = locale === "ru";
  const now = new Date();
  const today = formatDateInTimeZone(now, profile.timezone);
  const [mode, setMode] = useState<SleepMode>(initialMode);
  const [startDate, setStartDate] = useState(initialMode === "woke" ? addPlannerDays(today, -1) : today);
  const [startTime, setStartTime] = useState(formatTimeInTimeZone(now, profile.timezone));
  const [wakeDate, setWakeDate] = useState(initialWakeDate ?? (initialMode === "woke" ? today : addPlannerDays(today, 1)));
  const [wakeTime, setWakeTime] = useState("");
  const [estimateFrom, setEstimateFrom] = useState("03:00");
  const [estimateTo, setEstimateTo] = useState("06:00");
  const [fullyUnknown, setFullyUnknown] = useState(false);
  const [restedness, setRestedness] = useState<PlannerSleepRestedness | "">("");
  const [error, setError] = useState("");

  function changeMode(next: SleepMode) {
    setMode(next);
    setError("");
    if (next === "woke") {
      setStartDate(addPlannerDays(today, -1));
      setWakeDate(today);
    } else if (next === "checkin") {
      setStartDate(today);
    } else {
      setStartDate(today);
      setWakeDate(addPlannerDays(today, 1));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (mode === "checkin") {
        if (!restedness) throw new Error(ru ? "Выберите короткую оценку сна." : "Choose a short sleep rating.");
        await onCheckIn(startDate, restedness);
        return;
      }
      if (mode === "later") {
        if (fullyUnknown) {
          await onSubmit(createOpenSleepEvent(wakeDate));
          return;
        }
        const endDate = plannerTimeToMinutes(estimateTo) < plannerTimeToMinutes(estimateFrom)
          ? addPlannerDays(startDate, 1)
          : startDate;
        await onSubmit(createTentativeSleepEvent({
          profile,
          wakeDate,
          estimatedStartFromAt: zonedPlannerDateTimeToUtc(startDate, estimateFrom, profile.timezone),
          estimatedStartToAt: zonedPlannerDateTimeToUtc(endDate, estimateTo, profile.timezone),
        }));
        return;
      }
      const actualStartAt = zonedPlannerDateTimeToUtc(startDate, startTime, profile.timezone);
      const actualEndAt = mode === "woke" && wakeTime
        ? zonedPlannerDateTimeToUtc(wakeDate, wakeTime, profile.timezone)
        : undefined;
      if (actualEndAt && new Date(actualEndAt) <= new Date(actualStartAt)) throw new Error(ru ? "Пробуждение должно быть позже засыпания." : "Wake-up must be after bedtime.");
      await onSubmit(createPlannerSleepEvent({
        profile,
        wakeDate,
        actualStartAt,
        actualEndAt,
        restedness: restedness || undefined,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (ru ? "Проверьте время сна." : "Check sleep times."));
    }
  }

  const modes: Array<{ id: SleepMode; ru: string; en: string }> = [
    { id: "later", ru: "Сегодня лягу позже", en: "Sleeping later" },
    { id: "bedtime", ru: "Ложусь сейчас", en: "Going to bed now" },
    { id: "woke", ru: "Уже проснулся", en: "Already woke up" },
    { id: "checkin", ru: "Как я выспался", en: "How I slept" },
  ];

  return <div className={styles.modalBackdrop} role="presentation"><section className={styles.modal} role="dialog" aria-modal="true" aria-label={ru ? "Сон изменился" : "Sleep changed"}>
    <header><h2>{ru ? "Сон и восстановление" : "Sleep and recovery"}</h2><button type="button" onClick={onClose}>×</button></header>
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <p className={styles.modalLead}>{ru ? "Разовое изменение не переписывает постоянный режим. Перед переносом дел вы увидите единый предпросмотр." : "A one-off change never rewrites your regular schedule. You will review all task moves first."}</p>
      <div className={styles.segmented}>{modes.map((entry) => <button type="button" key={entry.id} className={mode === entry.id ? styles.segmentedActive : ""} onClick={() => changeMode(entry.id)}>{ru ? entry.ru : entry.en}</button>)}</div>
      {error && <p className={styles.inlineError}>{error}</p>}

      {mode === "later" && <>
        <p className={styles.sleepHint}>{ru ? "Если точного времени нет, укажите примерный диапазон. План будет помечен как предварительный и пересчитается после «Ложусь сейчас»." : "If the exact time is unknown, provide a rough range. The plan stays tentative until you confirm bedtime."}</p>
        <div className={styles.formGrid}>
          <label>{ru ? "Дата позднего сна" : "Late bedtime date"}<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>{ru ? "Дата будущего подъёма" : "Expected wake date"}<input type="date" required value={wakeDate} onChange={(event) => setWakeDate(event.target.value)} /></label>
          {!fullyUnknown && <><label>{ru ? "Лягу не раньше" : "Not before"}<input type="time" required value={estimateFrom} onChange={(event) => setEstimateFrom(event.target.value)} /></label><label>{ru ? "И не позже" : "Not after"}<input type="time" required value={estimateTo} onChange={(event) => setEstimateTo(event.target.value)} /></label></>}
        </div>
        <label className={styles.choiceCheck}><input type="checkbox" checked={fullyUnknown} onChange={(event) => setFullyUnknown(event.target.checked)} />{ru ? "Время совсем неизвестно — сохранить состояние и дождаться факта" : "Time is completely unknown — save state and wait for confirmation"}</label>
      </>}

      {(mode === "bedtime" || mode === "woke") && <>
        <div className={styles.formGrid}>
          <label>{ru ? "Дата засыпания" : "Bedtime date"}<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>{ru ? "Фактически лёг" : "Actual bedtime"}<input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
          <label>{ru ? "Дата пробуждения" : "Wake date"}<input type="date" required value={wakeDate} onChange={(event) => setWakeDate(event.target.value)} /></label>
          {mode === "woke" && <label>{ru ? "Фактически проснулся" : "Actual wake-up"}<input type="time" required value={wakeTime} onChange={(event) => setWakeTime(event.target.value)} /></label>}
        </div>
        {mode === "bedtime" && <p className={styles.sleepHint}>{ru ? "Подъём рассчитывается с полной целевой длительностью. Будущие гибкие дела будут перенесены, а режим затем вернётся постепенно." : "Wake-up preserves the full target duration. Flexible work moves and the anchor returns gradually."}</p>}
        {mode === "woke" && <Restedness value={restedness} setValue={setRestedness} ru={ru} optional />}
      </>}

      {mode === "checkin" && <>
        <label>{ru ? "Дата пробуждения" : "Wake date"}<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <Restedness value={restedness} setValue={setRestedness} ru={ru} />
        <p className={styles.modalLead}>{ru ? "После семи сопоставимых ночей планировщик сможет предложить корректировку цели. Сам он её не применит." : "After seven comparable nights the planner may suggest a target adjustment, but never applies it automatically."}</p>
      </>}

      <div className={styles.modalActions}><button type="button" onClick={onClose}>{ru ? "Отмена" : "Cancel"}</button><button className={styles.primaryButton} disabled={busy}>{mode === "checkin" ? (ru ? "Сохранить оценку" : "Save rating") : fullyUnknown && mode === "later" ? (ru ? "Сохранить без перестройки" : "Save without rebuilding") : (ru ? "Показать новый план" : "Review new plan")}</button></div>
    </form>
  </section></div>;
}

function Restedness({ value, setValue, ru, optional = false }: {
  value: PlannerSleepRestedness | "";
  setValue: (value: PlannerSleepRestedness) => void;
  ru: boolean;
  optional?: boolean;
}) {
  const choices: Array<{ value: PlannerSleepRestedness; ru: string; en: string }> = [
    { value: "not_rested", ru: "Не выспался", en: "Not rested" },
    { value: "okay", ru: "Нормально", en: "Okay" },
    { value: "well_rested", ru: "Хорошо выспался", en: "Well rested" },
  ];
  return <fieldset className={styles.ratingField}><legend>{ru ? `Как вы выспались${optional ? " (необязательно)" : ""}?` : `How did you sleep${optional ? " (optional)" : ""}?`}</legend><div className={styles.segmented}>{choices.map((choice) => <button type="button" key={choice.value} className={value === choice.value ? styles.segmentedActive : ""} onClick={() => setValue(choice.value)}>{ru ? choice.ru : choice.en}</button>)}</div></fieldset>;
}
