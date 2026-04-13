import { NextRequest } from "next/server";

import {
  getProjectStore,
  serializeSerializedList,
} from "@/lib/project-store";
import { toErrorMessage } from "@/lib/errors";
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
      return Response.json({ error: "Missing project id." }, { status: 400 });
    }

    const body = (await request.json()) as {
      title?: unknown;
      tags?: unknown;
      containerCategoryIds?: unknown;
      position?: unknown;
    };

    const patch: {
      title?: string;
      tag_filter?: string;
      container_category_ids?: string;
      position?: number;
    } = {};

    if ("title" in body) {
      if (typeof body.title !== "string") {
        return Response.json({ error: "Название проекта должно быть строкой." }, { status: 400 });
      }

      const trimmed = body.title.trim();
      if (!trimmed) {
        return Response.json({ error: "Название проекта не может быть пустым." }, { status: 400 });
      }

      patch.title = trimmed;
    }

    if ("tags" in body) {
      patch.tag_filter = serializeSerializedList(normalizeTagList(body.tags));
    }

    if ("containerCategoryIds" in body) {
      patch.container_category_ids = serializeSerializedList(
        normalizePlainList(body.containerCategoryIds)
      );
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

    const store = await getProjectStore(user.id);
    const updated = await store.update(id, patch);
    return Response.json({ data: updated, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to update project.") },
      { status: 500 }
    );
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
      return Response.json({ error: "Missing project id." }, { status: 400 });
    }

    const store = await getProjectStore(user.id);
    await store.remove(id);
    return Response.json({ ok: true, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Unable to delete project.") },
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
