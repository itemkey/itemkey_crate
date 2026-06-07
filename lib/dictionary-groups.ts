import "server-only";

import type { QueryResult, QueryResultRow } from "pg";

import { buildCategoryPath } from "@/lib/categories";
import {
  DEFAULT_DICTIONARY_COLUMNS,
  type DictionaryColumn,
  type DictionaryEntry,
  type DictionaryEntryIdentity,
  type DictionaryFieldLabels,
  type DictionaryGroupResolvedResult,
  type DictionaryWordGroup,
  type DictionaryWordGroupItem,
  type DictionaryWordGroupItemSnapshot,
  type DictionaryWordGroupSummary,
  normalizeDictionaryColumns as normalizeSharedDictionaryColumns,
  parseContinuousDictionariesFromContent,
  parseMessageDictionaryContent,
} from "@/lib/dictionaries";
import { getPostgresPool } from "@/lib/db/postgres";
import type { CategoryRow, MessageRow } from "@/lib/types";

const WORKSPACE_SLUG =
  process.env.WORKSPACE_SLUG ?? process.env.NEXT_PUBLIC_WORKSPACE_SLUG ?? "main";

const CATEGORY_COLUMNS =
  "id,workspace_id,parent_id,title,content,description,tag,format,category_type,position,created_at,updated_at";
const MESSAGE_COLUMNS =
  "id,workspace_id,category_id,title,content,position,message_type,created_at,updated_at";
const GROUP_COLUMNS =
  "id,workspace_id,title,description,position,created_at,updated_at";
const ITEM_COLUMNS =
  "id,workspace_id,group_id,source_category_id,source_message_id,dictionary_id,entry_id,entry_snapshot,position,created_at,updated_at";

let dictionaryGroupsSchemaPromise: Promise<void> | null = null;

type SqlExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};

type DictionaryGroupRow = QueryResultRow & {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  position: number | string;
  created_at: string | Date;
  updated_at: string | Date;
};

type DictionaryGroupItemRow = QueryResultRow & {
  id: string;
  workspace_id: string;
  group_id: string;
  source_category_id: string;
  source_message_id: string | null;
  dictionary_id: string | null;
  entry_id: string;
  entry_snapshot: unknown;
  position: number | string;
  created_at: string | Date;
  updated_at: string | Date;
};

type DictionaryEntryIdentityInput = {
  sourceCategoryId?: unknown;
  sourceMessageId?: unknown;
  dictionaryId?: unknown;
  entryId?: unknown;
};

type DictionaryGroupPatch = {
  title?: string;
  description?: string;
  position?: number;
};

export type DictionaryGroupSimilarPayload = {
  groups: DictionaryWordGroupSummary[];
  results: DictionaryGroupResolvedResult[];
};

export type DictionaryGroupStore = {
  source: "postgres";
  list(): Promise<DictionaryWordGroup[]>;
  create(input: { title: string; description?: string }): Promise<DictionaryWordGroup>;
  update(id: string, patch: DictionaryGroupPatch): Promise<DictionaryWordGroup>;
  remove(id: string): Promise<void>;
  addItem(
    groupId: string,
    identity: DictionaryEntryIdentityInput
  ): Promise<DictionaryWordGroup>;
  removeItem(groupId: string, itemId: string): Promise<DictionaryWordGroup>;
  resolveSimilar(
    identity: DictionaryEntryIdentityInput
  ): Promise<DictionaryGroupSimilarPayload>;
};

