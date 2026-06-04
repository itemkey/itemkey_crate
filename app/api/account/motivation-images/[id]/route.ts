import { NextRequest } from "next/server";

import { getAccountImageStore } from "@/lib/account-image-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    const imageStore = getAccountImageStore();
    await imageStore.deleteMotivationImage(user.id, id);

    return Response.json({ data: { id }, source: imageStore.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось удалить мотивационное фото.") },
      { status: 500 }
    );
  }
}
