"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
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
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<ToolkitTab>(initialTab);

  const csrfTokenRef = useRef<string | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement | null>(null);

  const [downloadDir, setDownloadDir] = useState("");
  const [urlInputs, setUrlInputs] = useState<string[]>([""]);
  const [cookiesBrowser, setCookiesBrowser] = useState("none");
  const [cookiesProfile, setCookiesProfile] = useState("");
  const [poToken, setPoToken] = useState("");
  const [resolutions, setResolutions] = useState<number[]>([]);
  const [downloaderStatus, setDownloaderStatus] = useState(() => t("media.pasteLink"));
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
  const [converterStatus, setConverterStatus] = useState(() => t("media.selectSource"));
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
      setDownloaderError(t("media.pasteLink"));
      return;
    }

    setDownloaderError(null);
    setResolutions([]);
    setAnalyzedUrl(null);
    setAnalyzedAuthSignature(null);

    if (isBatchMode) {
      setDownloaderStatus(t("media.batchReady"));
      return;
    }

    setIsAnalyzing(true);
    setDownloaderStatus(t("media.analyzing"));

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
        throw new Error(payload.error ?? t("media.analysisFailed"));
      }

      setResolutions(payload.data.resolutions);
      setAnalyzedUrl(filledUrls[0] ?? null);
      setAnalyzedAuthSignature(authSignature(cookiesBrowser, cookiesProfile, poToken));
      setDownloaderStatus(t("media.chooseResolution"));
    } catch (error) {
      setDownloaderError(
        error instanceof Error
          ? error.message
          : t("media.analysisFailed")
      );
      setDownloaderStatus(t("media.analysisFailed"));
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
      setDownloaderError(t("media.pasteLink"));
      return;
    }

    if (!downloadDir.trim()) {
      setDownloaderError(t("media.enterDownloadFolder"));
      return;
    }

    if (
      analyzedUrl !== currentUrl ||
      analyzedAuthSignature !== authSignature(cookiesBrowser, cookiesProfile, poToken)
    ) {
      setDownloaderError(t("media.analyzeFirst"));
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
        throw new Error(payload.error ?? t("media.downloadFailed"));
      }

      setDownloaderStatus(t("media.readyPath", { path: payload.data.outputDir }));
    } catch (error) {
      setDownloaderError(
        error instanceof Error ? error.message : t("media.downloadFailed")
      );
      setDownloaderStatus(t("media.downloadFailed"));
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleDownloadBatchBest(): Promise<void> {
    if (downloaderBusy) {
      return;
    }

    if (filledUrls.length < 2) {
      setDownloaderError(t("media.batchMin"));
      return;
    }

    if (!downloadDir.trim()) {
      setDownloaderError(t("media.enterDownloadFolder"));
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
        throw new Error(payload.error ?? t("media.batchFailed"));
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
          : t("media.batchFailed")
      );
      setDownloaderStatus(t("media.batchFailed"));
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
        throw new Error(payload.error ?? t("media.pickFolderFailed"));
      }

      const selectedPath = payload.data.path?.trim() ?? "";
      if (!selectedPath) {
        setConverterStatus(t("media.pickFolderCanceled"));
        return;
      }

      setConverterOutputDir(selectedPath);
      setConverterStatus(t("media.folderSelected"));
    } catch (error) {
      setConverterError(
        error instanceof Error ? error.message : t("media.pickFolderFailed")
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
      setConverterStatus(t("media.selectSource"));
      return;
    }

    if (file.size > MAX_SOURCE_FILE_BYTES) {
      setSourceFile(null);
      setConverterTargets([]);
      setConverterTarget("");
      setConverterError(t("media.fileTooLarge"));
      setConverterStatus(t("media.fileTooLarge"));
      return;
    }

    const details = getTargetOptionsForFile(file.name);
    if (!details) {
      setConverterTargets([]);
      setConverterTarget("");
      setConverterError(t("media.unsupportedFile"));
      setConverterStatus(t("media.unsupportedFile"));
      return;
    }

    setConverterTargets(details.options);
    setConverterTarget(details.options[0]?.value ?? "");
    setConverterStatus(t("media.formatsUpdated"));
  }

  async function handleConvertSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isConverting) {
      return;
    }

    if (!sourceFile) {
      setConverterError(t("media.selectSource"));
      return;
    }

    if (sourceFile.size > MAX_SOURCE_FILE_BYTES) {
      setConverterError(t("media.fileTooLarge"));
      return;
    }

    if (!converterTarget) {
      setConverterError(t("media.selectTarget"));
      return;
    }

    if (!converterOutputDir.trim()) {
      setConverterError(t("media.enterTargetFolder"));
      return;
    }

    setConverterError(null);
    setIsConverting(true);
    setConverterStatus(t("media.converting"));

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
        throw new Error(payload.error ?? t("media.convertFailed"));
      }

      setConverterStatus(t("media.readyPath", { path: payload.data.outputPath }));
    } catch (error) {
      setConverterError(
        error instanceof Error ? error.message : t("media.convertFailed")
      );
      setConverterStatus(t("media.convertFailed"));
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <main className="workspace-root toolkit-root flex w-full items-stretch p-0">
      <div className="frame-shell entry-shell toolkit-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d toolkit-panel w-full max-w-4xl p-6">
          <h1 className="font-display entry-title toolkit-title text-center leading-none">
            {t("media.title")}
          </h1>

          <div className="toolkit-navigation mt-5">
            <div className="toolkit-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "downloader"}
                className={`mini-action entry-button inline-flex items-center justify-center ${
                  activeTab === "downloader" ? "toolkit-tab-active" : ""
                }`}
                onClick={() => setActiveTab("downloader")}
                disabled={isConverting || downloaderBusy}
              >
                {t("media.youtube")}
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "converter"}
                className={`mini-action entry-button inline-flex items-center justify-center ${
                  activeTab === "converter" ? "toolkit-tab-active" : ""
                }`}
                onClick={() => setActiveTab("converter")}
                disabled={isConverting || downloaderBusy}
              >
                {t("media.converter")}
              </button>
            </div>

            <Link
              href="/"
              className="mini-action toolkit-home-link inline-flex items-center justify-center"
            >
              {t("media.mainMenu")}
            </Link>
          </div>

          {activeTab === "downloader" ? (
            <section className="toolkit-content mx-auto mt-6 flex w-full max-w-3xl flex-col gap-3">
              <label className="settings-label" htmlFor="download-folder">
                {t("media.downloadFolder")}
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

              <label className="settings-label">{t("media.youtubeLinks")}</label>
              <div className="flex flex-col gap-2">
                {urlInputs.map((value, index) => (
                  <div key={`url-${index}`} className="toolkit-url-row">
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
                      className="mini-action toolkit-remove-url inline-flex items-center justify-center"
                      onClick={() => removeUrlInput(index)}
                      disabled={downloaderBusy}
                      aria-label={`${t("media.removeUrl")} ${index + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="toolkit-primary-actions mt-1">
                <button
                  type="button"
                  className="mini-action inline-flex items-center justify-center"
                  onClick={addUrlInput}
                  disabled={downloaderBusy}
                >
                  + {t("media.addUrl")}
                </button>

                <button
                  type="button"
                  className="mini-action entry-button inline-flex items-center justify-center"
                  onClick={handleAnalyzeYoutube}
                  disabled={downloaderBusy || filledUrls.length === 0}
                >
                  {isAnalyzing ? t("media.analyzing") : t("media.analyze")}
                </button>

                {isBatchMode && (
                  <button
                    type="button"
                    className="mini-action entry-button inline-flex items-center justify-center"
                    onClick={handleDownloadBatchBest}
                    disabled={downloaderBusy}
                  >
                    {isDownloading ? t("media.downloading") : t("media.downloadAllBest")}
                  </button>
                )}
              </div>

              <details className="toolkit-advanced">
                <summary className="toolkit-advanced-summary">{t("media.advanced")}</summary>

                <div className="toolkit-advanced-grid grid gap-3 md:grid-cols-3">
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
              </details>

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
                      {isDownloading
                        ? t("media.downloading")
                        : t("media.downloadResolution", { height })}
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
              className="toolkit-content mx-auto mt-6 flex w-full max-w-3xl flex-col gap-3"
              onSubmit={handleConvertSubmit}
            >
              <label className="settings-label" htmlFor="converter-source">
                {t("media.sourceFile")}
              </label>
              <div className="toolkit-file-picker">
                <input
                  ref={sourceFileInputRef}
                  id="converter-source"
                  type="file"
                  className="toolkit-file-input"
                  onChange={(event) => handleSourceFileChange(event.target.files?.[0] ?? null)}
                  disabled={isConverting}
                />
                <button
                  type="button"
                  className="mini-action toolkit-file-button"
                  onClick={() => sourceFileInputRef.current?.click()}
                  disabled={isConverting}
                >
                  {t("media.chooseFile")}
                </button>
                <span className="toolkit-file-name" title={sourceFile?.name ?? ""}>
                  {sourceFile?.name ?? t("media.noFile")}
                </span>
              </div>

              <label className="settings-label" htmlFor="converter-target">
                {t("media.targetFormat")}
              </label>
              <select
                id="converter-target"
                className="settings-input"
                value={converterTarget}
                onChange={(event) => setConverterTarget(event.target.value)}
                disabled={isConverting || converterTargets.length === 0}
              >
                {converterTargets.length === 0 ? (
                  <option value="">{t("media.noFormats")}</option>
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
                {t("media.targetFolder")}
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
                  {isPickingConverterDir ? "..." : t("media.browse")}
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
                {isConverting ? t("media.converting") : t("media.convert")}
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
