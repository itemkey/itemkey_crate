import { cookies } from "next/headers";

import { assertValidUserId } from "@/lib/account-user-id";
import { AuthEmailDeliveryError, sendEmailVerificationMail } from "@/lib/auth/mailer";
import { assertValidPasswordCandidate } from "@/lib/auth/password";
import {
  assertAuthRateLimit,
  AuthRateLimitError,
  buildAuthRateLimitContext,
  recordAuthRateEvent,
} from "@/lib/auth/rate-limit";
import {
  assertValidEmailCandidate,
  AuthEmailTakenError,
  AuthUserIdTakenError,
  createSessionForUser,
  isEmailVerificationRequired,
  issueEmailVerificationToken,
  maybeRunAuthCleanup,
  registerWithEmailPassword,
} from "@/lib/auth/store";
import {
  getSessionCookieBaseOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let rateLimitContext = buildAuthRateLimitContext({
    action: "register",
    request,
  });

  try {
    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
      userId?: unknown;
    };

    let email: string;
    let password: string;
    let userId: string;

    try {
      email = assertValidEmailCandidate(body.email);
      password = assertValidPasswordCandidate(body.password);
      userId = assertValidUserId(body.userId);
    } catch (error) {
      await recordAuthRateEvent(rateLimitContext, false);
      return Response.json(
        {
          error: toErrorMessage(error, "Некорректные данные регистрации."),
        },
        { status: 400 }
      );
    }

    rateLimitContext = buildAuthRateLimitContext({
      action: "register",
      request,
      email,
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
      const account = await registerWithEmailPassword({
        email,
        password,
        userId,
      });

      if (isEmailVerificationRequired() && !account.email_verified_at) {
        const verification = await issueEmailVerificationToken(account.id);
        await sendEmailVerificationMail({
          to: account.email,
          token: verification.token,
          expiresAt: verification.expiresAt,
        });

        maybeRunAuthCleanup();
        await recordAuthRateEvent(rateLimitContext, true);

        return Response.json(
          {
            requiresEmailVerification: true,
            email: account.email,
            source: "postgres",
          },
          { status: 201 }
        );
      }

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

      return Response.json(
        {
          data: {
            id: account.id,
            email: account.email,
            emailVerifiedAt: account.email_verified_at,
          },
          source: "postgres",
        },
        { status: 201 }
      );
    } catch (error) {
      await recordAuthRateEvent(rateLimitContext, false);

      if (error instanceof AuthEmailTakenError || error instanceof AuthUserIdTakenError) {
        return Response.json({ error: error.message }, { status: 409 });
      }

      if (error instanceof AuthEmailDeliveryError) {
        return Response.json(
          {
            error: toErrorMessage(error, "Не удалось отправить письмо подтверждения."),
          },
          { status: 503 }
        );
      }

      throw error;
    }
  } catch (error) {
    await recordAuthRateEvent(rateLimitContext, false);
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось создать аккаунт."),
      },
      { status: 500 }
    );
  }
}
