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
import {
  availabilityFromSleepSchedule,
  createAdaptiveSleepSchedule,
  fixedScheduleView,
  sleepRuleForWakeDate,
} from "@/lib/planner/sleep";
import {
  type PlannerBlock,
  type PlannerDraft,
  type PlannerEnergyWindow,
  type PlannerItem,
  type PlannerProfile,
  type PlannerProposalInput,
  type PlannerSleepSchedule,
  type PlannerSleepClockPreference,
  type PlannerWakeAnchorReason,
  type PlannerWakeDayPart,
} from "@/lib/planner/types";
import { formatDateInTimeZone, formatTimeInTimeZone, plannerMinutesToTime, plannerTimeToMinutes } from "@/lib/planner/time";
import styles from "./planner-workspace.module.css";

type SleepClockDraft = {
  mode: PlannerSleepClockPreference["mode"];
  time: string;
  toleranceMinutes: string;
  notBefore: string;
  notAfter: string;
};

type AssistantDraft = {
  timezone: string;
  sleepMode: "fixed" | "adaptive";
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
  bedtimeClock: SleepClockDraft;
  wakeClock: SleepClockDraft;
  weekendBedtimeClock: SleepClockDraft;
  weekendWakeClock: SleepClockDraft;
  windDownMinutes: string;
  morningPreparationMinutes: string;
  healthyMinimumConfirmed: boolean;
  commitments: PlannerStructuredCommitment[];
  energy: "auto" | "morning" | "day" | "evening";
  reserve: string;
};

const STORAGE_KEY = "itemkey.planner.autoplanner.v4";
const LEGACY_STORAGE_KEY = "itemkey.planner.autoplanner.v2";

function initialDraft(
  profile: PlannerProfile,
  neutralEnergy = false,
  commitments: PlannerStructuredCommitment[] = []
): AssistantDraft {
  const fixed = fixedScheduleView(profile.sleepSchedule);
  const adaptive = profile.sleepSchedule.mode === "adaptive" ? profile.sleepSchedule : undefined;
  const highEnergy = profile.energyWindows.find((window) => window.energy === "high");
  const wakeMinute = plannerTimeToMinutes(fixed.weekdays.bedtime) + fixed.weekdays.durationMinutes;
  const highEnergyOffset = highEnergy
    ? (plannerTimeToMinutes(highEnergy.start) - wakeMinute + 24 * 60) % (24 * 60)
    : undefined;
  const clockDraft = (preference: PlannerSleepClockPreference | undefined, fallback: string): SleepClockDraft => ({
    mode: preference?.mode ?? "approximate",
    time: preference?.time ?? fallback,
    toleranceMinutes: String(preference?.toleranceMinutes ?? 60),
    notBefore: preference?.notBefore ?? "",
    notAfter: preference?.notAfter ?? "",
  });
  const bedtimePreference = adaptive?.bedtimePreference;
  const wakePreference = adaptive?.wakePreference;
  const weekendOverride = adaptive?.weekendOverride;
  return {
    timezone: profile.timezone,
    sleepMode: profile.sleepSchedule.mode,
    weekdayBedtime: fixed.weekdays.bedtime,
    weekdayDuration: String(fixed.weekdays.durationMinutes),
    separateWeekend: Boolean(adaptive?.weekendOverride) || fixed.weekends.bedtime !== fixed.weekdays.bedtime
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
    bedtimeClock: clockDraft(bedtimePreference, fixed.weekdays.bedtime),
    wakeClock: clockDraft(wakePreference, plannerMinutesToTime(wakeMinute)),
    weekendBedtimeClock: clockDraft(weekendOverride?.bedtimePreference ?? bedtimePreference, fixed.weekends.bedtime),
    weekendWakeClock: clockDraft(weekendOverride?.wakePreference ?? wakePreference, plannerMinutesToTime(plannerTimeToMinutes(fixed.weekends.bedtime) + fixed.weekends.durationMinutes)),
    windDownMinutes: String(adaptive?.windDownMinutes ?? 30),
    morningPreparationMinutes: String(adaptive?.morningPreparationMinutes ?? 60),
    healthyMinimumConfirmed: !adaptive?.requiresHealthyMinimumConfirmation,
    commitments,
    energy: neutralEnergy || highEnergyOffset === undefined ? "auto" : highEnergyOffset < 3 * 60 ? "morning" : highEnergyOffset < 8 * 60 ? "day" : "evening",
    reserve: String(Math.round(profile.reserveRatio * 100)),
  };
}

