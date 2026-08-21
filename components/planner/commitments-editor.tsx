"use client";

import { useEffect, useMemo, useState } from "react";

import type { Locale } from "@/lib/i18n";
import {
  normalizeStructuredCommitment,
  plannerCommitmentCategoryLabel,
  plannerCommitmentDuration,
  plannerDurationLabel,
  plannerTravelModeLabel,
  type PlannerCommitmentCategory,
  type PlannerSavedPlace,
  type PlannerStructuredCommitment,
  type PlannerTravelEstimateInput,
  type PlannerTravelEstimateResult,
  type PlannerTravelMode,
} from "@/lib/planner/commitments";
import type { PlannerDeadlineType, PlannerPriority } from "@/lib/planner/types";
import { createRuntimeId } from "@/lib/runtime-id";
import DurationInput from "./duration-input";
import styles from "./planner-workspace.module.css";

const PLACES_STORAGE_KEY = "itemkey.planner.saved-places.v1";
const CATEGORIES: PlannerCommitmentCategory[] = ["work", "education", "health", "sport", "personal", "other"];
const TRAVEL_MODES: PlannerTravelMode[] = ["walk", "transit", "car"];
const PRIORITIES: PlannerPriority[] = ["low", "normal", "high", "critical"];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

type OriginMode = "home" | "saved" | "temporary";
type DestinationMode = "home" | "saved" | "temporary";

function validPlaces(value: unknown): PlannerSavedPlace[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PlannerSavedPlace[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<PlannerSavedPlace>;
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string" || typeof candidate.address !== "string") return [];
    if (candidate.kind !== "home" && candidate.kind !== "saved") return [];
    return [{ id: candidate.id, label: candidate.label.slice(0, 80), address: candidate.address.slice(0, 240), kind: candidate.kind }];
  }).slice(0, 30);
}

function blankCommitment(title: string): PlannerStructuredCommitment {
  return normalizeStructuredCommitment({
    id: createRuntimeId(),
    title: title.trim(),
    category: "other",
    occurrenceMode: "once",
    weekdays: [],
    timeMode: "flexible",
    startTime: "",
    endTime: "",
    durationMinutes: 60,
    durationMode: "per_occurrence",
    priority: "normal",
    deadlineType: "none",
    canSplit: false,
    minChunkMinutes: 25,
    travel: {
      enabled: false,
      mode: "transit",
      direction: "one_way",
      durationMinutes: 30,
      bufferMinutes: 10,
    },
  });
}

