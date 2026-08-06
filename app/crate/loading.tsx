export default function CrateLoading() {
  return (
    <main className="workspace-root flex w-full items-stretch p-0" aria-busy="true">
      <div className="frame-shell relative flex h-full w-full flex-col overflow-hidden">
        <header className="top-strip bevel-panel h-[4.7rem] flex-none animate-pulse" />
        <div className="workspace-grid min-h-0 flex-1">
          <aside className="project-panel bevel-panel animate-pulse" />
          <aside className="category-panel bevel-panel animate-pulse" />
          <section className="workspace-screen flex items-center justify-center p-6">
            <p className="text-sm text-[#202020]">Подготавливаю рабочую область...</p>
          </section>
        </div>
      </div>
    </main>
  );
}
