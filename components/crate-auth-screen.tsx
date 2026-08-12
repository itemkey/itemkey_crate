"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import LocaleSwitcher from "@/components/locale-switcher";
import { normalizeUserId, validateUserId } from "@/lib/account-user-id";
import { localizeApiError } from "@/lib/api-errors";
import { toErrorMessage } from "@/lib/errors";

type AuthTab = "login" | "register";

type AuthMutationPayload = {
  data?: {
    id: string;
    email: string | null;
    locale?: "ru" | "en";
  };
  requiresEmailVerification?: boolean;
  error?: string;
  code?: string;
};

type UserIdAvailabilityPayload = {
  data?: {
    userId: string;
    available: boolean;
  };
  error?: string;
  code?: string;
};

type CsrfPayload = {
  data?: {
    token: string;
  };
  error?: string;
  code?: string;
};

type CrateAuthScreenProps = {
  initialError?: string | null;
};

export default function CrateAuthScreen({
  initialError = null,
}: CrateAuthScreenProps) {
  const router = useRouter();
  const { locale, t, setLocale } = useI18n();
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
      throw new Error(localizeApiError(locale, payload));
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
      setAuthError(t("auth.missingLogin"));
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
        throw new Error(localizeApiError(locale, payload, "auth.loginFailed"));
      }

      authenticated = true;
      if (payload.data.locale) {
        setLocale(payload.data.locale);
      }
      setAuthLoginPassword("");
      setShowAuthLoginPassword(false);
      completeAuthentication();
    } catch (error) {
      setAuthError(toErrorMessage(error, t("auth.loginFailed")));
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
      setAuthError(t("auth.missingRegistration"));
      return;
    }

    if (authRegisterPassword !== authRegisterPasswordRepeat) {
      setAuthError(t("auth.passwordMismatch"));
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
          localizeApiError(locale, availabilityPayload, "auth.userIdCheckFailed")
        );
      }

      if (!availabilityPayload.data.available) {
        setAuthError(t("auth.userIdTaken"));
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
        throw new Error(localizeApiError(locale, payload, "auth.registerFailed"));
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
          t("auth.accountCreated")
        );
        return;
      }

      if (!payload.data) {
        throw new Error(t("auth.registerFailed"));
      }

      authenticated = true;
      setAuthRegisterEmail("");
      setAuthRegisterUserIdDraft("");
      setAuthRegisterPassword("");
      setAuthRegisterPasswordRepeat("");
      setShowAuthRegisterPassword(false);
      completeAuthentication();
    } catch (error) {
      setAuthError(toErrorMessage(error, t("auth.registerFailed")));
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
        <div className="popup-3d entry-form-panel w-full max-w-xl p-5">
          <div className="entry-form-head">
            <h1 className="font-display text-5xl leading-none">{t("auth.title")}</h1>
            <LocaleSwitcher compact />
          </div>
          <p className="mt-3 text-sm text-[#202020]">
            {authTab === "login"
              ? t("auth.loginIntro")
              : t("auth.registerIntro")}
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
              {t("auth.login")}
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
              {t("auth.register")}
            </button>
          </div>

          {authTab === "login" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleAuthSignIn();
              }}
            >
              <label className="settings-label mt-4">{t("auth.userId")}</label>
              <input
                type="text"
                value={authLoginUserIdDraft}
                onChange={(event) => setAuthLoginUserIdDraft(event.target.value)}
                className="settings-input"
                placeholder="my.user-id"
                autoComplete="username"
                spellCheck={false}
              />

              <label className="settings-label mt-3">{t("auth.password")}</label>
              <div className="settings-input-wrap">
                <input
                  type={showAuthLoginPassword ? "text" : "password"}
                  value={authLoginPassword}
                  onChange={(event) => setAuthLoginPassword(event.target.value)}
                  className="settings-input pr-14"
                  placeholder={t("auth.passwordPlaceholder")}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-inline-action"
                  onClick={() => setShowAuthLoginPassword((previous) => !previous)}
                  aria-label={
                    showAuthLoginPassword ? t("common.hide") : t("common.show")
                  }
                >
                  {showAuthLoginPassword ? t("common.hide") : t("common.show")}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" className="mini-action" disabled={isAuthBusy}>
                  {t("auth.signIn")}
                </button>
                <a
                  href="/forgot-password"
                  className="mini-action inline-flex items-center justify-center"
                >
                  {t("auth.forgotPassword")}
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
              <label className="settings-label mt-4">{t("auth.email")}</label>
              <input
                type="email"
                value={authRegisterEmail}
                onChange={(event) => setAuthRegisterEmail(event.target.value)}
                className="settings-input"
                placeholder="you@example.com"
                autoComplete="email"
              />

              <label className="settings-label mt-3">{t("auth.userId")}</label>
              <input
                type="text"
                value={authRegisterUserIdDraft}
                onChange={(event) => setAuthRegisterUserIdDraft(event.target.value)}
                className="settings-input"
                placeholder="my.user-id"
                autoComplete="username"
                spellCheck={false}
              />

              <label className="settings-label mt-3">{t("auth.password")}</label>
              <div className="settings-input-wrap">
                <input
                  type={showAuthRegisterPassword ? "text" : "password"}
                  value={authRegisterPassword}
                  onChange={(event) => setAuthRegisterPassword(event.target.value)}
                  className="settings-input pr-14"
                  placeholder={t("auth.passwordMin")}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="input-inline-action"
                  onClick={() =>
                    setShowAuthRegisterPassword((previous) => !previous)
                  }
                  aria-label={
                    showAuthRegisterPassword ? t("common.hide") : t("common.show")
                  }
                >
                  {showAuthRegisterPassword ? t("common.hide") : t("common.show")}
                </button>
              </div>

              <label className="settings-label mt-3">{t("auth.repeatPassword")}</label>
              <input
                type={showAuthRegisterPassword ? "text" : "password"}
                value={authRegisterPasswordRepeat}
                onChange={(event) =>
                  setAuthRegisterPasswordRepeat(event.target.value)
                }
                className="settings-input"
                placeholder={t("auth.repeatPasswordPlaceholder")}
                autoComplete="new-password"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" className="mini-action" disabled={isAuthBusy}>
                  {t("auth.signUp")}
                </button>
              </div>

              <p className="settings-hint mt-3">
                {t("auth.verificationHint")}
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
            {t("auth.syncHint")}
          </p>
        </div>
      </div>
    </main>
  );
}
