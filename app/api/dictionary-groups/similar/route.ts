import { NextRequest } from "next/server";

import { getDictionaryGroupStore } from "@/lib/dictionary-groups";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const store = await getDictionaryGroupStore(user.id);
    const result = await store.resolveSimilar({
      sourceCategoryId: request.nextUrl.searchParams.get("sourceCategoryId"),
      sourceMessageId: request.nextUrl.searchParams.get("sourceMessageId"),
      dictionaryId: request.nextUrl.searchParams.get("dictionaryId"),
      entryId: request.nextUrl.searchParams.get("entryId"),
    });

    return Response.json(
      { data: result, source: store.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось загрузить похожие слова.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
