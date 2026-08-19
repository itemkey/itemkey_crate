import "server-only";

import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { getPostgresPool } from "@/lib/db/postgres";

const REALTIME_CHANNEL = "itemkey_events";

export type RealtimeEvent = {
  id: string;
  kind:
    | "workspace"
    | "messages"
    | "projects"
    | "friends"
    | "inbox"
    | "planner"
    | "public";
  action: string;
  userIds: string[];
  categoryIds?: string[];
  publicRootIds?: string[];
  originClientId?: string | null;
  createdAt: string;
};

type RealtimeSubscriber = (event: RealtimeEvent) => void;

let listenerClient: PoolClient | null = null;
let listenerPromise: Promise<void> | null = null;
const subscribers = new Set<RealtimeSubscriber>();

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RealtimeEvent>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.action === "string" &&
    Array.isArray(candidate.userIds) &&
    candidate.userIds.every((id) => typeof id === "string") &&
    typeof candidate.createdAt === "string"
  );
}

async function ensureRealtimeListener(): Promise<void> {
  if (listenerClient) {
    return;
  }

  if (listenerPromise) {
    return listenerPromise;
  }

  listenerPromise = (async () => {
    const pool = getPostgresPool();
    const client = await pool.connect();
    listenerClient = client;

    client.on("notification", (message) => {
      if (message.channel !== REALTIME_CHANNEL || !message.payload) {
        return;
      }

      try {
        const parsed: unknown = JSON.parse(message.payload);
        if (!isRealtimeEvent(parsed)) {
          return;
        }

        for (const subscriber of subscribers) {
          subscriber(parsed);
        }
      } catch {
        // Ignore malformed notifications from outside this app.
      }
    });

    client.on("error", () => {
      listenerClient = null;
      listenerPromise = null;
    });

    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
  })();

  return listenerPromise;
}

export async function publishRealtimeEvent(
  input: Omit<RealtimeEvent, "id" | "createdAt" | "userIds"> & {
    userIds: string[];
  }
): Promise<void> {
  const userIds = Array.from(new Set(input.userIds.filter(Boolean)));
  if (userIds.length === 0) {
    return;
  }

  const event: RealtimeEvent = {
    ...input,
    id: randomUUID(),
    userIds,
    originClientId: input.originClientId ?? null,
    createdAt: new Date().toISOString(),
  };

  await getPostgresPool().query(`select pg_notify($1::text, $2::text)`, [
    REALTIME_CHANNEL,
    JSON.stringify(event),
  ]);
}

export async function subscribeRealtimeEvents(
  subscriber: RealtimeSubscriber
): Promise<() => void> {
  await ensureRealtimeListener();
  subscribers.add(subscriber);

  return () => {
    subscribers.delete(subscriber);
  };
}
