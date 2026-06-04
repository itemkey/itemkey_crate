import { NextRequest } from "next/server";

import { getDictionaryGroupStore } from "@/lib/dictionary-groups";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; itemId: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id, itemId } = await context.params;
    if (!id || !itemId) {
      return Response.json({ error: "Missing group item id." }, { status: 400 });
    }

    const store = await getDictionaryGroupStore(user.id);
    const updated = await store.removeItem(id, itemId);

    await publishRealtimeEvent({
      kind: "workspace",
      action: "dictionary_group_item_delete",
      userIds: [user.id],
      originClientId: getOriginClientId(request),
    });

    return Response.json(
      { data: updated, source: store.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось удалить запись из группы.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
