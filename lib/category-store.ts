import "server-only";

import { randomUUID } from "node:crypto";

import type {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from "pg";

import { getPostgresPool } from "@/lib/db/postgres";
import { toErrorMessage } from "@/lib/errors";
import type { CategoryTreeDocument } from "@/lib/category-transfer";
import type {
  CategoryAccessRole,
  CategoryDetailPayload,
  CategoryFormat,
  CategoryRow,
  CategorySummaryRow,
  CategoryType,
  MessageRow,
  MessageType,
} from "@/lib/types";
import { collectDescendantIds } from "@/lib/categories";

const CATEGORY_COLUMNS =
  "id,workspace_id,parent_id,title,content,description,tag,format,category_type,position,created_at,updated_at";
const CATEGORY_SUMMARY_COLUMNS =
  "id,workspace_id,parent_id,title,description,tag,format,category_type,position,created_at,updated_at";
const MESSAGE_COLUMNS =
  "id,workspace_id,category_id,title,content,position,message_type,created_at,updated_at";

const WORKSPACE_SLUG =
  process.env.WORKSPACE_SLUG ?? process.env.NEXT_PUBLIC_WORKSPACE_SLUG ?? "main";
const MAIN_CATEGORY_TITLE = "main";
const DEFAULT_MESSAGE_TITLE = "Новый блок";

type CategoryPatch = {
  title?: string;
  content?: string;
  description?: string;
  tag?: string;
  format?: CategoryFormat;
  category_type?: CategoryType;
  parent_id?: string | null;
  position?: number;
};

type CategoryCreate = {
  parentId: string | null;
  title: string;
};

type MessageCreate = {
  categoryId: string;
  title?: string;
  content?: string;
  messageType?: MessageType;
};

type MessagePatch = {
  title?: string;
  content?: string;
  message_type?: MessageType;
  position?: number;
};

export type CategoryStore = {
  source: "postgres";
  list(): Promise<CategoryRow[]>;
  listSummaries(): Promise<CategorySummaryRow[]>;
  getDetail(id: string): Promise<CategoryDetailPayload>;
  create(input: CategoryCreate): Promise<CategoryRow>;
  update(id: string, patch: CategoryPatch): Promise<CategoryRow>;
  remove(id: string): Promise<void>;
  restoreTree(document: CategoryTreeDocument): Promise<{
    categories: CategoryRow[];
    messages: MessageRow[];
  }>;
  importTreeAsChild(
    document: CategoryTreeDocument,
    parentId: string | null
  ): Promise<{
    categories: CategoryRow[];
    messages: MessageRow[];
  }>;
  listMessages(categoryId: string): Promise<MessageRow[]>;
  listMessagesForCategories(
    categories: Pick<CategoryRow, "id" | "workspace_id">[]
  ): Promise<Record<string, MessageRow[]>>;
  createMessage(input: MessageCreate): Promise<MessageRow>;
  updateMessage(id: string, patch: MessagePatch): Promise<MessageRow>;
  removeMessage(id: string): Promise<void>;
  reorderMessages(categoryId: string, orderedIds: string[]): Promise<MessageRow[]>;
};

type SqlExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};

type PublicRootRecord = {
  id: string;
  owner_user_id: string;
  workspace_id: string;
  root_category_id: string;
  role?: "viewer" | "editor";
  mount_parent_category_id?: string | null;
};

type CategoryAccess = {
  category: CategoryRow;
  workspaceId: string;
  role: CategoryAccessRole;
  visibility: "local" | "public";
  publicRootRecordId: string | null;
  publicRootCategoryId: string | null;
  publicOwnerUserId: string | null;
  isPublicRoot: boolean;
};

type MessageAccess = {
  message: MessageRow;
  categoryAccess: CategoryAccess;
};

function hasMainRootCategory(
  categories: Array<Pick<CategoryRow, "parent_id" | "title">>
): boolean {
  return categories.some(
    (node) =>
      node.parent_id === null &&
      node.title.trim().toLowerCase() === MAIN_CATEGORY_TITLE
  );
}

function buildMainRootRow(workspaceId: string, position: number): CategoryRow {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    workspace_id: workspaceId,
    parent_id: null,
    title: MAIN_CATEGORY_TITLE,
    content: "",
    description: "",
    tag: "#main",
    format: "continuous",
    category_type: "learning",
    position,
    created_at: now,
    updated_at: now,
  };
}

function normalizeCategory(raw: CategoryRow): CategoryRow {
  return {
    ...raw,
    created_at: normalizeTimestamp(raw.created_at),
    updated_at: normalizeTimestamp(raw.updated_at),
    description: raw.description ?? "",
    tag: raw.tag ?? "",
    format: raw.format ?? "continuous",
    category_type: raw.category_type ?? "learning",
    visibility: raw.visibility ?? "local",
    access_role: raw.access_role ?? "owner",
    public_root_id: raw.public_root_id ?? null,
    public_owner_user_id: raw.public_owner_user_id ?? null,
  };
}

function normalizeCategorySummary(raw: CategorySummaryRow): CategorySummaryRow {
  return {
    ...raw,
    created_at: normalizeTimestamp(raw.created_at),
    updated_at: normalizeTimestamp(raw.updated_at),
    description: raw.description ?? "",
    tag: raw.tag ?? "",
    format: raw.format ?? "continuous",
    category_type: raw.category_type ?? "learning",
    visibility: raw.visibility ?? "local",
    access_role: raw.access_role ?? "owner",
    public_root_id: raw.public_root_id ?? null,
    public_owner_user_id: raw.public_owner_user_id ?? null,
  };
}

function normalizeMessage(raw: MessageRow): MessageRow {
  const normalizedTitle =
    typeof raw.title === "string" && raw.title.trim().length > 0
      ? raw.title.trim()
      : DEFAULT_MESSAGE_TITLE;

  return {
    ...raw,
    created_at: normalizeTimestamp(raw.created_at),
    updated_at: normalizeTimestamp(raw.updated_at),
    title: normalizedTitle,
    message_type: raw.message_type ?? "info",
  };
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return new Date(0).toISOString();
}

