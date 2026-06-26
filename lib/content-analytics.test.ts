import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnalyticsRecommendations,
  createAnalyticsDemoRecords,
  filterAnalyticsRecords,
  forecastAnalyticsOutcome,
  mergeAnalyticsRecords,
  parseAnalyticsImport,
  summarizeAnalytics,
} from "./content-analytics.ts";

test("CSV import normalizes platform fields and numeric values", () => {
  const result = parseAnalyticsImport(
    [
      "platform,title,published_at,duration_seconds,views,likes,comments,shares,topic,hook",
      'YouTube,"Разбор, который работает",2026-06-15,31,12000,700,42,18,Обучение,Вопрос',
      "unknown,Без платформы,2026-06-14,20,100,10,1,0,Тест,Тезис",
    ].join("\n"),
    "videos.csv"
  );

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].title, "Разбор, который работает");
  assert.equal(result.records[0].platform, "youtube");
  assert.equal(result.records[0].views, 12000);
  assert.equal(result.warnings.length, 1);
});

test("summary and recommendations use imported performance", () => {
  const records = createAnalyticsDemoRecords(new Date("2026-06-20T12:00:00.000Z"));
  const summary = summarizeAnalytics(records);
  const recommendations = buildAnalyticsRecommendations(records);

  assert.equal(summary.videoCount, 8);
  assert.ok(summary.totalViews > 0);
  assert.equal(summary.topVideo?.title, "Три ошибки памяти");
  assert.deepEqual(recommendations.map((item) => item.kind), ["repeat", "change", "test"]);
});

test("period and platform filters work together", () => {
  const now = new Date("2026-06-20T12:00:00.000Z");
  const records = createAnalyticsDemoRecords(now);
  const filtered = filterAnalyticsRecords(records, { platform: "youtube", periodDays: 14 }, now);

  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((record) => record.platform === "youtube"));
});

test("forecast uses similar historical records and reports confidence", () => {
  const records = createAnalyticsDemoRecords(new Date("2026-06-20T12:00:00.000Z"));
  const forecast = forecastAnalyticsOutcome(records, {
    platform: "tiktok",
    durationSeconds: 25,
    topic: "Психология",
    publishHour: 20,
  });

  assert.ok(forecast);
  assert.ok(forecast.baseline > 0);
  assert.ok(forecast.high > forecast.low);
  assert.ok(forecast.reasons.some((reason) => reason.includes("Тема")));
});

test("merge updates records with the same platform and id", () => {
  const [record] = createAnalyticsDemoRecords(new Date("2026-06-20T12:00:00.000Z"));
  const merged = mergeAnalyticsRecords([record], [{ ...record, views: record.views + 100 }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].views, record.views + 100);
});
