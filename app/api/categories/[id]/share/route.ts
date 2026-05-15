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
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const body = (await request.json()) as { friendAppUserId?: unknown };
    if (
      typeof body.friendAppUserId !== "string" ||
      body.friendAppUserId.trim().length === 0
    ) {
      return Response.json({ error: "Выбери друга для отправки." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const item = await store.createCategoryShare({
      senderAppUserId: user.id,
      friendAppUserId: body.friendAppUserId.trim(),
      categoryId: id,
    });

    await publishRealtimeEvent({
      kind: "inbox",
      action: "category_share",
      userIds: [user.id, item.recipientAppUserId],
      categoryIds: [id],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: item, source: store.source }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось отправить категорию другу.") },
      { status: 500 }
    );
  }
}
