import "server-only";

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import { getPostgresPool } from "@/lib/db/postgres";
import { assertValidPasswordCandidate, verifyPassword } from "@/lib/auth/password";
import { annotateTentativeBlocks, applyProposalChanges, buildPlannerProposal, normalizePlannerItem, normalizePlannerProfile, plannerCompletionRangeSuggestion, plannerCompletionSuggestion } from "@/lib/planner/engine";
import { buildPlannerSleepBlocks, normalizePlannerSleepEvent, plannerSleepDurationSuggestion, plannerSleepHealthNotice, sleepWindowForWakeDate } from "@/lib/planner/sleep";
import {
  createDefaultPlannerProfile,
  type PlannerBlock,
  type PlannerBlockStatus,
  type PlannerBootstrap,
  type PlannerDeferredRemainder,
  type PlannerItem,
  type PlannerProfile,
  type PlannerProposal,
  type PlannerProposalInput,
  type PlannerSleepEvent,
  type PlannerSleepCheckInInput,
  type PlannerSleepCheckInResult,
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
  availability_overrides: PlannerProfile["availabilityOverrides"];
  energy_windows: PlannerProfile["energyWindows"];
  sleep_schedule: PlannerProfile["sleepSchedule"];
  planning_policy: PlannerProfile["planningPolicy"];
  assistant_setup_version: number;
  revision: string | number;
  onboarding_completed: boolean;
};

