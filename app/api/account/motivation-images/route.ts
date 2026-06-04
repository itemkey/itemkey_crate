import { NextRequest } from "next/server";

import {
  ACCOUNT_IMAGE_MAX_BYTES,
  getAccountImageStore,
  inferAccountImageMimeTypeByFileName,
  normalizeAccountImageMimeType,
} from "@/lib/account-image-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const imageStore = getAccountImageStore();
    const images = await imageStore.listMotivationImages(user.id);

    return Response.json(
      { data: images, source: imageStore.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось загрузить мотивационные фото.") },
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

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return badRequest("Выбери фото для мотивационной панели.");
    }

    if (file.size <= 0) {
      return badRequest("Файл фото пустой.");
    }

    if (file.size > ACCOUNT_IMAGE_MAX_BYTES) {
      return badRequest("Фото должно быть не больше 5 МБ.");
    }

    const mimeType =
      normalizeAccountImageMimeType(file.type) ??
      inferAccountImageMimeTypeByFileName(file.name);
    if (!mimeType) {
      return badRequest("Поддерживаются PNG, JPG, WebP, GIF и BMP.");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const imageStore = getAccountImageStore();
    const created = await imageStore.createMotivationImage({
      appUserId: user.id,
      mimeType,
      bytes,
    });

    return Response.json({ data: created, source: imageStore.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось загрузить мотивационное фото.") },
      { status: 500 }
    );
  }
}