function savedCommitments(
  items: PlannerItem[],
  blocks: PlannerBlock[],
  timezone: string
): PlannerStructuredCommitment[] {
  return items.filter((item) => item.status === "active").map((item) => {
    const fixedBlock = item.kind === "fixed_event" && !item.recurrence?.startTime
      ? blocks.filter((block) => block.itemId === item.id
          && block.fixed
          && block.status !== "cancelled"
          && block.status !== "skipped")
        .sort((left, right) => left.startAt.localeCompare(right.startAt))[0]
      : undefined;
    return plannerDraftToCommitment({
      ...item,
      date: fixedBlock ? formatDateInTimeZone(new Date(fixedBlock.startAt), timezone) : undefined,
      start: fixedBlock ? formatTimeInTimeZone(new Date(fixedBlock.startAt), timezone) : undefined,
      end: fixedBlock ? formatTimeInTimeZone(new Date(fixedBlock.endAt), timezone) : undefined,
    }, timezone, item.id);
  });
}

function clockPreference(value: SleepClockDraft): PlannerSleepClockPreference {
  return {
    mode: value.mode,
    ...(value.mode === "exact" || value.mode === "approximate" ? { time: value.time } : {}),
    ...(value.mode === "approximate" ? { toleranceMinutes: Number(value.toleranceMinutes) || 60 } : {}),
    ...(value.notBefore ? { notBefore: value.notBefore } : {}),
    ...(value.notAfter ? { notAfter: value.notAfter } : {}),
    source: value.mode === "any" ? "neutral_default" : "user",
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
      bedtimePreference: clockPreference(value.bedtimeClock),
      wakePreference: clockPreference(value.wakeClock),
      windDownMinutes: Number(value.windDownMinutes) || 30,
      weekendOverride: value.separateWeekend ? {
        bedtimePreference: clockPreference(value.weekendBedtimeClock),
        wakePreference: clockPreference(value.weekendWakeClock),
      } : undefined,
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

function wakeReasonText(reason: PlannerWakeAnchorReason | undefined, ru: boolean): string {
  if (!reason) return ru ? "Время выбрано как осторожная стартовая точка." : "This time is a cautious starting point.";
  if (reason.code === "recurring_commitment") return ru
    ? `Подъём сдвинут раньше из-за постоянного дела${reason.relatedTitle ? ` «${reason.relatedTitle}»` : ""}${reason.relatedTime ? ` в ${reason.relatedTime}` : ""} и времени на подготовку.`
    : `Wake-up moved earlier for the recurring commitment${reason.relatedTitle ? ` “${reason.relatedTitle}”` : ""}${reason.relatedTime ? ` at ${reason.relatedTime}` : ""} and preparation time.`;
  if (reason.code === "plan_fit") return ru
    ? `Это время оставляет больше подходящих окон для дел${reason.relatedTitle ? `, включая «${reason.relatedTitle}»` : ""}, без ежедневных скачков режима.`
    : `This time leaves better task slots${reason.relatedTitle ? `, including “${reason.relatedTitle}”` : ""}, without daily schedule jumps.`;
  if (reason.code === "sleep_history") return ru
    ? "Ориентир взят из медианы последних фактических подъёмов; переходные и восстановительные ночи не учитываются."
    : "The baseline comes from the median of recent actual wake-ups; transition and recovery nights are excluded.";
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

function SleepClockEditor({ title, value, onChange, locale }: {
  title: string;
  value: SleepClockDraft;
  onChange: (value: SleepClockDraft) => void;
  locale: Locale;
}) {
  const ru = locale === "ru";
  const patch = (next: Partial<SleepClockDraft>) => onChange({ ...value, ...next });
  const modes: Array<{ value: SleepClockDraft["mode"]; ru: string; en: string }> = [
    { value: "exact", ru: "Точно", en: "Exact" },
    { value: "approximate", ru: "Примерно", en: "Approximate" },
    { value: "range", ru: "Допустимый диапазон", en: "Allowed range" },
    { value: "any", ru: "Без разницы — выбери сам", en: "No preference — choose for me" },
  ];
  const showBounds = value.mode === "range" || value.mode === "approximate" || value.mode === "any";
  return <fieldset className={styles.ratingField}>
    <legend>{title}</legend>
    <div className={styles.segmented}>{modes.map((mode) => <button type="button" key={mode.value} className={value.mode === mode.value ? styles.segmentedActive : ""} aria-pressed={value.mode === mode.value} onClick={() => patch({ mode: mode.value })}>{ru ? mode.ru : mode.en}</button>)}</div>
    {(value.mode === "exact" || value.mode === "approximate") && <label>{ru ? "Обычное время" : "Usual time"}<input type="time" required value={value.time} onChange={(event) => patch({ time: event.target.value })} /></label>}
    {value.mode === "approximate" && <DurationInput label={ru ? "Допустимое отклонение в каждую сторону" : "Tolerance in either direction"} valueMinutes={value.toleranceMinutes} minMinutes={15} maxMinutes={180} minuteStep={15} locale={locale} onChangeMinutes={(minutes) => patch({ toleranceMinutes: String(minutes) })} />}
    {showBounds && <div className={styles.formGrid}>
      <label>{ru ? "Не раньше (необязательно)" : "Not before (optional)"}<input type="time" required={value.mode === "range"} value={value.notBefore} onChange={(event) => patch({ notBefore: event.target.value })} /></label>
      <label>{ru ? "Не позже (необязательно)" : "Not after (optional)"}<input type="time" required={value.mode === "range"} value={value.notAfter} onChange={(event) => patch({ notAfter: event.target.value })} /></label>
    </div>}
    <small>{value.mode === "exact"
      ? (ru ? "Жёсткое ограничение." : "Hard constraint.")
      : value.mode === "range"
        ? (ru ? "Планировщик не выйдет за эти границы." : "The planner stays inside these bounds.")
        : value.mode === "approximate"
          ? (ru ? "Мягкое предпочтение; границы ниже остаются жёсткими." : "Soft preference; optional bounds remain hard.")
          : (ru ? "Без мягкого предпочтения; при необходимости можно оставить только жёсткие границы." : "No soft preference; optional hard bounds may still be set.")}</small>
  </fieldset>;
}

export default function AutoplannerModal({
  profile,
  items,
  blocks,
  sleepEventsCount,
  locale,
  firstRun,
  upgradeOnly,
  busy,
  onClose,
  onEstimateTravel,
  onPrepare,
  requestError,
  onClearRequestError,
  onOpenSleep,
  onReset,
}: {
  profile: PlannerProfile;
  items: PlannerItem[];
  blocks: PlannerBlock[];
  sleepEventsCount: number;
  locale: Locale;
  firstRun: boolean;
  upgradeOnly?: boolean;
  busy: boolean;
  onClose?: () => void;
  onEstimateTravel: (input: PlannerTravelEstimateInput) => Promise<PlannerTravelEstimateResult>;
  onPrepare: (input: PlannerProposalInput) => Promise<void>;
  requestError?: string | null;
  onClearRequestError: () => void;
  onOpenSleep: () => void;
  onReset: (password: string) => Promise<void>;
}) {
  const ru = locale === "ru";
  const [baselineCommitments] = useState<PlannerStructuredCommitment[]>(() => savedCommitments(items, blocks, profile.timezone));
  const [step, setStep] = useState(upgradeOnly ? 2 : firstRun ? 1 : 0);
  const [value, setValue] = useState<AssistantDraft>(() => initialDraft(profile, firstRun, baselineCommitments));
  const [profileChanged, setProfileChanged] = useState(firstRun);
  const [resetStage, setResetStage] = useState<0 | 1 | 2>(0);
  const [password, setPassword] = useState("");
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
          bedtimeClock: { ...current.bedtimeClock, ...(restored.bedtimeClock ?? {}) },
          wakeClock: { ...current.wakeClock, ...(restored.wakeClock ?? {}) },
          weekendBedtimeClock: { ...current.weekendBedtimeClock, ...(restored.weekendBedtimeClock ?? {}) },
          weekendWakeClock: { ...current.weekendWakeClock, ...(restored.weekendWakeClock ?? {}) },
          energy: restored.energy === "morning" || restored.energy === "day" || restored.energy === "evening"
            ? restored.energy
            : "auto",
          commitments: Array.isArray(restored.commitments)
            ? [...new Map([
                ...current.commitments,
                ...restored.commitments.flatMap((commitment) => commitment?.id && commitment?.title
                  ? [normalizeStructuredCommitment(commitment)]
                  : []),
              ].map((commitment) => [commitment.id, commitment])).values()]
            : current.commitments,
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
    ? ["Сводка", "Часовой пояс", "Сон", "Пробный режим", "Все дела", "Продуктивность", "Итог"]
    : ["Summary", "Time zone", "Sleep", "Trial schedule", "All items", "Productivity", "Result"];
  const currentLabel = labels[step] ?? labels[0];
  const commitmentDrafts = useMemo(
    () => value.commitments.map((commitment) => commitmentToPlannerDraft(commitment, locale, value.timezone)),
    [locale, value.commitments, value.timezone]
  );
  const baselineById = useMemo(
    () => new Map(baselineCommitments.map((commitment) => [commitment.id, JSON.stringify(commitment)])),
    [baselineCommitments]
  );
  const changedCommitmentDrafts = useMemo(
    () => value.commitments
      .filter((commitment) => baselineById.get(commitment.id) !== JSON.stringify(commitment))
      .map((commitment) => commitmentToPlannerDraft(commitment, locale, value.timezone)),
    [baselineById, locale, value.commitments, value.timezone]
  );
  const removedItemIds = useMemo(() => {
    const retained = new Set(value.commitments.map((commitment) => commitment.id));
    return baselineCommitments.map((commitment) => commitment.id).filter((id) => !retained.has(id));
  }, [baselineCommitments, value.commitments]);
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
      assistantSetupVersion: 5,
      onboardingCompleted: true,
    };
  }, [planningDrafts, profile.planningPolicy, value]);

  const update = <K extends keyof AssistantDraft>(key: K, next: AssistantDraft[K]) => setValue((current) => ({ ...current, [key]: next }));

  async function prepare() {
    await onPrepare({
      drafts: changedCommitmentDrafts.length ? changedCommitmentDrafts : undefined,
      removedItemIds: removedItemIds.length ? removedItemIds : undefined,
      profilePatch: profileChanged || firstRun ? profilePatch : undefined,
      trigger: firstRun ? "assistant_setup" : "assistant_update",
      rebuildFuture: true,
    });
  }

  function goBack() {
    setCommitmentEditorOpen(false);
    if (upgradeOnly && step === 6) setStep(2);
    else if (step > 1) setStep(step - 1);
    else if (!firstRun) setStep(0);
  }

  if (resetStage > 0) {
    return <ModalFrame title={ru ? "Обнулить план" : "Reset planner"} onClose={() => setResetStage(0)} locale={locale}>
      <div className={styles.assistantBody}>
        {resetStage === 1 ? <>
          <p className={styles.dangerPanel}>{ru
            ? `Будут удалены настройки, ${items.length} дел, ${blocks.length} блоков календаря, ${sleepEventsCount} изменений сна, история и отметки импорта. Данные Crate и оригинальные карточки сохранятся. Отменить сброс нельзя.`
            : `Settings, ${items.length} items, ${blocks.length} calendar blocks, ${sleepEventsCount} sleep changes, history and import markers will be deleted. Crate data stays intact.`}</p>
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
          <button onClick={() => { setProfileChanged(true); setStep(2); }}>{ru ? "Изменить режим сна" : "Change sleep mode"}<small>{ru ? "Точный режим или помощь в его формировании" : "Fixed schedule or an adaptive trial mode"}</small></button>
          <button onClick={onOpenSleep}>{ru ? "Изменить выбранную ночь" : "Change a selected night"}<small>{ru ? "Открыть структурированный конструктор сна" : "Open the structured sleep constructor"}</small></button>
          <button onClick={() => { setProfileChanged(true); setStep(5); }}>{ru ? "Изменить нагрузку" : "Change workload"}<small>{ru ? "Энергия и резерв времени" : "Energy and protected reserve"}</small></button>
        </div>
        <button className={styles.resetLink} onClick={() => setResetStage(1)}>{ru ? "Обнулить весь план" : "Reset entire planner"}</button>
      </div>
    </ModalFrame>;
  }

  const computedSleepSchedule = scheduleFromDraft(value, planningDrafts);
  const draftSleepSchedule = {
    ...computedSleepSchedule,
    targetDurationMinutes: computedSleepSchedule.mode === "adaptive"
      ? computedSleepSchedule.targetDurationMinutes
      : computedSleepSchedule.weekdays.durationMinutes,
  };
  const draftSleepRule = sleepRuleForWakeDate(draftSleepSchedule, "2026-08-17");
  const draftWakeTime = plannerMinutesToTime(plannerTimeToMinutes(draftSleepRule.bedtime) + draftSleepRule.durationMinutes);
  const sleepDurationText = (minutes: number) => `${Math.floor(minutes / 60)} ${ru ? "ч" : "h"}${minutes % 60 ? ` ${minutes % 60} ${ru ? "мин" : "min"}` : ""}`;
  const healthyMinimumNeedsConfirmation = value.sleepMode === "adaptive"
    && (value.adaptiveDurationMode === "exact"
      ? !value.adaptiveExactDurations.some((minutes) => minutes >= 7 * 60)
      : Math.max(Number(value.adaptiveMinDuration), Number(value.adaptiveMaxDuration)) < 7 * 60)
    && !value.healthyMinimumConfirmed;

  return <ModalFrame title={ru ? "Автопланировщик" : "Autoplanner"} onClose={firstRun ? undefined : onClose} locale={locale}>
    <div className={styles.assistantProgress}><span>{upgradeOnly ? (step === 2 ? "1/2" : "2/2") : `${step}/6`}</span><strong>{upgradeOnly ? (ru ? "Новые правила сна и дедлайнов" : "New sleep and deadline rules") : currentLabel}</strong><i style={{ width: upgradeOnly ? `${step === 2 ? 50 : 100}%` : `${step / 6 * 100}%` }} /></div>
    <div className={styles.assistantBody}>
      {step === 1 && <section className={styles.assistantStep}><h3>{ru ? "Где считать ваше время?" : "Which time zone should be used?"}</h3><p>{ru ? "Он определён автоматически. Проверьте значение." : "It was detected automatically. Confirm it."}</p><label>{ru ? "Часовой пояс" : "Time zone"}<input value={value.timezone} onChange={(event) => { update("timezone", event.target.value); setProfileChanged(true); }} /></label></section>}
      {step === 2 && <section className={styles.assistantStep}>
        <h3>{ru ? "Как поступить со сном?" : "How should sleep be planned?"}</h3>
        <div className={styles.assistantChoices}>
          <button type="button" className={value.sleepMode === "fixed" ? styles.segmentedActive : ""} onClick={() => { update("sleepMode", "fixed"); setProfileChanged(true); }}>{ru ? "У меня есть обычный режим" : "I have a regular schedule"}<small>{ru ? "Укажу точное время и длительность" : "I will provide bedtime and duration"}</small></button>
          <button type="button" className={value.sleepMode === "adaptive" ? styles.segmentedActive : ""} onClick={() => { update("sleepMode", "adaptive"); setProfileChanged(true); }}>{ru ? "Графика нет — сформировать" : "No schedule — build one"}<small>{ru ? "Планировщик создаст пробный здоровый режим" : "Planner creates a cautious trial schedule"}</small></button>
        </div>
        <p className={styles.fieldHelp}>{ru ? "Режим задаётся только точными полями и переключателями ниже." : "Use only the structured fields and choices below."}</p>
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
          <SleepClockEditor title={ru ? "Когда вы обычно засыпаете?" : "When do you usually fall asleep?"} value={value.bedtimeClock} locale={locale} onChange={(clock) => { update("bedtimeClock", clock); setProfileChanged(true); }} />
          <SleepClockEditor title={ru ? "Когда вы обычно просыпаетесь?" : "When do you usually wake up?"} value={value.wakeClock} locale={locale} onChange={(clock) => { update("wakeClock", clock); update("wakeDayPart", clock.mode === "any" ? "auto" : "morning"); setProfileChanged(true); }} />
          <DurationInput label={ru ? "От решения лечь до фактического сна" : "From deciding to sleep until falling asleep"} valueMinutes={value.windDownMinutes} minMinutes={0} maxMinutes={240} minuteStep={5} locale={locale} onChangeMinutes={(minutes) => { update("windDownMinutes", String(minutes)); setProfileChanged(true); }} />
          <label className={styles.choiceCheck}><input type="checkbox" checked={value.separateWeekend} onChange={(event) => { update("separateWeekend", event.target.checked); setProfileChanged(true); }} />{ru ? "На выходных сон и подъём отличаются" : "Use different sleep and wake preferences on weekends"}</label>
          {value.separateWeekend && <>
            <SleepClockEditor title={ru ? "Засыпание перед выходными" : "Weekend bedtime"} value={value.weekendBedtimeClock} locale={locale} onChange={(clock) => { update("weekendBedtimeClock", clock); setProfileChanged(true); }} />
            <SleepClockEditor title={ru ? "Подъём в выходные" : "Weekend wake-up"} value={value.weekendWakeClock} locale={locale} onChange={(clock) => { update("weekendWakeClock", clock); setProfileChanged(true); }} />
          </>}
          <div className={styles.wakePreview} aria-live="polite"><span>{ru ? "Обычный ориентир" : "Usual baseline"}</span><strong>{ru ? "Подъём" : "Wake"} {draftWakeTime} · {ru ? "сон с" : "sleep from"} {draftSleepRule.bedtime}</strong><p>{value.wakeClock.mode === "any" ? (ru ? "Без истории используется нейтральный подъём 09:00. Обычные гибкие дела не сдвинут его раньше." : "Without history the neutral wake-up is 09:00. Ordinary flexible work will not move it earlier.") : (ru ? "Точное время и допустимые границы жёсткие; примерное время остаётся мягким предпочтением." : "Exact time and allowed bounds are hard; approximate time remains a soft preference.")}</p></div>
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
        <p className={styles.fieldHelp}>{ru
          ? `Здесь показаны все активные дела из календаря: ${value.commitments.length}. Их можно изменить или удалить, а новые карточки добавятся в этот же список.`
          : `All active calendar items are shown here: ${value.commitments.length}. You can edit or remove them, and new cards join the same list.`}</p>
        <div className={styles.fieldExplanation}><strong>{ru ? "Как это повлияет на план" : "How this changes the plan"}</strong><p>{ru ? "Дело, дорога туда и выбранная обратная дорога будут защищены от других задач. Необязательный интервал ограничивает время самого дела." : "The item, outbound travel and an optional return trip are protected from other tasks. An optional window limits the item itself."}</p></div>
        <CommitmentsEditor commitments={value.commitments} locale={locale} onChange={(commitments) => update("commitments", commitments)} onEstimateTravel={onEstimateTravel} onEditingChange={setCommitmentEditorOpen} />
      </section>}
      {step === 5 && <section className={styles.assistantStep}>
        <h3>{ru ? "Когда вам удобнее решать сложные задачи?" : "When is difficult work easiest?"}</h3>
        <p>{ru ? "Это только мягкое предпочтение. Если подходящего периода нет, выберите «Без разницы» — планировщик не будет отдавать времени суток преимущество." : "This is only a soft preference. Choose “No preference” and the planner will not favor a time of day."}</p>
        <div className={styles.segmented}>{(["auto", "morning", "day", "evening"] as const).map((energy) => <button type="button" key={energy} className={value.energy === energy ? styles.segmentedActive : ""} aria-pressed={value.energy === energy} onClick={() => { update("energy", energy); setProfileChanged(true); }}>{energy === "auto" ? (ru ? "Без разницы — выбери сам" : "No preference — choose for me") : energy === "morning" ? (ru ? "После подъёма" : "After waking") : energy === "day" ? (ru ? "Днём" : "Day") : (ru ? "Вечером" : "Evening")}</button>)}</div>
        <label>{ru ? "Оставлять свободным, %" : "Protected free time, %"}<input type="number" min="0" max="60" value={value.reserve} onChange={(event) => { update("reserve", event.target.value); setProfileChanged(true); }} /><small>{ru ? "Доля доступного времени без автозадач. 20% помогает пережить задержки, отдых и внезапные планы." : "The share of available time kept free from automatic tasks. 20% leaves room for delays, rest and unexpected plans."}</small></label>
      </section>}
      {step === 6 && <section className={styles.assistantStep} aria-busy={busy}><h3>{ru ? "Готово к предпросмотру" : "Ready for preview"}</h3><dl className={styles.assistantRecap}><div><dt>{ru ? "Часовой пояс" : "Time zone"}</dt><dd>{value.timezone}</dd></div><div><dt>{ru ? "Режим" : "Mode"}</dt><dd>{draftSleepSchedule.mode === "adaptive" ? (ru ? "Адаптивный" : "Adaptive") : (ru ? "Фиксированный" : "Fixed")}</dd></div><div><dt>{ru ? "Подъём" : "Wake-up"}</dt><dd>{draftWakeTime}</dd></div><div><dt>{ru ? "Отбой" : "Bedtime"}</dt><dd>{draftSleepRule.bedtime}</dd></div><div><dt>{ru ? "Запланированная длительность" : "Planned duration"}</dt><dd>{sleepDurationText(draftSleepRule.durationMinutes)}</dd></div>{draftSleepRule.durationMinutes !== draftSleepSchedule.targetDurationMinutes && <div><dt>{ru ? "Целевая длительность" : "Target duration"}</dt><dd>{sleepDurationText(draftSleepSchedule.targetDurationMinutes)}</dd></div>}<div><dt>{ru ? "Дел в плане" : "Items in plan"}</dt><dd>{commitmentDrafts.length}</dd></div><div><dt>{ru ? "Изменено или добавлено" : "Changed or added"}</dt><dd>{changedCommitmentDrafts.length}</dd></div>{removedItemIds.length > 0 && <div><dt>{ru ? "Удаляется" : "Removed"}</dt><dd>{removedItemIds.length}</dd></div>}<div><dt>{ru ? "Продуктивность" : "Productivity"}</dt><dd>{value.energy === "auto" ? (ru ? "без разницы" : "no preference") : value.energy === "morning" ? (ru ? "после подъёма" : "after waking") : value.energy === "day" ? (ru ? "днём" : "day") : (ru ? "вечером" : "evening")}</dd></div><div><dt>{ru ? "Резерв" : "Reserve"}</dt><dd>{value.reserve}%</dd></div></dl>{draftSleepSchedule.mode === "adaptive" && <div className={styles.fieldExplanation}><strong>{ru ? "Предварительная причина" : "Preliminary reason"}</strong><p>{wakeReasonText(draftSleepSchedule.wakeAnchor.selectionReason, ru)}</p>{value.wakeDayPart === "auto" && <small>{ru ? "Движок выведет подходящий ориентир подъёма из обязательств, временных окон, дороги и сроков, затем один раз соберёт весь план." : "The planner derives a suitable wake anchor from commitments, time windows, travel and deadlines, then builds the full plan once."}</small>}</div>}<p>{ru ? "Следующий экран покажет каждый перенос, защищённый сон и конфликт. Ничего ещё не будет применено." : "The next screen shows every move, protected sleep block and conflict. Nothing is applied yet."}</p>{requestError && <div className={styles.requestErrorPanel} role="alert"><strong>{ru ? "Предпросмотр не был создан" : "The preview was not created"}</strong><p>{requestError}</p><small>{ru ? "Введённые дела сохранены в этом мастере. Можно изменить их в пункте «Все дела» или повторить расчёт — заполнять всё заново не нужно." : "Your items are still saved in this wizard. Edit them under All items or retry; you do not need to enter everything again."}</small><button type="button" onClick={() => { onClearRequestError(); setStep(4); }}>{ru ? "Вернуться к делам" : "Return to items"}</button></div>}</section>}
      <div className={styles.assistantFooter}>
        <button type="button" disabled={busy} onClick={goBack}>{ru ? "Назад" : "Back"}</button>
        {step < 4 && <button type="button" className={styles.primaryButton} disabled={busy || healthyMinimumNeedsConfirmation} onClick={() => setStep(upgradeOnly && step === 2 ? 6 : step + 1)}>{ru ? "Дальше" : "Next"}</button>}
        {step === 4 && <button type="button" className={styles.primaryButton} disabled={busy || commitmentEditorOpen} onClick={() => setStep(5)}>{commitmentEditorOpen ? (ru ? "Сначала сохраните дело" : "Save the item first") : (ru ? "Дальше" : "Next")}</button>}
        {step === 5 && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => setStep(6)}>{ru ? "К итогу" : "Continue"}</button>}
        {step === 6 && <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => { onClearRequestError(); void prepare(); }}>{busy ? (ru ? "Составляю план…" : "Building plan…") : requestError ? (ru ? "Повторить расчёт" : "Retry") : (ru ? "Показать изменения" : "Review changes")}</button>}
      </div>
    </div>
  </ModalFrame>;
}
