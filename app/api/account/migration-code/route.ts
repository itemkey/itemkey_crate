import { getAccountStore } from "@/lib/account-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    if (!user.userId) {
      return Response.json(
        { error: "Сначала задай user-id, затем можно выпустить migration-код." },
        { status: 400 }
      );
    }

    const accountStore = await getAccountStore();
    const issued = await accountStore.issueMigrationCode(user.id);

    return Response.json(
      {
        data: {
          userId: user.userId,
          code: issued.code,
          codeHint: issued.codeHint,
          expiresAt: issued.expiresAt,
        },
        source: accountStore.source,
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
        error: toErrorMessage(error, "Не удалось выпустить migration-код."),
      },
      { status: 500 }
    );
  }
}
