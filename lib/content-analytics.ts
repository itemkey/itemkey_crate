export type AnalyticsPlatform = "youtube" | "tiktok";

export type ContentAnalyticsRecord = {
  id: string;
  platform: AnalyticsPlatform;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagedViews: number | null;
  averageViewPercentage: number | null;
  subscribersGained: number | null;
  topic: string;
  hook: string;
};

export type AnalyticsFilter = {
  platform: AnalyticsPlatform | "all";
  periodDays: number | "all";
};

export type AnalyticsSummary = {
  videoCount: number;
  totalViews: number;
  totalEngagements: number;
  averageViews: number;
  engagementRate: number;
  averageViewPercentage: number | null;
  topVideo: ContentAnalyticsRecord | null;
};

export type AnalyticsPattern = {
  key: string;
  label: string;
  videoCount: number;
  averageViews: number;
  engagementRate: number;
};

export type AnalyticsRecommendation = {
  kind: "repeat" | "change" | "test";
  title: string;
  detail: string;
};

export type AnalyticsForecastInput = {
  platform: AnalyticsPlatform;
  durationSeconds: number;
  topic: string;
  publishHour: number;
};

export type AnalyticsForecast = {
  baseline: number;
  low: number;
  high: number;
  sampleSize: number;
  confidence: "low" | "medium" | "high";
  reasons: string[];
};

export type AnalyticsImportResult = {
  records: ContentAnalyticsRecord[];
  warnings: string[];
};

const FIELD_ALIASES: Record<keyof Omit<ContentAnalyticsRecord, "id"> | "id", string[]> = {
  id: ["id", "video_id", "videoid", "идентификатор"],
  platform: ["platform", "платформа", "source", "источник"],
  title: ["title", "название", "name", "video_title"],
  publishedAt: ["publishedat", "published_at", "published", "date", "дата", "create_time"],
  durationSeconds: ["durationseconds", "duration_seconds", "duration", "длительность", "seconds"],
  views: ["views", "view_count", "viewcount", "просмотры"],
  likes: ["likes", "like_count", "likecount", "лайки"],
  comments: ["comments", "comment_count", "commentcount", "комментарии"],
  shares: ["shares", "share_count", "sharecount", "репосты"],
  engagedViews: ["engagedviews", "engaged_views", "вовлеченные_просмотры"],
  averageViewPercentage: [
    "averageviewpercentage",
    "average_view_percentage",
    "avg_view_percentage",
    "удержание",
  ],
  subscribersGained: [
    "subscribersgained",
    "subscribers_gained",
    "подписчики",
  ],
  topic: ["topic", "тема", "content_tag", "category"],
  hook: ["hook", "хук", "hook_type", "opening"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNonNegativeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  const normalized = asText(value).replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || asText(value) === "") return null;
  const parsed = asNonNegativeNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePlatform(value: unknown): AnalyticsPlatform | null {
  const normalized = asText(value).toLocaleLowerCase();
  if (["youtube", "youtube shorts", "yt", "ютуб"].includes(normalized)) return "youtube";
  if (["tiktok", "tik tok", "tt", "тикток"].includes(normalized)) return "tiktok";
  return null;
}

function normalizeDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const unix = Number(text);
  const date = Number.isFinite(unix) && /^\d{10,13}$/.test(text)
    ? new Date(text.length === 10 ? unix * 1000 : unix)
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pickValue(source: Record<string, unknown>, field: keyof typeof FIELD_ALIASES): unknown {
  const normalized = new Map(
    Object.entries(source).map(([key, value]) => [normalizeHeader(key), value])
  );
  for (const alias of FIELD_ALIASES[field]) {
    const key = normalizeHeader(alias);
    if (normalized.has(key)) return normalized.get(key);
  }
  return undefined;
}

function normalizeRecord(
  source: Record<string, unknown>,
  index: number
): { record: ContentAnalyticsRecord | null; warning: string | null } {
  const platform = normalizePlatform(pickValue(source, "platform"));
  const title = asText(pickValue(source, "title"));
  const publishedAt = normalizeDate(pickValue(source, "publishedAt"));

  if (!platform || !title || !publishedAt) {
    return {
      record: null,
      warning: `Строка ${index + 1} пропущена: нужны platform, title и корректная дата публикации.`,
    };
  }

  const sourceId = asText(pickValue(source, "id"));
  const averageViewPercentage = asOptionalNumber(pickValue(source, "averageViewPercentage"));

  return {
    record: {
      id: sourceId || `${platform}-${index + 1}-${publishedAt.slice(0, 10)}`,
      platform,
      title,
      publishedAt,
      durationSeconds: Math.round(asNonNegativeNumber(pickValue(source, "durationSeconds"))),
      views: Math.round(asNonNegativeNumber(pickValue(source, "views"))),
      likes: Math.round(asNonNegativeNumber(pickValue(source, "likes"))),
      comments: Math.round(asNonNegativeNumber(pickValue(source, "comments"))),
      shares: Math.round(asNonNegativeNumber(pickValue(source, "shares"))),
      engagedViews: asOptionalNumber(pickValue(source, "engagedViews")),
      averageViewPercentage:
        averageViewPercentage === null ? null : Math.min(100, averageViewPercentage),
      subscribersGained: asOptionalNumber(pickValue(source, "subscribersGained")),
      topic: asText(pickValue(source, "topic")) || "Без темы",
      hook: asText(pickValue(source, "hook")) || "Не размечен",
    },
    warning: null,
  };
}

function parseCsvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }

  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

