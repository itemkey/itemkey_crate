import "server-only";

import { getPostgresPool } from "@/lib/db/postgres";
import { parseMessageScheduleContent, type SchedulePayload } from "@/lib/schedules";
import { convertLegacyScheduleSource, parseLegacyContinuousSchedules } from "@/lib/planner/legacy-conversion";
import type { PlannerBlock, PlannerItem, PlannerProfile } from "@/lib/planner/types";

export type PlannerLegacySource = {
  sourceKey: string;
  title: string;
  location: string;
  itemCount: number;
  blockCount: number;
  alreadyImported: boolean;
};

type LocatedSource = PlannerLegacySource & { payload: SchedulePayload };

async function locateSources(userId: string): Promise<LocatedSource[]> {
  const pool = getPostgresPool();
  const [categories, messages, imports] = await Promise.all([
    pool.query<{ id: string; title: string; content: string }>(
      `select c.id,c.title,c.content from public.categories c
       join public.workspaces w on w.id=c.workspace_id
       where w.owner_user_id=$1::uuid and c.content like '{%'`,
      [userId]
    ),
    pool.query<{ id: string; title: string; category_title: string; content: string }>(
      `select m.id,m.title,c.title as category_title,m.content
       from public.category_messages m
       join public.categories c on c.id=m.category_id and c.workspace_id=m.workspace_id
       join public.workspaces w on w.id=m.workspace_id
       where w.owner_user_id=$1::uuid and m.content like '{%'`,
      [userId]
    ),
    pool.query<{ source_key: string }>(
      `select source_key from public.planner_legacy_imports where app_user_id=$1::uuid`,
      [userId]
    ),
  ]);
  const imported = new Set(imports.rows.map((row) => row.source_key));
  const result: LocatedSource[] = [];
  for (const category of categories.rows) {
    for (const schedule of parseLegacyContinuousSchedules(category.content)) {
      const sourceKey = `continuous:${category.id}:${schedule.id}`;
      result.push({
        sourceKey,
        title: schedule.title,
        location: category.title,
        itemCount: schedule.payload.taskBase?.length ?? 0,
        blockCount: schedule.payload.events.length,
        alreadyImported: imported.has(sourceKey),
        payload: schedule.payload,
      });
    }
  }
  for (const message of messages.rows) {
    const payload = parseMessageScheduleContent(message.content);
    if (!payload) continue;
    const sourceKey = `message:${message.id}`;
    result.push({
      sourceKey,
      title: message.title,
      location: message.category_title,
      itemCount: payload.taskBase?.length ?? 0,
      blockCount: payload.events.length,
      alreadyImported: imported.has(sourceKey),
      payload,
    });
  }
  return result.sort((left, right) => left.location.localeCompare(right.location) || left.title.localeCompare(right.title));
}

export async function listPlannerLegacySources(userId: string): Promise<PlannerLegacySource[]> {
  return (await locateSources(userId)).map((source) => ({
    sourceKey: source.sourceKey,
    title: source.title,
    location: source.location,
    itemCount: source.itemCount,
    blockCount: source.blockCount,
    alreadyImported: source.alreadyImported,
  }));
}

export async function getPlannerLegacyImportData(
  userId: string,
  sourceKeys: string[],
  profile: PlannerProfile
): Promise<Array<{ sourceKey: string; title: string; items: PlannerItem[]; blocks: PlannerBlock[] }>> {
  const wanted = new Set(sourceKeys);
  const sources = (await locateSources(userId)).filter((source) => wanted.has(source.sourceKey) && !source.alreadyImported);
  return sources.map((source) => convertLegacyScheduleSource(source, profile));
}
