import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import { getPostgresPool } from "@/lib/db/postgres";
import { assertValidPasswordCandidate, verifyPassword } from "@/lib/auth/password";
import { applyProposalChanges, buildPlannerProposal, normalizePlannerItem, normalizePlannerProfile, plannerCompletionSuggestion } from "@/lib/planner/engine";
import { buildPlannerSleepBlocks } from "@/lib/planner/sleep";
import {
  createDefaultPlannerProfile,
  type PlannerBlock,
  type PlannerBlockStatus,
  type PlannerBootstrap,
  type PlannerItem,
  type PlannerProfile,
  type PlannerProposal,
  type PlannerProposalInput,
  type PlannerSleepEvent,
} from "@/lib/planner/types";
import { addIsoMinutes, isoDurationMinutes } from "@/lib/planner/time";

type SqlExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};

type ProfileRow = {
  app_user_id: string;
  timezone: string;
  horizon: PlannerProfile["horizon"];
  reserve_ratio: string | number;
  default_buffer_minutes: number;
  availability: PlannerProfile["availability"];
  energy_windows: PlannerProfile["energyWindows"];
  sleep_schedule: PlannerProfile["sleepSchedule"];
  assistant_setup_version: number;
  revision: string | number;
  onboarding_completed: boolean;
};

