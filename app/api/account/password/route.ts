import { cookies } from "next/headers";

import { assertValidPasswordCandidate } from "@/lib/auth/password";
import {
  assertAuthRateLimit,
  AuthRateLimitError,
  buildAuthRateLimitContext,
  recordAuthRateEvent,
} from "@/lib/auth/rate-limit";
import {
  changePasswordForUser,
  createSessionForUser,
  InvalidCurrentPasswordError,
  maybeRunAuthCleanup,
} from "@/lib/auth/store";
import {
  getSessionCookieBaseOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  let rateLimitContext = buildAuthRateLimitContext({
    action: "change_password",
    request,
  });

  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const body = (await request.json()) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };

    let currentPassword: string;
    let newPassword: string;

    try {
      currentPassword = assertValidPasswordCandidate(body.currentPassword);
      newPassword = assertValidPasswordCandidate(body.newPassword);

      if (currentPassword === newPassword) {
        throw new Error("Новый пароль должен отличаться от текущего.");
      }
    } catch (error) {
      await recordAuthRateEvent(rateLimitContext, false);
      return Response.json(
        {
          error: toErrorMessage(error, "Некорректные данные пароля."),
        },
        { status: 400 }
      );
    }

    rateLimitContext = buildAuthRateLimitContext({
      action: "change_password",
      request,
      email: user.email,
    });

    try {
      await assertAuthRateLimit(rateLimitContext);
    } catch (error) {
      if (error instanceof AuthRateLimitError) {
        return Response.json(
          {
            error: error.message,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(error.retryAfterSeconds),
            },
          }
        );
      }

      throw error;
    }

    try {
      const updated = await changePasswordForUser({
        appUserId: user.id,
        currentPassword,
        nextPassword: newPassword,
      });

      const session = await createSessionForUser(updated.id);
      const cookieStore = await cookies();
      cookieStore.set({
        name: SESSION_COOKIE_NAME,
        value: session.token,
        expires: session.expiresAt,
        ...getSessionCookieBaseOptions(),
      });

      maybeRunAuthCleanup();
      await recordAuthRateEvent(rateLimitContext, true);

      return Response.json({
        data: {
          id: updated.id,
          email: updated.email,
          emailVerifiedAt: updated.email_verified_at,
        },
        source: "postgres",
      });
    } catch (error) {
      await recordAuthRateEvent(rateLimitContext, false);

      if (error instanceof InvalidCurrentPasswordError) {
        return Response.json({ error: error.message }, { status: 401 });
      }

      throw error;
    }
  } catch (error) {
    await recordAuthRateEvent(rateLimitContext, false);
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось обновить пароль."),
      },
      { status: 500 }
    );
  }
}
