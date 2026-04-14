import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { cookies } from "next/headers";

import { CSRF_COOKIE_NAME, isValidCsrfPair } from "@/lib/auth/csrf";
import { toErrorMessage } from "@/lib/errors";
import {
  getTargetOptionsForFile,
  isTargetAllowedForFile,
  type ConverterTargetFormat,
} from "@/lib/media-toolkit/formats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none", ""]);

type ProbeStream = {
  codec_type?: unknown;
};

type ProbePayload = {
  streams?: ProbeStream[];
};

class ConverterRouteError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ConverterRouteError";
    this.statusCode = statusCode;
  }
}

async function ensureTrustedRequest(request: Request): Promise<void> {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? "";
  if (!ALLOWED_FETCH_SITES.has(fetchSite)) {
    throw new ConverterRouteError("Запрос отклонен по источнику.", 403);
  }

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE_NAME)?.value?.trim() ?? "";
  const headerToken = request.headers.get("x-csrf-token")?.trim() ?? "";

  if (!cookieToken || !headerToken || !isValidCsrfPair(cookieToken, headerToken)) {
    throw new ConverterRouteError("Некорректный CSRF-токен.", 403);
  }
}

function sanitizeSourceExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (!extension || extension.length > 12) {
    return ".bin";
  }

  if (!/^[.a-z0-9]+$/.test(extension)) {
    return ".bin";
  }

  return extension;
}

function sanitizeOutputBaseName(fileName: string): string {
  const rawBaseName = path.parse(fileName).name || "converted";
  const normalized = rawBaseName
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");

  return normalized || "converted";
}

async function nextUniqueOutputPath(
  outputDir: string,
  baseName: string,
  extensionWithoutDot: string
): Promise<string> {
  let suffix = 0;

  while (true) {
    const candidateName =
      suffix === 0
        ? `${baseName}.${extensionWithoutDot}`
        : `${baseName} (${suffix}).${extensionWithoutDot}`;
    const candidatePath = path.join(outputDir, candidateName);

    try {
      await access(candidatePath);
      suffix += 1;
    } catch {
      return candidatePath;
    }
  }
}

function mapFfmpegError(stderr: string): string {
  const normalized = stderr.trim().toLowerCase();
  if (!normalized) {
    return "FFmpeg завершился с ошибкой во время конвертации.";
  }

  if (
    normalized.includes("invalid data found") ||
    normalized.includes("moov atom not found") ||
    normalized.includes("could not find codec parameters")
  ) {
    return "Не удалось прочитать исходный файл.";
  }

  if (
    normalized.includes("could not write header") ||
    normalized.includes("incorrect codec parameters")
  ) {
    return "Контейнер не поддерживает выбранные кодеки для этого файла.";
  }

  if (normalized.includes("unknown encoder") || normalized.includes("encoder not found")) {
    return "В текущей сборке FFmpeg нет нужного кодека для этого формата.";
  }

  if (normalized.includes("permission denied")) {
    return "Нет доступа к файлам во время конвертации.";
  }

  return "FFmpeg не смог конвертировать файл.";
}

function buildAudioConversionArgs(target: ConverterTargetFormat): string[] {
  switch (target) {
    case "mp3":
      return ["-vn", "-codec:a", "libmp3lame", "-q:a", "2"];
    case "wav":
      return ["-vn", "-codec:a", "pcm_s16le"];
    case "flac":
      return ["-vn", "-codec:a", "flac"];
    case "aac":
      return ["-vn", "-codec:a", "aac", "-b:a", "192k"];
    case "m4a":
      return ["-vn", "-codec:a", "aac", "-b:a", "192k"];
    case "ogg":
      return ["-vn", "-codec:a", "libvorbis", "-q:a", "5"];
    case "opus":
      return ["-vn", "-codec:a", "libopus", "-b:a", "160k"];
    case "wma":
      return ["-vn", "-codec:a", "wmav2", "-b:a", "192k"];
    default:
      throw new ConverterRouteError("Выбранный аудио формат не поддерживается.", 400);
  }
}

function buildVideoConversionArgs(target: ConverterTargetFormat): string[] {
  switch (target) {
    case "mp4":
    case "m4v":
      return [
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-codec:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "21",
        "-codec:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
      ];
    case "mkv":
    case "mov":
      return [
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-codec:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "21",
        "-codec:a",
        "aac",
        "-b:a",
        "192k",
      ];
    case "avi":
      return [
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-codec:v",
        "mpeg4",
        "-q:v",
        "4",
        "-codec:a",
        "libmp3lame",
        "-q:a",
        "2",
      ];
    case "webm":
      return [
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-codec:v",
        "libvpx-vp9",
        "-crf",
        "32",
        "-b:v",
        "0",
        "-codec:a",
        "libopus",
        "-b:a",
        "128k",
      ];
    case "flv":
      return [
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-codec:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "22",
        "-codec:a",
        "aac",
        "-b:a",
        "160k",
      ];
    case "wmv":
      return [
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-codec:v",
        "wmv2",
        "-codec:a",
        "wmav2",
        "-b:a",
        "192k",
      ];
    case "ts":
    case "m2ts":
    case "mpg":
      return [
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-codec:v",
        "mpeg2video",
        "-q:v",
        "5",
        "-codec:a",
        "mp2",
        "-b:a",
        "192k",
      ];
    default:
      throw new ConverterRouteError("Выбранный видео формат не поддерживается.", 400);
  }
}

function isAudioTarget(target: ConverterTargetFormat): boolean {
  return ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma"].includes(target);
}

