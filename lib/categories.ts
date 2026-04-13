import type { CategoryRow } from "@/lib/types";

type TreeLink = Pick<CategoryRow, "id" | "parent_id">;

export function sortByPosition(a: CategoryRow, b: CategoryRow): number {
  if (a.position === b.position) {
    return a.created_at.localeCompare(b.created_at);
  }

  return a.position - b.position;
}

export function getChildren(
  categories: CategoryRow[],
  parentId: string | null
): CategoryRow[] {
  return categories
    .filter((node) => node.parent_id === parentId)
    .sort(sortByPosition);
}

export function getInitialCategoryId(categories: CategoryRow[]): string | null {
  const roots = getChildren(categories, null);
  if (roots.length === 0) {
    return null;
  }

  const explicitMain = roots.find(
    (root) => root.title.trim().toLowerCase() === "main"
  );

  return explicitMain?.id ?? roots[0].id;
}

export function buildCategoryPath(
  categories: CategoryRow[],
  categoryId: string
): CategoryRow[] {
  const byId = new Map(categories.map((node) => [node.id, node]));
  const path: CategoryRow[] = [];

  let cursor = byId.get(categoryId);
  while (cursor) {
    path.unshift(cursor);
    if (!cursor.parent_id) {
      break;
    }
    cursor = byId.get(cursor.parent_id);
  }

  return path;
}

export function collectDescendantIds(nodes: TreeLink[], rootId: string): string[] {
  const descendants: string[] = [];
  const queue = [rootId];

  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent) {
      continue;
    }

    for (const node of nodes) {
      if (node.parent_id === parent) {
        descendants.push(node.id);
        queue.push(node.id);
      }
    }
  }

  return descendants;
}

export function createDefaultTitle(childrenCount: number): string {
  return `new ${childrenCount + 1}`;
}
