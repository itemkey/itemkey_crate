import { NextRequest } from "next/server";

import { getCollaborationStore } from "@/lib/collaboration-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function getOriginClientId(request: NextRequest): string | null {
  return request.headers.get("x-client-id")?.trim() || null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return Response.json({ error: "Missing inbox id." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const declined = await store.declineInboxItem(user.id, id);

    await publishRealtimeEvent({
      kind: "inbox",
      action: "inbox_decline",
      userIds: [user.id, declined.senderAppUserId],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: declined, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось отклонить inbox-сообщение.") },
      { status: 500 }
    );
  }
}
