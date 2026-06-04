import { NextRequest } from "next/server";

import { buildCategoryPath, collectDescendantIds } from "@/lib/categories";
import { getCategoryStore } from "@/lib/category-store";
import {
  DICTIONARY_EDITOR_SEARCH_FIELDS,
  type CompiledDictionarySearchQuery,
  type DictionaryBlock,
  type DictionaryEntry,
  type DictionaryEntryField,
  type DictionarySearchMatch,
  type DictionarySearchResult,
  compileDictionarySearchQuery,
  findDictionaryEditorSearchMatch,
  parseContinuousDictionariesFromContent,
  parseMessageDictionaryContent,
} from "@/lib/dictionaries";
import { toErrorMessage } from "@/lib/errors";
import { getProjectStore, parseSerializedList } from "@/lib/project-store";
import { getRequestUser } from "@/lib/request-user";
import type { CategoryRow, ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type DictionarySearchScope = "workspace" | "project" | "category";
type RankedDictionarySearchResult = {
  result: DictionarySearchResult;
  score: number;
  order: number;
};

const DICTIONARY_SEARCH_RESULT_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
    if (!query) {
      return Response.json(
        { data: [], source: "postgres" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const compiledQuery = compileDictionarySearchQuery(query);
    if (!compiledQuery) {
      return Response.json(
        { data: [], source: "postgres" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const scope = normalizeDictionarySearchScope(
      request.nextUrl.searchParams.get("scope")
    );
    const includeContinuous = parseSearchBoolean(
      request.nextUrl.searchParams.get("includeContinuous"),
      true
    );
    const includeBlock = parseSearchBoolean(
      request.nextUrl.searchParams.get("includeBlock"),
      true
    );

    const categoryStore = await getCategoryStore(user.id);
    const categories = await categoryStore.list();
    const scopedCategories = await resolveSearchCategories({
      userId: user.id,
      categories,
      scope,
      projectId: request.nextUrl.searchParams.get("projectId"),
      categoryId: request.nextUrl.searchParams.get("categoryId"),
    });

    const results: RankedDictionarySearchResult[] = [];

    if (includeContinuous) {
      for (const category of scopedCategories) {
        for (const dictionary of parseContinuousDictionariesFromContent(
          category.content
        )) {
          appendDictionaryMatches({
            results,
            categories,
            category,
            dictionary,
            sourceMessageId: null,
            dictionaryId: dictionary.id,
            query: compiledQuery,
          });
        }
      }
    }

    if (includeBlock) {
      const messagesByCategoryId =
        await categoryStore.listMessagesForCategories(scopedCategories);

      for (const category of scopedCategories) {
        const messages = messagesByCategoryId[category.id] ?? [];
        for (const message of messages) {
          const payload = parseMessageDictionaryContent(message.content);
          if (!payload) {
            continue;
          }

          appendDictionaryMatches({
            results,
            categories,
            category,
            dictionary: {
              id: message.id,
              title: message.title,
              ...payload,
            },
            sourceMessageId: message.id,
            dictionaryId: null,
            query: compiledQuery,
          });
        }
      }
    }

    return dictionarySearchResponse(results, categoryStore.source);
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось выполнить поиск по #DICT.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

function dictionarySearchResponse(
  results: RankedDictionarySearchResult[],
  source: "postgres"
) {
  const sortedResults = [...results]
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, DICTIONARY_SEARCH_RESULT_LIMIT)
    .map((item) => item.result);

  return Response.json(
    { data: sortedResults, source },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function normalizeDictionarySearchScope(
  value: string | null
): DictionarySearchScope {
  return value === "project" || value === "category" ? value : "workspace";
}

function parseSearchBoolean(value: string | null, fallback: boolean): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

async function resolveSearchCategories(options: {
  userId: string;
  categories: CategoryRow[];
  scope: DictionarySearchScope;
  projectId: string | null;
  categoryId: string | null;
}): Promise<CategoryRow[]> {
  if (options.scope === "category") {
    return options.categories.filter((category) => category.id === options.categoryId);
  }

  if (options.scope === "project") {
    if (!options.projectId) {
      return [];
    }

    const projectStore = await getProjectStore(options.userId);
    const project =
      (await projectStore.list()).find((item) => item.id === options.projectId) ?? null;
    if (!project) {
      return [];
    }

    const visibleCategoryIdSet = collectProjectCategoryIds(
      options.categories,
      project
    );
    return options.categories.filter((category) =>
      visibleCategoryIdSet.has(category.id)
    );
  }

  return options.categories;
}

function collectProjectCategoryIds(
  categories: CategoryRow[],
  project: ProjectRow
): Set<string> {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const projectTagKeySet = new Set(
    parseCategoryTags(project.tag_filter).map((tag) => tag.toLocaleLowerCase())
  );
  const candidateRootIds = new Set<string>();

  for (const category of categories) {
    const hasProjectTag = parseCategoryTags(category.tag).some((tag) =>
      projectTagKeySet.has(tag.toLocaleLowerCase())
    );

    if (hasProjectTag) {
      candidateRootIds.add(category.id);
    }
  }

  for (const categoryId of parseSerializedList(project.container_category_ids)) {
    if (categoryById.has(categoryId)) {
      candidateRootIds.add(categoryId);
    }
  }

  const visibleCategoryIdSet = new Set<string>();
  const links = categories.map((category) => ({
    id: category.id,
    parent_id: category.parent_id,
  }));

  for (const rootId of candidateRootIds) {
    visibleCategoryIdSet.add(rootId);
    for (const descendantId of collectDescendantIds(links, rootId)) {
      visibleCategoryIdSet.add(descendantId);
    }
  }

  return visibleCategoryIdSet;
}

function parseCategoryTags(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return dedupeTags(
          parsed.filter((entry): entry is string => typeof entry === "string")
        );
      }
    } catch {
      return dedupeTags([trimmed]);
    }
  }

  if (trimmed.includes("\n")) {
    return dedupeTags(trimmed.split(/\r?\n/g));
  }

  return dedupeTags([trimmed]);
}

function dedupeTags(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function appendDictionaryMatches(options: {
  results: RankedDictionarySearchResult[];
  categories: CategoryRow[];
  category: CategoryRow;
  dictionary: DictionaryBlock;
  sourceMessageId: string | null;
  dictionaryId: string | null;
  query: CompiledDictionarySearchQuery;
}) {
  const categoryPath = buildCategoryPath(
    options.categories,
    options.category.id
  )
    .map((part) => part.title)
    .join(" / ");

  for (const entry of options.dictionary.entries) {
    const matchedFields = collectMatchedDictionaryFields(
      entry,
      options.query
    );

    if (matchedFields.length === 0) {
      continue;
    }

    const score = Math.max(
      ...matchedFields.map(
        (match) => match.match.score + getDictionarySearchFieldScore(match.field)
      )
    );

    options.results.push({
      result: {
        id: [
          options.category.id,
          options.sourceMessageId ?? options.dictionaryId ?? options.dictionary.id,
          entry.id,
        ].join(":"),
        entry,
        labels: options.dictionary.labels,
        matchedFields: matchedFields.map((match) => match.field),
        hasFuzzyMatch: matchedFields.some((match) => match.match.isFuzzy),
        sourceCategoryId: options.category.id,
        sourceMessageId: options.sourceMessageId,
        dictionaryId: options.dictionaryId,
        dictionaryTitle: options.dictionary.title,
        categoryPath,
      },
      score,
      order: options.results.length,
    });
  }
}

function collectMatchedDictionaryFields(
  entry: DictionaryEntry,
  query: CompiledDictionarySearchQuery
): Array<{ field: DictionaryEntryField; match: DictionarySearchMatch }> {
  const matchedFields: Array<{
    field: DictionaryEntryField;
    match: DictionarySearchMatch;
  }> = [];

  for (const field of DICTIONARY_EDITOR_SEARCH_FIELDS) {
    const match = findDictionaryEditorSearchMatch(entry[field], query);
    if (!match) {
      continue;
    }

    matchedFields.push({
      field,
      match,
    });
  }

  return matchedFields;
}

function getDictionarySearchFieldScore(field: DictionaryEntryField): number {
  return field === "side1" || field === "side2" ? 40 : 10;
}
