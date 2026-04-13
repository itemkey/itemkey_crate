import { NextRequest } from "next/server";

import { createDefaultTitle } from "@/lib/categories";
import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import {
  getProjectStore,
  parseSerializedList,
  serializeSerializedList,
} from "@/lib/project-store";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const store = await getCategoryStore(user.id);
    const categories = await store.list();
    return Response.json({ data: categories, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to load categories.") },
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
      parentId?: unknown;
      title?: unknown;
      projectId?: unknown;
    };

    const parentId =
      typeof body.parentId === "string" && body.parentId.trim().length > 0
        ? body.parentId
        : null;

    const requestedTitle =
      typeof body.title === "string" ? body.title.trim() : "";

    const projectId =
      typeof body.projectId === "string" && body.projectId.trim().length > 0
        ? body.projectId.trim()
        : null;

    const store = await getCategoryStore(user.id);
    const siblingCount = (await store.list()).filter(
      (node) => node.parent_id === parentId
    ).length;
    const title = requestedTitle || createDefaultTitle(siblingCount);

    const created = await store.create({ parentId, title });

    if (projectId) {
      try {
        const projectStore = await getProjectStore(user.id);
        const projects = await projectStore.list();
        const targetProject = projects.find((project) => project.id === projectId);

        if (targetProject) {
          const currentContainerIds = parseSerializedList(
            targetProject.container_category_ids
          );
          if (!currentContainerIds.includes(created.id)) {
            await projectStore.update(targetProject.id, {
              container_category_ids: serializeSerializedList([
                ...currentContainerIds,
                created.id,
              ]),
            });
          }
        }
      } catch {
        // If project metadata update fails, keep created category.
      }
    }

    return Response.json({ data: created, source: store.source }, { status: 201 });
  } catch (error) {
    const fallback = "Unable to create category.";
    return Response.json({ error: toErrorMessage(error, fallback) }, { status: 500 });
  }
}
