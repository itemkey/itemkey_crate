import { NextRequest } from "next/server";

import {
  DictionaryStudyProgressSourceError,
  getDictionaryStudyProgressStore,
} from "@/lib/dictionary-study-progress-store";
import {
  normalizeDictionaryStudyProgressSource,
  normalizePersistedDictionaryStudyProgress,
} from "@/lib/dictionary-study-progress-types";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const source = normalizeDictionaryStudyProgressSource({
      sourceCategoryId: request.nextUrl.searchParams.get("sourceCategoryId"),
      sourceMessageId: request.nextUrl.searchParams.get("sourceMessageId"),
      dictionaryId: request.nextUrl.searchParams.get("dictionaryId"),
    });
    if (!source) {
      return Response.json({ error: "Некорректный источник заучивания." }, { status: 400 });
    }

    const store = getDictionaryStudyProgressStore(user.id);
    const progress = await store.get(source);
    return Response.json(
      { data: progress, source: store.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось загрузить прогресс заучивания."),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const body = (await request.json()) as {
      sourceCategoryId?: unknown;
      sourceMessageId?: unknown;
      dictionaryId?: unknown;
      progress?: unknown;
    };
    const source = normalizeDictionaryStudyProgressSource(body);
    if (!source) {
      return Response.json({ error: "Некорректный источник заучивания." }, { status: 400 });
    }

    const progress = normalizePersistedDictionaryStudyProgress(body.progress);
    if (!progress) {
      return Response.json({ error: "Некорректный прогресс заучивания." }, { status: 400 });
    }

    const store = getDictionaryStudyProgressStore(user.id);
    const saved = await store.upsert(source, progress);
    return Response.json(
      { data: saved, source: store.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof DictionaryStudyProgressSourceError) {
      return Response.json(
        { error: "Источник заучивания не найден." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось сохранить прогресс заучивания."),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
