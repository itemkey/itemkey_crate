"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import styles from "@/components/crate-workspace.module.css";

import type {
  CategoryDetailPayload,
  CategoryRow,
  CategorySummaryRow,
  MessageRow,
  WorkspaceShellData,
} from "@/lib/types";

export type InitialCategoryDetailResult = {
  data: CategoryDetailPayload | null;
  error: string | null;
};

type CrateWorkspaceProps = {
  initialShellData: WorkspaceShellData | null;
  initialDetailPromise: Promise<InitialCategoryDetailResult> | null;
};

type SearchResult = {
  id: string;
  kind: "category" | "message";
  categoryId: string;
  messageId?: string;
  title: string;
  path: string;
  preview: string;
};

const AdvancedWorkspace = dynamic(() => import("@/components/category-workspace"), {
  ssr: false,
  loading: () => (
    <main className="workspace-root flex w-full items-center justify-center p-4">
      <div className="popup-3d p-5">Загружаю расширенные инструменты...</div>
    </main>
  ),
});

function DetailSeeder({
  promise,
  onSettled,
}: {
  promise: Promise<InitialCategoryDetailResult>;
  onSettled: (result: InitialCategoryDetailResult) => void;
}) {
  const result = use(promise);
  useEffect(() => onSettled(result), [onSettled, result]);
  return null;
}

function summaryFromCategory(category: CategoryRow): CategorySummaryRow {
  const summary = { ...category } as Partial<CategoryRow>;
  delete summary.content;
  return summary as CategorySummaryRow;
}

function sortTreeRows(a: CategorySummaryRow, b: CategorySummaryRow): number {
  return a.position === b.position
    ? a.created_at.localeCompare(b.created_at)
    : a.position - b.position;
}

function sanitizeBasicRichText(value: string): string {
  return value
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"');
}

function readContinuousText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) {
    return sanitizeBasicRichText(content);
  }
  try {
    const parsed = JSON.parse(trimmed) as { kind?: unknown; text?: unknown };
    return sanitizeBasicRichText(
      parsed.kind === "itemkey-continuous-v1" && typeof parsed.text === "string"
        ? parsed.text
        : content
    );
  } catch {
    return sanitizeBasicRichText(content);
  }
}

function replaceContinuousText(content: string, text: string): string {
  const sanitizedText = sanitizeBasicRichText(text);
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) {
    return sanitizedText;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.kind === "itemkey-continuous-v1") {
      return JSON.stringify({ ...parsed, text: sanitizedText });
    }
  } catch {
    // A regular rich-text value can start with a brace.
  }
  return sanitizedText;
}

function isAdvancedMessageContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as { kind?: unknown };
    return typeof parsed.kind === "string" && parsed.kind.startsWith("itemkey-");
  } catch {
    return false;
  }
}

function LoginScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!userId.trim() || !password || (mode === "register" && !email.trim())) {
      setMessage("Заполни обязательные поля.");
      return;
    }
    if (mode === "register" && password !== repeatPassword) {
      setMessage("Пароли не совпадают.");
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), email: email.trim(), password }),
      });
      const payload = (await response.json()) as {
        error?: string;
        requiresEmailVerification?: boolean;
      };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось войти.");
      if (payload.requiresEmailVerification) {
        setMode("login");
        setPassword("");
        setRepeatPassword("");
        setMessage("Аккаунт создан. Подтверди email и затем войди.");
        return;
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось войти.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <section className={styles.authCard} aria-labelledby="auth-title">
        <div className={styles.brandLockup}>
          <span className={styles.brandMark} aria-hidden="true">IK</span>
          <span>ItemKey</span>
        </div>

        <div className={styles.authIntro}>
          <p className={styles.eyebrow}>Личное пространство знаний</p>
          <h1 id="auth-title">{mode === "login" ? "С возвращением" : "Создайте аккаунт"}</h1>
          <p>
            {mode === "login"
              ? "Войдите, чтобы продолжить работу с проектами и заметками."
              : "Соберите проекты, материалы и идеи в одном понятном месте."}
          </p>
        </div>

        <div className={styles.authTabs} role="tablist" aria-label="Способ входа">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? styles.authTabActive : styles.authTab}
            onClick={() => setMode("login")}
          >
            Вход
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? styles.authTabActive : styles.authTab}
            onClick={() => setMode("register")}
          >
            Регистрация
          </button>
        </div>

        <form className={styles.authForm} onSubmit={submit}>
          {mode === "register" && (
            <label className={styles.field}>
              <span>Email</span>
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />
            </label>
          )}
          <label className={styles.field}>
            <span>Имя пользователя</span>
            <input
              className={styles.input}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="Ваш user-id"
              autoComplete="username"
            />
          </label>
          <label className={styles.field}>
            <span>Пароль</span>
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          {mode === "register" && (
            <label className={styles.field}>
              <span>Повторите пароль</span>
              <input
                className={styles.input}
                type="password"
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                placeholder="Повторите пароль"
                autoComplete="new-password"
              />
            </label>
          )}
          <button type="submit" className={styles.primaryButton} disabled={busy}>
            {busy ? "Подождите…" : mode === "login" ? "Войти в ItemKey" : "Создать аккаунт"}
          </button>
          {mode === "login" && (
            <a className={styles.authLink} href="/forgot-password">Забыли пароль?</a>
          )}
          {message && <p className={styles.formMessage} role="alert">{message}</p>}
        </form>
      </section>

      <aside className={styles.authAside} aria-label="Возможности ItemKey">
        <p className={styles.authAsideKicker}>Всё важное — в структуре</p>
        <h2>От идеи до готового проекта без хаоса.</h2>
        <ul>
          <li><span aria-hidden="true">01</span> Собирайте материалы по разделам</li>
          <li><span aria-hidden="true">02</span> Находите нужное через общий поиск</li>
          <li><span aria-hidden="true">03</span> Возвращайтесь к работе с любого устройства</li>
        </ul>
      </aside>
    </main>
  );
}

