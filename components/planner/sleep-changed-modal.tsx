"use client";

import { useState } from "react";

import type { Locale } from "@/lib/i18n";
import { createPlannerSleepEvent } from "@/lib/planner/sleep";
import type { PlannerProfile, PlannerSleepEvent } from "@/lib/planner/types";
import { addPlannerDays, formatDateInTimeZone, formatTimeInTimeZone, zonedPlannerDateTimeToUtc } from "@/lib/planner/time";
import styles from "./planner-workspace.module.css";

export default function SleepChangedModal({ profile, locale, busy, onClose, onSubmit }: {
  profile: PlannerProfile;
  locale: Locale;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: PlannerSleepEvent) => Promise<void>;
}) {
  const ru = locale === "ru";
  const now = new Date();
  const today = formatDateInTimeZone(now, profile.timezone);
  const [mode, setMode] = useState<"bedtime" | "woke">("bedtime");
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState(formatTimeInTimeZone(now, profile.timezone));
  const [wakeDate, setWakeDate] = useState(addPlannerDays(today, 1));
  const [wakeTime, setWakeTime] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const actualStartAt = zonedPlannerDateTimeToUtc(startDate, startTime, profile.timezone);
      const actualEndAt = mode === "woke" && wakeTime
        ? zonedPlannerDateTimeToUtc(wakeDate, wakeTime, profile.timezone)
        : undefined;
      if (actualEndAt && new Date(actualEndAt) <= new Date(actualStartAt)) throw new Error(ru ? "Пробуждение должно быть позже засыпания." : "Wake-up must be after bedtime.");
      await onSubmit(createPlannerSleepEvent({ profile, wakeDate, actualStartAt, actualEndAt }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (ru ? "Проверьте время сна." : "Check sleep times."));
    }
  }

  return <div className={styles.modalBackdrop} role="presentation"><section className={styles.modal} role="dialog" aria-modal="true" aria-label={ru ? "Сон изменился" : "Sleep changed"}>
    <header><h2>{ru ? "Сон изменился" : "Sleep changed"}</h2><button type="button" onClick={onClose}>×</button></header>
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <p className={styles.modalLead}>{ru ? "Это изменение относится только к одной ночи. Обычный режим сна останется прежним." : "This affects one night only. Your regular sleep schedule will stay unchanged."}</p>
      <div className={styles.segmented}><button type="button" className={mode === "bedtime" ? styles.segmentedActive : ""} onClick={() => setMode("bedtime")}>{ru ? "Ложусь сейчас / лёг в другое время" : "Going to bed now / different time"}</button><button type="button" className={mode === "woke" ? styles.segmentedActive : ""} onClick={() => setMode("woke")}>{ru ? "Уже проснулся" : "Already woke up"}</button></div>
      {error && <p className={styles.inlineError}>{error}</p>}
      <div className={styles.formGrid}>
        <label>{ru ? "Дата засыпания" : "Bedtime date"}<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label>{ru ? "Фактически лёг" : "Actual bedtime"}<input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
        <label>{ru ? "Дата пробуждения" : "Wake date"}<input type="date" required value={wakeDate} onChange={(event) => setWakeDate(event.target.value)} /></label>
        {mode === "woke" && <label>{ru ? "Фактически проснулся" : "Actual wake-up"}<input type="time" required value={wakeTime} onChange={(event) => setWakeTime(event.target.value)} /></label>}
      </div>
      {mode === "bedtime" && <p className={styles.sleepHint}>{ru ? "Время подъёма будет рассчитано так, чтобы сохранить обычную длительность сна." : "Wake-up will be calculated to preserve your normal sleep duration."}</p>}
      <div className={styles.modalActions}><button type="button" onClick={onClose}>{ru ? "Отмена" : "Cancel"}</button><button className={styles.primaryButton} disabled={busy}>{ru ? "Показать новый план" : "Review new plan"}</button></div>
    </form>
  </section></div>;
}
