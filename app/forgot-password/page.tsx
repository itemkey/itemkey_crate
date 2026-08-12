"use client";

import Link from "next/link";
import { useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import LocaleSwitcher from "@/components/locale-switcher";
import { localizeApiError } from "@/lib/api-errors";

type ForgotPasswordPayload = {
  ok?: boolean;
  message?: string;
  error?: string;
  code?: string;
};

export default function ForgotPasswordPage() {
  const { locale, t } = useI18n();
  const [email, setEmail] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit() {
    const normalized = email.trim();
    if (!normalized) {
      setError(t("auth.enterEmail"));
      return;
    }

    setIsBusy(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ email: normalized }),
      });

      const payload = (await response.json()) as ForgotPasswordPayload;
      if (!response.ok) {
        throw new Error(localizeApiError(locale, payload, "auth.resetSendFailed"));
      }

      setInfo(t("auth.resetSent"));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("auth.resetSendFailed")
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d entry-form-panel w-full max-w-xl p-5">
          <div className="entry-form-head">
            <h1 className="font-display text-5xl leading-none">{t("auth.forgotTitle")}</h1>
            <LocaleSwitcher compact />
          </div>
          <p className="mt-3 text-sm text-[#202020]">
            {t("auth.forgotIntro")}
          </p>

          <label className="settings-label mt-4">Email</label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="settings-input"
            placeholder="you@example.com"
            autoComplete="email"
          />

          {error && (
            <p className="mt-3 rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]">
              {error}
            </p>
          )}

          {info && (
            <p className="mt-3 rounded border-2 border-[#476018] bg-[#bdd39f] px-3 py-2 text-sm text-[#1f2d0d]">
              {info}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="mini-action"
              onClick={() => void handleSubmit()}
              disabled={isBusy}
            >
              {t("auth.sendReset")}
            </button>
            <Link
              href="/crate"
              className="mini-action inline-flex items-center justify-center"
            >
              {t("auth.backToLogin")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
