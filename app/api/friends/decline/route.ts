import { NextRequest } from "next/server";

import { getCollaborationStore } from "@/lib/collaboration-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

function getOriginClientId(request: NextRequest): string | null {
  return request.headers.get("x-client-id")?.trim() || null;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const body = (await request.json()) as { friendAppUserId?: unknown };
    if (
      typeof body.friendAppUserId !== "string" ||
      body.friendAppUserId.trim().length === 0
    ) {
      return Response.json({ error: "Отправитель приглашения обязателен." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const friend = await store.declineFriend(user.id, body.friendAppUserId.trim());

    await publishRealtimeEvent({
      kind: "friends",
      action: "friend_decline",
      userIds: [user.id, friend.friendAppUserId],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: friend, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось отклонить приглашение в друзья.") },
      { status: 500 }
    );
  }
}
