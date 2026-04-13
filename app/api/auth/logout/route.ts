import { cookies } from "next/headers";

import { deleteSessionByToken } from "@/lib/auth/store";
import {
  getSessionCookieBaseOptions,
  getSessionTokenFromRequest,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const token = getSessionTokenFromRequest(request);
    if (token) {
      await deleteSessionByToken(token);
    }

    const cookieStore = await cookies();
    cookieStore.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      expires: new Date(0),
      ...getSessionCookieBaseOptions(),
    });

    return Response.json({ ok: true, source: "postgres" });
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось завершить сессию."),
      },
      { status: 500 }
    );
  }
}
