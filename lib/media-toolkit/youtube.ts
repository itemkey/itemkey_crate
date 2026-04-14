import { spawn } from "node:child_process";
import path from "node:path";

const MAX_QUALITY_FORMAT = "bv*+ba/bestvideo*+bestaudio/best";
const OPTIONAL_NONE_VALUES = new Set(["", "none", "null", "nil", "no", "-"]);
const COOKIE_BROWSERS = new Set([
  "firefox",
  "chrome",
  "edge",
  "brave",
  "opera",
  "vivaldi",
]);

type YoutubeExtractedInfo = {
  formats?: unknown;
  entries?: unknown;
};

type YoutubeFormat = {
  height?: unknown;
  vcodec?: unknown;
  has_drm?: unknown;
};

export type YoutubeAuthOptions = {
  cookiesBrowser?: string | null;
  cookiesProfile?: string | null;
  poToken?: string | null;
};

export class YoutubeToolkitError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "YoutubeToolkitError";
    this.statusCode = statusCode;
  }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (OPTIONAL_NONE_VALUES.has(normalized.toLowerCase())) {
    return null;
  }

  return normalized;
}

function normalizeCookiesBrowser(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? null;
  if (!normalized || !COOKIE_BROWSERS.has(normalized)) {
    return null;
  }

  return normalized;
}

function normalizePoToken(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  if (normalized.includes(".gvs+")) {
    return normalized;
  }

  return `web.gvs+${normalized}`;
}

function applyAuthArgs(args: string[], auth: YoutubeAuthOptions): void {
  const cookiesBrowser = normalizeCookiesBrowser(auth.cookiesBrowser);
  const cookiesProfile = normalizeOptionalText(auth.cookiesProfile);
  const poToken = normalizePoToken(auth.poToken);

  if (cookiesBrowser) {
    const browserOption = cookiesProfile
      ? `${cookiesBrowser}:${cookiesProfile}`
      : cookiesBrowser;
    args.push("--cookies-from-browser", browserOption);
  }

  if (poToken) {
    args.push("--extractor-args", `youtube:po_token=${poToken}`);
  }
}

function formatYtDlpMessage(rawMessage: string): string {
  const normalized = rawMessage.trim();
  if (!normalized) {
    return "yt-dlp завершился с ошибкой.";
  }

  const lowered = normalized.toLowerCase();

  if (lowered.includes("http error 403")) {
    return "YouTube отклонил поток (HTTP 403). Попробуй cookies браузера или PO token.";
  }

  if (lowered.includes("video unavailable")) {
    return "Видео недоступно по этой ссылке.";
  }

  if (lowered.includes("unsupported url")) {
    return "Ссылка не поддерживается.";
  }

  if (lowered.includes("sign in to confirm your age")) {
    return "Нужна авторизация для этого видео. Укажи cookies браузера.";
  }

  if (lowered.includes("could not find firefox cookies database")) {
    return "Не удалось найти cookies Firefox.";
  }

  if (lowered.includes("could not copy chrome cookie database")) {
    return "Не удалось прочитать cookies браузера.";
  }

  if (lowered.includes("failed to decrypt with dpapi")) {
    return "Windows не дал расшифровать cookies для этого профиля.";
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^error:\s*/i, ""));

  return lines[0] ?? "yt-dlp завершился с ошибкой.";
}

async function runYtDlp(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new YoutubeToolkitError(
            "yt-dlp не найден в системе. Установи yt-dlp и попробуй снова.",
            500
          )
        );
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new YoutubeToolkitError(formatYtDlpMessage(stderr || stdout), 400));
    });
  });
}

function sanitizeYoutubeUrl(rawUrl: string): string {
  const candidate = rawUrl.trim();
  if (!candidate) {
    throw new YoutubeToolkitError("Ссылка YouTube не может быть пустой.", 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new YoutubeToolkitError("Некорректная ссылка.", 400);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new YoutubeToolkitError("Ссылка должна начинаться с http:// или https://.", 400);
  }

  return parsed.toString();
}

function extractFormats(info: YoutubeExtractedInfo): YoutubeFormat[] {
  const primary =
    Array.isArray(info.entries) && info.entries.length > 0 && !Array.isArray(info.formats)
      ? info.entries.find((entry) => !!entry && typeof entry === "object")
      : info;

  if (!primary || typeof primary !== "object") {
    return [];
  }

  const maybeFormats = (primary as YoutubeExtractedInfo).formats;
  if (!Array.isArray(maybeFormats)) {
    return [];
  }

  return maybeFormats.filter((format) => !!format && typeof format === "object") as YoutubeFormat[];
}

function buildResolutionSelector(height: number): string {
  return [
    `bestvideo[height=${height}][vcodec!=none]+bestaudio[acodec!=none]`,
    `best[height=${height}][vcodec!=none][acodec!=none]`,
    `bestvideo[height<=${height}][vcodec!=none]+bestaudio[acodec!=none]`,
    `best[height<=${height}][vcodec!=none][acodec!=none]`,
  ].join("/");
}

function buildOutputTemplate(outputDir: string): string {
  return path.join(outputDir, "%(title)s.%(ext)s");
}

export async function analyzeYoutubeResolutions(
  url: string,
  auth: YoutubeAuthOptions
): Promise<number[]> {
  const sanitizedUrl = sanitizeYoutubeUrl(url);

  const args = [
    "-J",
    "--no-playlist",
    "--no-warnings",
    "--skip-download",
    sanitizedUrl,
  ];
  applyAuthArgs(args, auth);

  const stdout = await runYtDlp(args);

  let payload: YoutubeExtractedInfo;
  try {
    payload = JSON.parse(stdout) as YoutubeExtractedInfo;
  } catch {
    throw new YoutubeToolkitError("Не удалось получить список доступных разрешений.", 500);
  }

  const formats = extractFormats(payload);
  const heights = new Set<number>();

  for (const format of formats) {
    if (format.has_drm === true) {
      continue;
    }

    if (typeof format.vcodec !== "string" || format.vcodec === "none") {
      continue;
    }

    if (typeof format.height === "number" && format.height > 0) {
      heights.add(format.height);
    }
  }

  return [...heights].sort((left, right) => left - right);
}

export async function downloadYoutubeByResolution(params: {
  url: string;
  outputDir: string;
  height: number;
  auth: YoutubeAuthOptions;
}): Promise<void> {
  const sanitizedUrl = sanitizeYoutubeUrl(params.url);
  const selector = buildResolutionSelector(params.height);

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--retries",
    "5",
    "--fragment-retries",
    "2",
    "--extractor-retries",
    "3",
    "--concurrent-fragments",
    "1",
    "--no-overwrites",
    "--merge-output-format",
    "mp4",
    "-f",
    selector,
    "-o",
    buildOutputTemplate(params.outputDir),
    sanitizedUrl,
  ];
  applyAuthArgs(args, params.auth);

  await runYtDlp(args);
}

export async function downloadYoutubeBest(params: {
  url: string;
  outputDir: string;
  auth: YoutubeAuthOptions;
}): Promise<void> {
  const sanitizedUrl = sanitizeYoutubeUrl(params.url);

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--retries",
    "5",
    "--fragment-retries",
    "2",
    "--extractor-retries",
    "3",
    "--concurrent-fragments",
    "1",
    "--no-overwrites",
    "--merge-output-format",
    "mp4",
    "-f",
    MAX_QUALITY_FORMAT,
    "-o",
    buildOutputTemplate(params.outputDir),
    sanitizedUrl,
  ];
  applyAuthArgs(args, params.auth);

  await runYtDlp(args);
}
