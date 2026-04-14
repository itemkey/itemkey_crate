import { mkdir } from "node:fs/promises";
import path from "node:path";

import { toErrorMessage } from "@/lib/errors";
import {
  downloadYoutubeBest,
  downloadYoutubeByResolution,
  YoutubeToolkitError,
} from "@/lib/media-toolkit/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DownloadRequestPayload = {
  urls?: unknown;
  outputDir?: unknown;
  height?: unknown;
  mode?: unknown;
  cookiesBrowser?: unknown;
  cookiesProfile?: unknown;
  poToken?: unknown;
};

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const urls: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }

    urls.push(trimmed);
  }

  return urls;
}

function normalizeOutputDir(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new YoutubeToolkitError("Укажи папку назначения.", 400);
  }

  return path.resolve(/* turbopackIgnore: true */ raw);
}

function parseHeight(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  throw new YoutubeToolkitError("Разрешение должно быть положительным числом.", 400);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DownloadRequestPayload;

    const urls = parseUrlList(body.urls);
    if (urls.length === 0) {
      return Response.json(
        {
          error: "Добавь минимум одну ссылку YouTube.",
        },
        { status: 400 }
      );
    }

    const outputDir = normalizeOutputDir(body.outputDir);
    await mkdir(outputDir, { recursive: true });

    const auth = {
      cookiesBrowser: asOptionalString(body.cookiesBrowser),
      cookiesProfile: asOptionalString(body.cookiesProfile),
      poToken: asOptionalString(body.poToken),
    };

    const requestedMode =
      typeof body.mode === "string" ? body.mode.toLowerCase() : "single";
    const isBatch = requestedMode === "batch" || urls.length > 1;

    if (!isBatch) {
      const height = parseHeight(body.height);

      await downloadYoutubeByResolution({
        url: urls[0]!,
        outputDir,
        height,
        auth,
      });

      return Response.json(
        {
          data: {
            mode: "single",
            outputDir,
            requestedHeight: height,
          },
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const errors: { url: string; error: string }[] = [];
    let done = 0;

    for (const url of urls) {
      try {
        await downloadYoutubeBest({
          url,
          outputDir,
          auth,
        });
        done += 1;
      } catch (downloadError) {
        errors.push({
          url,
          error:
            downloadError instanceof YoutubeToolkitError
              ? downloadError.message
              : toErrorMessage(downloadError, "Скачивание не удалось."),
        });
      }
    }

    return Response.json(
      {
        data: {
          mode: "batch",
          outputDir,
          total: urls.length,
          done,
          failed: urls.length - done,
          errors,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const statusCode = error instanceof YoutubeToolkitError ? error.statusCode : 500;
    const fallback =
      statusCode >= 500
        ? "Не удалось выполнить скачивание на сервере."
        : "Не удалось скачать видео.";

    return Response.json(
      {
        error: toErrorMessage(error, fallback),
      },
      {
        status: statusCode,
      }
    );
  }
}
