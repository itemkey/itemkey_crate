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

export async function POST(request: NextRequest, context: RouteContext) {
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
      sourceCategoryId?: unknown;
      sourceMessageId?: unknown;
      dictionaryId?: unknown;
      entryId?: unknown;
    };

    const store = await getDictionaryGroupStore(user.id);
    const updated = await store.addItem(id, body);

    await publishRealtimeEvent({
      kind: "workspace",
      action: "dictionary_group_item_create",
      userIds: [user.id],
      originClientId: getOriginClientId(request),
    });

    return Response.json(
      { data: updated, source: store.source },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось добавить запись в группу.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
