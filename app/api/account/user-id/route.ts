import { NextRequest } from "next/server";

import {
  getAccountStore,
  UserIdCooldownError,
  UserIdTakenError,
} from "@/lib/account-store";
import { assertValidUserId } from "@/lib/account-user-id";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const body = (await request.json()) as {
      userId?: unknown;
    };

    let nextUserId: string;
    try {
      nextUserId = assertValidUserId(body.userId);
    } catch (error) {
      return Response.json(
        {
          error: toErrorMessage(error, "Некорректный user-id."),
        },
        { status: 400 }
      );
    }

    const accountStore = await getAccountStore();

    try {
      const updated = await accountStore.updateUserId(user.id, nextUserId);
      const availability = await accountStore.getUserIdChangeAvailability(user.id);

      return Response.json({
        data: {
          appUserId: updated.id,
          userId: updated.user_id,
          userIdChangedAt: updated.user_id_changed_at,
          canChangeUserIdNow: availability.canChangeNow,
          nextUserIdChangeAt: availability.nextAllowedAt,
        },
        source: accountStore.source,
      });
    } catch (error) {
      if (error instanceof UserIdTakenError) {
        return Response.json({ error: error.message }, { status: 409 });
      }

      if (error instanceof UserIdCooldownError) {
        return Response.json(
          {
            error: error.message,
            nextUserIdChangeAt: error.nextAllowedAt,
          },
          { status: 429 }
        );
      }

      throw error;
    }
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось обновить user-id."),
      },
      { status: 500 }
    );
  }
}
