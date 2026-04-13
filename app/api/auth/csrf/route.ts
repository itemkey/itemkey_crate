import { cookies } from "next/headers";

import {
  buildCsrfToken,
  CSRF_COOKIE_NAME,
  getCsrfCookieBaseOptions,
} from "@/lib/auth/csrf";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const existing = cookieStore.get(CSRF_COOKIE_NAME)?.value;

    const token = existing ?? buildCsrfToken();
    if (!existing) {
      cookieStore.set({
        name: CSRF_COOKIE_NAME,
        value: token,
        ...getCsrfCookieBaseOptions(),
      });
    }

    return Response.json(
      {
        data: {
          token,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось подготовить CSRF-токен."),
      },
      { status: 500 }
    );
  }
}
