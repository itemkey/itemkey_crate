"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useRef, useState } from "react";

import {
  getTargetOptionsForFile,
  type ConverterTargetOption,
} from "@/lib/media-toolkit/formats";

type ToolkitTab = "downloader" | "converter";

type CsrfPayload = {
  data?: {
    token: string;
  };
  error?: string;
};

type AnalyzeYoutubePayload = {
  data?: {
    resolutions: number[];
  };
  error?: string;
};

type DownloadYoutubePayload = {
  data?: {
    mode: "single" | "batch";
    outputDir: string;
    requestedHeight?: number;
    total?: number;
    done?: number;
    failed?: number;
    errors?: Array<{
      url: string;
      error: string;
    }>;
  };
  error?: string;
};

type ConvertPayload = {
  data?: {
    outputPath: string;
    targetFormat: string;
  };
  error?: string;
};

type SelectFolderPayload = {
  data?: {
    path: string | null;
  };
  error?: string;
};

const COOKIES_BROWSERS = ["none", "firefox", "chrome", "edge", "brave", "opera", "vivaldi"];
const MAX_SOURCE_FILE_BYTES = 500 * 1024 * 1024;

function authSignature(
  cookiesBrowser: string,
  cookiesProfile: string,
  poToken: string
): string {
  return `${cookiesBrowser.trim().toLowerCase()}|${cookiesProfile.trim()}|${poToken.trim()}`;
}

