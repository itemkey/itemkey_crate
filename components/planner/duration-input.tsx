"use client";

import { useState } from "react";

import type { Locale } from "@/lib/i18n";
import styles from "./planner-workspace.module.css";

function partsFromMinutes(value: number | string): { hours: string; minutes: string } {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return {
    hours: hours ? String(hours) : "",
    minutes: minutes ? String(minutes) : "",
  };
}

function minutesFromParts(hours: string, minutes: string): number {
  return Math.max(0, Math.round((Number(hours) || 0) * 60 + (Number(minutes) || 0)));
}

export default function DurationInput({
  label,
  valueMinutes,
  onChangeMinutes,
  locale,
  minMinutes = 0,
  maxMinutes = 1440,
  minuteStep = 5,
}: {
  label: string;
  valueMinutes: number | string;
  onChangeMinutes: (minutes: number) => void;
  locale: Locale;
  minMinutes?: number;
  maxMinutes?: number;
  minuteStep?: number;
}) {
  const [hoursDraft, setHoursDraft] = useState<string | null>(null);
  const [minutesDraft, setMinutesDraft] = useState<string | null>(null);
  const externalParts = partsFromMinutes(valueMinutes);
  const hours = hoursDraft ?? externalParts.hours;
  const minutes = minutesDraft ?? externalParts.minutes;

  const hoursLabel = locale === "ru" ? "Часы" : "Hours";
  const minutesLabel = locale === "ru" ? "Минуты" : "Minutes";
  const hourValue = Math.max(0, Number(hours) || 0);
  const minimumMinutePart = hourValue > 0 ? 0 : Math.min(59, minMinutes);
  const maximumMinutePart = Math.min(59, Math.max(0, maxMinutes - hourValue * 60));

  return <div className={styles.durationField} role="group" aria-label={label}>
    <span className={styles.fieldTitle}>{label}</span>
    <div className={styles.durationParts}>
      <label>{hoursLabel}<input
        type="number"
        inputMode="numeric"
        min="0"
        max={Math.floor(maxMinutes / 60)}
        step="1"
        placeholder="0"
        aria-label={`${label}: ${hoursLabel}`}
        value={hours}
        onFocus={(event) => { setHoursDraft(event.currentTarget.value); event.currentTarget.select(); }}
        onBlur={() => setHoursDraft(null)}
        onChange={(event) => {
          const next = event.target.value;
          setHoursDraft(next);
          onChangeMinutes(minutesFromParts(next, minutes));
        }}
      /></label>
      <label>{minutesLabel}<input
        type="number"
        inputMode="numeric"
        min={minimumMinutePart}
        max={maximumMinutePart}
        step={minuteStep}
        placeholder="0"
        aria-label={`${label}: ${minutesLabel}`}
        value={minutes}
        onFocus={(event) => { setMinutesDraft(event.currentTarget.value); event.currentTarget.select(); }}
        onBlur={() => setMinutesDraft(null)}
        onChange={(event) => {
          const next = event.target.value;
          setMinutesDraft(next);
          onChangeMinutes(minutesFromParts(hours, next));
        }}
      /></label>
    </div>
  </div>;
}
