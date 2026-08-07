"use client";

import dynamic from "next/dynamic";

import WorkspaceLoadingSkeleton from "@/components/workspace-loading-skeleton";
import type { CategoryDetailPayload, WorkspaceShellData } from "@/lib/types";

export type InitialCategoryDetailResult = {
  data: CategoryDetailPayload | null;
  error: string | null;
};

type CrateWorkspaceProps = {
  initialShellData: WorkspaceShellData | null;
  initialDetailPromise: Promise<InitialCategoryDetailResult> | null;
};

const CategoryWorkspace = dynamic(() => import("@/components/category-workspace"), {
  ssr: false,
  loading: () => <WorkspaceLoadingSkeleton />,
});

export default function CrateWorkspace({
  initialShellData,
  initialDetailPromise,
}: CrateWorkspaceProps) {
  return (
    <CategoryWorkspace
      initialShellData={initialShellData}
      initialDetailPromise={initialDetailPromise}
    />
  );
}
