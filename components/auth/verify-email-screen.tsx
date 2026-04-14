"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type VerifyEmailPayload = {
  data?: {
    id: string;
    email: string | null;
    emailVerifiedAt: string | null;
  };
  error?: string;
};

type VerifyEmailScreenProps = {
  token: string;
};

export default function VerifyEmailScreen({ token }: VerifyEmailScreenProps) {
  const normalizedToken = token.trim();
  const hasStartedRef = useRef(false);

  const [isBusy, setIsBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    hasStartedRef.current = true;

    if (!normalizedToken) {
      setError("В ссылке нет токена подтверждения.");
      setIsBusy(false);
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
          throw new Error(payload.error ?? "Не удалось подтвердить email.");
        }

        setInfo("Email подтвержден. Можно открыть рабочую область.");
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Не удалось подтвердить email."
        );
      } finally {
        setIsBusy(false);
      }
    }

    void verify();
  }, [normalizedToken]);

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d w-full max-w-xl p-5">
          <h1 className="font-display text-5xl leading-none">Подтверждение email</h1>

          {isBusy && <p className="mt-3 text-sm text-[#202020]">Проверяю ссылку...</p>}

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
              в workspace
            </Link>
            <Link
              href="/forgot-password"
              className="mini-action inline-flex items-center justify-center"
            >
              сбросить пароль
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
