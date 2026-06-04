import "server-only";

import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import { getPostgresPool } from "@/lib/db/postgres";
import type { AppUserRow } from "@/lib/types";

export type AccountImageKind = "avatar" | "motivation";

export type AccountImageMeta = {
  id: string;
  kind: AccountImageKind;
  url: string;
  createdAt: string;
  sizeBytes: number;
};

export type AccountImageBlob = {
  id: string;
  appUserId: string;
  kind: AccountImageKind;
  mimeType: string;
  sizeBytes: number;
  imageData: Buffer;
  createdAt: string;
};

export const ACCOUNT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ACCOUNT_MOTIVATION_IMAGE_LIMIT = 24;

export const ACCOUNT_IMAGE_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const APP_USER_COLUMNS =
  "id,email,email_verified_at,user_id,user_id_changed_at,nickname,profile_description,avatar_url,created_at,updated_at";

type AccountImageRow = QueryResultRow & {
  id: string;
  app_user_id: string;
  kind: AccountImageKind;
  mime_type: string;
  size_bytes: number | string;
  image_data: Buffer;
  created_at: string;
};

export function normalizeAccountImageMimeType(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const resolved = normalized === "image/jpg" ? "image/jpeg" : normalized;
  return ACCOUNT_IMAGE_ALLOWED_MIME_TYPES.has(resolved) ? resolved : null;
}

export function inferAccountImageMimeTypeByFileName(fileName: string): string | null {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".bmp")) {
    return "image/bmp";
  }

  return null;
}

export function makeAccountImageUrl(id: string): string {
  return `/api/account/images/${id}`;
}

export function parseInternalAccountImageId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/^\/api\/account\/images\/([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

function toMeta(row: AccountImageRow): AccountImageMeta {
  return {
    id: row.id,
    kind: row.kind,
    url: makeAccountImageUrl(row.id),
    createdAt: row.created_at,
    sizeBytes: Number(row.size_bytes) || 0,
  };
}

function toBlob(row: AccountImageRow): AccountImageBlob {
  return {
    id: row.id,
    appUserId: row.app_user_id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes) || 0,
    imageData: row.image_data,
    createdAt: row.created_at,
  };
}

export function getAccountImageStore() {
  const pool = getPostgresPool();

  return {
    source: "postgres" as const,

    async replaceAvatar(input: {
      appUserId: string;
      mimeType: string;
      bytes: Buffer;
    }): Promise<AppUserRow> {
      const imageId = randomUUID();
      const imageUrl = makeAccountImageUrl(imageId);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const current = await client.query<{ avatar_url: string | null }>(
          `
            select avatar_url
            from public.app_users
            where id = $1::uuid
            for update
          `,
          [input.appUserId]
        );
        const oldAvatarImageId = parseInternalAccountImageId(
          current.rows[0]?.avatar_url ?? null
        );

        await client.query(
          `
            insert into public.account_images (
              id,
              app_user_id,
              kind,
              mime_type,
              size_bytes,
              image_data
            )
            values ($1::uuid, $2::uuid, 'avatar', $3::text, $4::integer, $5::bytea)
          `,
          [imageId, input.appUserId, input.mimeType, input.bytes.length, input.bytes]
        );

        const updated = await client.query<AppUserRow>(
          `
            update public.app_users
            set avatar_url = $2::text
            where id = $1::uuid
            returning ${APP_USER_COLUMNS}
          `,
          [input.appUserId, imageUrl]
        );

        if (oldAvatarImageId && oldAvatarImageId !== imageId) {
          await client.query(
            `
              delete from public.account_images
              where id = $1::uuid
                and app_user_id = $2::uuid
                and kind = 'avatar'
            `,
            [oldAvatarImageId, input.appUserId]
          );
        }

        await client.query("COMMIT");

        const row = updated.rows[0];
        if (!row) {
          throw new Error("Не удалось обновить аватар.");
        }

        return row;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async clearAvatar(appUserId: string): Promise<AppUserRow> {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const current = await client.query<{ avatar_url: string | null }>(
          `
            select avatar_url
            from public.app_users
            where id = $1::uuid
            for update
          `,
          [appUserId]
        );
        const oldAvatarImageId = parseInternalAccountImageId(
          current.rows[0]?.avatar_url ?? null
        );

        const updated = await client.query<AppUserRow>(
          `
            update public.app_users
            set avatar_url = null
            where id = $1::uuid
            returning ${APP_USER_COLUMNS}
          `,
          [appUserId]
        );

        if (oldAvatarImageId) {
          await client.query(
            `
              delete from public.account_images
              where id = $1::uuid
                and app_user_id = $2::uuid
                and kind = 'avatar'
            `,
            [oldAvatarImageId, appUserId]
          );
        }

        await client.query("COMMIT");

        const row = updated.rows[0];
        if (!row) {
          throw new Error("Не удалось удалить аватар.");
        }

        return row;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async listMotivationImages(appUserId: string): Promise<AccountImageMeta[]> {
      const { rows } = await pool.query<AccountImageRow>(
        `
          select id, app_user_id, kind, mime_type, size_bytes, image_data, created_at
          from public.account_images
          where app_user_id = $1::uuid
            and kind = 'motivation'
          order by created_at desc, id desc
        `,
        [appUserId]
      );

      return rows.map(toMeta);
    },

    async createMotivationImage(input: {
      appUserId: string;
      mimeType: string;
      bytes: Buffer;
    }): Promise<AccountImageMeta> {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const count = await client.query<{ count: string }>(
          `
            select count(*)::text as count
            from public.account_images
            where app_user_id = $1::uuid
              and kind = 'motivation'
          `,
          [input.appUserId]
        );
        const existingCount = Number(count.rows[0]?.count ?? 0);
        if (existingCount >= ACCOUNT_MOTIVATION_IMAGE_LIMIT) {
          throw new Error(
            `В мотивационной панели можно хранить максимум ${ACCOUNT_MOTIVATION_IMAGE_LIMIT} фото.`
          );
        }

        const { rows } = await client.query<AccountImageRow>(
          `
            insert into public.account_images (
              app_user_id,
              kind,
              mime_type,
              size_bytes,
              image_data
            )
            values ($1::uuid, 'motivation', $2::text, $3::integer, $4::bytea)
            returning id, app_user_id, kind, mime_type, size_bytes, image_data, created_at
          `,
          [input.appUserId, input.mimeType, input.bytes.length, input.bytes]
        );

        await client.query("COMMIT");

        const row = rows[0];
        if (!row) {
          throw new Error("Не удалось загрузить фото.");
        }

        return toMeta(row);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async deleteMotivationImage(appUserId: string, imageId: string): Promise<void> {
      await pool.query(
        `
          delete from public.account_images
          where id = $1::uuid
            and app_user_id = $2::uuid
            and kind = 'motivation'
        `,
        [imageId, appUserId]
      );
    },

    async getImage(imageId: string): Promise<AccountImageBlob | null> {
      const { rows } = await pool.query<AccountImageRow>(
        `
          select id, app_user_id, kind, mime_type, size_bytes, image_data, created_at
          from public.account_images
          where id = $1::uuid
          limit 1
        `,
        [imageId]
      );

      const row = rows[0];
      return row ? toBlob(row) : null;
    },
  };
}
