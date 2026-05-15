import "server-only";

import { getCollaborationStore } from "@/lib/collaboration-store";

export function getOriginClientId(request: Request): string | null {
  return request.headers.get("x-client-id")?.trim() || null;
}

export async function getCategoryRealtimeUserIds(
  appUserId: string,
  categoryId: string
): Promise<string[]> {
  try {
    const collaborationStore = await getCollaborationStore();
    const panel = await collaborationStore.getPublicPanel(appUserId, categoryId);
    if (!panel.enabled) {
      return [appUserId];
    }

    return Array.from(
      new Set(
        [
          panel.ownerAppUserId,
          ...panel.members.map((member) => member.appUserId),
        ].filter((id): id is string => Boolean(id))
      )
    );
  } catch {
    return [appUserId];
  }
}
