import "server-only";

import { API_ERROR_CODES } from "@/lib/api-errors";
import { toErrorMessage } from "@/lib/errors";
import { PlannerConflictError, PlannerRevisionError } from "@/lib/planner/store";

export function plannerErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof PlannerRevisionError) {
    return Response.json(
      { code: "PLANNER_STALE_REVISION", error: error.message },
      { status: 409 }
    );
  }
  if (error instanceof PlannerConflictError) {
    return Response.json(
      { code: "PLANNER_CONFLICT", error: error.message },
      { status: 409 }
    );
  }
  return Response.json(
    { code: API_ERROR_CODES.INVALID_INPUT, error: toErrorMessage(error, fallback) },
    { status: 400 }
  );
}

export function plannerUnauthorizedResponse(): Response {
  return Response.json(
    { code: API_ERROR_CODES.UNAUTHORIZED, error: "Требуется вход в аккаунт." },
    { status: 401 }
  );
}

export function assertPlannerRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error("Некорректная ревизия планировщика.");
  }
  return revision;
}
