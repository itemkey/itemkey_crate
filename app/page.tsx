"use client";

import Link from "next/link";

import { useI18n } from "@/components/i18n-provider";
import LocaleSwitcher from "@/components/locale-switcher";

export default function Home() {
  const { t } = useI18n();

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell entry-shell relative flex h-full w-full items-center justify-center p-4">
        <div className="popup-3d entry-panel w-full max-w-xl p-6">
          <div className="entry-locale-corner">
            <LocaleSwitcher compact />
          </div>
          <h1 className="font-display entry-title text-center leading-none">
            {t("entry.title")}
          </h1>

          <div className="entry-actions mt-6 flex-col items-center gap-3">
            <Link
              href="/crate"
              className="mini-action entry-button inline-flex items-center justify-center"
            >
              {t("entry.crate")}
            </Link>

            <Link
              href="/planner"
              className="mini-action entry-button inline-flex items-center justify-center"
            >
              {t("entry.planner")}
            </Link>

            <Link
              href="/media-converter"
              className="mini-action entry-button inline-flex items-center justify-center"
            >
              {t("entry.mediaConverter")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
