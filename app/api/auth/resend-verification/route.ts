import { AuthEmailDeliveryError, sendEmailVerificationMail } from "@/lib/auth/mailer";
import {
  assertAuthRateLimit,
  AuthRateLimitError,
  buildAuthRateLimitContext,
  recordAuthRateEvent,
} from "@/lib/auth/rate-limit";
import {
  assertValidEmailCandidate,
  issueEmailVerificationTokenByEmail,
  maybeRunAuthCleanup,
} from "@/lib/auth/store";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const GENERIC_MESSAGE =
  "Если аккаунт существует и еще не подтвержден, мы отправили письмо со ссылкой.";

export async function POST(request: Request) {
  let rateLimitContext = buildAuthRateLimitContext({
    action: "resend_verification",
    request,
  });

  try {
    const body = (await request.json()) as {
      email?: unknown;
    };

    let email: string;
    try {
      email = assertValidEmailCandidate(body.email);
    } catch (error) {
      await recordAuthRateEvent(rateLimitContext, false);
      return Response.json(
        {
          error: toErrorMessage(error, "Некорректный email."),
        },
        { status: 400 }
      );
    }

    rateLimitContext = buildAuthRateLimitContext({
      action: "resend_verification",
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
      const issued = await issueEmailVerificationTokenByEmail(email);
      if (issued) {
        await sendEmailVerificationMail({
          to: issued.email,
          token: issued.token,
          expiresAt: issued.expiresAt,
        });
      }

      maybeRunAuthCleanup();
      await recordAuthRateEvent(rateLimitContext, true);

      return Response.json({
        ok: true,
        message: GENERIC_MESSAGE,
      });
    } catch (error) {
      await recordAuthRateEvent(rateLimitContext, false);

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
        error: toErrorMessage(error, "Не удалось отправить письмо подтверждения."),
      },
      { status: 500 }
    );
  }
}
