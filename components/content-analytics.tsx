"use client";

import { type ChangeEvent, useMemo, useRef, useState } from "react";

import {
  buildAnalyticsRecommendations,
  createAnalyticsDemoRecords,
  filterAnalyticsRecords,
  forecastAnalyticsOutcome,
  getDurationPatterns,
  getEngagementRate,
  getPublishTimePatterns,
  getTopicPatterns,
  mergeAnalyticsRecords,
  parseAnalyticsImport,
  summarizeAnalytics,
  type AnalyticsFilter,
  type AnalyticsForecastInput,
  type AnalyticsPattern,
  type AnalyticsPlatform,
  type ContentAnalyticsRecord,
} from "@/lib/content-analytics";

import styles from "./content-analytics.module.css";

type AnalyticsTab = "overview" | "content" | "forecast" | "sources";

type ContentAnalyticsProps = {
  onClose(): void;
};

const STORAGE_KEY = "item-key-content-analytics-v1";

const TAB_LABELS: Array<{ id: AnalyticsTab; label: string; short: string }> = [
  { id: "overview", label: "Обзор", short: "01" },
  { id: "content", label: "Контент", short: "02" },
  { id: "forecast", label: "Прогноз", short: "03" },
  { id: "sources", label: "Источники", short: "04" },
];

function loadStoredRecords(): ContentAnalyticsRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    return parseAnalyticsImport(value, "stored.json").records;
  } catch {
    return [];
  }
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(Math.round(value));
}

function formatFull(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "2-digit" }).format(
    new Date(value)
  );
}

function platformLabel(platform: AnalyticsPlatform): string {
  return platform === "youtube" ? "YouTube" : "TikTok";
}

function confidenceLabel(value: "low" | "medium" | "high"): string {
  if (value === "high") return "высокая";
  if (value === "medium") return "средняя";
  return "низкая";
}

function formatSampleSize(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return `${value} похожих роликов`;
  const last = value % 10;
  if (last === 1) return `${value} похожий ролик`;
  if (last >= 2 && last <= 4) return `${value} похожих ролика`;
  return `${value} похожих роликов`;
}

function saveRecords(records: ContentAnalyticsRecord[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ videos: records }));
}

function downloadJson(records: ContentAnalyticsRecord[]): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ videos: records }, null, 2)], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "item-key-analytics.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function EmptyState({ onImport, onDemo }: { onImport(): void; onDemo(): void }) {
  return (
    <section className={styles.emptyState}>
      <div className={styles.emptyMark} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className={styles.eyebrow}>Пока без данных</p>
      <h2>Загрузите историю роликов — дальше цифры превратятся в решения.</h2>
      <p>
        Аналитика принимает CSV или JSON, сравнивает YouTube и TikTok по их собственным
        метрикам и сохраняет данные только в этом браузере.
      </p>
      <div className={styles.emptyActions}>
        <button type="button" className={styles.primaryButton} onClick={onImport}>
          Импортировать данные
        </button>
        <button type="button" className={styles.ghostButton} onClick={onDemo}>
          Открыть демо-набор
        </button>
      </div>
    </section>
  );
}

