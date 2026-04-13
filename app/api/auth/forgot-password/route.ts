import { AuthEmailDeliveryError, sendPasswordResetMail } from "@/lib/auth/mailer";
import {
  assertAuthRateLimit,
  AuthRateLimitError,
  buildAuthRateLimitContext,
  recordAuthRateEvent,
} from "@/lib/auth/rate-limit";
import {
  assertValidEmailCandidate,
  issuePasswordResetTokenForEmail,
  maybeRunAuthCleanup,
} from "@/lib/auth/store";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const GENERIC_MESSAGE =
  "Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля.";

export async function POST(request: Request) {
  let rateLimitContext = buildAuthRateLimitContext({
    action: "forgot_password",
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
      action: "forgot_password",
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
      const issued = await issuePasswordResetTokenForEmail(email);
      if (issued) {
        await sendPasswordResetMail({
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
            error: toErrorMessage(error, "Не удалось отправить письмо для сброса пароля."),
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
        error: toErrorMessage(error, "Не удалось отправить ссылку для сброса пароля."),
      },
      { status: 500 }
    );
  }
}
