import "server-only";

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import { assertValidUserId } from "@/lib/account-user-id";
import { collectDescendantIds } from "@/lib/categories";
import { buildCategoryTreeDocument, parseCategoryTreeDocument } from "@/lib/category-transfer";
import { getCategoryStore } from "@/lib/category-store";
import { getPostgresPool } from "@/lib/db/postgres";
import { toErrorMessage } from "@/lib/errors";
import type {
  CategoryRow,
  FriendRow,
  InboxItemRow,
  MessageRow,
  PublicCategoryMemberRole,
  PublicCategoryPanel,
} from "@/lib/types";

type SqlExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
};

type AppUserLookup = {
  id: string;
  user_id: string | null;
  nickname: string;
  profile_description: string;
  avatar_url: string | null;
};

type FriendshipRecord = {
  id: string;
  requester_user_id: string;
  addressee_user_id: string;
  status: "pending" | "accepted";
  created_at: string;
  updated_at: string;
  friend_app_user_id: string;
  friend_user_id: string | null;
  friend_nickname: string;
  friend_profile_description: string;
  friend_avatar_url: string | null;
  inbox_pending_count: number | string;
};

type PublicRootRecord = {
  id: string;
  owner_user_id: string;
  owner_user_id_slug: string | null;
  workspace_id: string;
  root_category_id: string;
};

type PublicMemberRecord = {
  id: string;
  app_user_id: string;
  user_id: string | null;
  nickname: string;
  avatar_url: string | null;
  role: PublicCategoryMemberRole;
  created_at: string;
  updated_at: string;
};

type InboxRecord = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  type: "category_share" | "public_invite";
  status: "pending" | "accepted" | "declined";
  title: string;
  message: string;
  category_snapshot: unknown | null;
  public_root_id: string | null;
  public_root_category_id: string | null;
  sender_user_id_slug: string | null;
  sender_nickname: string;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CollaborationStore = {
  source: "postgres";
  listFriends(appUserId: string): Promise<FriendRow[]>;
  requestFriend(appUserId: string, targetUserId: string): Promise<FriendRow>;
  acceptFriend(appUserId: string, requesterUserId: string): Promise<FriendRow>;
  acceptFriendByAppUserId(
    appUserId: string,
    requesterAppUserId: string
  ): Promise<FriendRow>;
  declineFriend(appUserId: string, requesterAppUserId: string): Promise<FriendRow>;
  listInboxForFriend(appUserId: string, friendAppUserId: string): Promise<InboxItemRow[]>;
  createCategoryShare(input: {
    senderAppUserId: string;
    friendAppUserId: string;
    categoryId: string;
  }): Promise<InboxItemRow>;
  acceptInboxItem(input: {
    appUserId: string;
    inboxItemId: string;
    targetParentId?: string | null;
  }): Promise<{
    item: InboxItemRow;
    categories: CategoryRow[];
    messages: MessageRow[];
  }>;
  declineInboxItem(appUserId: string, inboxItemId: string): Promise<InboxItemRow>;
  getPublicPanel(appUserId: string, categoryId: string): Promise<PublicCategoryPanel>;
  enablePublicCategory(appUserId: string, categoryId: string): Promise<PublicCategoryPanel>;
  disablePublicCategory(appUserId: string, categoryId: string): Promise<PublicCategoryPanel>;
  inviteToPublicCategory(input: {
    ownerAppUserId: string;
    categoryId: string;
    friendAppUserId: string;
  }): Promise<InboxItemRow>;
  updatePublicMemberRole(input: {
    ownerAppUserId: string;
    categoryId: string;
    memberId: string;
    role: PublicCategoryMemberRole;
  }): Promise<PublicCategoryPanel>;
  removePublicMember(input: {
    ownerAppUserId: string;
    categoryId: string;
    memberId: string;
  }): Promise<PublicCategoryPanel>;
};

let cachedStore: CollaborationStore | null = null;

async function withPostgresTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensurePublicMembersMountParentColumn(
  executor: SqlExecutor
): Promise<void> {
  await executor.query(`
    alter table public.public_category_members
      add column if not exists mount_parent_category_id uuid null references public.categories(id) on delete set null
  `);

  await executor.query(`
    create index if not exists public_category_members_mount_parent_idx
      on public.public_category_members(mount_parent_category_id)
  `);
}

