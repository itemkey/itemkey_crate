import { NextRequest } from "next/server";

import { getDictionaryGroupStore } from "@/lib/dictionary-groups";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const store = await getDictionaryGroupStore(user.id);
    const groups = await store.list();
    return Response.json(
      { data: groups, source: store.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось загрузить группы словарей.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
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
      title?: unknown;
      description?: unknown;
    };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return Response.json(
        { error: "Название группы не может быть пустым." },
        { status: 400 }
      );
    }

    const store = await getDictionaryGroupStore(user.id);
    const created = await store.create({
      title,
      description: typeof body.description === "string" ? body.description : "",
    });

    await publishRealtimeEvent({
      kind: "workspace",
      action: "dictionary_group_create",
      userIds: [user.id],
      originClientId: getOriginClientId(request),
    });

    return Response.json(
      { data: created, source: store.source },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось создать группу словарей.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
