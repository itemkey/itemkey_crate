import { cookies } from "next/headers";

import { assertValidUserId } from "@/lib/account-user-id";
import { assertValidPasswordCandidate } from "@/lib/auth/password";
import {
  assertAuthRateLimit,
  AuthRateLimitError,
  buildAuthRateLimitContext,
  recordAuthRateEvent,
} from "@/lib/auth/rate-limit";
import {
  createSessionForUser,
  EmailNotVerifiedError,
  InvalidCredentialsError,
  loginWithUserIdPassword,
  maybeRunAuthCleanup,
} from "@/lib/auth/store";
import {
  getSessionCookieBaseOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let rateLimitContext = buildAuthRateLimitContext({
    action: "login",
    request,
  });

  try {
    const body = (await request.json()) as {
      userId?: unknown;
      password?: unknown;
    };

    let userId: string;
    let password: string;

    try {
      userId = assertValidUserId(body.userId);
      password = assertValidPasswordCandidate(body.password);
    } catch (error) {
      await recordAuthRateEvent(rateLimitContext, false);
      return Response.json(
        {
          error: toErrorMessage(error, "Некорректные данные входа."),
        },
        { status: 400 }
      );
    }

    rateLimitContext = buildAuthRateLimitContext({
      action: "login",
      request,
      email: userId,
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
      const account = await loginWithUserIdPassword({
        userId,
        password,
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

      if (error instanceof InvalidCredentialsError) {
        return Response.json({ error: error.message }, { status: 401 });
      }

      if (error instanceof EmailNotVerifiedError) {
        return Response.json(
          {
            error: error.message,
            code: "email_not_verified",
          },
          { status: 403 }
        );
      }

      throw error;
    }
  } catch (error) {
    await recordAuthRateEvent(rateLimitContext, false);
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось выполнить вход."),
      },
      { status: 500 }
    );
  }
}