function PatternChart({ title, caption, patterns }: { title: string; caption: string; patterns: AnalyticsPattern[] }) {
  const visible = patterns.slice(0, 5);
  const maximum = Math.max(1, ...visible.map((pattern) => pattern.averageViews));
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <p className={styles.eyebrow}>{caption}</p>
          <h3>{title}</h3>
        </div>
        <span className={styles.panelCount}>{visible.length}</span>
      </div>
      <div className={styles.patternList}>
        {visible.map((pattern, index) => (
          <div className={styles.patternRow} key={pattern.key}>
            <div className={styles.patternMeta}>
              <span className={styles.patternIndex}>{String(index + 1).padStart(2, "0")}</span>
              <strong>{pattern.label}</strong>
              <small>{pattern.videoCount} рол.</small>
            </div>
            <div className={styles.patternTrack} aria-hidden="true">
              <span style={{ width: `${Math.max(6, (pattern.averageViews / maximum) * 100)}%` }} />
            </div>
            <span className={styles.patternValue}>{formatCompact(pattern.averageViews)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlatformBadge({ platform }: { platform: AnalyticsPlatform }) {
  return (
    <span className={`${styles.platformBadge} ${styles[platform]}`}>
      <span aria-hidden="true">{platform === "youtube" ? "▶" : "♪"}</span>
      {platformLabel(platform)}
    </span>
  );
}

export default function ContentAnalytics({ onClose }: ContentAnalyticsProps) {
  const [tab, setTab] = useState<AnalyticsTab>("overview");
  const [records, setRecords] = useState<ContentAnalyticsRecord[]>(loadStoredRecords);
  const [filter, setFilter] = useState<AnalyticsFilter>({ platform: "all", periodDays: 90 });
  const [notice, setNotice] = useState<string | null>(null);
  const [forecastInput, setForecastInput] = useState<AnalyticsForecastInput>({
    platform: "youtube",
    durationSeconds: 30,
    topic: "",
    publishHour: 19,
  });
  const importInputRef = useRef<HTMLInputElement>(null);

  const filteredRecords = useMemo(
    () => filterAnalyticsRecords(records, filter),
    [filter, records]
  );
  const summary = useMemo(() => summarizeAnalytics(filteredRecords), [filteredRecords]);
  const topicPatterns = useMemo(() => getTopicPatterns(filteredRecords), [filteredRecords]);
  const durationPatterns = useMemo(() => getDurationPatterns(filteredRecords), [filteredRecords]);
  const timePatterns = useMemo(() => getPublishTimePatterns(filteredRecords), [filteredRecords]);
  const recommendations = useMemo(
    () => buildAnalyticsRecommendations(filteredRecords),
    [filteredRecords]
  );
  const forecast = useMemo(
    () => forecastAnalyticsOutcome(records, forecastInput),
    [forecastInput, records]
  );
  const topics = useMemo(
    () => [...new Set(records.map((record) => record.topic))].sort((left, right) => left.localeCompare(right, "ru")),
    [records]
  );
  const youtubeCount = records.filter((record) => record.platform === "youtube").length;
  const tiktokCount = records.length - youtubeCount;

  function updateRecords(nextRecords: ContentAnalyticsRecord[]): void {
    setRecords(nextRecords);
    saveRecords(nextRecords);
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = parseAnalyticsImport(await file.text(), file.name);
    if (result.records.length === 0) {
      setNotice(result.warnings[0] ?? "В файле нет подходящих данных.");
      return;
    }
    const nextRecords = mergeAnalyticsRecords(records, result.records);
    updateRecords(nextRecords);
    setNotice(
      `Импортировано: ${result.records.length}. ${
        result.warnings.length > 0 ? `Пропущено: ${result.warnings.length}.` : "Все строки прочитаны."
      }`
    );
    setTab("overview");
  }

  function handleLoadDemo(): void {
    const nextRecords = mergeAnalyticsRecords(records, createAnalyticsDemoRecords());
    updateRecords(nextRecords);
    setNotice("Демо-набор добавлен. Он помечен отдельными demo-id и его можно удалить вместе со всеми данными.");
  }

  function handleClear(): void {
    if (!window.confirm("Удалить все локальные данные Аналитики из этого браузера?")) return;
    updateRecords([]);
    setNotice("Локальные данные удалены.");
  }

  function handleClose(): void {
    onClose();
  }

  const maxVideoViews = Math.max(1, ...filteredRecords.map((record) => record.views));

  return (
    <div className={styles.shell} role="dialog" aria-modal="true" aria-label="Аналитика контента">
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <strong>Аналитика</strong>
            <span>content decision desk</span>
          </div>
        </div>

        <nav className={styles.tabs} aria-label="Разделы аналитики">
          {TAB_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? styles.activeTab : ""}
              onClick={() => setTab(item.id)}
            >
              <small>{item.short}</small>
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.headerActions}>
          <button type="button" className={styles.importButton} onClick={() => importInputRef.current?.click()}>
            + данные
          </button>
          <button type="button" className={styles.closeButton} onClick={handleClose} aria-label="Закрыть Аналитику">
            ×
          </button>
        </div>
      </header>

      <input
        ref={importInputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        hidden
        onChange={(event) => void handleImport(event)}
      />

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Закрыть сообщение">×</button>
        </div>
      )}

      <main className={styles.main}>
        {tab !== "sources" && (
          <div className={styles.contextBar}>
            <div>
              <p className={styles.eyebrow}>Рабочая выборка</p>
              <strong>{filteredRecords.length} из {records.length} роликов</strong>
            </div>
            <div className={styles.filters}>
              <label>
                <span>Платформа</span>
                <select
                  value={filter.platform}
                  onChange={(event) => setFilter((current) => ({ ...current, platform: event.target.value as AnalyticsFilter["platform"] }))}
                >
                  <option value="all">Все платформы</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </label>
              <label>
                <span>Период</span>
                <select
                  value={filter.periodDays}
                  onChange={(event) => setFilter((current) => ({
                    ...current,
                    periodDays: event.target.value === "all" ? "all" : Number(event.target.value),
                  }))}
                >
                  <option value={30}>30 дней</option>
                  <option value={90}>90 дней</option>
                  <option value={365}>Год</option>
                  <option value="all">Всё время</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {records.length === 0 && tab !== "sources" ? (
          <EmptyState onImport={() => importInputRef.current?.click()} onDemo={handleLoadDemo} />
        ) : filteredRecords.length === 0 && tab !== "sources" ? (
          <section className={styles.noResults}>
            <p className={styles.eyebrow}>Пустая выборка</p>
            <h2>Для этих фильтров роликов не найдено.</h2>
            <button type="button" className={styles.ghostButton} onClick={() => setFilter({ platform: "all", periodDays: "all" })}>
              Показать все данные
            </button>
          </section>
        ) : tab === "overview" ? (
          <div className={styles.view}>
            <section className={styles.hero}>
              <div className={styles.heroCopy}>
                <p className={styles.eyebrow}>Что сейчас работает</p>
                <h1>
                  {topicPatterns[0]
                    ? <>Тема <em>«{topicPatterns[0].label}»</em> ведёт выборку.</>
                    : "Данных достаточно для первого разбора."}
                </h1>
                <p>
                  {summary.topVideo
                    ? `Лучший результат — «${summary.topVideo.title}»: ${formatFull(summary.topVideo.views)} просмотров.`
                    : "Добавьте ролики, чтобы увидеть главный сигнал."}
                </p>
              </div>
              <div className={styles.heroSignal}>
                <span>Средний результат</span>
                <strong>{formatCompact(summary.averageViews)}</strong>
                <small>просмотров на ролик</small>
              </div>
            </section>

            <section className={styles.metrics} aria-label="Ключевые метрики">
              <article><span>Ролики</span><strong>{summary.videoCount}</strong><small>в выборке</small></article>
              <article><span>Просмотры</span><strong>{formatCompact(summary.totalViews)}</strong><small>суммарно</small></article>
              <article><span>Реакция</span><strong>{summary.engagementRate.toFixed(1)}%</strong><small>лайки + комм. + репосты</small></article>
              <article><span>Удержание</span><strong>{summary.averageViewPercentage === null ? "—" : `${summary.averageViewPercentage.toFixed(0)}%`}</strong><small>YouTube / где доступно</small></article>
            </section>

            <div className={styles.twoColumns}>
              <PatternChart title="Темы-победители" caption="Средние просмотры" patterns={topicPatterns} />
              <PatternChart title="Рабочая длина" caption="Формат ролика" patterns={durationPatterns} />
            </div>

            <section className={styles.recommendationSection}>
              <div className={styles.sectionTitle}>
                <div><p className={styles.eyebrow}>Следующее решение</p><h2>Не больше трёх действий</h2></div>
                <span>объяснимо · по истории аккаунта</span>
              </div>
              <div className={styles.recommendationGrid}>
                {recommendations.map((item, index) => (
                  <article key={`${item.kind}-${item.title}`} className={styles.recommendationCard}>
                    <div><span>{String(index + 1).padStart(2, "0")}</span><small>{item.kind === "repeat" ? "повторить" : item.kind === "change" ? "изменить" : "протестировать"}</small></div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </article>
                ))}
              </div>
            </section>

            <PatternChart title="Когда публиковать" caption="Время выхода" patterns={timePatterns} />
          </div>
        ) : tab === "content" ? (
          <div className={styles.view}>
            <section className={styles.sectionTitle}>
              <div><p className={styles.eyebrow}>Единый каталог</p><h1>Ролики и сигналы</h1></div>
              <span>platform-native метрики не смешиваются без подписи</span>
            </section>
            <div className={styles.contentTableWrap}>
              <table className={styles.contentTable}>
                <thead>
                  <tr><th>Контент</th><th>Публикация</th><th>Длина</th><th>Просмотры</th><th>Реакция</th><th>Сигнал</th></tr>
                </thead>
                <tbody>
                  {[...filteredRecords].sort((left, right) => right.views - left.views).map((record) => (
                    <tr key={`${record.platform}-${record.id}`}>
                      <td>
                        <PlatformBadge platform={record.platform} />
                        <strong>{record.title}</strong>
                        <small>{record.topic} · {record.hook}</small>
                      </td>
                      <td>{formatDate(record.publishedAt)}</td>
                      <td>{record.durationSeconds} сек</td>
                      <td>
                        <strong>{formatCompact(record.views)}</strong>
                        <span className={styles.inlineBar}><i style={{ width: `${(record.views / maxVideoViews) * 100}%` }} /></span>
                      </td>
                      <td>{getEngagementRate(record).toFixed(1)}%</td>
                      <td>
                        {record.averageViewPercentage === null
                          ? "рост + реакции"
                          : `удержание ${record.averageViewPercentage.toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : tab === "forecast" ? (
          <div className={`${styles.view} ${styles.forecastView}`}>
            <section className={styles.sectionTitle}>
              <div><p className={styles.eyebrow}>Сценарий следующего ролика</p><h1>Прогноз без чёрного ящика</h1></div>
              <span>медиана похожих публикаций · не гарантия результата</span>
            </section>
            <div className={styles.forecastGrid}>
              <form className={styles.forecastForm} onSubmit={(event) => event.preventDefault()}>
                <label><span>Платформа</span><select value={forecastInput.platform} onChange={(event) => setForecastInput((current) => ({ ...current, platform: event.target.value as AnalyticsPlatform }))}><option value="youtube">YouTube</option><option value="tiktok">TikTok</option></select></label>
                <label><span>Тема</span><input list="analytics-topic-options" value={forecastInput.topic} onChange={(event) => setForecastInput((current) => ({ ...current, topic: event.target.value }))} placeholder="Например, Психология" /></label>
                <datalist id="analytics-topic-options">{topics.map((topic) => <option key={topic} value={topic} />)}</datalist>
                <div className={styles.formPair}>
                  <label><span>Длина, секунд</span><input type="number" min={1} max={7200} value={forecastInput.durationSeconds} onChange={(event) => setForecastInput((current) => ({ ...current, durationSeconds: Math.max(1, Number(event.target.value)) }))} /></label>
                  <label><span>Час публикации</span><input type="number" min={0} max={23} value={forecastInput.publishHour} onChange={(event) => setForecastInput((current) => ({ ...current, publishHour: Math.min(23, Math.max(0, Number(event.target.value))) }))} /></label>
                </div>
                <p>Расчёт ищет публикации той же платформы, темы, диапазона длины и близкого времени выхода.</p>
              </form>

              <section className={styles.forecastResult}>
                {forecast ? (
                  <>
                    <div className={styles.forecastTopline}><span>Ожидаемый ориентир</span><small>уверенность: {confidenceLabel(forecast.confidence)}</small></div>
                    <strong className={styles.forecastNumber}>{formatCompact(forecast.baseline)}</strong>
                    <span className={styles.forecastRange}>{formatFull(forecast.low)} — {formatFull(forecast.high)} просмотров</span>
                    <div className={styles.forecastScale}><i /><span style={{ left: "50%" }} /></div>
                    <div className={styles.forecastReasons}>
                      <p className={styles.eyebrow}>Почему такой прогноз</p>
                      {forecast.reasons.map((reason) => <p key={reason}>{reason}</p>)}
                      <small>Выборка: {formatSampleSize(forecast.sampleSize)}</small>
                    </div>
                  </>
                ) : (
                  <div className={styles.forecastEmpty}><p className={styles.eyebrow}>Нужна история</p><h3>По этой платформе ещё нет данных.</h3><button type="button" className={styles.ghostButton} onClick={() => importInputRef.current?.click()}>Импортировать</button></div>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className={styles.view}>
            <section className={styles.sectionTitle}>
              <div><p className={styles.eyebrow}>Owned analytics first</p><h1>Источники и данные</h1></div>
              <span>ключи и токены не хранятся в браузере</span>
            </section>
            <div className={styles.sourceGrid}>
              <article className={styles.sourceCard}>
                <div className={styles.sourceLogo}>YT</div><PlatformBadge platform="youtube" />
                <h2>YouTube</h2>
                <p>Метаданные, просмотры, engaged views, удержание и влияние на подписки — когда поля есть в импорте.</p>
                <div><strong>{youtubeCount}</strong><span>роликов загружено</span></div>
                <button type="button" className={styles.primaryButton} onClick={() => importInputRef.current?.click()}>Импорт CSV / JSON</button>
              </article>
              <article className={styles.sourceCard}>
                <div className={styles.sourceLogo}>TT</div><PlatformBadge platform="tiktok" />
                <h2>TikTok</h2>
                <p>Базовые counters, скорость роста и вовлечение. Недоступное через внешний API удержание не подменяется догадками.</p>
                <div><strong>{tiktokCount}</strong><span>роликов загружено</span></div>
                <button type="button" className={styles.primaryButton} onClick={() => importInputRef.current?.click()}>Импорт CSV / JSON</button>
              </article>
              <aside className={styles.schemaCard}>
                <p className={styles.eyebrow}>Формат импорта</p>
                <h3>Минимум три поля</h3>
                <code>platform, title, published_at</code>
                <p>Для анализа добавьте: duration_seconds, views, likes, comments, shares, topic, hook.</p>
                <p>YouTube дополнительно: engaged_views, average_view_percentage, subscribers_gained.</p>
              </aside>
            </div>
            <section className={styles.dataActions}>
              <div><p className={styles.eyebrow}>Локальное хранилище</p><h3>{records.length} роликов в этом браузере</h3><p>OAuth-синхронизация — отдельный серверный этап: для неё нужны API-ключи, consent и политика хранения.</p></div>
              <div><button type="button" className={styles.ghostButton} onClick={() => downloadJson(records)} disabled={records.length === 0}>Экспорт JSON</button><button type="button" className={styles.dangerButton} onClick={handleClear} disabled={records.length === 0}>Удалить данные</button></div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