export default function MediaToolkit({
  initialTab = "downloader",
}: {
  initialTab?: ToolkitTab;
}) {
  const [activeTab, setActiveTab] = useState<ToolkitTab>(initialTab);

  const csrfTokenRef = useRef<string | null>(null);

  const [downloadDir, setDownloadDir] = useState("");
  const [urlInputs, setUrlInputs] = useState<string[]>([""]);
  const [cookiesBrowser, setCookiesBrowser] = useState("none");
  const [cookiesProfile, setCookiesProfile] = useState("");
  const [poToken, setPoToken] = useState("");
  const [resolutions, setResolutions] = useState<number[]>([]);
  const [downloaderStatus, setDownloaderStatus] = useState(
    "Вставь ссылку и нажми Анализ."
  );
  const [downloaderError, setDownloaderError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [analyzedAuthSignature, setAnalyzedAuthSignature] = useState<string | null>(
    null
  );

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [converterOutputDir, setConverterOutputDir] = useState("");
  const [converterTargets, setConverterTargets] = useState<ConverterTargetOption[]>(
    []
  );
  const [converterTarget, setConverterTarget] = useState("");
  const [converterStatus, setConverterStatus] = useState("Выбери исходный файл.");
  const [converterError, setConverterError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isPickingConverterDir, setIsPickingConverterDir] = useState(false);

  const filledUrls = useMemo(
    () => urlInputs.map((url) => url.trim()).filter(Boolean),
    [urlInputs]
  );
  const isBatchMode = filledUrls.length > 1;
  const downloaderBusy = isAnalyzing || isDownloading;

  async function ensureCsrfToken(): Promise<string> {
    if (csrfTokenRef.current) {
      return csrfTokenRef.current;
    }

    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = (await response.json()) as CsrfPayload;
    if (!response.ok || !payload.data?.token) {
      throw new Error(payload.error ?? "Не удалось подготовить CSRF-токен.");
    }

    csrfTokenRef.current = payload.data.token;
    return payload.data.token;
  }

  function updateUrlInput(index: number, value: string): void {
    setUrlInputs((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
    setResolutions([]);
    setAnalyzedUrl(null);
    setAnalyzedAuthSignature(null);
    setDownloaderError(null);
  }

  function addUrlInput(): void {
    setUrlInputs((prev) => [...prev, ""]);
  }

  function removeUrlInput(index: number): void {
    setUrlInputs((prev) => {
      if (prev.length <= 1) {
        return [""];
      }

      return prev.filter((_, itemIndex) => itemIndex !== index);
    });

    setResolutions([]);
    setAnalyzedUrl(null);
    setAnalyzedAuthSignature(null);
    setDownloaderError(null);
  }

  async function handleAnalyzeYoutube(): Promise<void> {
    if (downloaderBusy) {
      return;
    }

    if (filledUrls.length === 0) {
      setDownloaderError("Добавь ссылку YouTube.");
      return;
    }

    setDownloaderError(null);
    setResolutions([]);
    setAnalyzedUrl(null);
    setAnalyzedAuthSignature(null);

    if (isBatchMode) {
      setDownloaderStatus('Пакетный режим: нажми "Скачать все (лучшее)".');
      return;
    }

    setIsAnalyzing(true);
    setDownloaderStatus("Анализ доступных разрешений...");

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/media-toolkit/youtube/analyze", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          url: filledUrls[0],
          cookiesBrowser,
          cookiesProfile,
          poToken,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as AnalyzeYoutubePayload;
      if (!response.ok || !payload.data?.resolutions) {
        throw new Error(payload.error ?? "Не удалось получить доступные разрешения.");
      }

      setResolutions(payload.data.resolutions);
      setAnalyzedUrl(filledUrls[0] ?? null);
      setAnalyzedAuthSignature(authSignature(cookiesBrowser, cookiesProfile, poToken));
      setDownloaderStatus("Выбери разрешение и нажми Скачать.");
    } catch (error) {
      setDownloaderError(
        error instanceof Error
          ? error.message
          : "Не удалось получить доступные разрешения."
      );
      setDownloaderStatus("Анализ не удался.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleDownloadByResolution(height: number): Promise<void> {
    if (downloaderBusy || isBatchMode) {
      return;
    }

    const currentUrl = filledUrls[0] ?? "";
    if (!currentUrl) {
      setDownloaderError("Добавь ссылку YouTube.");
      return;
    }

    if (!downloadDir.trim()) {
      setDownloaderError("Укажи папку загрузки.");
      return;
    }

    if (
      analyzedUrl !== currentUrl ||
      analyzedAuthSignature !== authSignature(cookiesBrowser, cookiesProfile, poToken)
    ) {
      setDownloaderError("Сначала нажми Анализ для текущей ссылки и настроек.");
      return;
    }

    setDownloaderError(null);
    setIsDownloading(true);
    setDownloaderStatus(`Скачивание ${height}p...`);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/media-toolkit/youtube/download", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          mode: "single",
          urls: [currentUrl],
          outputDir: downloadDir,
          height,
          cookiesBrowser,
          cookiesProfile,
          poToken,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as DownloadYoutubePayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось скачать видео.");
      }

      setDownloaderStatus(`Готово: ${payload.data.outputDir}`);
    } catch (error) {
      setDownloaderError(
        error instanceof Error ? error.message : "Не удалось скачать видео."
      );
      setDownloaderStatus("Скачивание не удалось.");
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleDownloadBatchBest(): Promise<void> {
    if (downloaderBusy) {
      return;
    }

    if (filledUrls.length < 2) {
      setDownloaderError("Для пакетного режима добавь минимум две ссылки.");
      return;
    }

    if (!downloadDir.trim()) {
      setDownloaderError("Укажи папку загрузки.");
      return;
    }

    setDownloaderError(null);
    setIsDownloading(true);
    setDownloaderStatus(`Пакетная загрузка: 0/${filledUrls.length}`);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/media-toolkit/youtube/download", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          mode: "batch",
          urls: filledUrls,
          outputDir: downloadDir,
          cookiesBrowser,
          cookiesProfile,
          poToken,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as DownloadYoutubePayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось выполнить пакетную загрузку.");
      }

      const done = payload.data.done ?? 0;
      const total = payload.data.total ?? filledUrls.length;
      const failed = payload.data.failed ?? 0;
      setDownloaderStatus(`Пакет завершен: ${done}/${total}`);

      if (failed > 0) {
        const firstError = payload.data.errors?.[0]?.error ?? "Часть видео не скачалась.";
        setDownloaderError(`Ошибок: ${failed}. ${firstError}`);
      }
    } catch (error) {
      setDownloaderError(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить пакетную загрузку."
      );
      setDownloaderStatus("Пакетная загрузка не удалась.");
    } finally {
      setIsDownloading(false);
    }
  }

  async function handlePickConverterOutputDir(): Promise<void> {
    if (isConverting || isPickingConverterDir) {
      return;
    }

    setConverterError(null);
    setIsPickingConverterDir(true);

    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch("/api/media-toolkit/system/select-folder", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-csrf-token": csrfToken,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as SelectFolderPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось открыть выбор папки.");
      }

      const selectedPath = payload.data.path?.trim() ?? "";
      if (!selectedPath) {
        setConverterStatus("Выбор папки отменен.");
        return;
      }

      setConverterOutputDir(selectedPath);
      setConverterStatus("Папка назначения выбрана.");
    } catch (error) {
      setConverterError(
        error instanceof Error ? error.message : "Не удалось открыть выбор папки."
      );
    } finally {
      setIsPickingConverterDir(false);
    }
  }

  function handleSourceFileChange(file: File | null): void {
    setSourceFile(file);
    setConverterError(null);

    if (!file) {
      setConverterTargets([]);
      setConverterTarget("");
      setConverterStatus("Выбери исходный файл.");
      return;
    }

    if (file.size > MAX_SOURCE_FILE_BYTES) {
      setSourceFile(null);
      setConverterTargets([]);
      setConverterTarget("");
      setConverterError("Файл слишком большой для конвертации.");
      setConverterStatus("Файл слишком большой.");
      return;
    }

    const details = getTargetOptionsForFile(file.name);
    if (!details) {
      setConverterTargets([]);
      setConverterTarget("");
      setConverterError("Файл не поддерживается для конвертации.");
      setConverterStatus("Файл не поддерживается.");
      return;
    }

    setConverterTargets(details.options);
    setConverterTarget(details.options[0]?.value ?? "");
    setConverterStatus("Форматы для конвертации обновлены.");
  }

  async function handleConvertSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isConverting) {
      return;
    }

    if (!sourceFile) {
      setConverterError("Выбери исходный файл.");
      return;
    }

    if (sourceFile.size > MAX_SOURCE_FILE_BYTES) {
      setConverterError("Файл слишком большой для конвертации.");
      return;
    }

    if (!converterTarget) {
      setConverterError("Выбери формат назначения.");
      return;
    }

    if (!converterOutputDir.trim()) {
      setConverterError("Укажи папку назначения.");
      return;
    }

    setConverterError(null);
    setIsConverting(true);
    setConverterStatus("Конвертация...");

    try {
      const csrfToken = await ensureCsrfToken();
      const formData = new FormData();
      formData.set("source", sourceFile);
      formData.set("targetFormat", converterTarget);
      formData.set("outputDir", converterOutputDir.trim());

      const response = await fetch("/api/media-toolkit/converter/convert", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-csrf-token": csrfToken,
        },
        body: formData,
      });

      const payload = (await response.json().catch(() => ({}))) as ConvertPayload;
      if (!response.ok || !payload.data?.outputPath) {
        throw new Error(payload.error ?? "Не удалось конвертировать файл.");
      }

      setConverterStatus(`Готово: ${payload.data.outputPath}`);
    } catch (error) {
      setConverterError(
        error instanceof Error ? error.message : "Не удалось конвертировать файл."
      );
      setConverterStatus("Конвертация не удалась.");
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell entry-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d w-full max-w-4xl p-6">
          <h1 className="font-display entry-title text-center leading-none">
            YouTube Downloader + Converter
          </h1>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className={`mini-action entry-button inline-flex items-center justify-center ${
                activeTab === "downloader" ? "toolkit-tab-active" : ""
              }`}
              onClick={() => setActiveTab("downloader")}
              disabled={isConverting || downloaderBusy}
            >
              YouTube Downloader
            </button>

            <button
              type="button"
              className={`mini-action entry-button inline-flex items-center justify-center ${
                activeTab === "converter" ? "toolkit-tab-active" : ""
              }`}
              onClick={() => setActiveTab("converter")}
              disabled={isConverting || downloaderBusy}
            >
              Converter
            </button>

            <Link
              href="/"
              className="mini-action entry-button inline-flex items-center justify-center"
            >
              Главное меню
            </Link>
          </div>

          {activeTab === "downloader" ? (
            <section className="mx-auto mt-6 flex w-full max-w-3xl flex-col gap-3">
              <label className="settings-label" htmlFor="download-folder">
                Папка загрузки
              </label>
              <input
                id="download-folder"
                type="text"
                className="settings-input"
                value={downloadDir}
                onChange={(event) => setDownloadDir(event.target.value)}
                disabled={downloaderBusy}
                placeholder="E:\\downloads"
              />

              <label className="settings-label">Ссылки YouTube</label>
              <div className="flex flex-col gap-2">
                {urlInputs.map((value, index) => (
                  <div key={`url-${index}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      className="settings-input"
                      value={value}
                      onChange={(event) => updateUrlInput(index, event.target.value)}
                      disabled={downloaderBusy}
                      placeholder="https://www.youtube.com/watch?v=..."
                    />
                    <button
                      type="button"
                      className="mini-action inline-flex items-center justify-center"
                      onClick={() => removeUrlInput(index)}
                      disabled={downloaderBusy}
                    >
                      -
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="mini-action inline-flex items-center justify-center"
                  onClick={addUrlInput}
                  disabled={downloaderBusy}
                >
                  + URL
                </button>

                <button
                  type="button"
                  className="mini-action entry-button inline-flex items-center justify-center"
                  onClick={handleAnalyzeYoutube}
                  disabled={downloaderBusy || filledUrls.length === 0}
                >
                  {isAnalyzing ? "Анализ..." : "Анализ"}
                </button>

                {isBatchMode && (
                  <button
                    type="button"
                    className="mini-action entry-button inline-flex items-center justify-center"
                    onClick={handleDownloadBatchBest}
                    disabled={downloaderBusy}
                  >
                    {isDownloading ? "Скачивание..." : "Скачать все (лучшее)"}
                  </button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-1">
                  <label className="settings-label" htmlFor="cookies-browser">
                    Cookies browser
                  </label>
                  <select
                    id="cookies-browser"
                    className="settings-input"
                    value={cookiesBrowser}
                    onChange={(event) => {
                      setCookiesBrowser(event.target.value);
                      setResolutions([]);
                      setAnalyzedUrl(null);
                      setAnalyzedAuthSignature(null);
                    }}
                    disabled={downloaderBusy}
                  >
                    {COOKIES_BROWSERS.map((browser) => (
                      <option key={browser} value={browser}>
                        {browser}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-1">
                  <label className="settings-label" htmlFor="cookies-profile">
                    Cookies profile
                  </label>
                  <input
                    id="cookies-profile"
                    type="text"
                    className="settings-input"
                    value={cookiesProfile}
                    onChange={(event) => {
                      setCookiesProfile(event.target.value);
                      setResolutions([]);
                      setAnalyzedUrl(null);
                      setAnalyzedAuthSignature(null);
                    }}
                    disabled={downloaderBusy}
                  />
                </div>

                <div className="md:col-span-1">
                  <label className="settings-label" htmlFor="po-token">
                    PO token
                  </label>
                  <input
                    id="po-token"
                    type="text"
                    className="settings-input"
                    value={poToken}
                    onChange={(event) => {
                      setPoToken(event.target.value);
                      setResolutions([]);
                      setAnalyzedUrl(null);
                      setAnalyzedAuthSignature(null);
                    }}
                    disabled={downloaderBusy}
                  />
                </div>
              </div>

              {!isBatchMode && resolutions.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {resolutions.map((height) => (
                    <button
                      key={height}
                      type="button"
                      className="mini-action inline-flex items-center justify-center"
                      onClick={() => handleDownloadByResolution(height)}
                      disabled={downloaderBusy}
                    >
                      {isDownloading ? "Скачивание..." : `Скачать ${height}p`}
                    </button>
                  ))}
                </div>
              )}

              {downloaderError && (
                <p className="rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]">
                  {downloaderError}
                </p>
              )}

              <p className="rounded border border-[#5f5f5f] bg-[#d2d2d2] px-3 py-2 text-sm text-[#1f1f1f]">
                {downloaderStatus}
              </p>
            </section>
          ) : (
            <form
              className="mx-auto mt-6 flex w-full max-w-3xl flex-col gap-3"
              onSubmit={handleConvertSubmit}
            >
              <label className="settings-label" htmlFor="converter-source">
                Исходный файл
              </label>
              <input
                id="converter-source"
                type="file"
                className="settings-input"
                onChange={(event) => handleSourceFileChange(event.target.files?.[0] ?? null)}
                disabled={isConverting}
              />

              <label className="settings-label" htmlFor="converter-target">
                Формат назначения
              </label>
              <select
                id="converter-target"
                className="settings-input"
                value={converterTarget}
                onChange={(event) => setConverterTarget(event.target.value)}
                disabled={isConverting || converterTargets.length === 0}
              >
                {converterTargets.length === 0 ? (
                  <option value="">Нет доступных форматов</option>
                ) : (
                  converterTargets.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>

              {converterTargets.length > 0 && (
                <p className="rounded border border-[#5f5f5f] bg-[#d2d2d2] px-3 py-2 text-sm text-[#1f1f1f]">
                  {converterTargets.map((option) => option.label).join(", ")}
                </p>
              )}

              <label className="settings-label" htmlFor="converter-output-dir">
                Папка назначения
              </label>
              <div className="settings-input-wrap">
                <input
                  id="converter-output-dir"
                  type="text"
                  className="settings-input pr-24"
                  value={converterOutputDir}
                  onChange={(event) => setConverterOutputDir(event.target.value)}
                  disabled={isConverting || isPickingConverterDir}
                  placeholder="E:\\converted"
                />

                <button
                  type="button"
                  className="input-inline-action"
                  onClick={handlePickConverterOutputDir}
                  disabled={isConverting || isPickingConverterDir}
                >
                  {isPickingConverterDir ? "..." : "Обзор"}
                </button>
              </div>

              <button
                type="submit"
                className="mini-action entry-button inline-flex items-center justify-center"
                disabled={
                  isConverting ||
                  isPickingConverterDir ||
                  !sourceFile ||
                  !converterTarget ||
                  converterTargets.length === 0
                }
              >
                {isConverting ? "Конвертация..." : "Конвертировать"}
              </button>

              {converterError && (
                <p className="rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]">
                  {converterError}
                </p>
              )}

              <p className="rounded border border-[#5f5f5f] bg-[#d2d2d2] px-3 py-2 text-sm text-[#1f1f1f]">
                {converterStatus}
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
