import "server-only";

import type { QueryResult, QueryResultRow } from "pg";

import { getPostgresPool } from "@/lib/db/postgres";
import { toErrorMessage } from "@/lib/errors";
import type { ProjectRow } from "@/lib/types";

const PROJECT_COLUMNS =
  "id,workspace_id,title,tag_filter,container_category_ids,position,created_at,updated_at";

const WORKSPACE_SLUG =
  process.env.WORKSPACE_SLUG ?? process.env.NEXT_PUBLIC_WORKSPACE_SLUG ?? "main";

type ProjectCreate = {
  title: string;
  tag_filter: string;
  container_category_ids: string;
};

type ProjectPatch = {
  title?: string;
  tag_filter?: string;
  container_category_ids?: string;
  position?: number;
};

type SqlExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};

export type ProjectStore = {
  source: "postgres";
  list(): Promise<ProjectRow[]>;
  create(input: ProjectCreate): Promise<ProjectRow>;
  update(id: string, patch: ProjectPatch): Promise<ProjectRow>;
  remove(id: string): Promise<void>;
  cleanupContainerCategoryIds(categoryIds: string[]): Promise<void>;
};

export function parseSerializedList(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return dedupeSerializedList(
          parsed.filter((entry): entry is string => typeof entry === "string")
        );
      }
    } catch {
      return dedupeSerializedList([trimmed]);
    }
  }

  if (trimmed.includes("\n")) {
    return dedupeSerializedList(trimmed.split(/\r?\n/g));
  }

  return dedupeSerializedList([trimmed]);
}

export function serializeSerializedList(values: string[]): string {
  return dedupeSerializedList(values).join("\n");
}

function dedupeSerializedList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
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

function normalizeProject(raw: ProjectRow): ProjectRow {
  return {
    ...raw,
    tag_filter: raw.tag_filter ?? "",
    container_category_ids: raw.container_category_ids ?? "",
  };
}

function makeProjectUpdateSet(patch: ProjectPatch): {
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

  if (
    hasOwnProperty(patch, "tag_filter") &&
    typeof patch.tag_filter === "string"
  ) {
    addAssignment("tag_filter", patch.tag_filter);
  }

  if (
    hasOwnProperty(patch, "container_category_ids") &&
    typeof patch.container_category_ids === "string"
  ) {
    addAssignment("container_category_ids", patch.container_category_ids);
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

async function fetchWorkspaceProjectsForPostgres(
  executor: SqlExecutor,
  workspaceId: string
): Promise<ProjectRow[]> {
  const { rows } = await executor.query<ProjectRow>(
    `
      select ${PROJECT_COLUMNS}
      from public.projects
      where workspace_id = $1::uuid
      order by position asc, created_at asc
    `,
    [workspaceId]
  );

  return rows.map(normalizeProject);
}

function createPostgresProjectStore(userId: string): ProjectStore {
  const pool = getPostgresPool();
  const workspacePromise = ensureWorkspaceIdForPostgres(pool, userId);

  return {
    source: "postgres",
    async list() {
      const workspaceId = await workspacePromise;
      return fetchWorkspaceProjectsForPostgres(pool, workspaceId);
    },
    async create(input) {
      const workspaceId = await workspacePromise;

      const { rows: positionRows } = await pool.query<{ next_position: number | string }>(
        `
          select coalesce(max(position), -1) + 1 as next_position
          from public.projects
          where workspace_id = $1::uuid
        `,
        [workspaceId]
      );

      const nextPosition = toFinitePosition(positionRows[0]?.next_position ?? 0);

      const { rows } = await pool.query<ProjectRow>(
        `
          insert into public.projects (
            workspace_id,
            title,
            tag_filter,
            container_category_ids,
            position
          )
          values (
            $1::uuid,
            $2::text,
            $3::text,
            $4::text,
            $5::int
          )
          returning ${PROJECT_COLUMNS}
        `,
        [
          workspaceId,
          input.title,
          input.tag_filter,
          input.container_category_ids,
          nextPosition,
        ]
      );

      const created = rows[0];
      if (!created) {
        throw new Error("Create project failed: no row returned.");
      }

      return normalizeProject(created);
    },
    async update(id, patch) {
      const workspaceId = await workspacePromise;
      const { setClause, values } = makeProjectUpdateSet(patch);

      const { rows } = await pool.query<ProjectRow>(
        `
          update public.projects
          set ${setClause}
          where workspace_id = $${values.length + 1}::uuid
            and id = $${values.length + 2}::uuid
          returning ${PROJECT_COLUMNS}
        `,
        [...values, workspaceId, id]
      );

      const updated = rows[0];
      if (!updated) {
        throw new Error("Update project failed: Project not found.");
      }

      return normalizeProject(updated);
    },
    async remove(id) {
      const workspaceId = await workspacePromise;

      const { rowCount } = await pool.query(
        `
          delete from public.projects
          where workspace_id = $1::uuid
            and id = $2::uuid
        `,
        [workspaceId, id]
      );

      if (!rowCount) {
        throw new Error("Delete project failed: Project not found.");
      }
    },
    async cleanupContainerCategoryIds(categoryIds) {
      const workspaceId = await workspacePromise;
      const trimmed = categoryIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      if (trimmed.length === 0) {
        return;
      }

      const idsToRemove = new Set(trimmed.map((id) => id.toLocaleLowerCase()));
      const projects = await fetchWorkspaceProjectsForPostgres(pool, workspaceId);

      for (const project of projects) {
        const currentIds = parseSerializedList(project.container_category_ids);
        const nextIds = currentIds.filter(
          (id) => !idsToRemove.has(id.toLocaleLowerCase())
        );

        if (nextIds.length === currentIds.length) {
          continue;
        }

        await pool.query(
          `
            update public.projects
            set container_category_ids = $1::text
            where workspace_id = $2::uuid
              and id = $3::uuid
          `,
          [serializeSerializedList(nextIds), workspaceId, project.id]
        );
      }
    },
  };
}

export async function getProjectStore(userId: string): Promise<ProjectStore> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing user id.");
  }

  try {
    return createPostgresProjectStore(normalizedUserId);
  } catch (error) {
    throw new Error(toErrorMessage(error, "postgres project store initialization failed."));
  }
}
