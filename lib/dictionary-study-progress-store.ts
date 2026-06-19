import "server-only";

import type { QueryResult, QueryResultRow } from "pg";

import { getCategoryStore } from "@/lib/category-store";
import { getPostgresPool } from "@/lib/db/postgres";
import {
  normalizePersistedDictionaryStudyProgress,
  type DictionaryStudyProgressSourceIdentity,
  type PersistedDictionaryStudyProgress,
} from "@/lib/dictionary-study-progress-types";

type SqlExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};

type DictionaryStudyProgressRow = QueryResultRow & {
  progress_data: unknown;
};

type ResolvedProgressSource = DictionaryStudyProgressSourceIdentity & {
  workspaceId: string;
};

let dictionaryStudyProgressSchemaPromise: Promise<void> | null = null;

async function ensureDictionaryStudyProgressSchema(
  executor: SqlExecutor
): Promise<void> {
  if (dictionaryStudyProgressSchemaPromise) {
    return dictionaryStudyProgressSchemaPromise;
  }

  dictionaryStudyProgressSchemaPromise = (async () => {
    await executor.query(`
      create table if not exists public.dictionary_study_progress (
        id uuid primary key default gen_random_uuid(),
        app_user_id uuid not null references public.app_users(id) on delete cascade,
        workspace_id uuid not null references public.workspaces(id) on delete cascade,
        source_category_id uuid not null,
        source_message_id uuid null,
        dictionary_id text null,
        progress_data jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint dictionary_study_progress_category_fk
          foreign key (workspace_id, source_category_id)
          references public.categories(workspace_id, id)
          on delete cascade,
        constraint dictionary_study_progress_message_fk
          foreign key (workspace_id, source_message_id)
          references public.category_messages(workspace_id, id)
          on delete cascade,
        constraint dictionary_study_progress_source_check check (
          (source_message_id is not null and dictionary_id is null)
          or (source_message_id is null and dictionary_id is not null)
        )
      )
    `);

    await executor.query(`
      create unique index if not exists dictionary_study_progress_block_unique_idx
        on public.dictionary_study_progress(app_user_id, workspace_id, source_category_id, source_message_id)
        where source_message_id is not null and dictionary_id is null
    `);

    await executor.query(`
      create unique index if not exists dictionary_study_progress_continuous_unique_idx
        on public.dictionary_study_progress(app_user_id, workspace_id, source_category_id, dictionary_id)
        where source_message_id is null and dictionary_id is not null
    `);

    await executor.query(`
      create index if not exists dictionary_study_progress_user_updated_idx
        on public.dictionary_study_progress(app_user_id, updated_at desc)
    `);
  })().catch((error) => {
    dictionaryStudyProgressSchemaPromise = null;
    throw error;
  });

  return dictionaryStudyProgressSchemaPromise;
}

async function resolveProgressSource(
  appUserId: string,
  source: DictionaryStudyProgressSourceIdentity
): Promise<ResolvedProgressSource | null> {
  const categoryStore = await getCategoryStore(appUserId);
  const categories = await categoryStore.list();
  const category = categories.find((item) => item.id === source.sourceCategoryId);
  if (!category) {
    return null;
  }

  if (source.sourceMessageId) {
    const messages = await categoryStore.listMessages(source.sourceCategoryId);
    if (!messages.some((message) => message.id === source.sourceMessageId)) {
      return null;
    }
  }

  return {
    ...source,
    workspaceId: category.workspace_id,
  };
}

export class DictionaryStudyProgressSourceError extends Error {
  constructor() {
    super("Dictionary study source is not available.");
    this.name = "DictionaryStudyProgressSourceError";
  }
}

export function getDictionaryStudyProgressStore(appUserId: string) {
  const pool = getPostgresPool();
  const schemaPromise = ensureDictionaryStudyProgressSchema(pool);

  return {
    source: "postgres" as const,

    async get(
      identity: DictionaryStudyProgressSourceIdentity
    ): Promise<PersistedDictionaryStudyProgress | null> {
      await schemaPromise;
      const resolved = await resolveProgressSource(appUserId, identity);
      if (!resolved) {
        return null;
      }

      const { rows } = await pool.query<DictionaryStudyProgressRow>(
        `
          select progress_data
          from public.dictionary_study_progress
          where app_user_id = $1::uuid
            and workspace_id = $2::uuid
            and source_category_id = $3::uuid
            and (
              (
                $4::uuid is not null
                and source_message_id = $4::uuid
                and dictionary_id is null
              )
              or (
                $4::uuid is null
                and source_message_id is null
                and dictionary_id = $5::text
              )
            )
          limit 1
        `,
        [
          appUserId,
          resolved.workspaceId,
          resolved.sourceCategoryId,
          resolved.sourceMessageId,
          resolved.dictionaryId,
        ]
      );

      return normalizePersistedDictionaryStudyProgress(rows[0]?.progress_data);
    },

    async upsert(
      identity: DictionaryStudyProgressSourceIdentity,
      progress: PersistedDictionaryStudyProgress
    ): Promise<PersistedDictionaryStudyProgress> {
      await schemaPromise;
      const resolved = await resolveProgressSource(appUserId, identity);
      if (!resolved) {
        throw new DictionaryStudyProgressSourceError();
      }

      const conflictTarget = resolved.sourceMessageId
        ? `(app_user_id, workspace_id, source_category_id, source_message_id)
           where source_message_id is not null and dictionary_id is null`
        : `(app_user_id, workspace_id, source_category_id, dictionary_id)
           where source_message_id is null and dictionary_id is not null`;

      const { rows } = await pool.query<DictionaryStudyProgressRow>(
        `
          insert into public.dictionary_study_progress (
            app_user_id,
            workspace_id,
            source_category_id,
            source_message_id,
            dictionary_id,
            progress_data
          )
          values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::jsonb)
          on conflict ${conflictTarget}
          do update set
            progress_data = excluded.progress_data,
            updated_at = now()
          returning progress_data
        `,
        [
          appUserId,
          resolved.workspaceId,
          resolved.sourceCategoryId,
          resolved.sourceMessageId,
          resolved.dictionaryId,
          JSON.stringify(progress),
        ]
      );

      return (
        normalizePersistedDictionaryStudyProgress(rows[0]?.progress_data) ??
        progress
      );
    },
  };
}