function toPendingCount(value: number | string): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function normalizeFriend(row: FriendshipRecord, appUserId: string): FriendRow {
  const direction =
    row.status === "accepted"
      ? "accepted"
      : row.addressee_user_id === appUserId
        ? "incoming"
        : "outgoing";

  return {
    friendshipId: row.id,
    friendAppUserId: row.friend_app_user_id,
    friendUserId: row.friend_user_id,
    nickname: row.friend_nickname ?? "",
    profileDescription: row.friend_profile_description ?? "",
    avatarUrl: row.friend_avatar_url ?? null,
    status: row.status,
    direction,
    inboxPendingCount: toPendingCount(row.inbox_pending_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeInboxItem(row: InboxRecord): InboxItemRow {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    senderAppUserId: row.sender_user_id,
    senderUserId: row.sender_user_id_slug,
    senderNickname: row.sender_nickname ?? "",
    recipientAppUserId: row.recipient_user_id,
    title: row.title,
    message: row.message ?? "",
    categorySnapshot: row.category_snapshot ?? null,
    publicRootRecordId: row.public_root_id,
    publicRootCategoryId: row.public_root_category_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    respondedAt: row.responded_at,
  };
}

function normalizePublicPanel(input: {
  publicRoot: PublicRootRecord | null;
  appUserId: string;
  role: "owner" | "editor" | "viewer" | null;
  members: PublicMemberRecord[];
}): PublicCategoryPanel {
  return {
    enabled: Boolean(input.publicRoot),
    publicRootRecordId: input.publicRoot?.id ?? null,
    rootCategoryId: input.publicRoot?.root_category_id ?? null,
    ownerAppUserId: input.publicRoot?.owner_user_id ?? null,
    ownerUserId: input.publicRoot?.owner_user_id_slug ?? null,
    isOwner: input.publicRoot?.owner_user_id === input.appUserId,
    role: input.role,
    members: input.members.map((member) => ({
      id: member.id,
      appUserId: member.app_user_id,
      userId: member.user_id,
      nickname: member.nickname ?? "",
      avatarUrl: member.avatar_url ?? null,
      role: member.role,
      createdAt: member.created_at,
      updatedAt: member.updated_at,
    })),
  };
}

async function getAppUserByUserId(
  executor: SqlExecutor,
  userId: string
): Promise<AppUserLookup | null> {
  const normalized = assertValidUserId(userId);
  const { rows } = await executor.query<AppUserLookup>(
    `
      select id, user_id, nickname, profile_description, avatar_url
      from public.app_users
      where user_id = $1::text
      limit 1
    `,
    [normalized]
  );

  return rows[0] ?? null;
}

async function getFriendshipForUsers(
  executor: SqlExecutor,
  appUserId: string,
  otherAppUserId: string
): Promise<FriendRow | null> {
  const rows = await listFriendRows(executor, appUserId, otherAppUserId);
  return rows[0] ?? null;
}

async function listFriendRows(
  executor: SqlExecutor,
  appUserId: string,
  onlyFriendAppUserId?: string
): Promise<FriendRow[]> {
  const { rows } = await executor.query<FriendshipRecord>(
    `
      select
        f.id,
        f.requester_user_id,
        f.addressee_user_id,
        f.status,
        f.created_at,
        f.updated_at,
        friend.id as friend_app_user_id,
        friend.user_id as friend_user_id,
        friend.nickname as friend_nickname,
        friend.profile_description as friend_profile_description,
        friend.avatar_url as friend_avatar_url,
        (
          select count(*)
          from public.inbox_items inbox
          where inbox.recipient_user_id = $1::uuid
            and inbox.sender_user_id = friend.id
            and inbox.status = 'pending'
        ) as inbox_pending_count
      from public.friendships f
      join public.app_users friend
        on friend.id = case
          when f.requester_user_id = $1::uuid then f.addressee_user_id
          else f.requester_user_id
        end
      where (f.requester_user_id = $1::uuid or f.addressee_user_id = $1::uuid)
        and ($2::uuid is null or friend.id = $2::uuid)
      order by f.status asc, f.updated_at desc, f.created_at desc
    `,
    [appUserId, onlyFriendAppUserId ?? null]
  );

  return rows.map((row) => normalizeFriend(row, appUserId));
}

async function assertAcceptedFriend(
  executor: SqlExecutor,
  appUserId: string,
  friendAppUserId: string
): Promise<void> {
  const friend = await getFriendshipForUsers(executor, appUserId, friendAppUserId);
  if (!friend || friend.status !== "accepted") {
    throw new Error("Сначала добавьте пользователя в друзья.");
  }
}

async function fetchInboxItem(
  executor: SqlExecutor,
  appUserId: string,
  inboxItemId: string
): Promise<InboxItemRow | null> {
  const { rows } = await executor.query<InboxRecord>(
    `
      select
        inbox.id,
        inbox.sender_user_id,
        inbox.recipient_user_id,
        inbox.type,
        inbox.status,
        inbox.title,
        inbox.message,
        inbox.category_snapshot,
        inbox.public_root_id,
        pcr.root_category_id as public_root_category_id,
        sender.user_id as sender_user_id_slug,
        sender.nickname as sender_nickname,
        inbox.responded_at,
        inbox.created_at,
        inbox.updated_at
      from public.inbox_items inbox
      join public.app_users sender
        on sender.id = inbox.sender_user_id
      left join public.public_category_roots pcr
        on pcr.id = inbox.public_root_id
      where inbox.recipient_user_id = $1::uuid
        and inbox.id = $2::uuid
      limit 1
    `,
    [appUserId, inboxItemId]
  );

  const row = rows[0];
  return row ? normalizeInboxItem(row) : null;
}

async function fetchInboxItemsForFriend(
  executor: SqlExecutor,
  appUserId: string,
  friendAppUserId: string
): Promise<InboxItemRow[]> {
  const { rows } = await executor.query<InboxRecord>(
    `
      select
        inbox.id,
        inbox.sender_user_id,
        inbox.recipient_user_id,
        inbox.type,
        inbox.status,
        inbox.title,
        inbox.message,
        inbox.category_snapshot,
        inbox.public_root_id,
        pcr.root_category_id as public_root_category_id,
        sender.user_id as sender_user_id_slug,
        sender.nickname as sender_nickname,
        inbox.responded_at,
        inbox.created_at,
        inbox.updated_at
      from public.inbox_items inbox
      join public.app_users sender
        on sender.id = inbox.sender_user_id
      left join public.public_category_roots pcr
        on pcr.id = inbox.public_root_id
      where inbox.recipient_user_id = $1::uuid
        and inbox.sender_user_id = $2::uuid
        and inbox.status = 'pending'
      order by inbox.created_at desc
    `,
    [appUserId, friendAppUserId]
  );

  return rows.map(normalizeInboxItem);
}

async function insertInboxItem(
  executor: SqlExecutor,
  input: {
    senderAppUserId: string;
    recipientAppUserId: string;
    type: "category_share" | "public_invite";
    title: string;
    categorySnapshot?: unknown;
    publicRootRecordId?: string;
  }
): Promise<InboxItemRow> {
  const { rows } = await executor.query<InboxRecord>(
    `
      insert into public.inbox_items (
        sender_user_id,
        recipient_user_id,
        type,
        title,
        category_snapshot,
        public_root_id
      )
      values (
        $1::uuid,
        $2::uuid,
        $3::text,
        $4::text,
        $5::jsonb,
        $6::uuid
      )
      on conflict (public_root_id, recipient_user_id)
      where type = 'public_invite' and status = 'pending'
      do update set
        sender_user_id = excluded.sender_user_id,
        title = excluded.title,
        updated_at = now()
      returning
        id,
        sender_user_id,
        recipient_user_id,
        type,
        status,
        title,
        message,
        category_snapshot,
        public_root_id,
        (
          select root_category_id
          from public.public_category_roots
          where id = public.inbox_items.public_root_id
        ) as public_root_category_id,
        (
          select user_id
          from public.app_users
          where id = public.inbox_items.sender_user_id
        ) as sender_user_id_slug,
        (
          select nickname
          from public.app_users
          where id = public.inbox_items.sender_user_id
        ) as sender_nickname,
        responded_at,
        created_at,
        updated_at
    `,
    [
      input.senderAppUserId,
      input.recipientAppUserId,
      input.type,
      input.title,
      input.type === "category_share" ? JSON.stringify(input.categorySnapshot) : null,
      input.type === "public_invite" ? input.publicRootRecordId : null,
    ]
  );

  const row = rows[0];
  if (!row) {
    throw new Error("Не удалось создать inbox-сообщение.");
  }

  return normalizeInboxItem(row);
}

async function getCategoryTreeDocumentForShare(
  appUserId: string,
  categoryId: string
) {
  const categoryStore = await getCategoryStore(appUserId);
  const categories = await categoryStore.list();
  const root = categories.find((category) => category.id === categoryId);
  if (!root) {
    throw new Error("Категория не найдена.");
  }

  if (root.access_role === "viewer") {
    throw new Error("Категорию в режиме просмотра нельзя отправить.");
  }

  const descendants = collectDescendantIds(
    categories.map((category) => ({ id: category.id, parent_id: category.parent_id })),
    categoryId
  );
  const subtreeIds = new Set([categoryId, ...descendants]);
  const subtreeCategories = categories.filter((category) => subtreeIds.has(category.id));
  const messageChunks = await Promise.all(
    subtreeCategories.map((category) => categoryStore.listMessages(category.id))
  );

  return buildCategoryTreeDocument(categoryId, subtreeCategories, messageChunks.flat());
}

async function fetchPublicRootByCategory(
  executor: SqlExecutor,
  ownerAppUserId: string,
  categoryId: string
): Promise<PublicRootRecord | null> {
  const { rows } = await executor.query<PublicRootRecord>(
    `
      select
        pcr.id,
        pcr.owner_user_id,
        owner.user_id as owner_user_id_slug,
        pcr.workspace_id,
        pcr.root_category_id
      from public.public_category_roots pcr
      join public.app_users owner
        on owner.id = pcr.owner_user_id
      where pcr.owner_user_id = $1::uuid
        and pcr.root_category_id = $2::uuid
      limit 1
    `,
    [ownerAppUserId, categoryId]
  );

  return rows[0] ?? null;
}

async function fetchPublicRootVisibleForCategory(
  executor: SqlExecutor,
  appUserId: string,
  categoryId: string
): Promise<{
  publicRoot: PublicRootRecord | null;
  role: "owner" | "editor" | "viewer" | null;
}> {
  const { rows } = await executor.query<
    PublicRootRecord & { member_role: "viewer" | "editor" | null }
  >(
    `
      select
        pcr.id,
        pcr.owner_user_id,
        owner.user_id as owner_user_id_slug,
        pcr.workspace_id,
        pcr.root_category_id,
        pcm.role as member_role
      from public.public_category_roots pcr
      join public.app_users owner
        on owner.id = pcr.owner_user_id
      left join public.public_category_members pcm
        on pcm.public_root_id = pcr.id
        and pcm.app_user_id = $1::uuid
      where pcr.owner_user_id = $1::uuid
        or pcm.app_user_id = $1::uuid
      order by pcr.created_at asc
    `,
    [appUserId]
  );

  if (rows.length === 0) {
    return { publicRoot: null, role: null };
  }

  const categoryStore = await getCategoryStore(appUserId);
  const categories = await categoryStore.list();

  for (const row of rows) {
    const subtreeIds = collectDescendantIds(
      categories.map((category) => ({
        id: category.id,
        parent_id: category.parent_id,
      })),
      row.root_category_id
    );
    if (row.root_category_id !== categoryId && !subtreeIds.includes(categoryId)) {
      continue;
    }

    return {
      publicRoot: row,
      role: row.owner_user_id === appUserId ? "owner" : row.member_role,
    };
  }

  return { publicRoot: null, role: null };
}

async function fetchPublicMembers(
  executor: SqlExecutor,
  publicRootRecordId: string
): Promise<PublicMemberRecord[]> {
  const { rows } = await executor.query<PublicMemberRecord>(
    `
      select
        pcm.id,
        pcm.app_user_id,
        member.user_id,
        member.nickname,
        member.avatar_url,
        pcm.role,
        pcm.created_at,
        pcm.updated_at
      from public.public_category_members pcm
      join public.app_users member
        on member.id = pcm.app_user_id
      where pcm.public_root_id = $1::uuid
      order by member.nickname asc, member.user_id asc
    `,
    [publicRootRecordId]
  );

  return rows;
}

async function getPublicPanelForCategory(
  executor: SqlExecutor,
  appUserId: string,
  categoryId: string
): Promise<PublicCategoryPanel> {
  const { publicRoot, role } = await fetchPublicRootVisibleForCategory(
    executor,
    appUserId,
    categoryId
  );
  const members = publicRoot ? await fetchPublicMembers(executor, publicRoot.id) : [];

  return normalizePublicPanel({
    publicRoot,
    appUserId,
    role,
    members,
  });
}

async function assertOwnsCategory(
  executor: SqlExecutor,
  ownerAppUserId: string,
  categoryId: string
): Promise<{
  workspaceId: string;
  title: string;
}> {
  const { rows } = await executor.query<{ workspace_id: string; title: string }>(
    `
      select c.workspace_id, c.title
      from public.categories c
      join public.workspaces w
        on w.id = c.workspace_id
      where c.id = $1::uuid
        and w.owner_user_id = $2::uuid
      limit 1
    `,
    [categoryId, ownerAppUserId]
  );

  const row = rows[0];
  if (!row) {
    throw new Error("Public-категорией может управлять только владелец.");
  }

  return {
    workspaceId: row.workspace_id,
    title: row.title,
  };
}

async function acceptFriendByRequesterAppUserId(
  executor: SqlExecutor,
  appUserId: string,
  requesterAppUserId: string
): Promise<FriendRow> {
  const { rowCount } = await executor.query(
    `
      update public.friendships
      set status = 'accepted'
      where requester_user_id = $1::uuid
        and addressee_user_id = $2::uuid
        and status = 'pending'
    `,
    [requesterAppUserId, appUserId]
  );

  if (!rowCount) {
    throw new Error("Входящее приглашение от этого пользователя не найдено.");
  }

  const friend = await getFriendshipForUsers(executor, appUserId, requesterAppUserId);
  if (!friend) {
    throw new Error("Не удалось принять приглашение.");
  }

  return friend;
}

function createPostgresCollaborationStore(): CollaborationStore {
  const pool = getPostgresPool();

  return {
    source: "postgres",
    async listFriends(appUserId) {
      return listFriendRows(pool, appUserId);
    },
    async requestFriend(appUserId, targetUserId) {
      const target = await getAppUserByUserId(pool, targetUserId);
      if (!target) {
        throw new Error("Пользователь с таким user-id не найден.");
      }

      if (target.id === appUserId) {
        throw new Error("Нельзя добавить в друзья самого себя.");
      }

      await withPostgresTransaction(pool, async (client) => {
        const { rows } = await client.query<{
          id: string;
          requester_user_id: string;
          addressee_user_id: string;
          status: string;
        }>(
          `
            select id, requester_user_id, addressee_user_id, status
            from public.friendships
            where (
              requester_user_id = $1::uuid
              and addressee_user_id = $2::uuid
            ) or (
              requester_user_id = $2::uuid
              and addressee_user_id = $1::uuid
            )
            limit 1
            for update
          `,
          [appUserId, target.id]
        );

        const existing = rows[0];
        if (!existing) {
          await client.query(
            `
              insert into public.friendships (
                requester_user_id,
                addressee_user_id,
                status
              )
              values ($1::uuid, $2::uuid, 'pending')
            `,
            [appUserId, target.id]
          );
          return;
        }

        if (
          existing.status === "pending" &&
          existing.addressee_user_id === appUserId
        ) {
          await client.query(
            `
              update public.friendships
              set status = 'accepted'
              where id = $1::uuid
            `,
            [existing.id]
          );
        }
      });

      const friend = await getFriendshipForUsers(pool, appUserId, target.id);
      if (!friend) {
        throw new Error("Не удалось создать приглашение в друзья.");
      }

      return friend;
    },
    async acceptFriend(appUserId, requesterUserId) {
      const requester = await getAppUserByUserId(pool, requesterUserId);
      if (!requester) {
        throw new Error("Пользователь с таким user-id не найден.");
      }

      return acceptFriendByRequesterAppUserId(pool, appUserId, requester.id);
    },
    async acceptFriendByAppUserId(appUserId, requesterAppUserId) {
      return acceptFriendByRequesterAppUserId(pool, appUserId, requesterAppUserId);
    },
    async declineFriend(appUserId, requesterAppUserId) {
      const friend = await getFriendshipForUsers(pool, appUserId, requesterAppUserId);
      if (
        !friend ||
        friend.status !== "pending" ||
        friend.direction !== "incoming"
      ) {
        throw new Error("Входящее приглашение не найдено.");
      }

      const { rowCount } = await pool.query(
        `
          delete from public.friendships
          where requester_user_id = $1::uuid
            and addressee_user_id = $2::uuid
            and status = 'pending'
        `,
        [requesterAppUserId, appUserId]
      );

      if (!rowCount) {
        throw new Error("Не удалось отклонить приглашение.");
      }

      return friend;
    },
    async listInboxForFriend(appUserId, friendAppUserId) {
      await assertAcceptedFriend(pool, appUserId, friendAppUserId);
      return fetchInboxItemsForFriend(pool, appUserId, friendAppUserId);
    },
    async createCategoryShare(input) {
      await assertAcceptedFriend(pool, input.senderAppUserId, input.friendAppUserId);
      const document = await getCategoryTreeDocumentForShare(
        input.senderAppUserId,
        input.categoryId
      );
      const rootTitle =
        document.categories.find((category) => category.id === document.rootCategoryId)
          ?.title ?? "Категория";

      return insertInboxItem(pool, {
        senderAppUserId: input.senderAppUserId,
        recipientAppUserId: input.friendAppUserId,
        type: "category_share",
        title: rootTitle,
        categorySnapshot: document,
      });
    },
    async acceptInboxItem(input) {
      const item = await fetchInboxItem(pool, input.appUserId, input.inboxItemId);
      if (!item || item.status !== "pending") {
        throw new Error("Inbox-сообщение не найдено.");
      }

      if (item.type === "category_share") {
        if (!item.categorySnapshot) {
          throw new Error("В inbox-сообщении нет данных категории.");
        }

        const document = parseCategoryTreeDocument(item.categorySnapshot);
        const categoryStore = await getCategoryStore(input.appUserId);
        const restored = await categoryStore.importTreeAsChild(
          document,
          input.targetParentId ?? null
        );

        await pool.query(
          `
            update public.inbox_items
            set status = 'accepted', responded_at = now()
            where id = $1::uuid
              and recipient_user_id = $2::uuid
          `,
          [item.id, input.appUserId]
        );

        return {
          item: {
            ...item,
            status: "accepted",
            respondedAt: new Date().toISOString(),
          },
          ...restored,
        };
      }

      if (!item.publicRootRecordId) {
        throw new Error("В public-приглашении нет ссылки на категорию.");
      }

      const targetParentId = input.targetParentId?.trim() ?? "";
      if (!targetParentId) {
        throw new Error("Выбери локальную категорию, куда добавить public-категорию.");
      }

      const categoryStore = await getCategoryStore(input.appUserId);
      const accessibleCategories = await categoryStore.list();
      const targetParent = accessibleCategories.find(
        (category) => category.id === targetParentId
      );
      if (!targetParent || targetParent.visibility === "public") {
        throw new Error("Public-категорию можно добавить только в локальную категорию.");
      }

      await withPostgresTransaction(pool, async (client) => {
        await ensurePublicMembersMountParentColumn(client);

        await client.query(
          `
            insert into public.public_category_members (
              public_root_id,
              app_user_id,
              role,
              mount_parent_category_id
            )
            values ($1::uuid, $2::uuid, 'viewer', $3::uuid)
            on conflict (public_root_id, app_user_id)
            do update set
              role = public.public_category_members.role,
              mount_parent_category_id = excluded.mount_parent_category_id
          `,
          [item.publicRootRecordId, input.appUserId, targetParentId]
        );

        await client.query(
          `
            update public.inbox_items
            set status = 'accepted', responded_at = now()
            where id = $1::uuid
              and recipient_user_id = $2::uuid
          `,
          [item.id, input.appUserId]
        );
      });

      const mountedCategories = item.publicRootCategoryId
        ? (await categoryStore.list()).filter(
            (category) => category.id === item.publicRootCategoryId
          )
        : [];

      return {
        item: {
          ...item,
          status: "accepted",
          respondedAt: new Date().toISOString(),
        },
        categories: mountedCategories,
        messages: [],
      };
    },
    async declineInboxItem(appUserId, inboxItemId) {
      const item = await fetchInboxItem(pool, appUserId, inboxItemId);
      if (!item || item.status !== "pending") {
        throw new Error("Inbox-сообщение не найдено.");
      }

      await pool.query(
        `
          update public.inbox_items
          set status = 'declined', responded_at = now()
          where id = $1::uuid
            and recipient_user_id = $2::uuid
        `,
        [inboxItemId, appUserId]
      );

      return {
        ...item,
        status: "declined",
        respondedAt: new Date().toISOString(),
      };
    },
    async getPublicPanel(appUserId, categoryId) {
      return getPublicPanelForCategory(pool, appUserId, categoryId);
    },
    async enablePublicCategory(appUserId, categoryId) {
      const owned = await assertOwnsCategory(pool, appUserId, categoryId);

      await pool.query(
        `
          insert into public.public_category_roots (
            owner_user_id,
            workspace_id,
            root_category_id
          )
          values ($1::uuid, $2::uuid, $3::uuid)
          on conflict (workspace_id, root_category_id)
          do nothing
        `,
        [appUserId, owned.workspaceId, categoryId]
      );

      return getPublicPanelForCategory(pool, appUserId, categoryId);
    },
    async disablePublicCategory(appUserId, categoryId) {
      await assertOwnsCategory(pool, appUserId, categoryId);

      await pool.query(
        `
          delete from public.public_category_roots
          where owner_user_id = $1::uuid
            and root_category_id = $2::uuid
        `,
        [appUserId, categoryId]
      );

      return getPublicPanelForCategory(pool, appUserId, categoryId);
    },
    async inviteToPublicCategory(input) {
      await assertAcceptedFriend(pool, input.ownerAppUserId, input.friendAppUserId);
      const owned = await assertOwnsCategory(pool, input.ownerAppUserId, input.categoryId);
      let publicRoot = await fetchPublicRootByCategory(
        pool,
        input.ownerAppUserId,
        input.categoryId
      );

      if (!publicRoot) {
        await pool.query(
          `
            insert into public.public_category_roots (
              owner_user_id,
              workspace_id,
              root_category_id
            )
            values ($1::uuid, $2::uuid, $3::uuid)
          `,
          [input.ownerAppUserId, owned.workspaceId, input.categoryId]
        );

        publicRoot = await fetchPublicRootByCategory(
          pool,
          input.ownerAppUserId,
          input.categoryId
        );
      }

      if (!publicRoot) {
        throw new Error("Не удалось включить public-категорию.");
      }

      return insertInboxItem(pool, {
        senderAppUserId: input.ownerAppUserId,
        recipientAppUserId: input.friendAppUserId,
        type: "public_invite",
        title: owned.title,
        publicRootRecordId: publicRoot.id,
      });
    },
    async updatePublicMemberRole(input) {
      const publicRoot = await fetchPublicRootByCategory(
        pool,
        input.ownerAppUserId,
        input.categoryId
      );
      if (!publicRoot) {
        throw new Error("Public-категория не найдена.");
      }

      await pool.query(
        `
          update public.public_category_members
          set role = $3::text
          where public_root_id = $1::uuid
            and id = $2::uuid
        `,
        [publicRoot.id, input.memberId, input.role]
      );

      return getPublicPanelForCategory(pool, input.ownerAppUserId, input.categoryId);
    },
    async removePublicMember(input) {
      const publicRoot = await fetchPublicRootByCategory(
        pool,
        input.ownerAppUserId,
        input.categoryId
      );
      if (!publicRoot) {
        throw new Error("Public-категория не найдена.");
      }

      await pool.query(
        `
          delete from public.public_category_members
          where public_root_id = $1::uuid
            and id = $2::uuid
        `,
        [publicRoot.id, input.memberId]
      );

      return getPublicPanelForCategory(pool, input.ownerAppUserId, input.categoryId);
    },
  };
}

export async function getCollaborationStore(): Promise<CollaborationStore> {
  if (cachedStore) {
    return cachedStore;
  }

  try {
    cachedStore = createPostgresCollaborationStore();
    return cachedStore;
  } catch (error) {
    throw new Error(toErrorMessage(error, "postgres collaboration store initialization failed."));
  }
}
