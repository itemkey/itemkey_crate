import { NextRequest } from "next/server";

import { getAccountStore } from "@/lib/account-store";
import { getInitialCategoryId } from "@/lib/categories";
import { getCategoryStore } from "@/lib/category-store";
import { getCollaborationStore } from "@/lib/collaboration-store";
import { toErrorMessage } from "@/lib/errors";
import { getProjectStore } from "@/lib/project-store";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return Response.json(
        {
          data: {
            authUser: null,
          },
          source: "postgres",
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const accountStore = await getAccountStore();
    const categoryStore = await getCategoryStore(user.id);
    const projectStore = await getProjectStore(user.id);
    const collaborationStore = await getCollaborationStore();

    const [availability, activeMigrationCode, categories, projects, friends] =
      await Promise.all([
        accountStore.getUserIdChangeAvailability(user.id),
        accountStore.getActiveMigrationCode(user.id),
        categoryStore.list(),
        projectStore.list(),
        collaborationStore.listFriends(user.id),
      ]);

    const initialCategoryId = getInitialCategoryId(categories) ?? categories[0]?.id ?? null;
    const [initialMessages, publicPanel] = await Promise.all([
      initialCategoryId ? categoryStore.listMessages(initialCategoryId) : Promise.resolve([]),
      initialCategoryId
        ? collaborationStore.getPublicPanel(user.id, initialCategoryId)
        : Promise.resolve(null),
    ]);

    return Response.json(
      {
        data: {
          authUser: {
            id: user.id,
            email: user.email,
            emailVerifiedAt: user.emailVerifiedAt,
          },
          account: {
            appUserId: user.id,
            email: user.email,
            emailVerifiedAt: user.emailVerifiedAt,
            userId: user.userId,
            userIdChangedAt: user.userIdChangedAt,
            nickname: user.nickname,
            profileDescription: user.profileDescription,
            avatarUrl: user.avatarUrl,
            canChangeUserIdNow: availability.canChangeNow,
            nextUserIdChangeAt: availability.nextAllowedAt,
            activeMigrationCode,
          },
          categories,
          projects,
          friends,
          initialCategoryId,
          initialMessages,
          publicPanel,
        },
        source: "postgres",
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
        error: toErrorMessage(error, "Unable to bootstrap workspace."),
      },
      { status: 500 }
    );
  }
}
