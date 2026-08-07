import styles from "./content-analytics.module.css";

const TABS = [
  ["01", "Обзор"],
  ["02", "Контент"],
  ["03", "Прогноз"],
  ["04", "Источники"],
] as const;

export default function ContentAnalyticsLoading() {
  return (
    <div
      className={styles.shell}
      role="dialog"
      aria-modal="true"
      aria-label="Аналитика контента"
      aria-busy="true"
    >
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
          {TABS.map(([number, label], index) => (
            <button
              key={number}
              type="button"
              className={index === 0 ? styles.activeTab : ""}
              disabled
            >
              <small>{number}</small>
              {label}
            </button>
          ))}
        </nav>

        <div className={styles.headerActions}>
          <button type="button" className={styles.importButton} disabled>
            + данные
          </button>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Аналитика открывается"
            disabled
          >
            ×
          </button>
        </div>
      </header>

      <main className={styles.main} aria-hidden="true">
        <div className={styles.contextBar}>
          <div className={styles.loadingHeading} />
          <div className={styles.loadingFilters}>
            <span />
            <span />
          </div>
        </div>

        <div className={`${styles.view} ${styles.loadingView}`}>
          <section className={styles.loadingHero}>
            <div>
              <span />
              <span />
              <span />
            </div>
            <i />
          </section>
          <section className={styles.loadingMetrics}>
            <span />
            <span />
            <span />
            <span />
          </section>
        </div>
      </main>
    </div>
  );
}
