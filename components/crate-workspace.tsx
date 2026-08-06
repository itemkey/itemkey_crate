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
  type FormEvent,
} from "react";

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
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
        <form className="popup-3d w-full max-w-xl p-5" onSubmit={submit}>
          <h1 className="font-display text-5xl leading-none">Item Key</h1>
          <div className="mt-4 flex gap-2">
            <button type="button" className="mini-action" onClick={() => setMode("login")}>
              вход
            </button>
            <button type="button" className="mini-action" onClick={() => setMode("register")}>
              регистрация
            </button>
          </div>
          {mode === "register" && (
            <input
              className="settings-input mt-4"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              autoComplete="email"
            />
          )}
          <input
            className="settings-input mt-3"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="user-id"
            autoComplete="username"
          />
          <input
            className="settings-input mt-3"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Пароль"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode === "register" && (
            <input
              className="settings-input mt-3"
              type="password"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              placeholder="Повтори пароль"
              autoComplete="new-password"
            />
          )}
          <button type="submit" className="mini-action mt-4" disabled={busy}>
            {busy ? "подожди..." : mode === "login" ? "войти" : "создать аккаунт"}
          </button>
          {message && <p className="mt-3 text-sm text-[#6a1313]">{message}</p>}
        </form>
      </div>
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
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="search-modal popup-3d w-full max-w-3xl p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-4xl">Search</h2>
          <button type="button" className="menu-action" onClick={onClose}>x</button>
        </div>
        <input
          autoFocus
          className="settings-input mt-3"
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
          placeholder="Что найти?"
        />
        <div className="mt-3 max-h-[24rem] space-y-2 overflow-auto">
          {loading && <p className="text-sm">Ищу...</p>}
          {error && <p className="text-sm text-[#6a1313]">{error}</p>}
          {!loading && !error && query.trim() && results.length === 0 && (
            <p className="text-sm">Ничего не найдено.</p>
          )}
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              className="search-item w-full px-3 py-2 text-left"
              onClick={() => onOpen(result)}
            >
              <strong>{result.title}</strong>
              <p className="text-xs">{result.path}</p>
              <p className="text-sm">{result.preview}</p>
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
      <AdvancedWorkspace
        initialShellData={{
          ...initialShellData,
          categories,
          initialCategoryId: currentId,
        }}
        initialDetailPromise={null}
      />
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
          <button
            type="button"
            className={`sidebar-item w-full text-left ${currentId === category.id ? "sidebar-item-active" : ""}`}
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            onClick={() => {
              setCurrentId(category.id);
              if (hasChildren) {
                setExpandedCategoryIds((previous) => {
                  const next = new Set(previous);
                  next.add(category.id);
                  return next;
                });
              }
            }}
            onMouseEnter={() => prefetchDetail(category.id)}
            onFocus={() => prefetchDetail(category.id)}
          >
            {hasChildren ? (isExpanded ? "▾ " : "▸ ") : ""}
            {category.visibility === "public" ? "◈ " : ""}{category.title}
          </button>
          {isExpanded && renderTree(category.id, depth + 1)}
        </div>
          );
        })}
        {siblings.length > limit && (
          <button
            type="button"
            className="sidebar-item w-full text-left text-sm"
            style={{ paddingLeft: `${10 + depth * 14}px` }}
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
    <main className="workspace-root flex w-full items-stretch p-0">
      {initialDetailPromise && (
        <Suspense fallback={null}>
          <DetailSeeder promise={initialDetailPromise} onSettled={settleInitialDetail} />
        </Suspense>
      )}
      <div className="frame-shell relative flex h-full w-full flex-col overflow-hidden">
        <header className="top-strip bevel-panel flex h-[4.7rem] flex-none items-center gap-2 px-3 py-2">
          <input
            key={currentSummary?.id ?? "empty"}
            className="title-chip min-w-0 flex-1 px-3 py-2 font-display text-[1.6rem]"
            defaultValue={currentSummary?.title ?? "no category"}
            onBlur={(event) => void renameCurrentCategory(event.currentTarget.value)}
            disabled={!currentSummary || currentSummary.access_role === "viewer"}
            aria-label="Название категории"
          />
          <button type="button" className="mini-action" onClick={() => setShowSearch(true)}>поиск</button>
          <button type="button" className="mini-action" onClick={() => setShowAdvanced(true)}>
            инструменты
          </button>
          <span className="hidden max-w-40 truncate text-xs sm:inline">
            {initialShellData.account.nickname || initialShellData.account.userId || "аккаунт"}
          </span>
          <button
            type="button"
            className="mini-action"
            onClick={() => {
              void mutate("/api/auth/logout", { method: "POST" }).then(() => router.refresh());
            }}
          >
            выйти
          </button>
        </header>
        <div className="workspace-grid min-h-0 flex-1">
          <aside className="project-panel bevel-panel overflow-auto">
            <p className="p-3 font-display text-2xl">ПРОЕКТЫ</p>
            <div className="px-2 pb-3 text-sm">ХАБ</div>
            {initialShellData.projects.map((project) => (
              <div key={project.id} className="px-2 py-1 text-sm">#{project.title}</div>
            ))}
          </aside>
          <aside className="category-panel bevel-panel flex min-h-0 flex-col overflow-hidden">
            <div className="flex gap-2 p-2">
              <button type="button" className="mini-action" onClick={() => void createCategory()} disabled={busy}>+</button>
              <button type="button" className="mini-action" onClick={() => void deleteCurrentCategory()} disabled={busy}>−</button>
            </div>
            <div className="sidebar-scroll flex-1 overflow-auto">{renderTree(null)}</div>
          </aside>
          <section className="workspace-screen overflow-auto">
            {!currentDetail ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
                <p>{detailError ?? "Загружаю выбранный материал..."}</p>
                {detailError && (
                  <button type="button" className="mini-action" onClick={() => {
                    if (currentId) detailCacheRef.current.delete(currentId);
                    setDetailRetry((value) => value + 1);
                  }}>повторить</button>
                )}
              </div>
            ) : currentDetail.category.format === "continuous" ? (
              <div className="continuous-wrap p-3">
                <div
                  key={`${currentDetail.category.id}:${currentDetail.category.updated_at}`}
                  className="continuous-editor continuous-editor-rich min-h-[20rem]"
                  contentEditable={currentDetail.category.access_role !== "viewer"}
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
              </div>
            ) : (
              <div className="p-3">
                <button type="button" className="mini-action mb-3" onClick={() => void createMessage()}>
                  + сообщение
                </button>
                <div className="space-y-3">
                  {currentDetail.messages.map((message) => (
                    <article key={message.id} className="popup-3d p-3">
                      <div className="flex items-center gap-2">
                        <input
                          className="settings-input"
                          defaultValue={message.title}
                          onBlur={(event) => scheduleMessageSave(message, { title: event.currentTarget.value })}
                        />
                        <button type="button" className="mini-action" onClick={() => void deleteMessage(message)}>
                          −
                        </button>
                      </div>
                      {isAdvancedMessageContent(message.content) ? (
                        <button type="button" className="mini-action mt-3" onClick={() => setShowAdvanced(true)}>
                          открыть расширенный блок
                        </button>
                      ) : (
                        <div
                          className="continuous-editor-rich mt-3 min-h-24"
                          contentEditable
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
              </div>
            )}
          </section>
        </div>
        {notice && (
          <button type="button" className="absolute bottom-3 right-3 popup-3d p-3 text-sm" onClick={() => setNotice(null)}>
            {notice}
          </button>
        )}
        {showSearch && (
          <SearchPopup
            onClose={() => setShowSearch(false)}
            onOpen={(result) => {
              setCurrentId(result.categoryId);
              setShowSearch(false);
            }}
          />
        )}
      </div>
    </main>
  );
}
