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
import type { PlannerCommitmentLevel, PlannerDeadlineType, PlannerEstimateMode, PlannerPriority } from "@/lib/planner/types";
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
    outcomeMode: "deliverable",
    durationType: "exact",
    minDurationMinutes: 30,
    maxDurationMinutes: 120,
    tolerancePercent: 30,
    calibrationMinutes: 30,
    recurrenceMode: "exact_days",
    recurrencePeriod: "week",
    minOccurrences: 2,
    likelyOccurrences: 3,
    maxOccurrences: 4,
    dateMode: "any",
    flexibleTimeMode: "any",
    priority: "normal",
    commitmentLevel: "required",
    planningRank: 0,
    deadlineType: "none",
    canSplit: false,
    minChunkMinutes: 25,
    travel: {
      enabled: false,
      mode: "transit",
      direction: "one_way",
      durationMinutes: 30,
      estimateMode: "exact",
      minDurationMinutes: 30,
      maxDurationMinutes: 30,
      tolerancePercent: 30,
      punctuality: "normal",
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
  const [draggedCommitmentId, setDraggedCommitmentId] = useState<string | null>(null);

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
    spareTime: "В свободное время",
    spareTimeHint: "Сайт сначала учтёт сон, обязательства и сроки, а затем выделит этому делу доступное время.",
    date: "Дата",
    optionalDate: "Дата (необязательно)",
    dateHint: "Если оставить пустым, сайт выберет подходящий день в горизонте планирования.",
    days: "Дни недели",
    recurrenceRule: "Как часто среди допустимых дней",
    exactDays: "В каждый выбранный день",
    countRange: "От–обычно–до раз за период",
    occurrencesMin: "Не меньше раз",
    occurrencesLikely: "Обычно раз",
    occurrencesMax: "Не больше раз",
    perWeek: "за неделю",
    perMonth: "за месяц",
    dateFlexibility: "Насколько точна дата",
    dateExact: "Точно",
    datePreferred: "Предпочтительно",
    dateRange: "Допустимый период",
    dateAny: "Без разницы",
    preferredDate: "Желательная дата",
    earliestDate: "Не раньше",
    latestDate: "Не позже",
    timing: "3. Как выбирать время",
    fixed: "Точное время",
    flexible: "Подобрать автоматически",
    fixedHint: "Дело останется в указанных временных рамках.",
    flexibleHint: "Укажите длительность — точное начало и время выезда подберёт сайт.",
    start: "Начало",
    end: "Конец",
    activityDuration: "Длительность дела",
    exactDuration: "Точно",
    approximateDuration: "Примерно",
    rangeDuration: "Диапазон",
    unknownDuration: "Не знаю",
    usualDuration: "Обычно",
    tolerance: "Погрешность",
    trialDuration: "Пробная сессия",
    durationGoal: "Нужно закончить результат или просто выделять этому время?",
    finishResult: "Закончить результат",
    allocateTime: "Просто выделять время",
    indefiniteDuration: "Неопределённое количество времени",
    indefiniteDurationHint: "Задайте границы: минимум защищает дело от полного вытеснения, максимум не даёт хобби занять весь свободный день.",
    minimumDuration: "Не меньше",
    maximumDuration: "Не больше",
    durationMeaning: "Что означает эта длительность?",
    perOccurrence: "Столько в каждый выбранный день",
    perOccurrenceHint: "Например, 1 час в понедельник, среду и пятницу — по 1 часу в каждый день.",
    perCycle: "Столько всего на выбранные дни",
    perCycleHint: "Например, 3 часа за неделю — сайт распределит их только между выбранными днями.",
    allowedFrom: "Можно начать не раньше",
    allowedTo: "Дело должно закончиться до",
    allowedHint: "Оба поля необязательны. Интервал ограничивает само дело, но не дорогу.",
    timeFlexibility: "Насколько важно время",
    preferredTime: "Предпочтительное начало",
    planning: "4. Важность и срок",
    priority: "Приоритет",
    commitment: "Насколько обязательно",
    mustNotSkip: "Нельзя пропустить",
    required: "Нужно сделать",
    desired: "Желательно",
    ifTime: "Только если останется время",
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
    travelEstimate: "Насколько точно время дороги",
    punctuality: "Какой запас использовать",
    strictArrival: "Критично не опоздать — защищать максимум",
    normalArrival: "Обычно — мягкий запас до максимума",
    flexibleArrival: "Можно сдвинуть — обычное время и мягкий запас",
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
    spareTime: "In spare time",
    spareTimeHint: "The planner handles sleep, commitments and deadlines first, then gives this item available time.",
    date: "Date",
    optionalDate: "Date (optional)",
    dateHint: "Leave it empty and the planner will choose a suitable day in the planning horizon.",
    days: "Weekdays",
    recurrenceRule: "How often within allowed days",
    exactDays: "Every selected day",
    countRange: "Min–usual–max times per period",
    occurrencesMin: "At least",
    occurrencesLikely: "Usually",
    occurrencesMax: "At most",
    perWeek: "per week",
    perMonth: "per month",
    dateFlexibility: "How exact is the date",
    dateExact: "Exact",
    datePreferred: "Preferred",
    dateRange: "Allowed range",
    dateAny: "Any date",
    preferredDate: "Preferred date",
    earliestDate: "Not before",
    latestDate: "Not after",
    timing: "3. How to choose the time",
    fixed: "Exact time",
    flexible: "Choose automatically",
    fixedHint: "The item stays in the exact time range.",
    flexibleHint: "Enter a duration and the planner will choose the start and departure time.",
    start: "Starts",
    end: "Ends",
    activityDuration: "Item duration",
    exactDuration: "Exact",
    approximateDuration: "Approximately",
    rangeDuration: "Range",
    unknownDuration: "I don't know",
    usualDuration: "Usually",
    tolerance: "Uncertainty",
    trialDuration: "Calibration session",
    durationGoal: "Do you need to finish a result or simply allocate time?",
    finishResult: "Finish a result",
    allocateTime: "Allocate time",
    indefiniteDuration: "An open-ended amount of time",
    indefiniteDurationHint: "Set bounds: the minimum protects the item from being crowded out, while the maximum stops it taking the whole free day.",
    minimumDuration: "At least",
    maximumDuration: "At most",
    durationMeaning: "What does this duration mean?",
    perOccurrence: "This much on every selected day",
    perOccurrenceHint: "For example, 1 hour on Monday, Wednesday and Friday means 1 hour on each day.",
    perCycle: "This much across all selected days",
    perCycleHint: "For example, 3 hours per week will be distributed only across the selected days.",
    allowedFrom: "May start no earlier than",
    allowedTo: "Must finish by",
    allowedHint: "Both fields are optional. The window limits the item itself, not travel.",
    timeFlexibility: "How important is the time",
    preferredTime: "Preferred start",
    planning: "4. Priority and deadline",
    priority: "Priority",
    commitment: "Commitment level",
    mustNotSkip: "Must not skip",
    required: "Need to do",
    desired: "Desired",
    ifTime: "Only if time remains",
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
    travelEstimate: "How exact is the travel time",
    punctuality: "Which travel reserve to use",
    strictArrival: "Critical arrival — protect the maximum",
    normalArrival: "Normal — soft reserve to the maximum",
    flexibleArrival: "Flexible — usual time with a soft reserve",
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
  const commitmentLabels: Record<PlannerCommitmentLevel, string> = {
    must_not_skip: copy.mustNotSkip,
    required: copy.required,
    desired: copy.desired,
    if_time: copy.ifTime,
  };
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

  function approximateBounds(likelyMinutes: number, tolerancePercent: 15 | 30 | 50) {
    return {
      minDurationMinutes: Math.max(5, Math.round(likelyMinutes * (1 - tolerancePercent / 100))),
      maxDurationMinutes: Math.max(likelyMinutes, Math.round(likelyMinutes * (1 + tolerancePercent / 100))),
    };
  }

  function changeDurationMode(durationType: PlannerEstimateMode) {
    if (!editor) return;
    if (durationType === "approximate") patchEditor({ durationType, ...approximateBounds(editor.durationMinutes, editor.tolerancePercent) });
    else if (durationType === "exact") patchEditor({ durationType, minDurationMinutes: editor.durationMinutes, maxDurationMinutes: editor.durationMinutes });
    else patchEditor({ durationType, canSplit: durationType === "range" ? true : editor.canSplit });
  }

  function changeLikelyDuration(durationMinutes: number) {
    if (!editor) return;
    patchEditor({
      durationMinutes,
      ...(editor.durationType === "approximate" ? approximateBounds(durationMinutes, editor.tolerancePercent) : {}),
    });
  }

  function changeTolerance(tolerancePercent: 15 | 30 | 50) {
    if (!editor) return;
    patchEditor({ tolerancePercent, ...approximateBounds(editor.durationMinutes, tolerancePercent) });
  }

  function changeTravelEstimateMode(estimateMode: PlannerStructuredCommitment["travel"]["estimateMode"]) {
    if (!editor) return;
    if (estimateMode === "exact") patchTravel({ estimateMode, minDurationMinutes: editor.travel.durationMinutes, maxDurationMinutes: editor.travel.durationMinutes });
    else if (estimateMode === "approximate") {
      const bounds = approximateBounds(editor.travel.durationMinutes, editor.travel.tolerancePercent);
      patchTravel({ estimateMode, minDurationMinutes: bounds.minDurationMinutes, maxDurationMinutes: bounds.maxDurationMinutes });
    } else patchTravel({ estimateMode });
  }

  function toggleWeekday(day: number) {
    if (!editor) return;
    patchEditor({
      weekdays: editor.weekdays.includes(day)
        ? editor.weekdays.filter((candidate) => candidate !== day)
        : [...editor.weekdays, day].sort((left, right) => left - right),
    });
  }

  function moveCommitmentToLevel(id: string, commitmentLevel: PlannerCommitmentLevel) {
    const nextRank = commitments.filter((item) => item.commitmentLevel === commitmentLevel).length;
    onChange(commitments.map((item) => item.id === id
      ? normalizeStructuredCommitment({ ...item, commitmentLevel, planningRank: nextRank })
      : item));
  }

  function reorderCommitments(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const target = commitments.find((item) => item.id === targetId);
    const dragged = commitments.find((item) => item.id === draggedId);
    if (!target || !dragged || target.commitmentLevel !== dragged.commitmentLevel) return;
    const group = commitments
      .filter((item) => item.commitmentLevel === target.commitmentLevel)
      .sort((left, right) => left.planningRank - right.planningRank || left.id.localeCompare(right.id));
    const withoutDragged = group.filter((item) => item.id !== draggedId);
    const targetIndex = withoutDragged.findIndex((item) => item.id === targetId);
    withoutDragged.splice(Math.max(0, targetIndex), 0, dragged);
    const ranks = new Map(withoutDragged.map((item, index) => [item.id, index]));
    onChange(commitments.map((item) => ranks.has(item.id)
      ? normalizeStructuredCommitment({ ...item, planningRank: ranks.get(item.id)! })
      : item));
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
      const travelBounds = editor.travel.estimateMode === "approximate"
        ? approximateBounds(result.minutes, editor.travel.tolerancePercent)
        : editor.travel.estimateMode === "exact"
          ? { minDurationMinutes: result.minutes, maxDurationMinutes: result.minutes }
          : {};
      patchTravel({
        durationMinutes: result.minutes,
        ...travelBounds,
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
    if (editor.occurrenceMode !== "once" && !editor.weekdays.length) {
      return setFormError(ru ? "Выберите хотя бы один день недели." : "Choose at least one weekday.");
    }
    if (editor.occurrenceMode !== "once" && editor.recurrenceMode === "count_range"
      && (editor.minOccurrences < 0 || editor.minOccurrences > editor.likelyOccurrences
        || editor.likelyOccurrences > editor.maxOccurrences || editor.maxOccurrences > 31)) {
      return setFormError(ru ? "Проверьте количество повторов: минимум ≤ обычно ≤ максимум." : "Check recurrence counts: minimum ≤ usual ≤ maximum.");
    }
    if (editor.timeMode === "fixed") {
      if (editor.occurrenceMode === "once" && !editor.date) {
        return setFormError(ru ? "Для разового дела с точным временем нужна дата." : "A one-time fixed item needs a date.");
      }
      if (!editor.startTime || !editor.endTime) {
        return setFormError(ru ? "Укажите время начала и окончания." : "Enter both start and end times.");
      }
    } else {
      if (editor.occurrenceMode === "once" && editor.dateMode === "exact" && !editor.date) {
        return setFormError(ru ? "Укажите точную дату или выберите другой режим даты." : "Enter the exact date or choose another date mode.");
      }
      if (editor.occurrenceMode === "once" && editor.dateMode === "preferred" && !editor.preferredDate) {
        return setFormError(ru ? "Укажите желательную дату." : "Enter the preferred date.");
      }
      if (editor.occurrenceMode === "once" && editor.dateMode === "range" && (!editor.earliestDate || !editor.latestDate || editor.earliestDate > editor.latestDate)) {
        return setFormError(ru ? "Укажите корректный допустимый период дат." : "Enter a valid allowed date range.");
      }
      const rangedDuration = editor.durationType === "range" || editor.durationType === "approximate";
      const maximumAllowed = editor.outcomeMode === "deliverable" ? 600_000 : 1440;
      const effectiveDuration = editor.durationType === "unknown" ? editor.calibrationMinutes : rangedDuration ? editor.maxDurationMinutes : editor.durationMinutes;
      if (rangedDuration && (!Number.isFinite(editor.minDurationMinutes) || !Number.isFinite(editor.durationMinutes)
        || !Number.isFinite(editor.maxDurationMinutes) || editor.minDurationMinutes < 5
        || editor.minDurationMinutes > editor.durationMinutes || editor.durationMinutes > editor.maxDurationMinutes
        || editor.maxDurationMinutes > maximumAllowed)) {
        return setFormError(ru ? "Проверьте оценку: минимум ≤ обычно ≤ максимум." : "Check the estimate: minimum ≤ usual ≤ maximum.");
      }
      if (editor.durationType === "exact" && (!Number.isFinite(editor.durationMinutes) || editor.durationMinutes < 5 || editor.durationMinutes > maximumAllowed)) {
        return setFormError(ru ? "Укажите корректную длительность." : "Enter a valid duration.");
      }
      if (editor.durationType === "unknown" && (editor.calibrationMinutes < 5 || editor.calibrationMinutes > 1440)) {
        return setFormError(ru ? "Пробная сессия должна длиться от 5 минут до 24 часов." : "The calibration session must last 5 minutes to 24 hours.");
      }
      if (editor.flexibleTimeMode === "range" && Boolean(editor.allowedStartTime) !== Boolean(editor.allowedEndTime)) {
        return setFormError(ru ? "Для допустимого интервала нужны оба времени." : "Enter both ends of the allowed window.");
      }
      if (editor.flexibleTimeMode === "range" && editor.allowedStartTime && editor.allowedEndTime
        && plannerCommitmentDuration(editor.allowedStartTime, editor.allowedEndTime) < effectiveDuration) {
        return setFormError(ru ? "Дело не помещается в допустимый интервал." : "The item does not fit inside the allowed window.");
      }
      if (editor.canSplit && (editor.minChunkMinutes < 5 || editor.minChunkMinutes > effectiveDuration)) {
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
      if (!Number.isFinite(editor.travel.durationMinutes) || editor.travel.durationMinutes < 1 || editor.travel.durationMinutes > 1440) {
        return setFormError(ru ? "Укажите время одного пути или рассчитайте его." : "Enter or calculate one-way travel time.");
      }
      if (editor.travel.estimateMode !== "exact"
        && (editor.travel.minDurationMinutes < 1
          || editor.travel.minDurationMinutes > editor.travel.durationMinutes
          || editor.travel.durationMinutes > editor.travel.maxDurationMinutes
          || editor.travel.maxDurationMinutes > 1440)) {
        return setFormError(ru ? "Проверьте оценку дороги: минимум ≤ обычно ≤ максимум." : "Check travel estimate: minimum ≤ usual ≤ maximum.");
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
        <div className={`${styles.routeToggle} ${styles.threeWayToggle}`}><button type="button" className={editor.occurrenceMode === "once" ? styles.segmentedActive : ""} aria-pressed={editor.occurrenceMode === "once"} onClick={() => patchEditor({ occurrenceMode: "once" })}>{copy.once}</button><button type="button" className={editor.occurrenceMode === "recurring" ? styles.segmentedActive : ""} aria-pressed={editor.occurrenceMode === "recurring"} onClick={() => patchEditor({ occurrenceMode: "recurring", weekdays: editor.weekdays.length ? editor.weekdays : [1, 3, 5] })}>{copy.recurring}</button><button type="button" className={editor.occurrenceMode === "spare_time" ? styles.segmentedActive : ""} aria-pressed={editor.occurrenceMode === "spare_time"} onClick={() => patchEditor({ occurrenceMode: "spare_time", timeMode: "flexible", commitmentLevel: "if_time", weekdays: editor.weekdays.length ? editor.weekdays : WEEKDAYS, canSplit: true })}>{copy.spareTime}<small>{copy.spareTimeHint}</small></button></div>
        {editor.occurrenceMode === "once" ? <>
          {editor.timeMode === "fixed" ? <label>{copy.date}<input type="date" value={editor.date ?? ""} onChange={(event) => patchEditor({ date: event.target.value || undefined, dateMode: "exact" })} /></label> : <>
            <label>{copy.dateFlexibility}<select value={editor.dateMode} onChange={(event) => patchEditor({ dateMode: event.target.value as PlannerStructuredCommitment["dateMode"] })}><option value="exact">{copy.dateExact}</option><option value="preferred">{copy.datePreferred}</option><option value="range">{copy.dateRange}</option><option value="any">{copy.dateAny}</option></select></label>
            {editor.dateMode === "exact" && <label>{copy.date}<input type="date" value={editor.date ?? ""} onChange={(event) => patchEditor({ date: event.target.value || undefined })} /></label>}
            {editor.dateMode === "preferred" && <label>{copy.preferredDate}<input type="date" value={editor.preferredDate ?? ""} onChange={(event) => patchEditor({ preferredDate: event.target.value || undefined })} /></label>}
            {editor.dateMode === "range" && <div className={styles.formGrid}><label>{copy.earliestDate}<input type="date" value={editor.earliestDate ?? ""} onChange={(event) => patchEditor({ earliestDate: event.target.value || undefined })} /></label><label>{copy.latestDate}<input type="date" value={editor.latestDate ?? ""} onChange={(event) => patchEditor({ latestDate: event.target.value || undefined })} /></label></div>}
            {editor.dateMode === "any" && <small>{copy.dateHint}</small>}
          </>}
        </> : <>
          <div><span className={styles.fieldTitle}>{copy.days}</span><div className={styles.commitmentWeekdays}>{WEEKDAYS.map((day, index) => <button type="button" key={day} className={editor.weekdays.includes(day) ? styles.weekdayActive : ""} aria-pressed={editor.weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{dayNames[index]}</button>)}</div></div>
          <div><span className={styles.fieldTitle}>{copy.recurrenceRule}</span><div className={styles.routeToggle}><button type="button" className={editor.recurrenceMode === "exact_days" ? styles.segmentedActive : ""} onClick={() => patchEditor({ recurrenceMode: "exact_days" })}>{copy.exactDays}</button><button type="button" className={editor.recurrenceMode === "count_range" ? styles.segmentedActive : ""} onClick={() => patchEditor({ recurrenceMode: "count_range" })}>{copy.countRange}</button></div></div>
          {editor.recurrenceMode === "count_range" && <><label>{ru ? "Период" : "Period"}<select value={editor.recurrencePeriod} onChange={(event) => patchEditor({ recurrencePeriod: event.target.value as "week" | "month" })}><option value="week">{copy.perWeek}</option><option value="month">{copy.perMonth}</option></select></label><div className={styles.formGrid}><label>{copy.occurrencesMin}<input type="number" min={0} max={31} value={editor.minOccurrences} onChange={(event) => patchEditor({ minOccurrences: Number(event.target.value) })} /></label><label>{copy.occurrencesLikely}<input type="number" min={0} max={31} value={editor.likelyOccurrences} onChange={(event) => patchEditor({ likelyOccurrences: Number(event.target.value) })} /></label><label>{copy.occurrencesMax}<input type="number" min={0} max={31} value={editor.maxOccurrences} onChange={(event) => patchEditor({ maxOccurrences: Number(event.target.value) })} /></label></div></>}
        </>}
      </fieldset>

      <fieldset className={styles.commitmentFieldset}>
        <legend>{copy.timing}</legend>
        {editor.occurrenceMode === "spare_time"
          ? <small>{copy.spareTimeHint}</small>
          : <div className={styles.routeToggle}><button type="button" className={editor.timeMode === "fixed" ? styles.segmentedActive : ""} aria-pressed={editor.timeMode === "fixed"} onClick={() => patchEditor({ timeMode: "fixed", canSplit: false })}>{copy.fixed}<small>{copy.fixedHint}</small></button><button type="button" className={editor.timeMode === "flexible" ? styles.segmentedActive : ""} aria-pressed={editor.timeMode === "flexible"} onClick={() => patchEditor({ timeMode: "flexible" })}>{copy.flexible}<small>{copy.flexibleHint}</small></button></div>}
        {editor.timeMode === "fixed"
          ? <div className={styles.formGrid}><label>{copy.start}<input type="time" value={editor.startTime} onChange={(event) => patchEditor({ startTime: event.target.value })} /></label><label>{copy.end}<input type="time" value={editor.endTime} onChange={(event) => patchEditor({ endTime: event.target.value })} /></label></div>
          : <>
            <div><span className={styles.fieldTitle}>{copy.durationGoal}</span><div className={styles.routeToggle}><button type="button" className={editor.outcomeMode === "deliverable" ? styles.segmentedActive : ""} onClick={() => patchEditor({ outcomeMode: "deliverable", durationMode: "per_cycle", canSplit: true })}>{copy.finishResult}<small>{ru ? "Общий объём вычитается после каждой сессии." : "Each session reduces the total workload."}</small></button><button type="button" className={editor.outcomeMode === "time_budget" ? styles.segmentedActive : ""} onClick={() => patchEditor({ outcomeMode: "time_budget", durationMode: "per_occurrence" })}>{copy.allocateTime}<small>{ru ? "Бюджет относится к занятию или выбранному периоду." : "The budget applies to an occurrence or period."}</small></button></div></div>
            <div><span className={styles.fieldTitle}>{copy.activityDuration}</span><div className={`${styles.routeToggle} ${styles.durationModeChoices}`}>
              <button type="button" className={editor.durationType === "exact" ? styles.segmentedActive : ""} onClick={() => changeDurationMode("exact")}>{copy.exactDuration}</button>
              <button type="button" className={editor.durationType === "approximate" ? styles.segmentedActive : ""} onClick={() => changeDurationMode("approximate")}>{copy.approximateDuration}</button>
              <button type="button" className={editor.durationType === "range" ? styles.segmentedActive : ""} onClick={() => changeDurationMode("range")}>{copy.rangeDuration}</button>
              <button type="button" className={editor.durationType === "unknown" ? styles.segmentedActive : ""} onClick={() => changeDurationMode("unknown")}>{copy.unknownDuration}</button>
            </div></div>
            {editor.durationType === "exact" && <DurationInput label={copy.activityDuration} valueMinutes={editor.durationMinutes} minMinutes={5} maxMinutes={editor.outcomeMode === "deliverable" ? 600000 : 1440} locale={locale} onChangeMinutes={changeLikelyDuration} />}
            {editor.durationType === "approximate" && <><div className={styles.formGrid}><DurationInput label={copy.usualDuration} valueMinutes={editor.durationMinutes} minMinutes={5} maxMinutes={editor.outcomeMode === "deliverable" ? 600000 : 1440} locale={locale} onChangeMinutes={changeLikelyDuration} /><label>{copy.tolerance}<select value={editor.tolerancePercent} onChange={(event) => changeTolerance(Number(event.target.value) as 15 | 30 | 50)}><option value={15}>±15%</option><option value={30}>±30%</option><option value={50}>±50%</option></select></label></div><div className={styles.formGrid}><DurationInput label={copy.minimumDuration} valueMinutes={editor.minDurationMinutes} minMinutes={5} maxMinutes={editor.durationMinutes} locale={locale} onChangeMinutes={(minDurationMinutes) => patchEditor({ minDurationMinutes })} /><DurationInput label={copy.maximumDuration} valueMinutes={editor.maxDurationMinutes} minMinutes={editor.durationMinutes} maxMinutes={editor.outcomeMode === "deliverable" ? 600000 : 1440} locale={locale} onChangeMinutes={(maxDurationMinutes) => patchEditor({ maxDurationMinutes })} /></div></>}
            {editor.durationType === "range" && <div className={styles.formGrid}><DurationInput label={copy.minimumDuration} valueMinutes={editor.minDurationMinutes} minMinutes={5} maxMinutes={editor.durationMinutes} locale={locale} onChangeMinutes={(minDurationMinutes) => patchEditor({ minDurationMinutes })} /><DurationInput label={copy.usualDuration} valueMinutes={editor.durationMinutes} minMinutes={editor.minDurationMinutes} maxMinutes={editor.maxDurationMinutes} locale={locale} onChangeMinutes={changeLikelyDuration} /><DurationInput label={copy.maximumDuration} valueMinutes={editor.maxDurationMinutes} minMinutes={editor.durationMinutes} maxMinutes={editor.outcomeMode === "deliverable" ? 600000 : 1440} locale={locale} onChangeMinutes={(maxDurationMinutes) => patchEditor({ maxDurationMinutes })} /></div>}
            {editor.durationType === "unknown" && <><DurationInput label={copy.trialDuration} valueMinutes={editor.calibrationMinutes} minMinutes={5} maxMinutes={1440} locale={locale} onChangeMinutes={(calibrationMinutes) => patchEditor({ calibrationMinutes })} /><small>{ru ? "Планировщик создаст одну пробную сессию и после неё попросит оценить остаток." : "The planner creates one calibration session, then asks you to estimate what remains."}</small></>}
            {editor.outcomeMode === "time_budget" && editor.occurrenceMode !== "once" && <div><span className={styles.fieldTitle}>{copy.durationMeaning}</span><div className={styles.routeToggle}>
              <button type="button" className={editor.durationMode === "per_occurrence" ? styles.segmentedActive : ""} onClick={() => patchEditor({ durationMode: "per_occurrence" })}>{copy.perOccurrence}<small>{copy.perOccurrenceHint}</small></button>
              <button type="button" className={editor.durationMode === "per_cycle" ? styles.segmentedActive : ""} onClick={() => patchEditor({ durationMode: "per_cycle", canSplit: true })}>{copy.perCycle}<small>{copy.perCycleHint}</small></button>
            </div></div>}
            <label>{copy.timeFlexibility}<select value={editor.flexibleTimeMode} onChange={(event) => patchEditor({ flexibleTimeMode: event.target.value as PlannerStructuredCommitment["flexibleTimeMode"] })}><option value="any">{copy.dateAny}</option><option value="preferred">{copy.datePreferred}</option><option value="range">{copy.dateRange}</option></select></label>
            {editor.flexibleTimeMode === "preferred" && <label>{copy.preferredTime}<input type="time" value={editor.preferredStartTime ?? ""} onChange={(event) => patchEditor({ preferredStartTime: event.target.value || undefined })} /></label>}
            {editor.flexibleTimeMode === "range" && <><div className={styles.formGrid}><label>{copy.allowedFrom}<input type="time" value={editor.allowedStartTime ?? ""} onChange={(event) => patchEditor({ allowedStartTime: event.target.value || undefined })} /></label><label>{copy.allowedTo}<input type="time" value={editor.allowedEndTime ?? ""} onChange={(event) => patchEditor({ allowedEndTime: event.target.value || undefined })} /></label></div><small>{copy.allowedHint}</small></>}
          </>}
      </fieldset>

      <fieldset className={styles.commitmentFieldset}>
        <legend>{copy.planning}</legend>
        <div className={styles.formGrid}><label>{copy.commitment}<select value={editor.deadlineType === "hard" ? "must_not_skip" : editor.commitmentLevel} disabled={editor.deadlineType === "hard"} onChange={(event) => patchEditor({ commitmentLevel: event.target.value as PlannerCommitmentLevel })}><option value="must_not_skip">{copy.mustNotSkip}</option><option value="required">{copy.required}</option><option value="desired">{copy.desired}</option><option value="if_time">{copy.ifTime}</option></select>{editor.deadlineType === "hard" && <small>{ru ? "Жёсткий срок автоматически поднимает дело в первую группу." : "A hard deadline automatically promotes the item."}</small>}</label><label>{copy.priority}<select value={editor.priority} onChange={(event) => patchEditor({ priority: event.target.value as PlannerPriority })}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></label>{editor.timeMode === "flexible" && <label>{copy.deadlineType}<select value={editor.deadlineType} onChange={(event) => patchEditor({ deadlineType: event.target.value as PlannerDeadlineType, commitmentLevel: event.target.value === "hard" ? "must_not_skip" : editor.commitmentLevel })}><option value="none">{copy.noDeadline}</option><option value="target">{copy.targetDeadline}</option><option value="hard">{copy.hardDeadline}</option></select></label>}</div>
        {editor.timeMode === "flexible" && editor.deadlineType !== "none" && <div className={styles.formGrid}>{editor.deadlineType === "target" && <label>{copy.earliestDate}<input type="date" value={editor.deadlineEarliestDate ?? ""} onChange={(event) => patchEditor({ deadlineEarliestDate: event.target.value || undefined })} /></label>}<label>{editor.deadlineType === "hard" ? copy.deadlineDate : copy.latestDate}<input type="date" value={editor.deadlineDate ?? ""} onChange={(event) => patchEditor({ deadlineDate: event.target.value || undefined })} /></label><label>{copy.deadlineTime}<input type="time" value={editor.deadlineTime ?? "23:59"} onChange={(event) => patchEditor({ deadlineTime: event.target.value })} /></label></div>}
        {editor.timeMode === "flexible" && <><label className={styles.choiceCheck}><input type="checkbox" checked={editor.canSplit} onChange={(event) => patchEditor({ canSplit: event.target.checked })} />{copy.canSplit}</label>{editor.canSplit && <DurationInput label={copy.minChunk} valueMinutes={editor.minChunkMinutes} minMinutes={5} maxMinutes={editor.durationType === "unknown" ? editor.calibrationMinutes : editor.maxDurationMinutes} locale={locale} onChangeMinutes={(minChunkMinutes) => patchEditor({ minChunkMinutes })} />}</>}
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
          <div><span className={styles.fieldTitle}>{copy.travelEstimate}</span><div className={styles.routeToggle}><button type="button" className={editor.travel.estimateMode === "exact" ? styles.segmentedActive : ""} onClick={() => changeTravelEstimateMode("exact")}>{copy.exactDuration}</button><button type="button" className={editor.travel.estimateMode === "approximate" ? styles.segmentedActive : ""} onClick={() => changeTravelEstimateMode("approximate")}>{copy.approximateDuration}</button><button type="button" className={editor.travel.estimateMode === "range" ? styles.segmentedActive : ""} onClick={() => changeTravelEstimateMode("range")}>{copy.rangeDuration}</button></div></div>
          {editor.travel.estimateMode === "exact" ? <DurationInput label={copy.duration} valueMinutes={editor.travel.durationMinutes} minMinutes={1} maxMinutes={1440} locale={locale} onChangeMinutes={(durationMinutes) => patchTravel({ durationMinutes, minDurationMinutes: durationMinutes, maxDurationMinutes: durationMinutes, estimatedByNavigator: false })} /> : <><div className={styles.formGrid}><DurationInput label={copy.minimumDuration} valueMinutes={editor.travel.minDurationMinutes} minMinutes={1} maxMinutes={editor.travel.durationMinutes} locale={locale} onChangeMinutes={(minDurationMinutes) => patchTravel({ minDurationMinutes })} /><DurationInput label={copy.usualDuration} valueMinutes={editor.travel.durationMinutes} minMinutes={editor.travel.minDurationMinutes} maxMinutes={editor.travel.maxDurationMinutes} locale={locale} onChangeMinutes={(durationMinutes) => { const bounds = editor.travel.estimateMode === "approximate" ? approximateBounds(durationMinutes, editor.travel.tolerancePercent) : {}; patchTravel({ durationMinutes, ...bounds, estimatedByNavigator: false }); }} /><DurationInput label={copy.maximumDuration} valueMinutes={editor.travel.maxDurationMinutes} minMinutes={editor.travel.durationMinutes} maxMinutes={1440} locale={locale} onChangeMinutes={(maxDurationMinutes) => patchTravel({ maxDurationMinutes })} /></div>{editor.travel.estimateMode === "approximate" && <label>{copy.tolerance}<select value={editor.travel.tolerancePercent} onChange={(event) => { const tolerancePercent = Number(event.target.value) as 15 | 30 | 50; const bounds = approximateBounds(editor.travel.durationMinutes, tolerancePercent); patchTravel({ tolerancePercent, minDurationMinutes: bounds.minDurationMinutes, maxDurationMinutes: bounds.maxDurationMinutes }); }}><option value={15}>±15%</option><option value={30}>±30%</option><option value={50}>±50%</option></select></label>}</>}
          <label>{copy.punctuality}<select value={editor.travel.punctuality} onChange={(event) => patchTravel({ punctuality: event.target.value as PlannerStructuredCommitment["travel"]["punctuality"] })}><option value="strict">{copy.strictArrival}</option><option value="normal">{copy.normalArrival}</option><option value="flexible">{copy.flexibleArrival}</option></select></label>
          <DurationInput label={copy.reserve} valueMinutes={editor.travel.bufferMinutes} maxMinutes={1440} locale={locale} onChangeMinutes={(bufferMinutes) => patchTravel({ bufferMinutes })} />
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
        const occurrence = commitment.occurrenceMode !== "once"
          ? `${commitment.occurrenceMode === "spare_time" ? `${copy.spareTime}: ` : ""}${commitment.weekdays.map((day) => dayNames[day - 1]).join(", ")}`
          : commitment.date || copy.anyDay;
        const durationSummary = commitment.durationType === "unknown"
          ? `${copy.trialDuration}: ${plannerDurationLabel(commitment.calibrationMinutes, locale)}`
          : commitment.durationType === "exact"
            ? plannerDurationLabel(commitment.durationMinutes, locale)
            : `${plannerDurationLabel(commitment.minDurationMinutes, locale)} — ${plannerDurationLabel(commitment.durationMinutes, locale)} — ${plannerDurationLabel(commitment.maxDurationMinutes, locale)}`;
        const timing = commitment.timeMode === "fixed"
          ? `${commitment.startTime}–${commitment.endTime}`
          : `${durationSummary}${commitment.occurrenceMode !== "once"
              ? commitment.outcomeMode === "deliverable" || commitment.durationMode === "per_cycle"
                ? (ru ? " всего на выбранные дни за неделю" : " total across the selected days per week")
                : (ru ? " в каждый выбранный день" : " on every selected day")
              : ""} · ${commitment.allowedStartTime && commitment.allowedEndTime ? `${commitment.allowedStartTime}–${commitment.allowedEndTime}` : copy.autoTime}`;
        return <article className={styles.commitmentCard} key={commitment.id}>
          <div className={styles.commitmentCardMain}><span>{plannerCommitmentCategoryLabel(commitment.category, locale)} · {commitmentLabels[commitment.commitmentLevel]}</span><strong>{commitment.title}</strong><p>{occurrence} · {timing}</p>{commitment.travel.enabled ? <small>{copy.route}: {commitment.travel.originLabel || commitment.travel.originAddress} → {commitment.travel.destinationLabel || commitment.travel.destinationAddress} · {plannerTravelModeLabel(commitment.travel.mode, locale)} · {commitment.travel.estimateMode === "exact" ? plannerDurationLabel(commitment.travel.durationMinutes, locale) : `${plannerDurationLabel(commitment.travel.minDurationMinutes, locale)} — ${plannerDurationLabel(commitment.travel.durationMinutes, locale)} — ${plannerDurationLabel(commitment.travel.maxDurationMinutes, locale)}`} {ru ? "в одну сторону" : "one way"} · {commitment.travel.direction === "round_trip" ? copy.roundTrip : copy.oneWay}</small> : <small>{copy.noRoute}</small>}</div>
          <div className={styles.commitmentCardActions}><button type="button" onClick={() => startEditing(commitment)}>{copy.edit}</button><button type="button" className={styles.commitmentRemove} onClick={() => onChange(commitments.filter((candidate) => candidate.id !== commitment.id))}>{copy.remove}</button></div>
        </article>;
      })}</div>
      {commitments.length > 0 && <section className={styles.commitmentHierarchy}>
        <div><strong>{ru ? "Иерархия гибких дел" : "Flexible-item hierarchy"}</strong><p>{ru ? "Выберите группу и перетаскивайте карточки внутри неё: выше — важнее. Жёсткий срок всегда относится к первой группе." : "Choose a group and drag cards within it: higher means more important. Hard deadlines always belong to the first group."}</p></div>
        {(["must_not_skip", "required", "desired", "if_time"] as PlannerCommitmentLevel[]).map((level) => <div className={styles.hierarchyGroup} key={level}>
          <h4>{commitmentLabels[level]}</h4>
          {commitments.filter((item) => (item.deadlineType === "hard" ? "must_not_skip" : item.commitmentLevel) === level).sort((left, right) => left.planningRank - right.planningRank || left.id.localeCompare(right.id)).map((item) => <div
            className={styles.hierarchyItem}
            draggable={item.deadlineType !== "hard"}
            key={item.id}
            onDragStart={() => setDraggedCommitmentId(item.id)}
            onDragEnd={() => setDraggedCommitmentId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => { if (draggedCommitmentId) reorderCommitments(draggedCommitmentId, item.id); setDraggedCommitmentId(null); }}
          ><span aria-hidden="true">↕</span><strong>{item.title}</strong><select aria-label={ru ? `Обязательность: ${item.title}` : `Commitment: ${item.title}`} value={item.deadlineType === "hard" ? "must_not_skip" : item.commitmentLevel} disabled={item.deadlineType === "hard"} onChange={(event) => moveCommitmentToLevel(item.id, event.target.value as PlannerCommitmentLevel)}><option value="must_not_skip">{copy.mustNotSkip}</option><option value="required">{copy.required}</option><option value="desired">{copy.desired}</option><option value="if_time">{copy.ifTime}</option></select></div>)}
        </div>)}
      </section>}
      {!commitments.length && <p className={styles.commitmentEmpty}>{copy.empty}</p>}
    </>}
  </div>;
}
