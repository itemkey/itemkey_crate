"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import LocaleSwitcher from "@/components/locale-switcher";
import { localizeApiError } from "@/lib/api-errors";

type VerifyEmailPayload = {
  data?: {
    id: string;
    email: string | null;
    emailVerifiedAt: string | null;
  };
  error?: string;
  code?: string;
};

type VerifyEmailScreenProps = {
  token: string;
};

export default function VerifyEmailScreen({ token }: VerifyEmailScreenProps) {
  const { locale, t } = useI18n();
  const normalizedToken = token.trim();
  const hasStartedRef = useRef(false);

  const [isBusy, setIsBusy] = useState(Boolean(normalizedToken));
  const [error, setError] = useState<string | null>(
    normalizedToken ? null : t("auth.missingVerifyToken")
  );
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;

    if (!normalizedToken) {
      return;
    }

    async function verify() {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({ token: normalizedToken }),
        });

        const payload = (await response.json()) as VerifyEmailPayload;
        if (!response.ok || !payload.data) {
          throw new Error(localizeApiError(locale, payload, "auth.verifyFailed"));
        }

        setInfo(t("auth.verifySuccess"));
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : t("auth.verifyFailed")
        );
      } finally {
        setIsBusy(false);
      }
    }

    void verify();
  }, [locale, normalizedToken, t]);

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d entry-form-panel w-full max-w-xl p-5">
          <div className="entry-form-head">
            <h1 className="font-display text-5xl leading-none">{t("auth.verifyTitle")}</h1>
            <LocaleSwitcher compact />
          </div>

          {isBusy && <p className="mt-3 text-sm text-[#202020]">{t("auth.verifyChecking")}</p>}

          {!isBusy && error && (
            <p className="mt-3 rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]">
              {error}
            </p>
          )}

          {!isBusy && info && (
            <p className="mt-3 rounded border-2 border-[#476018] bg-[#bdd39f] px-3 py-2 text-sm text-[#1f2d0d]">
              {info}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/crate"
              className="mini-action inline-flex items-center justify-center"
            >
              {t("auth.toWorkspace")}
            </Link>
            <Link
              href="/forgot-password"
              className="mini-action inline-flex items-center justify-center"
            >
              {t("auth.resetPasswordLink")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
