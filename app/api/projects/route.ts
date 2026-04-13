import { NextRequest } from "next/server";

import {
  getProjectStore,
  serializeSerializedList,
} from "@/lib/project-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const store = await getProjectStore(user.id);
    const projects = await store.list();
    return Response.json({ data: projects, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to load projects.") },
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
      title?: unknown;
      tags?: unknown;
      containerCategoryIds?: unknown;
    };

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return Response.json({ error: "Название проекта не может быть пустым." }, { status: 400 });
    }

    const tags = normalizeTagList(body.tags);
    const containerCategoryIds = normalizePlainList(body.containerCategoryIds);

    const store = await getProjectStore(user.id);
    const created = await store.create({
      title,
      tag_filter: serializeSerializedList(tags),
      container_category_ids: serializeSerializedList(containerCategoryIds),
    });

    return Response.json({ data: created, source: store.source }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to create project.") },
      { status: 500 }
    );
  }
}

function normalizeTagInput(value: string): string {
  const withoutHash = value.trim().replace(/^#+/, "").replace(/\s+/g, " ");
  if (!withoutHash) {
    return "";
  }

  return `#${withoutHash}`;
}

function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of value) {
    if (typeof raw !== "string") {
      continue;
    }

    const normalized = normalizeTagInput(raw);
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

function normalizePlainList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of value) {
    if (typeof raw !== "string") {
      continue;
    }

    const normalized = raw.trim();
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
