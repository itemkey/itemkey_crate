export type ConverterSourceKind = "video" | "audio";

export type ConverterTargetFormat =
  | "mp4"
  | "mkv"
  | "mov"
  | "avi"
  | "webm"
  | "flv"
  | "m4v"
  | "wmv"
  | "ts"
  | "m2ts"
  | "mpg"
  | "mp3"
  | "wav"
  | "flac"
  | "aac"
  | "m4a"
  | "ogg"
  | "opus"
  | "wma";

export type ConverterTargetOption = {
  value: ConverterTargetFormat;
  label: string;
};

const VIDEO_INPUT_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".avi",
  ".webm",
  ".flv",
  ".m4v",
  ".wmv",
  ".mpeg",
  ".mpg",
  ".3gp",
  ".ts",
  ".m2ts",
  ".ogv",
]);

const AUDIO_INPUT_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".m4a",
  ".ogg",
  ".opus",
  ".wma",
  ".aiff",
  ".ac3",
  ".amr",
]);

const VIDEO_TARGET_OPTIONS: ConverterTargetOption[] = [
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "mov", label: "MOV" },
  { value: "avi", label: "AVI" },
  { value: "webm", label: "WEBM" },
  { value: "flv", label: "FLV" },
  { value: "m4v", label: "M4V" },
  { value: "wmv", label: "WMV" },
  { value: "ts", label: "TS" },
  { value: "m2ts", label: "M2TS" },
  { value: "mpg", label: "MPG" },
];

const AUDIO_TARGET_OPTIONS: ConverterTargetOption[] = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
  { value: "aac", label: "AAC" },
  { value: "m4a", label: "M4A" },
  { value: "ogg", label: "OGG" },
  { value: "opus", label: "OPUS" },
  { value: "wma", label: "WMA" },
];

function extractExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return "";
  }

  return normalized.slice(dotIndex);
}

export function resolveSourceKind(fileName: string): ConverterSourceKind | null {
  const extension = extractExtension(fileName);
  if (!extension) {
    return null;
  }

  if (VIDEO_INPUT_EXTENSIONS.has(extension)) {
    return "video";
  }

  if (AUDIO_INPUT_EXTENSIONS.has(extension)) {
    return "audio";
  }

  return null;
}

export function getTargetOptionsForFile(fileName: string): {
  sourceKind: ConverterSourceKind;
  options: ConverterTargetOption[];
} | null {
  const sourceKind = resolveSourceKind(fileName);
  if (!sourceKind) {
    return null;
  }

  const extension = extractExtension(fileName).replace(".", "");
  const baseOptions =
    sourceKind === "video"
      ? [...VIDEO_TARGET_OPTIONS, ...AUDIO_TARGET_OPTIONS]
      : [...AUDIO_TARGET_OPTIONS];

  const options = baseOptions.filter((option) => option.value !== extension);
  if (options.length === 0) {
    return null;
  }

  return {
    sourceKind,
    options,
  };
}

export function isTargetAllowedForFile(
  fileName: string,
  target: string
): target is ConverterTargetFormat {
  const details = getTargetOptionsForFile(fileName);
  if (!details) {
    return false;
  }

  return details.options.some((option) => option.value === target);
}
