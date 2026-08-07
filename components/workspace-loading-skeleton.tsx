export default function WorkspaceLoadingSkeleton() {
  return (
    <main
      className="workspace-root workspace-loading-shell flex w-full items-stretch p-0"
      aria-busy="true"
      aria-label="Рабочая область загружается"
    >
      <div className="frame-shell relative flex h-full w-full flex-col overflow-hidden">
        <header className="top-strip bevel-panel workspace-loading-header flex h-[4.7rem] flex-none items-center gap-3 px-3 py-2">
          <span className="workspace-loading-title" aria-hidden="true" />
          <span className="workspace-loading-button" aria-hidden="true" />
          <span className="workspace-loading-button" aria-hidden="true" />
        </header>
        <div className="content-bay flex min-h-0 flex-1">
          <aside className="sidebar-rail workspace-loading-sidebar flex flex-col p-0" aria-hidden="true">
            {Array.from({ length: 7 }).map((_, index) => (
              <span key={index} className="workspace-loading-sidebar-row" />
            ))}
          </aside>
          <section className="workspace-screen workspace-loading-screen" aria-hidden="true">
            <div className="workspace-loading-toolbar" />
            <div className="workspace-loading-document">
              <span />
              <span />
              <span />
              <span />
            </div>
          </section>
          <aside className="settings-panel workspace-loading-settings" aria-hidden="true" />
        </div>
      </div>
    </main>
  );
}
