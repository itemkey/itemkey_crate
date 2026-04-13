import { NextRequest } from "next/server";

import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const body = (await request.json()) as {
      categoryId?: unknown;
      orderedIds?: unknown;
    };

    if (typeof body.categoryId !== "string" || body.categoryId.trim().length === 0) {
      return Response.json({ error: "categoryId is required." }, { status: 400 });
    }

    if (!Array.isArray(body.orderedIds) || body.orderedIds.some((id) => typeof id !== "string")) {
      return Response.json({ error: "orderedIds must be an array of message ids." }, { status: 400 });
    }

    const store = await getCategoryStore(user.id);
    const reordered = await store.reorderMessages(body.categoryId, body.orderedIds);
    return Response.json({ data: reordered, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to reorder messages.") },
      { status: 500 }
    );
  }
}
