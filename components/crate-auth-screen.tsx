"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { normalizeUserId, validateUserId } from "@/lib/account-user-id";
import { toErrorMessage } from "@/lib/errors";

type AuthTab = "login" | "register";

type AuthMutationPayload = {
  data?: {
    id: string;
    email: string | null;
  };
  requiresEmailVerification?: boolean;
  error?: string;
};

type UserIdAvailabilityPayload = {
  data?: {
    userId: string;
    available: boolean;
  };
  error?: string;
};

type CsrfPayload = {
  data?: {
    token: string;
  };
  error?: string;
};

type CrateAuthScreenProps = {
  initialError?: string | null;
};

export default function CrateAuthScreen({
  initialError = null,
}: CrateAuthScreenProps) {
  const router = useRouter();
  const csrfTokenRef = useRef<string | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const [authTab, setAuthTab] = useState<AuthTab>("login");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(initialError);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authLoginUserIdDraft, setAuthLoginUserIdDraft] = useState("");
  const [authLoginPassword, setAuthLoginPassword] = useState("");
  const [showAuthLoginPassword, setShowAuthLoginPassword] = useState(false);
  const [authRegisterEmail, setAuthRegisterEmail] = useState("");
  const [authRegisterUserIdDraft, setAuthRegisterUserIdDraft] = useState("");
  const [authRegisterPassword, setAuthRegisterPassword] = useState("");
  const [authRegisterPasswordRepeat, setAuthRegisterPasswordRepeat] = useState("");
  const [showAuthRegisterPassword, setShowAuthRegisterPassword] = useState(false);

  function getClientId() {
    if (!clientIdRef.current) {
      clientIdRef.current =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    return clientIdRef.current;
  }

  async function ensureCsrfToken() {
    if (csrfTokenRef.current) {
      return csrfTokenRef.current;
    }

    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = (await response.json()) as CsrfPayload;
    if (!response.ok || !payload.data?.token) {
      throw new Error(payload.error ?? "Не удалось инициализировать CSRF-токен.");
    }

    csrfTokenRef.current = payload.data.token;
    return payload.data.token;
  }

  async function fetchWithCsrf(input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? undefined);
    headers.set("x-client-id", getClientId());

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      headers.set("x-csrf-token", await ensureCsrfToken());
    }

    return fetch(input, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  }

  function completeAuthentication() {
    router.refresh();
  }

  async function handleAuthSignIn() {
    if (isAuthBusy) {
      return;
    }

    const normalizedUserId = normalizeUserId(authLoginUserIdDraft);
    const userIdValidationError = validateUserId(normalizedUserId);

    if (!authLoginUserIdDraft.trim() || !authLoginPassword) {
      setAuthError("Введи user-id и пароль.");
      return;
    }

    if (userIdValidationError) {
      setAuthError(userIdValidationError);
      return;
    }

    let authenticated = false;
    setIsAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      const response = await fetchWithCsrf("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: normalizedUserId,
          password: authLoginPassword,
        }),
      });
      const payload = (await response.json()) as AuthMutationPayload;

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось войти в аккаунт.");
      }

      authenticated = true;
      setAuthLoginPassword("");
      setShowAuthLoginPassword(false);
      completeAuthentication();
    } catch (error) {
      setAuthError(toErrorMessage(error, "Не удалось войти в аккаунт."));
    } finally {
      if (!authenticated) {
        setIsAuthBusy(false);
      }
    }
  }

  async function handleAuthSignUp() {
    if (isAuthBusy) {
      return;
    }

    const email = authRegisterEmail.trim();
    const normalizedUserId = normalizeUserId(authRegisterUserIdDraft);
    const userIdValidationError = validateUserId(normalizedUserId);

    if (
      !email ||
      !authRegisterUserIdDraft.trim() ||
      !authRegisterPassword ||
      !authRegisterPasswordRepeat
    ) {
      setAuthError("Введи email, user-id и пароль два раза.");
      return;
    }

    if (authRegisterPassword !== authRegisterPasswordRepeat) {
      setAuthError("Пароли не совпадают.");
      return;
    }

    if (userIdValidationError) {
      setAuthError(userIdValidationError);
      return;
    }

    let authenticated = false;
    setIsAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      const availabilityResponse = await fetch(
        `/api/account/user-id/check?value=${encodeURIComponent(normalizedUserId)}`,
        { cache: "no-store", credentials: "same-origin" }
      );
      const availabilityPayload =
        (await availabilityResponse.json()) as UserIdAvailabilityPayload;
      if (!availabilityResponse.ok || !availabilityPayload.data) {
        throw new Error(
          availabilityPayload.error ?? "Не удалось проверить user-id."
        );
      }

      if (!availabilityPayload.data.available) {
        setAuthError("Такой user-id уже занят.");
        return;
      }

      const response = await fetchWithCsrf("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: authRegisterPassword,
          userId: normalizedUserId,
        }),
      });
      const payload = (await response.json()) as AuthMutationPayload;

      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось создать аккаунт.");
      }

      if (payload.requiresEmailVerification) {
        setAuthRegisterEmail("");
        setAuthRegisterUserIdDraft("");
        setAuthRegisterPassword("");
        setAuthRegisterPasswordRepeat("");
        setShowAuthRegisterPassword(false);
        setAuthLoginUserIdDraft(normalizedUserId);
        setAuthTab("login");
        setAuthInfo(
          "Аккаунт создан. Письмо подтверждения отправлено автоматически — подтверди email и войди."
        );
        return;
      }

      if (!payload.data) {
        throw new Error("Сервер не вернул данные нового аккаунта.");
      }

      authenticated = true;
      setAuthRegisterEmail("");
      setAuthRegisterUserIdDraft("");
      setAuthRegisterPassword("");
      setAuthRegisterPasswordRepeat("");
      setShowAuthRegisterPassword(false);
      completeAuthentication();
    } catch (error) {
      setAuthError(toErrorMessage(error, "Не удалось создать аккаунт."));
    } finally {
      if (!authenticated) {
        setIsAuthBusy(false);
      }
    }
  }

  function selectAuthTab(tab: AuthTab) {
    setAuthTab(tab);
    setAuthError(null);
    setAuthInfo(null);
  }

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d w-full max-w-xl p-5">
          <h1 className="font-display text-5xl leading-none">Item Key</h1>
          <p className="mt-3 text-sm text-[#202020]">
            {authTab === "login"
              ? "Введи данные для входа: user-id и пароль."
              : "Введи данные для регистрации аккаунта."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={`mini-action ${
                authTab === "login"
                  ? "border-[#4a4a4a] bg-[#bdbdbd]"
                  : "opacity-70"
              }`}
              onClick={() => selectAuthTab("login")}
              disabled={isAuthBusy}
            >
              вход
            </button>
            <button
              type="button"
              className={`mini-action ${
                authTab === "register"
                  ? "border-[#4a4a4a] bg-[#bdbdbd]"
                  : "opacity-70"
              }`}
              onClick={() => selectAuthTab("register")}
              disabled={isAuthBusy}
            >
              регистрация
            </button>
          </div>

          {authTab === "login" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleAuthSignIn();
              }}
            >
              <label className="settings-label mt-4">user-id</label>
              <input
                type="text"
                value={authLoginUserIdDraft}
                onChange={(event) => setAuthLoginUserIdDraft(event.target.value)}
                className="settings-input"
                placeholder="my.user-id"
                autoComplete="username"
                spellCheck={false}
              />

              <label className="settings-label mt-3">Пароль</label>
              <div className="settings-input-wrap">
                <input
                  type={showAuthLoginPassword ? "text" : "password"}
                  value={authLoginPassword}
                  onChange={(event) => setAuthLoginPassword(event.target.value)}
                  className="settings-input pr-14"
                  placeholder="Твой пароль"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-inline-action"
                  onClick={() => setShowAuthLoginPassword((previous) => !previous)}
                  aria-label={
                    showAuthLoginPassword ? "Скрыть пароль" : "Показать пароль"
                  }
                >
                  {showAuthLoginPassword ? "hide" : "show"}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" className="mini-action" disabled={isAuthBusy}>
                  войти
                </button>
                <a
                  href="/forgot-password"
                  className="mini-action inline-flex items-center justify-center"
                >
                  забыли пароль
                </a>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleAuthSignUp();
              }}
            >
              <label className="settings-label mt-4">Email</label>
              <input
                type="email"
                value={authRegisterEmail}
                onChange={(event) => setAuthRegisterEmail(event.target.value)}
                className="settings-input"
                placeholder="you@example.com"
                autoComplete="email"
              />

              <label className="settings-label mt-3">user-id</label>
              <input
                type="text"
                value={authRegisterUserIdDraft}
                onChange={(event) => setAuthRegisterUserIdDraft(event.target.value)}
                className="settings-input"
                placeholder="my.user-id"
                autoComplete="username"
                spellCheck={false}
              />

              <label className="settings-label mt-3">Пароль</label>
              <div className="settings-input-wrap">
                <input
                  type={showAuthRegisterPassword ? "text" : "password"}
                  value={authRegisterPassword}
                  onChange={(event) => setAuthRegisterPassword(event.target.value)}
                  className="settings-input pr-14"
                  placeholder="Минимум 6 символов"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="input-inline-action"
                  onClick={() =>
                    setShowAuthRegisterPassword((previous) => !previous)
                  }
                  aria-label={
                    showAuthRegisterPassword ? "Скрыть пароль" : "Показать пароль"
                  }
                >
                  {showAuthRegisterPassword ? "hide" : "show"}
                </button>
              </div>

              <label className="settings-label mt-3">Повтори пароль</label>
              <input
                type={showAuthRegisterPassword ? "text" : "password"}
                value={authRegisterPasswordRepeat}
                onChange={(event) =>
                  setAuthRegisterPasswordRepeat(event.target.value)
                }
                className="settings-input"
                placeholder="Повтори пароль"
                autoComplete="new-password"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" className="mini-action" disabled={isAuthBusy}>
                  зарегистрироваться
                </button>
              </div>

              <p className="settings-hint mt-3">
                Письмо подтверждения отправляем автоматически после регистрации.
              </p>
            </form>
          )}

          {authError && (
            <p
              className="mt-3 rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]"
              role="alert"
            >
              {authError}
            </p>
          )}

          {authInfo && (
            <p className="mt-3 rounded border-2 border-[#476018] bg-[#bdd39f] px-3 py-2 text-sm text-[#1f2d0d]">
              {authInfo}
            </p>
          )}

          <p className="settings-hint mt-3">
            После входа данные привязываются к твоему аккаунту и синхронизируются
            между устройствами.
          </p>
        </div>
      </div>
    </main>
  );
}
