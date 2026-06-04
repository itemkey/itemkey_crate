import { NextRequest } from "next/server";

import { getDictionaryGroupStore } from "@/lib/dictionary-groups";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    const store = await getDictionaryGroupStore(user.id);
    const group = (await store.list()).find((item) => item.id === id);
    if (!group) {
      return Response.json({ error: "Группа словарей не найдена." }, { status: 404 });
    }

    return Response.json(
      { data: group, source: store.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось загрузить группу словарей.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return Response.json({ error: "Missing group id." }, { status: 400 });
    }

    const body = (await request.json()) as {
      title?: unknown;
      description?: unknown;
      position?: unknown;
    };
    const patch: {
      title?: string;
      description?: string;
      position?: number;
    } = {};

    if ("title" in body) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return Response.json(
          { error: "Название группы не может быть пустым." },
          { status: 400 }
        );
      }
      patch.title = body.title.trim();
    }

    if ("description" in body && typeof body.description === "string") {
      patch.description = body.description;
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

    const store = await getDictionaryGroupStore(user.id);
    const updated = await store.update(id, patch);

    await publishRealtimeEvent({
      kind: "workspace",
      action: "dictionary_group_update",
      userIds: [user.id],
      originClientId: getOriginClientId(request),
    });

    return Response.json(
      { data: updated, source: store.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось обновить группу словарей.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
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
      return Response.json({ error: "Missing group id." }, { status: 400 });
    }

    const store = await getDictionaryGroupStore(user.id);
    await store.remove(id);

    await publishRealtimeEvent({
      kind: "workspace",
      action: "dictionary_group_delete",
      userIds: [user.id],
      originClientId: getOriginClientId(request),
    });

    return Response.json(
      { ok: true, source: store.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось удалить группу словарей.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
