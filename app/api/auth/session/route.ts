import { getRequestUser } from "@/lib/request-user";
import { toErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ data: null, source: "postgres" });
    }

    return Response.json({
      data: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
      },
      source: "postgres",
    });
  } catch (error) {
    return Response.json(
      {
        error: toErrorMessage(error, "Не удалось проверить сессию."),
      },
      { status: 500 }
    );
  }
}
