import { NextRequest } from "next/server";

import { toErrorMessage } from "@/lib/errors";
import { getRequestUser } from "@/lib/request-user";

export const dynamic = "force-dynamic";

function createBootstrapTimer() {
  const startedAt = Date.now();
  let phaseStartedAt = startedAt;

  return (phase: string) => {
    const now = Date.now();
    console.info(
      `[workspace/bootstrap] ${phase}=${now - phaseStartedAt}ms total=${now - startedAt}ms`
    );
    phaseStartedAt = now;
  };
}

export async function GET(request: NextRequest) {
  const logPhase = createBootstrapTimer();

  try {
    const user = await getRequestUser(request);
    logPhase("session");
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

    logPhase("response");
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
            canChangeUserIdNow: true,
            nextUserIdChangeAt: null,
            activeMigrationCode: null,
          },
          categories: [],
          projects: [],
          initialCategoryId: null,
          initialMessages: [],
          publicPanel: null,
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
