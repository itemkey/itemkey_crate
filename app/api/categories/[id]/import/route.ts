import { NextRequest } from "next/server";

import { collectDescendantIds } from "@/lib/categories";
import {
  parseCategoryTreeDocument,
  type CategoryTreeCategory,
  type CategoryTreeMessage,
} from "@/lib/category-transfer";
import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function sortImportMessages(messages: CategoryTreeMessage[]): CategoryTreeMessage[] {
  return [...messages].sort((a, b) => {
    if (a.position === b.position) {
      return a.id.localeCompare(b.id);
    }

    return a.position - b.position;
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id: targetCategoryId } = await context.params;
    if (!targetCategoryId) {
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const rawPayload = await request.json();
    let importDocument: ReturnType<typeof parseCategoryTreeDocument>;
    try {
      importDocument = parseCategoryTreeDocument(rawPayload);
    } catch (error) {
      return Response.json(
        {
          error: toErrorMessage(error, "Неверный формат файла импорта."),
        },
        { status: 400 }
      );
    }

    const importLinks = importDocument.categories.map((category) => ({
      id: category.id,
      parent_id: category.parent_id,
    }));
    const importDescendants = collectDescendantIds(
      importLinks,
      importDocument.rootCategoryId
    );
    const importTreeIds = new Set([importDocument.rootCategoryId, ...importDescendants]);
    if (importTreeIds.size !== importDocument.categories.length) {
      return Response.json(
        {
          error:
            "Файл импорта должен содержать одно дерево категорий с выбранным корнем.",
        },
        { status: 400 }
      );
    }

    const importedRoot = importDocument.categories.find(
      (category) => category.id === importDocument.rootCategoryId
    );
    if (!importedRoot) {
      return Response.json(
        { error: "Root category from import file was not found." },
        { status: 400 }
      );
    }

    const store = await getCategoryStore(user.id);
    const currentCategories = await store.list();
    const targetCategory = currentCategories.find(
      (category) => category.id === targetCategoryId
    );

    if (!targetCategory) {
      return Response.json({ error: "Category not found." }, { status: 404 });
    }

    const isProtectedMainRoot =
      !targetCategory.parent_id && targetCategory.title.trim().toLowerCase() === "main";

    const directChildren = currentCategories.filter(
      (category) => category.parent_id === targetCategoryId
    );
    for (const child of directChildren) {
      await store.remove(child.id);
    }

    const targetMessages = await store.listMessages(targetCategoryId);
    for (const message of targetMessages) {
      await store.removeMessage(message.id);
    }

    await store.update(targetCategoryId, {
      title: isProtectedMainRoot ? targetCategory.title : importedRoot.title,
      content: importedRoot.content,
      description: importedRoot.description,
      tag: importedRoot.tag,
      format: importedRoot.format,
      category_type: importedRoot.category_type,
      position: importedRoot.position,
    });

    const categoryIdMap = new Map<string, string>();
    categoryIdMap.set(importDocument.rootCategoryId, targetCategoryId);

    const pendingCategories: CategoryTreeCategory[] = importDocument.categories.filter(
      (category) => category.id !== importDocument.rootCategoryId
    );

    while (pendingCategories.length > 0) {
      let progressed = false;

      for (let index = pendingCategories.length - 1; index >= 0; index -= 1) {
        const candidate = pendingCategories[index];
        if (!candidate.parent_id) {
          throw new Error(
            "В файле импорта найден узел без parent_id вне корневой категории."
          );
        }

        const mappedParentId = categoryIdMap.get(candidate.parent_id);
        if (!mappedParentId) {
          continue;
        }

        const created = await store.create({
          parentId: mappedParentId,
          title: candidate.title,
        });

        const updated = await store.update(created.id, {
          title: candidate.title,
          content: candidate.content,
          description: candidate.description,
          tag: candidate.tag,
          format: candidate.format,
          category_type: candidate.category_type,
          position: candidate.position,
        });

        categoryIdMap.set(candidate.id, updated.id);
        pendingCategories.splice(index, 1);
        progressed = true;
      }

      if (!progressed) {
        throw new Error(
          "Не удалось восстановить дерево категорий. Проверь parent_id в файле импорта."
        );
      }
    }

    const messagesByImportCategory = new Map<string, CategoryTreeMessage[]>();
    for (const message of importDocument.messages) {
      const list = messagesByImportCategory.get(message.category_id) ?? [];
      list.push(message);
      messagesByImportCategory.set(message.category_id, list);
    }

    for (const [importCategoryId, messages] of messagesByImportCategory) {
      const mappedCategoryId = categoryIdMap.get(importCategoryId);
      if (!mappedCategoryId) {
        throw new Error("В файле импорта найдено сообщение с неизвестной категорией.");
      }

      if (mappedCategoryId !== targetCategoryId) {
        const staleMessages = await store.listMessages(mappedCategoryId);
        for (const stale of staleMessages) {
          await store.removeMessage(stale.id);
        }
      }

      const createdIds: string[] = [];
      for (const message of sortImportMessages(messages)) {
        const created = await store.createMessage({
          categoryId: mappedCategoryId,
          title: message.title,
          content: message.content,
          messageType: message.message_type,
        });
        createdIds.push(created.id);
      }

      if (createdIds.length > 1) {
        await store.reorderMessages(mappedCategoryId, createdIds);
      }
    }

    const freshCategories = await store.list();
    const updatedRoot = freshCategories.find(
      (category) => category.id === targetCategoryId
    );

    return Response.json({
      data: updatedRoot ?? null,
      source: store.source,
      imported: {
        categories: categoryIdMap.size,
        messages: importDocument.messages.length,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось импортировать категорию."),
      },
      { status: 500 }
    );
  }
}