type SleepEventRow = {
  wake_date: Date | string;
  event_kind: PlannerSleepEvent["eventKind"];
  state: PlannerSleepEvent["state"];
  actual_start_at: Date | string | null;
  projected_end_at: Date | string | null;
  actual_end_at: Date | string | null;
  estimated_start_from_at: Date | string | null;
  estimated_start_to_at: Date | string | null;
  planned_start_at: Date | string | null;
  planned_end_at: Date | string | null;
  planned_duration_minutes: number | null;
  selection_reason: PlannerSleepEvent["selectionReason"] | null;
  borrowed_minutes: number;
  restedness: PlannerSleepEvent["restedness"] | null;
  sleepiness_level: PlannerSleepEvent["sleepinessLevel"] | null;
  feedback_text: string;
  recovery_night: boolean;
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
  uncertainty_policy: PlannerItem["uncertaintyPolicy"];
  commitment_level: PlannerItem["commitmentLevel"];
  planning_rank: number;
  earliest_at: Date | string | null;
  deadline_at: Date | string | null;
  deadline_type: PlannerItem["deadlineType"];
  target_finish_at: Date | string | null;
  target_finish_mode: PlannerItem["targetFinishMode"];
  estimate_confidence: PlannerItem["estimateConfidence"];
  deadline_policy: PlannerItem["deadlinePolicy"];
  milestones: PlannerItem["milestones"];
  allowed_windows: PlannerItem["allowedWindows"];
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
  role: PlannerBlock["role"];
  end_estimate: PlannerBlock["endEstimate"] | null;
  soft: boolean;
  occurrence_key: string | null;
  actual_start_at: Date | string | null;
  actual_end_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type DeferredRemainderRow = {
  id: string;
  item_id: string | null;
  source_block_id: string | null;
  occurrence_key: string | null;
  title: string;
  total_minutes: number;
  pending_minutes: number;
  scheduled_minutes: number;
  expires_at: Date | string;
  resolved_at: Date | string | null;
  resolution: PlannerDeferredRemainder["resolution"] | null;
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

const ITEM_COLUMNS = `id,kind,title,notes,area,location,priority,energy,estimate_minutes,uncertainty_policy,commitment_level,planning_rank,
  earliest_at,deadline_at,deadline_type,target_finish_at,target_finish_mode,estimate_confidence,
  deadline_policy,milestones,allowed_windows,preferred_windows,avoided_windows,can_split,min_chunk_minutes,
  buffer_before_minutes,buffer_after_minutes,recurrence,auto_plan,status,unplaced_reason,created_at,updated_at`;
const BLOCK_COLUMNS = `id,item_id,title,start_at,end_at,status,source,fixed,role,end_estimate,soft,occurrence_key,
  actual_start_at,actual_end_at,created_at,updated_at`;

let plannerSchemaPromise: Promise<void> | null = null;

async function ensurePlannerSchema(executor: SqlExecutor): Promise<void> {
  if (plannerSchemaPromise) return plannerSchemaPromise;

  plannerSchemaPromise = (async () => {
    await executor.query(`
      alter table if exists public.planner_profiles
        add column if not exists availability_overrides jsonb not null default '{}'::jsonb
    `);
    await executor.query(`
      alter table if exists public.planner_items
        add column if not exists allowed_windows jsonb not null default '[]'::jsonb,
        add column if not exists uncertainty_policy jsonb not null default '{}'::jsonb,
        add column if not exists commitment_level text not null default 'required',
        add column if not exists planning_rank integer not null default 0
    `);
    await executor.query(`
      alter table if exists public.planner_blocks
        add column if not exists role text not null default 'work',
        add column if not exists end_estimate jsonb null,
        add column if not exists soft boolean not null default false
    `);
    await executor.query(`
      alter table if exists public.planner_blocks drop constraint if exists planner_blocks_role_check;
      alter table if exists public.planner_blocks add constraint planner_blocks_role_check
        check (role in ('work', 'uncertainty_reserve', 'calibration', 'protected_free'))
    `);
    await executor.query(`
      create table if not exists public.planner_deferred_remainders (
        app_user_id uuid not null references public.app_users(id) on delete cascade,
        id text not null check (char_length(trim(id)) between 1 and 160),
        item_id text null,
        source_block_id text null,
        occurrence_key text null,
        title text not null check (char_length(trim(title)) between 1 and 160),
        total_minutes integer not null check (total_minutes between 1 and 600000),
        pending_minutes integer not null check (pending_minutes between 0 and 600000),
        scheduled_minutes integer not null default 0 check (scheduled_minutes between 0 and 600000),
        expires_at timestamptz not null,
        resolved_at timestamptz null,
        resolution text null check (resolution is null or resolution in ('scheduled', 'cancelled')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (app_user_id, id)
      );
      alter table public.planner_deferred_remainders
        add column if not exists occurrence_key text null;
      create index if not exists planner_deferred_remainders_user_expiry_idx
        on public.planner_deferred_remainders(app_user_id, expires_at, resolved_at)
    `);
    await executor.query(`
      alter table if exists public.planner_items drop constraint if exists planner_items_estimate_minutes_check;
      alter table if exists public.planner_items add constraint planner_items_estimate_minutes_check
        check (estimate_minutes between 5 and 600000);
      alter table if exists public.planner_items drop constraint if exists planner_items_buffer_before_minutes_check;
      alter table if exists public.planner_items add constraint planner_items_buffer_before_minutes_check
        check (buffer_before_minutes between 0 and 1440);
      alter table if exists public.planner_items drop constraint if exists planner_items_buffer_after_minutes_check;
      alter table if exists public.planner_items add constraint planner_items_buffer_after_minutes_check
        check (buffer_after_minutes between 0 and 1440)
    `);
    await executor.query(`
      alter table if exists public.planner_sleep_events drop constraint if exists planner_sleep_events_planned_duration_minutes_check;
      alter table if exists public.planner_sleep_events drop constraint if exists planner_sleep_events_planned_duration_check;
      alter table if exists public.planner_sleep_events add constraint planner_sleep_events_planned_duration_check
        check (planned_duration_minutes is null or planned_duration_minutes between 15 and 960);
      alter table if exists public.planner_sleep_events drop constraint if exists planner_sleep_events_selection_reason_check;
      alter table if exists public.planner_sleep_events add constraint planner_sleep_events_selection_reason_check
        check (selection_reason is null or selection_reason in ('preference', 'workload', 'hard_deadline', 'recovery', 'manual', 'activation_transition'))
    `);
  })().catch((error) => {
    plannerSchemaPromise = null;
    throw error;
  });

  return plannerSchemaPromise;
}

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
    availabilityOverrides: row.availability_overrides,
    energyWindows: row.energy_windows,
    sleepSchedule: row.sleep_schedule,
    planningPolicy: row.planning_policy,
    assistantSetupVersion: row.assistant_setup_version,
    revision: Number(row.revision),
    onboardingCompleted: row.onboarding_completed,
  });
}

