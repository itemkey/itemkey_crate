import { cookies } from "next/headers";

import CrateWorkspace, {
  type InitialCategoryDetailResult,
} from "@/components/crate-workspace";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { toErrorMessage } from "@/lib/errors";
import { getRequestUserBySessionToken } from "@/lib/request-user";
import {
  loadCategoryDetail,
  loadWorkspaceShell,
} from "@/lib/workspace-initial-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export default async function CratePage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const initialData = sessionToken
    ? await withTimeout(
        getRequestUserBySessionToken(sessionToken).then(async (user) => ({
          user,
          shell: user ? await loadWorkspaceShell(user) : null,
        })),
        8000,
        "Рабочая область загружается слишком долго."
      )
    : { user: null, shell: null };
  const { user, shell } = initialData;

  if (!user || !shell) {
    return (
      <CrateWorkspace
        key="anonymous"
        initialShellData={null}
        initialDetailPromise={null}
      />
    );
  }

  const initialDetailPromise: Promise<InitialCategoryDetailResult> | null =
    shell.initialCategoryId
      ? withTimeout(
          loadCategoryDetail(user.id, shell.initialCategoryId),
          8000,
          "Материал загружается слишком долго."
        )
          .then((data) => ({ data, error: null }))
          .catch((error: unknown) => ({
            data: null,
            error: toErrorMessage(error, "Не удалось загрузить материал."),
          }))
      : null;

  return (
    <CrateWorkspace
      key={user.id}
      initialShellData={shell}
      initialDetailPromise={initialDetailPromise}
    />
  );
}
