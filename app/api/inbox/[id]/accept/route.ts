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

    const body = (await request.json().catch(() => ({}))) as {
      targetParentId?: unknown;
    };

    const targetParentId =
      typeof body.targetParentId === "string" && body.targetParentId.trim()
        ? body.targetParentId.trim()
        : null;

    const store = await getCollaborationStore();
    const accepted = await store.acceptInboxItem({
      appUserId: user.id,
      inboxItemId: id,
      targetParentId,
    });

    await publishRealtimeEvent({
      kind: accepted.item.type === "public_invite" ? "public" : "inbox",
      action: "inbox_accept",
      userIds: [user.id, accepted.item.senderAppUserId],
      categoryIds:
        accepted.categories.length > 0
          ? accepted.categories.map((category) => category.id)
          : accepted.item.publicRootCategoryId
            ? [accepted.item.publicRootCategoryId]
            : undefined,
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: accepted, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось принять inbox-сообщение.") },
      { status: 500 }
    );
  }
}
