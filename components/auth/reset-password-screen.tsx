"use client";

import Link from "next/link";
import { useState } from "react";

type ResetPasswordPayload = {
  data?: {
    id: string;
    email: string | null;
    emailVerifiedAt: string | null;
  };
  error?: string;
};

type ResetPasswordScreenProps = {
  token: string;
};

export default function ResetPasswordScreen({ token }: ResetPasswordScreenProps) {
  const normalizedToken = token.trim();

  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit() {
    if (!normalizedToken) {
      setError("В ссылке отсутствует токен сброса.");
      return;
    }

    if (!password.trim()) {
      setError("Введи новый пароль.");
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
        throw new Error(payload.error ?? "Не удалось обновить пароль.");
      }

      setInfo("Пароль обновлен. Сессия активирована, можно перейти в рабочую область.");
      setPassword("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось обновить пароль."
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d w-full max-w-xl p-5">
          <h1 className="font-display text-5xl leading-none">Новый пароль</h1>

          {!normalizedToken ? (
            <p className="mt-3 rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]">
              В ссылке нет токена. Запроси новую ссылку для сброса.
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm text-[#202020]">
                Введи новый пароль для аккаунта. После успешного сброса ты автоматически
                войдешь в систему.
              </p>

              <label className="settings-label mt-4">Новый пароль</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="settings-input"
                placeholder="Минимум 6 символов"
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
                  сохранить пароль
                </button>
                <Link
                  href="/crate"
                  className="mini-action inline-flex items-center justify-center"
                >
                  в workspace
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
                запросить новую ссылку
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
