import { NextRequest } from "next/server";

import { parsePlannerCommands, parseSleepCommand } from "@/lib/planner/engine";
import { plannerErrorResponse, plannerUnauthorizedResponse } from "@/lib/planner/api";
import { getPlannerStore } from "@/lib/planner/store";
import { getRequestUser } from "@/lib/request-user";

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) return plannerUnauthorizedResponse();
    const body = (await request.json()) as { mode?: unknown; text?: unknown };
    const text = typeof body.text === "string" ? body.text.slice(0, 12_000) : "";
    if (!text.trim()) throw new Error("Введите текст для разбора.");
    if (body.mode === "sleep") return Response.json({ data: parseSleepCommand(text) });
    const bootstrap = await (await getPlannerStore()).getBootstrap(user.id);
    return Response.json({ data: parsePlannerCommands(text, bootstrap.profile) });
  } catch (error) {
    return plannerErrorResponse(error, "Не удалось разобрать ввод автопланировщика.");
  }
}
