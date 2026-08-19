"use client";

import Link from "next/link";
import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import LocaleSwitcher from "@/components/locale-switcher";
import { useI18n } from "@/components/i18n-provider";
import AutoplannerModal from "@/components/planner/autoplanner-modal";
import SleepChangedModal, { type SleepMode } from "@/components/planner/sleep-changed-modal";
import type { Locale } from "@/lib/i18n";
import { availabilityFromSleepSchedule, buildPlannerSleepBlocks, createPlannerSleepEvent, fixedScheduleView } from "@/lib/planner/sleep";
import {
  createDefaultPlannerProfile,
  type PlannerAssistantParseResult,
  type PlannerBlock,
  type PlannerBootstrap,
  type PlannerDraft,
  type PlannerEnergy,
  type PlannerHorizon,
  type PlannerItem,
  type PlannerItemKind,
  type PlannerPriority,
  type PlannerProfile,
  type PlannerProposal,
  type PlannerProposalInput,
  type PlannerRecurrence,
  type PlannerSleepBlock,
  type PlannerSleepEvent,
  type PlannerSleepParseResult,
  type PlannerSleepRestedness,
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

type PlannerView = "day" | "week" | "month" | "agenda";
type Modal = "quick" | "item" | "proposal" | "settings" | "stats" | "import" | "assistant" | "sleep" | null;
type CalendarBlock = PlannerBlock | PlannerSleepBlock;

function isSleepBlock(block: CalendarBlock): block is PlannerSleepBlock {
  return "kind" in block && block.kind === "sleep";
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
  title: string;
  kind: PlannerItemKind;
  estimateMinutes: string;
  date: string;
  start: string;
  end: string;
  deadline: string;
  priority: PlannerPriority;
  energy: PlannerEnergy;
  canSplit: boolean;
  minChunkMinutes: string;
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
    inbox: "Очередь",
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
    inbox: "Inbox",
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
  ru: { fixed_event: "Фиксированное событие", flexible_task: "Гибкая задача", routine: "Routine" },
  en: { fixed_event: "Fixed event", flexible_task: "Flexible task", routine: "Routine" },
};

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
    title: "", kind: "flexible_task", estimateMinutes: "60", date,
    start: "", end: "", deadline: "", priority: "normal", energy: "normal",
    canSplit: false, minChunkMinutes: "25", preferredStart: "", preferredEnd: "",
    avoidedStart: "", avoidedEnd: "", location: "", area: "", notes: "",
    bufferBeforeMinutes: "0", bufferAfterMinutes: "0", recurrenceFrequency: "daily",
    recurrenceWeekdays: [plannerWeekday(date)],
  };
}

function formFromDraft(draft: PlannerDraft, date: string, timezone: string): ItemForm {
  const form = defaultItemForm(date);
  const preferred = draft.preferredWindows?.[0];
  const avoided = draft.avoidedWindows?.[0];
  return {
    ...form,
    title: draft.title,
    kind: draft.kind ?? form.kind,
    estimateMinutes: String(draft.estimateMinutes ?? 60),
    date: draft.date ?? date,
    start: draft.start ?? "",
    end: draft.end ?? "",
    deadline: draft.deadlineAt ? formatDateInTimeZone(new Date(draft.deadlineAt), timezone) : "",
    priority: draft.priority ?? "normal",
    energy: draft.energy ?? "normal",
    canSplit: draft.canSplit ?? false,
    minChunkMinutes: String(draft.minChunkMinutes ?? 25),
    preferredStart: preferred?.start ?? "",
    preferredEnd: preferred?.end ?? "",
    avoidedStart: avoided?.start ?? "",
    avoidedEnd: avoided?.end ?? "",
    location: draft.location ?? "",
    area: draft.area ?? "",
    notes: draft.notes ?? "",
    bufferBeforeMinutes: String(draft.bufferBeforeMinutes ?? 0),
    bufferAfterMinutes: String(draft.bufferAfterMinutes ?? 0),
    recurrenceFrequency: draft.recurrence?.frequency ?? "daily",
    recurrenceWeekdays: draft.recurrence?.weekdays ?? form.recurrenceWeekdays,
  };
}

