import { NextRequest } from "next/server";

import { parseCategoryTreeDocument } from "@/lib/category-transfer";
import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import {
  getProjectStore,
  serializeSerializedList,
} from "@/lib/project-store";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getOriginClientId } from "@/lib/realtime-targets";

export const dynamic = "force-dynamic";

type RestoreProjectPayload = {
  id: string;
  containerCategoryIds: string[];
};

function normalizeRestoreProjects(value: unknown): RestoreProjectPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (project): project is Record<string, unknown> =>
        typeof project === "object" && project !== null
    )
    .map((project) => ({
      id: typeof project.id === "string" ? project.id.trim() : "",
      containerCategoryIds: Array.isArray(project.containerCategoryIds)
        ? project.containerCategoryIds.filter(
            (categoryId): categoryId is string => typeof categoryId === "string"
          )
        : [],
    }))
    .filter((project) => project.id.length > 0);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const body = (await request.json()) as {
      document?: unknown;
      projects?: unknown;
    };

    let document: ReturnType<typeof parseCategoryTreeDocument>;
    try {
      document = parseCategoryTreeDocument(body.document);
    } catch (error) {
      return Response.json(
        {
          error: toErrorMessage(
            error,
            "Не удалось прочитать снимок удалённой категории."
          ),
        },
        { status: 400 }
      );
    }

    const categoryStore = await getCategoryStore(user.id);
    const restored = await categoryStore.restoreTree(document);

    const projectStore = await getProjectStore(user.id);
    const existingProjects = await projectStore.list();
    const existingProjectIds = new Set(existingProjects.map((project) => project.id));

    for (const project of normalizeRestoreProjects(body.projects)) {
      if (!existingProjectIds.has(project.id)) {
        continue;
      }

      await projectStore.update(project.id, {
        container_category_ids: serializeSerializedList(project.containerCategoryIds),
      });
    }

    const projects = await projectStore.list();

    await publishRealtimeEvent({
      kind: "workspace",
      action: "category_restore",
      userIds: [user.id],
      categoryIds: restored.categories.map((category) => category.id),
      originClientId: getOriginClientId(request),
    });

    return Response.json({
      data: restored,
      projects,
      source: categoryStore.source,
    });
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(
          error,
          "Не удалось восстановить удалённую категорию."
        ),
      },
      { status: 500 }
    );
  }
}
