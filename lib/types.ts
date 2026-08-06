export type CategoryRow = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  content: string;
  description: string;
  tag: string;
  format: CategoryFormat;
  category_type: CategoryType;
  position: number;
  created_at: string;
  updated_at: string;
  visibility?: CategoryVisibility;
  access_role?: CategoryAccessRole;
  public_root_id?: string | null;
  public_owner_user_id?: string | null;
};

export type CategorySummaryRow = Omit<CategoryRow, "content">;

export type CategoryFormat = "block" | "continuous";

export type CategoryType = "learning";

export type CategoryVisibility = "local" | "public";

export type CategoryAccessRole = "owner" | "editor" | "viewer";

export type MessageType = "info" | "exercise";

export type MessageRow = {
  id: string;
  workspace_id: string;
  category_id: string;
  title: string;
  content: string;
  position: number;
  message_type: MessageType;
  created_at: string;
  updated_at: string;
};

export type CategoryDetailPayload = {
  category: CategoryRow;
  messages: MessageRow[];
};

export type WorkspaceRow = {
  id: string;
  owner_user_id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ProjectRow = {
  id: string;
  workspace_id: string;
  title: string;
  tag_filter: string;
  container_category_ids: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceShellData = {
  authUser: {
    id: string;
    email: string | null;
    emailVerifiedAt: string | null;
  };
  account: {
    appUserId: string;
    email: string | null;
    emailVerifiedAt: string | null;
    userId: string | null;
    userIdChangedAt: string | null;
    nickname: string;
    profileDescription: string;
    avatarUrl: string | null;
  };
  categories: CategorySummaryRow[];
  projects: ProjectRow[];
  initialCategoryId: string | null;
  source: "postgres";
};

export type AppUserRow = {
  id: string;
  email: string;
  email_verified_at: string | null;
  user_id: string | null;
  user_id_changed_at: string | null;
  nickname: string;
  profile_description: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type FriendStatus = "pending" | "accepted";

export type FriendRow = {
  friendshipId: string;
  friendAppUserId: string;
  friendUserId: string | null;
  nickname: string;
  profileDescription: string;
  avatarUrl: string | null;
  status: FriendStatus;
  direction: "incoming" | "outgoing" | "accepted";
  inboxPendingCount: number;
  createdAt: string;
  updatedAt: string;
};

export type InboxItemType = "category_share" | "public_invite";

export type InboxItemStatus = "pending" | "accepted" | "declined";

export type InboxItemRow = {
  id: string;
  type: InboxItemType;
  status: InboxItemStatus;
  senderAppUserId: string;
  senderUserId: string | null;
  senderNickname: string;
  recipientAppUserId: string;
  title: string;
  message: string;
  categorySnapshot: unknown | null;
  publicRootRecordId: string | null;
  publicRootCategoryId: string | null;
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
};

export type PublicCategoryMemberRole = "viewer" | "editor";

export type PublicCategoryMemberRow = {
  id: string;
  appUserId: string;
  userId: string | null;
  nickname: string;
  avatarUrl: string | null;
  role: PublicCategoryMemberRole;
  createdAt: string;
  updatedAt: string;
};

export type PublicCategoryPanel = {
  enabled: boolean;
  publicRootRecordId: string | null;
  rootCategoryId: string | null;
  ownerAppUserId: string | null;
  ownerUserId: string | null;
  isOwner: boolean;
  role: CategoryAccessRole | null;
  members: PublicCategoryMemberRow[];
};

export type SearchHit = {
  id: string;
  title: string;
  parentId: string | null;
  path: string[];
  preview: string;
};