function parseCsv(value: string): Record<string, unknown>[] {
  const rows = parseCsvRows(value.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
  );
}

export function parseAnalyticsImport(value: string, fileName = "data.json"): AnalyticsImportResult {
  let rawRecords: unknown[];
  try {
    if (fileName.toLocaleLowerCase().endsWith(".csv")) {
      rawRecords = parseCsv(value);
    } else {
      const parsed: unknown = JSON.parse(value);
      rawRecords = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { videos?: unknown }).videos)
          ? (parsed as { videos: unknown[] }).videos
          : [];
    }
  } catch {
    return { records: [], warnings: ["Файл не удалось прочитать. Проверьте CSV или JSON."] };
  }

  if (rawRecords.length === 0) {
    return { records: [], warnings: ["В файле нет строк с данными о роликах."] };
  }

  const records: ContentAnalyticsRecord[] = [];
  const warnings: string[] = [];
  rawRecords.forEach((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      warnings.push(`Строка ${index + 1} пропущена: ожидался объект.`);
      return;
    }
    const normalized = normalizeRecord(source as Record<string, unknown>, index);
    if (normalized.record) records.push(normalized.record);
    if (normalized.warning) warnings.push(normalized.warning);
  });

  return { records, warnings };
}

export function filterAnalyticsRecords(
  records: ContentAnalyticsRecord[],
  filter: AnalyticsFilter,
  now = new Date()
): ContentAnalyticsRecord[] {
  const cutoff =
    filter.periodDays === "all"
      ? null
      : now.getTime() - filter.periodDays * 24 * 60 * 60 * 1000;
  return records.filter((record) => {
    if (filter.platform !== "all" && record.platform !== filter.platform) return false;
    return cutoff === null || new Date(record.publishedAt).getTime() >= cutoff;
  });
}

export function getEngagementRate(record: ContentAnalyticsRecord): number {
  if (record.views <= 0) return 0;
  return ((record.likes + record.comments + record.shares) / record.views) * 100;
}

export function summarizeAnalytics(records: ContentAnalyticsRecord[]): AnalyticsSummary {
  const totalViews = records.reduce((sum, record) => sum + record.views, 0);
  const totalEngagements = records.reduce(
    (sum, record) => sum + record.likes + record.comments + record.shares,
    0
  );
  const retentionValues = records.flatMap((record) =>
    record.averageViewPercentage === null ? [] : [record.averageViewPercentage]
  );

  return {
    videoCount: records.length,
    totalViews,
    totalEngagements,
    averageViews: records.length === 0 ? 0 : totalViews / records.length,
    engagementRate: totalViews === 0 ? 0 : (totalEngagements / totalViews) * 100,
    averageViewPercentage:
      retentionValues.length === 0
        ? null
        : retentionValues.reduce((sum, value) => sum + value, 0) / retentionValues.length,
    topVideo:
      records.length === 0
        ? null
        : records.reduce((top, record) => (record.views > top.views ? record : top)),
  };
}

