"use client";

export default function CrateError({ reset }: { reset: () => void }) {
  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d w-full max-w-xl p-5">
          <h1 className="font-display text-5xl leading-none">Item Key</h1>
          <p className="mt-3 text-sm text-[#202020]">
            Рабочая область сейчас недоступна. Проверь подключение и попробуй ещё раз.
          </p>
          <button type="button" className="mini-action mt-4" onClick={reset}>
            повторить
          </button>
        </div>
      </div>
    </main>
  );
}
