import { buildCategoryPath } from "@/lib/categories";
import { getCategoryStore } from "@/lib/category-store";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RESULT_LIMIT = 45;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

type WorkspaceSearchResult = {
  id: string;
  kind: "category" | "message";
  categoryId: string;
  messageId?: string;
  title: string;
  path: string;
  preview: string;
};

function toPlainSearchText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[{}[\]"\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makePreview(text: string, normalizedQuery: string): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return "";
  }

  const matchIndex = normalizedText.toLocaleLowerCase().indexOf(normalizedQuery);
  const start = Math.max(0, matchIndex >= 0 ? matchIndex - 64 : 0);
  const end = Math.min(normalizedText.length, start + 180);
  return `${start > 0 ? "…" : ""}${normalizedText.slice(start, end)}${
    end < normalizedText.length ? "…" : ""
  }`;
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) {
    return Response.json(
      { error: "Unauthorized." },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
  if (!query) {
    return Response.json(
      { data: [], source: "postgres" },
      { headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  try {
    const normalizedQuery = query.toLocaleLowerCase();
    const store = await getCategoryStore(user.id);
    const categories = await store.list();
    const messagesByCategory = await store.listMessagesForCategories(categories);
    const results: WorkspaceSearchResult[] = [];

    for (const category of categories) {
      const plainContent = toPlainSearchText(category.content);
      const searchable = `${category.title} ${category.description} ${category.tag} ${plainContent}`;
      if (!searchable.toLocaleLowerCase().includes(normalizedQuery)) {
        continue;
      }

      results.push({
        id: `category-${category.id}`,
        kind: "category",
        categoryId: category.id,
        title: category.title,
        path: buildCategoryPath(categories, category.id)
          .map((part) => part.title)
          .join(" / "),
        preview: makePreview(category.description || plainContent || category.tag, normalizedQuery),
      });
      if (results.length >= RESULT_LIMIT) {
        break;
      }
    }

    if (results.length < RESULT_LIMIT) {
      messageSearch: for (const [categoryId, messages] of Object.entries(
        messagesByCategory
      )) {
        for (const message of messages) {
          const plainContent = toPlainSearchText(message.content);
          const searchable = `${message.title} ${plainContent}`;
          if (!searchable.toLocaleLowerCase().includes(normalizedQuery)) {
            continue;
          }

          results.push({
            id: `message-${message.id}`,
            kind: "message",
            categoryId,
            messageId: message.id,
            title: message.title || "Новый блок",
            path: `${buildCategoryPath(categories, categoryId)
              .map((part) => part.title)
              .join(" / ")} / сообщение`,
            preview: makePreview(plainContent, normalizedQuery),
          });
          if (results.length >= RESULT_LIMIT) {
            break messageSearch;
          }
        }
      }
    }

    return Response.json(
      { data: results, source: "postgres" },
      { headers: PRIVATE_NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[workspace/search] failed", error);
    return Response.json(
      { error: "Не удалось выполнить поиск." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
