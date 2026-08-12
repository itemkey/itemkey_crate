"use client";

import "./pdf-viewer.css";

import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import {
  deleteExpiredPdfViewerFiles,
  getPdfViewerFile,
  type PdfViewerFileRecord,
} from "@/lib/pdf-viewer-store";

type PdfJsModule = typeof import("pdfjs-dist");
type PdfDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;
type PdfDocumentLoadingTask = import("pdfjs-dist").PDFDocumentLoadingTask;
type PdfRenderTask = {
  cancel: () => void;
  promise: Promise<unknown>;
};

const PDF_WAIT_TIMEOUT_MS = 10000;
const PDF_WAIT_STEP_MS = 160;
const PDF_RENDER_MAX_WIDTH = 980;

async function loadPdfJs(): Promise<PdfJsModule> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModule;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  return pdfjs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForPdfViewerFile(id: string): Promise<PdfViewerFileRecord | null> {
  const deadline = Date.now() + PDF_WAIT_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    const record = await getPdfViewerFile(id);
    if (record) {
      return record;
    }

    await sleep(PDF_WAIT_STEP_MS);
  }

  return null;
}

function formatPdfFileSize(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
  }).format(value)} ${units[unitIndex]}`;
}

export default function PdfViewerPage() {
  const { locale, t } = useI18n();
  const [fileName, setFileName] = useState("PDF");
  const [fileSizeLabel, setFileSizeLabel] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<number[]>([]);
  const [status, setStatus] = useState(() => t("pdf.preparing"));
  const [error, setError] = useState<string | null>(null);
  const [resizeTick, setResizeTick] = useState(0);
  const pdfDocumentRef = useRef<PdfDocumentProxy | null>(null);
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});

  const title = useMemo(() => fileName.trim() || "PDF", [fileName]);

  useEffect(() => {
    let isCancelled = false;
    let objectUrl: string | null = null;
    let loadingTask: PdfDocumentLoadingTask | null = null;

    async function loadPdf() {
      try {
        void deleteExpiredPdfViewerFiles();

        const params = new URLSearchParams(window.location.search);
        const id = params.get("id") ?? "";
        const suggestedName = params.get("name") ?? "";
        if (suggestedName.trim()) {
          setFileName(suggestedName.trim());
        }

        if (!id.trim()) {
          throw new Error(t("pdf.notFound"));
        }

        const record = await waitForPdfViewerFile(id);
        if (!record) {
          throw new Error(t("pdf.transferTimeout"));
        }
        if (isCancelled) {
          return;
        }

        setFileName(record.fileName);
        setFileSizeLabel(formatPdfFileSize(record.sizeBytes, locale));
        objectUrl = URL.createObjectURL(record.blob);
        setDownloadUrl(objectUrl);
        setStatus(t("pdf.loading"));

        const pdfjs = await loadPdfJs();
        if (isCancelled) {
          return;
        }

        loadingTask = pdfjs.getDocument({
          url: objectUrl,
          disableAutoFetch: true,
          disableStream: true,
          useWorkerFetch: false,
        }) as PdfDocumentLoadingTask;

        const pdfDocument = await loadingTask.promise;
        if (isCancelled) {
          await pdfDocument.loadingTask.destroy();
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        setPages(Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1));
        setStatus(
          t("pdf.pageCount", {
            count: new Intl.NumberFormat(locale).format(pdfDocument.numPages),
          })
        );
      } catch (loadError) {
        if (!isCancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("pdf.openFailed")
          );
          setStatus(t("pdf.openFailed"));
        }
      }
    }

    void loadPdf();

    return () => {
      isCancelled = true;
      void loadingTask?.destroy();
      pdfDocumentRef.current = null;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [locale, t]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function handleResize() {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        setResizeTick((value) => value + 1);
      }, 140);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument || pages.length === 0) {
      return;
    }

    const activePdfDocument = pdfDocument;
    let isCancelled = false;
    const renderTasks: PdfRenderTask[] = [];

    async function renderPages() {
      try {
        setStatus(t("pdf.rendering"));

        for (const pageNumber of pages) {
          if (isCancelled) {
            return;
          }

          const canvas = canvasRefs.current[pageNumber];
          if (!canvas) {
            continue;
          }

          const page = await activePdfDocument.getPage(pageNumber);
          if (isCancelled) {
            return;
          }

          const baseViewport = page.getViewport({ scale: 1 });
          const availableWidth = Math.min(
            PDF_RENDER_MAX_WIDTH,
            Math.max(240, window.innerWidth - 32)
          );
          const cssScale = Math.min(2.4, availableWidth / baseViewport.width);
          const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
          const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
          const cssViewport = page.getViewport({ scale: cssScale });
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) {
            throw new Error(t("pdf.canvasFailed"));
          }

          canvas.width = Math.ceil(renderViewport.width);
          canvas.height = Math.ceil(renderViewport.height);
          canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
          canvas.style.height = `${Math.ceil(cssViewport.height)}px`;
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);

          const renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport: renderViewport,
            background: "#ffffff",
          }) as PdfRenderTask;
          renderTasks.push(renderTask);
          await renderTask.promise;
          page.cleanup();
        }

        if (!isCancelled) {
          setStatus(
            t("pdf.readyCount", {
              count: new Intl.NumberFormat(locale).format(pages.length),
            })
          );
        }
      } catch (renderError) {
        if (!isCancelled) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : t("pdf.renderFailed")
          );
          setStatus(t("pdf.openFailed"));
        }
      }
    }

    void renderPages();

    return () => {
      isCancelled = true;
      for (const task of renderTasks) {
        task.cancel();
      }
    };
  }, [locale, pages, resizeTick, t]);

  return (
    <main className="pdf-viewer-page">
      <header className="pdf-viewer-header">
        <div className="pdf-viewer-title-block">
          <p className="pdf-viewer-kicker">PDF</p>
          <h1>{title}</h1>
          <p>{fileSizeLabel ? `${status} · ${fileSizeLabel}` : status}</p>
        </div>
        {downloadUrl ? (
          <a className="pdf-viewer-download" href={downloadUrl} download={title}>
            {t("common.download")}
          </a>
        ) : null}
      </header>

      {error ? (
        <section className="pdf-viewer-error">
          <h2>{t("pdf.failed")}</h2>
          <p>{error}</p>
          {downloadUrl ? (
            <a href={downloadUrl} download={title}>
              {t("pdf.downloadFile")}
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="pdf-viewer-pages" aria-label={t("pdf.pages")}>
        {pages.map((pageNumber) => (
          <article className="pdf-viewer-page-frame" key={pageNumber}>
            <div className="pdf-viewer-page-number">
              {t("pdf.pageNumber", {
                number: new Intl.NumberFormat(locale).format(pageNumber),
              })}
            </div>
            <canvas
              ref={(element) => {
                canvasRefs.current[pageNumber] = element;
              }}
            />
          </article>
        ))}
      </section>
    </main>
  );
}