export default function CommitmentsEditor({
  commitments,
  locale,
  onChange,
  onEstimateTravel,
  onEditingChange,
}: {
  commitments: PlannerStructuredCommitment[];
  locale: Locale;
  onChange: (commitments: PlannerStructuredCommitment[]) => void;
  onEstimateTravel: (input: PlannerTravelEstimateInput) => Promise<PlannerTravelEstimateResult>;
  onEditingChange?: (editing: boolean) => void;
}) {
  const ru = locale === "ru";
  const [quickTitle, setQuickTitle] = useState("");
  const [editor, setEditorState] = useState<PlannerStructuredCommitment | null>(null);
  const [places, setPlaces] = useState<PlannerSavedPlace[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(PLACES_STORAGE_KEY);
      return stored ? validPlaces(JSON.parse(stored)) : [];
    } catch {
      return [];
    }
  });
  const [originMode, setOriginMode] = useState<OriginMode>("home");
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [originAddress, setOriginAddress] = useState("");
  const [originLabel, setOriginLabel] = useState("");
  const [rememberOrigin, setRememberOrigin] = useState(false);
  const [destinationMode, setDestinationMode] = useState<DestinationMode>("temporary");
  const [selectedDestinationPlaceId, setSelectedDestinationPlaceId] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [rememberDestination, setRememberDestination] = useState(false);
  const [formError, setFormError] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState("");

  const copy = ru ? {
    addPlaceholder: "Учёба, покупка, встреча или любое другое дело",
    add: "Добавить дело",
    empty: "Пока ничего не добавлено. Каждое дело появится здесь отдельной карточкой.",
    edit: "Изменить",
    remove: "Удалить",
    what: "1. Что это за дело",
    title: "Название",
    category: "Тип дела",
    when: "2. Когда и как часто",
    once: "Один раз",
    recurring: "Регулярно",
    date: "Дата",
    optionalDate: "Дата (необязательно)",
    dateHint: "Если оставить пустым, сайт выберет подходящий день в горизонте планирования.",
    days: "Дни недели",
    timing: "3. Как выбирать время",
    fixed: "Точное время",
    flexible: "Подобрать автоматически",
    fixedHint: "Дело останется в указанных временных рамках.",
    flexibleHint: "Укажите длительность — точное начало и время выезда подберёт сайт.",
    start: "Начало",
    end: "Конец",
    activityDuration: "Длительность дела",
    durationMeaning: "Что означает эта длительность?",
    perOccurrence: "Столько в каждый выбранный день",
    perOccurrenceHint: "Например, 1 час в понедельник, среду и пятницу — по 1 часу в каждый день.",
    perCycle: "Столько всего на выбранные дни",
    perCycleHint: "Например, 3 часа за неделю — сайт распределит их только между выбранными днями.",
    allowedFrom: "Можно начать не раньше",
    allowedTo: "Дело должно закончиться до",
    allowedHint: "Оба поля необязательны. Интервал ограничивает само дело, но не дорогу.",
    planning: "4. Важность и срок",
    priority: "Приоритет",
    deadlineType: "Срок",
    noDeadline: "Без срока",
    targetDeadline: "Желательный",
    hardDeadline: "Жёсткий",
    deadlineDate: "Дата срока",
    deadlineTime: "Время срока",
    canSplit: "Можно разделить дело на части",
    minChunk: "Минимальная часть",
    road: "5. Нужно ли добираться",
    noRoad: "Нет, дорога не нужна",
    hasRoad: "Да, учесть дорогу",
    from: "Откуда вы обычно едете",
    home: "Из дома",
    saved: "Из сохранённого места",
    temporary: "Другой адрес — не запоминать",
    homeAddress: "Адрес дома",
    savedPlace: "Сохранённое место",
    address: "Адрес отправления",
    placeName: "Как назвать место",
    remember: "Запомнить это место для следующих дел",
    to: "Куда ехать",
    toHome: "Домой",
    toSaved: "В сохранённое место",
    toTemporary: "Другой адрес",
    destinationAddress: "Адрес назначения",
    rememberDestination: "Запомнить место назначения для следующих дел",
    destinationPlaceName: "Как назвать место назначения",
    mode: "Как добираться",
    calculate: "Рассчитать по навигатору",
    calculating: "Считаю маршрут…",
    direction: "Нужна ли дорога назад",
    oneWay: "Только туда",
    roundTrip: "Туда и обратно",
    duration: "Время одного пути",
    reserve: "Запас перед выходом",
    routeHint: "Сайт зарезервирует дорогу до дела. Для варианта «туда и обратно» такое же время будет оставлено после него.",
    navigatorPrivacy: "Для расчёта адреса передаются сервисам OpenStreetMap. Можно указать время вручную.",
    notes: "Дополнительные детали (необязательно)",
    notesPlaceholder: "Что взять, подготовить или учесть",
    cancel: "Отмена",
    save: "Сохранить дело",
    editTitle: "Подробный план дела",
    route: "Дорога",
    noRoute: "без дороги",
    savedNavigator: "рассчитано по навигатору",
    manualRoute: "указано вручную",
    anyDay: "любой подходящий день",
    autoTime: "время подберёт сайт",
  } : {
    addPlaceholder: "Class, shopping, meeting or any other item",
    add: "Add item",
    empty: "Nothing has been added yet. Each item will appear as a separate card.",
    edit: "Edit",
    remove: "Remove",
    what: "1. What is it",
    title: "Title",
    category: "Item type",
    when: "2. When and how often",
    once: "One time",
    recurring: "Recurring",
    date: "Date",
    optionalDate: "Date (optional)",
    dateHint: "Leave it empty and the planner will choose a suitable day in the planning horizon.",
    days: "Weekdays",
    timing: "3. How to choose the time",
    fixed: "Exact time",
    flexible: "Choose automatically",
    fixedHint: "The item stays in the exact time range.",
    flexibleHint: "Enter a duration and the planner will choose the start and departure time.",
    start: "Starts",
    end: "Ends",
    activityDuration: "Item duration",
    durationMeaning: "What does this duration mean?",
    perOccurrence: "This much on every selected day",
    perOccurrenceHint: "For example, 1 hour on Monday, Wednesday and Friday means 1 hour on each day.",
    perCycle: "This much across all selected days",
    perCycleHint: "For example, 3 hours per week will be distributed only across the selected days.",
    allowedFrom: "May start no earlier than",
    allowedTo: "Must finish by",
    allowedHint: "Both fields are optional. The window limits the item itself, not travel.",
    planning: "4. Priority and deadline",
    priority: "Priority",
    deadlineType: "Deadline",
    noDeadline: "No deadline",
    targetDeadline: "Target",
    hardDeadline: "Hard",
    deadlineDate: "Deadline date",
    deadlineTime: "Deadline time",
    canSplit: "This item can be split",
    minChunk: "Minimum part",
    road: "5. Travel",
    noRoad: "No travel needed",
    hasRoad: "Yes, include travel",
    from: "Usual starting point",
    home: "Home",
    saved: "Saved place",
    temporary: "Another address — do not save",
    homeAddress: "Home address",
    savedPlace: "Saved place",
    address: "Origin address",
    placeName: "Place name",
    remember: "Remember this place for future items",
    to: "Destination",
    toHome: "Home",
    toSaved: "Saved place",
    toTemporary: "Another address",
    destinationAddress: "Destination address",
    rememberDestination: "Remember this destination for future items",
    destinationPlaceName: "Destination place name",
    mode: "Travel mode",
    calculate: "Calculate with navigator",
    calculating: "Calculating route…",
    direction: "Is a return trip needed",
    oneWay: "Outbound only",
    roundTrip: "Round trip",
    duration: "One-way travel time",
    reserve: "Outbound buffer",
    routeHint: "Travel before the item is protected. Round trips reserve the same travel time after it.",
    navigatorPrivacy: "Route calculation sends addresses to OpenStreetMap services. You can enter travel time manually.",
    notes: "Extra details (optional)",
    notesPlaceholder: "What to bring, prepare or keep in mind",
    cancel: "Cancel",
    save: "Save item",
    editTitle: "Detailed item plan",
    route: "Travel",
    noRoute: "no travel",
    savedNavigator: "navigator estimate",
    manualRoute: "manual estimate",
    anyDay: "any suitable day",
    autoTime: "time chosen automatically",
  };
  const dayNames = ru ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const priorityLabels: Record<PlannerPriority, string> = ru
    ? { low: "Низкий", normal: "Обычный", high: "Высокий", critical: "Критический" }
    : { low: "Low", normal: "Normal", high: "High", critical: "Critical" };
  const home = places.find((place) => place.kind === "home");
  const savedPlaces = places.filter((place) => place.kind === "saved");

  useEffect(() => {
    window.localStorage.setItem(PLACES_STORAGE_KEY, JSON.stringify(places));
  }, [places]);

  const selectedOrigin = useMemo(() => {
    if (originMode === "home") return home;
    if (originMode === "saved") return places.find((place) => place.id === selectedPlaceId);
    return undefined;
  }, [home, originMode, places, selectedPlaceId]);

  const selectedDestination = useMemo(() => {
    if (destinationMode === "home") return home;
    if (destinationMode === "saved") return places.find((place) => place.id === selectedDestinationPlaceId);
    return undefined;
  }, [destinationMode, home, places, selectedDestinationPlaceId]);

  function setEditor(next: PlannerStructuredCommitment | null) {
    setEditorState(next);
    onEditingChange?.(Boolean(next));
  }

  function startAdding() {
    if (!quickTitle.trim()) {
      setFormError(ru ? "Сначала введите название дела." : "Enter a title first.");
      return;
    }
    setFormError("");
    setEstimateError("");
    setOriginMode("home");
    setSelectedPlaceId(home?.id ?? "");
    setOriginAddress(home?.address ?? "");
    setOriginLabel("");
    setRememberOrigin(false);
    setDestinationMode("temporary");
    setSelectedDestinationPlaceId("");
    setDestinationLabel("");
    setRememberDestination(false);
    setEditor(blankCommitment(quickTitle));
  }

  function startEditing(rawCommitment: PlannerStructuredCommitment) {
    const commitment = normalizeStructuredCommitment(rawCommitment);
    const originPlace = places.find((place) => place.id === commitment.travel.originPlaceId);
    const destinationPlace = places.find((place) => place.id === commitment.travel.destinationPlaceId)
      ?? places.find((place) => place.address === commitment.travel.destinationAddress);
    setOriginMode(originPlace?.kind === "home" ? "home" : originPlace ? "saved" : "temporary");
    setSelectedPlaceId(originPlace?.id ?? "");
    setOriginAddress(commitment.travel.originAddress ?? originPlace?.address ?? "");
    setOriginLabel(commitment.travel.originLabel ?? originPlace?.label ?? "");
    setRememberOrigin(false);
    setDestinationMode(destinationPlace?.kind === "home" ? "home" : destinationPlace ? "saved" : "temporary");
    setSelectedDestinationPlaceId(destinationPlace?.id ?? "");
    setDestinationLabel(commitment.travel.destinationLabel ?? destinationPlace?.label ?? "");
    setRememberDestination(false);
    setFormError("");
    setEstimateError("");
    setEditor(structuredClone(commitment));
  }

  function patchEditor(patch: Partial<PlannerStructuredCommitment>) {
    setEditorState((current) => current ? { ...current, ...patch } : current);
  }

  function patchTravel(patch: Partial<PlannerStructuredCommitment["travel"]>) {
    setEditorState((current) => current ? { ...current, travel: { ...current.travel, ...patch } } : current);
  }

  function toggleWeekday(day: number) {
    if (!editor) return;
    patchEditor({
      weekdays: editor.weekdays.includes(day)
        ? editor.weekdays.filter((candidate) => candidate !== day)
        : [...editor.weekdays, day].sort((left, right) => left - right),
    });
  }

  function currentOriginAddress(): string {
    return selectedOrigin?.address ?? originAddress.trim();
  }

  function currentDestinationAddress(): string {
    return selectedDestination?.address ?? editor?.travel.destinationAddress?.trim() ?? "";
  }

  async function estimateRoute() {
    if (!editor) return;
    const origin = currentOriginAddress();
    const destination = currentDestinationAddress();
    if (!origin || !destination) {
      setEstimateError(ru ? "Укажите адрес отправления и назначения." : "Enter both origin and destination addresses.");
      return;
    }
    setEstimating(true);
    setEstimateError("");
    try {
      const result = await onEstimateTravel({ origin, destination, mode: editor.travel.mode });
      patchTravel({
        durationMinutes: result.minutes,
        distanceKm: result.distanceKm,
        destinationAddress: result.destinationLabel,
        originAddress: result.originLabel,
        estimatedByNavigator: true,
      });
      if (originMode === "temporary") setOriginAddress(result.originLabel);
    } catch (error) {
      setEstimateError(error instanceof Error ? error.message : (ru ? "Не удалось рассчитать маршрут." : "Could not calculate the route."));
    } finally {
      setEstimating(false);
    }
  }

  function saveCommitment() {
    if (!editor) return;
    if (!editor.title.trim()) return setFormError(ru ? "Введите название дела." : "Enter a title.");
    if (editor.occurrenceMode === "recurring" && !editor.weekdays.length) {
      return setFormError(ru ? "Выберите хотя бы один день недели." : "Choose at least one weekday.");
    }
    if (editor.timeMode === "fixed") {
      if (editor.occurrenceMode === "once" && !editor.date) {
        return setFormError(ru ? "Для разового дела с точным временем нужна дата." : "A one-time fixed item needs a date.");
      }
      if (!editor.startTime || !editor.endTime) {
        return setFormError(ru ? "Укажите время начала и окончания." : "Enter both start and end times.");
      }
    } else {
      if (!Number.isFinite(editor.durationMinutes) || editor.durationMinutes < 5 || editor.durationMinutes > 1440) {
        return setFormError(ru ? "Укажите длительность от 5 минут до 24 часов." : "Enter a duration from 5 minutes to 24 hours.");
      }
      if (Boolean(editor.allowedStartTime) !== Boolean(editor.allowedEndTime)) {
        return setFormError(ru ? "Для допустимого интервала нужны оба времени." : "Enter both ends of the allowed window.");
      }
      if (editor.allowedStartTime && editor.allowedEndTime
        && plannerCommitmentDuration(editor.allowedStartTime, editor.allowedEndTime) < editor.durationMinutes) {
        return setFormError(ru ? "Дело не помещается в допустимый интервал." : "The item does not fit inside the allowed window.");
      }
      if (editor.canSplit && (editor.minChunkMinutes < 5 || editor.minChunkMinutes > editor.durationMinutes)) {
        return setFormError(ru ? "Минимальная часть должна быть от 5 минут до полной длительности." : "The minimum part must be between 5 minutes and the full duration.");
      }
      if (editor.deadlineType !== "none" && !editor.deadlineDate) {
        return setFormError(ru ? "Укажите дату срока." : "Enter the deadline date.");
      }
    }

    let originPlace: PlannerSavedPlace | undefined = selectedOrigin;
    let destinationPlace: PlannerSavedPlace | undefined = selectedDestination;
    let normalizedTravel = { ...editor.travel };
    if (editor.travel.enabled) {
      const address = currentOriginAddress();
      const destinationAddress = currentDestinationAddress();
      if (!address || !destinationAddress) {
        return setFormError(ru ? "Для дороги нужны адрес отправления и адрес назначения." : "Travel requires origin and destination addresses.");
      }
      if (!Number.isFinite(editor.travel.durationMinutes) || editor.travel.durationMinutes < 1 || editor.travel.durationMinutes > 240) {
        return setFormError(ru ? "Укажите время одного пути или рассчитайте его." : "Enter or calculate one-way travel time.");
      }
      if (!Number.isFinite(editor.travel.bufferMinutes) || editor.travel.bufferMinutes < 0 || editor.travel.bufferMinutes > 120) {
        return setFormError(ru ? "Запас перед выходом должен быть от 0 минут до 2 часов." : "The outbound buffer must be between 0 minutes and 2 hours.");
      }
      if (originMode === "home" && !home) {
        originPlace = { id: createRuntimeId(), label: ru ? "Дом" : "Home", address, kind: "home" };
        setPlaces((current) => [...current.filter((place) => place.kind !== "home"), originPlace!]);
      } else if (originMode === "temporary" && rememberOrigin) {
        if (!originLabel.trim()) return setFormError(ru ? "Придумайте название для сохраняемого места." : "Name the place you want to save.");
        originPlace = { id: createRuntimeId(), label: originLabel.trim(), address, kind: "saved" };
        setPlaces((current) => {
          const currentHome = current.find((place) => place.kind === "home");
          const saved = [...current.filter((place) => place.kind === "saved"), originPlace!].slice(-29);
          return currentHome ? [currentHome, ...saved] : saved;
        });
      }
      if (destinationMode === "home" && !home) {
        destinationPlace = originPlace?.kind === "home" && originPlace.address === destinationAddress
          ? originPlace
          : { id: createRuntimeId(), label: ru ? "Дом" : "Home", address: destinationAddress, kind: "home" };
        setPlaces((current) => [...current.filter((place) => place.kind !== "home"), destinationPlace!]);
      } else if (destinationMode === "temporary" && rememberDestination) {
        if (!destinationLabel.trim()) return setFormError(ru ? "Придумайте название для места назначения." : "Name the destination you want to save.");
        destinationPlace = { id: createRuntimeId(), label: destinationLabel.trim(), address: destinationAddress, kind: "saved" };
        setPlaces((current) => {
          const currentHome = current.find((place) => place.kind === "home");
          const saved = [...current.filter((place) => place.kind === "saved"), destinationPlace!].slice(-29);
          return currentHome ? [currentHome, ...saved] : saved;
        });
      }
      normalizedTravel = {
        ...editor.travel,
        originAddress: address,
        originLabel: originPlace?.label ?? (originLabel.trim() || (ru ? "Другой адрес" : "Another address")),
        originPlaceId: originPlace?.id,
        destinationAddress,
        destinationLabel: destinationPlace?.label ?? (destinationLabel.trim() || (ru ? "Другой адрес" : "Another address")),
        destinationPlaceId: destinationPlace?.id,
        durationMinutes: Math.round(editor.travel.durationMinutes),
        bufferMinutes: Math.max(0, Math.round(editor.travel.bufferMinutes)),
      };
    }

    const normalized = normalizeStructuredCommitment({
      ...editor,
      travel: normalizedTravel,
      title: editor.title.trim(),
      weekdays: [...editor.weekdays].sort((a, b) => a - b),
    });
    const exists = commitments.some((commitment) => commitment.id === normalized.id);
    onChange(exists
      ? commitments.map((commitment) => commitment.id === normalized.id ? normalized : commitment)
      : [...commitments, normalized]);
    setQuickTitle("");
    setFormError("");
    setEditor(null);
  }

  return <div className={styles.commitmentBuilder}>
    {editor ? <div className={styles.commitmentEditor}>
      <div className={styles.commitmentEditorHead}><strong>{copy.editTitle}</strong><span>{editor.title || (ru ? "Новое дело" : "New item")}</span></div>

      <fieldset className={styles.commitmentFieldset}>
        <legend>{copy.what}</legend>
        <label>{copy.title}<input autoFocus value={editor.title} onChange={(event) => patchEditor({ title: event.target.value })} /></label>
        <div><span className={styles.fieldTitle}>{copy.category}</span><div className={styles.categoryChoices}>{CATEGORIES.map((category) => <button type="button" key={category} className={editor.category === category ? styles.segmentedActive : ""} aria-pressed={editor.category === category} onClick={() => patchEditor({ category })}>{plannerCommitmentCategoryLabel(category, locale)}</button>)}</div></div>
      </fieldset>

      <fieldset className={styles.commitmentFieldset}>
        <legend>{copy.when}</legend>
        <div className={styles.routeToggle}><button type="button" className={editor.occurrenceMode === "once" ? styles.segmentedActive : ""} aria-pressed={editor.occurrenceMode === "once"} onClick={() => patchEditor({ occurrenceMode: "once" })}>{copy.once}</button><button type="button" className={editor.occurrenceMode === "recurring" ? styles.segmentedActive : ""} aria-pressed={editor.occurrenceMode === "recurring"} onClick={() => patchEditor({ occurrenceMode: "recurring" })}>{copy.recurring}</button></div>
        {editor.occurrenceMode === "once"
          ? <label>{editor.timeMode === "fixed" ? copy.date : copy.optionalDate}<input type="date" value={editor.date ?? ""} onChange={(event) => patchEditor({ date: event.target.value || undefined })} />{editor.timeMode === "flexible" && <small>{copy.dateHint}</small>}</label>
          : <div><span className={styles.fieldTitle}>{copy.days}</span><div className={styles.commitmentWeekdays}>{WEEKDAYS.map((day, index) => <button type="button" key={day} className={editor.weekdays.includes(day) ? styles.weekdayActive : ""} aria-pressed={editor.weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{dayNames[index]}</button>)}</div></div>}
      </fieldset>

      <fieldset className={styles.commitmentFieldset}>
        <legend>{copy.timing}</legend>
        <div className={styles.routeToggle}><button type="button" className={editor.timeMode === "fixed" ? styles.segmentedActive : ""} aria-pressed={editor.timeMode === "fixed"} onClick={() => patchEditor({ timeMode: "fixed", canSplit: false })}>{copy.fixed}<small>{copy.fixedHint}</small></button><button type="button" className={editor.timeMode === "flexible" ? styles.segmentedActive : ""} aria-pressed={editor.timeMode === "flexible"} onClick={() => patchEditor({ timeMode: "flexible" })}>{copy.flexible}<small>{copy.flexibleHint}</small></button></div>
        {editor.timeMode === "fixed"
          ? <div className={styles.formGrid}><label>{copy.start}<input type="time" value={editor.startTime} onChange={(event) => patchEditor({ startTime: event.target.value })} /></label><label>{copy.end}<input type="time" value={editor.endTime} onChange={(event) => patchEditor({ endTime: event.target.value })} /></label></div>
          : <>
            <DurationInput label={copy.activityDuration} valueMinutes={editor.durationMinutes} minMinutes={5} maxMinutes={1440} locale={locale} onChangeMinutes={(durationMinutes) => patchEditor({ durationMinutes })} />
            {editor.occurrenceMode === "recurring" && <div><span className={styles.fieldTitle}>{copy.durationMeaning}</span><div className={styles.routeToggle}>
              <button type="button" className={editor.durationMode === "per_occurrence" ? styles.segmentedActive : ""} aria-pressed={editor.durationMode === "per_occurrence"} onClick={() => patchEditor({ durationMode: "per_occurrence" })}>{copy.perOccurrence}<small>{copy.perOccurrenceHint}</small></button>
              <button type="button" className={editor.durationMode === "per_cycle" ? styles.segmentedActive : ""} aria-pressed={editor.durationMode === "per_cycle"} onClick={() => patchEditor({ durationMode: "per_cycle", canSplit: true })}>{copy.perCycle}<small>{copy.perCycleHint}</small></button>
            </div></div>}
            <div className={styles.formGrid}><label>{copy.allowedFrom}<input type="time" value={editor.allowedStartTime ?? ""} onChange={(event) => patchEditor({ allowedStartTime: event.target.value || undefined })} /></label><label>{copy.allowedTo}<input type="time" value={editor.allowedEndTime ?? ""} onChange={(event) => patchEditor({ allowedEndTime: event.target.value || undefined })} /></label></div><small>{copy.allowedHint}</small>
          </>}
      </fieldset>

      <fieldset className={styles.commitmentFieldset}>
        <legend>{copy.planning}</legend>
        <div className={styles.formGrid}><label>{copy.priority}<select value={editor.priority} onChange={(event) => patchEditor({ priority: event.target.value as PlannerPriority })}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></label>{editor.timeMode === "flexible" && <label>{copy.deadlineType}<select value={editor.deadlineType} onChange={(event) => patchEditor({ deadlineType: event.target.value as PlannerDeadlineType })}><option value="none">{copy.noDeadline}</option><option value="target">{copy.targetDeadline}</option><option value="hard">{copy.hardDeadline}</option></select></label>}</div>
        {editor.timeMode === "flexible" && editor.deadlineType !== "none" && <div className={styles.formGrid}><label>{copy.deadlineDate}<input type="date" value={editor.deadlineDate ?? ""} onChange={(event) => patchEditor({ deadlineDate: event.target.value || undefined })} /></label><label>{copy.deadlineTime}<input type="time" value={editor.deadlineTime ?? "23:59"} onChange={(event) => patchEditor({ deadlineTime: event.target.value })} /></label></div>}
        {editor.timeMode === "flexible" && <><label className={styles.choiceCheck}><input type="checkbox" checked={editor.canSplit} onChange={(event) => patchEditor({ canSplit: event.target.checked })} />{copy.canSplit}</label>{editor.canSplit && <DurationInput label={copy.minChunk} valueMinutes={editor.minChunkMinutes} minMinutes={5} maxMinutes={editor.durationMinutes} locale={locale} onChangeMinutes={(minChunkMinutes) => patchEditor({ minChunkMinutes })} />}</>}
      </fieldset>

      <fieldset className={styles.commitmentFieldset}>
        <legend>{copy.road}</legend>
        <div className={styles.routeToggle}><button type="button" className={!editor.travel.enabled ? styles.segmentedActive : ""} aria-pressed={!editor.travel.enabled} onClick={() => patchTravel({ enabled: false })}>{copy.noRoad}</button><button type="button" className={editor.travel.enabled ? styles.segmentedActive : ""} aria-pressed={editor.travel.enabled} onClick={() => patchTravel({ enabled: true })}>{copy.hasRoad}</button></div>
        {editor.travel.enabled && <div className={styles.routeFields}>
          <label>{copy.from}<select value={originMode} onChange={(event) => { const next = event.target.value as OriginMode; setOriginMode(next); setEstimateError(""); if (next === "home") { setOriginAddress(home?.address ?? ""); setSelectedPlaceId(home?.id ?? ""); } else if (next === "saved") { const first = savedPlaces[0]; setSelectedPlaceId(first?.id ?? ""); setOriginAddress(first?.address ?? ""); } else { setSelectedPlaceId(""); setOriginAddress(""); } }}><option value="home">{copy.home}</option><option value="saved" disabled={!savedPlaces.length}>{copy.saved}</option><option value="temporary">{copy.temporary}</option></select></label>
          {originMode === "home" && (home ? <div className={styles.savedPlacePreview}><strong>{home.label}</strong><span>{home.address}</span><button type="button" onClick={() => { setPlaces((current) => current.filter((place) => place.id !== home.id)); setOriginAddress(""); }}>{ru ? "Изменить адрес" : "Change address"}</button></div> : <label>{copy.homeAddress}<input value={originAddress} onChange={(event) => setOriginAddress(event.target.value)} placeholder={ru ? "Город, улица, дом" : "City, street, house"} /><small>{ru ? "Адрес сохранится как «Дом» только в этом браузере." : "The address is stored as Home only in this browser."}</small></label>)}
          {originMode === "saved" && <label>{copy.savedPlace}<select value={selectedPlaceId} onChange={(event) => setSelectedPlaceId(event.target.value)}>{savedPlaces.map((place) => <option value={place.id} key={place.id}>{place.label} — {place.address}</option>)}</select></label>}
          {originMode === "temporary" && <><label>{copy.address}<input value={originAddress} onChange={(event) => setOriginAddress(event.target.value)} placeholder={ru ? "Адрес, откуда поедете" : "Starting address"} /></label><label className={styles.choiceCheck}><input type="checkbox" checked={rememberOrigin} onChange={(event) => setRememberOrigin(event.target.checked)} />{copy.remember}</label>{rememberOrigin && <label>{copy.placeName}<input value={originLabel} onChange={(event) => setOriginLabel(event.target.value)} placeholder={ru ? "Дом родителей, офис или другое название" : "Parents’ home, office or another name"} /></label>}</>}
          <label>{copy.to}<select value={destinationMode} onChange={(event) => { const next = event.target.value as DestinationMode; setDestinationMode(next); setEstimateError(""); setRememberDestination(false); setDestinationLabel(""); if (next === "home") { setSelectedDestinationPlaceId(home?.id ?? ""); patchTravel({ destinationAddress: home?.address ?? "", destinationLabel: home?.label, destinationPlaceId: home?.id, estimatedByNavigator: false }); } else if (next === "saved") { const first = savedPlaces[0]; setSelectedDestinationPlaceId(first?.id ?? ""); patchTravel({ destinationAddress: first?.address ?? "", destinationLabel: first?.label, destinationPlaceId: first?.id, estimatedByNavigator: false }); } else { setSelectedDestinationPlaceId(""); patchTravel({ destinationAddress: "", destinationLabel: undefined, destinationPlaceId: undefined, estimatedByNavigator: false }); } }}><option value="home">{copy.toHome}</option><option value="saved" disabled={!savedPlaces.length}>{copy.toSaved}</option><option value="temporary">{copy.toTemporary}</option></select></label>
          {destinationMode === "home" && (home ? <div className={styles.savedPlacePreview}><strong>{home.label}</strong><span>{home.address}</span><button type="button" onClick={() => { setPlaces((current) => current.filter((place) => place.id !== home.id)); setSelectedDestinationPlaceId(""); patchTravel({ destinationAddress: "", destinationLabel: undefined, destinationPlaceId: undefined, estimatedByNavigator: false }); }}>{ru ? "Изменить адрес" : "Change address"}</button></div> : <label>{copy.homeAddress}<input value={editor.travel.destinationAddress ?? ""} onChange={(event) => patchTravel({ destinationAddress: event.target.value, destinationLabel: ru ? "Дом" : "Home", estimatedByNavigator: false })} placeholder={ru ? "Город, улица, дом" : "City, street, house"} /><small>{ru ? "Адрес сохранится как «Дом» только в этом браузере." : "The address is stored as Home only in this browser."}</small></label>)}
          {destinationMode === "saved" && <label>{copy.savedPlace}<select value={selectedDestinationPlaceId} onChange={(event) => { const place = savedPlaces.find((candidate) => candidate.id === event.target.value); setSelectedDestinationPlaceId(event.target.value); patchTravel({ destinationAddress: place?.address ?? "", destinationLabel: place?.label, destinationPlaceId: place?.id, estimatedByNavigator: false }); }}>{savedPlaces.map((place) => <option value={place.id} key={place.id}>{place.label} — {place.address}</option>)}</select></label>}
          {destinationMode === "temporary" && <><label>{copy.destinationAddress}<input value={editor.travel.destinationAddress ?? ""} onChange={(event) => patchTravel({ destinationAddress: event.target.value, destinationLabel: undefined, destinationPlaceId: undefined, estimatedByNavigator: false })} placeholder={ru ? "Город, улица, дом" : "City, street, house"} /></label><label className={styles.choiceCheck}><input type="checkbox" checked={rememberDestination} onChange={(event) => setRememberDestination(event.target.checked)} />{copy.rememberDestination}</label>{rememberDestination && <label>{copy.destinationPlaceName}<input value={destinationLabel} onChange={(event) => setDestinationLabel(event.target.value)} placeholder={ru ? "Университет, спортзал или другое название" : "University, gym or another name"} /></label>}</>}
          <div><span className={styles.fieldTitle}>{copy.mode}</span><div className={styles.travelModes}>{TRAVEL_MODES.map((mode) => <button type="button" key={mode} className={editor.travel.mode === mode ? styles.segmentedActive : ""} aria-pressed={editor.travel.mode === mode} onClick={() => patchTravel({ mode, estimatedByNavigator: false })}>{plannerTravelModeLabel(mode, locale)}</button>)}</div></div>
          <button type="button" className={styles.routeEstimateButton} disabled={estimating} onClick={() => void estimateRoute()}>{estimating ? copy.calculating : copy.calculate}</button>
          <small className={styles.routePrivacy}>{copy.navigatorPrivacy}</small>
          {estimateError && <p className={styles.routeError}>{estimateError} {ru ? "Можно указать время вручную ниже." : "You can enter the time manually below."}</p>}
          {editor.travel.distanceKm !== undefined && <div className={styles.routeEstimate}><strong>≈ {plannerDurationLabel(editor.travel.durationMinutes, locale)}</strong><span>{editor.travel.distanceKm.toLocaleString(locale, { maximumFractionDigits: 1 })} {ru ? "км" : "km"} · {editor.travel.estimatedByNavigator ? copy.savedNavigator : copy.manualRoute}</span></div>}
          <div><span className={styles.fieldTitle}>{copy.direction}</span><div className={styles.routeToggle}><button type="button" className={editor.travel.direction === "one_way" ? styles.segmentedActive : ""} aria-pressed={editor.travel.direction === "one_way"} onClick={() => patchTravel({ direction: "one_way" })}>{copy.oneWay}</button><button type="button" className={editor.travel.direction === "round_trip" ? styles.segmentedActive : ""} aria-pressed={editor.travel.direction === "round_trip"} onClick={() => patchTravel({ direction: "round_trip" })}>{copy.roundTrip}</button></div></div>
          <div className={styles.formGrid}><DurationInput label={copy.duration} valueMinutes={editor.travel.durationMinutes} minMinutes={1} maxMinutes={240} locale={locale} onChangeMinutes={(durationMinutes) => patchTravel({ durationMinutes, estimatedByNavigator: false })} /><DurationInput label={copy.reserve} valueMinutes={editor.travel.bufferMinutes} maxMinutes={120} locale={locale} onChangeMinutes={(bufferMinutes) => patchTravel({ bufferMinutes })} /></div>
          <small className={styles.routeHint}>{copy.routeHint}</small>
        </div>}
      </fieldset>

      <label>{copy.notes}<textarea className={styles.commitmentNotes} value={editor.notes ?? ""} onChange={(event) => patchEditor({ notes: event.target.value })} placeholder={copy.notesPlaceholder} /></label>
      {formError && <p className={styles.inlineError} role="alert">{formError}</p>}
      <div className={styles.commitmentEditorActions}><button type="button" onClick={() => { setEditor(null); setFormError(""); }}>{copy.cancel}</button><button type="button" className={styles.primaryButton} onClick={saveCommitment}>{copy.save}</button></div>
    </div> : <>
      <form className={styles.commitmentQuickAdd} onSubmit={(event) => { event.preventDefault(); startAdding(); }}><label><span className={styles.fieldTitle}>{ru ? "Новое дело" : "New item"}</span><input value={quickTitle} onChange={(event) => { setQuickTitle(event.target.value); setFormError(""); }} placeholder={copy.addPlaceholder} /></label><button className={styles.primaryButton}>{copy.add}</button></form>
      {formError && <p className={styles.inlineError} role="alert">{formError}</p>}
      <div className={styles.commitmentList}>{commitments.map((rawCommitment) => {
        const commitment = normalizeStructuredCommitment(rawCommitment);
        const occurrence = commitment.occurrenceMode === "recurring"
          ? commitment.weekdays.map((day) => dayNames[day - 1]).join(", ")
          : commitment.date || copy.anyDay;
        const timing = commitment.timeMode === "fixed"
          ? `${commitment.startTime}–${commitment.endTime}`
          : `${plannerDurationLabel(commitment.durationMinutes, locale)}${commitment.occurrenceMode === "recurring"
              ? commitment.durationMode === "per_cycle"
                ? (ru ? " всего на выбранные дни за неделю" : " total across the selected days per week")
                : (ru ? " в каждый выбранный день" : " on every selected day")
              : ""} · ${commitment.allowedStartTime && commitment.allowedEndTime ? `${commitment.allowedStartTime}–${commitment.allowedEndTime}` : copy.autoTime}`;
        return <article className={styles.commitmentCard} key={commitment.id}>
          <div className={styles.commitmentCardMain}><span>{plannerCommitmentCategoryLabel(commitment.category, locale)}</span><strong>{commitment.title}</strong><p>{occurrence} · {timing}</p>{commitment.travel.enabled ? <small>{copy.route}: {commitment.travel.originLabel || commitment.travel.originAddress} → {commitment.travel.destinationLabel || commitment.travel.destinationAddress} · {plannerTravelModeLabel(commitment.travel.mode, locale)} · {plannerDurationLabel(commitment.travel.durationMinutes, locale)} {ru ? "в одну сторону" : "one way"} · {commitment.travel.direction === "round_trip" ? copy.roundTrip : copy.oneWay}</small> : <small>{copy.noRoute}</small>}</div>
          <div className={styles.commitmentCardActions}><button type="button" onClick={() => startEditing(commitment)}>{copy.edit}</button><button type="button" className={styles.commitmentRemove} onClick={() => onChange(commitments.filter((candidate) => candidate.id !== commitment.id))}>{copy.remove}</button></div>
        </article>;
      })}</div>
      {!commitments.length && <p className={styles.commitmentEmpty}>{copy.empty}</p>}
    </>}
  </div>;
}
