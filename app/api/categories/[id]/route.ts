import { NextRequest } from "next/server";

import { collectDescendantIds } from "@/lib/categories";
import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import { getProjectStore } from "@/lib/project-store";
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
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const body = (await request.json()) as {
      title?: unknown;
      content?: unknown;
      description?: unknown;
      tag?: unknown;
      format?: unknown;
      categoryType?: unknown;
      parentId?: unknown;
      position?: unknown;
    };

    const patch: {
      title?: string;
      content?: string;
      description?: string;
      tag?: string;
      format?: "block" | "continuous";
      category_type?: "learning";
      parent_id?: string | null;
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

    if ("description" in body && typeof body.description === "string") {
      patch.description = body.description;
    }

    if ("tag" in body && typeof body.tag === "string") {
      patch.tag = body.tag;
    }

    if ("format" in body && (body.format === "block" || body.format === "continuous")) {
      patch.format = body.format;
    }

    if ("categoryType" in body && body.categoryType === "learning") {
      patch.category_type = body.categoryType;
    }

    if ("parentId" in body) {
      patch.parent_id =
        typeof body.parentId === "string" && body.parentId.trim().length > 0
          ? body.parentId
          : null;
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
    const updated = await store.update(id, patch);
    return Response.json({ data: updated, source: store.source });
  } catch (error) {
    const fallback = "Unable to update category.";
    return Response.json({ error: toErrorMessage(error, fallback) }, { status: 500 });
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
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const store = await getCategoryStore(user.id);
    const categories = await store.list();
    const target = categories.find((node) => node.id === id);

    if (!target) {
      return Response.json({ error: "Category not found." }, { status: 404 });
    }

    const isMainRoot =
      !target.parent_id && target.title.trim().toLowerCase() === "main";

    if (isMainRoot) {
      return Response.json(
        { error: "Category main cannot be removed." },
        { status: 400 }
      );
    }

    const links = categories.map((node) => ({
      id: node.id,
      parent_id: node.parent_id,
    }));
    const deletedIds = [target.id, ...collectDescendantIds(links, target.id)];

    await store.remove(id);

    try {
      const projectStore = await getProjectStore(user.id);
      await projectStore.cleanupContainerCategoryIds(deletedIds);
    } catch {
      // Ignore cleanup errors, category removal already succeeded.
    }

    return Response.json({ ok: true, source: store.source });
  } catch (error) {
    const fallback = "Unable to delete category.";
    return Response.json({ error: toErrorMessage(error, fallback) }, { status: 500 });
  }
}
