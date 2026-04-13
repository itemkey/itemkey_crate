import { NextRequest } from "next/server";

import { getAccountStore } from "@/lib/account-store";
import { parseUserIdCandidate } from "@/lib/account-user-id";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const candidate = request.nextUrl.searchParams.get("value");
    const userId = parseUserIdCandidate(candidate);
    if (!userId) {
      return Response.json(
        {
          error:
            "user-id: 3-32 символа, только a-z, 0-9, ., _, -, начало и конец: буква/цифра.",
        },
        { status: 400 }
      );
    }

    const accountStore = await getAccountStore();
    const available = await accountStore.isUserIdAvailable(userId);

    return Response.json({
      data: {
        userId,
        available,
      },
      source: accountStore.source,
    });
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось проверить user-id."),
      },
      { status: 500 }
    );
  }
}
