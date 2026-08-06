import Link from "next/link";
import styles from "./home.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span aria-hidden="true">IK</span>
          <strong>ItemKey</strong>
        </div>
        <p>Личное пространство для идей и материалов</p>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Всё важное — под рукой</p>
        <h1>Работайте с идеями,<br />а не с интерфейсом.</h1>
        <p className={styles.lead}>
          Собирайте проекты, заметки и полезные материалы в понятной структуре.
          Выберите, с чего хотите начать.
        </p>
      </section>

      <nav className={styles.products} aria-label="Приложения ItemKey">
        <Link href="/crate" className={`${styles.productCard} ${styles.productCardPrimary}`}>
          <span className={styles.productNumber}>01</span>
          <div>
            <p className={styles.productKicker}>Основное пространство</p>
            <h2>База знаний</h2>
            <p>Проекты, разделы и заметки в одном месте.</p>
          </div>
          <span className={styles.productAction}>Открыть базу <b aria-hidden="true">→</b></span>
        </Link>

        <Link href="/media-converter" className={styles.productCard}>
          <span className={styles.productNumber}>02</span>
          <div>
            <p className={styles.productKicker}>Полезный инструмент</p>
            <h2>Медиа-конвертер</h2>
            <p>Подготовка аудио и видео в нужном формате.</p>
          </div>
          <span className={styles.productAction}>Открыть конвертер <b aria-hidden="true">→</b></span>
        </Link>
      </nav>

      <footer className={styles.footer}>
        <span>ItemKey</span>
        <span>Порядок для творческой работы</span>
      </footer>
    </main>
  );
}
