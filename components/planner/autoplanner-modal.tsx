"use client";

import { useEffect, useMemo, useState } from "react";

import type { Locale } from "@/lib/i18n";
import CommitmentsEditor from "@/components/planner/commitments-editor";
import DurationInput from "@/components/planner/duration-input";
import {
  commitmentToPlannerDraft,
  normalizeStructuredCommitment,
  plannerDraftToCommitment,
  type PlannerStructuredCommitment,
  type PlannerTravelEstimateInput,
  type PlannerTravelEstimateResult,
} from "@/lib/planner/commitments";
import { createRuntimeId } from "@/lib/runtime-id";
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
  type PlannerWakeAnchorReason,
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
  adaptiveDurationMode: "range" | "exact";
  adaptiveExactDurations: number[];
  planningFocus: "sleep" | "work";
  wakeDayPart: PlannerWakeDayPart;
  morningPreparationMinutes: string;
  healthyMinimumConfirmed: boolean;
  commitments: PlannerStructuredCommitment[];
  energy: "auto" | "morning" | "day" | "evening";
  reserve: string;
  tasks: string;
};

const STORAGE_KEY = "itemkey.planner.autoplanner.v3";
const LEGACY_STORAGE_KEY = "itemkey.planner.autoplanner.v2";

function initialDraft(profile: PlannerProfile, neutralEnergy = false): AssistantDraft {
  const fixed = fixedScheduleView(profile.sleepSchedule);
  const adaptive = profile.sleepSchedule.mode === "adaptive" ? profile.sleepSchedule : undefined;
  const highEnergy = profile.energyWindows.find((window) => window.energy === "high");
  const wakeMinute = plannerTimeToMinutes(fixed.weekdays.bedtime) + fixed.weekdays.durationMinutes;
  const highEnergyOffset = highEnergy
    ? (plannerTimeToMinutes(highEnergy.start) - wakeMinute + 24 * 60) % (24 * 60)
    : undefined;
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
    adaptiveDurationMode: adaptive?.durationPreference.mode ?? "range",
    adaptiveExactDurations: adaptive?.durationPreference.mode === "exact"
      ? adaptive.durationPreference.optionsMinutes
      : [7 * 60, 9 * 60],
    planningFocus: profile.planningPolicy.focus,
    wakeDayPart: adaptive?.wakeAnchor.dayPart ?? "morning",
    morningPreparationMinutes: String(adaptive?.morningPreparationMinutes ?? 60),
    healthyMinimumConfirmed: !adaptive?.requiresHealthyMinimumConfirmation,
    commitments: [],
    energy: neutralEnergy || highEnergyOffset === undefined ? "auto" : highEnergyOffset < 3 * 60 ? "morning" : highEnergyOffset < 8 * 60 ? "day" : "evening",
    reserve: String(Math.round(profile.reserveRatio * 100)),
    tasks: "",
  };
}

