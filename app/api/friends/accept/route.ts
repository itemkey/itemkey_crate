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

    const body = (await request.json()) as {
      userId?: unknown;
      friendAppUserId?: unknown;
    };
    if (
      (typeof body.userId !== "string" || !body.userId.trim()) &&
      (typeof body.friendAppUserId !== "string" || !body.friendAppUserId.trim())
    ) {
      return Response.json({ error: "Отправитель приглашения обязателен." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const friend =
      typeof body.friendAppUserId === "string" && body.friendAppUserId.trim()
        ? await store.acceptFriendByAppUserId(user.id, body.friendAppUserId.trim())
        : await store.acceptFriend(user.id, String(body.userId));

    await publishRealtimeEvent({
      kind: "friends",
      action: "friend_accept",
      userIds: [user.id, friend.friendAppUserId],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: friend, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось принять приглашение в друзья.") },
      { status: 500 }
    );
  }
}