function asDraft(form: ItemForm, profile: PlannerProfile): PlannerDraft {
  const recurrence: PlannerRecurrence | undefined = form.kind === "routine"
    ? {
        frequency: form.recurrenceFrequency,
        weekdays: form.recurrenceFrequency === "custom"
          ? form.recurrenceWeekdays
          : form.recurrenceFrequency === "weekly" ? [plannerWeekday(form.date)] : undefined,
      }
    : undefined;
  return {
    title: form.title.trim(), kind: form.kind,
    estimateMinutes: Number(form.estimateMinutes) || 60,
    date: form.kind === "fixed_event" ? form.date : undefined,
    start: form.kind === "fixed_event" ? form.start || undefined : undefined,
    end: form.kind === "fixed_event" ? form.end || undefined : undefined,
    deadlineAt: form.deadline ? zonedPlannerDateTimeToUtc(form.deadline, "23:59", profile.timezone) : undefined,
    priority: form.priority, energy: form.energy, canSplit: form.canSplit,
    minChunkMinutes: Number(form.minChunkMinutes) || 25,
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
  const [data, setData] = useState<PlannerBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<PlannerView>("week");
  const [selectedDate, setSelectedDate] = useState(() => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Minsk"));
  const [mobileTab, setMobileTab] = useState<"now" | "day" | "calendar" | "inbox">("calendar");
  const [modal, setModal] = useState<Modal>(initialLegacyImport ? "import" : null);
  const [sleepModalMode, setSleepModalMode] = useState<SleepMode>("later");
  const [sleepModalWakeDate, setSleepModalWakeDate] = useState<string | undefined>();
  const [quickCommand, setQuickCommand] = useState("");
  const [quickTrigger, setQuickTrigger] = useState<PlannerProposal["trigger"]>("quick_add");
  const [itemForm, setItemForm] = useState(() => defaultItemForm(selectedDate));
  const [proposal, setProposal] = useState<PlannerProposal | null>(null);
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
    const response = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
    if (!response.ok || payload.data === undefined) {
      if (response.status === 403) csrfRef.current = null;
      throw new Error(payload.error ?? "Request failed");
    }
    return payload.data;
  }, [ensureCsrf]);

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
  const tentativeSleepEvent = data?.sleepEvents.find((event) => event.state === "tentative");
  const visibleDates = useMemo(() => {
    if (view === "day") return [selectedDate];
    if (view === "week") {
      const start = startOfWeek(selectedDate);
      return Array.from({ length: 7 }, (_, index) => addPlannerDays(start, index));
    }
    if (view === "month") return monthDates(selectedDate);
    return Array.from({ length: horizonDays(profile.horizon) }, (_, index) => addPlannerDays(selectedDate, index));
  }, [profile.horizon, selectedDate, view]);
  const sleepBlocks = useMemo(() => data && visibleDates.length
    ? buildPlannerSleepBlocks(profile, data.sleepEvents, visibleDates[0], visibleDates[visibleDates.length - 1])
    : [], [data, profile, visibleDates]);

  const activeBlocks = useMemo(() => blocks.filter((block) => !["cancelled", "skipped"].includes(block.status)), [blocks]);
  const actionableBlocks = useMemo(() => activeBlocks.filter((block) => block.status === "planned" || block.status === "in_progress"), [activeBlocks]);
  const futureItemIds = useMemo(() => new Set(actionableBlocks.filter((block) => new Date(block.endAt) > now).map((block) => block.itemId)), [actionableBlocks, now]);
  const inbox = useMemo(() => items.filter((item) => item.status === "active" && item.kind !== "fixed_event" && !futureItemIds.has(item.id)), [futureItemIds, items]);
  const currentBlock = useMemo(() => actionableBlocks.find((block) => block.status === "in_progress")
    ?? actionableBlocks.find((block) => new Date(block.startAt) <= now && new Date(block.endAt) > now)
    ?? null, [actionableBlocks, now]);
  const nextBlock = useMemo(() => actionableBlocks.filter((block) => block.status === "planned" && new Date(block.startAt) > now).sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null, [actionableBlocks, now]);
  const todayHealth = useMemo(() => {
    const date = todayIn(profile.timezone);
    const planned = activeBlocks.filter((block) => localDate(block, profile.timezone) === date).reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
    const available = (profile.availability[String(plannerWeekday(date))] ?? []).reduce((sum, window) => {
      const start = plannerTimeToMinutes(window.start);
      const end = plannerTimeToMinutes(window.end);
      return sum + ((end - start + 1440) % 1440 || 1440);
    }, 0);
    const freePercent = available ? Math.max(0, Math.round((1 - planned / available) * 100)) : 0;
    return { overloaded: available > 0 && freePercent < Math.round(profile.reserveRatio * 100), freePercent };
  }, [activeBlocks, profile]);

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
    const profileChange = current.changes.find((change) => change.kind === "update_profile");
    const sleepChange = current.changes.find((change) => change.kind === "upsert_sleep_event");
    return {
      drafts: current.normalizedDrafts,
      profilePatch: profileChange?.kind === "update_profile" ? profileChange.profile : undefined,
      sleepEvent: sleepChange?.kind === "upsert_sleep_event" ? sleepChange.event : undefined,
      trigger: current.trigger,
      rebuildFuture: current.trigger === "sleep_changed" || current.trigger === "assistant_setup" || current.trigger === "assistant_update",
    };
  }

  async function submitQuick(event: FormEvent) {
    event.preventDefault();
    if (!quickCommand.trim()) return;
    await run(async () => createProposal({ command: quickCommand, trigger: quickTrigger }));
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault();
    if (!itemForm.title.trim()) return;
    await run(async () => createProposal({ draft: asDraft(itemForm, profile), trigger: quickTrigger }));
  }

  async function applyProposal() {
    if (!proposal?.id || proposal.conflicts.length > 0) return;
    await run(async () => {
      await api(`/api/planner/proposals/${proposal.id}/apply`, { method: "POST", body: "{}" });
      try { window.localStorage.removeItem("itemkey.planner.autoplanner.v2"); } catch { /* optional draft storage */ }
      setModal(null); setProposal(null); setQuickCommand(""); await load(true);
    }, locale === "ru" ? "План применён." : "Plan applied.");
  }

  async function blockAction(block: PlannerBlock, action: string, minutes?: number) {
    let succeeded = false;
    await run(async () => {
      await api(`/api/planner/blocks/${encodeURIComponent(block.id)}/action`, { method: "POST", body: JSON.stringify({ action, minutes, expectedRevision: profile.revision }) });
      await load(true);
      succeeded = true;
    });
    return succeeded;
  }

  async function moveBlock(block: PlannerBlock, startAt: string, endAt: string) {
    await run(async () => {
      await api(`/api/planner/blocks/${encodeURIComponent(block.id)}`, {
        method: "PATCH", body: JSON.stringify({ startAt, endAt, expectedRevision: profile.revision }),
      });
      const date = formatDateInTimeZone(new Date(startAt), profile.timezone);
      const scheduledMinutes = blocks
        .filter((candidate) => candidate.id !== block.id && localDate(candidate, profile.timezone) === date && !["cancelled", "skipped"].includes(candidate.status))
        .reduce((sum, candidate) => sum + isoDurationMinutes(candidate.startAt, candidate.endAt), isoDurationMinutes(startAt, endAt));
      const availableMinutes = (profile.availability[String(plannerWeekday(date))] ?? []).reduce((sum, window) => {
        const start = plannerTimeToMinutes(window.start);
        const end = plannerTimeToMinutes(window.end);
        return sum + ((end - start + 1440) % 1440 || 1440);
      }, 0);
      if (scheduledMinutes > availableMinutes * (1 - profile.reserveRatio)) {
        setNotice(locale === "ru" ? "Время изменено вручную, но день теперь перегружен и резерв не защищён." : "Time changed manually, but the day is now overloaded and its buffer is not protected.");
      }
      await load(true);
    });
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
    await run(async () => {
      await api(`/api/planner/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: profile.revision, item: { ...item, estimateMinutes: suggestedMinutes } }),
      });
      await load(true);
    }, locale === "ru" ? "Оценка длительности обновлена." : "Duration estimate updated.");
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

  async function checkInSleep(wakeDate: string, restedness: PlannerSleepRestedness) {
    await run(async () => {
      await api("/api/planner/sleep/check-in", {
        method: "POST",
        body: JSON.stringify({ wakeDate, restedness, expectedRevision: profile.revision }),
      });
      setModal(null);
      await load(true);
    }, locale === "ru" ? "Оценка сна сохранена." : "Sleep rating saved.");
  }

  function openQuick(trigger: PlannerProposal["trigger"]) {
    setQuickTrigger(trigger); setQuickCommand(""); setModal("quick");
  }

  function openItem(draft?: PlannerDraft) {
    setQuickTrigger(draft ? "plans_changed" : "quick_add");
    setItemForm(draft ? formFromDraft(draft, selectedDate, profile.timezone) : defaultItemForm(selectedDate));
    setModal("item");
  }

  if (loading) return <div className={styles.loading}>Собираем ваш план…</div>;
  if (!data) return <div className={styles.fatal}><p>{error}</p><button onClick={() => void load()}>Повторить</button></div>;

  const showAssistantSetup = profile.assistantSetupVersion < 2 && modal !== "proposal" && modal !== "import";

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
        <button className={styles.primaryButton} onClick={() => openItem()}>＋ {copy.add}</button>
        <button className={styles.changeButton} onClick={() => openQuick("plans_changed")}>⚡ {copy.changed}</button>
        <button className={styles.ghostButton} onClick={() => setModal("assistant")}>▣ {locale === "ru" ? "Автопланировщик" : "Autoplanner"}</button>
        <button className={styles.ghostButton} onClick={() => void openLegacyImport()}>↗ {copy.legacy}</button>
        {data.latestChangeSetId && <button className={styles.linkButton} onClick={() => void undo()} disabled={busy}>{copy.undo}</button>}
      </section>

      {error && <div className={styles.errorBanner}>{error}<button onClick={() => setError(null)}>×</button></div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      {tentativeSleepEvent && <div className={styles.suggestionBanner}><span>{tentativeSleepEvent.actualStartAt
        ? (locale === "ru" ? `Сон перед ${tentativeSleepEvent.wakeDate} рассчитан предварительно по середине указанного диапазона. Подтвердите фактическое засыпание.` : `Sleep before ${tentativeSleepEvent.wakeDate} is tentative and uses the midpoint of your range. Confirm the actual bedtime.`)
        : (locale === "ru" ? `Время сна перед ${tentativeSleepEvent.wakeDate} пока неизвестно. Постоянный режим защищён, но задачи не перестраивались по выдуманному времени.` : `Bedtime before ${tentativeSleepEvent.wakeDate} is still unknown. The regular schedule remains protected and no speculative task moves were made.`)}</span><button onClick={() => openSleep("bedtime", tentativeSleepEvent.wakeDate)}>{locale === "ru" ? "Ложусь сейчас" : "Going to bed now"}</button></div>}
      {data.durationSuggestions?.[0] && <div className={styles.suggestionBanner}><span>{locale === "ru" ? `После трёх выполнений «${data.durationSuggestions[0].title}» обычно занимает ${formatDuration(data.durationSuggestions[0].suggestedMinutes, locale)} вместо ${formatDuration(data.durationSuggestions[0].currentMinutes, locale)}.` : `After three completions, “${data.durationSuggestions[0].title}” usually takes ${formatDuration(data.durationSuggestions[0].suggestedMinutes, locale)} instead of ${formatDuration(data.durationSuggestions[0].currentMinutes, locale)}.`}</span><button onClick={() => void acceptDurationSuggestion(data.durationSuggestions![0].itemId, data.durationSuggestions![0].suggestedMinutes)}>{locale === "ru" ? "Обновить оценку" : "Update estimate"}</button></div>}
      {data.sleepDurationSuggestion && <div className={styles.suggestionBanner}><span>{locale === "ru" ? `${data.sleepDurationSuggestion.reason} Предлагаем увеличить цель сна с ${formatDuration(data.sleepDurationSuggestion.currentMinutes, locale)} до ${formatDuration(data.sleepDurationSuggestion.suggestedMinutes, locale)}.` : `Your last seven comparable nights suggest increasing the sleep target from ${formatDuration(data.sleepDurationSuggestion.currentMinutes, locale)} to ${formatDuration(data.sleepDurationSuggestion.suggestedMinutes, locale)}.`}</span><button onClick={() => void acceptSleepDurationSuggestion(data.sleepDurationSuggestion!.suggestedMinutes)}>{locale === "ru" ? "Посмотреть изменение" : "Review change"}</button></div>}
      {data.sleepHealthNotice && <div className={styles.warningBanner}>{locale === "ru" ? data.sleepHealthNotice : "Your sleep schedule has shifted sharply several times in the last two weeks. The planner can protect recovery time, but persistent sleepiness or sleep problems are worth discussing with a professional."}</div>}

      <nav className={styles.mobileTabs} aria-label="Planner sections">
        <button className={mobileTab === "now" ? styles.mobileTabActive : ""} onClick={() => setMobileTab("now")}>{copy.now}</button>
        <button className={mobileTab === "day" ? styles.mobileTabActive : ""} onClick={() => { setMobileTab("day"); setView("day"); }}>{copy.day}</button>
        <button className={mobileTab === "calendar" ? styles.mobileTabActive : ""} onClick={() => { setMobileTab("calendar"); if (view === "day") setView("week"); }}>{locale === "ru" ? "Календарь" : "Calendar"}</button>
        <button className={mobileTab === "inbox" ? styles.mobileTabActive : ""} onClick={() => setMobileTab("inbox")}>{copy.inbox}</button>
      </nav>

      <div className={styles.workspace}>
        <aside className={`${styles.inbox} ${mobileTab !== "inbox" ? styles.mobileHidden : ""}`}>
          <div className={styles.panelHead}><h2>{copy.inbox}</h2><span>{inbox.length}</span></div>
          <p className={styles.panelHint}>{locale === "ru" ? "Дела без подходящего времени остаются здесь — ничего не потеряется." : "Items without a safe slot stay here."}</p>
          <div className={styles.inboxList}>
            {inbox.length === 0 ? <p className={styles.emptyState}>{copy.noInbox}</p> : inbox.map((item) => (
              <article key={item.id} className={styles.inboxItem}>
                <span className={`${styles.priorityDot} ${styles[item.priority]}`} />
                <div><strong>{item.title}</strong><small>{kindLabel[locale][item.kind]} · {formatDuration(item.estimateMinutes, locale)}</small>{item.unplacedReason && <small className={styles.unplacedReason}>{locale === "ru" ? item.unplacedReason : "No safe slot matches availability, buffers and reserve."}</small>}</div>
                <button onClick={() => void run(() => createProposal({ trigger: "autoplan" }))} aria-label={`Plan ${item.title}`}>→</button>
              </article>
            ))}
          </div>
        </aside>

        <section className={`${styles.calendarPanel} ${mobileTab !== "calendar" && mobileTab !== "day" ? styles.mobileHidden : ""}`}>
          <div className={styles.calendarToolbar}>
            <div className={styles.dateNav}>
              <button onClick={() => setSelectedDate(view === "month" ? addPlannerMonths(selectedDate, -1) : addPlannerDays(selectedDate, view === "week" ? -7 : -1))}>‹</button>
              <button className={styles.todayButton} onClick={() => setSelectedDate(todayIn(profile.timezone))}>{copy.today}</button>
              <button onClick={() => setSelectedDate(view === "month" ? addPlannerMonths(selectedDate, 1) : addPlannerDays(selectedDate, view === "week" ? 7 : 1))}>›</button>
              <strong>{formatDay(selectedDate, locale, { year: "numeric", month: "long" })}</strong>
            </div>
            <div className={styles.viewTabs} role="tablist">
              {(["day", "week", "month", "agenda"] as PlannerView[]).map((mode) => (
                <button key={mode} className={view === mode ? styles.viewTabActive : ""} onClick={() => setView(mode)}>
                  {mode === "day" ? copy.day : mode === "week" ? copy.week : mode === "month" ? copy.month : copy.agenda}
                </button>
              ))}
            </div>
          </div>

          {(view === "day" || view === "week") && (
            <TimeGrid
              dates={visibleDates} blocks={blocks} sleepBlocks={sleepBlocks} profile={profile} locale={locale}
              selectedDate={selectedDate} setSelectedDate={setSelectedDate}
              onMove={moveBlock} busy={busy}
            />
          )}
          {view === "month" && (
            <MonthGrid dates={visibleDates} blocks={blocks} sleepBlocks={sleepBlocks} profile={profile} locale={locale} selectedDate={selectedDate}
              onSelect={(date) => { setSelectedDate(date); setView("day"); }} />
          )}
          {view === "agenda" && (
            <Agenda blocks={blocks} sleepBlocks={sleepBlocks} dates={visibleDates} profile={profile} locale={locale} onAction={blockAction} />
          )}
        </section>

        <aside className={`${styles.nowPanel} ${mobileTab !== "now" ? styles.mobileHidden : ""}`}>
          <div className={styles.panelHead}><h2>{copy.now}</h2><span className={styles.liveDot} /></div>
          <p className={styles.nowTime}>{formatTimeInTimeZone(now, profile.timezone)}</p>
          {currentBlock ? (
            <article className={styles.currentCard}>
              <span>{currentBlock.status === "in_progress" ? (locale === "ru" ? "В процессе" : "In progress") : (locale === "ru" ? "По плану сейчас" : "Scheduled now")}</span>
              <h3>{currentBlock.title}</h3>
              <p>{formatCountdown(currentBlock.endAt, now, locale)}</p>
              <div className={styles.quickActions}>
                {currentBlock.status !== "in_progress" && <button onClick={() => void blockAction(currentBlock, "start")}>{copy.start}</button>}
                <button className={styles.doneButton} onClick={() => void blockAction(currentBlock, "done")}>{copy.done}</button>
                {[15, 30, 60].map((minutes) => <button key={minutes} onClick={() => void blockAction(currentBlock, "snooze", minutes)}>+{minutes} {locale === "ru" ? "мин" : "min"}</button>)}
                <button onClick={() => void blockAction(currentBlock, "skip")}>{copy.skip}</button>
              </div>
            </article>
          ) : <div className={styles.freeCard}><strong>{copy.free}</strong><p>{nextBlock ? formatDuration(Math.max(0, Math.floor((new Date(nextBlock.startAt).getTime() - now.getTime()) / 60_000)), locale) : copy.empty}</p></div>}

          <div className={styles.nextSection}>
            <h3>{copy.next}</h3>
            {nextBlock ? <BlockSummary block={nextBlock} profile={profile} locale={locale} /> : <p className={styles.emptyState}>{copy.empty}</p>}
          </div>
          <div className={styles.healthCard}>
            <span>{todayHealth.overloaded ? copy.overloaded : copy.balanced}</span><strong>{todayHealth.freePercent}%</strong>
            <div><i style={{ width: `${todayHealth.freePercent}%` }} /></div>
            <small>{locale === "ru" ? `свободно сегодня; цель резерва — ${Math.round(profile.reserveRatio * 100)}%` : `free today; reserve target is ${Math.round(profile.reserveRatio * 100)}%`}</small>
          </div>
          <button className={styles.changeWide} onClick={() => openQuick("plans_changed")}>⚡ {copy.changed}</button>
          <div className={styles.sleepQuickGrid}>
            <button onClick={() => openSleep("later")}>≈ {locale === "ru" ? "Лягу позже" : "Sleeping later"}</button>
            <button onClick={() => openSleep("bedtime")}>■ {locale === "ru" ? "Ложусь сейчас" : "Bedtime now"}</button>
            <button onClick={() => openSleep("woke")}>↑ {locale === "ru" ? "Уже проснулся" : "Already woke"}</button>
            <button onClick={() => openSleep("checkin")}>? {locale === "ru" ? "Как я выспался" : "How I slept"}</button>
          </div>
        </aside>
      </div>

      {(showAssistantSetup || modal === "assistant") && <AutoplannerModal
        profile={profile}
        items={items}
        blocksCount={blocks.length}
        sleepEventsCount={data.sleepEvents.length}
        locale={locale}
        firstRun={showAssistantSetup}
        busy={busy}
        onClose={showAssistantSetup ? undefined : () => setModal(null)}
        onParseTasks={(textValue) => api<PlannerAssistantParseResult>("/api/planner/assistant/parse", { method: "POST", body: JSON.stringify({ mode: "tasks", text: textValue }) })}
        onParseSleep={(textValue) => api<PlannerSleepParseResult>("/api/planner/assistant/parse", { method: "POST", body: JSON.stringify({ mode: "sleep", text: textValue }) })}
        onPrepare={(input) => run(() => createProposal(input))}
        onOpenSleep={() => openSleep("later")}
        onReset={(password) => run(async () => {
          await api("/api/planner/reset", { method: "POST", body: JSON.stringify({ password, expectedRevision: profile.revision }) });
          try { window.localStorage.removeItem("itemkey.planner.autoplanner.v2"); } catch { /* optional draft storage */ }
          setModal(null);
          await load(true);
        })}
      />}
      {modal === "sleep" && <SleepChangedModal profile={profile} locale={locale} busy={busy} initialMode={sleepModalMode} initialWakeDate={sleepModalWakeDate} onClose={() => setModal(null)} onSubmit={(sleepEvent: PlannerSleepEvent) => run(() => createProposal({ sleepEvent, trigger: "sleep_changed", rebuildFuture: Boolean(sleepEvent.actualStartAt) }))} onCheckIn={checkInSleep} />}
      {modal === "quick" && <QuickModal command={quickCommand} setCommand={setQuickCommand} onSubmit={submitQuick} onClose={() => setModal(null)} trigger={quickTrigger} busy={busy} locale={locale} />}
      {modal === "item" && <ItemModal value={itemForm} setValue={setItemForm} onSubmit={submitItem} onClose={() => setModal(null)} busy={busy} locale={locale} />}
      {modal === "proposal" && proposal && <ProposalModal proposal={proposal} profile={profile} locale={locale} busy={busy}
        onClose={() => setModal(null)} onApply={applyProposal} onEdit={() => proposal.normalizedDraft ? openItem(proposal.normalizedDraft) : setModal(proposal.trigger === "sleep_changed" ? "sleep" : "settings")}
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
      {modal === "settings" && <SettingsModal profile={profile} locale={locale} busy={busy} onClose={() => setModal(null)} onSave={(profilePatch) => run(() => createProposal({ profilePatch, trigger: "assistant_update", rebuildFuture: true }))} />}
      {modal === "stats" && <StatsModal blocks={blocks} items={items} profile={profile} locale={locale} onClose={() => setModal(null)} />}
      {modal === "import" && <LegacyImportModal key={legacySources.map((source) => `${source.sourceKey}:${source.alreadyImported}`).join("|")} sources={legacySources} locale={locale} busy={busy} loading={legacyLoading} onClose={() => setModal(null)} onImport={importLegacy} />}
    </main>
  );
}

function TimeGrid({ dates, blocks, sleepBlocks, profile, locale, selectedDate, setSelectedDate, onMove, busy }: {
  dates: string[]; blocks: PlannerBlock[]; sleepBlocks: PlannerSleepBlock[]; profile: PlannerProfile; locale: Locale;
  selectedDate: string; setSelectedDate: (date: string) => void;
  onMove: (block: PlannerBlock, startAt: string, endAt: string) => Promise<void>; busy: boolean;
}) {
  const calendarBlocks: CalendarBlock[] = [...blocks, ...splitSleepBlocksByDate(sleepBlocks, dates, profile.timezone)];
  const relevantWindows = dates.flatMap((date) => profile.availability[String(plannerWeekday(date))] ?? []);
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
  const [dragId, setDragId] = useState<string | null>(null);

  async function drop(event: DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    const block = blocks.find((candidate) => candidate.id === dragId);
    setDragId(null);
    if (!block) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const minute = Math.min(dayEnd - 15, Math.round((dayStart + ratio * (dayEnd - dayStart)) / 15) * 15);
    const startAt = zonedPlannerDateTimeToUtc(date, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, profile.timezone);
    await onMove(block, startAt, addIsoMinutes(startAt, isoDurationMinutes(block.startAt, block.endAt)));
  }

  function keyboard(event: KeyboardEvent<HTMLElement>, block: PlannerBlock) {
    if (!event.altKey) return;
    const delta = event.key === "ArrowUp" ? -15 : event.key === "ArrowDown" ? 15 : 0;
    if (!delta) return;
    event.preventDefault();
    void onMove(block, addIsoMinutes(block.startAt, delta), addIsoMinutes(block.endAt, delta));
  }

  return (
    <div className={styles.timeGridShell}>
      <div className={styles.dayHeaders} style={{ gridTemplateColumns: `4.2rem repeat(${dates.length}, minmax(8rem, 1fr))` }}>
        <span />{dates.map((date) => <button key={date} className={date === selectedDate ? styles.selectedDay : ""} onClick={() => setSelectedDate(date)}>{formatDay(date, locale, { weekday: "short" })}</button>)}
      </div>
      <div className={styles.timeGrid} style={{ gridTemplateColumns: `4.2rem repeat(${dates.length}, minmax(8rem, 1fr))`, minWidth: `${4.2 + dates.length * 8}rem` }}>
        <div className={styles.timeAxis} style={{ height }}>{hours.map((hour) => <span key={hour} style={{ top: `${((hour * 60 - dayStart) / (dayEnd - dayStart)) * 100}%` }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
        {dates.map((date) => (
          <div key={date} className={styles.dayColumn} style={{ height }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void drop(event, date)}>
            {hours.map((hour) => <i key={hour} style={{ top: `${((hour * 60 - dayStart) / (dayEnd - dayStart)) * 100}%` }} />)}
            {calendarBlocks.filter((block) => localDate(block, profile.timezone) === date && (isSleepBlock(block) || !["cancelled", "skipped"].includes(block.status))).map((block) => {
              const sleep = isSleepBlock(block);
              const start = minutesInZone(block.startAt, profile.timezone);
              const duration = isoDurationMinutes(block.startAt, block.endAt);
              const top = ((start - dayStart) / (dayEnd - dayStart)) * 100;
              const size = Math.max(2.3, (duration / (dayEnd - dayStart)) * 100);
              return (
                <article key={block.id} draggable={!sleep && !busy && block.status === "planned"} onDragStart={() => { if (!sleep) setDragId(block.id); }} onKeyDown={(event) => { if (!sleep) keyboard(event, block); }} tabIndex={0}
                  className={`${styles.calendarBlock} ${sleep ? styles.sleepBlock : styles[block.fixed ? "fixedBlock" : "flexibleBlock"]} ${sleep && block.tentative ? styles.sleepTentative : ""} ${sleep && block.recoveryNight ? styles.sleepRecovery : ""} ${!sleep && block.status !== "planned" ? styles[block.status] ?? "" : ""}`} style={{ top: `${top}%`, height: `${size}%` }}>
                  <strong>{sleep ? "■" : block.fixed ? "◆" : "↝"} {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)} · {sleep ? block.tentative ? (locale === "ru" ? "СОН · ПРЕДВАРИТЕЛЬНО" : "SLEEP · TENTATIVE") : block.recoveryNight ? (locale === "ru" ? "СОН · ВОССТАНОВЛЕНИЕ" : "SLEEP · RECOVERY") : (locale === "ru" ? "СОН · ЗАЩИЩЕНО" : "SLEEP · PROTECTED") : block.title}</strong>
                  <small>{formatDuration(duration, locale)}{sleep ? ` · ${locale === "ru" ? "не перемещается" : "locked"}` : ""}</small>
                  {!sleep && block.status === "planned" && <div className={styles.resizeActions}>
                    <button onClick={() => void onMove(block, block.startAt, addIsoMinutes(block.endAt, -15))} aria-label="Shorten 15 minutes">−</button>
                    <button onClick={() => void onMove(block, block.startAt, addIsoMinutes(block.endAt, 15))} aria-label="Extend 15 minutes">＋</button>
                  </div>}
                </article>
              );
            })}
            {date === todayIn(profile.timezone) && <div className={styles.nowLine} style={{ top: `${((minutesInZone(new Date().toISOString(), profile.timezone) - dayStart) / (dayEnd - dayStart)) * 100}%` }} />}
          </div>
        ))}
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
      <div>{dayBlocks.slice(0, 3).map((block) => <i key={block.id} className={isSleepBlock(block) ? styles.sleepPill : block.fixed ? styles.fixedPill : styles.flexPill}>{isSleepBlock(block) ? "■" : block.fixed ? "◆" : "↝"} {isSleepBlock(block) ? (locale === "ru" ? "Сон" : "Sleep") : block.title}</i>)}</div>
      {dayBlocks.length > 3 && <small>+{dayBlocks.length - 3}</small>}
    </button>;
  })}</div>;
}

function Agenda({ blocks, sleepBlocks, dates, profile, locale, onAction }: {
  blocks: PlannerBlock[]; sleepBlocks: PlannerSleepBlock[]; dates: string[]; profile: PlannerProfile; locale: Locale;
  onAction: (block: PlannerBlock, action: string, minutes?: number) => Promise<unknown>;
}) {
  const selected: CalendarBlock[] = [...blocks.filter((block) => dates.includes(localDate(block, profile.timezone)) && block.status !== "cancelled"), ...splitSleepBlocksByDate(sleepBlocks, dates, profile.timezone)].sort((a, b) => a.startAt.localeCompare(b.startAt));
  return <div className={styles.agenda}>{selected.map((block) => <article key={block.id}>
    <time>{formatDay(localDate(block, profile.timezone), locale)} · {formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}</time>
    <div><strong>{isSleepBlock(block) ? (locale === "ru" ? "Сон · защищено" : "Sleep · protected") : block.title}</strong><small>{formatDuration(isoDurationMinutes(block.startAt, block.endAt), locale)}{isSleepBlock(block) ? "" : ` · ${block.status}`}</small></div>
    {!isSleepBlock(block) && block.status === "planned" && <div><button onClick={() => void onAction(block, "start")}>▶</button><button onClick={() => void onAction(block, "done")}>✓</button><button onClick={() => void onAction(block, "skip")}>↷</button></div>}
  </article>)}</div>;
}

function BlockSummary({ block, profile, locale }: { block: PlannerBlock; profile: PlannerProfile; locale: Locale }) {
  return <article className={styles.blockSummary}><span>{formatDay(localDate(block, profile.timezone), locale)}</span><strong>{block.title}</strong><small>{formatTimeInTimeZone(new Date(block.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(block.endAt), profile.timezone)}</small></article>;
}

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose?: () => void; title: string }) {
  return <div className={styles.modalBackdrop} role="presentation"><section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2>{onClose && <button onClick={onClose} aria-label="Close">×</button>}</header>{children}
  </section></div>;
}

function QuickModal({ command, setCommand, onSubmit, onClose, trigger, busy, locale }: {
  command: string; setCommand: (value: string) => void; onSubmit: (event: FormEvent) => Promise<void>;
  onClose: () => void; trigger: PlannerProposal["trigger"]; busy: boolean; locale: Locale;
}) {
  const changed = trigger === "plans_changed";
  return <ModalShell title={changed ? (locale === "ru" ? "Что изменилось?" : "What changed?") : (locale === "ru" ? "Быстрое добавление" : "Quick add")} onClose={onClose}>
    <form onSubmit={(event) => void onSubmit(event)} className={styles.form}>
      <p className={styles.modalLead}>{locale === "ru" ? "Напишите как обычно. Перед применением вы увидите распознанные поля и все переносы." : "Use natural language. You will review every parsed field and move before applying."}</p>
      <textarea autoFocus value={command} onChange={(e) => setCommand(e.target.value)} placeholder={locale === "ru" ? "Сегодня позвали гулять с 18 до 20" : "Meeting today from 18 to 20"} />
      <div className={styles.modalActions}><button type="button" onClick={onClose}>{locale === "ru" ? "Отмена" : "Cancel"}</button><button className={styles.primaryButton} disabled={busy || !command.trim()}>{locale === "ru" ? "Проверить план" : "Review plan"}</button></div>
    </form>
  </ModalShell>;
}

function ItemModal({ value, setValue, onSubmit, onClose, busy, locale }: {
  value: ItemForm; setValue: React.Dispatch<React.SetStateAction<ItemForm>>;
  onSubmit: (event: FormEvent) => Promise<void>; onClose: () => void; busy: boolean; locale: Locale;
}) {
  const update = <K extends keyof ItemForm>(key: K, next: ItemForm[K]) => setValue((current) => ({ ...current, [key]: next }));
  return <ModalShell title={locale === "ru" ? "Дело и его ограничения" : "Item and constraints"} onClose={onClose}>
    <form onSubmit={(event) => void onSubmit(event)} className={styles.form}>
      <div className={styles.formGrid}>
        <label className={styles.wide}>{locale === "ru" ? "Название" : "Title"}<input autoFocus required value={value.title} onChange={(e) => update("title", e.target.value)} /></label>
        <label>{locale === "ru" ? "Вид" : "Type"}<select value={value.kind} onChange={(e) => update("kind", e.target.value as PlannerItemKind)}>{Object.entries(kindLabel[locale]).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
        <label>{locale === "ru" ? "Длительность, мин" : "Duration, min"}<input type="number" min="5" max="1440" value={value.estimateMinutes} onChange={(e) => update("estimateMinutes", e.target.value)} /></label>
        {value.kind === "fixed_event" && <><label>{locale === "ru" ? "Дата" : "Date"}<input type="date" required value={value.date} onChange={(e) => update("date", e.target.value)} /></label><label>{locale === "ru" ? "Начало" : "Start"}<input type="time" required value={value.start} onChange={(e) => update("start", e.target.value)} /></label><label>{locale === "ru" ? "Конец" : "End"}<input type="time" value={value.end} onChange={(e) => update("end", e.target.value)} /></label></>}
        {value.kind !== "fixed_event" && <label>{locale === "ru" ? "Дедлайн" : "Deadline"}<input type="date" value={value.deadline} onChange={(e) => update("deadline", e.target.value)} /></label>}
        {value.kind === "routine" && <label>{locale === "ru" ? "Повтор" : "Repeat"}<select value={value.recurrenceFrequency} onChange={(e) => update("recurrenceFrequency", e.target.value as ItemForm["recurrenceFrequency"])}><option value="daily">{locale === "ru" ? "Каждый день" : "Daily"}</option><option value="weekly">{locale === "ru" ? "Раз в неделю" : "Weekly"}</option><option value="custom">{locale === "ru" ? "По дням" : "Weekdays"}</option></select></label>}
      </div>
      {value.kind === "routine" && value.recurrenceFrequency === "custom" && <div className={styles.weekdays}>{[1,2,3,4,5,6,7].map((day) => <button type="button" key={day} className={value.recurrenceWeekdays.includes(day) ? styles.weekdayActive : ""} onClick={() => update("recurrenceWeekdays", value.recurrenceWeekdays.includes(day) ? value.recurrenceWeekdays.filter((candidate) => candidate !== day) : [...value.recurrenceWeekdays, day])}>{locale === "ru" ? ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"][day-1] : ["M","T","W","T","F","S","S"][day-1]}</button>)}</div>}
      <details className={styles.advanced}><summary>{locale === "ru" ? "Дополнительно" : "Advanced"}</summary><div className={styles.formGrid}>
        <label>{locale === "ru" ? "Приоритет" : "Priority"}<select value={value.priority} onChange={(e) => update("priority", e.target.value as PlannerPriority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label>{locale === "ru" ? "Энергия" : "Energy"}<select value={value.energy} onChange={(e) => update("energy", e.target.value as PlannerEnergy)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        <label>{locale === "ru" ? "Предпочитать с" : "Prefer from"}<input type="time" value={value.preferredStart} onChange={(e) => update("preferredStart", e.target.value)} /></label><label>{locale === "ru" ? "до" : "to"}<input type="time" value={value.preferredEnd} onChange={(e) => update("preferredEnd", e.target.value)} /></label>
        <label>{locale === "ru" ? "Не ставить с" : "Avoid from"}<input type="time" value={value.avoidedStart} onChange={(e) => update("avoidedStart", e.target.value)} /></label><label>{locale === "ru" ? "до" : "to"}<input type="time" value={value.avoidedEnd} onChange={(e) => update("avoidedEnd", e.target.value)} /></label>
        <label>{locale === "ru" ? "Буфер до, мин" : "Buffer before"}<input type="number" min="0" value={value.bufferBeforeMinutes} onChange={(e) => update("bufferBeforeMinutes", e.target.value)} /></label><label>{locale === "ru" ? "Буфер после, мин" : "Buffer after"}<input type="number" min="0" value={value.bufferAfterMinutes} onChange={(e) => update("bufferAfterMinutes", e.target.value)} /></label>
        <label>{locale === "ru" ? "Область" : "Area"}<input value={value.area} onChange={(e) => update("area", e.target.value)} /></label><label>{locale === "ru" ? "Место" : "Location"}<input value={value.location} onChange={(e) => update("location", e.target.value)} /></label>
        {value.kind !== "fixed_event" && <label className={styles.checkbox}><input type="checkbox" checked={value.canSplit} onChange={(e) => update("canSplit", e.target.checked)} />{locale === "ru" ? "Можно делить" : "Can split"}</label>}
        {value.canSplit && <label>{locale === "ru" ? "Минимальная часть, мин" : "Minimum chunk"}<input type="number" min="5" value={value.minChunkMinutes} onChange={(e) => update("minChunkMinutes", e.target.value)} /></label>}
        <label className={styles.wide}>{locale === "ru" ? "Заметки" : "Notes"}<textarea value={value.notes} onChange={(e) => update("notes", e.target.value)} /></label>
      </div></details>
      <div className={styles.modalActions}><button type="button" onClick={onClose}>{locale === "ru" ? "Отмена" : "Cancel"}</button><button className={styles.primaryButton} disabled={busy || !value.title.trim()}>{locale === "ru" ? "Показать изменения" : "Review changes"}</button></div>
    </form>
  </ModalShell>;
}

function proposalChangeReason(change: PlannerProposal["changes"][number], locale: Locale): string {
  if (locale === "ru") return change.reason;
  if (change.kind === "update_profile") return "Planner settings were confirmed in the reviewed assistant flow.";
  if (change.kind === "upsert_sleep_event") return "This night was adjusted without changing the regular sleep schedule.";
  if (change.kind === "add_item") return "The new item was confirmed from the reviewed form.";
  if (change.kind === "update_item") return change.item.unplacedReason
    ? "The reason was saved with the item in the inbox."
    : "A safe slot was found and the previous inbox reason was cleared.";
  if (change.kind === "move_block") return "Flexible work was moved around the new fixed commitment.";
  if (change.kind === "remove_block") return "No safe replacement slot was found, so the item returns to the inbox.";
  return change.block.fixed
    ? "The fixed event keeps the exact reviewed time."
    : "A free slot was selected using priority, energy, preferences and workload.";
}

function proposalChangeTitle(change: PlannerProposal["changes"][number], locale: Locale): string {
  if (change.kind === "update_profile") return locale === "ru" ? "Настройки плана" : "Planner settings";
  if (change.kind === "upsert_sleep_event") return locale === "ru" ? `Сон перед ${change.event.wakeDate}` : `Sleep before ${change.event.wakeDate}`;
  if (change.kind === "add_block") return change.block.title;
  if (change.kind === "move_block" || change.kind === "remove_block") return change.title;
  return change.item.title;
}

function ProposalModal({ proposal, profile, locale, busy, onClose, onApply, onEdit, onPause, onFinishFirst, onAddRecoveryNap }: {
  proposal: PlannerProposal; profile: PlannerProfile; locale: Locale; busy: boolean;
  onClose: () => void; onApply: () => Promise<void>; onEdit: () => void; onPause: (blockId: string) => Promise<void>; onFinishFirst: (blockId: string, protectedId: string) => Promise<void>;
  onAddRecoveryNap: (nap: NonNullable<PlannerProposal["recoveryAdvice"]>["nap"] & {}) => Promise<void>;
}) {
  return <ModalShell title={locale === "ru" ? "Предпросмотр нового плана" : "Plan preview"} onClose={onClose}>
    <div className={styles.proposal}>
      {proposal.normalizedDraft && <section className={styles.parsed}><span>{locale === "ru" ? "Распознано — проверьте перед созданием" : "Parsed — review before creating"}</span><strong>{proposal.normalizedDraft.title}</strong><p>{kindLabel[locale][proposal.normalizedDraft.kind ?? "flexible_task"]} · {formatDuration(proposal.normalizedDraft.estimateMinutes ?? 60, locale)}{proposal.normalizedDraft.date ? ` · ${formatDay(proposal.normalizedDraft.date, locale)}` : ""}{proposal.normalizedDraft.start ? ` · ${proposal.normalizedDraft.start}` : ""}{proposal.normalizedDraft.end ? `–${proposal.normalizedDraft.end}` : ""} · {locale === "ru" ? "приоритет" : "priority"}: {proposal.normalizedDraft.priority ?? "normal"}</p><button onClick={onEdit}>{locale === "ru" ? "Изменить поля" : "Edit fields"}</button></section>}
      {proposal.conflicts.length > 0 && <section className={styles.conflicts}><h3>{locale === "ru" ? "Нужно ваше решение" : "Your decision is needed"}</h3>{proposal.conflicts.map((conflict) => <article key={conflict.id}><strong>{conflict.title}</strong><p>{locale === "ru" ? conflict.message : conflict.kind === "active_overlap" ? "The protected time overlaps work already in progress. Pause it, finish first, or edit the new input." : conflict.blockIds.some((id) => id.startsWith("sleep-")) ? "A fixed event overlaps protected sleep. Edit the event or sleep input." : "Two fixed events overlap and cannot be moved automatically."}</p>{conflict.kind === "active_overlap" ? <div><button onClick={() => void onPause(conflict.blockIds[0])}>{locale === "ru" ? "Поставить текущее на паузу" : "Pause current"}</button><button onClick={() => void onFinishFirst(conflict.blockIds[0], conflict.blockIds[1])}>{locale === "ru" ? "Закончить текущее сначала" : "Finish current first"}</button><button onClick={onEdit}>{proposal.trigger === "sleep_changed" ? (locale === "ru" ? "Исправить сон" : "Edit sleep") : (locale === "ru" ? "Изменить вводные" : "Edit input")}</button></div> : <div><button onClick={onEdit}>{locale === "ru" ? "Исправить конфликт" : "Edit conflict"}</button></div>}</article>)}</section>}
      <section><h3>{locale === "ru" ? "Изменения" : "Changes"}</h3><div className={styles.changeList}>{proposal.changes.map((change) => <article key={change.id}>
        <span>{change.kind === "add_block" ? "+" : change.kind === "move_block" ? "→" : change.kind === "remove_block" ? "−" : change.kind === "upsert_sleep_event" ? "■" : "•"}</span>
        <div><strong>{proposalChangeTitle(change, locale)}</strong><p>{proposalChangeReason(change, locale)}</p>{change.kind === "add_block" && <small>{formatDay(localDate(change.block, profile.timezone), locale)} · {formatTimeInTimeZone(new Date(change.block.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(change.block.endAt), profile.timezone)}</small>}{change.kind === "move_block" && <small>{formatTimeInTimeZone(new Date(change.fromStartAt), profile.timezone)} → {formatDay(formatDateInTimeZone(new Date(change.toStartAt), profile.timezone), locale)} {formatTimeInTimeZone(new Date(change.toStartAt), profile.timezone)}</small>}{change.kind === "upsert_sleep_event" && <small>{change.event.actualStartAt && (change.event.actualEndAt ?? change.event.projectedEndAt) ? `${change.event.state === "tentative" ? (locale === "ru" ? "предварительно · " : "tentative · ") : ""}${formatTimeInTimeZone(new Date(change.event.actualStartAt), profile.timezone)}–${formatTimeInTimeZone(new Date(change.event.actualEndAt ?? change.event.projectedEndAt!), profile.timezone)}` : (locale === "ru" ? "Время неизвестно: расписание пока не перестраивается" : "Time unknown: schedule is not rebuilt yet")}</small>}</div>
      </article>)}</div></section>
      {proposal.unplaced.length > 0 && <section className={styles.unplaced}><h3>{locale === "ru" ? "Останется в очереди" : "Will stay in inbox"}</h3>{proposal.unplaced.map((item, index) => <article key={`${item.itemId}-${item.remainingMinutes}-${index}`}><strong>{item.title} · {formatDuration(item.remainingMinutes, locale)}</strong><p>{locale === "ru" ? item.reason : "No free slot satisfies availability, buffers and the protected reserve. The duration was not shortened."}</p></article>)}</section>}
      {proposal.recoveryAdvice && <section className={styles.recoveryPanel}><h3>{locale === "ru" ? "Восстановление" : "Recovery"}</h3><p>{locale === "ru" ? `Недосып относительно цели: ${formatDuration(proposal.recoveryAdvice.deficitMinutes, locale)}. Дополнительное время распределяется максимум на ${proposal.recoveryAdvice.recoveryNights} ночи.` : `Sleep below target: ${formatDuration(proposal.recoveryAdvice.deficitMinutes, locale)}. Extra sleep opportunity is spread across up to ${proposal.recoveryAdvice.recoveryNights} nights.`}</p>{proposal.recoveryAdvice.nap ? <article><strong>{locale === "ru" ? "Можно добавить короткий сон" : "A short nap is available"}</strong><small>{formatDay(formatDateInTimeZone(new Date(proposal.recoveryAdvice.nap.startAt), profile.timezone), locale)} · {formatTimeInTimeZone(new Date(proposal.recoveryAdvice.nap.startAt), profile.timezone)}–{formatTimeInTimeZone(new Date(proposal.recoveryAdvice.nap.endAt), profile.timezone)}</small><p>{locale === "ru" ? proposal.recoveryAdvice.nap.reason : "The slot ends before 15:00 and stays at least six hours away from night sleep."}</p><button type="button" onClick={() => void onAddRecoveryNap(proposal.recoveryAdvice!.nap!)}>{locale === "ru" ? "Добавить в этот план" : "Add to this plan"}</button></article> : <p>{locale === "ru" ? "Безопасного окна для короткого дневного сна сейчас нет — оно не будет добавлено автоматически." : "There is no suitable short-nap window, so none will be added automatically."}</p>}</section>}
      <div className={styles.modalActions}><button onClick={onClose}>{locale === "ru" ? "Не применять" : "Cancel"}</button><button className={styles.primaryButton} disabled={busy || proposal.conflicts.length > 0} onClick={() => void onApply()}>{locale === "ru" ? "Применить весь план" : "Apply full plan"}</button></div>
    </div>
  </ModalShell>;
}

function SettingsModal({ profile, locale, busy, onClose, onSave }: { profile: PlannerProfile; locale: Locale; busy: boolean; onClose: () => void; onSave: (patch: Partial<PlannerProfile>) => Promise<void> }) {
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
  return <ModalShell title={locale === "ru" ? "Настройки плана" : "Planner settings"} onClose={onClose}><form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    const sleepSchedule = sleepTouched
      ? { mode: "fixed" as const, weekdays: { bedtime: form.weekdayBedtime, durationMinutes: Number(form.weekdaySleep) }, weekends: { bedtime: form.weekendBedtime, durationMinutes: Number(form.weekendSleep) } }
      : profile.sleepSchedule;
    void onSave({ timezone: form.timezone, horizon: form.horizon, reserveRatio: Number(form.reserve) / 100, defaultBufferMinutes: Number(form.buffer), availability: sleepTouched && !availabilityTouched ? availabilityFromSleepSchedule(sleepSchedule) : form.availability, energyWindows: form.energyWindows, sleepSchedule });
  }}>{profile.sleepSchedule.mode === "adaptive" && <p className={styles.sleepHint}>{locale === "ru" ? "Сейчас включён адаптивный сон. Изменение точных полей ниже переключит режим на фиксированный; остальные настройки можно менять без переключения." : "Adaptive sleep is active. Editing the exact sleep fields below switches to fixed mode; other settings keep adaptive mode."}</p>}<div className={styles.formGrid}>
    <label>{locale === "ru" ? "Часовой пояс" : "Time zone"}<input value={form.timezone} onChange={(e) => setForm((v) => ({ ...v, timezone: e.target.value }))} /></label><label>{locale === "ru" ? "Горизонт" : "Horizon"}<select value={form.horizon} onChange={(e) => setForm((v) => ({ ...v, horizon: e.target.value as PlannerHorizon }))}><option value="week">7 days</option><option value="two_weeks">14 days</option><option value="month">30 days</option></select></label>
    <label>{locale === "ru" ? "Резерв, %" : "Reserve, %"}<input type="number" min="0" max="60" value={form.reserve} onChange={(e) => setForm((v) => ({ ...v, reserve: e.target.value }))} /></label><label>{locale === "ru" ? "Буфер, мин" : "Buffer, min"}<input type="number" min="0" max="120" value={form.buffer} onChange={(e) => setForm((v) => ({ ...v, buffer: e.target.value }))} /></label>
    <label>{locale === "ru" ? "Сон перед буднями" : "Weekday bedtime"}<input type="time" value={form.weekdayBedtime} onChange={(e) => { setSleepTouched(true); setForm((v) => ({ ...v, weekdayBedtime: e.target.value })); }} /></label><label>{locale === "ru" ? "Длительность, мин" : "Duration, min"}<input type="number" min="180" max="960" value={form.weekdaySleep} onChange={(e) => { setSleepTouched(true); setForm((v) => ({ ...v, weekdaySleep: e.target.value })); }} /></label>
    <label>{locale === "ru" ? "Сон перед выходными" : "Weekend bedtime"}<input type="time" value={form.weekendBedtime} onChange={(e) => { setSleepTouched(true); setForm((v) => ({ ...v, weekendBedtime: e.target.value })); }} /></label><label>{locale === "ru" ? "Длительность, мин" : "Duration, min"}<input type="number" min="180" max="960" value={form.weekendSleep} onChange={(e) => { setSleepTouched(true); setForm((v) => ({ ...v, weekendSleep: e.target.value })); }} /></label>
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
  return <ModalShell title={locale === "ru" ? "Перенос старых расписаний" : "Import old plans"} onClose={onClose}>
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

function StatsModal({ blocks, items, profile, locale, onClose }: { blocks: PlannerBlock[]; items: PlannerItem[]; profile: PlannerProfile; locale: Locale; onClose: () => void }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const until = todayIn(profile.timezone);
  const from = addPlannerDays(until, period === "week" ? -6 : -29);
  const scopedBlocks = blocks.filter((block) => {
    const date = localDate(block, profile.timezone);
    return date >= from && date <= until;
  });
  const done = scopedBlocks.filter((block) => block.status === "done");
  const skipped = scopedBlocks.filter((block) => block.status === "skipped");
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
    const available = (profile.availability[String(plannerWeekday(date))] ?? []).reduce((sum, window) => {
      const start = plannerTimeToMinutes(window.start);
      const end = plannerTimeToMinutes(window.end);
      return sum + ((end - start + 1440) % 1440 || 1440);
    }, 0);
    return available > 0 && minutes > available * (1 - profile.reserveRatio);
  }).length;
  const plannedMinutes = done.reduce((sum, block) => sum + isoDurationMinutes(block.startAt, block.endAt), 0);
  const actualMinutes = actual.reduce((sum, block) => sum + isoDurationMinutes(block.actualStartAt!, block.actualEndAt!), 0);
  return <ModalShell title={locale === "ru" ? "План и факт" : "Plan vs actual"} onClose={onClose}><div className={styles.statsPeriod}><button className={period === "week" ? styles.viewTabActive : ""} onClick={() => setPeriod("week")}>{locale === "ru" ? "7 дней" : "7 days"}</button><button className={period === "month" ? styles.viewTabActive : ""} onClick={() => setPeriod("month")}>{locale === "ru" ? "30 дней" : "30 days"}</button></div><div className={styles.statsGrid}><article><span>{locale === "ru" ? "Выполнено" : "Done"}</span><strong>{done.length}</strong></article><article><span>{locale === "ru" ? "Пропущено" : "Skipped"}</span><strong>{skipped.length}</strong></article><article><span>{locale === "ru" ? "План / факт" : "Plan / actual"}</span><strong>{formatDuration(plannedMinutes, locale)} / {formatDuration(actualMinutes, locale)}</strong></article><article><span>{locale === "ru" ? "Точность оценки" : "Estimate accuracy"}</span><strong>{accuracy}%</strong></article><article><span>Routines</span><strong>{routineRate}%</strong></article><article><span>{locale === "ru" ? "Перегруженные дни" : "Overloaded days"}</span><strong>{overloaded}</strong></article><article><span>{locale === "ru" ? "Защищённый резерв" : "Protected reserve"}</span><strong>{Math.round(profile.reserveRatio * 100)}%</strong></article></div></ModalShell>;
}
