import { NextRequest } from "next/server";

import { getCollaborationStore } from "@/lib/collaboration-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const store = await getCollaborationStore();
    const friends = await store.listFriends(user.id);
    return Response.json({ data: friends, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось загрузить друзей.") },
      { status: 500 }
    );
  }
}
