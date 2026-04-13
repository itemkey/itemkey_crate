import { NextRequest } from "next/server";

import { getAccountStore } from "@/lib/account-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

function assertNickname(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Ник должен быть строкой.");
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Ник не может быть пустым.");
  }

  if (normalized.length > 40) {
    throw new Error("Ник: максимум 40 символов.");
  }

  return normalized;
}

function assertProfileDescription(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Описание профиля должно быть строкой.");
  }

  const normalized = value.trim();
  if (normalized.length > 320) {
    throw new Error("Описание профиля: максимум 320 символов.");
  }

  return normalized;
}

function parseAvatarUrl(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Ссылка на аватар должна быть строкой.");
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > 500) {
    throw new Error("Ссылка на аватар слишком длинная.");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Укажи корректную ссылку на аватар.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Ссылка на аватар должна начинаться с http:// или https://.");
  }

  return normalized;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const accountStore = await getAccountStore();
    const availability = await accountStore.getUserIdChangeAvailability(user.id);
    const activeMigrationCode = await accountStore.getActiveMigrationCode(user.id);

    return Response.json({
      data: {
        appUserId: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        userId: user.userId,
        userIdChangedAt: user.userIdChangedAt,
        nickname: user.nickname,
        profileDescription: user.profileDescription,
        avatarUrl: user.avatarUrl,
        canChangeUserIdNow: availability.canChangeNow,
        nextUserIdChangeAt: availability.nextAllowedAt,
        activeMigrationCode,
      },
      source: accountStore.source,
    });
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось загрузить профиль аккаунта."),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const body = (await request.json()) as {
      nickname?: unknown;
      profileDescription?: unknown;
      avatarUrl?: unknown;
    };

    const patch: {
      nickname?: string;
      profileDescription?: string;
      avatarUrl?: string | null;
    } = {};

    try {
      if ("nickname" in body) {
        patch.nickname = assertNickname(body.nickname);
      }

      if ("profileDescription" in body) {
        patch.profileDescription = assertProfileDescription(body.profileDescription);
      }

      if ("avatarUrl" in body) {
        patch.avatarUrl = parseAvatarUrl(body.avatarUrl);
      }
    } catch (error) {
      return Response.json(
        {
          error: toErrorMessage(error, "Некорректные данные профиля."),
        },
        { status: 400 }
      );
    }

    if (Object.keys(patch).length === 0) {
      return Response.json(
        {
          error: "Нет данных для обновления профиля.",
        },
        { status: 400 }
      );
    }

    const accountStore = await getAccountStore();
    const updated = await accountStore.updateProfile(user.id, patch);
    const availability = await accountStore.getUserIdChangeAvailability(user.id);
    const activeMigrationCode = await accountStore.getActiveMigrationCode(user.id);

    return Response.json({
      data: {
        appUserId: updated.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
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
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось обновить профиль аккаунта."),
      },
      { status: 500 }
    );
  }
}
