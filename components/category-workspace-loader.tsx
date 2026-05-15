"use client";

import dynamic from "next/dynamic";

const CategoryWorkspace = dynamic(() => import("./category-workspace"), {
  ssr: false,
  loading: () => (
    <div className="workspace-loading-shell" aria-busy="true">
      <div className="workspace-loading-panel">Loading...</div>
    </div>
  ),
});

export default function CategoryWorkspaceLoader() {
  return <CategoryWorkspace />;
}
