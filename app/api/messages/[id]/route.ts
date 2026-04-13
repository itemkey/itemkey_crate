import { NextRequest } from "next/server";

import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return Response.json({ error: "Missing message id." }, { status: 400 });
    }

    const body = (await request.json()) as {
      title?: unknown;
      content?: unknown;
      messageType?: unknown;
      position?: unknown;
    };

    const patch: {
      title?: string;
      content?: string;
      message_type?: "info" | "exercise";
      position?: number;
    } = {};

    if ("title" in body && typeof body.title === "string") {
      const trimmed = body.title.trim();
      if (trimmed.length > 0) {
        patch.title = trimmed;
      }
    }

    if ("content" in body && typeof body.content === "string") {
      patch.content = body.content;
    }

    if ("messageType" in body && (body.messageType === "info" || body.messageType === "exercise")) {
      patch.message_type = body.messageType;
    }

    if (
      "position" in body &&
      typeof body.position === "number" &&
      Number.isFinite(body.position)
    ) {
      patch.position = Math.max(0, Math.floor(body.position));
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: "Nothing to update." }, { status: 400 });
    }

    const store = await getCategoryStore(user.id);
    const updated = await store.updateMessage(id, patch);
    return Response.json({ data: updated, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to update message.") },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return Response.json({ error: "Missing message id." }, { status: 400 });
    }

    const store = await getCategoryStore(user.id);
    await store.removeMessage(id);
    return Response.json({ ok: true, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to delete message.") },
      { status: 500 }
    );
  }
}
