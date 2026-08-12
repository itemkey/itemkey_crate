import "server-only";

import { getCategoryStore } from "@/lib/category-store";
import { getProjectStore } from "@/lib/project-store";
import type { RequestUser } from "@/lib/request-user";
import type {
  CategoryDetailPayload,
  CategorySummaryRow,
  WorkspaceShellData,
} from "@/lib/types";

function getInitialSummaryId(categories: CategorySummaryRow[]): string | null {
  const roots = categories
    .filter((category) => category.parent_id === null)
    .sort((a, b) =>
      a.position === b.position
        ? a.created_at.localeCompare(b.created_at)
        : a.position - b.position
    );
  return (
    roots.find((category) => category.title.trim().toLowerCase() === "main")
      ?.id ??
    roots[0]?.id ??
    categories[0]?.id ??
    null
  );
}

export async function loadWorkspaceShell(
  user: RequestUser
): Promise<WorkspaceShellData> {
  const startedAt = Date.now();
  const categoryStore = await getCategoryStore(user.id);
  const projectStore = await getProjectStore(user.id);
  const [categories, projects] = await Promise.all([
    categoryStore.listSummaries(),
    projectStore.list(),
  ]);

  console.info(
    `[workspace/shell] data=${Date.now() - startedAt}ms categories=${categories.length} projects=${projects.length}`
  );

  return {
    authUser: {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
    },
    account: {
      appUserId: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      userId: user.userId,
      userIdChangedAt: user.userIdChangedAt,
      nickname: user.nickname,
      profileDescription: user.profileDescription,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
    },
    categories,
    projects,
    initialCategoryId: getInitialSummaryId(categories),
    source: "postgres",
  };
}

export async function loadCategoryDetail(
  userId: string,
  categoryId: string
): Promise<CategoryDetailPayload> {
  const startedAt = Date.now();
  const store = await getCategoryStore(userId);
  const detail = await store.getDetail(categoryId);
  console.info(
    `[workspace/detail] total=${Date.now() - startedAt}ms messages=${detail.messages.length}`
  );
  return detail;
}