function SearchPopup({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetch(`/api/workspace/search?q=${encodeURIComponent(normalized)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as { data?: SearchResult[]; error?: string };
          if (!response.ok || !payload.data) throw new Error(payload.error ?? "Ошибка поиска.");
          setResults(payload.data);
        })
        .catch((reason) => {
          if (!controller.signal.aborted) {
            setError(reason instanceof Error ? reason.message : "Ошибка поиска.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className={styles.modalBackdrop} onMouseDown={onClose}>
      <div
        className={styles.searchModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>Всё рабочее пространство</p>
            <h2 id="search-title">Поиск по базе</h2>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Закрыть поиск">×</button>
        </div>
        <label className={styles.searchField}>
          <span className={styles.searchGlyph} aria-hidden="true">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              if (!value.trim()) {
                setResults([]);
                setLoading(false);
                setError(null);
              }
            }}
            placeholder="Введите название или текст заметки"
            aria-label="Поисковый запрос"
          />
        </label>
        <div className={styles.searchResults} aria-live="polite">
          {loading && <p className={styles.searchStatus}>Ищем совпадения…</p>}
          {error && <p className={styles.searchError}>{error}</p>}
          {!query.trim() && (
            <p className={styles.searchStatus}>Начните вводить запрос — результаты появятся здесь.</p>
          )}
          {!loading && !error && query.trim() && results.length === 0 && (
            <p className={styles.searchStatus}>Ничего не найдено. Попробуйте изменить запрос.</p>
          )}
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              className={styles.searchResult}
              onClick={() => onOpen(result)}
            >
              <span className={styles.searchResultPath}>{result.path}</span>
              <strong>{result.title}</strong>
              <span>{result.preview}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CrateWorkspace({
  initialShellData,
  initialDetailPromise,
}: CrateWorkspaceProps) {
  const router = useRouter();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [categories, setCategories] = useState<CategorySummaryRow[]>(
    initialShellData?.categories ?? []
  );
  const [currentId, setCurrentId] = useState<string | null>(
    initialShellData?.initialCategoryId ?? null
  );
  const [details, setDetails] = useState<Record<string, CategoryDetailPayload>>({});
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(
    () => new Set(initialShellData?.initialCategoryId ? [initialShellData.initialCategoryId] : [])
  );
  const [treeLimits, setTreeLimits] = useState<Record<string, number>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const detailCacheRef = useRef(new Map<string, CategoryDetailPayload>());
  const detailPromisesRef = useRef(new Map<string, Promise<CategoryDetailPayload>>());
  const initialPendingIdRef = useRef(initialDetailPromise ? currentId : null);
  const saveTimersRef = useRef<Record<string, number>>({});
  const csrfTokenRef = useRef<string | null>(null);
  const clientIdRef = useRef<string | null>(null);

  const currentSummary = useMemo(
    () => categories.find((category) => category.id === currentId) ?? null,
    [categories, currentId]
  );
  const currentDetail = currentId ? details[currentId] ?? null : null;

  const getCsrfToken = useCallback(async () => {
    if (csrfTokenRef.current) return csrfTokenRef.current;
    const response = await fetch("/api/auth/csrf", { cache: "no-store" });
    const payload = (await response.json()) as { data?: { token?: string }; error?: string };
    if (!response.ok || !payload.data?.token) throw new Error(payload.error ?? "CSRF error.");
    csrfTokenRef.current = payload.data.token;
    return payload.data.token;
  }, []);

  const getClientId = useCallback(() => {
    if (!clientIdRef.current) {
      clientIdRef.current =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
    return clientIdRef.current;
  }, []);

  const mutate = useCallback(async (input: RequestInfo | URL, init: RequestInit) => {
    const token = await getCsrfToken();
    const headers = new Headers(init.headers);
    headers.set("x-csrf-token", token);
    headers.set("x-client-id", getClientId());
    return fetch(input, { ...init, headers });
  }, [getClientId, getCsrfToken]);

  const applyDetail = useCallback((detail: CategoryDetailPayload) => {
    detailCacheRef.current.set(detail.category.id, detail);
    setDetails((previous) => ({ ...previous, [detail.category.id]: detail }));
    setCategories((previous) =>
      previous.map((category) =>
        category.id === detail.category.id ? summaryFromCategory(detail.category) : category
      )
    );
    setDetailError(null);
  }, []);

  const fetchDetail = useCallback((categoryId: string, signal?: AbortSignal) => {
    const existing = detailPromisesRef.current.get(categoryId);
    if (existing) return existing;
    const promise = fetch(`/api/categories/${encodeURIComponent(categoryId)}/detail`, {
      cache: "no-store",
      signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: CategoryDetailPayload; error?: string };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? "Не удалось загрузить материал.");
        detailCacheRef.current.set(categoryId, payload.data);
        return payload.data;
      })
      .finally(() => {
        if (detailPromisesRef.current.get(categoryId) === promise) {
          detailPromisesRef.current.delete(categoryId);
        }
      });
    detailPromisesRef.current.set(categoryId, promise);
    return promise;
  }, []);

  const prefetchDetail = useCallback((categoryId: string) => {
    if (!detailCacheRef.current.has(categoryId)) void fetchDetail(categoryId).catch(() => {});
  }, [fetchDetail]);

  const settleInitialDetail = useCallback((result: InitialCategoryDetailResult) => {
    initialPendingIdRef.current = null;
    if (result.data) applyDetail(result.data);
    else setDetailError(result.error ?? "Не удалось загрузить материал.");
  }, [applyDetail]);

  useEffect(() => {
    if (!initialDetailPromise || !initialPendingIdRef.current) return;
    const timer = window.setTimeout(() => {
      initialPendingIdRef.current = null;
      setDetailError("Материал загружается слишком долго. Попробуй ещё раз.");
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [initialDetailPromise]);

  useEffect(() => {
    if (!currentId || details[currentId] || initialPendingIdRef.current === currentId) return;
    const cached = detailCacheRef.current.get(currentId);
    if (cached) {
      applyDetail(cached);
      return;
    }
    const pendingPrefetch = detailPromisesRef.current.get(currentId);
    const controller = pendingPrefetch ? null : new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller?.abort();
      detailPromisesRef.current.delete(currentId);
      if (!cancelled) {
        setDetailError("Материал загружается слишком долго. Попробуй ещё раз.");
      }
    }, 8000);
    setDetailError(null);
    void (pendingPrefetch ?? fetchDetail(currentId, controller?.signal))
      .then((detail) => {
        if (!cancelled) applyDetail(detail);
      })
      .catch((reason) => {
        if (cancelled) return;
        if (!timedOut && !controller?.signal.aborted) {
          setDetailError(reason instanceof Error ? reason.message : "Не удалось загрузить материал.");
        } else if (!timedOut) {
          setDetailError("Материал загружается слишком долго. Попробуй ещё раз.");
        }
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [applyDetail, currentId, detailRetry, details, fetchDetail]);

  const refreshSummaries = useCallback(async () => {
    const response = await fetch("/api/categories?view=summary", { cache: "no-store" });
    const payload = (await response.json()) as { data?: CategorySummaryRow[] };
    if (response.ok && payload.data) {
      setCategories(payload.data);
      setCurrentId((value) =>
        value && payload.data?.some((row) => row.id === value)
          ? value
          : payload.data?.[0]?.id ?? null
      );
    }
  }, []);

  useEffect(() => {
    const startTimer = window.setTimeout(() => {
      const eventSource = new EventSource(
        `/api/sync/events?clientId=${encodeURIComponent(getClientId())}`
      );
      eventSource.addEventListener("itemkey", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { categoryIds?: string[] };
          const changedIds = payload.categoryIds ?? [];
          for (const id of changedIds) detailCacheRef.current.delete(id);
          if (changedIds.length > 0) {
            setDetails((previous) => {
              const next = { ...previous };
              for (const id of changedIds) delete next[id];
              return next;
            });
          }
          void refreshSummaries();
          if (currentId && changedIds.includes(currentId)) {
            setDetailRetry((value) => value + 1);
          }
        } catch {
          // Ignore malformed realtime messages.
        }
      });
      (window as Window & { __itemKeyCoreRealtime?: EventSource }).__itemKeyCoreRealtime = eventSource;
    }, 1200);
    return () => {
      window.clearTimeout(startTimer);
      const target = window as Window & { __itemKeyCoreRealtime?: EventSource };
      target.__itemKeyCoreRealtime?.close();
      delete target.__itemKeyCoreRealtime;
    };
  }, [currentId, getClientId, refreshSummaries]);

  if (!initialShellData) return <LoginScreen />;
  if (showAdvanced) {
    return (
      <div className={styles.advancedShell}>
        <button
          type="button"
          className={styles.simpleModeButton}
          onClick={() => setShowAdvanced(false)}
        >
          ← Простой режим
        </button>
        <AdvancedWorkspace
          initialShellData={{
            ...initialShellData,
            categories,
            initialCategoryId: currentId,
          }}
          initialDetailPromise={null}
        />
      </div>
    );
  }

  function scheduleCategoryContentSave(category: CategoryRow, nextContent: string) {
    const detail: CategoryDetailPayload = {
      category: { ...category, content: nextContent },
      messages: currentDetail?.messages ?? [],
    };
    applyDetail(detail);
    const timerKey = `category:${category.id}`;
    window.clearTimeout(saveTimersRef.current[timerKey]);
    saveTimersRef.current[timerKey] = window.setTimeout(() => {
      void mutate(`/api/categories/${encodeURIComponent(category.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: nextContent }),
      })
        .then(async (response) => {
          const payload = (await response.json()) as { data?: CategoryRow; error?: string };
          if (!response.ok || !payload.data) throw new Error(payload.error ?? "Не удалось сохранить.");
          applyDetail({ category: payload.data, messages: detail.messages });
        })
        .catch((reason) => setNotice(reason instanceof Error ? reason.message : "Не удалось сохранить."));
    }, 400);
  }

  function scheduleMessageSave(message: MessageRow, patch: Partial<MessageRow>) {
    if (!currentDetail) return;
    const nextMessage = { ...message, ...patch };
    const nextMessages = currentDetail.messages.map((row) => row.id === message.id ? nextMessage : row);
    applyDetail({ ...currentDetail, messages: nextMessages });
    const timerKey = `message:${message.id}`;
    window.clearTimeout(saveTimersRef.current[timerKey]);
    saveTimersRef.current[timerKey] = window.setTimeout(() => {
      void mutate(`/api/messages/${encodeURIComponent(message.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextMessage.title, content: nextMessage.content }),
      }).catch(() => setNotice("Не удалось сохранить сообщение."));
    }, 400);
  }

  async function createCategory() {
    setBusy(true);
    try {
      const response = await mutate("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: currentId, title: "Новая категория" }),
      });
      const payload = (await response.json()) as { data?: CategoryRow; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Не удалось создать категорию.");
      setCategories((previous) => [...previous, summaryFromCategory(payload.data as CategoryRow)]);
      applyDetail({ category: payload.data, messages: [] });
      if (currentId) {
        setExpandedCategoryIds((previous) => new Set(previous).add(currentId));
      }
      setCurrentId(payload.data.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось создать категорию.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrentCategory() {
    if (!currentSummary || currentSummary.title.trim().toLowerCase() === "main") return;
    if (!window.confirm(`Удалить «${currentSummary.title}» и все вложенные категории?`)) return;
    setBusy(true);
    try {
      const response = await mutate(`/api/categories/${encodeURIComponent(currentSummary.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Не удалось удалить категорию.");
      }
      await refreshSummaries();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось удалить категорию.");
    } finally {
      setBusy(false);
    }
  }

  async function renameCurrentCategory(title: string) {
    if (!currentSummary || !title.trim() || title.trim() === currentSummary.title) return;
    const response = await mutate(`/api/categories/${encodeURIComponent(currentSummary.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    const payload = (await response.json()) as { data?: CategoryRow; error?: string };
    if (response.ok && payload.data) applyDetail({ category: payload.data, messages: currentDetail?.messages ?? [] });
    else setNotice(payload.error ?? "Не удалось переименовать категорию.");
  }

  async function createMessage() {
    if (!currentId || !currentDetail) return;
    const response = await mutate("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: currentId, title: "Новый блок", content: "" }),
    });
    const payload = (await response.json()) as { data?: MessageRow; error?: string };
    if (response.ok && payload.data) applyDetail({ ...currentDetail, messages: [...currentDetail.messages, payload.data] });
    else setNotice(payload.error ?? "Не удалось создать сообщение.");
  }

  async function deleteMessage(message: MessageRow) {
    if (!currentDetail || !window.confirm(`Удалить «${message.title}»?`)) return;
    const response = await mutate(`/api/messages/${encodeURIComponent(message.id)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      applyDetail({
        ...currentDetail,
        messages: currentDetail.messages.filter((row) => row.id !== message.id),
      });
      return;
    }
    const payload = (await response.json()) as { error?: string };
    setNotice(payload.error ?? "Не удалось удалить сообщение.");
  }

  function renderTree(parentId: string | null, depth = 0): React.ReactNode {
    const siblings = categories
      .filter((category) => category.parent_id === parentId)
      .sort(sortTreeRows);
    const parentKey = parentId ?? "root";
    const limit = treeLimits[parentKey] ?? 200;
    const visibleSiblings = siblings.slice(0, limit);

    return (
      <>
        {visibleSiblings.map((category) => {
          const hasChildren = categories.some((row) => row.parent_id === category.id);
          const isExpanded = expandedCategoryIds.has(category.id);
          return (
            <div key={category.id}>
              <div
                className={`${styles.treeRow} ${currentId === category.id ? styles.treeRowActive : ""}`}
                style={{ "--tree-depth": depth } as CSSProperties}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className={styles.treeToggle}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Свернуть" : "Развернуть"} раздел «${category.title}»`}
                    onClick={() => {
                      setExpandedCategoryIds((previous) => {
                        const next = new Set(previous);
                        if (next.has(category.id)) next.delete(category.id);
                        else next.add(category.id);
                        return next;
                      });
                    }}
                  >
                    <span aria-hidden="true">{isExpanded ? "⌄" : "›"}</span>
                  </button>
                ) : (
                  <span className={styles.treeToggleSpacer} aria-hidden="true" />
                )}
                <button
                  type="button"
                  className={styles.treeItem}
                  aria-current={currentId === category.id ? "page" : undefined}
                  onClick={() => {
                    setCurrentId(category.id);
                    setSidebarOpen(false);
                  }}
                  onMouseEnter={() => prefetchDetail(category.id)}
                  onFocus={() => prefetchDetail(category.id)}
                >
                  <span className={styles.categoryGlyph} aria-hidden="true" />
                  <span className={styles.treeItemTitle}>{category.title}</span>
                  {category.visibility === "public" && (
                    <span className={styles.publicBadge}>общий</span>
                  )}
                </button>
              </div>
              {isExpanded && renderTree(category.id, depth + 1)}
            </div>
          );
        })}
        {siblings.length > limit && (
          <button
            type="button"
            className={styles.showMoreButton}
            onClick={() =>
              setTreeLimits((previous) => ({ ...previous, [parentKey]: limit + 200 }))
            }
          >
            показать ещё {Math.min(200, siblings.length - limit)}
          </button>
        )}
      </>
    );
  }

  return (
    <main className={styles.workspaceRoot}>
      {initialDetailPromise && (
        <Suspense fallback={null}>
          <DetailSeeder promise={initialDetailPromise} onSettled={settleInitialDetail} />
        </Suspense>
      )}

      <div className={styles.appShell}>
        <header className={styles.appHeader}>
          <div className={styles.headerIdentity}>
            <button
              type="button"
              className={styles.mobileNavButton}
              onClick={() => setSidebarOpen(true)}
              aria-label="Открыть список разделов"
              aria-expanded={sidebarOpen}
            >
              <span aria-hidden="true">☰</span>
              Разделы
            </button>
            <div className={styles.brandLockup}>
              <span className={styles.brandMark} aria-hidden="true">IK</span>
              <span>ItemKey</span>
            </div>
          </div>

          <nav className={styles.headerActions} aria-label="Основные действия">
            <button type="button" className={styles.secondaryButton} onClick={() => setShowSearch(true)}>
              <span aria-hidden="true">⌕</span>
              Поиск
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setShowAdvanced(true)}
              title="Открыть редакторы, словари и дополнительные настройки"
            >
              Все инструменты
            </button>
          </nav>

          <div className={styles.accountActions}>
            <div className={styles.accountPill} title={initialShellData.account.userId ?? undefined}>
              <span className={styles.avatar} aria-hidden="true">
                {(initialShellData.account.nickname || initialShellData.account.userId || "A").slice(0, 1).toUpperCase()}
              </span>
              <span>{initialShellData.account.nickname || initialShellData.account.userId || "Аккаунт"}</span>
            </div>
            <button
              type="button"
              className={styles.logoutButton}
              onClick={() => {
                void mutate("/api/auth/logout", { method: "POST" }).then(() => router.refresh());
              }}
            >
              Выйти
            </button>
          </div>
        </header>

        <div className={styles.workspaceLayout}>
          {sidebarOpen && (
            <button
              type="button"
              className={styles.sidebarBackdrop}
              onClick={() => setSidebarOpen(false)}
              aria-label="Закрыть список разделов"
            />
          )}
          <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
            <div className={styles.sidebarHeader}>
              <div>
                <p className={styles.eyebrow}>Навигация</p>
                <h2>Ваши материалы</h2>
              </div>
              <button
                type="button"
                className={`${styles.iconButton} ${styles.mobileCloseButton}`}
                onClick={() => setSidebarOpen(false)}
                aria-label="Закрыть список разделов"
              >
                ×
              </button>
            </div>

            {initialShellData.projects.length > 0 && (
              <section className={styles.projectSection} aria-labelledby="projects-title">
                <h3 id="projects-title">Проекты</h3>
                <div className={styles.projectList}>
                  {initialShellData.projects.map((project) => (
                    <span key={project.id} className={styles.projectChip}>#{project.title}</span>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.categorySection} aria-labelledby="categories-title">
              <div className={styles.sectionHeading}>
                <div>
                  <h3 id="categories-title">Разделы</h3>
                  <p>Выберите название, чтобы открыть материал.</p>
                </div>
              </div>
              <div className={styles.categoryActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void createCategory()}
                  disabled={busy || currentSummary?.access_role === "viewer"}
                  title="Создать подраздел внутри выбранного раздела"
                >
                  <span aria-hidden="true">＋</span>
                  Новый раздел
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void deleteCurrentCategory()}
                  disabled={
                    busy ||
                    !currentSummary ||
                    currentSummary.access_role === "viewer" ||
                    currentSummary.title.trim().toLowerCase() === "main"
                  }
                >
                  Удалить
                </button>
              </div>
              <div className={styles.treeScroll}>{renderTree(null)}</div>
            </section>

            <div className={styles.sidebarHelp}>
              <span aria-hidden="true">?</span>
              <p><strong>Как это работает</strong> Стрелка раскрывает вложенные разделы, название открывает заметку.</p>
            </div>
          </aside>

          <section className={styles.editorPane} aria-label="Редактор материала">
            <div className={styles.contentHeader}>
              <div className={styles.titleArea}>
                <p className={styles.eyebrow}>
                  {currentDetail?.category.format === "block" ? "Коллекция заметок" : "Текстовая заметка"}
                </p>
                <input
                  key={currentSummary?.id ?? "empty"}
                  className={styles.titleInput}
                  defaultValue={currentSummary?.title ?? "Без названия"}
                  onBlur={(event) => void renameCurrentCategory(event.currentTarget.value)}
                  disabled={!currentSummary || currentSummary.access_role === "viewer"}
                  aria-label="Название раздела"
                />
              </div>
              <div className={styles.documentMeta}>
                {currentSummary?.visibility === "public" && <span className={styles.sharedStatus}>Общий доступ</span>}
                <span className={styles.saveStatus}>
                  <i aria-hidden="true" />
                  {currentSummary?.access_role === "viewer" ? "Только чтение" : "Сохраняется автоматически"}
                </span>
              </div>
            </div>

            <div className={styles.editorScroll}>
              {!currentDetail ? (
                <div className={styles.stateCard} role="status">
                  <span className={styles.stateIcon} aria-hidden="true">{detailError ? "!" : "…"}</span>
                  <h2>{detailError ? "Не удалось открыть материал" : "Открываем материал"}</h2>
                  <p>{detailError ?? "Это займёт всего несколько секунд."}</p>
                  {detailError && (
                    <button type="button" className={styles.primaryButton} onClick={() => {
                      if (currentId) detailCacheRef.current.delete(currentId);
                      setDetailRetry((value) => value + 1);
                    }}>Попробовать снова</button>
                  )}
                </div>
              ) : currentDetail.category.format === "continuous" ? (
                <article className={styles.documentCard}>
                  <div className={styles.documentToolbar}>
                    <strong>Содержание</strong>
                    <span>{currentDetail.category.access_role === "viewer" ? "Просмотр заметки" : "Нажмите на текст ниже и начинайте писать"}</span>
                  </div>
                  <div
                    key={`${currentDetail.category.id}:${currentDetail.category.updated_at}`}
                    className={`${styles.richEditor} continuous-editor-rich`}
                    contentEditable={currentDetail.category.access_role !== "viewer"}
                    role="textbox"
                    aria-multiline="true"
                    aria-label="Текст заметки"
                    data-placeholder="Начните писать здесь…"
                    suppressContentEditableWarning
                    dangerouslySetInnerHTML={{ __html: readContinuousText(currentDetail.category.content) }}
                    onInput={(event) => {
                      const html = event.currentTarget.innerHTML;
                      scheduleCategoryContentSave(
                        currentDetail.category,
                        replaceContinuousText(currentDetail.category.content, html)
                      );
                    }}
                  />
                </article>
              ) : (
                <div className={styles.blocksArea}>
                  <div className={styles.blocksHeader}>
                    <div>
                      <h2>Блоки материала</h2>
                      <p>Разделите длинный материал на понятные самостоятельные заметки.</p>
                    </div>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void createMessage()}
                      disabled={currentDetail.category.access_role === "viewer"}
                    >
                      ＋ Добавить блок
                    </button>
                  </div>
                  {currentDetail.messages.length === 0 ? (
                    <div className={styles.emptyState}>
                      <span aria-hidden="true">＋</span>
                      <h3>Здесь пока нет блоков</h3>
                      <p>Добавьте первый блок, чтобы начать собирать материал.</p>
                    </div>
                  ) : (
                    <div className={styles.messageList}>
                      {currentDetail.messages.map((message, index) => (
                        <article key={message.id} className={styles.messageCard}>
                          <div className={styles.messageCardHeader}>
                            <span className={styles.messageNumber}>{String(index + 1).padStart(2, "0")}</span>
                            <input
                              className={styles.messageTitleInput}
                              defaultValue={message.title}
                              disabled={currentDetail.category.access_role === "viewer"}
                              aria-label={`Название блока ${index + 1}`}
                              onBlur={(event) => scheduleMessageSave(message, { title: event.currentTarget.value })}
                            />
                            <button
                              type="button"
                              className={styles.deleteMessageButton}
                              onClick={() => void deleteMessage(message)}
                              disabled={currentDetail.category.access_role === "viewer"}
                              aria-label={`Удалить блок «${message.title}»`}
                            >
                              Удалить
                            </button>
                          </div>
                          {isAdvancedMessageContent(message.content) ? (
                            <button type="button" className={styles.secondaryButton} onClick={() => setShowAdvanced(true)}>
                              Открыть в расширенном редакторе →
                            </button>
                          ) : (
                            <div
                              className={`${styles.messageEditor} continuous-editor-rich`}
                              contentEditable={currentDetail.category.access_role !== "viewer"}
                              role="textbox"
                              aria-multiline="true"
                              aria-label={`Текст блока ${index + 1}`}
                              data-placeholder="Введите текст блока…"
                              suppressContentEditableWarning
                              dangerouslySetInnerHTML={{ __html: sanitizeBasicRichText(message.content) }}
                              onInput={(event) =>
                                scheduleMessageSave(message, {
                                  content: sanitizeBasicRichText(event.currentTarget.innerHTML),
                                })
                              }
                            />
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        {notice && (
          <div className={styles.toast} role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Закрыть уведомление">×</button>
          </div>
        )}
        {showSearch && (
          <SearchPopup
            onClose={() => setShowSearch(false)}
            onOpen={(result) => {
              setCurrentId(result.categoryId);
              setSidebarOpen(false);
              setShowSearch(false);
            }}
          />
        )}
      </div>
    </main>
  );
}
