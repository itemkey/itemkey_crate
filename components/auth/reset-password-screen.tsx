"use client";

import Link from "next/link";
import { useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import LocaleSwitcher from "@/components/locale-switcher";
import { localizeApiError } from "@/lib/api-errors";

type ResetPasswordPayload = {
  data?: {
    id: string;
    email: string | null;
    emailVerifiedAt: string | null;
  };
  error?: string;
  code?: string;
};

type ResetPasswordScreenProps = {
  token: string;
};

export default function ResetPasswordScreen({ token }: ResetPasswordScreenProps) {
  const { locale, t } = useI18n();
  const normalizedToken = token.trim();

  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit() {
    if (!normalizedToken) {
      setError(t("auth.missingResetToken"));
      return;
    }

    if (!password.trim()) {
      setError(t("auth.enterNewPassword"));
      return;
    }

    setIsBusy(true);
    setError(null);
    setInfo(null);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          token: normalizedToken,
          password,
        }),
      });

      const payload = (await response.json()) as ResetPasswordPayload;
      if (!response.ok || !payload.data) {
        throw new Error(localizeApiError(locale, payload, "auth.passwordUpdateFailed"));
      }

      setInfo(t("auth.passwordUpdated"));
      setPassword("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("auth.passwordUpdateFailed")
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
            <h1 className="font-display text-5xl leading-none">{t("auth.resetTitle")}</h1>
            <LocaleSwitcher compact />
          </div>

          {!normalizedToken ? (
            <p className="mt-3 rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]">
              {t("auth.missingResetToken")}
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm text-[#202020]">
                {t("auth.resetIntro")}
              </p>

              <label className="settings-label mt-4">{t("auth.newPassword")}</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="settings-input"
                placeholder={t("auth.passwordMin")}
                autoComplete="new-password"
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
                  {t("auth.savePassword")}
                </button>
                <Link
                  href="/crate"
                  className="mini-action inline-flex items-center justify-center"
                >
                  {t("auth.toWorkspace")}
                </Link>
              </div>
            </>
          )}

          {!normalizedToken && (
            <div className="mt-4">
              <Link
                href="/forgot-password"
                className="mini-action inline-flex items-center justify-center"
              >
                {t("auth.requestNewLink")}
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
