import type {
  CategoryFormat,
  CategoryType,
  CategoryRow,
  MessageRow,
  MessageType,
} from "@/lib/types";

export const CATEGORY_TREE_SCHEMA_VERSION = 1;

export type CategoryTreeCategory = {
  id: string;
  parent_id: string | null;
  title: string;
  content: string;
  description: string;
  tag: string;
  format: CategoryFormat;
  category_type: CategoryType;
  position: number;
};

export type CategoryTreeMessage = {
  id: string;
  category_id: string;
  title: string;
  content: string;
  position: number;
  message_type: MessageType;
};

export type CategoryTreeDocument = {
  schemaVersion: number;
  exportedAt: string;
  rootCategoryId: string;
  categories: CategoryTreeCategory[];
  messages: CategoryTreeMessage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  return null;
}

function asPosition(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  return 0;
}

function asCategoryFormat(value: unknown): CategoryFormat {
  return value === "block" ? "block" : "continuous";
}

function asCategoryType(value: unknown): CategoryType {
  return value === "learning" ? "learning" : "learning";
}

function asMessageType(value: unknown): MessageType {
  return value === "exercise" ? "exercise" : "info";
}

function normalizeCategory(input: unknown): CategoryTreeCategory | null {
  if (!isRecord(input)) {
    return null;
  }

  const id = asString(input.id).trim();
  const title = asString(input.title).trim();
  if (!id || !title) {
    return null;
  }

  return {
    id,
    parent_id: asNullableString(input.parent_id),
    title,
    content: asString(input.content),
    description: asString(input.description),
    tag: asString(input.tag),
    format: asCategoryFormat(input.format),
    category_type: asCategoryType(input.category_type),
    position: asPosition(input.position),
  };
}

function normalizeMessage(input: unknown): CategoryTreeMessage | null {
  if (!isRecord(input)) {
    return null;
  }

  const id = asString(input.id).trim();
  const categoryId = asString(input.category_id).trim();
  const title = asString(input.title).trim();
  if (!id || !categoryId || !title) {
    return null;
  }

  return {
    id,
    category_id: categoryId,
    title,
    content: asString(input.content),
    position: asPosition(input.position),
    message_type: asMessageType(input.message_type),
  };
}

export function buildCategoryTreeDocument(
  rootCategoryId: string,
  categories: CategoryRow[],
  messages: MessageRow[]
): CategoryTreeDocument {
  return {
    schemaVersion: CATEGORY_TREE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    rootCategoryId,
    categories: categories.map((category) => ({
      id: category.id,
      parent_id: category.parent_id,
      title: category.title,
      content: category.content,
      description: category.description,
      tag: category.tag,
      format: category.format,
      category_type: category.category_type,
      position: category.position,
    })),
    messages: messages.map((message) => ({
      id: message.id,
      category_id: message.category_id,
      title: message.title,
      content: message.content,
      position: message.position,
      message_type: message.message_type,
    })),
  };
}

export function parseCategoryTreeDocument(value: unknown): CategoryTreeDocument {
  if (!isRecord(value)) {
    throw new Error("Неверный формат файла импорта.");
  }

  const schemaVersion =
    typeof value.schemaVersion === "number" ? value.schemaVersion : NaN;
  if (schemaVersion !== CATEGORY_TREE_SCHEMA_VERSION) {
    throw new Error("Неподдерживаемая версия файла импорта.");
  }

  const rootCategoryId = asString(value.rootCategoryId).trim();
  if (!rootCategoryId) {
    throw new Error("В файле импорта отсутствует rootCategoryId.");
  }

  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    throw new Error("В файле импорта отсутствуют категории.");
  }

  const categories: CategoryTreeCategory[] = [];
  for (const rawCategory of value.categories) {
    const normalized = normalizeCategory(rawCategory);
    if (!normalized) {
      throw new Error("В файле импорта есть категория с некорректными данными.");
    }

    categories.push(normalized);
  }

  const uniqueCategoryIds = new Set(categories.map((category) => category.id));
  if (uniqueCategoryIds.size !== categories.length) {
    throw new Error("В файле импорта есть дубликаты id категорий.");
  }

  if (!uniqueCategoryIds.has(rootCategoryId)) {
    throw new Error("Корневая категория файла не найдена в списке категорий.");
  }

  for (const category of categories) {
    if (category.id === rootCategoryId) {
      continue;
    }

    if (!category.parent_id || !uniqueCategoryIds.has(category.parent_id)) {
      throw new Error("В файле импорта найдена категория с неверной parent_id.");
    }
  }

  const rawMessages = Array.isArray(value.messages) ? value.messages : [];
  const messages: CategoryTreeMessage[] = [];
  for (const rawMessage of rawMessages) {
    const normalized = normalizeMessage(rawMessage);
    if (!normalized) {
      throw new Error("В файле импорта есть сообщение с некорректными данными.");
    }

    if (!uniqueCategoryIds.has(normalized.category_id)) {
      throw new Error("В файле импорта сообщение ссылается на неизвестную категорию.");
    }

    messages.push(normalized);
  }

  return {
    schemaVersion,
    exportedAt: asString(value.exportedAt) || new Date().toISOString(),
    rootCategoryId,
    categories,
    messages,
  };
}
