import { cookies } from "next/headers";

import {
  assertAuthRateLimit,
  AuthRateLimitError,
  buildAuthRateLimitContext,
  recordAuthRateEvent,
} from "@/lib/auth/rate-limit";
import {
  createSessionForUser,
  maybeRunAuthCleanup,
  PasswordResetTokenInvalidError,
  resetPasswordByToken,
} from "@/lib/auth/store";
import {
  getSessionCookieBaseOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rateLimitContext = buildAuthRateLimitContext({
    action: "reset_password",
    request,
  });

  try {
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

    const body = (await request.json()) as {
      token?: unknown;
      password?: unknown;
    };

    try {
      const account = await resetPasswordByToken({
        token: body.token,
        newPassword: body.password,
      });

      const session = await createSessionForUser(account.id);
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
          id: account.id,
          email: account.email,
          emailVerifiedAt: account.email_verified_at,
        },
        source: "postgres",
      });
    } catch (error) {
      await recordAuthRateEvent(rateLimitContext, false);

      if (error instanceof PasswordResetTokenInvalidError) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }
  } catch (error) {
    await recordAuthRateEvent(rateLimitContext, false);
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось сбросить пароль."),
      },
      { status: 500 }
    );
  }
}
