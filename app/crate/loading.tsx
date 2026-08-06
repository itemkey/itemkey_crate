import styles from "@/components/crate-workspace.module.css";

export default function CrateLoading() {
  return (
    <main className={styles.workspaceRoot} aria-busy="true">
      <div className={styles.appShell}>
        <header className={styles.appHeader}>
          <div className={styles.brandLockup}>
            <span className={styles.brandMark} aria-hidden="true">IK</span>
            <span>ItemKey</span>
          </div>
        </header>
        <div className={styles.workspaceLayout}>
          <aside className={styles.sidebar} />
          <section className={styles.editorPane}>
            <div className={styles.contentHeader} />
            <div className={styles.editorScroll}>
              <div className={styles.stateCard} role="status">
                <span className={styles.stateIcon} aria-hidden="true">…</span>
                <h2>Готовим рабочее пространство</h2>
                <p>Загружаем ваши разделы и последние материалы.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
