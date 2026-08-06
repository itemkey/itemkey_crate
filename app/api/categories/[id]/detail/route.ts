import { getCategoryStore } from "@/lib/category-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const store = await getCategoryStore(user.id);
    const detail = await store.getDetail(id);
    return Response.json(
      { data: detail, source: store.source },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const message = toErrorMessage(error, "Не удалось загрузить материал.");
    const status = message.includes("not found") ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
