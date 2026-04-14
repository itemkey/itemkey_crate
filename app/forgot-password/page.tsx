"use client";

import Link from "next/link";
import { useState } from "react";

type ForgotPasswordPayload = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit() {
    const normalized = email.trim();
    if (!normalized) {
      setError("Введи email.");
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
        throw new Error(payload.error ?? "Не удалось отправить ссылку для сброса.");
      }

      setInfo(
        payload.message ??
          "Если аккаунт с таким email существует, мы отправили ссылку для сброса."
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось отправить ссылку для сброса."
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d w-full max-w-xl p-5">
          <h1 className="font-display text-5xl leading-none">Сброс пароля</h1>
          <p className="mt-3 text-sm text-[#202020]">
            Введи email, привязанный к аккаунту. Мы отправим ссылку для установки нового пароля.
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
              отправить ссылку
            </button>
            <Link
              href="/crate"
              className="mini-action inline-flex items-center justify-center"
            >
              назад к входу
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
