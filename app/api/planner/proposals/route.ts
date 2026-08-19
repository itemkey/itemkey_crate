import { NextRequest } from "next/server";

import { plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import type { PlannerDraft, PlannerProposal } from "@/lib/planner/types";
import { getRequestUser } from "@/lib/request-user";

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    const body = (await request.json()) as {
      command?: unknown;
      draft?: PlannerDraft;
      trigger?: PlannerProposal["trigger"];
    };
    const command = typeof body.command === "string" ? body.command.slice(0, 2000) : undefined;
    if (!command && !body.draft && body.trigger !== "autoplan" && body.trigger !== "day_refresh") {
      throw new Error("Опишите новое дело или запустите автоплан.");
    }
    const data = await (await getPlannerStore()).createProposal(user.id, {
      command, draft: body.draft, trigger: body.trigger,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось подготовить новый план.");
  }
}
