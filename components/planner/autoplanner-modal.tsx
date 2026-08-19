"use client";

import { useEffect, useMemo, useState } from "react";

import type { Locale } from "@/lib/i18n";
import {
  availabilityFromSleepSchedule,
  createAdaptiveSleepSchedule,
  fixedScheduleView,
  sleepRuleForWakeDate,
} from "@/lib/planner/sleep";
import {
  type PlannerAssistantParseResult,
  type PlannerDraft,
  type PlannerEnergyWindow,
  type PlannerItem,
  type PlannerProfile,
  type PlannerProposalInput,
  type PlannerSleepParseResult,
  type PlannerSleepSchedule,
  type PlannerWakeDayPart,
} from "@/lib/planner/types";
import { plannerMinutesToTime, plannerTimeToMinutes } from "@/lib/planner/time";
import styles from "./planner-workspace.module.css";

type AssistantDraft = {
  timezone: string;
  sleepMode: "fixed" | "adaptive";
  sleepText: string;
  weekdayBedtime: string;
  weekdayDuration: string;
  separateWeekend: boolean;
  weekendBedtime: string;
  weekendDuration: string;
  adaptiveMinDuration: string;
  adaptiveMaxDuration: string;
  wakeDayPart: PlannerWakeDayPart;
  morningPreparationMinutes: string;
  healthyMinimumConfirmed: boolean;
  commitments: string;
  energy: "morning" | "day" | "evening";
  reserve: string;
  tasks: string;
};

const STORAGE_KEY = "itemkey.planner.autoplanner.v2";

function initialDraft(profile: PlannerProfile): AssistantDraft {
  const fixed = fixedScheduleView(profile.sleepSchedule);
  const adaptive = profile.sleepSchedule.mode === "adaptive" ? profile.sleepSchedule : undefined;
  return {
    timezone: profile.timezone,
    sleepMode: profile.sleepSchedule.mode,
    sleepText: "",
    weekdayBedtime: fixed.weekdays.bedtime,
    weekdayDuration: String(fixed.weekdays.durationMinutes),
    separateWeekend: fixed.weekends.bedtime !== fixed.weekdays.bedtime
      || fixed.weekends.durationMinutes !== fixed.weekdays.durationMinutes,
    weekendBedtime: fixed.weekends.bedtime,
    weekendDuration: String(fixed.weekends.durationMinutes),
    adaptiveMinDuration: String(adaptive?.durationRange.minMinutes ?? 7 * 60),
    adaptiveMaxDuration: String(adaptive?.durationRange.maxMinutes ?? 9 * 60),
    wakeDayPart: adaptive?.wakeAnchor.dayPart ?? "morning",
    morningPreparationMinutes: String(adaptive?.morningPreparationMinutes ?? 60),
    healthyMinimumConfirmed: !adaptive?.requiresHealthyMinimumConfirmation,
    commitments: "",
    energy: "morning",
    reserve: String(Math.round(profile.reserveRatio * 100)),
    tasks: "",
  };
}

function scheduleFromDraft(value: AssistantDraft, commitments: PlannerDraft[] = []): PlannerSleepSchedule {
  if (value.sleepMode === "adaptive") {
    return createAdaptiveSleepSchedule({
      minMinutes: Number(value.adaptiveMinDuration) || 7 * 60,
      maxMinutes: Number(value.adaptiveMaxDuration) || 9 * 60,
      dayPart: value.wakeDayPart,
      morningPreparationMinutes: Number(value.morningPreparationMinutes) || 60,
      commitments,
      healthyMinimumConfirmed: value.healthyMinimumConfirmed,
    });
  }
  const weekday = {
    bedtime: value.weekdayBedtime,
    durationMinutes: Math.max(180, Number(value.weekdayDuration) || 480),
  };
  return {
    mode: "fixed",
    weekdays: weekday,
    weekends: value.separateWeekend
      ? { bedtime: value.weekendBedtime, durationMinutes: Math.max(180, Number(value.weekendDuration) || 480) }
      : { ...weekday },
  };
}