async function probeMediaStreams(sourcePath: string): Promise<{ hasVideo: boolean; hasAudio: boolean }> {
  const payload = await new Promise<ProbePayload>((resolve, reject) => {
    const ffprobe = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", sourcePath],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";

    ffprobe.stdout?.setEncoding("utf8");
    ffprobe.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    ffprobe.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new ConverterRouteError(
            "FFprobe не найден в системе. Установи FFmpeg и попробуй снова.",
            500
          )
        );
        return;
      }

      reject(error);
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new ConverterRouteError("Файл не поддерживается или поврежден.", 400));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as ProbePayload);
      } catch {
        reject(new ConverterRouteError("Не удалось проанализировать исходный файл.", 500));
      }
    });
  });

  const streams = Array.isArray(payload.streams) ? payload.streams : [];

  let hasVideo = false;
  let hasAudio = false;
  for (const stream of streams) {
    if (stream.codec_type === "video") {
      hasVideo = true;
    }

    if (stream.codec_type === "audio") {
      hasAudio = true;
    }
  }

  return { hasVideo, hasAudio };
}

async function runFfmpegConversion(
  sourcePath: string,
  outputPath: string,
  targetFormat: ConverterTargetFormat
): Promise<void> {
  const conversionArgs = isAudioTarget(targetFormat)
    ? buildAudioConversionArgs(targetFormat)
    : buildVideoConversionArgs(targetFormat);

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        ...conversionArgs,
        outputPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    let stderr = "";

    ffmpeg.stderr?.setEncoding("utf8");
    ffmpeg.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    ffmpeg.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new ConverterRouteError(
            "FFmpeg не найден в системе. Установи FFmpeg и попробуй снова.",
            500
          )
        );
        return;
      }

      reject(error);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new ConverterRouteError(mapFfmpegError(stderr), 400));
    });
  });
}

export async function POST(request: Request) {
  let workingDir: string | null = null;

  try {
    await ensureTrustedRequest(request);

    const formData = await request.formData();
    const source = formData.get("source");
    const outputDirRaw = formData.get("outputDir");
    const targetFormatRaw = formData.get("targetFormat");

    if (!(source instanceof File)) {
      throw new ConverterRouteError("Добавь исходный файл для конвертации.", 400);
    }

    if (source.size === 0) {
      throw new ConverterRouteError("Загруженный файл пустой.", 400);
    }

    if (source.size > MAX_UPLOAD_BYTES) {
      throw new ConverterRouteError("Файл слишком большой для конвертации.", 413);
    }

    if (typeof outputDirRaw !== "string" || !outputDirRaw.trim()) {
      throw new ConverterRouteError("Укажи папку назначения.", 400);
    }

    if (typeof targetFormatRaw !== "string" || !targetFormatRaw.trim()) {
      throw new ConverterRouteError("Выбери формат для конвертации.", 400);
    }

    const targetFormat = targetFormatRaw.trim().toLowerCase() as ConverterTargetFormat;
    const allowedTargetInfo = getTargetOptionsForFile(source.name);
    if (!allowedTargetInfo) {
      throw new ConverterRouteError("Файл не поддерживается для конвертации.", 400);
    }

    if (!isTargetAllowedForFile(source.name, targetFormat)) {
      throw new ConverterRouteError("Выбранный формат недоступен для этого файла.", 400);
    }

    const outputDir = path.resolve(/* turbopackIgnore: true */ outputDirRaw.trim());
    await mkdir(outputDir, { recursive: true });

    const sourceBuffer = Buffer.from(await source.arrayBuffer());
    const sourceExt = sanitizeSourceExtension(source.name);
    const outputBase = sanitizeOutputBaseName(source.name);

    workingDir = await mkdtemp(path.join(tmpdir(), "item-key-converter-"));
    const sourcePath = path.join(workingDir, `source${sourceExt}`);
    await writeFile(sourcePath, sourceBuffer);

    const probe = await probeMediaStreams(sourcePath);
    if (allowedTargetInfo.sourceKind === "video" && !probe.hasVideo) {
      throw new ConverterRouteError("Файл не поддерживается для конвертации.", 400);
    }

    if (allowedTargetInfo.sourceKind === "audio" && !probe.hasAudio) {
      throw new ConverterRouteError("Файл не поддерживается для конвертации.", 400);
    }

    const outputPath = await nextUniqueOutputPath(outputDir, outputBase, targetFormat);
    await runFfmpegConversion(sourcePath, outputPath, targetFormat);

    const outputStats = await stat(outputPath);
    if (outputStats.size === 0) {
      throw new ConverterRouteError("Конвертация завершилась с пустым файлом.", 500);
    }

    return Response.json(
      {
        data: {
          outputPath,
          targetFormat,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const parseFormDataFailure =
      error instanceof TypeError && error.message.toLowerCase().includes("formdata");
    if (parseFormDataFailure) {
      return Response.json(
        {
          error: "Не удалось прочитать загруженный файл. Проверь размер и повтори попытку.",
        },
        {
          status: 400,
        }
      );
    }

    const statusCode = error instanceof ConverterRouteError ? error.statusCode : 500;
    const fallback =
      statusCode >= 500
        ? "Не удалось выполнить конвертацию на сервере."
        : "Не удалось конвертировать файл.";

    return Response.json(
      {
        error: toErrorMessage(error, fallback),
      },
      {
        status: statusCode,
      }
    );
  } finally {
    if (workingDir) {
      await rm(workingDir, { recursive: true, force: true });
    }
  }
}
