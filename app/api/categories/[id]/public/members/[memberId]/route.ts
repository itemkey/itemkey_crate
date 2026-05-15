import { NextRequest } from "next/server";

import { getCollaborationStore } from "@/lib/collaboration-store";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";
import { publishRealtimeEvent } from "@/lib/realtime";
import type { PublicCategoryMemberRole } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; memberId: string }>;
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json({ error: "Требуется вход в аккаунт." }, { status: 401 });
    }

    const { id, memberId } = await context.params;
    if (!id || !memberId) {
      return Response.json({ error: "Missing public member id." }, { status: 400 });
    }

    const body = (await request.json()) as { role?: unknown };
    if (body.role !== "viewer" && body.role !== "editor") {
      return Response.json({ error: "role должен быть viewer или editor." }, { status: 400 });
    }

    const role: PublicCategoryMemberRole = body.role;
    const store = await getCollaborationStore();
    const panel = await store.updatePublicMemberRole({
      ownerAppUserId: user.id,
      categoryId: id,
      memberId,
      role,
    });

    await publishRealtimeEvent({
      kind: "public",
      action: "public_member_role",
      userIds: panelUserIds(panel),
      categoryIds: [id],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: panel, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось обновить права участника.") },
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

    const { id, memberId } = await context.params;
    if (!id || !memberId) {
      return Response.json({ error: "Missing public member id." }, { status: 400 });
    }

    const store = await getCollaborationStore();
    const before = await store.getPublicPanel(user.id, id);
    const panel = await store.removePublicMember({
      ownerAppUserId: user.id,
      categoryId: id,
      memberId,
    });

    await publishRealtimeEvent({
      kind: "public",
      action: "public_member_remove",
      userIds: panelUserIds(before),
      categoryIds: [id],
      originClientId: getOriginClientId(request),
    });

    return Response.json({ data: panel, source: store.source });
  } catch (error) {
    return Response.json(
      { error: toErrorMessage(error, "Не удалось удалить участника.") },
      { status: 500 }
    );
  }
}
