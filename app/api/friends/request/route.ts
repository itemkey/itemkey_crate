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

    const body = (await request.json()) as { userId?: unknown };
    if (typeof body.userId !== "string" || !body.userId.trim()) {
      return Response.json({ error: "user-id друга обязателен." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const friend = await store.requestFriend(user.id, body.userId);

    await publishRealtimeEvent({
      kind: "friends",
      action: "friend_request",
      userIds: [user.id, friend.friendAppUserId],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: friend, source: store.source }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось отправить приглашение в друзья.") },
      { status: 500 }
    );
  }
}
