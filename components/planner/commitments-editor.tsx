"use client";

import { useEffect, useMemo, useState } from "react";

import type { Locale } from "@/lib/i18n";
import {
  plannerCommitmentCategoryLabel,
  plannerTravelModeLabel,
  type PlannerCommitmentCategory,
  type PlannerSavedPlace,
  type PlannerStructuredCommitment,
  type PlannerTravelEstimateInput,
  type PlannerTravelEstimateResult,
  type PlannerTravelMode,
} from "@/lib/planner/commitments";
import { createRuntimeId } from "@/lib/runtime-id";
import styles from "./planner-workspace.module.css";

const PLACES_STORAGE_KEY = "itemkey.planner.saved-places.v1";
const CATEGORIES: PlannerCommitmentCategory[] = ["work", "education", "health", "sport", "personal", "other"];
const TRAVEL_MODES: PlannerTravelMode[] = ["walk", "transit", "car"];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

type OriginMode = "home" | "saved" | "temporary";

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
  return {
    id: createRuntimeId(),
    title: title.trim(),
    category: "other",
    weekdays: [],
    startTime: "",
    endTime: "",
    travel: {
      enabled: false,
      mode: "transit",
      durationMinutes: 30,
      bufferMinutes: 10,
    },
  };
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
  const [formError, setFormError] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState("");

  const copy = ru ? {
    addPlaceholder: "Работа, занятия, тренировка или другое регулярное дело",
    add: "Добавить дело",
    empty: "Пока ничего не добавлено. Каждое дело появится здесь отдельной карточкой.",
    edit: "Изменить",
    remove: "Удалить",
    what: "1. Что это за дело",
    title: "Название",
    category: "Тип дела",
    when: "2. Когда оно происходит",
    days: "Дни недели",
    start: "Начало",
    end: "Конец",
    road: "3. Нужно ли добираться",
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
    mode: "Как добираться",
    calculate: "Рассчитать по навигатору",
    calculating: "Считаю маршрут…",
    duration: "Время в пути, минут",
    reserve: "Запас на выход и задержки, минут",
    routeHint: "После расчёта время можно поправить вручную. Планировщик освободит его перед началом дела.",
    navigatorPrivacy: "Для расчёта начальный и конечный адреса передаются сервисам OpenStreetMap. Если не хотите передавать адреса, укажите время в пути вручную.",
    notes: "Дополнительные детали (необязательно)",
    notesPlaceholder: "Что взять, подготовить или учесть перед делом",
    cancel: "Отмена",
    save: "Сохранить дело",
    editTitle: "Подробный план дела",
    route: "Дорога",
    noRoute: "без дороги",
    savedNavigator: "рассчитано по навигатору",
    manualRoute: "указано вручную",
  } : {
    addPlaceholder: "Work, class, workout or another recurring item",
    add: "Add item",
    empty: "Nothing has been added yet. Each commitment will appear as a separate card.",
    edit: "Edit",
    remove: "Remove",
    what: "1. What is it",
    title: "Title",
    category: "Item type",
    when: "2. When it happens",
    days: "Weekdays",
    start: "Starts",
    end: "Ends",
    road: "3. Travel",
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
    mode: "Travel mode",
    calculate: "Calculate with navigator",
    calculating: "Calculating route…",
    duration: "Travel time, minutes",
    reserve: "Extra delay buffer, minutes",
    routeHint: "You can adjust the estimate manually. The planner will protect this time before the commitment.",
    navigatorPrivacy: "Route calculation sends the origin and destination to OpenStreetMap services. Enter travel time manually if you prefer not to share addresses.",
    notes: "Extra details (optional)",
    notesPlaceholder: "What to bring, prepare or keep in mind",
    cancel: "Cancel",
    save: "Save item",
    editTitle: "Detailed item plan",
    route: "Travel",
    noRoute: "no travel",
    savedNavigator: "navigator estimate",
    manualRoute: "manual estimate",
  };
  const dayNames = ru ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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
    setEditor(blankCommitment(quickTitle));
  }

  function startEditing(commitment: PlannerStructuredCommitment) {
    const originPlace = places.find((place) => place.id === commitment.travel.originPlaceId);
    setOriginMode(originPlace?.kind === "home" ? "home" : originPlace ? "saved" : "temporary");
    setSelectedPlaceId(originPlace?.id ?? "");
    setOriginAddress(commitment.travel.originAddress ?? originPlace?.address ?? "");
    setOriginLabel(commitment.travel.originLabel ?? originPlace?.label ?? "");
    setRememberOrigin(false);
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

  async function estimateRoute() {
    if (!editor) return;
    const origin = currentOriginAddress();
    const destination = editor.travel.destinationAddress?.trim() ?? "";
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
    if (!editor.weekdays.length) return setFormError(ru ? "Выберите хотя бы один день недели." : "Choose at least one weekday.");
    if (!editor.startTime || !editor.endTime) return setFormError(ru ? "Укажите время начала и окончания." : "Enter both start and end times.");

    let originPlace: PlannerSavedPlace | undefined = selectedOrigin;
    let normalizedTravel = { ...editor.travel };
    if (editor.travel.enabled) {
      const address = currentOriginAddress();
      if (!address || !editor.travel.destinationAddress?.trim()) {
        return setFormError(ru ? "Для дороги нужны адрес отправления и адрес назначения." : "Travel requires origin and destination addresses.");
      }
      if (!Number.isFinite(editor.travel.durationMinutes) || editor.travel.durationMinutes < 1) {
        return setFormError(ru ? "Укажите время в пути или рассчитайте его." : "Enter or calculate the travel time.");
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
      normalizedTravel = {
        ...editor.travel,
        originAddress: address,
        originLabel: originPlace?.label ?? (originLabel.trim() || (ru ? "Другой адрес" : "Another address")),
        originPlaceId: originPlace?.id,
        destinationAddress: editor.travel.destinationAddress.trim(),
        durationMinutes: Math.round(editor.travel.durationMinutes),
        bufferMinutes: Math.max(0, Math.round(editor.travel.bufferMinutes)),
      };
    }

    const normalized = { ...editor, travel: normalizedTravel, title: editor.title.trim(), weekdays: [...editor.weekdays].sort((a, b) => a - b) };
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
        <div><span className={styles.fieldTitle}>{copy.days}</span><div className={styles.commitmentWeekdays}>{WEEKDAYS.map((day, index) => <button type="button" key={day} className={editor.weekdays.includes(day) ? styles.weekdayActive : ""} aria-pressed={editor.weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{dayNames[index]}</button>)}</div></div>
        <div className={styles.formGrid}><label>{copy.start}<input type="time" value={editor.startTime} onChange={(event) => patchEditor({ startTime: event.target.value })} /></label><label>{copy.end}<input type="time" value={editor.endTime} onChange={(event) => patchEditor({ endTime: event.target.value })} /></label></div>
      </fieldset>

      <fieldset className={styles.commitmentFieldset}>
        <legend>{copy.road}</legend>
        <div className={styles.routeToggle}><button type="button" className={!editor.travel.enabled ? styles.segmentedActive : ""} aria-pressed={!editor.travel.enabled} onClick={() => patchTravel({ enabled: false })}>{copy.noRoad}</button><button type="button" className={editor.travel.enabled ? styles.segmentedActive : ""} aria-pressed={editor.travel.enabled} onClick={() => patchTravel({ enabled: true })}>{copy.hasRoad}</button></div>
        {editor.travel.enabled && <div className={styles.routeFields}>
          <label>{copy.from}<select value={originMode} onChange={(event) => { const next = event.target.value as OriginMode; setOriginMode(next); setEstimateError(""); if (next === "home") { setOriginAddress(home?.address ?? ""); setSelectedPlaceId(home?.id ?? ""); } else if (next === "saved") { const first = savedPlaces[0]; setSelectedPlaceId(first?.id ?? ""); setOriginAddress(first?.address ?? ""); } else { setSelectedPlaceId(""); setOriginAddress(""); } }}><option value="home">{copy.home}</option><option value="saved" disabled={!savedPlaces.length}>{copy.saved}</option><option value="temporary">{copy.temporary}</option></select></label>
          {originMode === "home" && (home ? <div className={styles.savedPlacePreview}><strong>{home.label}</strong><span>{home.address}</span><button type="button" onClick={() => { setPlaces((current) => current.filter((place) => place.id !== home.id)); setOriginAddress(""); }}>{ru ? "Изменить адрес" : "Change address"}</button></div> : <label>{copy.homeAddress}<input value={originAddress} onChange={(event) => setOriginAddress(event.target.value)} placeholder={ru ? "Город, улица, дом" : "City, street, house"} /><small>{ru ? "Спросим один раз и запомним как «Дом» только в этом браузере." : "We will ask once and remember it as Home in this browser."}</small></label>)}
          {originMode === "saved" && <label>{copy.savedPlace}<select value={selectedPlaceId} onChange={(event) => setSelectedPlaceId(event.target.value)}>{savedPlaces.map((place) => <option value={place.id} key={place.id}>{place.label} — {place.address}</option>)}</select></label>}
          {originMode === "temporary" && <><label>{copy.address}<input value={originAddress} onChange={(event) => setOriginAddress(event.target.value)} placeholder={ru ? "Адрес, откуда поедете" : "Starting address"} /></label><label className={styles.choiceCheck}><input type="checkbox" checked={rememberOrigin} onChange={(event) => setRememberOrigin(event.target.checked)} />{copy.remember}</label>{rememberOrigin && <label>{copy.placeName}<input value={originLabel} onChange={(event) => setOriginLabel(event.target.value)} placeholder={ru ? "Дом родителей, офис или другое понятное название" : "Parents’ home, office or another clear name"} /></label>}</>}
          <label>{copy.to}<input value={editor.travel.destinationAddress ?? ""} onChange={(event) => patchTravel({ destinationAddress: event.target.value, estimatedByNavigator: false })} placeholder={ru ? "Город, улица, дом" : "City, street, house"} /></label>
          <div><span className={styles.fieldTitle}>{copy.mode}</span><div className={styles.travelModes}>{TRAVEL_MODES.map((mode) => <button type="button" key={mode} className={editor.travel.mode === mode ? styles.segmentedActive : ""} aria-pressed={editor.travel.mode === mode} onClick={() => patchTravel({ mode, estimatedByNavigator: false })}>{plannerTravelModeLabel(mode, locale)}</button>)}</div></div>
          <button type="button" className={styles.routeEstimateButton} disabled={estimating} onClick={() => void estimateRoute()}>{estimating ? copy.calculating : copy.calculate}</button>
          <small className={styles.routePrivacy}>{copy.navigatorPrivacy}</small>
          {estimateError && <p className={styles.routeError}>{estimateError} {ru ? "Можно указать время вручную ниже." : "You can enter the time manually below."}</p>}
          {editor.travel.distanceKm !== undefined && <div className={styles.routeEstimate}><strong>≈ {editor.travel.durationMinutes} {ru ? "мин" : "min"}</strong><span>{editor.travel.distanceKm.toLocaleString(locale, { maximumFractionDigits: 1 })} {ru ? "км" : "km"} · {editor.travel.estimatedByNavigator ? copy.savedNavigator : copy.manualRoute}</span></div>}
          <div className={styles.formGrid}><label>{copy.duration}<input type="number" min="1" max="240" step="5" value={editor.travel.durationMinutes} onChange={(event) => patchTravel({ durationMinutes: Number(event.target.value), estimatedByNavigator: false })} /></label><label>{copy.reserve}<input type="number" min="0" max="120" step="5" value={editor.travel.bufferMinutes} onChange={(event) => patchTravel({ bufferMinutes: Number(event.target.value) })} /></label></div>
          <small className={styles.routeHint}>{copy.routeHint}</small>
        </div>}
      </fieldset>

      <label>{copy.notes}<textarea className={styles.commitmentNotes} value={editor.notes ?? ""} onChange={(event) => patchEditor({ notes: event.target.value })} placeholder={copy.notesPlaceholder} /></label>
      {formError && <p className={styles.inlineError} role="alert">{formError}</p>}
      <div className={styles.commitmentEditorActions}><button type="button" onClick={() => { setEditor(null); setFormError(""); }}>{copy.cancel}</button><button type="button" className={styles.primaryButton} onClick={saveCommitment}>{copy.save}</button></div>
    </div> : <>
      <form className={styles.commitmentQuickAdd} onSubmit={(event) => { event.preventDefault(); startAdding(); }}><label><span className={styles.fieldTitle}>{ru ? "Новое регулярное дело" : "New recurring item"}</span><input value={quickTitle} onChange={(event) => { setQuickTitle(event.target.value); setFormError(""); }} placeholder={copy.addPlaceholder} /></label><button className={styles.primaryButton}>{copy.add}</button></form>
      {formError && <p className={styles.inlineError} role="alert">{formError}</p>}
      <div className={styles.commitmentList}>{commitments.map((commitment) => <article className={styles.commitmentCard} key={commitment.id}>
        <div className={styles.commitmentCardMain}><span>{plannerCommitmentCategoryLabel(commitment.category, locale)}</span><strong>{commitment.title}</strong><p>{commitment.weekdays.map((day) => dayNames[day - 1]).join(", ")} · {commitment.startTime}–{commitment.endTime}</p>{commitment.travel.enabled ? <small>{copy.route}: {commitment.travel.originLabel || commitment.travel.originAddress} → {commitment.travel.destinationAddress} · {plannerTravelModeLabel(commitment.travel.mode, locale)} · {commitment.travel.durationMinutes + commitment.travel.bufferMinutes} {ru ? "мин до выхода и дороги" : "min protected before start"}</small> : <small>{copy.noRoute}</small>}</div>
        <div className={styles.commitmentCardActions}><button type="button" onClick={() => startEditing(commitment)}>{copy.edit}</button><button type="button" className={styles.commitmentRemove} onClick={() => onChange(commitments.filter((candidate) => candidate.id !== commitment.id))}>{copy.remove}</button></div>
      </article>)}</div>
      {!commitments.length && <p className={styles.commitmentEmpty}>{copy.empty}</p>}
    </>}
  </div>;
}
