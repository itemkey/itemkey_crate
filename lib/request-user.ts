import "server-only";

import { getSessionTokenFromRequest } from "@/lib/auth/session";
import { getUserBySessionToken } from "@/lib/auth/store";
import type { Locale } from "@/lib/i18n";

export type RequestUser = {
  id: string;
  email: string | null;
  emailVerifiedAt: string | null;
  userId: string | null;
  userIdChangedAt: string | null;
  nickname: string;
  profileDescription: string;
  avatarUrl: string | null;
  locale: Locale;
};

export async function getRequestUserBySessionToken(
  token: string | null | undefined
): Promise<RequestUser | null> {
  if (!token) {
    return null;
  }

  const appUser = await getUserBySessionToken(token);
  if (!appUser) {
    return null;
  }

  return {
    id: appUser.id,
    email: appUser.email,
    emailVerifiedAt: appUser.email_verified_at,
    userId: appUser.user_id,
    userIdChangedAt: appUser.user_id_changed_at,
    nickname: appUser.nickname,
    profileDescription: appUser.profile_description,
    avatarUrl: appUser.avatar_url,
    locale: appUser.locale,
  };
}

export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const token = getSessionTokenFromRequest(request);
  return getRequestUserBySessionToken(token);
}
