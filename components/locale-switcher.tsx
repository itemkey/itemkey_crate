"use client";

import { useI18n } from "@/components/i18n-provider";
import type { Locale } from "@/lib/i18n";

export default function LocaleSwitcher({
  className = "",
  onChange,
  disabled = false,
  compact = false,
}: {
  className?: string;
  onChange?: (locale: Locale) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { locale, setLocale, t } = useI18n();

  function selectLocale(nextLocale: Locale) {
    if (nextLocale === locale || disabled) {
      return;
    }
    setLocale(nextLocale);
    void onChange?.(nextLocale);
  }

  return (
    <div
      className={`locale-switcher ${compact ? "locale-switcher-compact" : ""} ${className}`.trim()}
      role="group"
      aria-label={t("language.label")}
    >
      {(["ru", "en"] as const).map((item) => (
        <button
          key={item}
          type="button"
          className={`locale-switcher-button ${locale === item ? "locale-switcher-button-active" : ""}`}
          onClick={() => selectLocale(item)}
          aria-pressed={locale === item}
          disabled={disabled}
        >
          {item.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
