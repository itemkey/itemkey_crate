import "server-only";

import type {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from "pg";

import { getPostgresPool } from "@/lib/db/postgres";
import { toErrorMessage } from "@/lib/errors";
import type {
  CategoryFormat,
  CategoryRow,
  CategoryType,
  MessageRow,
  MessageType,
} from "@/lib/types";

const CATEGORY_COLUMNS =
  "id,workspace_id,parent_id,title,content,description,tag,format,category_type,position,created_at,updated_at";
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
  create(input: CategoryCreate): Promise<CategoryRow>;
  update(id: string, patch: CategoryPatch): Promise<CategoryRow>;
  remove(id: string): Promise<void>;
  listMessages(categoryId: string): Promise<MessageRow[]>;
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

function hasMainRootCategory(categories: CategoryRow[]): boolean {
  return categories.some(
    (node) =>
      node.parent_id === null &&
      node.title.trim().toLowerCase() === MAIN_CATEGORY_TITLE
  );
}

function buildMainRootRow(workspaceId: string, position: number): CategoryRow {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
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
    description: raw.description ?? "",
    tag: raw.tag ?? "",
    format: raw.format ?? "continuous",
    category_type: raw.category_type ?? "learning",
  };
}

function normalizeMessage(raw: MessageRow): MessageRow {
  const normalizedTitle =
    typeof raw.title === "string" && raw.title.trim().length > 0
      ? raw.title.trim()
      : DEFAULT_MESSAGE_TITLE;

  return {
    ...raw,
    title: normalizedTitle,
    message_type: raw.message_type ?? "info",
  };
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
  const title = WORKSPACE_SLUG === MAIN_CATEGORY_TITLE ? "Main workspace" : WORKSPACE_SLUG;
  const { rows } = await executor.query<{ id: string }>(
    `
      insert into public.workspaces (owner_user_id, slug, title)
      values ($1::uuid, $2::text, $3::text)
      on conflict (owner_user_id, slug)
      do update set title = excluded.title
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

function createPostgresStore(userId: string): CategoryStore {
  const pool = getPostgresPool();
  const workspacePromise = ensureWorkspaceIdForPostgres(pool, userId);

  return {
    source: "postgres",
    async list() {
      const workspaceId = await workspacePromise;
      const currentRows = await fetchWorkspaceCategoriesForPostgres(pool, workspaceId);

      if (currentRows.length === 0) {
        await seedWorkspaceIfEmptyForPostgres(pool, workspaceId);
        return fetchWorkspaceCategoriesForPostgres(pool, workspaceId);
      }

      return ensureMainRootForPostgres(pool, workspaceId, currentRows);
    },
    async create(input) {
      const workspaceId = await workspacePromise;

      const { rows: positionRows } = await pool.query<{ next_position: number | string }>(
        `
          select coalesce(max(position), -1) + 1 as next_position
          from public.categories
          where workspace_id = $1::uuid
            and parent_id is not distinct from $2::uuid
        `,
        [workspaceId, input.parentId]
      );

      const nextPosition = toFinitePosition(positionRows[0]?.next_position ?? 0);

      const { rows } = await pool.query<CategoryRow>(
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
        [workspaceId, input.parentId, input.title, nextPosition]
      );

      const created = rows[0];
      if (!created) {
        throw new Error("Create failed: no row returned");
      }

      return normalizeCategory(created);
    },
    async update(id, patch) {
      const workspaceId = await workspacePromise;
      const { setClause, values } = makeCategoryUpdateSet(patch);

      const { rows } = await pool.query<CategoryRow>(
        `
          update public.categories
          set ${setClause}
          where workspace_id = $${values.length + 1}::uuid
            and id = $${values.length + 2}::uuid
          returning ${CATEGORY_COLUMNS}
        `,
        [...values, workspaceId, id]
      );

      const updated = rows[0];
      if (!updated) {
        throw new Error("Update failed: Category not found");
      }

      return normalizeCategory(updated);
    },
    async remove(id) {
      const workspaceId = await workspacePromise;

      await pool.query(
        `
          delete from public.categories
          where workspace_id = $1::uuid
            and id = $2::uuid
        `,
        [workspaceId, id]
      );
    },
    async listMessages(categoryId) {
      const workspaceId = await workspacePromise;
      return fetchCategoryMessagesForPostgres(pool, workspaceId, categoryId);
    },
    async createMessage(input) {
      const workspaceId = await workspacePromise;

      const { rows: positionRows } = await pool.query<{ next_position: number | string }>(
        `
          select coalesce(max(position), -1) + 1 as next_position
          from public.category_messages
          where workspace_id = $1::uuid
            and category_id = $2::uuid
        `,
        [workspaceId, input.categoryId]
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
          workspaceId,
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
      const workspaceId = await workspacePromise;
      const { setClause, values } = makeMessageUpdateSet(patch);

      const { rows } = await pool.query<MessageRow>(
        `
          update public.category_messages
          set ${setClause}
          where workspace_id = $${values.length + 1}::uuid
            and id = $${values.length + 2}::uuid
          returning ${MESSAGE_COLUMNS}
        `,
        [...values, workspaceId, id]
      );

      const updated = rows[0];
      if (!updated) {
        throw new Error("Update message failed: Message not found");
      }

      return normalizeMessage(updated);
    },
    async removeMessage(id) {
      const workspaceId = await workspacePromise;

      await pool.query(
        `
          delete from public.category_messages
          where workspace_id = $1::uuid
            and id = $2::uuid
        `,
        [workspaceId, id]
      );
    },
    async reorderMessages(categoryId, orderedIds) {
      const workspaceId = await workspacePromise;

      if (orderedIds.length === 0) {
        return fetchCategoryMessagesForPostgres(pool, workspaceId, categoryId);
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
            [index, workspaceId, categoryId, orderedIds[index]]
          );
        }
      });

      return fetchCategoryMessagesForPostgres(pool, workspaceId, categoryId);
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