function sleepEventFromRow(row: SleepEventRow): PlannerSleepEvent {
  return {
    wakeDate: row.wake_date instanceof Date ? row.wake_date.toISOString().slice(0, 10) : String(row.wake_date).slice(0, 10),
    eventKind: row.event_kind,
    state: row.state,
    actualStartAt: toIso(row.actual_start_at),
    projectedEndAt: toIso(row.projected_end_at),
    actualEndAt: toIso(row.actual_end_at),
    estimatedStartFromAt: toIso(row.estimated_start_from_at),
    estimatedStartToAt: toIso(row.estimated_start_to_at),
    plannedStartAt: toIso(row.planned_start_at),
    plannedEndAt: toIso(row.planned_end_at),
    plannedDurationMinutes: row.planned_duration_minutes ?? undefined,
    selectionReason: row.selection_reason ?? undefined,
    borrowedMinutes: row.borrowed_minutes,
    restedness: row.restedness ?? undefined,
    sleepinessLevel: row.sleepiness_level ?? undefined,
    feedbackText: row.feedback_text || undefined,
    recoveryNight: row.recovery_night,
    transitionNight: row.selection_reason === "activation_transition",
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
    uncertaintyPolicy: row.uncertainty_policy,
    commitmentLevel: row.commitment_level,
    planningRank: row.planning_rank,
    earliestAt: toIso(row.earliest_at),
    deadlineAt: toIso(row.deadline_at),
    deadlineType: row.deadline_type,
    targetFinishAt: toIso(row.target_finish_at),
    targetFinishMode: row.target_finish_mode,
    estimateConfidence: row.estimate_confidence,
    deadlinePolicy: row.deadline_policy,
    milestones: row.milestones,
    allowedWindows: row.allowed_windows,
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
    role: row.role,
    endEstimate: row.end_estimate ?? undefined,
    soft: row.soft,
    occurrenceKey: row.occurrence_key ?? undefined,
    actualStartAt: toIso(row.actual_start_at),
    actualEndAt: toIso(row.actual_end_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function deferredRemainderFromRow(row: DeferredRemainderRow): PlannerDeferredRemainder {
  return {
    id: row.id,
    itemId: row.item_id ?? undefined,
    sourceBlockId: row.source_block_id ?? undefined,
    occurrenceKey: row.occurrence_key ?? undefined,
    title: row.title,
    totalMinutes: Number(row.total_minutes),
    pendingMinutes: Number(row.pending_minutes),
    scheduledMinutes: Number(row.scheduled_minutes),
    createdAt: toIso(row.created_at)!,
    expiresAt: toIso(row.expires_at)!,
    resolvedAt: toIso(row.resolved_at),
    resolution: row.resolution ?? undefined,
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
       availability,availability_overrides,energy_windows,sleep_schedule,planning_policy,assistant_setup_version,onboarding_completed
     ) values ($1::uuid,$2::text,$3::text,$4::numeric,$5::integer,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,0,false)
     on conflict (app_user_id) do update set app_user_id = excluded.app_user_id
     returning app_user_id,timezone,horizon,reserve_ratio,default_buffer_minutes,
       availability,availability_overrides,energy_windows,sleep_schedule,planning_policy,assistant_setup_version,revision,onboarding_completed`,
    [
      userId,
      defaults.timezone,
      defaults.horizon,
      defaults.reserveRatio,
      defaults.defaultBufferMinutes,
      JSON.stringify(defaults.availability),
      JSON.stringify(defaults.availabilityOverrides),
      JSON.stringify(defaults.energyWindows),
      JSON.stringify(defaults.sleepSchedule),
      JSON.stringify(defaults.planningPolicy),
    ]
  );
  return profileFromRow(rows[0]);
}

async function listSleepEvents(executor: SqlExecutor, userId: string): Promise<PlannerSleepEvent[]> {
  const { rows } = await executor.query<SleepEventRow>(
    `select wake_date,event_kind,state,actual_start_at,projected_end_at,actual_end_at,
       estimated_start_from_at,estimated_start_to_at,planned_start_at,planned_end_at,
       planned_duration_minutes,selection_reason,borrowed_minutes,restedness,sleepiness_level,
       feedback_text,recovery_night,created_at,updated_at
     from public.planner_sleep_events where app_user_id=$1::uuid order by wake_date asc`,
    [userId]
  );
  return rows.map(sleepEventFromRow);
}

async function insertSleepEvent(executor: SqlExecutor, userId: string, event: PlannerSleepEvent): Promise<void> {
  const normalized = normalizePlannerSleepEvent(event);
  await executor.query(
    `insert into public.planner_sleep_events(
       app_user_id,wake_date,event_kind,state,actual_start_at,projected_end_at,actual_end_at,
       estimated_start_from_at,estimated_start_to_at,planned_start_at,planned_end_at,
       planned_duration_minutes,selection_reason,borrowed_minutes,restedness,sleepiness_level,
       feedback_text,recovery_night
     ) values($1::uuid,$2::date,$3::text,$4::text,$5::timestamptz,$6::timestamptz,$7::timestamptz,
       $8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::integer,$13::text,
       $14::integer,$15::text,$16::integer,$17::text,$18::boolean)
     on conflict(app_user_id,wake_date) do update set
       event_kind=excluded.event_kind,state=excluded.state,actual_start_at=excluded.actual_start_at,
       projected_end_at=excluded.projected_end_at,actual_end_at=excluded.actual_end_at,
       estimated_start_from_at=excluded.estimated_start_from_at,
       estimated_start_to_at=excluded.estimated_start_to_at,planned_start_at=excluded.planned_start_at,
       planned_end_at=excluded.planned_end_at,planned_duration_minutes=excluded.planned_duration_minutes,
       selection_reason=excluded.selection_reason,borrowed_minutes=excluded.borrowed_minutes,
       restedness=excluded.restedness,sleepiness_level=excluded.sleepiness_level,
       feedback_text=excluded.feedback_text,
       recovery_night=excluded.recovery_night`,
    [userId,normalized.wakeDate,normalized.eventKind,normalized.state,normalized.actualStartAt ?? null,normalized.projectedEndAt ?? null,
      normalized.actualEndAt ?? null,normalized.estimatedStartFromAt ?? null,normalized.estimatedStartToAt ?? null,
      normalized.plannedStartAt ?? null,normalized.plannedEndAt ?? null,normalized.plannedDurationMinutes ?? null,
      normalized.selectionReason ?? null,normalized.borrowedMinutes ?? 0,normalized.restedness ?? null,
      normalized.sleepinessLevel ?? null,normalized.feedbackText ?? "",Boolean(normalized.recoveryNight)]
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

async function listDeferredRemainders(
  executor: SqlExecutor,
  userId: string
): Promise<PlannerDeferredRemainder[]> {
  const { rows } = await executor.query<DeferredRemainderRow>(
    `select id,item_id,source_block_id,occurrence_key,title,total_minutes,pending_minutes,scheduled_minutes,
       expires_at,resolved_at,resolution,created_at,updated_at
     from public.planner_deferred_remainders
     where app_user_id=$1::uuid order by created_at asc`,
    [userId]
  );
  return rows.map(deferredRemainderFromRow);
}

async function insertDeferredRemainder(
  executor: SqlExecutor,
  userId: string,
  remainder: PlannerDeferredRemainder
): Promise<void> {
  await executor.query(
    `insert into public.planner_deferred_remainders(
       app_user_id,id,item_id,source_block_id,occurrence_key,title,total_minutes,pending_minutes,scheduled_minutes,
       expires_at,resolved_at,resolution,created_at,updated_at
     ) values($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::integer,$8::integer,$9::integer,
       $10::timestamptz,$11::timestamptz,$12::text,$13::timestamptz,now())
     on conflict(app_user_id,id) do update set
       item_id=excluded.item_id,source_block_id=excluded.source_block_id,occurrence_key=excluded.occurrence_key,title=excluded.title,
       total_minutes=excluded.total_minutes,pending_minutes=excluded.pending_minutes,
       scheduled_minutes=excluded.scheduled_minutes,expires_at=excluded.expires_at,
       resolved_at=excluded.resolved_at,resolution=excluded.resolution,updated_at=now()`,
    [
      userId,remainder.id,remainder.itemId ?? null,remainder.sourceBlockId ?? null,remainder.occurrenceKey ?? null,remainder.title,
      remainder.totalMinutes,remainder.pendingMinutes,remainder.scheduledMinutes,remainder.expiresAt,
      remainder.resolvedAt ?? null,remainder.resolution ?? null,remainder.createdAt,
    ]
  );
}

function applyDeferredRemainderChanges(
  current: PlannerDeferredRemainder[],
  proposal: PlannerProposal
): PlannerDeferredRemainder[] {
  let next = [...current];
  for (const change of proposal.changes) {
    if (change.kind !== "add_deferred_remainder" && change.kind !== "update_deferred_remainder") continue;
    next = [...next.filter((candidate) => candidate.id !== change.remainder.id), change.remainder];
  }
  return next;
}

async function insertItem(executor: SqlExecutor, userId: string, value: PlannerItem): Promise<void> {
  const item = normalizePlannerItem(value);
  await executor.query(
    `insert into public.planner_items (
       app_user_id,id,kind,title,notes,area,location,priority,energy,estimate_minutes,uncertainty_policy,commitment_level,planning_rank,
       earliest_at,deadline_at,deadline_type,target_finish_at,target_finish_mode,estimate_confidence,
       deadline_policy,milestones,allowed_windows,preferred_windows,avoided_windows,can_split,min_chunk_minutes,
       buffer_before_minutes,buffer_after_minutes,recurrence,auto_plan,status,unplaced_reason
     ) values (
       $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::integer,$11::jsonb,$12::text,$13::integer,
       $14::timestamptz,$15::timestamptz,$16::text,$17::timestamptz,$18::text,$19::text,
       $20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,$25::boolean,$26::integer,
       $27::integer,$28::integer,$29::jsonb,$30::boolean,$31::text,$32::text
     ) on conflict (app_user_id,id) do update set
       kind=excluded.kind,title=excluded.title,notes=excluded.notes,area=excluded.area,
       location=excluded.location,priority=excluded.priority,energy=excluded.energy,
       estimate_minutes=excluded.estimate_minutes,uncertainty_policy=excluded.uncertainty_policy,
       commitment_level=excluded.commitment_level,planning_rank=excluded.planning_rank,earliest_at=excluded.earliest_at,
       deadline_at=excluded.deadline_at,deadline_type=excluded.deadline_type,
       target_finish_at=excluded.target_finish_at,target_finish_mode=excluded.target_finish_mode,
       estimate_confidence=excluded.estimate_confidence,deadline_policy=excluded.deadline_policy,
       milestones=excluded.milestones,allowed_windows=excluded.allowed_windows,
       preferred_windows=excluded.preferred_windows,
       avoided_windows=excluded.avoided_windows,can_split=excluded.can_split,
       min_chunk_minutes=excluded.min_chunk_minutes,buffer_before_minutes=excluded.buffer_before_minutes,
       buffer_after_minutes=excluded.buffer_after_minutes,recurrence=excluded.recurrence,
       auto_plan=excluded.auto_plan,status=excluded.status,unplaced_reason=excluded.unplaced_reason`,
    [
      userId, item.id, item.kind, item.title, item.notes ?? "", item.area ?? "", item.location ?? "",
      item.priority, item.energy, item.estimateMinutes, JSON.stringify(item.uncertaintyPolicy), item.commitmentLevel, item.planningRank,
      item.earliestAt ?? null, item.deadlineAt ?? null,item.deadlineType,item.targetFinishAt ?? null,item.targetFinishMode,item.estimateConfidence,
      JSON.stringify(item.deadlinePolicy),JSON.stringify(item.milestones),JSON.stringify(item.allowedWindows),
      JSON.stringify(item.preferredWindows), JSON.stringify(item.avoidedWindows), item.canSplit,
      item.minChunkMinutes, item.bufferBeforeMinutes, item.bufferAfterMinutes,
      item.recurrence ? JSON.stringify(item.recurrence) : null, item.autoPlan, item.status, item.unplacedReason ?? "",
    ]
  );
}

async function insertBlock(executor: SqlExecutor, userId: string, block: PlannerBlock): Promise<void> {
  await executor.query(
    `insert into public.planner_blocks (
       app_user_id,id,item_id,title,start_at,end_at,status,source,fixed,role,end_estimate,soft,occurrence_key,
       actual_start_at,actual_end_at
     ) values ($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz,$6::timestamptz,
       $7::text,$8::text,$9::boolean,$10::text,$11::jsonb,$12::boolean,$13::text,$14::timestamptz,$15::timestamptz)
     on conflict (app_user_id,id) do update set
       item_id=excluded.item_id,title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,
       status=excluded.status,source=excluded.source,fixed=excluded.fixed,role=excluded.role,end_estimate=excluded.end_estimate,soft=excluded.soft,
       occurrence_key=excluded.occurrence_key,actual_start_at=excluded.actual_start_at,
       actual_end_at=excluded.actual_end_at`,
    [
      userId, block.id, block.itemId ?? null, block.title, block.startAt, block.endAt,
      block.status, block.source, block.fixed, block.role ?? "work", block.endEstimate ? JSON.stringify(block.endEstimate) : null, Boolean(block.soft), block.occurrenceKey ?? null,
      block.actualStartAt ?? null, block.actualEndAt ?? null,
    ]
  );
}

async function lockProfile(client: PoolClient, userId: string): Promise<PlannerProfile> {
  await ensureProfile(client, userId);
  const { rows } = await client.query<ProfileRow>(
    `select app_user_id,timezone,horizon,reserve_ratio,default_buffer_minutes,
       availability,availability_overrides,energy_windows,sleep_schedule,planning_policy,assistant_setup_version,revision,onboarding_completed
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
  undoChangeSet(userId: string, changeSetId: string): Promise<number>;
  importLegacy(userId: string, sources: Array<{ sourceKey: string; title: string; items: PlannerItem[]; blocks: PlannerBlock[] }>, expectedRevision: number): Promise<{ revision: number; importedSources: number; importedItems: number; importedBlocks: number }>;
  checkInSleep(userId: string, input: PlannerSleepCheckInInput): Promise<PlannerSleepCheckInResult>;
  resetPlanner(userId: string, password: unknown, expectedRevision: number): Promise<number>;
};

function createPlannerStore(): PlannerStore {
  const pool = getPostgresPool();
  return {
    async getBootstrap(userId, from, to) {
      const profile = await ensureProfile(pool, userId);
      const [items, blocks, sleepEvents, deferredRemainders, latest] = await Promise.all([
        listItems(pool, userId),
        listBlocks(pool, userId, from, to),
        listSleepEvents(pool, userId),
        listDeferredRemainders(pool, userId),
        pool.query<{ id: string }>(
          `select id from public.planner_change_sets
           where app_user_id=$1::uuid and undone_at is null
           order by created_at desc limit 1`,
          [userId]
        ),
      ]);
      const annotatedBlocks = annotateTentativeBlocks(items, blocks);
      const durationSuggestions = items.flatMap((item) => {
        const suggestedMinutes = plannerCompletionSuggestion(item, annotatedBlocks);
        const suggestedRange = plannerCompletionRangeSuggestion(item, annotatedBlocks);
        return suggestedMinutes === null && suggestedRange === null ? [] : [{
          itemId: item.id,
          title: item.title,
          currentMinutes: item.estimateMinutes,
          suggestedMinutes: suggestedRange?.likelyMinutes ?? suggestedMinutes!,
          suggestedRange: suggestedRange ?? undefined,
        }];
      });
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: profile.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const sleepBlocks = buildPlannerSleepBlocks(profile, sleepEvents, today, new Date(Date.now() + 35 * 86_400_000).toISOString().slice(0, 10));
      const sleepDurationSuggestion = plannerSleepDurationSuggestion(profile.sleepSchedule, sleepEvents, today);
      const sleepHealthNotice = plannerSleepHealthNotice(profile, sleepEvents, today);
      return { profile, items, blocks: annotatedBlocks, sleepEvents, sleepBlocks, deferredRemainders, latestChangeSetId: latest.rows[0]?.id, durationSuggestions, sleepDurationSuggestion, sleepHealthNotice };
    },
    async updateSettings(userId, patch, expectedRevision) {
      return withTransaction(pool, async (client) => {
        const current = await lockProfile(client, userId);
        if (current.revision !== expectedRevision) throw new PlannerRevisionError();
        const next = normalizePlannerProfile({ ...current, ...patch, userId, revision: current.revision + 1 });
        if (next.sleepSchedule.mode === "adaptive" && next.sleepSchedule.requiresHealthyMinimumConfirmation) {
          throw new Error("Подтвердите пробную цель 7 часов или выберите ручной фиксированный режим.");
        }
        const { rows } = await client.query<ProfileRow>(
          `update public.planner_profiles set timezone=$2::text,horizon=$3::text,
             reserve_ratio=$4::numeric,default_buffer_minutes=$5::integer,
             availability=$6::jsonb,availability_overrides=$7::jsonb,energy_windows=$8::jsonb,
             sleep_schedule=$9::jsonb,planning_policy=$10::jsonb,assistant_setup_version=$11::integer,
             onboarding_completed=$12::boolean,revision=revision+1
           where app_user_id=$1::uuid
           returning app_user_id,timezone,horizon,reserve_ratio,default_buffer_minutes,
             availability,availability_overrides,energy_windows,sleep_schedule,planning_policy,assistant_setup_version,revision,onboarding_completed`,
          [userId,next.timezone,next.horizon,next.reserveRatio,next.defaultBufferMinutes,
            JSON.stringify(next.availability),JSON.stringify(next.availabilityOverrides),JSON.stringify(next.energyWindows),JSON.stringify(next.sleepSchedule),JSON.stringify(next.planningPolicy),
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
      const [items, blocks, sleepEvents, deferredRemainders] = await Promise.all([
        listItems(pool, userId), listBlocks(pool, userId), listSleepEvents(pool, userId), listDeferredRemainders(pool, userId),
      ]);
      const proposal = buildPlannerProposal({ profile, items, blocks, sleepEvents, deferredRemainders, ...input });
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
        if (proposal.conflicts.length > 0 || proposal.decisionGroups?.some((group) => group.blocking)) {
          throw new PlannerConflictError();
        }
        const [beforeItems, beforeBlocks, beforeSleepEvents, beforeDeferredRemainders] = await Promise.all([
          listItems(client, userId), listBlocks(client, userId), listSleepEvents(client, userId), listDeferredRemainders(client, userId),
        ]);
        const applied = applyProposalChanges(beforeItems, beforeBlocks, proposal);
        const appliedRemainders = applyDeferredRemainderChanges(beforeDeferredRemainders, proposal);
        await client.query(`delete from public.planner_blocks where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_items where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_deferred_remainders where app_user_id=$1::uuid`, [userId]);
        for (const item of applied.items) await insertItem(client, userId, item);
        for (const block of applied.blocks) await insertBlock(client, userId, block);
        for (const remainder of appliedRemainders) await insertDeferredRemainder(client, userId, remainder);
        const profileChange = proposal.changes.find((change) => change.kind === "update_profile");
        if (profileChange?.kind === "update_profile") {
          const next = normalizePlannerProfile({ ...profileChange.profile, revision: current.revision });
          await client.query(
            `update public.planner_profiles set timezone=$2::text,horizon=$3::text,
               reserve_ratio=$4::numeric,default_buffer_minutes=$5::integer,
               availability=$6::jsonb,availability_overrides=$7::jsonb,energy_windows=$8::jsonb,sleep_schedule=$9::jsonb,
               planning_policy=$10::jsonb,assistant_setup_version=$11::integer,onboarding_completed=$12::boolean
             where app_user_id=$1::uuid`,
            [userId,next.timezone,next.horizon,next.reserveRatio,next.defaultBufferMinutes,
              JSON.stringify(next.availability),JSON.stringify(next.availabilityOverrides),JSON.stringify(next.energyWindows),JSON.stringify(next.sleepSchedule),JSON.stringify(next.planningPolicy),
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
            JSON.stringify({ profile: current, items: beforeItems, blocks: beforeBlocks, sleepEvents: beforeSleepEvents, deferredRemainders: beforeDeferredRemainders })]
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
    async undoChangeSet(userId, changeSetId) {
      return withTransaction(pool, async (client) => {
        const current = await lockProfile(client, userId);
        const { rows } = await client.query<{
          id: string; to_revision: string | number; inverse_snapshot: {
            profile?: PlannerProfile; items: PlannerItem[]; blocks: PlannerBlock[]; sleepEvents?: PlannerSleepEvent[];
            deferredRemainders?: PlannerDeferredRemainder[];
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
        await client.query(`delete from public.planner_deferred_remainders where app_user_id=$1::uuid`, [userId]);
        for (const item of change.inverse_snapshot.items) await insertItem(client, userId, item);
        for (const block of change.inverse_snapshot.blocks) await insertBlock(client, userId, block);
        for (const remainder of change.inverse_snapshot.deferredRemainders ?? []) await insertDeferredRemainder(client, userId, remainder);
        if (change.inverse_snapshot.sleepEvents) {
          await client.query(`delete from public.planner_sleep_events where app_user_id=$1::uuid`, [userId]);
          for (const event of change.inverse_snapshot.sleepEvents) await insertSleepEvent(client, userId, event);
        }
        if (change.inverse_snapshot.profile) {
          const previous = normalizePlannerProfile(change.inverse_snapshot.profile);
          await client.query(
            `update public.planner_profiles set timezone=$2::text,horizon=$3::text,
               reserve_ratio=$4::numeric,default_buffer_minutes=$5::integer,
               availability=$6::jsonb,availability_overrides=$7::jsonb,energy_windows=$8::jsonb,sleep_schedule=$9::jsonb,
               planning_policy=$10::jsonb,assistant_setup_version=$11::integer,onboarding_completed=$12::boolean
             where app_user_id=$1::uuid`,
            [userId,previous.timezone,previous.horizon,previous.reserveRatio,previous.defaultBufferMinutes,
              JSON.stringify(previous.availability),JSON.stringify(previous.availabilityOverrides),JSON.stringify(previous.energyWindows),JSON.stringify(previous.sleepSchedule),JSON.stringify(previous.planningPolicy),
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
    async checkInSleep(userId, input) {
      return withTransaction(pool, async (client) => {
        const profile = await lockProfile(client, userId);
        if (profile.revision !== input.expectedRevision) throw new PlannerRevisionError();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.wakeDate)) throw new Error("Некорректная дата пробуждения.");
        if (![0, 1, 2, 3, 4].includes(input.sleepinessLevel)) {
          throw new Error("Подтвердите степень сонливости по шкале от 0 до 4.");
        }
        const events = await listSleepEvents(client, userId);
        const existing = events.find((event) => event.wakeDate === input.wakeDate);
        if (existing?.state === "tentative") {
          throw new Error("Сначала подтвердите фактическое засыпание и пробуждение через «Уже проснулся».");
        }
        const planned = sleepWindowForWakeDate(profile.sleepSchedule, input.wakeDate, profile.timezone);
        const derivedBlock = buildPlannerSleepBlocks(profile, events, input.wakeDate, input.wakeDate)
          .find((block) => block.wakeDate === input.wakeDate);
        const actualStartAt = input.actualStartAt
          ? new Date(input.actualStartAt).toISOString()
          : existing?.actualStartAt ?? planned.startAt;
        const actualEndAt = input.actualEndAt
          ? new Date(input.actualEndAt).toISOString()
          : existing?.actualEndAt ?? existing?.projectedEndAt ?? planned.endAt;
        if (new Date(actualEndAt) <= new Date(actualStartAt)) throw new Error("Пробуждение должно быть позже засыпания.");
        const event: PlannerSleepEvent = {
          ...existing,
          wakeDate: input.wakeDate,
          eventKind: "check_in",
          state: "completed",
          actualStartAt,
          projectedEndAt: actualEndAt,
          actualEndAt,
          restedness: input.restedness ?? (input.sleepinessLevel === 0
            ? "well_rested"
            : input.sleepinessLevel === 1
              ? "okay"
              : "not_rested"),
          sleepinessLevel: input.sleepinessLevel,
          feedbackText: input.feedbackText?.trim().slice(0, 1000),
          recoveryNight: existing?.recoveryNight ?? derivedBlock?.recoveryNight,
        };
        await insertSleepEvent(client, userId, event);
        const revision = await bumpRevision(client, userId);
        const nextEvents = [...events.filter((candidate) => candidate.wakeDate !== event.wakeDate), event];
        const suggestion = plannerSleepDurationSuggestion(profile.sleepSchedule, nextEvents, input.wakeDate);
        return { event, revision, suggestion };
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
        await client.query(`delete from public.planner_deferred_remainders where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_sleep_events where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_proposals where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_change_sets where app_user_id=$1::uuid`, [userId]);
        await client.query(`delete from public.planner_legacy_imports where app_user_id=$1::uuid`, [userId]);
        const defaults = createDefaultPlannerProfile(current.timezone);
        const { rows: updated } = await client.query<{ revision: string | number }>(
          `update public.planner_profiles set horizon=$2::text,reserve_ratio=$3::numeric,
             default_buffer_minutes=$4::integer,availability=$5::jsonb,availability_overrides=$6::jsonb,energy_windows=$7::jsonb,
             sleep_schedule=$8::jsonb,planning_policy=$9::jsonb,assistant_setup_version=0,onboarding_completed=false,
             revision=revision+1 where app_user_id=$1::uuid returning revision`,
          [userId,defaults.horizon,defaults.reserveRatio,defaults.defaultBufferMinutes,
            JSON.stringify(defaults.availability),JSON.stringify(defaults.availabilityOverrides),JSON.stringify(defaults.energyWindows),JSON.stringify(defaults.sleepSchedule),
            JSON.stringify(defaults.planningPolicy)]
        );
        return Number(updated[0].revision);
      });
    },
  };
}

let cachedPlannerStore: PlannerStore | null = null;

export async function getPlannerStore(): Promise<PlannerStore> {
  await ensurePlannerSchema(getPostgresPool());
  cachedPlannerStore ??= createPlannerStore();
  return cachedPlannerStore;
}