function durationBucket(seconds: number): string {
  if (seconds <= 15) return "0–15 сек";
  if (seconds <= 35) return "16–35 сек";
  if (seconds <= 60) return "36–60 сек";
  return "Больше минуты";
}

function publishTimeBucket(date: string): string {
  const hour = new Date(date).getHours();
  if (hour < 6) return "Ночь · 00–05";
  if (hour < 12) return "Утро · 06–11";
  if (hour < 18) return "День · 12–17";
  return "Вечер · 18–23";
}

function groupPatterns(
  records: ContentAnalyticsRecord[],
  getKey: (record: ContentAnalyticsRecord) => string
): AnalyticsPattern[] {
  const groups = new Map<string, ContentAnalyticsRecord[]>();
  for (const record of records) {
    const key = getKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const summary = summarizeAnalytics(group);
      return {
        key,
        label: key,
        videoCount: group.length,
        averageViews: summary.averageViews,
        engagementRate: summary.engagementRate,
      };
    })
    .sort((left, right) => right.averageViews - left.averageViews);
}

export function getTopicPatterns(records: ContentAnalyticsRecord[]): AnalyticsPattern[] {
  return groupPatterns(records, (record) => record.topic);
}

export function getDurationPatterns(records: ContentAnalyticsRecord[]): AnalyticsPattern[] {
  return groupPatterns(records, (record) => durationBucket(record.durationSeconds));
}

export function getPublishTimePatterns(records: ContentAnalyticsRecord[]): AnalyticsPattern[] {
  return groupPatterns(records, (record) => publishTimeBucket(record.publishedAt));
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

function videoNoun(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "роликов";
  const last = value % 10;
  if (last === 1) return "ролик";
  if (last >= 2 && last <= 4) return "ролика";
  return "роликов";
}

function similarVideoPhrase(value: number): string {
  return value === 1 ? "1 похожий ролик" : `${value} похожих ${videoNoun(value)}`;
}

export function buildAnalyticsRecommendations(
  records: ContentAnalyticsRecord[]
): AnalyticsRecommendation[] {
  if (records.length === 0) return [];
  const summary = summarizeAnalytics(records);
  const topic = getTopicPatterns(records)[0];
  const duration = getDurationPatterns(records)[0];
  const highReaction = [...records]
    .filter((record) => record.views > 0)
    .sort((left, right) => getEngagementRate(right) - getEngagementRate(left))[0];

  const recommendations: AnalyticsRecommendation[] = [];
  if (topic) {
    recommendations.push({
      kind: "repeat",
      title: `Повторить тему «${topic.label}»`,
      detail: `${topic.videoCount} рол. · в среднем ${formatInteger(topic.averageViews)} просмотров.`,
    });
  }
  if (duration) {
    recommendations.push({
      kind: "change",
      title: `Собрать следующий ролик в диапазоне ${duration.label.toLocaleLowerCase()}`,
      detail: `Этот диапазон сейчас сильнее общего среднего на ${formatInteger(
        duration.averageViews - summary.averageViews
      )} просмотров.`,
    });
  }
  if (highReaction) {
    recommendations.push({
      kind: "test",
      title: `Протестировать механику «${highReaction.hook}»`,
      detail: `У ролика «${highReaction.title}» реакция ${getEngagementRate(highReaction).toFixed(1)}%.`,
    });
  }
  return recommendations.slice(0, 3);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function circularHourDistance(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, 24 - direct);
}

export function forecastAnalyticsOutcome(
  records: ContentAnalyticsRecord[],
  input: AnalyticsForecastInput
): AnalyticsForecast | null {
  const platformRecords = records.filter((record) => record.platform === input.platform);
  if (platformRecords.length === 0) return null;

  const inputDurationBucket = durationBucket(input.durationSeconds);
  const scored = platformRecords.map((record) => {
    let score = 1;
    if (record.topic.toLocaleLowerCase() === input.topic.trim().toLocaleLowerCase()) score += 4;
    if (durationBucket(record.durationSeconds) === inputDurationBucket) score += 2;
    if (circularHourDistance(new Date(record.publishedAt).getHours(), input.publishHour) <= 2) score += 1;
    return { record, score };
  });
  const bestScore = Math.max(...scored.map((item) => item.score));
  const closest = scored
    .filter((item) => item.score >= Math.max(2, bestScore - 1))
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map((item) => item.record);
  const sample = closest.length > 0 ? closest : platformRecords;
  const baseline = median(sample.map((record) => record.views));
  const reasons: string[] = [];

  const sameTopic = sample.filter(
    (record) => record.topic.toLocaleLowerCase() === input.topic.trim().toLocaleLowerCase()
  ).length;
  if (sameTopic > 0) reasons.push(`Тема встречалась: ${similarVideoPhrase(sameTopic)}.`);
  const sameDuration = sample.filter(
    (record) => durationBucket(record.durationSeconds) === inputDurationBucket
  ).length;
  if (sameDuration > 0) reasons.push(`${sameDuration} ${videoNoun(sameDuration)} в том же диапазоне длины.`);
  const sameTime = sample.filter(
    (record) => circularHourDistance(new Date(record.publishedAt).getHours(), input.publishHour) <= 2
  ).length;
  if (sameTime > 0) {
    reasons.push(
      sameTime === 1
        ? "1 ролик опубликован примерно в это же время."
        : `${sameTime} ${videoNoun(sameTime)} опубликованы примерно в это же время.`
    );
  }
  if (reasons.length === 0) reasons.push("Прогноз опирается на общую медиану платформы.");

  return {
    baseline,
    low: Math.max(0, Math.round(baseline * 0.68)),
    high: Math.round(baseline * 1.38),
    sampleSize: sample.length,
    confidence: sample.length >= 8 ? "high" : sample.length >= 4 ? "medium" : "low",
    reasons,
  };
}

export function mergeAnalyticsRecords(
  current: ContentAnalyticsRecord[],
  incoming: ContentAnalyticsRecord[]
): ContentAnalyticsRecord[] {
  const merged = new Map(current.map((record) => [`${record.platform}:${record.id}`, record]));
  for (const record of incoming) merged.set(`${record.platform}:${record.id}`, record);
  return [...merged.values()].sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
  );
}

