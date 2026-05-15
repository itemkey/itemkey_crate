import { NextRequest } from "next/server";

import { getRequestUser } from "@/lib/request-user";
import { subscribeRealtimeEvents } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 25000;

function encodeSseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) {
    return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
  }

  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() ?? "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const enqueue = (event: string, data: unknown) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encodeSseEvent(event, data));
        } catch {
          closed = true;
        }
      };

      enqueue("ready", { ok: true });

      const unsubscribe = await subscribeRealtimeEvents((event) => {
        if (!event.userIds.includes(user.id)) {
          return;
        }

        if (clientId && event.originClientId === clientId) {
          return;
        }

        enqueue("itemkey", event);
      });

      const heartbeat = setInterval(() => {
        enqueue("heartbeat", { at: new Date().toISOString() });
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Connection was already closed by the client.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