function scheduleFromDraft(value: AssistantDraft, commitments: PlannerDraft[] = []): PlannerSleepSchedule {
  if (value.sleepMode === "adaptive") {
    return createAdaptiveSleepSchedule({
      minMinutes: Number(value.adaptiveMinDuration) || 7 * 60,
      maxMinutes: Number(value.adaptiveMaxDuration) || 9 * 60,
      exactDurationsMinutes: value.adaptiveDurationMode === "exact" ? value.adaptiveExactDurations : undefined,
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
  if (value.energy === "auto") return [];
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

const WAKE_OPTIONS: Array<{
  value: PlannerWakeDayPart;
  ru: { title: string; detail: string };
  en: { title: string; detail: string };
}> = [
  { value: "early_morning", ru: { title: "Раннее утро", detail: "06:30–08:00 · ориентир 07:30" }, en: { title: "Early morning", detail: "06:30–08:00 · starts at 07:30" } },
  { value: "morning", ru: { title: "Утро", detail: "08:00–10:00 · ориентир 09:00" }, en: { title: "Morning", detail: "08:00–10:00 · starts at 09:00" } },
  { value: "late_morning", ru: { title: "Ближе к полудню", detail: "10:00–12:00 · ориентир 11:00" }, en: { title: "Near noon", detail: "10:00–12:00 · starts at 11:00" } },
  { value: "auto", ru: { title: "Без разницы — выбери сам", detail: "Стабильный подъём по обязательствам и нагрузке" }, en: { title: "No preference — choose for me", detail: "A stable wake time based on commitments and workload" } },
];

function wakeReasonText(reason: PlannerWakeAnchorReason | undefined, ru: boolean): string {
  if (!reason) return ru ? "Время выбрано как осторожная стартовая точка." : "This time is a cautious starting point.";
  if (reason.code === "recurring_commitment") return ru
    ? `Подъём сдвинут раньше из-за постоянного дела${reason.relatedTitle ? ` «${reason.relatedTitle}»` : ""}${reason.relatedTime ? ` в ${reason.relatedTime}` : ""} и времени на подготовку.`
    : `Wake-up moved earlier for the recurring commitment${reason.relatedTitle ? ` “${reason.relatedTitle}”` : ""}${reason.relatedTime ? ` at ${reason.relatedTime}` : ""} and preparation time.`;
  if (reason.code === "plan_fit") return ru
    ? `Это время оставляет больше подходящих окон для дел${reason.relatedTitle ? `, включая «${reason.relatedTitle}»` : ""}, без ежедневных скачков режима.`
    : `This time leaves better task slots${reason.relatedTitle ? `, including “${reason.relatedTitle}”` : ""}, without daily schedule jumps.`;
  if (reason.code === "fixed_conflict") return ru
    ? "Безопасного варианта пока нет: защищённый сон конфликтует с постоянным обязательством. Конфликт будет показан перед применением."
    : "There is no safe option yet: protected sleep conflicts with a recurring commitment. The conflict will be shown before applying.";
  if (reason.code === "auto_default") return ru
    ? "Пока нет условий, требующих другого времени, поэтому выбран нейтральный устойчивый ориентир 09:00."
    : "Nothing currently requires another time, so the stable neutral starting point is 09:00.";
  return ru
    ? "Выбран ориентир внутри указанного вами диапазона; постоянные утренние дела могут сдвинуть его раньше."
    : "The anchor is inside your selected range; recurring morning commitments may move it earlier.";
}

function ModalFrame({ title, children, onClose, locale }: { title: string; children: React.ReactNode; onClose?: () => void; locale: Locale }) {
  return <div className={styles.modalBackdrop} role="presentation"><section className={`${styles.modal} ${styles.assistantModal}`} role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2>{onClose && <button type="button" onClick={onClose} aria-label={locale === "ru" ? "Закрыть" : "Close"}>×</button>}</header>
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
  upgradeOnly,
  busy,
  onClose,
  onParseTasks,
  onEstimateTravel,
  onParseSleep,
  onPrepare,
  requestError,
  onClearRequestError,
  onOpenSleep,
  onReset,
}: {
  profile: PlannerProfile;
  items: PlannerItem[];
  blocksCount: number;
  sleepEventsCount: number;
  locale: Locale;
  firstRun: boolean;
  upgradeOnly?: boolean;
  busy: boolean;
  onClose?: () => void;
  onParseTasks: (text: string) => Promise<PlannerAssistantParseResult>;
  onEstimateTravel: (input: PlannerTravelEstimateInput) => Promise<PlannerTravelEstimateResult>;
  onParseSleep: (text: string) => Promise<PlannerSleepParseResult>;
  onPrepare: (input: PlannerProposalInput) => Promise<void>;
  requestError?: string | null;
  onClearRequestError: () => void;
  onOpenSleep: () => void;
  onReset: (password: string) => Promise<void>;
}) {
  const ru = locale === "ru";
  const [step, setStep] = useState(upgradeOnly ? 2 : firstRun ? 1 : 0);
  const [value, setValue] = useState<AssistantDraft>(() => initialDraft(profile, firstRun));
  const [parsed, setParsed] = useState<PlannerAssistantParseResult>({ drafts: [], ambiguities: [] });
  const [localError, setLocalError] = useState("");
  const [profileChanged, setProfileChanged] = useState(firstRun);
  const [resetStage, setResetStage] = useState<0 | 1 | 2>(0);
  const [password, setPassword] = useState("");
  const [ambiguitiesConfirmed, setAmbiguitiesConfirmed] = useState(false);
  const [commitmentEditorOpen, setCommitmentEditorOpen] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved && firstRun) {
        const restored = JSON.parse(saved) as Partial<AssistantDraft>;
        timer = window.setTimeout(() => setValue((current) => ({
          ...current,
          ...restored,
          energy: restored.energy === "morning" || restored.energy === "day" || restored.energy === "evening"
            ? restored.energy
            : "auto",
          commitments: Array.isArray(restored.commitments)
            ? restored.commitments.flatMap((commitment) => commitment?.id && commitment?.title
              ? [normalizeStructuredCommitment(commitment)]
              : [])
            : [],
        })), 0);
      }
    } catch { /* a draft is optional */ }
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [firstRun]);
  useEffect(() => {
    if (!firstRun) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }, [firstRun, value]);

  const labels = ru
    ? ["Сводка", "Часовой пояс", "Сон", "Пробный режим", "Все дела", "Продуктивность", "Проверка", "Итог"]
    : ["Summary", "Time zone", "Sleep", "Trial schedule", "All items", "Productivity", "Review", "Result"];
  const currentLabel = labels[step] ?? labels[0];
  const commitmentDrafts = useMemo(
    () => value.commitments.map((commitment) => commitmentToPlannerDraft(commitment, locale, value.timezone)),
    [locale, value.commitments, value.timezone]
  );
  const planningDrafts = commitmentDrafts;

  const profilePatch = useMemo<Partial<PlannerProfile>>(() => {
    const sleepSchedule = scheduleFromDraft(value, planningDrafts);
    return {
      timezone: value.timezone,
      sleepSchedule,
      availability: availabilityFromSleepSchedule(sleepSchedule),
      energyWindows: energyWindows(value, planningDrafts),
      reserveRatio: Math.min(0.6, Math.max(0, Number(value.reserve) / 100 || 0.2)),
      planningPolicy: { ...profile.planningPolicy, focus: value.planningFocus },
      assistantSetupVersion: 4,
      onboardingCompleted: true,
    };
  }, [planningDrafts, profile.planningPolicy, value]);

  const update = <K extends keyof AssistantDraft>(key: K, next: AssistantDraft[K]) => setValue((current) => ({ ...current, [key]: next }));

  async function recognizeSleep() {
    setLocalError("");
    try {
      const result = await onParseSleep(value.sleepText);
      if (result.mode) update("sleepMode", result.mode);
      if (result.bedtime) update("weekdayBedtime", result.bedtime);
      if (result.durationMinutes) update("weekdayDuration", String(result.durationMinutes));
      if (result.durationRange) {
        update("adaptiveDurationMode", "range");
        update("adaptiveMinDuration", String(result.durationRange.minMinutes));
        update("adaptiveMaxDuration", String(result.durationRange.maxMinutes));
        update("healthyMinimumConfirmed", false);
      }
      if (result.exactDurationsMinutes?.length) {
        update("adaptiveDurationMode", "exact");
        update("adaptiveExactDurations", result.exactDurationsMinutes);
        update("healthyMinimumConfirmed", result.exactDurationsMinutes.some((minutes) => minutes >= 7 * 60));
      }
      if (result.planningFocus) update("planningFocus", result.planningFocus);
      if (result.wakeDayPart) update("wakeDayPart", result.wakeDayPart);
      if (result.ambiguities.length) setLocalError(ru
        ? result.ambiguities.join(" ")
        : "Confirm both the regular bedtime and the usual sleep duration below.");
      setProfileChanged(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Не удалось распознать сон.");
    }
  }

  async function recognizeTasks(): Promise<boolean> {
    setLocalError("");
    if (!value.tasks.trim()) return true;
    try {
      const taskResult = await onParseTasks(value.tasks);
      const imported = taskResult.drafts.map((draft) => plannerDraftToCommitment(
        draft,
        value.timezone,
        createRuntimeId()
      ));
      const baseIndex = value.commitments.length;
      setValue((current) => ({
        ...current,
        tasks: "",
        commitments: [...current.commitments, ...imported],
      }));
      setParsed((current) => ({
        drafts: [],
        ambiguities: [
          ...current.ambiguities,
          ...taskResult.ambiguities.map((entry) => ({ ...entry, index: entry.index + baseIndex })),
        ],
      }));
      setAmbiguitiesConfirmed(false);
      return true;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Не удалось разобрать список.");
      return false;
    }
  }

  async function finishItemsStep() {
    if (commitmentEditorOpen) return;
    if (await recognizeTasks()) setStep(5);
  }

  async function prepare() {
    await onPrepare({
      drafts: commitmentDrafts,
      profilePatch: profileChanged || firstRun ? profilePatch : undefined,
      trigger: firstRun ? "assistant_setup" : "assistant_update",
      rebuildFuture: true,
    });
  }

  function goBack() {
    setCommitmentEditorOpen(false);
    if (upgradeOnly && step === 7) setStep(2);
    else if (step > 1) setStep(step - 1);
    else if (!firstRun) setStep(0);
  }

  if (resetStage > 0) {
    return <ModalFrame title={ru ? "Обнулить план" : "Reset planner"} onClose={() => setResetStage(0)} locale={locale}>
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
    return <ModalFrame title={ru ? "Автопланировщик" : "Autoplanner"} onClose={onClose} locale={locale}>
      <div className={styles.assistantBody}>
        <div className={styles.assistantSummary}>
          <article><span>{ru ? "Активные дела" : "Active items"}</span><strong>{active}</strong></article>
          <article><span>{ru ? "Режим сна" : "Sleep mode"}</span><strong>{profile.sleepSchedule.mode === "adaptive"
            ? `${ru ? "Адаптивный" : "Adaptive"} · ${profile.sleepSchedule.wakeAnchor.localTime} · ${Math.round(profile.sleepSchedule.targetDurationMinutes / 6) / 10} ${ru ? "ч" : "h"}`
            : `${fixed.weekdays.bedtime} · ${Math.round(fixed.weekdays.durationMinutes / 6) / 10} ${ru ? "ч" : "h"}`}</strong></article>
          <article><span>{ru ? "Резерв" : "Reserve"}</span><strong>{Math.round(profile.reserveRatio * 100)}%</strong></article>
        </div>
        <div className={styles.assistantChoices}>
          <button onClick={() => { setProfileChanged(false); setStep(4); }}>{ru ? "Добавить дела" : "Add items"}<small>{ru ? "Подробно или обычным списком" : "Detailed form or a quick list"}</small></button>
          <button onClick={() => { setProfileChanged(true); setStep(2); }}>{ru ? "Изменить режим сна" : "Change sleep mode"}<small>{ru ? "Точный режим или помощь в его формировании" : "Fixed schedule or an adaptive trial mode"}</small></button>
          <button onClick={onOpenSleep}>{ru ? "Сон изменился сегодня" : "Sleep changed today"}<small>{ru ? "Учесть позднее засыпание или подъём" : "Record a late bedtime or wake-up"}</small></button>
          <button onClick={() => { setProfileChanged(false); setStep(4); }}>{ru ? "Все дела и обязательства" : "All items and commitments"}<small>{ru ? "Разовые, регулярные, точные и гибкие" : "One-time, recurring, fixed and flexible"}</small></button>
          <button onClick={() => { setProfileChanged(true); setStep(5); }}>{ru ? "Изменить нагрузку" : "Change workload"}<small>{ru ? "Энергия и резерв времени" : "Energy and protected reserve"}</small></button>
          <button onClick={() => void onPrepare({ trigger: "assistant_update", rebuildFuture: true })}>{ru ? "Пересобрать будущее" : "Rebuild future"}<small>{ru ? "Фиксированное и выполненное останется на месте" : "Fixed and completed work stays"}</small></button>
        </div>
        <button className={styles.resetLink} onClick={() => setResetStage(1)}>{ru ? "Обнулить весь план" : "Reset entire planner"}</button>
      </div>
    </ModalFrame>;
  }

  const draftSleepSchedule = scheduleFromDraft(value, planningDrafts);
  const draftSleepRule = sleepRuleForWakeDate(draftSleepSchedule, "2026-08-17");
  const draftWakeTime = plannerMinutesToTime(plannerTimeToMinutes(draftSleepRule.bedtime) + draftSleepRule.durationMinutes);
  const healthyMinimumNeedsConfirmation = value.sleepMode === "adaptive"
    && (value.adaptiveDurationMode === "exact"
      ? !value.adaptiveExactDurations.some((minutes) => minutes >= 7 * 60)
      : Math.max(Number(value.adaptiveMinDuration), Number(value.adaptiveMaxDuration)) < 7 * 60)
    && !value.healthyMinimumConfirmed;

  return <ModalFrame title={ru ? "Автопланировщик" : "Autoplanner"} onClose={firstRun ? undefined : onClose} locale={locale}>
    <div className={styles.assistantProgress}><span>{upgradeOnly ? (step === 2 ? "1/2" : "2/2") : `${step}/7`}</span><strong>{upgradeOnly ? (ru ? "Новые правила сна и дедлайнов" : "New sleep and deadline rules") : currentLabel}</strong><i style={{ width: upgradeOnly ? `${step === 2 ? 50 : 100}%` : `${step / 7 * 100}%` }} /></div>
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
        <p className={styles.fieldHelp}>{ru ? "Можно описать режим обычной фразой или заполнить точные поля ниже. После распознавания всё останется доступно для проверки." : "Describe your sleep in a normal sentence or use the exact fields below. Parsed values always remain editable."}</p>
        <button type="button" onClick={() => void recognizeSleep()}>{ru ? "Распознать фразу" : "Parse phrase"}</button>
        {value.sleepMode === "fixed" ? <div className={styles.formGrid}>
          <label>{ru ? "Перед буднями, отбой" : "Before weekdays"}<input type="time" value={value.weekdayBedtime} onChange={(event) => { update("weekdayBedtime", event.target.value); setProfileChanged(true); }} /></label>
          <DurationInput label={ru ? "Длительность сна" : "Sleep duration"} valueMinutes={value.weekdayDuration} minMinutes={180} maxMinutes={960} minuteStep={15} locale={locale} onChangeMinutes={(minutes) => { update("weekdayDuration", String(minutes)); setProfileChanged(true); }} />
        </div> : <>
          <div className={styles.fieldExplanation}><strong>{ru ? "Предпочтительная длительность сна" : "Preferred sleep duration"}</strong><p>{ru ? "Выберите диапазон или перечислите точные варианты, например 7 и 9 часов. Это желательные значения: фактические 6, 8 или 10 часов сохраняются как факт и не считаются ошибкой сами по себе." : "Choose a range or list exact options, such as 7 and 9 hours. These are preferences; an actual 6, 8 or 10 hours is still stored as a normal fact."}</p></div>
          <div className={styles.segmented} role="group" aria-label={ru ? "Способ задания длительности" : "Duration input mode"}>
            <button type="button" className={value.adaptiveDurationMode === "range" ? styles.segmentedActive : ""} onClick={() => { update("adaptiveDurationMode", "range"); setProfileChanged(true); }}>{ru ? "Диапазон" : "Range"}</button>
            <button type="button" className={value.adaptiveDurationMode === "exact" ? styles.segmentedActive : ""} onClick={() => { update("adaptiveDurationMode", "exact"); setProfileChanged(true); }}>{ru ? "Точные варианты" : "Exact options"}</button>
          </div>
          {value.adaptiveDurationMode === "range" ? <div className={styles.formGrid}>
            <DurationInput label={ru ? "Обычно хватает, от" : "Usually enough, from"} valueMinutes={value.adaptiveMinDuration} minMinutes={180} maxMinutes={960} minuteStep={15} locale={locale} onChangeMinutes={(minutes) => { update("adaptiveMinDuration", String(minutes)); update("healthyMinimumConfirmed", false); setProfileChanged(true); }} />
            <DurationInput label={ru ? "До" : "To"} valueMinutes={value.adaptiveMaxDuration} minMinutes={180} maxMinutes={960} minuteStep={15} locale={locale} onChangeMinutes={(minutes) => { update("adaptiveMaxDuration", String(minutes)); update("healthyMinimumConfirmed", false); setProfileChanged(true); }} />
          </div> : <div className={styles.exactDurations}>
            {value.adaptiveExactDurations.map((minutes, index) => <div key={`${minutes}-${index}`}>
              <DurationInput label={ru ? `Вариант ${index + 1}` : `Option ${index + 1}`} valueMinutes={minutes} minMinutes={180} maxMinutes={960} minuteStep={15} locale={locale} onChangeMinutes={(durationMinutes) => { const next = [...value.adaptiveExactDurations]; next[index] = durationMinutes; update("adaptiveExactDurations", Array.from(new Set(next)).sort((left, right) => left - right).slice(0, 6)); setProfileChanged(true); }} />
              {value.adaptiveExactDurations.length > 1 && <button type="button" onClick={() => { update("adaptiveExactDurations", value.adaptiveExactDurations.filter((_, candidate) => candidate !== index)); setProfileChanged(true); }}>{ru ? "Удалить" : "Remove"}</button>}
            </div>)}
            <button type="button" disabled={value.adaptiveExactDurations.length >= 6} onClick={() => { const last = value.adaptiveExactDurations.at(-1) ?? 7 * 60; update("adaptiveExactDurations", Array.from(new Set([...value.adaptiveExactDurations, Math.min(16 * 60, last + 60)])).sort((left, right) => left - right)); setProfileChanged(true); }}>+ {ru ? "Добавить длительность" : "Add duration"}</button>
            <small>{ru ? "До шести уникальных вариантов с шагом 15 минут. Хотя бы один вариант должен быть не короче 7 часов." : "Up to six unique 15-minute options. At least one option must be 7 hours or longer."}</small>
          </div>}
          <div className={styles.formGrid}><div><DurationInput label={ru ? "После подъёма до первого дела" : "Wake-up preparation"} valueMinutes={value.morningPreparationMinutes} maxMinutes={240} minuteStep={15} locale={locale} onChangeMinutes={(minutes) => { update("morningPreparationMinutes", String(minutes)); setProfileChanged(true); }} /><small>{ru ? "Душ, еда, дорога и другое время, когда ещё нельзя ставить дела." : "Shower, food, travel and any other time before work can begin."}</small></div></div>
          <div className={styles.fieldExplanation}><strong>{ru ? "Что важнее при реальном конфликте?" : "What wins in a real conflict?"}</strong><p>{ru ? "«Сон важнее» всегда выбирает самый длинный точный вариант и не двигает сон ради задач. «Дедлайны важнее» сначала переносит дела и использует резерв, затем может выбрать более короткий допустимый вариант; сон короче 7 часов рассматривается только ради жёсткого срока и всегда с восстановительным предпросмотром." : "Sleep priority always uses the longest exact option. Deadline priority first moves work and uses reserve, then may choose a shorter allowed option; going below 7 hours is only considered for a hard deadline with a recovery preview."}</p></div>
          <div className={styles.assistantChoices}>
            <button type="button" className={value.planningFocus === "sleep" ? styles.segmentedActive : ""} onClick={() => { update("planningFocus", "sleep"); setProfileChanged(true); }}>{ru ? "Сон важнее" : "Sleep first"}<small>{ru ? "Сон — абсолютное ограничение" : "Sleep is an absolute constraint"}</small></button>
            <button type="button" className={value.planningFocus === "work" ? styles.segmentedActive : ""} onClick={() => { update("planningFocus", "work"); setProfileChanged(true); }}>{ru ? "Дедлайны важнее" : "Deadlines first"}<small>{ru ? "Иногда короче, затем восстановление" : "Sometimes shorter, followed by recovery"}</small></button>
          </div>
          <div><p className={styles.fieldTitle}>{ru ? "Когда удобнее вставать?" : "When is waking up most comfortable?"}</p><p className={styles.fieldHelp}>{ru ? "Это предпочтительный диапазон, а не жёсткий будильник. Конкретный подъём будет показан и объяснён перед применением." : "This is a preferred range, not a strict alarm. The exact wake time will be shown and explained before anything is applied."}</p><div className={styles.wakeChoices}>{WAKE_OPTIONS.map((option) => {
            const copy = ru ? option.ru : option.en;
            return <button type="button" key={option.value} className={value.wakeDayPart === option.value ? styles.segmentedActive : ""} aria-pressed={value.wakeDayPart === option.value} onClick={() => { update("wakeDayPart", option.value); setProfileChanged(true); }}><strong>{copy.title}</strong><small>{copy.detail}</small></button>;
          })}</div></div>
          <div className={styles.wakePreview} aria-live="polite"><span>{ru ? "Предварительный режим" : "Preliminary schedule"}</span><strong>{ru ? "Подъём" : "Wake"} {draftWakeTime} · {ru ? "сон с" : "sleep from"} {draftSleepRule.bedtime}</strong><p>{wakeReasonText(draftSleepSchedule.mode === "adaptive" ? draftSleepSchedule.wakeAnchor.selectionReason : undefined, ru)}</p>{value.wakeDayPart === "auto" && <small>{ru ? "Окончательный автовыбор появится после анализа постоянных обязательств и списка дел." : "The final automatic choice appears after recurring commitments and tasks are analyzed."}</small>}</div>
          {healthyMinimumNeedsConfirmation && <label className={styles.choiceCheck}><input type="checkbox" checked={value.healthyMinimumConfirmed} onChange={(event) => update("healthyMinimumConfirmed", event.target.checked)} />{ru ? "Все указанные варианты короче 7 часов. Я согласен использовать 7 часов как пробную цель; для регулярного более короткого сна перейду в ручной режим." : "All options are below 7 hours. Use 7 hours as a trial target; regular shorter sleep requires manual mode."}</label>}
        </>}
      </section>}
      {step === 3 && <section className={styles.assistantStep}>{value.sleepMode === "fixed" ? <>
        <h3>{ru ? "На выходных режим отличается?" : "Is the weekend different?"}</h3>
        <label className={styles.choiceCheck}><input type="checkbox" checked={value.separateWeekend} onChange={(event) => { update("separateWeekend", event.target.checked); setProfileChanged(true); }} />{ru ? "Да, перед субботой и воскресеньем другой режим" : "Yes, use another schedule before Saturday and Sunday"}</label>
        {value.separateWeekend && <div className={styles.formGrid}><label>{ru ? "Отбой" : "Bedtime"}<input type="time" value={value.weekendBedtime} onChange={(event) => { update("weekendBedtime", event.target.value); setProfileChanged(true); }} /></label><DurationInput label={ru ? "Длительность сна" : "Sleep duration"} valueMinutes={value.weekendDuration} minMinutes={180} maxMinutes={960} minuteStep={15} locale={locale} onChangeMinutes={(minutes) => { update("weekendDuration", String(minutes)); setProfileChanged(true); }} /></div>}
      </> : <>
        <h3>{ru ? "Пробный режим сформирован" : "Trial schedule prepared"}</h3>
        {draftSleepSchedule.mode === "adaptive" && <dl className={styles.assistantRecap}>
          <div><dt>{ru ? "Подъём-якорь" : "Wake anchor"}</dt><dd>{draftSleepSchedule.wakeAnchor.localTime}</dd></div>
          <div><dt>{ru ? "Отход ко сну" : "Bedtime"}</dt><dd>{draftSleepRule.bedtime}</dd></div>
          <div><dt>{ru ? "Цель сна" : "Sleep target"}</dt><dd>{Math.round(draftSleepSchedule.targetDurationMinutes / 6) / 10} {ru ? "ч" : "h"}</dd></div>
          <div><dt>{draftSleepSchedule.durationPreference.mode === "exact" ? (ru ? "Точные варианты" : "Exact options") : (ru ? "Ваш диапазон" : "Your range")}</dt><dd>{draftSleepSchedule.durationPreference.mode === "exact" ? draftSleepSchedule.durationPreference.optionsMinutes.map((minutes) => `${Math.round(minutes / 6) / 10} ${ru ? "ч" : "h"}`).join(" · ") : `${Math.round(draftSleepSchedule.durationRange.minMinutes / 6) / 10}–${Math.round(draftSleepSchedule.durationRange.maxMinutes / 6) / 10} ${ru ? "ч" : "h"}`}</dd></div>
          <div><dt>{ru ? "Основной приоритет" : "Planning priority"}</dt><dd>{value.planningFocus === "sleep" ? (ru ? "Сон важнее" : "Sleep first") : (ru ? "Дедлайны важнее" : "Deadlines first")}</dd></div>
          <div><dt>{ru ? "Возврат после сбоя" : "Return after disruption"}</dt><dd>{ru ? "не быстрее 60 мин/день" : "up to 60 min/day"}</dd></div>
        </dl>}
        {draftSleepSchedule.mode === "adaptive" && <div className={styles.fieldExplanation}><strong>{ru ? "Почему так" : "Why this time"}</strong><p>{wakeReasonText(draftSleepSchedule.wakeAnchor.selectionReason, ru)}</p></div>}
        <p>{ru ? "Это осторожная стартовая настройка, а не медицинская рекомендация. Утренние обязательства из следующего шага смогут сдвинуть подъём раньше." : "This is a cautious starting point, not medical advice. Morning commitments from the next step may move the anchor earlier."}</p>
      </>}</section>}
      {step === 4 && <section className={`${styles.assistantStep} ${styles.commitmentsStep}`}>
        <h3>{ru ? "Все дела и обязательства" : "All items and commitments"}</h3>
        <p>{ru ? "Добавляйте разовые и регулярные дела. Точное время можно указать, а можно оставить только длительность — тогда сайт сам подберёт начало и время выезда." : "Add one-time and recurring items. Enter an exact time or only a duration and let the planner choose the start and departure time."}</p>
        <div className={styles.fieldExplanation}><strong>{ru ? "Как это повлияет на план" : "How this changes the plan"}</strong><p>{ru ? "Дело, дорога туда и выбранная обратная дорога будут защищены от других задач. Необязательный интервал ограничивает время самого дела." : "The item, outbound travel and an optional return trip are protected from other tasks. An optional window limits the item itself."}</p></div>
        <CommitmentsEditor commitments={value.commitments} locale={locale} onChange={(commitments) => update("commitments", commitments)} onEstimateTravel={onEstimateTravel} onEditingChange={setCommitmentEditorOpen} />
        {!commitmentEditorOpen && <details className={styles.advanced}>
          <summary>{ru ? "Быстро добавить несколько дел списком" : "Quickly add several items as a list"}</summary>
          <p>{ru ? "Одно дело — одна строка. После распознавания каждое появится выше отдельной редактируемой карточкой." : "Use one item per line. Each parsed item appears above as an editable card."}</p>
          <textarea className={styles.taskTextarea} value={value.tasks} onChange={(event) => update("tasks", event.target.value)} placeholder={ru ? "Подготовить отчёт 2 часа до пятницы, важно\nКупить продукты завтра 40 минут" : "Prepare report for 2 hours by Friday, important\nBuy groceries tomorrow, 40 minutes"} />
          <button type="button" className={styles.primaryButton} disabled={busy || !value.tasks.trim()} onClick={() => void recognizeTasks()}>{ru ? "Распознать и добавить" : "Parse and add"}</button>
        </details>}
      </section>}
      {step === 5 && <section className={styles.assistantStep}>
        <h3>{ru ? "Когда вам удобнее решать сложные задачи?" : "When is difficult work easiest?"}</h3>
        <p>{ru ? "Это только мягкое предпочтение. Если подходящего периода нет, выберите «Без разницы» — планировщик не будет отдавать времени суток преимущество." : "This is only a soft preference. Choose “No preference” and the planner will not favor a time of day."}</p>
        <div className={styles.segmented}>{(["auto", "morning", "day", "evening"] as const).map((energy) => <button type="button" key={energy} className={value.energy === energy ? styles.segmentedActive : ""} aria-pressed={value.energy === energy} onClick={() => { update("energy", energy); setProfileChanged(true); }}>{energy === "auto" ? (ru ? "Без разницы — выбери сам" : "No preference — choose for me") : energy === "morning" ? (ru ? "После подъёма" : "After waking") : energy === "day" ? (ru ? "Днём" : "Day") : (ru ? "Вечером" : "Evening")}</button>)}</div>
        <label>{ru ? "Оставлять свободным, %" : "Protected free time, %"}<input type="number" min="0" max="60" value={value.reserve} onChange={(event) => { update("reserve", event.target.value); setProfileChanged(true); }} /><small>{ru ? "Доля доступного времени без автозадач. 20% помогает пережить задержки, отдых и внезапные планы." : "The share of available time kept free from automatic tasks. 20% leaves room for delays, rest and unexpected plans."}</small></label>
      </section>}
      {step === 6 && <section className={`${styles.assistantStep} ${styles.commitmentsStep}`}>
        <h3>{ru ? "Проверьте все дела" : "Review all items"}</h3>
        <p>{ru ? "Проверьте длительность, повторение, допустимое время и дорогу. Ничего не создаётся до следующего предпросмотра." : "Review duration, recurrence, allowed time and travel. Nothing is created before the next preview."}</p>
        {parsed.ambiguities.length > 0 && <div className={styles.ambiguities}>{parsed.ambiguities.map((entry, index) => <p key={`${entry.index}-${entry.field}-${index}`}>#{entry.index + 1}: {ru ? entry.message : entry.field === "duration" ? "Duration was not specified; 1 hour is shown for confirmation." : entry.field === "date" ? "Date was not specified; review the selected day." : entry.field === "time" ? "A fixed item needs both start and end time." : "Review this field before continuing."}</p>)}<label className={styles.choiceCheck}><input type="checkbox" checked={ambiguitiesConfirmed} onChange={(event) => setAmbiguitiesConfirmed(event.target.checked)} />{ru ? "Я проверил отмеченные карточки и подтверждаю значения" : "I reviewed the marked cards and confirm their values"}</label></div>}
        <CommitmentsEditor commitments={value.commitments} locale={locale} onChange={(commitments) => update("commitments", commitments)} onEstimateTravel={onEstimateTravel} onEditingChange={setCommitmentEditorOpen} />
        {value.commitments.length === 0 && <p>{ru ? "Новых дел нет — можно обновить только настройки." : "There are no new items; settings can still be updated."}</p>}
      </section>}
      {step === 7 && <section className={styles.assistantStep} aria-busy={busy}><h3>{ru ? "Готово к предпросмотру" : "Ready for preview"}</h3><dl className={styles.assistantRecap}><div><dt>{ru ? "Часовой пояс" : "Time zone"}</dt><dd>{value.timezone}</dd></div><div><dt>{ru ? "Сон" : "Sleep"}</dt><dd>{draftSleepSchedule.mode === "adaptive" ? `${ru ? "адаптивный" : "adaptive"} · ${draftWakeTime} · ${Math.round(draftSleepSchedule.targetDurationMinutes / 6) / 10} ${ru ? "ч" : "h"}` : `${draftSleepSchedule.weekdays.bedtime} · ${draftSleepSchedule.weekdays.durationMinutes} ${ru ? "мин" : "min"}`}</dd></div>{draftSleepSchedule.mode === "adaptive" && <div><dt>{ru ? "Отход ко сну" : "Bedtime"}</dt><dd>{draftSleepRule.bedtime}</dd></div>}<div><dt>{ru ? "Новых дел" : "New items"}</dt><dd>{commitmentDrafts.length}</dd></div><div><dt>{ru ? "Продуктивность" : "Productivity"}</dt><dd>{value.energy === "auto" ? (ru ? "без разницы" : "no preference") : value.energy === "morning" ? (ru ? "после подъёма" : "after waking") : value.energy === "day" ? (ru ? "днём" : "day") : (ru ? "вечером" : "evening")}</dd></div><div><dt>{ru ? "Резерв" : "Reserve"}</dt><dd>{value.reserve}%</dd></div></dl>{draftSleepSchedule.mode === "adaptive" && <div className={styles.fieldExplanation}><strong>{ru ? "Предварительная причина" : "Preliminary reason"}</strong><p>{wakeReasonText(draftSleepSchedule.wakeAnchor.selectionReason, ru)}</p>{value.wakeDayPart === "auto" && <small>{ru ? "На следующем экране движок сначала проверит наиболее подходящие варианты подъёма, затем уточнит лучший с шагом 15 минут." : "The next screen checks the strongest wake-time candidates first, then refines the best one in 15-minute steps."}</small>}</div>}<p>{ru ? "Следующий экран покажет каждый перенос, защищённый сон и конфликт. Ничего ещё не будет применено." : "The next screen shows every move, protected sleep block and conflict. Nothing is applied yet."}</p>{requestError && <div className={styles.requestErrorPanel} role="alert"><strong>{ru ? "Предпросмотр не был создан" : "The preview was not created"}</strong><p>{requestError}</p><small>{ru ? "Введённые дела сохранены в этом мастере. Можно проверить их или повторить расчёт — заполнять всё заново не нужно." : "Your items are still saved in this wizard. Review them or retry; you do not need to enter everything again."}</small><button type="button" onClick={() => { onClearRequestError(); setStep(6); }}>{ru ? "Вернуться к проверке дел" : "Return to item review"}</button></div>}</section>}
      <div className={styles.assistantFooter}>
        <button type="button" disabled={busy} onClick={goBack}>{ru ? "Назад" : "Back"}</button>
        {step < 4 && <button type="button" className={styles.primaryButton} disabled={busy || healthyMinimumNeedsConfirmation} onClick={() => setStep(upgradeOnly && step === 2 ? 7 : step + 1)}>{ru ? "Дальше" : "Next"}</button>}
        {step === 4 && <button type="button" className={styles.primaryButton} disabled={busy || commitmentEditorOpen} onClick={() => void finishItemsStep()}>{commitmentEditorOpen ? (ru ? "Сначала сохраните дело" : "Save the item first") : (ru ? "Дальше" : "Next")}</button>}
        {step === 5 && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => setStep(6)}>{ru ? "К проверке" : "Review items"}</button>}
        {step === 6 && <button type="button" className={styles.primaryButton} disabled={busy || commitmentEditorOpen || (parsed.ambiguities.length > 0 && !ambiguitiesConfirmed)} onClick={() => setStep(7)}>{commitmentEditorOpen ? (ru ? "Сначала сохраните дело" : "Save the item first") : (ru ? "К итогу" : "Continue")}</button>}
        {step === 7 && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => { onClearRequestError(); void prepare(); }}>{busy ? (ru ? "Составляю план…" : "Building plan…") : requestError ? (ru ? "Повторить расчёт" : "Retry") : (ru ? "Показать изменения" : "Review changes")}</button>}
      </div>
    </div>
  </ModalFrame>;
}