function energyWindows(value: AssistantDraft, commitments: PlannerDraft[]): PlannerEnergyWindow[] {
  const schedule = scheduleFromDraft(value, commitments);
  const rule = sleepRuleForWakeDate(schedule, "2026-08-17");
  const wake = plannerTimeToMinutes(rule.bedtime) + rule.durationMinutes;
  const highStart = value.energy === "morning" ? wake : value.energy === "day" ? wake + 3 * 60 : wake + 8 * 60;
  const windows: PlannerEnergyWindow[] = [
    { start: plannerMinutesToTime(wake), end: plannerMinutesToTime(highStart), energy: "normal" },
    { start: plannerMinutesToTime(highStart), end: plannerMinutesToTime(highStart + 4 * 60), energy: "high" },
    { start: plannerMinutesToTime(highStart + 4 * 60), end: rule.bedtime, energy: "low" },
  ];
  return windows.filter((window) => window.start !== window.end);
}

function ModalFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return <div className={styles.modalBackdrop} role="presentation"><section className={`${styles.modal} ${styles.assistantModal}`} role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2>{onClose && <button type="button" onClick={onClose} aria-label="Close">×</button>}</header>
    {children}
  </section></div>;
}

export default function AutoplannerModal({
  profile,
  items,
  blocksCount,
  sleepEventsCount,
  locale,
  firstRun,
  busy,
  onClose,
  onParseTasks,
  onParseSleep,
  onPrepare,
  onOpenSleep,
  onReset,
}: {
  profile: PlannerProfile;
  items: PlannerItem[];
  blocksCount: number;
  sleepEventsCount: number;
  locale: Locale;
  firstRun: boolean;
  busy: boolean;
  onClose?: () => void;
  onParseTasks: (text: string) => Promise<PlannerAssistantParseResult>;
  onParseSleep: (text: string) => Promise<PlannerSleepParseResult>;
  onPrepare: (input: PlannerProposalInput) => Promise<void>;
  onOpenSleep: () => void;
  onReset: (password: string) => Promise<void>;
}) {
  const ru = locale === "ru";
  const [step, setStep] = useState(firstRun ? 1 : 0);
  const [value, setValue] = useState<AssistantDraft>(() => initialDraft(profile));
  const [parsed, setParsed] = useState<PlannerAssistantParseResult>({ drafts: [], ambiguities: [] });
  const [localError, setLocalError] = useState("");
  const [profileChanged, setProfileChanged] = useState(firstRun);
  const [resetStage, setResetStage] = useState<0 | 1 | 2>(0);
  const [password, setPassword] = useState("");
  const [ambiguitiesConfirmed, setAmbiguitiesConfirmed] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && firstRun) {
        const restored = JSON.parse(saved) as Partial<AssistantDraft>;
        timer = window.setTimeout(() => setValue((current) => ({ ...current, ...restored })), 0);
      }
    } catch { /* a draft is optional */ }
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [firstRun]);
  useEffect(() => {
    if (!firstRun) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }, [firstRun, value]);

  const labels = ru
    ? ["Сводка", "Часовой пояс", "Сон", "Пробный режим", "Обязательства", "Продуктивность", "Список дел", "Проверка", "Итог"]
    : ["Summary", "Time zone", "Sleep", "Trial schedule", "Commitments", "Productivity", "Tasks", "Review", "Result"];
  const currentLabel = labels[step] ?? labels[0];

  const profilePatch = useMemo<Partial<PlannerProfile>>(() => {
    const sleepSchedule = scheduleFromDraft(value, parsed.drafts);
    return {
      timezone: value.timezone,
      sleepSchedule,
      availability: availabilityFromSleepSchedule(sleepSchedule),
      energyWindows: energyWindows(value, parsed.drafts),
      reserveRatio: Math.min(0.6, Math.max(0, Number(value.reserve) / 100 || 0.2)),
      assistantSetupVersion: 2,
      onboardingCompleted: true,
    };
  }, [parsed.drafts, value]);

  const update = <K extends keyof AssistantDraft>(key: K, next: AssistantDraft[K]) => setValue((current) => ({ ...current, [key]: next }));

  async function recognizeSleep() {
    setLocalError("");
    try {
      const result = await onParseSleep(value.sleepText);
      if (result.mode) update("sleepMode", result.mode);
      if (result.bedtime) update("weekdayBedtime", result.bedtime);
      if (result.durationMinutes) update("weekdayDuration", String(result.durationMinutes));
      if (result.durationRange) {
        update("adaptiveMinDuration", String(result.durationRange.minMinutes));
        update("adaptiveMaxDuration", String(result.durationRange.maxMinutes));
        update("healthyMinimumConfirmed", false);
      }
      if (result.wakeDayPart) update("wakeDayPart", result.wakeDayPart);
      if (result.ambiguities.length) setLocalError(ru
        ? result.ambiguities.join(" ")
        : "Confirm both the regular bedtime and the usual sleep duration below.");
      setProfileChanged(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Не удалось распознать сон.");
    }
  }

  async function recognizeTasks() {
    setLocalError("");
    const text = [value.commitments, value.tasks].filter((part) => part.trim()).join("\n");
    if (!text) {
      setParsed({ drafts: [], ambiguities: [] });
      setStep(7);
      return;
    }
    try {
      setParsed(await onParseTasks(text));
      setAmbiguitiesConfirmed(false);
      setStep(7);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Не удалось разобрать список.");
    }
  }

  function updateParsed(index: number, patch: Partial<PlannerDraft>) {
    setParsed((current) => ({ ...current, drafts: current.drafts.map((draft, candidate) => candidate === index ? { ...draft, ...patch } : draft) }));
  }

  async function prepare() {
    await onPrepare({
      drafts: parsed.drafts,
      profilePatch: profileChanged || firstRun ? profilePatch : undefined,
      trigger: firstRun ? "assistant_setup" : "assistant_update",
      rebuildFuture: true,
    });
  }

  if (resetStage > 0) {
    return <ModalFrame title={ru ? "Обнулить план" : "Reset planner"} onClose={() => setResetStage(0)}>
      <div className={styles.assistantBody}>
        {resetStage === 1 ? <>
          <p className={styles.dangerPanel}>{ru
            ? `Будут удалены настройки, ${items.length} дел, ${blocksCount} блоков календаря, ${sleepEventsCount} изменений сна, история и отметки импорта. Данные Crate и оригинальные карточки сохранятся. Отменить сброс нельзя.`
            : `Settings, ${items.length} items, ${blocksCount} calendar blocks, ${sleepEventsCount} sleep changes, history and import markers will be deleted. Crate data stays intact.`}</p>
          <div className={styles.modalActions}><button type="button" onClick={() => setResetStage(0)}>{ru ? "Отмена" : "Cancel"}</button><button type="button" className={styles.dangerButton} onClick={() => setResetStage(2)}>{ru ? "Продолжить" : "Continue"}</button></div>
        </> : <form onSubmit={(event) => { event.preventDefault(); void onReset(password); }} className={styles.form}>
          <label>{ru ? "Текущий пароль Item Key" : "Current Item Key password"}<input autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <div className={styles.modalActions}><button type="button" onClick={() => setResetStage(1)}>{ru ? "Назад" : "Back"}</button><button className={styles.dangerButton} disabled={busy || password.length < 6}>{ru ? "Удалить весь план" : "Delete planner"}</button></div>
        </form>}
      </div>
    </ModalFrame>;
  }

  if (step === 0) {
    const active = items.filter((item) => item.status === "active").length;
    const fixed = fixedScheduleView(profile.sleepSchedule);
    return <ModalFrame title={ru ? "Автопланировщик" : "Autoplanner"} onClose={onClose}>
      <div className={styles.assistantBody}>
        <div className={styles.assistantSummary}>
          <article><span>{ru ? "Активные дела" : "Active items"}</span><strong>{active}</strong></article>
          <article><span>{ru ? "Режим сна" : "Sleep mode"}</span><strong>{profile.sleepSchedule.mode === "adaptive"
            ? `${ru ? "Адаптивный" : "Adaptive"} · ${profile.sleepSchedule.wakeAnchor.localTime} · ${Math.round(profile.sleepSchedule.targetDurationMinutes / 6) / 10} ${ru ? "ч" : "h"}`
            : `${fixed.weekdays.bedtime} · ${Math.round(fixed.weekdays.durationMinutes / 6) / 10} ${ru ? "ч" : "h"}`}</strong></article>
          <article><span>{ru ? "Резерв" : "Reserve"}</span><strong>{Math.round(profile.reserveRatio * 100)}%</strong></article>
        </div>
        <div className={styles.assistantChoices}>
          <button onClick={() => { setProfileChanged(false); setStep(6); }}>{ru ? "Добавить дела обычным списком" : "Add items as a list"}<small>{ru ? "Одна строка — одно дело" : "One line per item"}</small></button>
          <button onClick={() => { setProfileChanged(true); setStep(2); }}>{ru ? "Изменить режим сна" : "Change sleep mode"}<small>{ru ? "Точный режим или помощь в его формировании" : "Fixed schedule or an adaptive trial mode"}</small></button>
          <button onClick={onOpenSleep}>{ru ? "Сон изменился сегодня" : "Sleep changed today"}<small>{ru ? "Учесть позднее засыпание или подъём" : "Record a late bedtime or wake-up"}</small></button>
          <button onClick={() => { setProfileChanged(false); setStep(4); }}>{ru ? "Обязательства и routines" : "Commitments and routines"}<small>{ru ? "Добавить постоянные ограничения" : "Add recurring constraints"}</small></button>
          <button onClick={() => { setProfileChanged(true); setStep(5); }}>{ru ? "Изменить нагрузку" : "Change workload"}<small>{ru ? "Энергия и резерв времени" : "Energy and protected reserve"}</small></button>
          <button onClick={() => void onPrepare({ trigger: "assistant_update", rebuildFuture: true })}>{ru ? "Пересобрать будущее" : "Rebuild future"}<small>{ru ? "Фиксированное и выполненное останется на месте" : "Fixed and completed work stays"}</small></button>
        </div>
        <button className={styles.resetLink} onClick={() => setResetStage(1)}>{ru ? "Обнулить весь план" : "Reset entire planner"}</button>
      </div>
    </ModalFrame>;
  }

  const draftSleepSchedule = scheduleFromDraft(value, parsed.drafts);
  const healthyMinimumNeedsConfirmation = value.sleepMode === "adaptive"
    && Math.max(Number(value.adaptiveMinDuration), Number(value.adaptiveMaxDuration)) < 7 * 60
    && !value.healthyMinimumConfirmed;

  return <ModalFrame title={ru ? "Автопланировщик" : "Autoplanner"} onClose={firstRun ? undefined : onClose}>
    <div className={styles.assistantProgress}><span>{step}/8</span><strong>{currentLabel}</strong><i style={{ width: `${step / 8 * 100}%` }} /></div>
    <div className={styles.assistantBody}>
      {localError && <p className={styles.inlineError}>{localError}</p>}
      {step === 1 && <section className={styles.assistantStep}><h3>{ru ? "Где считать ваше время?" : "Which time zone should be used?"}</h3><p>{ru ? "Он определён автоматически. Проверьте значение." : "It was detected automatically. Confirm it."}</p><label>{ru ? "Часовой пояс" : "Time zone"}<input value={value.timezone} onChange={(event) => { update("timezone", event.target.value); setProfileChanged(true); }} /></label></section>}
      {step === 2 && <section className={styles.assistantStep}>
        <h3>{ru ? "Как поступить со сном?" : "How should sleep be planned?"}</h3>
        <div className={styles.assistantChoices}>
          <button type="button" className={value.sleepMode === "fixed" ? styles.segmentedActive : ""} onClick={() => { update("sleepMode", "fixed"); setProfileChanged(true); }}>{ru ? "У меня есть обычный режим" : "I have a regular schedule"}<small>{ru ? "Укажу точное время и длительность" : "I will provide bedtime and duration"}</small></button>
          <button type="button" className={value.sleepMode === "adaptive" ? styles.segmentedActive : ""} onClick={() => { update("sleepMode", "adaptive"); setProfileChanged(true); }}>{ru ? "Графика нет — сформировать" : "No schedule — build one"}<small>{ru ? "Планировщик создаст пробный здоровый режим" : "Planner creates a cautious trial schedule"}</small></button>
        </div>
        <textarea value={value.sleepText} onChange={(event) => update("sleepText", event.target.value)} placeholder={value.sleepMode === "adaptive" ? (ru ? "Графика нет, мне хватает 7–9 часов, хочу вставать утром" : "No schedule, I need 7–9 hours and prefer mornings") : (ru ? "Обычно ложусь в 23:30 и сплю 8 часов" : "I go to bed at 23:30 and sleep for 8 hours")} />
        <button type="button" onClick={() => void recognizeSleep()}>{ru ? "Распознать фразу" : "Parse phrase"}</button>
        {value.sleepMode === "fixed" ? <div className={styles.formGrid}>
          <label>{ru ? "Перед буднями, отбой" : "Before weekdays"}<input type="time" value={value.weekdayBedtime} onChange={(event) => { update("weekdayBedtime", event.target.value); setProfileChanged(true); }} /></label>
          <label>{ru ? "Сон, минут" : "Sleep minutes"}<input type="number" min="180" max="960" step="15" value={value.weekdayDuration} onChange={(event) => { update("weekdayDuration", event.target.value); setProfileChanged(true); }} /></label>
        </div> : <>
          <div className={styles.formGrid}>
            <label>{ru ? "Обычно хватает, от (часов)" : "Usually enough, from (hours)"}<input type="number" min="3" max="16" step="0.25" value={Number(value.adaptiveMinDuration) / 60} onChange={(event) => { update("adaptiveMinDuration", String(Math.round(Number(event.target.value) * 60))); update("healthyMinimumConfirmed", false); setProfileChanged(true); }} /></label>
            <label>{ru ? "До (часов)" : "To (hours)"}<input type="number" min="3" max="16" step="0.25" value={Number(value.adaptiveMaxDuration) / 60} onChange={(event) => { update("adaptiveMaxDuration", String(Math.round(Number(event.target.value) * 60))); update("healthyMinimumConfirmed", false); setProfileChanged(true); }} /></label>
            <label>{ru ? "После подъёма до первого дела, минут" : "Wake-up preparation, minutes"}<input type="number" min="0" max="240" step="15" value={value.morningPreparationMinutes} onChange={(event) => { update("morningPreparationMinutes", event.target.value); setProfileChanged(true); }} /></label>
          </div>
          <div><p className={styles.fieldTitle}>{ru ? "Когда удобнее вставать?" : "Preferred wake-up part of day"}</p><div className={styles.segmented}>{(["early_morning", "morning", "late_morning"] as const).map((part) => <button type="button" key={part} className={value.wakeDayPart === part ? styles.segmentedActive : ""} onClick={() => { update("wakeDayPart", part); setProfileChanged(true); }}>{part === "early_morning" ? (ru ? "Раннее утро" : "Early morning") : part === "morning" ? (ru ? "Утро" : "Morning") : (ru ? "Ближе к полудню" : "Near noon")}</button>)}</div></div>
          {Math.max(Number(value.adaptiveMinDuration), Number(value.adaptiveMaxDuration)) < 7 * 60 && <label className={styles.choiceCheck}><input type="checkbox" checked={value.healthyMinimumConfirmed} onChange={(event) => update("healthyMinimumConfirmed", event.target.checked)} />{ru ? "Мой диапазон короче 7 часов. Я согласен использовать 7 часов как пробную цель, а не сокращать сон автоматически." : "My range is below 7 hours. Use 7 hours as the trial target instead of shortening sleep automatically."}</label>}
        </>}
      </section>}
      {step === 3 && <section className={styles.assistantStep}>{value.sleepMode === "fixed" ? <>
        <h3>{ru ? "На выходных режим отличается?" : "Is the weekend different?"}</h3>
        <label className={styles.choiceCheck}><input type="checkbox" checked={value.separateWeekend} onChange={(event) => { update("separateWeekend", event.target.checked); setProfileChanged(true); }} />{ru ? "Да, перед субботой и воскресеньем другой режим" : "Yes, use another schedule before Saturday and Sunday"}</label>
        {value.separateWeekend && <div className={styles.formGrid}><label>{ru ? "Отбой" : "Bedtime"}<input type="time" value={value.weekendBedtime} onChange={(event) => { update("weekendBedtime", event.target.value); setProfileChanged(true); }} /></label><label>{ru ? "Сон, минут" : "Sleep minutes"}<input type="number" min="180" max="960" step="15" value={value.weekendDuration} onChange={(event) => { update("weekendDuration", event.target.value); setProfileChanged(true); }} /></label></div>}
      </> : <>
        <h3>{ru ? "Пробный режим сформирован" : "Trial schedule prepared"}</h3>
        {draftSleepSchedule.mode === "adaptive" && <dl className={styles.assistantRecap}>
          <div><dt>{ru ? "Подъём-якорь" : "Wake anchor"}</dt><dd>{draftSleepSchedule.wakeAnchor.localTime}</dd></div>
          <div><dt>{ru ? "Цель сна" : "Sleep target"}</dt><dd>{Math.round(draftSleepSchedule.targetDurationMinutes / 6) / 10} {ru ? "ч" : "h"}</dd></div>
          <div><dt>{ru ? "Ваш диапазон" : "Your range"}</dt><dd>{Math.round(draftSleepSchedule.durationRange.minMinutes / 6) / 10}–{Math.round(draftSleepSchedule.durationRange.maxMinutes / 6) / 10} {ru ? "ч" : "h"}</dd></div>
          <div><dt>{ru ? "Возврат после сбоя" : "Return after disruption"}</dt><dd>{ru ? "не быстрее 60 мин/день" : "up to 60 min/day"}</dd></div>
        </dl>}
        <p>{ru ? "Это осторожная стартовая настройка, а не медицинская рекомендация. Утренние обязательства из следующего шага смогут сдвинуть подъём раньше." : "This is a cautious starting point, not medical advice. Morning commitments from the next step may move the anchor earlier."}</p>
      </>}</section>}
      {step === 4 && <section className={styles.assistantStep}><h3>{ru ? "Постоянные обязательства и routines" : "Commitments and routines"}</h3><p>{ru ? "Каждое правило с новой строки. Указывайте дни и время обычными словами." : "Put each rule on its own line and include days and times."}</p><textarea value={value.commitments} onChange={(event) => update("commitments", event.target.value)} placeholder={ru ? "По будням работа с 10 до 18\nКаждый день английский 30 минут" : "Work weekdays from 10 to 18\nEnglish every day for 30 minutes"} /></section>}
      {step === 5 && <section className={styles.assistantStep}><h3>{ru ? "Когда вы продуктивнее всего?" : "When are you most productive?"}</h3><div className={styles.segmented}>{(["morning", "day", "evening"] as const).map((energy) => <button type="button" key={energy} className={value.energy === energy ? styles.segmentedActive : ""} onClick={() => { update("energy", energy); setProfileChanged(true); }}>{energy === "morning" ? (ru ? "После подъёма" : "After waking") : energy === "day" ? (ru ? "Днём" : "Day") : (ru ? "Вечером" : "Evening")}</button>)}</div><label>{ru ? "Оставлять свободным, %" : "Protected free time, %"}<input type="number" min="0" max="60" value={value.reserve} onChange={(event) => { update("reserve", event.target.value); setProfileChanged(true); }} /></label></section>}
      {step === 6 && <section className={styles.assistantStep}><h3>{ru ? "Выпишите все дела" : "List everything you need to do"}</h3><p>{ru ? "Одно дело на строку. Добавляйте длительность, дедлайн и важность, если знаете." : "One item per line. Add duration, deadline and importance when known."}</p><textarea className={styles.taskTextarea} value={value.tasks} onChange={(event) => update("tasks", event.target.value)} placeholder={ru ? "Подготовить отчёт 2 часа до пятницы, важно\nКупить продукты завтра 40 минут" : "Prepare report for 2 hours by Friday, important\nBuy groceries tomorrow, 40 minutes"} /></section>}
      {step === 7 && <section className={styles.assistantStep}><h3>{ru ? "Проверьте распознанные дела" : "Review parsed items"}</h3>{parsed.ambiguities.length > 0 && <div className={styles.ambiguities}>{parsed.ambiguities.map((entry, index) => <p key={`${entry.index}-${entry.field}-${index}`}>#{entry.index + 1}: {ru ? entry.message : entry.field === "duration" ? "Duration was not specified; 1 hour is shown for confirmation." : entry.field === "date" ? "Date was not specified; today is shown for confirmation." : entry.field === "time" ? "A fixed event needs both start and end time." : "Review this field before continuing."}</p>)}<label className={styles.choiceCheck}><input type="checkbox" checked={ambiguitiesConfirmed} onChange={(event) => setAmbiguitiesConfirmed(event.target.checked)} />{ru ? "Я проверил отмеченные поля и подтверждаю их" : "I reviewed and confirm the marked fields"}</label></div>}<div className={styles.reviewTable}>{parsed.drafts.map((draft, index) => <article key={index}><input aria-label={ru ? "Название" : "Title"} value={draft.title} onChange={(event) => updateParsed(index, { title: event.target.value })} /><select aria-label={ru ? "Вид" : "Kind"} value={draft.kind} onChange={(event) => updateParsed(index, { kind: event.target.value as PlannerDraft["kind"] })}><option value="flexible_task">{ru ? "Гибкая задача" : "Flexible"}</option><option value="fixed_event">{ru ? "Фиксированное" : "Fixed"}</option><option value="routine">Routine</option></select><input aria-label={ru ? "Длительность" : "Duration"} type="number" min="5" value={draft.estimateMinutes ?? 60} onChange={(event) => updateParsed(index, { estimateMinutes: Number(event.target.value) })} /><input aria-label={ru ? "Дата" : "Date"} type="date" value={draft.date ?? ""} onChange={(event) => updateParsed(index, { date: event.target.value })} /><input aria-label={ru ? "Начало" : "Start"} type="time" value={draft.start ?? ""} onChange={(event) => updateParsed(index, { start: event.target.value || undefined })} /><input aria-label={ru ? "Конец" : "End"} type="time" value={draft.end ?? ""} onChange={(event) => updateParsed(index, { end: event.target.value || undefined })} /><select aria-label={ru ? "Приоритет" : "Priority"} value={draft.priority ?? "normal"} onChange={(event) => updateParsed(index, { priority: event.target.value as PlannerDraft["priority"] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select><button type="button" aria-label={ru ? "Удалить строку" : "Remove row"} onClick={() => setParsed((current) => ({ ...current, drafts: current.drafts.filter((_, candidate) => candidate !== index) }))}>×</button></article>)}</div>{parsed.drafts.length === 0 && <p>{ru ? "Новых дел нет — можно обновить только настройки." : "There are no new items; settings can still be updated."}</p>}</section>}
      {step === 8 && <section className={styles.assistantStep}><h3>{ru ? "Готово к предпросмотру" : "Ready for preview"}</h3><dl className={styles.assistantRecap}><div><dt>{ru ? "Часовой пояс" : "Time zone"}</dt><dd>{value.timezone}</dd></div><div><dt>{ru ? "Сон" : "Sleep"}</dt><dd>{draftSleepSchedule.mode === "adaptive" ? `${ru ? "адаптивный" : "adaptive"} · ${draftSleepSchedule.wakeAnchor.localTime} · ${Math.round(draftSleepSchedule.targetDurationMinutes / 6) / 10} ${ru ? "ч" : "h"}` : `${draftSleepSchedule.weekdays.bedtime} · ${draftSleepSchedule.weekdays.durationMinutes} ${ru ? "мин" : "min"}`}</dd></div><div><dt>{ru ? "Новых дел" : "New items"}</dt><dd>{parsed.drafts.length}</dd></div><div><dt>{ru ? "Резерв" : "Reserve"}</dt><dd>{value.reserve}%</dd></div></dl><p>{ru ? "Следующий экран покажет каждый перенос, защищённый сон и конфликт. Ничего ещё не будет применено." : "The next screen shows every move, protected sleep block and conflict. Nothing is applied yet."}</p></section>}
      <div className={styles.assistantFooter}>
        <button type="button" disabled={busy} onClick={() => step > 1 ? setStep(step - 1) : firstRun ? undefined : setStep(0)}>{ru ? "Назад" : "Back"}</button>
        {step < 6 && <button type="button" className={styles.primaryButton} disabled={busy || healthyMinimumNeedsConfirmation} onClick={() => setStep(step + 1)}>{ru ? "Дальше" : "Next"}</button>}
        {step === 6 && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void recognizeTasks()}>{ru ? "Распознать список" : "Parse list"}</button>}
        {step === 7 && <button type="button" className={styles.primaryButton} disabled={busy || (parsed.ambiguities.length > 0 && !ambiguitiesConfirmed)} onClick={() => setStep(8)}>{ru ? "К итогу" : "Continue"}</button>}
        {step === 8 && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void prepare()}>{ru ? "Показать изменения" : "Review changes"}</button>}
      </div>
    </div>
  </ModalFrame>;
}