type ResolutionContext = {
  categories: CategoryRow[];
  categoriesById: Map<string, CategoryRow>;
  messagesById: Map<string, MessageRow>;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function normalizeDictionaryEntry(
  value: unknown,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntry {
  if (!isObjectRecord(value)) {
    return {
      id: "",
      values: Object.fromEntries(
        columns.map((column) => [column.id, ""])
      ) as Record<string, string>,
    };
  }

  const rawValues = isObjectRecord(value.values) ? value.values : {};
  return {
    id: typeof value.id === "string" ? value.id : "",
    values: Object.fromEntries(
      columns.map((column) => {
        const rawValue = rawValues[column.id];
        const directValue = value[column.id];
        return [
          column.id,
          typeof rawValue === "string"
            ? rawValue
            : typeof directValue === "string"
              ? directValue
              : "",
        ];
      })
    ) as Record<string, string>,
  };
}

function normalizeDictionaryLabels(value: unknown): DictionaryFieldLabels {
  if (!isObjectRecord(value)) {
    return {
      side1: "сторона 1",
      side1Note: "пояснение 1",
      side2: "сторона 2",
      side2Note: "пояснение 2",
    };
  }

  return {
    side1: typeof value.side1 === "string" ? value.side1 : "сторона 1",
    side1Note:
      typeof value.side1Note === "string" ? value.side1Note : "пояснение 1",
    side2: typeof value.side2 === "string" ? value.side2 : "сторона 2",
    side2Note:
      typeof value.side2Note === "string" ? value.side2Note : "пояснение 2",
  };
}

function normalizeEntrySnapshot(value: unknown): DictionaryWordGroupItemSnapshot {
  if (!isObjectRecord(value)) {
    const columns = normalizeSharedDictionaryColumns(null);
    return {
      entry: normalizeDictionaryEntry(null, columns),
      labels: Object.fromEntries(
        columns.map((column) => [column.id, column.label])
      ) as DictionaryFieldLabels,
      columns,
      dictionaryTitle: "Источник не найден",
      categoryPath: "",
    };
  }

  const columns = normalizeSharedDictionaryColumns(value.columns, value.labels);
  const legacyLabels = normalizeDictionaryLabels(value.labels);
  return {
    entry: normalizeDictionaryEntry(value.entry, columns),
    labels: Object.fromEntries(
      columns.map((column) => {
        const rawLabel = isObjectRecord(value.labels)
          ? value.labels[column.id]
          : null;
        return [
          column.id,
          typeof rawLabel === "string"
            ? rawLabel
            : legacyLabels[column.id] ?? column.label,
        ];
      })
    ) as DictionaryFieldLabels,
    columns,
    dictionaryTitle:
      typeof value.dictionaryTitle === "string" && value.dictionaryTitle.trim()
        ? value.dictionaryTitle
        : "Источник не найден",
    categoryPath: typeof value.categoryPath === "string" ? value.categoryPath : "",
  };
}

function toRawItem(row: DictionaryGroupItemRow): Omit<
  DictionaryWordGroupItem,
  "resolvedResult"
> {
  return {
    id: row.id,
    groupId: row.group_id,
    sourceCategoryId: row.source_category_id,
    sourceMessageId: row.source_message_id,
    dictionaryId: row.dictionary_id,
    entryId: row.entry_id,
    entrySnapshot: normalizeEntrySnapshot(row.entry_snapshot),
    position: toFinitePosition(row.position),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function toGroup(
  row: DictionaryGroupRow,
  items: DictionaryWordGroupItem[]
): DictionaryWordGroup {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    position: toFinitePosition(row.position),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    items,
  };
}

function makeIdentityKey(identity: DictionaryEntryIdentity): string {
  return [
    identity.sourceCategoryId,
    identity.sourceMessageId ?? "",
    identity.dictionaryId ?? "",
    identity.entryId,
  ].join("\0");
}

function makeResultId(identity: DictionaryEntryIdentity): string {
  return [
    identity.sourceCategoryId,
    identity.sourceMessageId ?? identity.dictionaryId ?? "source",
    identity.entryId,
  ].join(":");
}

function identitiesEqual(
  left: DictionaryEntryIdentity,
  right: DictionaryEntryIdentity
): boolean {
  return makeIdentityKey(left) === makeIdentityKey(right);
}

function normalizeIdentity(input: DictionaryEntryIdentityInput): DictionaryEntryIdentity {
  const sourceCategoryId =
    typeof input.sourceCategoryId === "string" ? input.sourceCategoryId.trim() : "";
  const sourceMessageId =
    typeof input.sourceMessageId === "string" && input.sourceMessageId.trim()
      ? input.sourceMessageId.trim()
      : null;
  const dictionaryId =
    typeof input.dictionaryId === "string" && input.dictionaryId.trim()
      ? input.dictionaryId.trim()
      : null;
  const entryId = typeof input.entryId === "string" ? input.entryId.trim() : "";

  if (!sourceCategoryId || !entryId) {
    throw new Error("Недостаточно данных для записи #DICT.");
  }

  if (Boolean(sourceMessageId) === Boolean(dictionaryId)) {
    throw new Error("У записи #DICT должен быть ровно один источник.");
  }

  return {
    sourceCategoryId,
    sourceMessageId,
    dictionaryId,
    entryId,
  };
}

async function ensureWorkspaceIdForPostgres(
  executor: SqlExecutor,
  ownerUserId: string
): Promise<string> {
  const title = WORKSPACE_SLUG === "main" ? "Main workspace" : WORKSPACE_SLUG;
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

async function ensureDictionaryGroupsSchema(
  executor: SqlExecutor
): Promise<void> {
  if (dictionaryGroupsSchemaPromise) {
    return dictionaryGroupsSchemaPromise;
  }

  dictionaryGroupsSchemaPromise = (async () => {
    await executor.query(`
      create table if not exists public.dictionary_word_groups (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null references public.workspaces(id) on delete cascade,
        title text not null check (char_length(trim(title)) > 0),
        description text not null default '',
        position integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (workspace_id, id)
      )
    `);

    await executor.query(`
      create index if not exists dictionary_word_groups_workspace_position_idx
        on public.dictionary_word_groups(workspace_id, position, created_at)
    `);

    await executor.query(`
      create table if not exists public.dictionary_word_group_items (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null references public.workspaces(id) on delete cascade,
        group_id uuid not null,
        source_category_id uuid not null,
        source_message_id uuid null,
        dictionary_id text null,
        entry_id text not null check (char_length(trim(entry_id)) > 0),
        entry_snapshot jsonb not null default '{}'::jsonb,
        position integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint dictionary_word_group_items_group_fk
          foreign key (workspace_id, group_id)
          references public.dictionary_word_groups(workspace_id, id)
          on delete cascade,
        constraint dictionary_word_group_items_category_fk
          foreign key (workspace_id, source_category_id)
          references public.categories(workspace_id, id)
          on delete cascade,
        constraint dictionary_word_group_items_message_fk
          foreign key (workspace_id, source_message_id)
          references public.category_messages(workspace_id, id)
          on delete cascade,
        constraint dictionary_word_group_items_source_check check (
          (source_message_id is not null and dictionary_id is null)
          or (source_message_id is null and dictionary_id is not null)
        )
      )
    `);

    await executor.query(`
      create unique index if not exists dictionary_word_group_items_block_unique_idx
        on public.dictionary_word_group_items(group_id, source_category_id, source_message_id, entry_id)
        where source_message_id is not null and dictionary_id is null
    `);

    await executor.query(`
      create unique index if not exists dictionary_word_group_items_continuous_unique_idx
        on public.dictionary_word_group_items(group_id, source_category_id, dictionary_id, entry_id)
        where source_message_id is null and dictionary_id is not null
    `);

    await executor.query(`
      create index if not exists dictionary_word_group_items_group_position_idx
        on public.dictionary_word_group_items(workspace_id, group_id, position, created_at)
    `);

    await executor.query(`
      create index if not exists dictionary_word_group_items_lookup_idx
        on public.dictionary_word_group_items(workspace_id, source_category_id, source_message_id, dictionary_id, entry_id)
    `);
  })().catch((error) => {
    dictionaryGroupsSchemaPromise = null;
    throw error;
  });

  return dictionaryGroupsSchemaPromise;
}

async function fetchResolutionContext(
  executor: SqlExecutor,
  workspaceId: string
): Promise<ResolutionContext> {
  const [categoryResult, messageResult] = await Promise.all([
    executor.query<CategoryRow>(
      `
        select ${CATEGORY_COLUMNS}
        from public.categories
        where workspace_id = $1::uuid
        order by position asc, created_at asc
      `,
      [workspaceId]
    ),
    executor.query<MessageRow>(
      `
        select ${MESSAGE_COLUMNS}
        from public.category_messages
        where workspace_id = $1::uuid
        order by category_id asc, position asc, created_at asc
      `,
      [workspaceId]
    ),
  ]);

  const categories = categoryResult.rows;
  return {
    categories,
    categoriesById: new Map(categories.map((category) => [category.id, category])),
    messagesById: new Map(messageResult.rows.map((message) => [message.id, message])),
  };
}

function makeCategoryPath(context: ResolutionContext, categoryId: string): string {
  return buildCategoryPath(context.categories, categoryId)
    .map((part) => part.title)
    .join(" / ");
}

function makeFallbackResult(
  item: Omit<DictionaryWordGroupItem, "resolvedResult">
): DictionaryGroupResolvedResult {
  return {
    id: makeResultId(item),
    sourceCategoryId: item.sourceCategoryId,
    sourceMessageId: item.sourceMessageId,
    dictionaryId: item.dictionaryId,
    entryId: item.entryId,
    entry: item.entrySnapshot.entry,
    labels: item.entrySnapshot.labels,
    columns: item.entrySnapshot.columns,
    sourceExists: false,
    dictionaryTitle: item.entrySnapshot.dictionaryTitle || "Источник не найден",
    categoryPath: item.entrySnapshot.categoryPath,
    groups: [],
    itemIds: [item.id],
    isCurrent: false,
  };
}

function resolveLiveResult(
  item: Omit<DictionaryWordGroupItem, "resolvedResult">,
  context: ResolutionContext
): DictionaryGroupResolvedResult | null {
  const category = context.categoriesById.get(item.sourceCategoryId);
  if (!category) {
    return null;
  }

  if (item.sourceMessageId) {
    const message = context.messagesById.get(item.sourceMessageId);
    if (!message || message.category_id !== item.sourceCategoryId) {
      return null;
    }

    const payload = parseMessageDictionaryContent(message.content);
    const entry = payload?.entries.find((candidate) => candidate.id === item.entryId);
    if (!payload || !entry) {
      return null;
    }

    return {
      id: makeResultId(item),
      sourceCategoryId: item.sourceCategoryId,
      sourceMessageId: item.sourceMessageId,
      dictionaryId: null,
      entryId: item.entryId,
      entry,
      labels: payload.labels,
      columns: payload.columns,
      sourceExists: true,
      dictionaryTitle: message.title,
      categoryPath: makeCategoryPath(context, category.id),
      groups: [],
      itemIds: [item.id],
      isCurrent: false,
    };
  }

  if (!item.dictionaryId) {
    return null;
  }

  const dictionary = parseContinuousDictionariesFromContent(category.content).find(
    (candidate) => candidate.id === item.dictionaryId
  );
  const entry = dictionary?.entries.find((candidate) => candidate.id === item.entryId);
  if (!dictionary || !entry) {
    return null;
  }

  return {
    id: makeResultId(item),
    sourceCategoryId: item.sourceCategoryId,
    sourceMessageId: null,
    dictionaryId: item.dictionaryId,
    entryId: item.entryId,
    entry,
    labels: dictionary.labels,
    columns: dictionary.columns,
    sourceExists: true,
    dictionaryTitle: dictionary.title,
    categoryPath: makeCategoryPath(context, category.id),
    groups: [],
    itemIds: [item.id],
    isCurrent: false,
  };
}

function resolveItem(
  item: Omit<DictionaryWordGroupItem, "resolvedResult">,
  context: ResolutionContext
): DictionaryWordGroupItem {
  return {
    ...item,
    resolvedResult: resolveLiveResult(item, context) ?? makeFallbackResult(item),
  };
}

function makeSnapshot(
  result: DictionaryGroupResolvedResult
): DictionaryWordGroupItemSnapshot {
  return {
    entry: result.entry,
    labels: result.labels,
    columns: result.columns,
    dictionaryTitle: result.dictionaryTitle,
    categoryPath: result.categoryPath,
  };
}

async function fetchGroupRows(
  executor: SqlExecutor,
  workspaceId: string,
  groupId?: string
): Promise<DictionaryGroupRow[]> {
  const { rows } = await executor.query<DictionaryGroupRow>(
    `
      select ${GROUP_COLUMNS}
      from public.dictionary_word_groups
      where workspace_id = $1::uuid
      ${groupId ? "and id = $2::uuid" : ""}
      order by position asc, created_at asc
    `,
    groupId ? [workspaceId, groupId] : [workspaceId]
  );

  return rows;
}

async function fetchItemRows(
  executor: SqlExecutor,
  workspaceId: string,
  groupIds: string[]
): Promise<DictionaryGroupItemRow[]> {
  if (groupIds.length === 0) {
    return [];
  }

  const { rows } = await executor.query<DictionaryGroupItemRow>(
    `
      select ${ITEM_COLUMNS}
      from public.dictionary_word_group_items
      where workspace_id = $1::uuid
        and group_id = any($2::uuid[])
      order by group_id asc, position asc, created_at asc
    `,
    [workspaceId, groupIds]
  );

  return rows;
}

function createPostgresDictionaryGroupStore(userId: string): DictionaryGroupStore {
  const pool = getPostgresPool();
  const workspacePromise = ensureWorkspaceIdForPostgres(pool, userId);
  const schemaPromise = ensureDictionaryGroupsSchema(pool);

  const listGroups = async (groupId?: string): Promise<DictionaryWordGroup[]> => {
    await schemaPromise;
    const workspaceId = await workspacePromise;
    const groupRows = await fetchGroupRows(pool, workspaceId, groupId);
    const itemRows = await fetchItemRows(
      pool,
      workspaceId,
      groupRows.map((group) => group.id)
    );
    const context = await fetchResolutionContext(pool, workspaceId);
    const itemsByGroupId = new Map<string, DictionaryWordGroupItem[]>();

    for (const row of itemRows) {
      const item = resolveItem(toRawItem(row), context);
      const items = itemsByGroupId.get(item.groupId) ?? [];
      items.push(item);
      itemsByGroupId.set(item.groupId, items);
    }

    return groupRows.map((row) => toGroup(row, itemsByGroupId.get(row.id) ?? []));
  };

  const getGroup = async (groupId: string): Promise<DictionaryWordGroup> => {
    const group = (await listGroups(groupId))[0];
    if (!group) {
      throw new Error("Группа словарей не найдена.");
    }

    return group;
  };

  return {
    source: "postgres",

    async list() {
      await schemaPromise;
      return listGroups();
    },

    async create(input) {
      await schemaPromise;
      const workspaceId = await workspacePromise;
      const title = input.title.trim();
      if (!title) {
        throw new Error("Название группы не может быть пустым.");
      }

      const siblingCount = await pool
        .query<{ count: string }>(
          `
            select count(*)::text as count
            from public.dictionary_word_groups
            where workspace_id = $1::uuid
          `,
          [workspaceId]
        )
        .then(({ rows }) => Number(rows[0]?.count) || 0);

      const { rows } = await pool.query<DictionaryGroupRow>(
        `
          insert into public.dictionary_word_groups (
            workspace_id,
            title,
            description,
            position
          )
          values ($1::uuid, $2::text, $3::text, $4::int)
          returning ${GROUP_COLUMNS}
        `,
        [workspaceId, title, input.description ?? "", siblingCount]
      );

      const created = rows[0];
      if (!created) {
        throw new Error("Не удалось создать группу словарей.");
      }

      return getGroup(created.id);
    },

    async update(id, patch) {
      await schemaPromise;
      const workspaceId = await workspacePromise;
      const assignments: string[] = [];
      const values: unknown[] = [];

      const addAssignment = (column: string, value: unknown) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };

      if (typeof patch.title === "string") {
        const title = patch.title.trim();
        if (!title) {
          throw new Error("Название группы не может быть пустым.");
        }
        addAssignment("title", title);
      }

      if (typeof patch.description === "string") {
        addAssignment("description", patch.description);
      }

      if (typeof patch.position === "number" && Number.isFinite(patch.position)) {
        addAssignment("position", Math.max(0, Math.floor(patch.position)));
      }

      if (assignments.length === 0) {
        throw new Error("Nothing to update.");
      }

      values.push(workspaceId, id);
      const { rows } = await pool.query<DictionaryGroupRow>(
        `
          update public.dictionary_word_groups
          set ${assignments.join(", ")},
              updated_at = now()
          where workspace_id = $${values.length - 1}::uuid
            and id = $${values.length}::uuid
          returning ${GROUP_COLUMNS}
        `,
        values
      );

      if (!rows[0]) {
        throw new Error("Группа словарей не найдена.");
      }

      return getGroup(id);
    },

    async remove(id) {
      await schemaPromise;
      const workspaceId = await workspacePromise;
      await pool.query(
        `
          delete from public.dictionary_word_groups
          where workspace_id = $1::uuid
            and id = $2::uuid
        `,
        [workspaceId, id]
      );
    },

    async addItem(groupId, identityInput) {
      await schemaPromise;
      const identity = normalizeIdentity(identityInput);
      const workspaceId = await workspacePromise;
      const context = await fetchResolutionContext(pool, workspaceId);
      const liveResult = resolveLiveResult(
        {
          id: "",
          groupId,
          ...identity,
          entrySnapshot: normalizeEntrySnapshot(null),
          position: 0,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        context
      );

      if (!liveResult) {
        throw new Error("Запись #DICT не найдена.");
      }

      const groupExists = await pool
        .query<{ exists: boolean }>(
          `
            select exists (
              select 1
              from public.dictionary_word_groups
              where workspace_id = $1::uuid
                and id = $2::uuid
            ) as exists
          `,
          [workspaceId, groupId]
        )
        .then(({ rows }) => Boolean(rows[0]?.exists));

      if (!groupExists) {
        throw new Error("Группа словарей не найдена.");
      }

      const existing = await pool.query<DictionaryGroupItemRow>(
        `
          select ${ITEM_COLUMNS}
          from public.dictionary_word_group_items
          where workspace_id = $1::uuid
            and group_id = $2::uuid
            and source_category_id = $3::uuid
            and entry_id = $4::text
            and (
              ($5::uuid is not null and source_message_id = $5::uuid and dictionary_id is null)
              or ($5::uuid is null and source_message_id is null and dictionary_id = $6::text)
            )
          limit 1
        `,
        [
          workspaceId,
          groupId,
          identity.sourceCategoryId,
          identity.entryId,
          identity.sourceMessageId,
          identity.dictionaryId,
        ]
      );

      if (existing.rows[0]) {
        await pool.query(
          `
            update public.dictionary_word_group_items
            set entry_snapshot = $3::jsonb,
                updated_at = now()
            where workspace_id = $1::uuid
              and id = $2::uuid
          `,
          [workspaceId, existing.rows[0].id, JSON.stringify(makeSnapshot(liveResult))]
        );
        return getGroup(groupId);
      }

      const position = await pool
        .query<{ count: string }>(
          `
            select count(*)::text as count
            from public.dictionary_word_group_items
            where workspace_id = $1::uuid
              and group_id = $2::uuid
          `,
          [workspaceId, groupId]
        )
        .then(({ rows }) => Number(rows[0]?.count) || 0);

      await pool.query(
        `
          insert into public.dictionary_word_group_items (
            workspace_id,
            group_id,
            source_category_id,
            source_message_id,
            dictionary_id,
            entry_id,
            entry_snapshot,
            position
          )
          values (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::uuid,
            $5::text,
            $6::text,
            $7::jsonb,
            $8::int
          )
        `,
        [
          workspaceId,
          groupId,
          identity.sourceCategoryId,
          identity.sourceMessageId,
          identity.dictionaryId,
          identity.entryId,
          JSON.stringify(makeSnapshot(liveResult)),
          position,
        ]
      );

      return getGroup(groupId);
    },

    async removeItem(groupId, itemId) {
      await schemaPromise;
      const workspaceId = await workspacePromise;
      await pool.query(
        `
          delete from public.dictionary_word_group_items
          where workspace_id = $1::uuid
            and group_id = $2::uuid
            and id = $3::uuid
        `,
        [workspaceId, groupId, itemId]
      );

      return getGroup(groupId);
    },

    async resolveSimilar(identityInput) {
      await schemaPromise;
      const identity = normalizeIdentity(identityInput);
      const groups = await listGroups();
      const matchingGroups = groups.filter((group) =>
        group.items.some((item) => identitiesEqual(item, identity))
      );
      const matchingSummaries = matchingGroups.map((group) => ({
        id: group.id,
        title: group.title,
      }));
      const resultsByKey = new Map<string, DictionaryGroupResolvedResult>();

      for (const group of matchingGroups) {
        const groupSummary = {
          id: group.id,
          title: group.title,
        };

        for (const item of group.items) {
          const key = makeIdentityKey(item);
          const existing = resultsByKey.get(key);
          if (existing) {
            if (!existing.groups.some((candidate) => candidate.id === group.id)) {
              existing.groups.push(groupSummary);
            }
            if (!existing.itemIds.includes(item.id)) {
              existing.itemIds.push(item.id);
            }
            existing.isCurrent = existing.isCurrent || identitiesEqual(item, identity);
            continue;
          }

          resultsByKey.set(key, {
            ...item.resolvedResult,
            groups: [groupSummary],
            itemIds: [item.id],
            isCurrent: identitiesEqual(item, identity),
          });
        }
      }

      return {
        groups: matchingSummaries,
        results: Array.from(resultsByKey.values()),
      };
    },
  };
}

export async function getDictionaryGroupStore(
  userId: string
): Promise<DictionaryGroupStore> {
  return createPostgresDictionaryGroupStore(userId);
}
