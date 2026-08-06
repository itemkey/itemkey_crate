import type {
  CategoryDetailPayload,
  CategoryRow,
  CategorySummaryRow,
} from "./types.ts";

export type WorkspaceTreeNode = CategorySummaryRow & {
  children: WorkspaceTreeNode[];
};

export function toCategorySummary(category: CategoryRow): CategorySummaryRow {
  const summary = { ...category } as Partial<CategoryRow>;
  delete summary.content;
  return summary as CategorySummaryRow;
}

export function buildWorkspaceTree(
  categories: CategorySummaryRow[]
): WorkspaceTreeNode[] {
  const childrenByParent = new Map<string | null, CategorySummaryRow[]>();
  const ids = new Set(categories.map((category) => category.id));

  for (const category of categories) {
    const parentId = category.parent_id && ids.has(category.parent_id)
      ? category.parent_id
      : null;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(category);
    childrenByParent.set(parentId, children);
  }

  const visit = (parentId: string | null): WorkspaceTreeNode[] =>
    [...(childrenByParent.get(parentId) ?? [])]
      .sort((a, b) =>
        a.position === b.position
          ? a.created_at.localeCompare(b.created_at)
          : a.position - b.position
      )
      .map((category) => ({
        ...category,
        children: visit(category.id),
      }));

  return visit(null);
}

export function mergeWorkspaceSummaries(
  remote: CategorySummaryRow[],
  localDetails: Readonly<Record<string, CategoryDetailPayload>>,
  unsynchronizedDraftIds: ReadonlySet<string>
): {
  summaries: CategorySummaryRow[];
  details: Record<string, CategoryDetailPayload>;
} {
  const remoteIds = new Set(remote.map((category) => category.id));
  const details: Record<string, CategoryDetailPayload> = {};

  for (const [categoryId, detail] of Object.entries(localDetails)) {
    if (!remoteIds.has(categoryId)) continue;
    if (
      unsynchronizedDraftIds.has(categoryId) ||
      remote.find((category) => category.id === categoryId)?.updated_at ===
        detail.category.updated_at
    ) {
      details[categoryId] = detail;
    }
  }

  return { summaries: remote, details };
}

export class LatestRequestController {
  private current: AbortController | null = null;

  start(): AbortController {
    this.current?.abort();
    this.current = new AbortController();
    return this.current;
  }

  isCurrent(controller: AbortController): boolean {
    return this.current === controller && !controller.signal.aborted;
  }

  cancel(): void {
    this.current?.abort();
    this.current = null;
  }
}
