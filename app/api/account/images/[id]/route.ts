import { NextRequest } from "next/server";

import { getAccountImageStore } from "@/lib/account-image-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    const imageStore = getAccountImageStore();
    const image = await imageStore.getImage(id);
    if (!image) {
      return Response.json({ error: "Фото не найдено." }, { status: 404 });
    }

    if (image.kind === "motivation" && image.appUserId !== user.id) {
      return Response.json({ error: "Нет доступа к этому фото." }, { status: 403 });
    }

    const body = new ArrayBuffer(image.imageData.length);
    new Uint8Array(body).set(image.imageData);

    return new Response(body, {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(image.sizeBytes),
        "Content-Type": image.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось открыть фото.") },
      { status: 500 }
    );
  }
}