export function createAnalyticsDemoRecords(now = new Date()): ContentAnalyticsRecord[] {
  const day = (offset: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  return [
    ["youtube", "Почему мы забываем сны", 3, 20, 34, 48200, 3100, 186, 440, 71, "Психология", "Вопрос"],
    ["tiktok", "Три ошибки памяти", 6, 19, 27, 71900, 6200, 410, 930, null, "Психология", "Список"],
    ["youtube", "Что делает привычку устойчивой", 11, 17, 52, 28100, 1700, 122, 205, 64, "Привычки", "Прямой тезис"],
    ["tiktok", "Мозг не любит незавершённость", 16, 21, 24, 53600, 4300, 351, 670, null, "Психология", "Парадокс"],
    ["youtube", "Метод двух минут без мифов", 24, 13, 63, 19700, 960, 81, 114, 58, "Привычки", "Разбор мифа"],
    ["tiktok", "Почему списки не работают", 31, 9, 18, 34400, 2900, 244, 510, null, "Продуктивность", "Провокация"],
    ["youtube", "Как не потерять фокус", 42, 19, 38, 36100, 2300, 149, 302, 69, "Продуктивность", "Вопрос"],
    ["tiktok", "Одна настройка для фокуса", 58, 18, 22, 46800, 4100, 303, 720, null, "Продуктивность", "Обещание"],
  ].map((item, index) => ({
    id: `demo-${index + 1}`,
    platform: item[0] as AnalyticsPlatform,
    title: item[1] as string,
    publishedAt: day(item[2] as number, item[3] as number),
    durationSeconds: item[4] as number,
    views: item[5] as number,
    likes: item[6] as number,
    comments: item[7] as number,
    shares: item[8] as number,
    engagedViews: item[0] === "youtube" ? Math.round((item[5] as number) * 0.81) : null,
    averageViewPercentage: item[9] as number | null,
    subscribersGained: item[0] === "youtube" ? Math.round((item[5] as number) / 850) : null,
    topic: item[10] as string,
    hook: item[11] as string,
  }));
}
