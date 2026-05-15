import { NextRequest } from "next/server";

import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getCategoryRealtimeUserIds, getOriginClientId } from "@/lib/realtime-targets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const categoryId = request.nextUrl.searchParams.get("categoryId");
    if (!categoryId) {
      return Response.json({ error: "categoryId is required." }, { status: 400 });
    }

    const store = await getCategoryStore(user.id);
    const messages = await store.listMessages(categoryId);
    return Response.json({ data: messages, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to load messages.") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const body = (await request.json()) as {
      categoryId?: unknown;
      title?: unknown;
      content?: unknown;
      messageType?: unknown;
    };

    if (typeof body.categoryId !== "string" || body.categoryId.trim().length === 0) {
      return Response.json({ error: "categoryId is required." }, { status: 400 });
    }

    const messageType = body.messageType === "exercise" ? "exercise" : "info";

    const title =
      typeof body.title === "string" && body.title.trim().length > 0
        ? body.title.trim()
        : undefined;

    const content = typeof body.content === "string" ? body.content : "";

    const store = await getCategoryStore(user.id);
    const created = await store.createMessage({
      categoryId: body.categoryId,
      title,
      content,
      messageType,
    });

    await publishRealtimeEvent({
      kind: "messages",
      action: "message_create",
      userIds: await getCategoryRealtimeUserIds(user.id, created.category_id),
      categoryIds: [created.category_id],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: created, source: store.source }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to create message.") },
      { status: 500 }
    );
  }
}
