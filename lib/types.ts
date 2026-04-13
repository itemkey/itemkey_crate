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
};

export type CategoryFormat = "block" | "continuous";

export type CategoryType = "learning";

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

export type SearchHit = {
  id: string;
  title: string;
  parentId: string | null;
  path: string[];
  preview: string;
};
