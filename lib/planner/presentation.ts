import type { PlannerProposalImpact } from "./types.ts";
import { formatDateInTimeZone } from "./time.ts";

export type CalendarLayoutInput = {
  id: string;
  startMinute: number;
  durationMinutes: number;
  soft?: boolean;
};

export type CalendarLayoutEntry = CalendarLayoutInput & {
  lane: number;
  laneCount: number;
};

/**
 * Assigns visually overlapping calendar entries to side-by-side lanes.
 * Soft reserves deliberately stay full-width behind real work and do not
 * force readable blocks into narrower lanes.
 */
export function layoutCalendarEntries(
  entries: CalendarLayoutInput[],
  minimumVisualMinutes = 24
): CalendarLayoutEntry[] {
  const soft = entries.filter((entry) => entry.soft).map((entry) => ({ ...entry, lane: 0, laneCount: 1 }));
  const solid = entries
    .filter((entry) => !entry.soft)
    .map((entry) => ({
      ...entry,
      visualEnd: entry.startMinute + Math.max(entry.durationMinutes, minimumVisualMinutes),
    }))
    .sort((left, right) => left.startMinute - right.startMinute
      || left.visualEnd - right.visualEnd
      || left.id.localeCompare(right.id));
  const laidOut: CalendarLayoutEntry[] = [];

  for (let clusterStart = 0; clusterStart < solid.length;) {
    let clusterEnd = clusterStart + 1;
    let furthestEnd = solid[clusterStart].visualEnd;
    while (clusterEnd < solid.length && solid[clusterEnd].startMinute < furthestEnd) {
      furthestEnd = Math.max(furthestEnd, solid[clusterEnd].visualEnd);
      clusterEnd += 1;
    }

    const cluster = solid.slice(clusterStart, clusterEnd);
    const laneEnds: number[] = [];
    const assigned = cluster.map((entry) => {
      let lane = laneEnds.findIndex((endMinute) => endMinute <= entry.startMinute);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = entry.visualEnd;
      return { entry, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    laidOut.push(...assigned.map(({ entry, lane }) => ({
      id: entry.id,
      startMinute: entry.startMinute,
      durationMinutes: entry.durationMinutes,
      soft: entry.soft,
      lane,
      laneCount,
    })));
    clusterStart = clusterEnd;
  }

  return [...soft, ...laidOut];
}

type Placement = PlannerProposalImpact["placements"][number];

export type PlannerPlacementDay = {
  date: string;
  items: Array<{
    key: string;
    itemId?: string;
    title: string;
    entries: Placement[];
  }>;
};

export function groupPlannerPlacementsByDay(
  placements: PlannerProposalImpact["placements"],
  timezone: string
): PlannerPlacementDay[] {
  const days = new Map<string, Map<string, PlannerPlacementDay["items"][number]>>();
  const sorted = [...placements].sort((left, right) => left.startAt.localeCompare(right.startAt)
    || left.endAt.localeCompare(right.endAt)
    || left.title.localeCompare(right.title));

  for (const placement of sorted) {
    const date = formatDateInTimeZone(new Date(placement.startAt), timezone);
    const day = days.get(date) ?? new Map<string, PlannerPlacementDay["items"][number]>();
    const key = placement.itemId ?? placement.title;
    const item = day.get(key);
    if (item) item.entries.push(placement);
    else day.set(key, { key, itemId: placement.itemId, title: placement.title, entries: [placement] });
    days.set(date, day);
  }

  return [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => ({ date, items: [...items.values()] }));
}
