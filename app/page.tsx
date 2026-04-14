import Link from "next/link";

export default function Home() {
  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell entry-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d entry-panel w-full max-w-xl p-6">
          <h1 className="font-display entry-title text-center leading-none">
            IK_Creativity
          </h1>

          <div className="entry-actions mt-6">
            <Link
              href="/crate"
              className="mini-action entry-button inline-flex items-center justify-center"
            >
              crate
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
