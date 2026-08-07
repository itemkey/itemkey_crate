export default function CrateLoading() {
  return (
    <main
      className="workspace-root flex w-full items-stretch p-0"
      aria-busy="true"
    >
      <div className="frame-shell h-full w-full" aria-hidden="true" />
    </main>
  );
}