type SleepEventRow = {
  wake_date: Date | string;
  actual_start_at: Date | string;
  projected_end_at: Date | string;
  actual_end_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ItemRow = {
  id: string;
  kind: PlannerItem["kind"];
  title: string;
  notes: string;
  area: string;
  location: string;
  priority: PlannerItem["priority"];
  energy: PlannerItem["energy"];
  estimate_minutes: number;
  earliest_at: Date | string | null;
  deadline_at: Date | string | null;
  preferred_windows: PlannerItem["preferredWindows"];
  avoided_windows: PlannerItem["avoidedWindows"];
  can_split: boolean;
  min_chunk_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  recurrence: PlannerItem["recurrence"] | null;
  auto_plan: boolean;
  status: PlannerItem["status"];
  unplaced_reason: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type BlockRow = {
  id: string;
  item_id: string | null;
  title: string;
  start_at: Date | string;
  end_at: Date | string;
  status: PlannerBlock["status"];
  source: PlannerBlock["source"];
  fixed: boolean;
  occurrence_key: string | null;
  actual_start_at: Date | string | null;
  actual_end_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ProposalRow = {
  id: string;
  base_revision: string | number;
  proposal_data: PlannerProposal;
  expires_at: Date | string;
  applied_at: Date | string | null;
};

const ITEM_COLUMNS = `id,kind,title,notes,area,location,priority,energy,estimate_minutes,
  earliest_at,deadline_at,preferred_windows,avoided_windows,can_split,min_chunk_minutes,
  buffer_before_minutes,buffer_after_minutes,recurrence,auto_plan,status,unplaced_reason,created_at,updated_at`;
const BLOCK_COLUMNS = `id,item_id,title,start_at,end_at,status,source,fixed,occurrence_key,
  actual_start_at,actual_end_at,created_at,updated_at`;

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function profileFromRow(row: ProfileRow): PlannerProfile {
  return normalizePlannerProfile({
    userId: row.app_user_id,
    timezone: row.timezone,
    horizon: row.horizon,
    reserveRatio: Number(row.reserve_ratio),
    defaultBufferMinutes: row.default_buffer_minutes,
    availability: row.availability,
    energyWindows: row.energy_windows,
    sleepSchedule: row.sleep_schedule,
    assistantSetupVersion: row.assistant_setup_version,
    revision: Number(row.revision),
    onboardingCompleted: row.onboarding_completed,
  });
}

function sleepEventFromRow(row: SleepEventRow): PlannerSleepEvent {
  return {
    wakeDate: row.wake_date instanceof Date ? row.wake_date.toISOString().slice(0, 10) : String(row.wake_date).slice(0, 10),
    actualStartAt: toIso(row.actual_start_at)!,
    projectedEndAt: toIso(row.projected_end_at)!,
    actualEndAt: toIso(row.actual_end_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function itemFromRow(row: ItemRow): PlannerItem {
  return normalizePlannerItem({
    id: row.id,
    kind: row.kind,
    title: row.title,
    notes: row.notes || undefined,
    area: row.area || undefined,
    location: row.location || undefined,
    priority: row.priority,
    energy: row.energy,
    estimateMinutes: row.estimate_minutes,
    earliestAt: toIso(row.earliest_at),
    deadlineAt: toIso(row.deadline_at),
    preferredWindows: row.preferred_windows,
    avoidedWindows: row.avoided_windows,
    canSplit: row.can_split,
    minChunkMinutes: row.min_chunk_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    recurrence: row.recurrence ?? undefined,
    autoPlan: row.auto_plan,
    status: row.status,
    unplacedReason: row.unplaced_reason || undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function blockFromRow(row: BlockRow): PlannerBlock {
  return {
    id: row.id,
    itemId: row.item_id ?? undefined,
    title: row.title,
    startAt: toIso(row.start_at)!,
    endAt: toIso(row.end_at)!,
    status: row.status,
    source: row.source,
    fixed: row.fixed,
    occurrenceKey: row.occurrence_key ?? undefined,
    actualStartAt: toIso(row.actual_start_at),
    actualEndAt: toIso(row.actual_end_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function withTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
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

async function ensureProfile(executor: SqlExecutor, userId: string): Promise<PlannerProfile> {
  const defaults = createDefaultPlannerProfile("Europe/Minsk");
  const { rows } = await executor.query<ProfileRow>(
    `insert into public.planner_profiles (
       app_user_id,timezone,horizon,reserve_ratio,default_buffer_minutes,
       availability,energy_windows,sleep_schedule,assistant_setup_version,onboarding_completed
     ) values ($1::uuid,$2::text,$3::text,$4::numeric,$5::integer,$6::jsonb,$7::jsonb,$8::jsonb,0,false)
     on conflict (app_user_id) do update set app_user_id = excluded.app_user_id
     returning app_user_id,timezone,horizon,reserve_ratio,default_buffer_minutes,
       availability,energy_windows,sleep_schedule,assistant_setup_version,revision,onboarding_completed`,
    [
      userId,
      defaults.timezone,
      defaults.horizon,
      defaults.reserveRatio,
      defaults.defaultBufferMinutes,
      JSON.stringify(defaults.availability),
      JSON.stringify(defaults.energyWindows),
      JSON.stringify(defaults.sleepSchedule),
    ]
  );
  return profileFromRow(rows[0]);
}

async function listSleepEvents(executor: SqlExecutor, userId: string): Promise<PlannerSleepEvent[]> {
  const { rows } = await executor.query<SleepEventRow>(
    `select wake_date,actual_start_at,projected_end_at,actual_end_at,created_at,updated_at
     from public.planner_sleep_events where app_user_id=$1::uuid order by wake_date asc`,
    [userId]
  );
  return rows.map(sleepEventFromRow);
}

async function insertSleepEvent(executor: SqlExecutor, userId: string, event: PlannerSleepEvent): Promise<void> {
  await executor.query(
    `insert into public.planner_sleep_events(
       app_user_id,wake_date,actual_start_at,projected_end_at,actual_end_at
     ) values($1::uuid,$2::date,$3::timestamptz,$4::timestamptz,$5::timestamptz)
     on conflict(app_user_id,wake_date) do update set
       actual_start_at=excluded.actual_start_at,projected_end_at=excluded.projected_end_at,
       actual_end_at=excluded.actual_end_at`,
    [userId,event.wakeDate,event.actualStartAt,event.projectedEndAt,event.actualEndAt ?? null]
  );
}

async function listItems(executor: SqlExecutor, userId: string): Promise<PlannerItem[]> {
  const { rows } = await executor.query<ItemRow>(
    `select ${ITEM_COLUMNS} from public.planner_items
     where app_user_id = $1::uuid order by created_at asc`,
    [userId]
  );
  return rows.map(itemFromRow);
}

async function listBlocks(
  executor: SqlExecutor,
  userId: string,
  from?: string,
  to?: string
): Promise<PlannerBlock[]> {
  const { rows } = await executor.query<BlockRow>(
    `select ${BLOCK_COLUMNS} from public.planner_blocks
     where app_user_id = $1::uuid
       and ($2::timestamptz is null or end_at >= $2::timestamptz)
       and ($3::timestamptz is null or start_at <= $3::timestamptz)
     order by start_at asc, created_at asc`,
    [userId, from ?? null, to ?? null]
  );
  return rows.map(blockFromRow);
}

async function insertItem(executor: SqlExecutor, userId: string, value: PlannerItem): Promise<void> {
  const item = normalizePlannerItem(value);
  await executor.query(
    `insert into public.planner_items (
       app_user_id,id,kind,title,notes,area,location,priority,energy,estimate_minutes,
       earliest_at,deadline_at,preferred_windows,avoided_windows,can_split,min_chunk_minutes,
       buffer_before_minutes,buffer_after_minutes,recurrence,auto_plan,status,unplaced_reason
     ) values (
       $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::integer,
       $11::timestamptz,$12::timestamptz,$13::jsonb,$14::jsonb,$15::boolean,$16::integer,
       $17::integer,$18::integer,$19::jsonb,$20::boolean,$21::text,$22::text
     ) on conflict (app_user_id,id) do update set
       kind=excluded.kind,title=excluded.title,notes=excluded.notes,area=excluded.area,
       location=excluded.location,priority=excluded.priority,energy=excluded.energy,
       estimate_minutes=excluded.estimate_minutes,earliest_at=excluded.earliest_at,
       deadline_at=excluded.deadline_at,preferred_windows=excluded.preferred_windows,
       avoided_windows=excluded.avoided_windows,can_split=excluded.can_split,
       min_chunk_minutes=excluded.min_chunk_minutes,buffer_before_minutes=excluded.buffer_before_minutes,
       buffer_after_minutes=excluded.buffer_after_minutes,recurrence=excluded.recurrence,
       auto_plan=excluded.auto_plan,status=excluded.status,unplaced_reason=excluded.unplaced_reason`,
    [
      userId, item.id, item.kind, item.title, item.notes ?? "", item.area ?? "", item.location ?? "",
      item.priority, item.energy, item.estimateMinutes, item.earliestAt ?? null, item.deadlineAt ?? null,
      JSON.stringify(item.preferredWindows), JSON.stringify(item.avoidedWindows), item.canSplit,
      item.minChunkMinutes, item.bufferBeforeMinutes, item.bufferAfterMinutes,
      item.recurrence ? JSON.stringify(item.recurrence) : null, item.autoPlan, item.status, item.unplacedReason ?? "",
    ]
  );
}

async function insertBlock(executor: SqlExecutor, userId: string, block: PlannerBlock): Promise<void> {
  await executor.query(
    `insert into public.planner_blocks (
       app_user_id,id,item_id,title,start_at,end_at,status,source,fixed,occurrence_key,
       actual_start_at,actual_end_at
     ) values ($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz,$6::timestamptz,
       $7::text,$8::text,$9::boolean,$10::text,$11::timestamptz,$12::timestamptz)
     on conflict (app_user_id,id) do update set
       item_id=excluded.item_id,title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,
       status=excluded.status,source=excluded.source,fixed=excluded.fixed,
       occurrence_key=excluded.occurrence_key,actual_start_at=excluded.actual_start_at,
       actual_end_at=excluded.actual_end_at`,
    [
      userId, block.id, block.itemId ?? null, block.title, block.startAt, block.endAt,
      block.status, block.source, block.fixed, block.occurrenceKey ?? null,
      block.actualStartAt ?? null, block.actualEndAt ?? null,
    ]
  );
}

async function lockProfile(client: PoolClient, userId: string): Promise<PlannerProfile> {
  await ensureProfile(client, userId);
  const { rows } = await client.query<ProfileRow>(
    `select app_user_id,timezone,horizon,reserve_ratio,default_buffer_minutes,
       availability,energy_windows,sleep_schedule,assistant_setup_version,revision,onboarding_completed
     from public.planner_profiles where app_user_id=$1::uuid for update`,
    [userId]
  );
  return profileFromRow(rows[0]);
}

async function bumpRevision(client: PoolClient, userId: string): Promise<number> {
  const { rows } = await client.query<{ revision: string | number }>(
    `update public.planner_profiles set revision=revision+1
     where app_user_id=$1::uuid returning revision`,
    [userId]
  );
  return Number(rows[0].revision);
}

export class PlannerRevisionError extends Error {
  constructor() {
    super("План изменился на другом устройстве. Обновите данные и пересчитайте предложение.");
    this.name = "PlannerRevisionError";
  }
}

export class PlannerConflictError extends Error {
  constructor(message = "Изменение создаёт пересечение. Измените время или сначала пересоберите план.") {
    super(message);
    this.name = "PlannerConflictError";
  }
}

export class PlannerInvalidPasswordError extends Error {
  constructor() {
    super("Неверный пароль Item Key.");
    this.name = "PlannerInvalidPasswordError";
  }
}

export type PlannerStore = {
  getBootstrap(userId: string, from?: string, to?: string): Promise<PlannerBootstrap>;
  updateSettings(userId: string, patch: Partial<PlannerProfile>, expectedRevision: number): Promise<PlannerProfile>;
  saveItem(userId: string, item: PlannerItem, expectedRevision: number): Promise<{ item: PlannerItem; revision: number }>;
  archiveItem(userId: string, itemId: string, expectedRevision: number): Promise<number>;
  createProposal(userId: string, input: PlannerProposalInput): Promise<PlannerProposal>;
  applyProposal(userId: string, proposalId: string): Promise<{ revision: number; changeSetId: string }>;
  actOnBlock(userId: string, blockId: string, action: string, expectedRevision: number, minutes?: number): Promise<{ block: PlannerBlock; revision: number }>;
  moveBlock(userId: string, blockId: string, startAt: string, endAt: string, expectedRevision: number): Promise<{ block: PlannerBlock; revision: number }>;
  undoChangeSet(userId: string, changeSetId: string): Promise<number>;
  importLegacy(userId: string, sources: Array<{ sourceKey: string; title: string; items: PlannerItem[]; blocks: PlannerBlock[] }>, expectedRevision: number): Promise<{ revision: number; importedSources: number; importedItems: number; importedBlocks: number }>;
  resetPlanner(userId: string, password: unknown, expectedRevision: number): Promise<number>;
};

function createPlannerStore(): PlannerStore {
  const pool = getPostgresPool();
  return {
    async getBootstrap(userId, from, to) {
      const profile = await ensureProfile(pool, userId);
      const [items, blocks, sleepEvents, latest] = await Promise.all([
        listItems(pool, userId),
        listBlocks(pool, userId, from, to),
        listSleepEvents(pool, userId),
        pool.query<{ id: string }>(
          `select id from public.planner_change_sets
           where app_user_id=$1::uuid and undone_at is null
           order by created_at desc limit 1`,
          [userId]
        ),
      ]);
      const durationSuggestions = items.flatMap((item) => {
        const suggestedMinutes = plannerCompletionSuggestion(item, blocks);
        return suggestedMinutes === null ? [] : [{
          itemId: item.id,
          title: item.title,
          currentMinutes: item.estimateMinutes,
          suggestedMinutes,
        }];
      });
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: profile.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const sleepBlocks = buildPlannerSleepBlocks(profile, sleepEvents, today, new Date(Date.now() + 35 * 86_400_000).toISOString().slice(0, 10));
      return { profile, items, blocks, sleepEvents, sleepBlocks, latestChangeSetId: latest.rows[0]?.id, durationSuggestions };
    },
    async updateSettings(userId, patch, expectedRevision) {
      return withTransaction(pool, async (client) => {
        const current = await lockProfile(client, userId);
        if (current.revision !== expectedRevision) throw new PlannerRevisionError();
        const next = normalizePlannerProfile({ ...current, ...patch, userId, revision: current.revision + 1 });
        const { rows } = await client.query<ProfileRow>(
          `update public.planner_profiles set timezone=$2::text,horizon=$3::text,
             reserve_ratio=$4::numeric,default_buffer_minutes=$5::integer,
             availability=$6::jsonb,energy_windows=$7::jsonb,
             sleep_schedule=$8::jsonb,assistant_setup_version=$9::integer,
             onboarding_completed=$10::boolean,revision=revision+1
           where app_user_id=$1::uuid
           returning app_user_id,timezone,horizon,reserve_ratio,default_buffer_minutes,
             availability,energy_windows,sleep_schedule,assistant_setup_version,revision,onboarding_completed`,
          [userId,next.timezone,next.horizon,next.reserveRatio,next.defaultBufferMinutes,
            JSON.stringify(next.availability),JSON.stringify(next.energyWindows),JSON.stringify(next.sleepSchedule),
            next.assistantSetupVersion,next.onboardingCompleted]
        );
        return profileFromRow(rows[0]);
      });
    },
    async saveItem(userId, value, expectedRevision) {
      return withTransaction(pool, async (client) => {
        const current = await lockProfile(client, userId);
        if (current.revision !== expectedRevision) throw new PlannerRevisionError();
        const item = normalizePlannerItem({ ...value, id: value.id || randomUUID(), title: value.title });
        await insertItem(client, userId, item);
        const revision = await bumpRevision(client, userId);
        return { item, revision };
      });
    },
    async archiveItem(userId, itemId, expectedRevision) {
      return withTransaction(pool, async (client) => {
        const current = await lockProfile(client, userId);
        if (current.revision !== expectedRevision) throw new PlannerRevisionError();
        await client.query(
          `update public.planner_items set status='archived'
           where app_user_id=$1::uuid and id=$2::text`,
          [userId, itemId]
        );
        await client.query(
          `update public.planner_blocks set status='cancelled'
           where app_user_id=$1::uuid and item_id=$2::text
             and status='planned' and start_at>now()`,
          [userId, itemId]
        );
        return bumpRevision(client, userId);
      });
    },
    async createProposal(userId, input) {
      const profile = await ensureProfile(pool, userId);
      const [items, blocks, sleepEvents] = await Promise.all([listItems(pool, userId), listBlocks(pool, userId), listSleepEvents(pool, userId)]);
      const proposal = buildPlannerProposal({ profile, items, blocks, sleepEvents, ...input });
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      const stored = { ...proposal, id, expiresAt };
      await pool.query(
        `delete from public.planner_proposals
         where app_user_id=$1::uuid and (expires_at<=now() or applied_at is not null)`,
        [userId]
      );
      await pool.query(
        `insert into public.planner_proposals(id,app_user_id,base_revision,proposal_data,expires_at)
         values($1::uuid,$2::uuid,$3::bigint,$4::jsonb,$5::timestamptz)`,
        [id, userId, proposal.baseRevision, JSON.stringify(stored), expiresAt]
      );
      return stored;
    },
    async applyProposal(userId, proposalId) {
      return withTransaction(pool, async (client) => {
        const current = await lockProfile(client, userId);
        const { rows } = await client.query<ProposalRow>(
          `select id,base_revision,proposal_data,expires_at,applied_at
           from public.planner_proposals
           where id=$1::uuid and app_user_id=$2::uuid for update`,
          [proposalId, userId]
        );
        const row = rows[0];
        if (!row || row.applied_at || new Date(row.expires_at).getTime() <= Date.now()) {
          throw new Error("Предложение не найдено или устарело.");
        }
        if (Number(row.base_revision) !== current.revision) throw new PlannerRevisionError();
        const proposal = row.proposal_data;
        if (proposal.conflicts.length > 0) throw new PlannerConflictError();
        const [beforeItems, beforeBlocks, beforeSleepEvents] = await Promise.all([
          listItems(client, userId), listBlocks(client, userId), listSleepEvents(client, userId),
        ]);
        const applied = applyProposalChanges(beforeItems, beforeBlocks, proposal);
        await client.query(`delete from public.planner_blocks where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_items where app_user_id=$1::uuid`, [userId]);
        for (const item of applied.items) await insertItem(client, userId, item);
        for (const block of applied.blocks) await insertBlock(client, userId, block);
        const profileChange = proposal.changes.find((change) => change.kind === "update_profile");
        if (profileChange?.kind === "update_profile") {
          const next = normalizePlannerProfile({ ...profileChange.profile, revision: current.revision });
          await client.query(
            `update public.planner_profiles set timezone=$2::text,horizon=$3::text,
               reserve_ratio=$4::numeric,default_buffer_minutes=$5::integer,
               availability=$6::jsonb,energy_windows=$7::jsonb,sleep_schedule=$8::jsonb,
               assistant_setup_version=$9::integer,onboarding_completed=$10::boolean
             where app_user_id=$1::uuid`,
            [userId,next.timezone,next.horizon,next.reserveRatio,next.defaultBufferMinutes,
              JSON.stringify(next.availability),JSON.stringify(next.energyWindows),JSON.stringify(next.sleepSchedule),
              next.assistantSetupVersion,next.onboardingCompleted]
          );
        }
        for (const change of proposal.changes) {
          if (change.kind === "upsert_sleep_event") await insertSleepEvent(client, userId, change.event);
        }
        const revision = await bumpRevision(client, userId);
        const { rows: changeRows } = await client.query<{ id: string }>(
          `insert into public.planner_change_sets(
             app_user_id,from_revision,to_revision,trigger,changes,inverse_snapshot
           ) values($1::uuid,$2::bigint,$3::bigint,$4::text,$5::jsonb,$6::jsonb)
           returning id`,
          [userId,current.revision,revision,proposal.trigger,JSON.stringify(proposal.changes),
            JSON.stringify({ profile: current, items: beforeItems, blocks: beforeBlocks, sleepEvents: beforeSleepEvents })]
        );
        await client.query(`update public.planner_proposals set applied_at=now() where id=$1::uuid`, [proposalId]);
        return { revision, changeSetId: changeRows[0].id };
      });
    },
    async actOnBlock(userId, blockId, action, expectedRevision, minutes) {
      return withTransaction(pool, async (client) => {
        const profile = await lockProfile(client, userId);
        if (profile.revision !== expectedRevision) throw new PlannerRevisionError();
        const { rows } = await client.query<BlockRow>(
          `select ${BLOCK_COLUMNS} from public.planner_blocks
           where app_user_id=$1::uuid and id=$2::text for update`,
          [userId, blockId]
        );
        const current = rows[0] ? blockFromRow(rows[0]) : null;
        if (!current) throw new Error("Блок расписания не найден.");
        if (["done", "skipped", "cancelled"].includes(current.status)) {
          throw new Error("Завершённый блок больше нельзя изменить.");
        }
        let status: PlannerBlockStatus = current.status;
        let actualStartAt = current.actualStartAt;
        let actualEndAt = current.actualEndAt;
        let startAt = current.startAt;
        let endAt = current.endAt;
        if (action === "start") {
          status = "in_progress";
          actualStartAt = new Date().toISOString();
        } else if (action === "done") {
          status = "done";
          actualStartAt = actualStartAt ?? current.startAt;
          actualEndAt = new Date().toISOString();
        } else if (action === "skip") {
          status = "skipped";
          if (current.status === "in_progress") actualEndAt = new Date().toISOString();
        }
        else if (action === "pause") {
          const now = new Date().toISOString();
          const remaining = Math.max(15, Math.round(
            (new Date(current.endAt).getTime() - Date.now()) / 60_000
          ));
          status = "planned";
          actualEndAt = now;
          startAt = now;
          endAt = addIsoMinutes(now, remaining);
        }
        else if (action === "snooze") {
          const delay = Math.min(60, Math.max(15, Math.round(Number(minutes ?? 15) / 15) * 15));
          const actionNow = Date.now();
          const remaining = current.status === "in_progress"
            ? Math.max(15, Math.round((new Date(current.endAt).getTime() - actionNow) / 60_000))
            : isoDurationMinutes(current.startAt, current.endAt);
          startAt = new Date(Math.max(actionNow, new Date(current.startAt).getTime()) + delay * 60_000).toISOString();
          endAt = addIsoMinutes(startAt, remaining);
          if (current.status === "in_progress") {
            status = "planned";
            actualEndAt = new Date().toISOString();
          }
        } else throw new Error("Неизвестное действие с блоком.");
        if (action === "snooze") {
          const { rows: overlaps } = await client.query<{ id: string }>(
            `select id from public.planner_blocks
             where app_user_id=$1::uuid and id<>$2::text
               and status not in ('skipped','cancelled')
               and start_at<$4::timestamptz and end_at>$3::timestamptz limit 1`,
            [userId, blockId, startAt, endAt]
          );
          if (overlaps.length > 0) throw new PlannerConflictError();
        }
        const { rows: updated } = await client.query<BlockRow>(
          `update public.planner_blocks set status=$3::text,start_at=$4::timestamptz,
             end_at=$5::timestamptz,actual_start_at=$6::timestamptz,actual_end_at=$7::timestamptz
           where app_user_id=$1::uuid and id=$2::text returning ${BLOCK_COLUMNS}`,
          [userId,blockId,status,startAt,endAt,actualStartAt ?? null,actualEndAt ?? null]
        );
        if (action === "done" && current.itemId) {
          await client.query(
            `update public.planner_items set status='completed'
             where app_user_id=$1::uuid and id=$2::text and kind<>'routine'`,
            [userId, current.itemId]
          );
        }
        const revision = await bumpRevision(client, userId);
        return { block: blockFromRow(updated[0]), revision };
      });
    },
    async moveBlock(userId, blockId, startAt, endAt, expectedRevision) {
      return withTransaction(pool, async (client) => {
        const currentProfile = await lockProfile(client, userId);
        if (currentProfile.revision !== expectedRevision) throw new PlannerRevisionError();
        const start = new Date(startAt);
        const end = new Date(endAt);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
          throw new Error("Некорректное время блока.");
        }
        const { rows: conflicts } = await client.query<{ id: string }>(
          `select id from public.planner_blocks
           where app_user_id=$1::uuid and id<>$2::text
             and status not in ('skipped','cancelled')
             and start_at<$4::timestamptz and end_at>$3::timestamptz limit 1`,
          [userId, blockId, start.toISOString(), end.toISOString()]
        );
        if (conflicts.length > 0) throw new PlannerConflictError();
        const { rows } = await client.query<BlockRow>(
          `update public.planner_blocks set start_at=$3::timestamptz,end_at=$4::timestamptz,source='manual'
           where app_user_id=$1::uuid and id=$2::text and status='planned' and start_at>=now()
           returning ${BLOCK_COLUMNS}`,
          [userId, blockId, start.toISOString(), end.toISOString()]
        );
        if (!rows[0]) throw new Error("Блок расписания не найден или уже завершён.");
        const revision = await bumpRevision(client, userId);
        return { block: blockFromRow(rows[0]), revision };
      });
    },
    async undoChangeSet(userId, changeSetId) {
      return withTransaction(pool, async (client) => {
        const current = await lockProfile(client, userId);
        const { rows } = await client.query<{
          id: string; to_revision: string | number; inverse_snapshot: {
            profile?: PlannerProfile; items: PlannerItem[]; blocks: PlannerBlock[]; sleepEvents?: PlannerSleepEvent[];
          };
        }>(
          `select id,to_revision,inverse_snapshot from public.planner_change_sets
           where id=$1::uuid and app_user_id=$2::uuid and undone_at is null for update`,
          [changeSetId, userId]
        );
        const change = rows[0];
        if (!change || Number(change.to_revision) !== current.revision) throw new PlannerRevisionError();
        await client.query(`delete from public.planner_blocks where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_items where app_user_id=$1::uuid`, [userId]);
        for (const item of change.inverse_snapshot.items) await insertItem(client, userId, item);
        for (const block of change.inverse_snapshot.blocks) await insertBlock(client, userId, block);
        if (change.inverse_snapshot.sleepEvents) {
          await client.query(`delete from public.planner_sleep_events where app_user_id=$1::uuid`, [userId]);
          for (const event of change.inverse_snapshot.sleepEvents) await insertSleepEvent(client, userId, event);
        }
        if (change.inverse_snapshot.profile) {
          const previous = normalizePlannerProfile(change.inverse_snapshot.profile);
          await client.query(
            `update public.planner_profiles set timezone=$2::text,horizon=$3::text,
               reserve_ratio=$4::numeric,default_buffer_minutes=$5::integer,
               availability=$6::jsonb,energy_windows=$7::jsonb,sleep_schedule=$8::jsonb,
               assistant_setup_version=$9::integer,onboarding_completed=$10::boolean
             where app_user_id=$1::uuid`,
            [userId,previous.timezone,previous.horizon,previous.reserveRatio,previous.defaultBufferMinutes,
              JSON.stringify(previous.availability),JSON.stringify(previous.energyWindows),JSON.stringify(previous.sleepSchedule),
              previous.assistantSetupVersion,previous.onboardingCompleted]
          );
        }
        await client.query(`update public.planner_change_sets set undone_at=now() where id=$1::uuid`, [changeSetId]);
        return bumpRevision(client, userId);
      });
    },
    async importLegacy(userId, sources, expectedRevision) {
      return withTransaction(pool, async (client) => {
        const profile = await lockProfile(client, userId);
        if (profile.revision !== expectedRevision) throw new PlannerRevisionError();
        let importedSources = 0;
        let importedItems = 0;
        let importedBlocks = 0;
        for (const source of sources) {
          const claimed = await client.query<{ source_key: string }>(
            `insert into public.planner_legacy_imports(
               app_user_id,source_key,source_title,imported_item_ids,imported_block_ids
             ) values($1::uuid,$2::text,$3::text,$4::jsonb,$5::jsonb)
             on conflict (app_user_id,source_key) do nothing returning source_key`,
            [userId,source.sourceKey,source.title,JSON.stringify(source.items.map((item) => item.id)),JSON.stringify(source.blocks.map((block) => block.id))]
          );
          if (!claimed.rows[0]) continue;
          for (const item of source.items) await insertItem(client, userId, item);
          for (const block of source.blocks) await insertBlock(client, userId, block);
          importedSources += 1;
          importedItems += source.items.length;
          importedBlocks += source.blocks.length;
        }
        const revision = importedSources > 0 ? await bumpRevision(client, userId) : profile.revision;
        return { revision, importedSources, importedItems, importedBlocks };
      });
    },
    async resetPlanner(userId, rawPassword, expectedRevision) {
      const password = assertValidPasswordCandidate(rawPassword);
      return withTransaction(pool, async (client) => {
        const current = await lockProfile(client, userId);
        if (current.revision !== expectedRevision) throw new PlannerRevisionError();
        const { rows } = await client.query<{ password_hash: string }>(
          `select password_hash from public.app_users where id=$1::uuid for update`,
          [userId]
        );
        if (!rows[0] || !await verifyPassword(password, rows[0].password_hash)) {
          throw new PlannerInvalidPasswordError();
        }
        await client.query(`delete from public.planner_blocks where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_items where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_sleep_events where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_proposals where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_change_sets where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_legacy_imports where app_user_id=$1::uuid`, [userId]);
        const defaults = createDefaultPlannerProfile(current.timezone);
        const { rows: updated } = await client.query<{ revision: string | number }>(
          `update public.planner_profiles set horizon=$2::text,reserve_ratio=$3::numeric,
             default_buffer_minutes=$4::integer,availability=$5::jsonb,energy_windows=$6::jsonb,
             sleep_schedule=$7::jsonb,assistant_setup_version=0,onboarding_completed=false,
             revision=revision+1 where app_user_id=$1::uuid returning revision`,
          [userId,defaults.horizon,defaults.reserveRatio,defaults.defaultBufferMinutes,
            JSON.stringify(defaults.availability),JSON.stringify(defaults.energyWindows),JSON.stringify(defaults.sleepSchedule)]
        );
        return Number(updated[0].revision);
      });
    },
  };
}

let cachedPlannerStore: PlannerStore | null = null;

export async function getPlannerStore(): Promise<PlannerStore> {
  cachedPlannerStore ??= createPlannerStore();
  return cachedPlannerStore;
}
