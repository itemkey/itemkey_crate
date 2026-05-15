import { NextRequest } from "next/server";

import { getCollaborationStore } from "@/lib/collaboration-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function getOriginClientId(request: NextRequest): string | null {
  return request.headers.get("x-client-id")?.trim() || null;
}

function panelUserIds(panel: { ownerAppUserId: string | null; members: { appUserId: string }[] }) {
  return [
    panel.ownerAppUserId,
    ...panel.members.map((member) => member.appUserId),
  ].filter((id): id is string => Boolean(id));
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const panel = await store.getPublicPanel(user.id, id);
    return Response.json({ data: panel, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось загрузить public-настройки.") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const panel = await store.enablePublicCategory(user.id, id);

    await publishRealtimeEvent({
      kind: "public",
      action: "public_enable",
      userIds: panelUserIds(panel),
      categoryIds: [id],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: panel, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось включить public-категорию.") },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return Response.json({ error: "Missing category id." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const before = await store.getPublicPanel(user.id, id);
    const panel = await store.disablePublicCategory(user.id, id);

    await publishRealtimeEvent({
      kind: "public",
      action: "public_disable",
      userIds: panelUserIds(before),
      categoryIds: [id],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: panel, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось выключить public-категорию.") },
      { status: 500 }
    );
  }
}