function toFinitePosition(value: unknown): number {
  const asNumber =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(asNumber)) {
    return 0;
  }

  return Math.max(0, Math.floor(asNumber));
}

function hasOwnProperty<T extends object>(
  value: T,
  key: PropertyKey
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function makeCategoryUpdateSet(patch: CategoryPatch): {
  setClause: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const assignments: string[] = [];

  const addAssignment = (column: string, value: unknown) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (hasOwnProperty(patch, "title") && typeof patch.title === "string") {
    addAssignment("title", patch.title);
  }
  if (hasOwnProperty(patch, "content") && typeof patch.content === "string") {
    addAssignment("content", patch.content);
  }
  if (
    hasOwnProperty(patch, "description") &&
    typeof patch.description === "string"
  ) {
    addAssignment("description", patch.description);
  }
  if (hasOwnProperty(patch, "tag") && typeof patch.tag === "string") {
    addAssignment("tag", patch.tag);
  }
  if (hasOwnProperty(patch, "format") && typeof patch.format === "string") {
    addAssignment("format", patch.format);
  }
  if (
    hasOwnProperty(patch, "category_type") &&
    typeof patch.category_type === "string"
  ) {
    addAssignment("category_type", patch.category_type);
  }
  if (hasOwnProperty(patch, "parent_id")) {
    addAssignment("parent_id", patch.parent_id ?? null);
  }
  if (hasOwnProperty(patch, "position") && typeof patch.position === "number") {
    addAssignment("position", patch.position);
  }

  if (assignments.length === 0) {
    throw new Error("Nothing to update.");
  }

  return {
    setClause: assignments.join(", "),
    values,
  };
}

function makeMessageUpdateSet(patch: MessagePatch): {
  setClause: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const assignments: string[] = [];

  const addAssignment = (column: string, value: unknown) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (hasOwnProperty(patch, "title") && typeof patch.title === "string") {
    addAssignment("title", patch.title);
  }
  if (hasOwnProperty(patch, "content") && typeof patch.content === "string") {
    addAssignment("content", patch.content);
  }
  if (
    hasOwnProperty(patch, "message_type") &&
    typeof patch.message_type === "string"
  ) {
    addAssignment("message_type", patch.message_type);
  }
  if (hasOwnProperty(patch, "position") && typeof patch.position === "number") {
    addAssignment("position", patch.position);
  }

  if (assignments.length === 0) {
    throw new Error("Nothing to update.");
  }

  return {
    setClause: assignments.join(", "),
    values,
  };
}

async function withPostgresTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureWorkspaceIdForPostgres(
  executor: SqlExecutor,
  ownerUserId: string
): Promise<string> {
  const existing = await executor.query<{ id: string }>(
    `
      select id
      from public.workspaces
      where owner_user_id = $1::uuid and slug = $2::text
      limit 1
    `,
    [ownerUserId, WORKSPACE_SLUG]
  );
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const title = WORKSPACE_SLUG === MAIN_CATEGORY_TITLE ? "Main workspace" : WORKSPACE_SLUG;
  const { rows } = await executor.query<{ id: string }>(
    `
      insert into public.workspaces (owner_user_id, slug, title)
      values ($1::uuid, $2::text, $3::text)
      on conflict (owner_user_id, slug)
      do update set title = public.workspaces.title
      returning id
    `,
    [ownerUserId, WORKSPACE_SLUG, title]
  );

  const workspaceId = rows[0]?.id;
  if (!workspaceId) {
    throw new Error("Workspace create failed: no id returned.");
  }

  return workspaceId;
}

async function fetchWorkspaceCategoriesForPostgres(
  executor: SqlExecutor,
  workspaceId: string
): Promise<CategoryRow[]> {
  const { rows } = await executor.query<CategoryRow>(
    `
      select ${CATEGORY_COLUMNS}
      from public.categories
      where workspace_id = $1::uuid
      order by position asc, created_at asc
    `,
    [workspaceId]
  );

  return rows.map(normalizeCategory);
}

async function fetchWorkspaceCategorySummariesForPostgres(
  executor: SqlExecutor,
  workspaceId: string
): Promise<CategorySummaryRow[]> {
  const { rows } = await executor.query<CategorySummaryRow>(
    `
      select ${CATEGORY_SUMMARY_COLUMNS}
      from public.categories
      where workspace_id = $1::uuid
      order by position asc, created_at asc
    `,
    [workspaceId]
  );

  return rows.map(normalizeCategorySummary);
}

async function fetchWorkspaceCategorySummariesBatchForPostgres(
  executor: SqlExecutor,
  workspaceIds: string[]
): Promise<Map<string, CategorySummaryRow[]>> {
  const byWorkspace = new Map<string, CategorySummaryRow[]>();
  if (workspaceIds.length === 0) {
    return byWorkspace;
  }

  const { rows } = await executor.query<CategorySummaryRow>(
    `
      select ${CATEGORY_SUMMARY_COLUMNS}
      from public.categories
      where workspace_id = any($1::uuid[])
      order by workspace_id asc, position asc, created_at asc
    `,
    [workspaceIds]
  );

  for (const row of rows.map(normalizeCategorySummary)) {
    const existing = byWorkspace.get(row.workspace_id) ?? [];
    existing.push(row);
    byWorkspace.set(row.workspace_id, existing);
  }

  return byWorkspace;
}

async function fetchCategoryMessagesForPostgres(
  executor: SqlExecutor,
  workspaceId: string,
  categoryId: string
): Promise<MessageRow[]> {
  const { rows } = await executor.query<MessageRow>(
    `
      select ${MESSAGE_COLUMNS}
      from public.category_messages
      where workspace_id = $1::uuid
        and category_id = $2::uuid
      order by position asc, created_at asc
    `,
    [workspaceId, categoryId]
  );

  return rows.map(normalizeMessage);
}

async function fetchCategoryMessagesForCategoriesForPostgres(
  executor: SqlExecutor,
  workspaceId: string,
  categoryIds: string[]
): Promise<MessageRow[]> {
  if (categoryIds.length === 0) {
    return [];
  }

  const { rows } = await executor.query<MessageRow>(
    `
      select ${MESSAGE_COLUMNS}
      from public.category_messages
      where workspace_id = $1::uuid
        and category_id = any($2::uuid[])
      order by category_id asc, position asc, created_at asc
    `,
    [workspaceId, categoryIds]
  );

  return rows.map(normalizeMessage);
}

async function insertMainRootForPostgres(
  executor: SqlExecutor,
  workspaceId: string,
  position: number
): Promise<void> {
  const row = buildMainRootRow(workspaceId, position);

  await executor.query(
    `
      insert into public.categories (
        id,
        workspace_id,
        parent_id,
        title,
        content,
        description,
        tag,
        format,
        category_type,
        position
      )
      values (
        $1::uuid,
        $2::uuid,
        null,
        $3::text,
        $4::text,
        $5::text,
        $6::text,
        $7::text,
        $8::text,
        $9::int
      )
    `,
    [
      row.id,
      workspaceId,
      row.title,
      row.content,
      row.description,
      row.tag,
      row.format,
      row.category_type,
      row.position,
    ]
  );
}

async function seedWorkspaceIfEmptyForPostgres(
  executor: SqlExecutor,
  workspaceId: string
): Promise<void> {
  await insertMainRootForPostgres(executor, workspaceId, 0);
}

async function ensureMainRootForPostgres(
  executor: SqlExecutor,
  workspaceId: string,
  categories: CategoryRow[]
): Promise<CategoryRow[]> {
  if (hasMainRootCategory(categories)) {
    return categories;
  }

  const maxRootPosition = categories
    .filter((node) => node.parent_id === null)
    .reduce((max, node) => Math.max(max, node.position), -1);

  await insertMainRootForPostgres(executor, workspaceId, maxRootPosition + 1);
  return fetchWorkspaceCategoriesForPostgres(executor, workspaceId);
}

function markCategoryAccess<T extends CategoryRow | CategorySummaryRow>(
  category: T,
  access: {
    visibility: "local" | "public";
    role: CategoryAccessRole;
    publicRootCategoryId: string | null;
    publicOwnerUserId: string | null;
    displayParentId?: string | null;
  }
): T {
  const marked = {
    ...category,
    parent_id:
      typeof access.displayParentId === "undefined"
        ? category.parent_id
        : access.displayParentId,
    visibility: access.visibility,
    access_role: access.role,
    public_root_id: access.publicRootCategoryId,
    public_owner_user_id: access.publicOwnerUserId,
  };

  return (
    "content" in marked
      ? normalizeCategory(marked as CategoryRow)
      : normalizeCategorySummary(marked as CategorySummaryRow)
  ) as T;
}

function collectSubtreeIds(
  categories: Array<Pick<CategoryRow, "id" | "parent_id">>,
  rootId: string
): Set<string> {
  return new Set([
    rootId,
    ...collectDescendantIds(
      categories.map((category) => ({
        id: category.id,
        parent_id: category.parent_id,
      })),
      rootId
    ),
  ]);
}

async function fetchOwnedPublicRootsForPostgres(
  executor: SqlExecutor,
  ownerUserId: string,
  workspaceId: string
): Promise<PublicRootRecord[]> {
  const { rows } = await executor.query<PublicRootRecord>(
    `
      select id, owner_user_id, workspace_id, root_category_id
      from public.public_category_roots
      where owner_user_id = $1::uuid
        and workspace_id = $2::uuid
      order by created_at asc
    `,
    [ownerUserId, workspaceId]
  );

  return rows;
}

async function fetchMemberPublicRootsForPostgres(
  executor: SqlExecutor,
  appUserId: string
): Promise<PublicRootRecord[]> {
  const { rows } = await executor.query<PublicRootRecord>(
    `
      select
        pcr.id,
        pcr.owner_user_id,
        pcr.workspace_id,
        pcr.root_category_id,
        pcm.role,
        pcm.mount_parent_category_id
      from public.public_category_members pcm
      join public.public_category_roots pcr
        on pcr.id = pcm.public_root_id
      where pcm.app_user_id = $1::uuid
      order by pcm.created_at asc
    `,
    [appUserId]
  );

  return rows;
}

function annotateOwnedCategories<T extends CategoryRow | CategorySummaryRow>(
  categories: T[],
  publicRoots: PublicRootRecord[],
  ownerUserId: string
): T[] {
  const annotated = categories.map((category) =>
    markCategoryAccess(category, {
      visibility: "local",
      role: "owner",
      publicRootCategoryId: null,
      publicOwnerUserId: null,
    })
  );

  for (const publicRoot of publicRoots) {
    const subtreeIds = collectSubtreeIds(categories, publicRoot.root_category_id);
    for (let index = 0; index < annotated.length; index += 1) {
      if (!subtreeIds.has(annotated[index].id)) {
        continue;
      }

      annotated[index] = markCategoryAccess(annotated[index], {
        visibility: "public",
        role: "owner",
        publicRootCategoryId: publicRoot.root_category_id,
        publicOwnerUserId: ownerUserId,
      });
    }
  }

  return annotated;
}

async function fetchAccessibleCategoriesForPostgres(
  executor: SqlExecutor,
  appUserId: string,
  ownWorkspaceId: string
): Promise<CategoryRow[]> {
  let ownedCategories = await fetchWorkspaceCategoriesForPostgres(
    executor,
    ownWorkspaceId
  );

  if (ownedCategories.length === 0) {
    await seedWorkspaceIfEmptyForPostgres(executor, ownWorkspaceId);
    ownedCategories = await fetchWorkspaceCategoriesForPostgres(
      executor,
      ownWorkspaceId
    );
  }

  ownedCategories = await ensureMainRootForPostgres(
    executor,
    ownWorkspaceId,
    ownedCategories
  );

  const ownedPublicRoots = await fetchOwnedPublicRootsForPostgres(
    executor,
    appUserId,
    ownWorkspaceId
  );
  const visible = annotateOwnedCategories(
    ownedCategories,
    ownedPublicRoots,
    appUserId
  );
  const localMainRootId =
    ownedCategories.find(
      (category) =>
        category.parent_id === null &&
        category.title.trim().toLowerCase() === MAIN_CATEGORY_TITLE
    )?.id ?? null;
  const localCategoryIdSet = new Set(ownedCategories.map((category) => category.id));

  const memberPublicRoots = await fetchMemberPublicRootsForPostgres(
    executor,
    appUserId
  );
  const workspaceCache = new Map<string, CategoryRow[]>();

  for (const publicRoot of memberPublicRoots) {
    const cached =
      workspaceCache.get(publicRoot.workspace_id) ??
      (await fetchWorkspaceCategoriesForPostgres(executor, publicRoot.workspace_id));
    workspaceCache.set(publicRoot.workspace_id, cached);

    const subtreeIds = collectSubtreeIds(cached, publicRoot.root_category_id);
    for (const category of cached) {
      if (!subtreeIds.has(category.id)) {
        continue;
      }

      const displayParentId =
        category.id === publicRoot.root_category_id
          ? publicRoot.mount_parent_category_id &&
            localCategoryIdSet.has(publicRoot.mount_parent_category_id)
            ? publicRoot.mount_parent_category_id
            : localMainRootId
          : !category.parent_id || !subtreeIds.has(category.parent_id)
            ? null
            : category.parent_id;

      visible.push(
        markCategoryAccess(category, {
          visibility: "public",
          role: publicRoot.role === "editor" ? "editor" : "viewer",
          publicRootCategoryId: publicRoot.root_category_id,
          publicOwnerUserId: publicRoot.owner_user_id,
          displayParentId,
        })
      );
    }
  }

  return visible.sort(sortCategoriesForStore);
}

async function fetchAccessibleCategorySummariesForPostgres(
  executor: SqlExecutor,
  appUserId: string,
  ownWorkspaceId: string
): Promise<CategorySummaryRow[]> {
  let ownedCategories = await fetchWorkspaceCategorySummariesForPostgres(
    executor,
    ownWorkspaceId
  );

  if (ownedCategories.length === 0) {
    await seedWorkspaceIfEmptyForPostgres(executor, ownWorkspaceId);
    ownedCategories = await fetchWorkspaceCategorySummariesForPostgres(
      executor,
      ownWorkspaceId
    );
  }

  if (!hasMainRootCategory(ownedCategories)) {
    const maxRootPosition = ownedCategories
      .filter((node) => node.parent_id === null)
      .reduce((max, node) => Math.max(max, node.position), -1);
    await insertMainRootForPostgres(executor, ownWorkspaceId, maxRootPosition + 1);
    ownedCategories = await fetchWorkspaceCategorySummariesForPostgres(
      executor,
      ownWorkspaceId
    );
  }

  const [ownedPublicRoots, memberPublicRoots] = await Promise.all([
    fetchOwnedPublicRootsForPostgres(executor, appUserId, ownWorkspaceId),
    fetchMemberPublicRootsForPostgres(executor, appUserId),
  ]);
  const visible = annotateOwnedCategories(
    ownedCategories,
    ownedPublicRoots,
    appUserId
  );
  const localMainRootId =
    ownedCategories.find(
      (category) =>
        category.parent_id === null &&
        category.title.trim().toLowerCase() === MAIN_CATEGORY_TITLE
    )?.id ?? null;
  const localCategoryIdSet = new Set(ownedCategories.map((category) => category.id));
  const memberWorkspaceIds = Array.from(
    new Set(memberPublicRoots.map((root) => root.workspace_id))
  );
  const workspaceCategories =
    await fetchWorkspaceCategorySummariesBatchForPostgres(
      executor,
      memberWorkspaceIds
    );

  for (const publicRoot of memberPublicRoots) {
    const sharedCategories = workspaceCategories.get(publicRoot.workspace_id) ?? [];
    const subtreeIds = collectSubtreeIds(
      sharedCategories,
      publicRoot.root_category_id
    );
    for (const category of sharedCategories) {
      if (!subtreeIds.has(category.id)) {
        continue;
      }

      const displayParentId =
        category.id === publicRoot.root_category_id
          ? publicRoot.mount_parent_category_id &&
            localCategoryIdSet.has(publicRoot.mount_parent_category_id)
            ? publicRoot.mount_parent_category_id
            : localMainRootId
          : !category.parent_id || !subtreeIds.has(category.parent_id)
            ? null
            : category.parent_id;

      visible.push(
        markCategoryAccess(category, {
          visibility: "public",
          role: publicRoot.role === "editor" ? "editor" : "viewer",
          publicRootCategoryId: publicRoot.root_category_id,
          publicOwnerUserId: publicRoot.owner_user_id,
          displayParentId,
        })
      );
    }
  }

  return visible.sort(sortCategoriesForStore);
}

function sortCategoriesForStore(
  a: Pick<CategoryRow, "position" | "created_at">,
  b: Pick<CategoryRow, "position" | "created_at">
): number {
  if (a.position === b.position) {
    return a.created_at.localeCompare(b.created_at);
  }

  return a.position - b.position;
}

async function fetchCategoryByIdForPostgres(
  executor: SqlExecutor,
  categoryId: string
): Promise<CategoryRow | null> {
  const { rows } = await executor.query<CategoryRow>(
    `
      select ${CATEGORY_COLUMNS}
      from public.categories
      where id = $1::uuid
      limit 1
    `,
    [categoryId]
  );

  const row = rows[0];
  return row ? normalizeCategory(row) : null;
}

async function fetchMessageByIdForPostgres(
  executor: SqlExecutor,
  messageId: string
): Promise<MessageRow | null> {
  const { rows } = await executor.query<MessageRow>(
    `
      select ${MESSAGE_COLUMNS}
      from public.category_messages
      where id = $1::uuid
      limit 1
    `,
    [messageId]
  );

  const row = rows[0];
  return row ? normalizeMessage(row) : null;
}

async function resolveCategoryAccessForPostgres(
  executor: SqlExecutor,
  appUserId: string,
  ownWorkspaceId: string,
  categoryId: string
): Promise<CategoryAccess> {
  const category = await fetchCategoryByIdForPostgres(executor, categoryId);
  if (!category) {
    throw new Error("Category not found.");
  }

  if (category.workspace_id === ownWorkspaceId) {
    const { rows: ownedRootRows } = await executor.query<PublicRootRecord>(
      `
        with recursive ancestors as (
          select id, parent_id
          from public.categories
          where workspace_id = $1::uuid and id = $2::uuid
          union all
          select parent.id, parent.parent_id
          from public.categories parent
          join ancestors child on child.parent_id = parent.id
          where parent.workspace_id = $1::uuid
        )
        select pcr.id, pcr.owner_user_id, pcr.workspace_id, pcr.root_category_id
        from public.public_category_roots pcr
        join ancestors on ancestors.id = pcr.root_category_id
        where pcr.owner_user_id = $3::uuid
          and pcr.workspace_id = $1::uuid
        limit 1
      `,
      [ownWorkspaceId, category.id, appUserId]
    );
    const publicRoot = ownedRootRows[0];
    if (publicRoot) {
      return {
        category: markCategoryAccess(category, {
          visibility: "public",
          role: "owner",
          publicRootCategoryId: publicRoot.root_category_id,
          publicOwnerUserId: appUserId,
        }),
        workspaceId: category.workspace_id,
        role: "owner",
        visibility: "public",
        publicRootRecordId: publicRoot.id,
        publicRootCategoryId: publicRoot.root_category_id,
        publicOwnerUserId: appUserId,
        isPublicRoot: category.id === publicRoot.root_category_id,
      };
    }

    return {
      category: markCategoryAccess(category, {
        visibility: "local",
        role: "owner",
        publicRootCategoryId: null,
        publicOwnerUserId: null,
      }),
      workspaceId: category.workspace_id,
      role: "owner",
      visibility: "local",
      publicRootRecordId: null,
      publicRootCategoryId: null,
      publicOwnerUserId: null,
      isPublicRoot: false,
    };
  }

  const { rows: memberRootRows } = await executor.query<
    PublicRootRecord & { local_main_root_id: string | null }
  >(
    `
      with recursive ancestors as (
        select id, parent_id
        from public.categories
        where workspace_id = $1::uuid and id = $2::uuid
        union all
        select parent.id, parent.parent_id
        from public.categories parent
        join ancestors child on child.parent_id = parent.id
        where parent.workspace_id = $1::uuid
      )
      select
        pcr.id,
        pcr.owner_user_id,
        pcr.workspace_id,
        pcr.root_category_id,
        pcm.role,
        pcm.mount_parent_category_id,
        (
          select local_main.id
          from public.categories local_main
          where local_main.workspace_id = $4::uuid
            and local_main.parent_id is null
            and lower(trim(local_main.title)) = $5::text
          order by local_main.position asc, local_main.created_at asc
          limit 1
        ) as local_main_root_id
      from public.public_category_members pcm
      join public.public_category_roots pcr on pcr.id = pcm.public_root_id
      join ancestors on ancestors.id = pcr.root_category_id
      where pcm.app_user_id = $3::uuid
        and pcr.workspace_id = $1::uuid
      limit 1
    `,
    [category.workspace_id, category.id, appUserId, ownWorkspaceId, MAIN_CATEGORY_TITLE]
  );
  const publicRoot = memberRootRows[0];
  if (publicRoot) {
    return {
      category: markCategoryAccess(category, {
        visibility: "public",
        role: publicRoot.role === "editor" ? "editor" : "viewer",
        publicRootCategoryId: publicRoot.root_category_id,
        publicOwnerUserId: publicRoot.owner_user_id,
        displayParentId:
          category.id === publicRoot.root_category_id
            ? publicRoot.mount_parent_category_id ?? publicRoot.local_main_root_id
            : category.parent_id,
      }),
      workspaceId: category.workspace_id,
      role: publicRoot.role === "editor" ? "editor" : "viewer",
      visibility: "public",
      publicRootRecordId: publicRoot.id,
      publicRootCategoryId: publicRoot.root_category_id,
      publicOwnerUserId: publicRoot.owner_user_id,
      isPublicRoot: category.id === publicRoot.root_category_id,
    };
  }

  throw new Error("Category not found.");
}

async function resolveMessageAccessForPostgres(
  executor: SqlExecutor,
  appUserId: string,
  ownWorkspaceId: string,
  messageId: string
): Promise<MessageAccess> {
  const message = await fetchMessageByIdForPostgres(executor, messageId);
  if (!message) {
    throw new Error("Message not found.");
  }

  return {
    message,
    categoryAccess: await resolveCategoryAccessForPostgres(
      executor,
      appUserId,
      ownWorkspaceId,
      message.category_id
    ),
  };
}

function assertCanEditCategory(access: CategoryAccess): void {
  if (access.role === "viewer") {
    throw new Error("Недостаточно прав для редактирования public-категории.");
  }
}

async function assertCategoryParentAllowedForPostgres(
  executor: SqlExecutor,
  appUserId: string,
  ownWorkspaceId: string,
  access: CategoryAccess,
  nextParentId: string | null
): Promise<void> {
  if (!nextParentId) {
    if (access.role !== "owner") {
      throw new Error("Редактор не может вынести public-категорию в корень.");
    }
    return;
  }

  const parentAccess = await resolveCategoryAccessForPostgres(
    executor,
    appUserId,
    ownWorkspaceId,
    nextParentId
  );

  if (parentAccess.workspaceId !== access.workspaceId) {
    throw new Error("Категорию нельзя переместить в другое рабочее пространство.");
  }

  if (access.role === "owner") {
    return;
  }

  if (
    !access.publicRootCategoryId ||
    parentAccess.publicRootCategoryId !== access.publicRootCategoryId
  ) {
    throw new Error("Редактор может перемещать категории только внутри public-дерева.");
  }
}

async function createCategoryInWorkspaceForPostgres(
  executor: SqlExecutor,
  workspaceId: string,
  parentId: string | null,
  title: string
): Promise<CategoryRow> {
  const { rows: positionRows } = await executor.query<{
    next_position: number | string;
  }>(
    `
      select coalesce(max(position), -1) + 1 as next_position
      from public.categories
      where workspace_id = $1::uuid
        and parent_id is not distinct from $2::uuid
    `,
    [workspaceId, parentId]
  );

  const nextPosition = toFinitePosition(positionRows[0]?.next_position ?? 0);

  const { rows } = await executor.query<CategoryRow>(
    `
      insert into public.categories (
        workspace_id,
        parent_id,
        title,
        content,
        description,
        tag,
        format,
        category_type,
        position
      )
      values (
        $1::uuid,
        $2::uuid,
        $3::text,
        '',
        '',
        '',
        'continuous',
        'learning',
        $4::int
      )
      returning ${CATEGORY_COLUMNS}
    `,
    [workspaceId, parentId, title, nextPosition]
  );

  const created = rows[0];
  if (!created) {
    throw new Error("Create failed: no row returned");
  }

  return normalizeCategory(created);
}

async function importTreeAsChildForPostgres(
  pool: Pool,
  appUserId: string,
  ownWorkspaceId: string,
  document: CategoryTreeDocument,
  targetParentId: string | null
): Promise<{
  categories: CategoryRow[];
  messages: MessageRow[];
}> {
  if (targetParentId) {
    const parentAccess = await resolveCategoryAccessForPostgres(
      pool,
      appUserId,
      ownWorkspaceId,
      targetParentId
    );
    if (parentAccess.workspaceId !== ownWorkspaceId || parentAccess.visibility !== "local") {
      throw new Error("Категорию можно принять только в локальную категорию.");
    }
  }

  const importedRoot = document.categories.find(
    (category) => category.id === document.rootCategoryId
  );
  if (!importedRoot) {
    throw new Error("Root category from import file was not found.");
  }

  const categoryIdMap = new Map<string, string>();
  const createdCategoryIds: string[] = [];
  const createdMessageIds: string[] = [];

  await withPostgresTransaction(pool, async (client) => {
    const createdRoot = await createCategoryInWorkspaceForPostgres(
      client,
      ownWorkspaceId,
      targetParentId,
      importedRoot.title
    );
    categoryIdMap.set(importedRoot.id, createdRoot.id);
    createdCategoryIds.push(createdRoot.id);

    await client.query(
      `
        update public.categories
        set
          title = $3::text,
          content = $4::text,
          description = $5::text,
          tag = $6::text,
          format = $7::text,
          category_type = $8::text,
          position = $9::int
        where workspace_id = $1::uuid
          and id = $2::uuid
      `,
      [
        ownWorkspaceId,
        createdRoot.id,
        importedRoot.title,
        importedRoot.content,
        importedRoot.description,
        importedRoot.tag,
        importedRoot.format,
        importedRoot.category_type,
        importedRoot.position,
      ]
    );

    const pendingCategories = document.categories.filter(
      (category) => category.id !== importedRoot.id
    );

    while (pendingCategories.length > 0) {
      let progressed = false;

      for (let index = pendingCategories.length - 1; index >= 0; index -= 1) {
        const candidate = pendingCategories[index];
        if (!candidate.parent_id) {
          throw new Error("В импорте найдена категория без parent_id.");
        }

        const mappedParentId = categoryIdMap.get(candidate.parent_id);
        if (!mappedParentId) {
          continue;
        }

        const created = await createCategoryInWorkspaceForPostgres(
          client,
          ownWorkspaceId,
          mappedParentId,
          candidate.title
        );

        await client.query(
          `
            update public.categories
            set
              title = $3::text,
              content = $4::text,
              description = $5::text,
              tag = $6::text,
              format = $7::text,
              category_type = $8::text,
              position = $9::int
            where workspace_id = $1::uuid
              and id = $2::uuid
          `,
          [
            ownWorkspaceId,
            created.id,
            candidate.title,
            candidate.content,
            candidate.description,
            candidate.tag,
            candidate.format,
            candidate.category_type,
            candidate.position,
          ]
        );

        categoryIdMap.set(candidate.id, created.id);
        createdCategoryIds.push(created.id);
        pendingCategories.splice(index, 1);
        progressed = true;
      }

      if (!progressed) {
        throw new Error("Не удалось восстановить дерево категорий.");
      }
    }

    for (const message of document.messages) {
      const mappedCategoryId = categoryIdMap.get(message.category_id);
      if (!mappedCategoryId) {
        throw new Error("В импорте найдено сообщение с неизвестной категорией.");
      }

      const { rows } = await client.query<MessageRow>(
        `
          insert into public.category_messages (
            workspace_id,
            category_id,
            title,
            content,
            position,
            message_type
          )
          values (
            $1::uuid,
            $2::uuid,
            $3::text,
            $4::text,
            $5::int,
            $6::text
          )
          returning ${MESSAGE_COLUMNS}
        `,
        [
          ownWorkspaceId,
          mappedCategoryId,
          message.title,
          message.content,
          message.position,
          message.message_type,
        ]
      );

      if (rows[0]) {
        createdMessageIds.push(rows[0].id);
      }
    }
  });

  const freshCategories = await fetchWorkspaceCategoriesForPostgres(pool, ownWorkspaceId);
  const createdCategoryIdSet = new Set(createdCategoryIds);
  const createdMessageIdSet = new Set(createdMessageIds);
  const messageChunks = await Promise.all(
    createdCategoryIds.map((categoryId) =>
      fetchCategoryMessagesForPostgres(pool, ownWorkspaceId, categoryId)
    )
  );

  return {
    categories: freshCategories.filter((category) => createdCategoryIdSet.has(category.id)),
    messages: messageChunks
      .flat()
      .filter((message) => createdMessageIdSet.has(message.id)),
  };
}

function createPostgresStore(userId: string): CategoryStore {
  const pool = getPostgresPool();
  const workspacePromise = ensureWorkspaceIdForPostgres(pool, userId);

  return {
    source: "postgres",
    async list() {
      const workspaceId = await workspacePromise;
      return fetchAccessibleCategoriesForPostgres(pool, userId, workspaceId);
    },
    async listSummaries() {
      const workspaceId = await workspacePromise;
      return fetchAccessibleCategorySummariesForPostgres(
        pool,
        userId,
        workspaceId
      );
    },
    async getDetail(id) {
      const workspaceId = await workspacePromise;
      const access = await resolveCategoryAccessForPostgres(
        pool,
        userId,
        workspaceId,
        id
      );
      const messages =
        access.category.format === "block"
          ? await fetchCategoryMessagesForPostgres(
              pool,
              access.workspaceId,
              access.category.id
            )
          : [];

      return {
        category: access.category,
        messages,
      };
    },
    async create(input) {
      const ownWorkspaceId = await workspacePromise;
      let targetWorkspaceId = ownWorkspaceId;
      let parentId = input.parentId;
      let inheritedAccess: CategoryAccess | null = null;

      if (input.parentId) {
        inheritedAccess = await resolveCategoryAccessForPostgres(
          pool,
          userId,
          ownWorkspaceId,
          input.parentId
        );
        assertCanEditCategory(inheritedAccess);
        targetWorkspaceId = inheritedAccess.workspaceId;
        parentId = inheritedAccess.category.id;
      }

      const created = await createCategoryInWorkspaceForPostgres(
        pool,
        targetWorkspaceId,
        parentId,
        input.title
      );

      if (!inheritedAccess) {
        return markCategoryAccess(created, {
          visibility: "local",
          role: "owner",
          publicRootCategoryId: null,
          publicOwnerUserId: null,
        });
      }

      return markCategoryAccess(created, {
        visibility: inheritedAccess.visibility,
        role: inheritedAccess.role,
        publicRootCategoryId: inheritedAccess.publicRootCategoryId,
        publicOwnerUserId: inheritedAccess.publicOwnerUserId,
      });
    },
    async update(id, patch) {
      const ownWorkspaceId = await workspacePromise;
      const access = await resolveCategoryAccessForPostgres(
        pool,
        userId,
        ownWorkspaceId,
        id
      );
      assertCanEditCategory(access);

      if (access.role !== "owner" && access.isPublicRoot && hasOwnProperty(patch, "parent_id")) {
        throw new Error("Редактор не может перемещать корень public-категории.");
      }

      if (hasOwnProperty(patch, "parent_id")) {
        await assertCategoryParentAllowedForPostgres(
          pool,
          userId,
          ownWorkspaceId,
          access,
          patch.parent_id ?? null
        );
      }

      const { setClause, values } = makeCategoryUpdateSet(patch);

      const { rows } = await pool.query<CategoryRow>(
        `
          update public.categories
          set ${setClause}
          where workspace_id = $${values.length + 1}::uuid
            and id = $${values.length + 2}::uuid
          returning ${CATEGORY_COLUMNS}
        `,
        [...values, access.workspaceId, id]
      );

      const updated = rows[0];
      if (!updated) {
        throw new Error("Update failed: Category not found");
      }

      return markCategoryAccess(updated, {
        visibility: access.visibility,
        role: access.role,
        publicRootCategoryId: access.publicRootCategoryId,
        publicOwnerUserId: access.publicOwnerUserId,
      });
    },
    async remove(id) {
      const ownWorkspaceId = await workspacePromise;
      const access = await resolveCategoryAccessForPostgres(
        pool,
        userId,
        ownWorkspaceId,
        id
      );
      assertCanEditCategory(access);

      if (access.role !== "owner" && access.isPublicRoot) {
        throw new Error("Public-root может удалить только владелец.");
      }

      await pool.query(
        `
          delete from public.categories
          where workspace_id = $1::uuid
            and id = $2::uuid
        `,
        [access.workspaceId, id]
      );
    },
    async restoreTree(document) {
      const workspaceId = await workspacePromise;
      const restoredCategoryIds = new Set<string>();

      await withPostgresTransaction(pool, async (client) => {
        const pendingCategories = [...document.categories];

        while (pendingCategories.length > 0) {
          let progressed = false;

          for (let index = pendingCategories.length - 1; index >= 0; index -= 1) {
            const category = pendingCategories[index];
            const parentIsInsideRestore = document.categories.some(
              (candidate) => candidate.id === category.parent_id
            );

            if (parentIsInsideRestore && !restoredCategoryIds.has(category.parent_id ?? "")) {
              continue;
            }

            await client.query(
              `
                insert into public.categories (
                  id,
                  workspace_id,
                  parent_id,
                  title,
                  content,
                  description,
                  tag,
                  format,
                  category_type,
                  position
                )
                values (
                  $1::uuid,
                  $2::uuid,
                  $3::uuid,
                  $4::text,
                  $5::text,
                  $6::text,
                  $7::text,
                  $8::text,
                  $9::text,
                  $10::int
                )
              `,
              [
                category.id,
                workspaceId,
                category.parent_id,
                category.title,
                category.content,
                category.description,
                category.tag,
                category.format,
                category.category_type,
                category.position,
              ]
            );

            restoredCategoryIds.add(category.id);
            pendingCategories.splice(index, 1);
            progressed = true;
          }

          if (!progressed) {
            throw new Error("Restore failed: category tree has unresolved parents.");
          }
        }

        for (const message of document.messages) {
          await client.query(
            `
              insert into public.category_messages (
                id,
                workspace_id,
                category_id,
                title,
                content,
                position,
                message_type
              )
              values (
                $1::uuid,
                $2::uuid,
                $3::uuid,
                $4::text,
                $5::text,
                $6::int,
                $7::text
              )
            `,
            [
              message.id,
              workspaceId,
              message.category_id,
              message.title,
              message.content,
              message.position,
              message.message_type,
            ]
          );
        }
      });

      const freshCategories = await fetchWorkspaceCategoriesForPostgres(pool, workspaceId);
      const restoredCategoryIdSet = new Set(document.categories.map((category) => category.id));
      const restoredCategories = freshCategories.filter((category) =>
        restoredCategoryIdSet.has(category.id)
      );
      const messageChunks = await Promise.all(
        document.categories.map((category) =>
          fetchCategoryMessagesForPostgres(pool, workspaceId, category.id)
        )
      );

      return {
        categories: restoredCategories,
        messages: messageChunks.flat(),
      };
    },
    async importTreeAsChild(document, parentId) {
      const workspaceId = await workspacePromise;
      return importTreeAsChildForPostgres(pool, userId, workspaceId, document, parentId);
    },
    async listMessages(categoryId) {
      const ownWorkspaceId = await workspacePromise;
      const access = await resolveCategoryAccessForPostgres(
        pool,
        userId,
        ownWorkspaceId,
        categoryId
      );
      return fetchCategoryMessagesForPostgres(pool, access.workspaceId, categoryId);
    },
    async listMessagesForCategories(categories) {
      const result: Record<string, MessageRow[]> = {};
      const categoryIdsByWorkspaceId = new Map<string, string[]>();

      for (const category of categories) {
        result[category.id] = [];
        const workspaceCategoryIds =
          categoryIdsByWorkspaceId.get(category.workspace_id) ?? [];
        workspaceCategoryIds.push(category.id);
        categoryIdsByWorkspaceId.set(category.workspace_id, workspaceCategoryIds);
      }

      const messageChunks = await Promise.all(
        Array.from(categoryIdsByWorkspaceId.entries()).map(
          ([workspaceId, categoryIds]) =>
            fetchCategoryMessagesForCategoriesForPostgres(
              pool,
              workspaceId,
              categoryIds
            )
        )
      );

      for (const message of messageChunks.flat()) {
        const categoryMessages = result[message.category_id] ?? [];
        categoryMessages.push(message);
        result[message.category_id] = categoryMessages;
      }

      return result;
    },
    async createMessage(input) {
      const ownWorkspaceId = await workspacePromise;
      const access = await resolveCategoryAccessForPostgres(
        pool,
        userId,
        ownWorkspaceId,
        input.categoryId
      );
      assertCanEditCategory(access);

      const { rows: positionRows } = await pool.query<{ next_position: number | string }>(
        `
          select coalesce(max(position), -1) + 1 as next_position
          from public.category_messages
          where workspace_id = $1::uuid
            and category_id = $2::uuid
        `,
        [access.workspaceId, input.categoryId]
      );

      const nextPosition = toFinitePosition(positionRows[0]?.next_position ?? 0);

      const { rows } = await pool.query<MessageRow>(
        `
          insert into public.category_messages (
            workspace_id,
            category_id,
            title,
            content,
            position,
            message_type
          )
          values (
            $1::uuid,
            $2::uuid,
            $3::text,
            $4::text,
            $5::int,
            $6::text
          )
          returning ${MESSAGE_COLUMNS}
        `,
        [
          access.workspaceId,
          input.categoryId,
          typeof input.title === "string" && input.title.trim().length > 0
            ? input.title.trim()
            : DEFAULT_MESSAGE_TITLE,
          input.content ?? "",
          nextPosition,
          input.messageType ?? "info",
        ]
      );

      const created = rows[0];
      if (!created) {
        throw new Error("Create message failed: no row returned");
      }

      return normalizeMessage(created);
    },
    async updateMessage(id, patch) {
      const ownWorkspaceId = await workspacePromise;
      const access = await resolveMessageAccessForPostgres(
        pool,
        userId,
        ownWorkspaceId,
        id
      );
      assertCanEditCategory(access.categoryAccess);
      const { setClause, values } = makeMessageUpdateSet(patch);

      const { rows } = await pool.query<MessageRow>(
        `
          update public.category_messages
          set ${setClause}
          where workspace_id = $${values.length + 1}::uuid
            and id = $${values.length + 2}::uuid
          returning ${MESSAGE_COLUMNS}
        `,
        [...values, access.categoryAccess.workspaceId, id]
      );

      const updated = rows[0];
      if (!updated) {
        throw new Error("Update message failed: Message not found");
      }

      return normalizeMessage(updated);
    },
    async removeMessage(id) {
      const ownWorkspaceId = await workspacePromise;
      const access = await resolveMessageAccessForPostgres(
        pool,
        userId,
        ownWorkspaceId,
        id
      );
      assertCanEditCategory(access.categoryAccess);

      await pool.query(
        `
          delete from public.category_messages
          where workspace_id = $1::uuid
            and id = $2::uuid
        `,
        [access.categoryAccess.workspaceId, id]
      );
    },
    async reorderMessages(categoryId, orderedIds) {
      const ownWorkspaceId = await workspacePromise;
      const access = await resolveCategoryAccessForPostgres(
        pool,
        userId,
        ownWorkspaceId,
        categoryId
      );
      assertCanEditCategory(access);

      if (orderedIds.length === 0) {
        return fetchCategoryMessagesForPostgres(pool, access.workspaceId, categoryId);
      }

      const uniqueIds = new Set(orderedIds);
      if (uniqueIds.size !== orderedIds.length) {
        throw new Error("orderedIds contains duplicates.");
      }

      await withPostgresTransaction(pool, async (client) => {
        for (let index = 0; index < orderedIds.length; index += 1) {
          await client.query(
            `
              update public.category_messages
              set position = $1::int
              where workspace_id = $2::uuid
                and category_id = $3::uuid
                and id = $4::uuid
            `,
            [index, access.workspaceId, categoryId, orderedIds[index]]
          );
        }
      });

      return fetchCategoryMessagesForPostgres(pool, access.workspaceId, categoryId);
    },
  };
}

export async function getCategoryStore(userId: string): Promise<CategoryStore> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing user id.");
  }

  try {
    return createPostgresStore(normalizedUserId);
  } catch (error) {
    throw new Error(toErrorMessage(error, "postgres store initialization failed."));
  }
}
