import { NextRequest } from "next/server";

import {
  ACCOUNT_IMAGE_MAX_BYTES,
  getAccountImageStore,
  inferAccountImageMimeTypeByFileName,
  normalizeAccountImageMimeType,
} from "@/lib/account-image-store";
import { getAccountStore } from "@/lib/account-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import type { AppUserRow } from "@/lib/types";

export const dynamic = "force-dynamic";

async function accountResponse(updated: AppUserRow, requestUserId: string) {
  const accountStore = await getAccountStore();
  const [availability, activeMigrationCode] = await Promise.all([
    accountStore.getUserIdChangeAvailability(requestUserId),
    accountStore.getActiveMigrationCode(requestUserId),
  ]);

  return Response.json({
    data: {
      appUserId: updated.id,
      email: updated.email,
      emailVerifiedAt: updated.email_verified_at,
      userId: updated.user_id,
      userIdChangedAt: updated.user_id_changed_at,
      nickname: updated.nickname,
      profileDescription: updated.profile_description,
      avatarUrl: updated.avatar_url,
      canChangeUserIdNow: availability.canChangeNow,
      nextUserIdChangeAt: availability.nextAllowedAt,
      activeMigrationCode,
    },
    source: accountStore.source,
  });
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
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
      return badRequest("Выбери файл аватара.");
    }

    if (file.size <= 0) {
      return badRequest("Файл аватара пустой.");
    }

    if (file.size > ACCOUNT_IMAGE_MAX_BYTES) {
      return badRequest("Аватар должен быть не больше 5 МБ.");
    }

    const mimeType =
      normalizeAccountImageMimeType(file.type) ??
      inferAccountImageMimeTypeByFileName(file.name);
    if (!mimeType) {
      return badRequest("Поддерживаются PNG, JPG, WebP, GIF и BMP.");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const imageStore = getAccountImageStore();
    const updated = await imageStore.replaceAvatar({
      appUserId: user.id,
      mimeType,
      bytes,
    });

    return accountResponse(updated, user.id);
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось загрузить аватар.") },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const imageStore = getAccountImageStore();
    const updated = await imageStore.clearAvatar(user.id);

    return accountResponse(updated, user.id);
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось удалить аватар.") },
      { status: 500 }
    );
  }
}
