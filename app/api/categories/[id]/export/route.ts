import { NextRequest } from "next/server";

import { collectDescendantIds } from "@/lib/categories";
import { buildCategoryTreeDocument } from "@/lib/category-transfer";
import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

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
    if (!id) {
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const store = await getCategoryStore(user.id);
    const categories = await store.list();
    const rootCategory = categories.find((category) => category.id === id);
    if (!rootCategory) {
      return Response.json({ error: "Category not found." }, { status: 404 });
    }

    const descendants = collectDescendantIds(
      categories.map((category) => ({ id: category.id, parent_id: category.parent_id })),
      id
    );
    const subtreeIds = new Set([id, ...descendants]);
    const subtreeCategories = categories.filter((category) => subtreeIds.has(category.id));

    const messagesChunks = await Promise.all(
      subtreeCategories.map((category) => store.listMessages(category.id))
    );
    const subtreeMessages = messagesChunks.flat();

    const transferDocument = buildCategoryTreeDocument(
      id,
      subtreeCategories,
      subtreeMessages
    );

    return Response.json({ data: transferDocument, source: store.source });
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось экспортировать категорию."),
      },
      { status: 500 }
    );
  }
}
