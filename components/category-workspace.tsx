"use client";

import {
  type ChangeEvent,
  type FocusEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildCategoryPath,
  collectDescendantIds,
  getChildren,
  getInitialCategoryId,
} from "@/lib/categories";
import {
  CATEGORY_TREE_SCHEMA_VERSION,
  type CategoryTreeDocument,
} from "@/lib/category-transfer";
import { normalizeUserId, validateUserId } from "@/lib/account-user-id";
import { toErrorMessage } from "@/lib/errors";
import type {
  CategoryFormat,
  CategoryRow,
  CategoryType,
  MessageRow,
  MessageType,
  ProjectRow,
} from "@/lib/types";

type DataSource = "postgres";

type NoticeTone = "info" | "warn" | "error";

type Notice = {
  text: string;
  tone: NoticeTone;
};

type CategoriesPayload = {
  data?: CategoryRow[];
  source?: DataSource;
  error?: string;
};

type CategoryPayload = {
  data?: CategoryRow;
  source?: DataSource;
  error?: string;
};

type ProjectsPayload = {
  data?: ProjectRow[];
  source?: DataSource;
  error?: string;
};

type ProjectPayload = {
  data?: ProjectRow;
  source?: DataSource;
  error?: string;
};

type MessagesPayload = {
  data?: MessageRow[];
  source?: DataSource;
  error?: string;
};

type MessagePayload = {
  data?: MessageRow;
  source?: DataSource;
  error?: string;
};

type CategoryTreePayload = {
  data?: CategoryTreeDocument;
  source?: DataSource;
  error?: string;
};

type AccountPayload = {
  data?: {
    appUserId: string;
    email: string | null;
    emailVerifiedAt?: string | null;
    userId: string | null;
    userIdChangedAt: string | null;
    nickname: string;
    profileDescription: string;
    avatarUrl: string | null;
    canChangeUserIdNow: boolean;
    nextUserIdChangeAt: string | null;
    activeMigrationCode?: {
      codeHint: string;
      expiresAt: string;
    } | null;
  };
  source?: DataSource;
  error?: string;
};

type AccountUserIdPayload = {
  data?: {
    appUserId: string;
    userId: string | null;
    userIdChangedAt: string | null;
    canChangeUserIdNow: boolean;
    nextUserIdChangeAt: string | null;
  };
  source?: DataSource;
  error?: string;
  nextUserIdChangeAt?: string;
};

type MigrationCodePayload = {
  data?: {
    userId: string;
    code: string;
    codeHint: string;
    expiresAt: string;
  };
  source?: DataSource;
  error?: string;
};

type UserIdAvailabilityPayload = {
  data?: {
    userId: string;
    available: boolean;
  };
  source?: DataSource;
  error?: string;
};

type AuthSessionPayload = {
  data?: {
    id: string;
    email: string | null;
    emailVerifiedAt?: string | null;
  } | null;
  error?: string;
};

type AuthMutationPayload = {
  data?: {
    id: string;
    email: string | null;
    emailVerifiedAt?: string | null;
  };
  requiresEmailVerification?: boolean;
  email?: string | null;
  code?: string;
  message?: string;
  error?: string;
};

type AccountPasswordPayload = {
  data?: {
    id: string;
    email: string | null;
    emailVerifiedAt?: string | null;
  };
  source?: DataSource;
  error?: string;
};

type CsrfPayload = {
  data?: {
    token: string;
  };
  error?: string;
};

type SearchResult = {
  id: string;
  kind: "category" | "message";
  categoryId: string;
  messageId?: string;
  title: string;
  path: string;
  preview: string;
};

type CategoryFormState = {
  title: string;
  description: string;
  tag: string;
  format: CategoryFormat;
  categoryType: CategoryType;
};

type ConfirmDialogTone = "neutral" | "danger";

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmDialogTone;
};

type MenuPanel = "root" | "account" | "settings";
type AuthTab = "login" | "register";

const DEFAULT_CATEGORY_FORM: CategoryFormState = {
  title: "",
  description: "",
  tag: "",
  format: "continuous",
  categoryType: "learning",
};

export default function CategoryWorkspace() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [messagesByCategory, setMessagesByCategory] = useState<
    Record<string, MessageRow[]>
  >({});
  const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null);
  const [insertionTargetId, setInsertionTargetId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [dragMessageId, setDragMessageId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] =
    useState<CategoryFormState>(DEFAULT_CATEGORY_FORM);
  const [messageTitleDraft, setMessageTitleDraft] = useState("");
  const [source, setSource] = useState<DataSource | "unknown">("unknown");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isSavingMessages, setIsSavingMessages] = useState(false);
  const [continuousDraft, setContinuousDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPanel, setMenuPanel] = useState<MenuPanel>("root");
  const [showCategoryTagSuggestions, setShowCategoryTagSuggestions] =
    useState(false);
  const [showCategoryTagLibrary, setShowCategoryTagLibrary] = useState(false);
  const [showProjectCreateModal, setShowProjectCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [projectTagSearchQuery, setProjectTagSearchQuery] = useState("");
  const [projectTagSelection, setProjectTagSelection] = useState<string[]>([]);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [projectTitleDraftsById, setProjectTitleDraftsById] = useState<
    Record<string, string>
  >({});
  const [projectSettingsTagDraft, setProjectSettingsTagDraft] = useState("");
  const [categoryMoveParentDraft, setCategoryMoveParentDraft] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null
  );
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authTab, setAuthTab] = useState<AuthTab>("login");
  const [authLoginUserIdDraft, setAuthLoginUserIdDraft] = useState("");
  const [authLoginPassword, setAuthLoginPassword] = useState("");
  const [showAuthLoginPassword, setShowAuthLoginPassword] = useState(false);
  const [authRegisterEmail, setAuthRegisterEmail] = useState("");
  const [authRegisterUserIdDraft, setAuthRegisterUserIdDraft] = useState("");
  const [authRegisterPassword, setAuthRegisterPassword] = useState("");
  const [authRegisterPasswordRepeat, setAuthRegisterPasswordRepeat] = useState("");
  const [showAuthRegisterPassword, setShowAuthRegisterPassword] = useState(false);
  const [authUser, setAuthUser] = useState<{
    id: string;
    email: string | null;
  } | null>(null);
  const [accountUserId, setAccountUserId] = useState<string | null>(null);
  const [accountNextUserIdChangeAt, setAccountNextUserIdChangeAt] = useState<
    string | null
  >(null);
  const [accountCanChangeUserIdNow, setAccountCanChangeUserIdNow] =
    useState(true);
  const [accountUserIdDraft, setAccountUserIdDraft] = useState("");
  const [accountNicknameDraft, setAccountNicknameDraft] = useState("");
  const [accountProfileDescriptionDraft, setAccountProfileDescriptionDraft] =
    useState("");
  const [accountAvatarUrlDraft, setAccountAvatarUrlDraft] = useState("");
  const [accountAvatarUrl, setAccountAvatarUrl] = useState<string | null>(null);
  const [isSavingAccountProfile, setIsSavingAccountProfile] = useState(false);
  const [activeMigrationCodeMeta, setActiveMigrationCodeMeta] = useState<{
    codeHint: string;
    expiresAt: string;
  } | null>(null);
  const [issuedMigrationCode, setIssuedMigrationCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [isSavingAccountUserId, setIsSavingAccountUserId] = useState(false);
  const [isIssuingMigrationCode, setIsIssuingMigrationCode] = useState(false);
  const [accountCurrentPasswordDraft, setAccountCurrentPasswordDraft] =
    useState("");
  const [accountNewPasswordDraft, setAccountNewPasswordDraft] = useState("");
  const [isSavingAccountPassword, setIsSavingAccountPassword] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);

  const importFileRef = useRef<HTMLInputElement | null>(null);
  const categoryTagInputRef = useRef<HTMLInputElement | null>(null);
  const csrfTokenRef = useRef<string | null>(null);
  const confirmResolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categorySaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );
  const categorySaveInFlightRef = useRef<Record<string, boolean>>({});
  const pendingCategorySaveRef = useRef<
    Record<
      string,
      {
        content: string;
        version: number;
      }
    >
  >({});
  const categoryRequestCountRef = useRef(0);
  const categoryDraftVersionRef = useRef<Record<string, number>>({});
  const categoryAckVersionRef = useRef<Record<string, number>>({});

  const messageSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );
  const messageSaveInFlightRef = useRef<Record<string, boolean>>({});
  const pendingMessageSaveRef = useRef<
    Record<
      string,
      {
        categoryId: string;
        content: string;
        version: number;
      }
    >
  >({});
  const messageRequestCountRef = useRef(0);
  const savedCategoryContentRef = useRef<Record<string, string>>({});
  const savedMessageContentRef = useRef<Record<string, string>>({});
  const messageDraftVersionRef = useRef<Record<string, number>>({});
  const messageAckVersionRef = useRef<Record<string, number>>({});
  const pendingMessageSelectionRef = useRef<string | null>(null);
  const syncedContinuousCategoryIdRef = useRef<string | null>(null);

  const sortedProjects = useMemo(() => [...projects].sort(sortProjects), [projects]);

  const activeProject = useMemo(
    () => sortedProjects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, sortedProjects]
  );
  const isProjectMode = Boolean(activeProject);

  const activeProjectTags = useMemo(
    () => parseCategoryTags(activeProject?.tag_filter ?? ""),
    [activeProject?.tag_filter]
  );

  const projectVisibility = useMemo(
    () => collectProjectVisibility(categories, activeProject),
    [activeProject, categories]
  );
  const visibleCategoryIdSet = projectVisibility.visibleCategoryIdSet;
  const projectRootIds = projectVisibility.rootIds;
  const projectRootIdSet = useMemo(() => new Set(projectRootIds), [projectRootIds]);

  const visibleCategories = useMemo(
    () => categories.filter((category) => visibleCategoryIdSet.has(category.id)),
    [categories, visibleCategoryIdSet]
  );

  const visibleCategoriesById = useMemo(
    () => new Map(visibleCategories.map((category) => [category.id, category])),
    [visibleCategories]
  );

  const currentCategory = useMemo(
    () => visibleCategoriesById.get(currentCategoryId ?? "") ?? null,
    [visibleCategoriesById, currentCategoryId]
  );

  const insertionTarget = useMemo(
    () => visibleCategoriesById.get(insertionTargetId ?? "") ?? null,
    [visibleCategoriesById, insertionTargetId]
  );

  const projectRootCategories = useMemo(
    () =>
      projectRootIds
        .map((rootId) => visibleCategoriesById.get(rootId))
        .filter((category): category is CategoryRow => Boolean(category)),
    [projectRootIds, visibleCategoriesById]
  );

  const childCategories = useMemo(() => {
    if (!currentCategoryId) {
      if (isProjectMode) {
        return projectRootCategories;
      }

      return getChildren(visibleCategories, null);
    }

    return getChildren(visibleCategories, currentCategoryId);
  }, [currentCategoryId, isProjectMode, projectRootCategories, visibleCategories]);

  const currentMessages = useMemo(() => {
    if (!currentCategoryId) {
      return [];
    }

    return [...(messagesByCategory[currentCategoryId] ?? [])].sort(sortMessages);
  }, [messagesByCategory, currentCategoryId]);

  const selectedMessage = useMemo(
    () => currentMessages.find((message) => message.id === selectedMessageId) ?? null,
    [currentMessages, selectedMessageId]
  );

  const sidebarFillerCount = Math.max(0, 8 - childCategories.length);
  const canGoBack = Boolean(
    currentCategory &&
      ((currentCategory.parent_id &&
        visibleCategoriesById.has(currentCategory.parent_id)) ||
        (isProjectMode && projectRootIdSet.has(currentCategory.id)))
  );
  const canCreate = Boolean(insertionTargetId) || isProjectMode;
  const canDelete = Boolean(insertionTargetId) && !isMainRootCategory(insertionTarget);
  const isAuthenticated = Boolean(authUser);
  const currentCategoryTags = useMemo(
    () => parseCategoryTags(currentCategory?.tag ?? ""),
    [currentCategory?.tag]
  );
  const currentCategoryTagKeySet = useMemo(
    () => new Set(currentCategoryTags.map((tag) => tag.toLocaleLowerCase())),
    [currentCategoryTags]
  );

  const allExistingCategoryTags = useMemo(() => {
    const stats = new Map<
      string,
      {
        tag: string;
        usageCount: number;
        updatedAt: string;
      }
    >();

    for (const category of categories) {
      const uniqueTagsInCategory = new Set<string>();
      for (const tag of parseCategoryTags(category.tag)) {
        const key = tag.toLocaleLowerCase();
        if (uniqueTagsInCategory.has(key)) {
          continue;
        }

        uniqueTagsInCategory.add(key);
        const existing = stats.get(key);
        if (!existing) {
          stats.set(key, {
            tag,
            usageCount: 1,
            updatedAt: category.updated_at,
          });
          continue;
        }

        existing.usageCount += 1;
        if (category.updated_at > existing.updatedAt) {
          existing.updatedAt = category.updated_at;
        }
      }
    }

    return Array.from(stats.values()).sort((a, b) => {
      if (b.usageCount !== a.usageCount) {
        return b.usageCount - a.usageCount;
      }

      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt.localeCompare(a.updatedAt);
      }

      return a.tag.localeCompare(b.tag, "ru-RU");
    });
  }, [categories]);

  const projectTagSuggestions = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    const attachedKeys = new Set(
      activeProjectTags.map((tag) => tag.toLocaleLowerCase())
    );
    const normalizedInput = normalizeCategoryTagInput(projectSettingsTagDraft);
    const query = normalizedInput.startsWith("#")
      ? normalizedInput.slice(1).toLocaleLowerCase()
      : normalizedInput.toLocaleLowerCase();

    return allExistingCategoryTags
      .filter((entry) => {
        const key = entry.tag.toLocaleLowerCase();
        if (attachedKeys.has(key)) {
          return false;
        }

        if (!query) {
          return true;
        }

        return entry.tag.toLocaleLowerCase().includes(query);
      })
      .slice(0, 12)
      .map((entry) => entry.tag);
  }, [activeProject, activeProjectTags, allExistingCategoryTags, projectSettingsTagDraft]);

  const projectCreateTagOptions = useMemo(() => {
    const normalized = projectTagSearchQuery.trim().toLocaleLowerCase();
    return allExistingCategoryTags
      .filter((entry) => {
        if (!normalized) {
          return true;
        }

        return entry.tag.toLocaleLowerCase().includes(normalized);
      })
      .slice(0, 80)
      .map((entry) => entry.tag);
  }, [allExistingCategoryTags, projectTagSearchQuery]);

  const projectTagSelectionKeySet = useMemo(
    () => new Set(projectTagSelection.map((tag) => tag.toLocaleLowerCase())),
    [projectTagSelection]
  );

  const moveParentOptions = useMemo(() => {
    if (!currentCategory) {
      return [] as Array<{
        id: string | null;
        label: string;
      }>;
    }

    const links = categories.map((node) => ({
      id: node.id,
      parent_id: node.parent_id,
    }));
    const disallowed = new Set([
      currentCategory.id,
      ...collectDescendantIds(links, currentCategory.id),
    ]);

    const candidateNodes = isProjectMode ? visibleCategories : categories;

    const options = candidateNodes
      .filter((node) => !disallowed.has(node.id))
      .map((node) => ({
        id: node.id,
        label: buildCategoryPath(categories, node.id)
          .map((part) => part.title)
          .join(" / "),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru-RU"));

    return [{ id: null, label: "(корень)" }, ...options];
  }, [categories, currentCategory, isProjectMode, visibleCategories]);

  const categoryTagSuggestions = useMemo(() => {
    if (!currentCategory) {
      return [];
    }

    const normalizedInput = normalizeCategoryTagInput(categoryForm.tag);
    const query = normalizedInput.startsWith("#")
      ? normalizedInput.slice(1).toLocaleLowerCase()
      : normalizedInput.toLocaleLowerCase();

    return allExistingCategoryTags
      .filter((entry) => {
        const key = entry.tag.toLocaleLowerCase();
        if (currentCategoryTagKeySet.has(key)) {
          return false;
        }

        if (!query) {
          return true;
        }

        return entry.tag.toLocaleLowerCase().includes(query);
      })
      .slice(0, 12)
      .map((entry) => entry.tag);
  }, [
    allExistingCategoryTags,
    categoryForm.tag,
    currentCategory,
    currentCategoryTagKeySet,
  ]);

  const accountEmailLabel = authUser?.email ?? authUser?.id ?? "-";
  const accountDisplayName = useMemo(() => {
    const nickname = accountNicknameDraft.trim();
    if (nickname) {
      return nickname;
    }

    if (accountUserId) {
      return accountUserId;
    }

    if (authUser?.email) {
      return authUser.email.split("@")[0] ?? "Пользователь";
    }

    return "Пользователь";
  }, [accountNicknameDraft, accountUserId, authUser?.email]);

  const accountAvatarInitial = useMemo(() => {
    const first = accountDisplayName.trim().charAt(0);
    return first ? first.toUpperCase() : "U";
  }, [accountDisplayName]);

  const accountAvatarPreviewUrl = useMemo(() => {
    const draft = accountAvatarUrlDraft.trim();
    if (draft && isValidHttpUrl(draft)) {
      return draft;
    }

    if (accountAvatarUrl && isValidHttpUrl(accountAvatarUrl)) {
      return accountAvatarUrl;
    }

    return null;
  }, [accountAvatarUrl, accountAvatarUrlDraft]);

  const allLoadedMessages = useMemo(
    () => Object.values(messagesByCategory).flat(),
    [messagesByCategory]
  );

  const searchResults = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const categoryHits: SearchResult[] = visibleCategories
      .filter((category) => {
        const text = `${category.title} ${category.description} ${category.tag} ${category.content}`.toLowerCase();
        return text.includes(normalized);
      })
      .map((category) => ({
        id: `category-${category.id}`,
        kind: "category",
        categoryId: category.id,
        title: category.title,
        path: buildCategoryPath(visibleCategories, category.id)
          .map((part) => part.title)
          .join(" / "),
        preview: makePreview(
          `${category.description || category.content || category.tag}`,
          normalized
        ),
      }));

    const messageHits: SearchResult[] = [];
    for (const message of allLoadedMessages) {
      const messageText = `${message.title} ${message.content}`.toLowerCase();
      if (!messageText.includes(normalized)) {
        continue;
      }

      if (!visibleCategoriesById.has(message.category_id)) {
        continue;
      }

      const titleFromMessage = message.title || "Новый блок";

      messageHits.push({
        id: `message-${message.id}`,
        kind: "message",
        categoryId: message.category_id,
        messageId: message.id,
        title: titleFromMessage,
        path: `${buildCategoryPath(visibleCategories, message.category_id)
          .map((part) => part.title)
          .join(" / ")} / сообщение`,
        preview: makePreview(message.content, normalized),
      });
    }

    return [...categoryHits, ...messageHits].slice(0, 45);
  }, [allLoadedMessages, searchQuery, visibleCategories, visibleCategoriesById]);

  const statusText = useMemo(() => {
    if (notice?.text) {
      return notice.text;
    }

    if (isSavingCategory || isSavingMessages) {
      return "Сохраняю...";
    }

    if (source === "unknown") {
      return "Синхронизация...";
    }

    return "Готово";
  }, [isSavingCategory, isSavingMessages, notice?.text, source]);

  const statusColor =
    notice?.tone === "error"
      ? "text-[#6a1313]"
      : notice?.tone === "warn"
        ? "text-[#5e520b]"
        : "text-[#1e1e1e]";

  const pushNotice = useCallback((text: string, tone: NoticeTone = "info") => {
    setNotice({ text, tone });

    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }

    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
    }, 2800);
  }, []);

  const settleConfirmDialog = useCallback((accepted: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    resolver?.(accepted);
  }, []);

  const requestConfirmation = useCallback(
    (config: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      tone?: ConfirmDialogTone;
    }) => {
      return new Promise<boolean>((resolve) => {
        if (confirmResolverRef.current) {
          confirmResolverRef.current(false);
        }

        confirmResolverRef.current = resolve;
        setConfirmDialog({
          title: config.title,
          message: config.message,
          confirmLabel: config.confirmLabel ?? "подтвердить",
          cancelLabel: config.cancelLabel ?? "отмена",
          tone: config.tone ?? "neutral",
        });
      });
    },
    []
  );

  const resetWorkspaceState = useCallback(() => {
    for (const timer of Object.values(categorySaveTimersRef.current)) {
      clearTimeout(timer);
    }
    for (const timer of Object.values(messageSaveTimersRef.current)) {
      clearTimeout(timer);
    }

    categorySaveTimersRef.current = {};
    categorySaveInFlightRef.current = {};
    pendingCategorySaveRef.current = {};
    categoryRequestCountRef.current = 0;

    messageSaveTimersRef.current = {};
    messageSaveInFlightRef.current = {};
    pendingMessageSaveRef.current = {};
    messageRequestCountRef.current = 0;

    savedCategoryContentRef.current = {};
    savedMessageContentRef.current = {};
    categoryDraftVersionRef.current = {};
    categoryAckVersionRef.current = {};
    messageDraftVersionRef.current = {};
    messageAckVersionRef.current = {};
    pendingMessageSelectionRef.current = null;
    syncedContinuousCategoryIdRef.current = null;

    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
      confirmResolverRef.current = null;
    }

    setCategories([]);
    setProjects([]);
    setMessagesByCategory({});
    setCurrentCategoryId(null);
    setInsertionTargetId(null);
    setActiveProjectId(null);
    setSelectedMessageId(null);
    setShowSearch(false);
    setShowMenu(false);
    setShowCategoryTagLibrary(false);
    setShowCategoryTagSuggestions(false);
    setShowProjectCreateModal(false);
    setProjectTagSearchQuery("");
    setProjectTagSelection([]);
    setProjectTitleDraft("");
    setProjectTitleDraftsById({});
    setProjectSettingsTagDraft("");
    setCategoryMoveParentDraft("");
    setCategoryForm(DEFAULT_CATEGORY_FORM);
    setConfirmDialog(null);
    setMessageTitleDraft("");
    setContinuousDraft("");
    setSource("unknown");
    setLoadError(null);
    setIsLoading(false);
    setIsSavingCategory(false);
    setIsSavingMessages(false);
    setAuthTab("login");
    setAuthLoginUserIdDraft("");
    setAuthLoginPassword("");
    setShowAuthLoginPassword(false);
    setAuthRegisterEmail("");
    setAuthRegisterUserIdDraft("");
    setAuthRegisterPassword("");
    setAuthRegisterPasswordRepeat("");
    setShowAuthRegisterPassword(false);
    setAuthInfo(null);
    setAccountUserId(null);
    setAccountNextUserIdChangeAt(null);
    setAccountCanChangeUserIdNow(true);
    setAccountUserIdDraft("");
    setAccountNicknameDraft("");
    setAccountProfileDescriptionDraft("");
    setAccountAvatarUrlDraft("");
    setAccountAvatarUrl(null);
    setActiveMigrationCodeMeta(null);
    setIssuedMigrationCode(null);
    setIsSavingAccountProfile(false);
    setIsSavingAccountUserId(false);
    setIsIssuingMigrationCode(false);
    setAccountCurrentPasswordDraft("");
    setAccountNewPasswordDraft("");
    setIsSavingAccountPassword(false);
    setIsCreatingProject(false);
    setIsSavingProject(false);
    setMenuPanel("root");
  }, []);

  const handleUnauthorizedState = useCallback(() => {
    setAuthUser(null);
    resetWorkspaceState();
    setAuthError("Сессия истекла. Войди снова.");
  }, [resetWorkspaceState]);

  const ensureCsrfToken = useCallback(async () => {
    if (csrfTokenRef.current) {
      return csrfTokenRef.current;
    }

    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = (await response.json()) as CsrfPayload;
    if (!response.ok || !payload.data?.token) {
      throw new Error(payload.error ?? "Не удалось инициализировать CSRF-токен.");
    }

    csrfTokenRef.current = payload.data.token;
    return payload.data.token;
  }, []);

  const fetchWithCsrf = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? undefined);

      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const token = await ensureCsrfToken();
        headers.set("x-csrf-token", token);
      }

      return fetch(input, {
        ...init,
        headers,
        credentials: "same-origin",
      });
    },
    [ensureCsrfToken]
  );

  const authorizedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchWithCsrf(input, init);

      if (response.status === 401) {
        handleUnauthorizedState();
      }

      if (response.status === 403) {
        const payload = (await response.clone().json().catch(() => ({}))) as {
          error?: string;
        };
        if (typeof payload.error === "string" && payload.error.includes("CSRF")) {
          csrfTokenRef.current = null;
        }
      }

      return response;
    },
    [fetchWithCsrf, handleUnauthorizedState]
  );

  const loadAuthSession = useCallback(async () => {
    setIsAuthReady(false);

    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as AuthSessionPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось проверить сессию.");
      }

      if (!payload.data) {
        setAuthUser(null);
        return;
      }

      setAuthUser({
        id: payload.data.id,
        email: payload.data.email,
      });
      setAuthError(null);
    } catch (error) {
      setAuthUser(null);
      setAuthError(toErrorMessage(error, "Не удалось инициализировать аккаунт."));
    } finally {
      setIsAuthReady(true);
    }
  }, []);

  function syncCategorySavingState() {
    const hasTimers = Object.keys(categorySaveTimersRef.current).length > 0;
    const hasInFlight = Object.values(categorySaveInFlightRef.current).some(Boolean);
    const hasQueued = Object.keys(pendingCategorySaveRef.current).length > 0;
    const hasRequests = categoryRequestCountRef.current > 0;

    setIsSavingCategory(hasTimers || hasInFlight || hasQueued || hasRequests);
  }

  function syncMessageSavingState() {
    const hasTimers = Object.keys(messageSaveTimersRef.current).length > 0;
    const hasInFlight = Object.values(messageSaveInFlightRef.current).some(Boolean);
    const hasQueued = Object.keys(pendingMessageSaveRef.current).length > 0;
    const hasRequests = messageRequestCountRef.current > 0;

    setIsSavingMessages(hasTimers || hasInFlight || hasQueued || hasRequests);
  }

  function clearCategorySaveState(categoryId: string) {
    const timer = categorySaveTimersRef.current[categoryId];
    if (timer) {
      clearTimeout(timer);
      delete categorySaveTimersRef.current[categoryId];
    }

    delete pendingCategorySaveRef.current[categoryId];
    delete categorySaveInFlightRef.current[categoryId];
  }

  function clearMessageSaveState(messageId: string) {
    const timer = messageSaveTimersRef.current[messageId];
    if (timer) {
      clearTimeout(timer);
      delete messageSaveTimersRef.current[messageId];
    }

    delete pendingMessageSaveRef.current[messageId];
    delete messageSaveInFlightRef.current[messageId];
  }

  const loadCategories = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await authorizedFetch("/api/categories", { cache: "no-store" });
      const payload = (await response.json()) as CategoriesPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось загрузить категории.");
      }

      const rows = payload.data.map(normalizeCategoryRow);
      const initialId = getInitialCategoryId(rows) ?? rows[0]?.id ?? null;

      for (const timer of Object.values(categorySaveTimersRef.current)) {
        clearTimeout(timer);
      }
      for (const timer of Object.values(messageSaveTimersRef.current)) {
        clearTimeout(timer);
      }

      categorySaveTimersRef.current = {};
      categorySaveInFlightRef.current = {};
      pendingCategorySaveRef.current = {};
      categoryRequestCountRef.current = 0;

      messageSaveTimersRef.current = {};
      messageSaveInFlightRef.current = {};
      pendingMessageSaveRef.current = {};
      messageRequestCountRef.current = 0;

      savedMessageContentRef.current = {};
      messageDraftVersionRef.current = {};
      messageAckVersionRef.current = {};
      pendingMessageSelectionRef.current = null;
      syncedContinuousCategoryIdRef.current = null;

      setCategories(rows);
      setCurrentCategoryId(initialId);
      setInsertionTargetId(initialId);
      setSelectedMessageId(null);
      setSource(payload.source ?? "unknown");
      setMessagesByCategory({});

      const savedCategoryMap: Record<string, string> = {};
      const categoryDraftMap: Record<string, number> = {};
      const categoryAckMap: Record<string, number> = {};
      for (const row of rows) {
        savedCategoryMap[row.id] = row.content;
        categoryDraftMap[row.id] = 0;
        categoryAckMap[row.id] = 0;
      }
      savedCategoryContentRef.current = savedCategoryMap;
      categoryDraftVersionRef.current = categoryDraftMap;
      categoryAckVersionRef.current = categoryAckMap;

      setIsSavingCategory(false);
      setIsSavingMessages(false);
    } catch (error) {
      setLoadError(toErrorMessage(error, "Не удалось загрузить категории."));
    } finally {
      setIsLoading(false);
    }
  }, [authorizedFetch]);

  const loadProjects = useCallback(async () => {
    try {
      const response = await authorizedFetch("/api/projects", { cache: "no-store" });
      const payload = (await response.json()) as ProjectsPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось загрузить проекты.");
      }

      const rows = payload.data.map(normalizeProjectRow);
      setProjects(rows);
      setSource((prev) => payload.source ?? prev);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось загрузить проекты."), "error");
    }
  }, [authorizedFetch, pushNotice]);

  const loadAccountProfile = useCallback(async () => {
    try {
      const response = await authorizedFetch("/api/account", { cache: "no-store" });
      const payload = (await response.json()) as AccountPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось загрузить профиль аккаунта.");
      }

      setSource((prev) => payload.source ?? prev);
      setAccountUserId(payload.data.userId ?? null);
      setAccountUserIdDraft(payload.data.userId ?? "");
      setAccountNicknameDraft(payload.data.nickname);
      setAccountProfileDescriptionDraft(payload.data.profileDescription);
      setAccountAvatarUrlDraft(payload.data.avatarUrl ?? "");
      setAccountAvatarUrl(payload.data.avatarUrl ?? null);
      setAccountCanChangeUserIdNow(Boolean(payload.data.canChangeUserIdNow));
      setAccountNextUserIdChangeAt(payload.data.nextUserIdChangeAt ?? null);
      setActiveMigrationCodeMeta(payload.data.activeMigrationCode ?? null);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось загрузить профиль аккаунта."), "error");
    }
  }, [authorizedFetch, pushNotice]);

  const loadCategoryMessages = useCallback(
    async (categoryId: string) => {
      try {
        const response = await authorizedFetch(
          `/api/messages?categoryId=${encodeURIComponent(categoryId)}`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as MessagesPayload;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Не удалось загрузить сообщения.");
        }

        const rows = payload.data.map(normalizeMessageRow).sort(sortMessages);
        const hasPendingDraft = (messageId: string) => {
          const draftVersion = messageDraftVersionRef.current[messageId] ?? 0;
          const ackVersion = messageAckVersionRef.current[messageId] ?? 0;

          return (
            draftVersion > ackVersion ||
            Boolean(messageSaveTimersRef.current[messageId]) ||
            Boolean(messageSaveInFlightRef.current[messageId]) ||
            Boolean(pendingMessageSaveRef.current[messageId])
          );
        };

        setMessagesByCategory((prev) => {
          const localById = new Map(
            (prev[categoryId] ?? []).map((message) => [message.id, message])
          );

          return {
            ...prev,
            [categoryId]: rows.map((row) => {
              const local = localById.get(row.id);
              if (!local || !hasPendingDraft(row.id)) {
                return row;
              }

              return {
                ...row,
                content: local.content,
                updated_at: local.updated_at,
              };
            }),
          };
        });

        for (const row of rows) {
          if (!hasPendingDraft(row.id)) {
            savedMessageContentRef.current[row.id] = row.content;
          }

          if (typeof messageDraftVersionRef.current[row.id] !== "number") {
            messageDraftVersionRef.current[row.id] = 0;
          }
          if (typeof messageAckVersionRef.current[row.id] !== "number") {
            messageAckVersionRef.current[row.id] = 0;
          }
        }

        setSource(payload.source ?? "unknown");

        const pendingId = pendingMessageSelectionRef.current;
        if (pendingId) {
          if (rows.some((message) => message.id === pendingId)) {
            setSelectedMessageId(pendingId);
          }
          pendingMessageSelectionRef.current = null;
        }
      } catch (error) {
        pushNotice(toErrorMessage(error, "Не удалось загрузить сообщения."), "error");
      }
    },
    [authorizedFetch, pushNotice]
  );

  useEffect(() => {
    void loadAuthSession();
  }, [loadAuthSession]);

  useEffect(() => {
    void ensureCsrfToken().catch(() => {
      return;
    });
  }, [ensureCsrfToken]);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    if (!isAuthenticated) {
      resetWorkspaceState();
      return;
    }

    void loadCategories();
    void loadProjects();
    void loadAccountProfile();
  }, [
    isAuthReady,
    isAuthenticated,
    loadAccountProfile,
    loadCategories,
    loadProjects,
    resetWorkspaceState,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !currentCategoryId) {
      return;
    }

    void loadCategoryMessages(currentCategoryId);
  }, [currentCategoryId, isAuthenticated, loadCategoryMessages]);

  useEffect(() => {
    if (!selectedMessageId) {
      return;
    }

    if (!currentMessages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(null);
    }
  }, [currentMessages, selectedMessageId]);

  useEffect(() => {
    setMessageTitleDraft(selectedMessage?.title ?? "");
  }, [selectedMessage?.id, selectedMessage?.title]);

  useEffect(() => {
    setShowCategoryTagSuggestions(false);
    setShowCategoryTagLibrary(false);

    if (!currentCategory) {
      setCategoryForm(DEFAULT_CATEGORY_FORM);
      setCategoryMoveParentDraft("");
      return;
    }

    setCategoryForm({
      title: currentCategory.title,
      description: currentCategory.description,
      tag: "",
      format: currentCategory.format,
      categoryType: currentCategory.category_type,
    });

    setCategoryMoveParentDraft(currentCategory.parent_id ?? "");
  }, [currentCategory]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    const exists = sortedProjects.some((project) => project.id === activeProjectId);
    if (!exists) {
      setActiveProjectId(null);
    }
  }, [activeProjectId, sortedProjects]);

  useEffect(() => {
    if (!showProjectCreateModal) {
      return;
    }

    setProjectTitleDraftsById((prev) =>
      mergeProjectTitleDraftMap(prev, sortedProjects)
    );
  }, [showProjectCreateModal, sortedProjects]);

  useEffect(() => {
    if (visibleCategories.length === 0) {
      setCurrentCategoryId(null);
      setInsertionTargetId(null);
      setSelectedMessageId(null);
      return;
    }

    if (!currentCategoryId || !visibleCategoriesById.has(currentCategoryId)) {
      if (isProjectMode) {
        setCurrentCategoryId(null);
        setInsertionTargetId(null);
        setSelectedMessageId(null);
        return;
      }

      const fallbackId =
        getInitialCategoryId(visibleCategories) ?? visibleCategories[0]?.id ?? null;
      if (!fallbackId) {
        return;
      }

      setCurrentCategoryId(fallbackId);
      setInsertionTargetId(fallbackId);
      setSelectedMessageId(null);
      return;
    }

    if (!insertionTargetId || !visibleCategoriesById.has(insertionTargetId)) {
      setInsertionTargetId(currentCategoryId);
    }
  }, [
    currentCategoryId,
    insertionTargetId,
    isProjectMode,
    visibleCategories,
    visibleCategoriesById,
  ]);

  useEffect(() => {
    if (!currentCategory) {
      syncedContinuousCategoryIdRef.current = null;
      setContinuousDraft("");
      return;
    }

    if (syncedContinuousCategoryIdRef.current === currentCategory.id) {
      return;
    }

    syncedContinuousCategoryIdRef.current = currentCategory.id;
    setContinuousDraft(currentCategory.content);
  }, [currentCategory]);

  useEffect(() => {
    if (currentCategory?.format !== "block" && selectedMessageId) {
      setSelectedMessageId(null);
    }
  }, [currentCategory?.format, selectedMessageId]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (confirmResolverRef.current) {
          confirmResolverRef.current(false);
          confirmResolverRef.current = null;
        }

        setConfirmDialog(null);
        setShowSearch(false);
        setShowMenu(false);
        setShowCategoryTagLibrary(false);
        setShowProjectCreateModal(false);
        setMenuPanel("root");
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }

      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }

      for (const timer of Object.values(categorySaveTimersRef.current)) {
        clearTimeout(timer);
      }

      for (const timer of Object.values(messageSaveTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  function openCategory(categoryId: string, messageId?: string) {
    setCurrentCategoryId(categoryId);
    setInsertionTargetId(categoryId);
    if (messageId) {
      pendingMessageSelectionRef.current = messageId;
    } else {
      pendingMessageSelectionRef.current = null;
      setSelectedMessageId(null);
    }
    setShowSearch(false);
    setShowCategoryTagLibrary(false);
    setShowProjectCreateModal(false);
  }

  function closeMenu() {
    setShowMenu(false);
    setMenuPanel("root");
  }

  function toggleMenu() {
    setShowMenu((prev) => {
      const next = !prev;
      if (next) {
        setMenuPanel("root");
      }
      return next;
    });
  }

  function openMenuPanel(panel: Exclude<MenuPanel, "root">) {
    setMenuPanel(panel);
    pushNotice(
      panel === "account"
        ? "Открыт раздел «Аккаунт»."
        : "Открыт раздел «Настройки»."
    );
  }

  function selectCurrentCategoryAsTarget() {
    if (!currentCategoryId) {
      return;
    }

    setSelectedMessageId(null);
    setInsertionTargetId(currentCategoryId);
    pushNotice(`Точка добавления: ${currentCategory?.title ?? "категория"}.`);
  }

  function handleSelectProjectTab(projectId: string | null) {
    setActiveProjectId(projectId);
    setCurrentCategoryId(null);
    setInsertionTargetId(null);
    setSelectedMessageId(null);
    setShowCategoryTagSuggestions(false);
    setShowCategoryTagLibrary(false);
  }

  function openProjectCreateModal() {
    setProjectTagSearchQuery("");
    setProjectTagSelection([]);
    setProjectTitleDraft("");
    setProjectTitleDraftsById((prev) =>
      mergeProjectTitleDraftMap(prev, sortedProjects)
    );
    setShowProjectCreateModal(true);
  }

  function closeProjectCreateModal() {
    setShowProjectCreateModal(false);
  }

  function handleProjectTitleDraftChange(projectId: string, value: string) {
    setProjectTitleDraftsById((prev) => ({
      ...prev,
      [projectId]: value,
    }));
  }

  async function handleProjectRename(project: ProjectRow) {
    const draft = (projectTitleDraftsById[project.id] ?? project.title).trim();
    if (!draft) {
      pushNotice("Название проекта не может быть пустым.", "warn");
      return;
    }

    if (draft === project.title) {
      pushNotice("Название не изменилось.", "warn");
      return;
    }

    const updated = await patchProjectById(project.id, { title: draft });
    if (!updated) {
      return;
    }

    setProjectTitleDraftsById((prev) => ({
      ...prev,
      [project.id]: updated.title,
    }));
    pushNotice(`Проект переименован: ${updated.title}.`);
  }

  async function handleProjectDelete(project: ProjectRow) {
    const confirmed = await requestConfirmation({
      title: "Удалить проект",
      message: `Удалить проект «${project.title}»? Это не удалит категории.`,
      confirmLabel: "удалить",
      cancelLabel: "отмена",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setIsSavingProject(true);
    try {
      const response = await authorizedFetch(`/api/projects/${project.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        source?: DataSource;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось удалить проект.");
      }

      setProjects((prev) => prev.filter((item) => item.id !== project.id));
      setProjectTitleDraftsById((prev) => {
        const next = { ...prev };
        delete next[project.id];
        return next;
      });

      if (activeProjectId === project.id) {
        setActiveProjectId(null);
      }

      setSource((prev) => payload.source ?? prev);
      pushNotice(`Проект ${project.title} удален.`);
      await loadProjects();
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось удалить проект."), "error");
    } finally {
      setIsSavingProject(false);
    }
  }

  async function handleMoveProject(projectId: string, direction: -1 | 1) {
    const currentIndex = sortedProjects.findIndex((project) => project.id === projectId);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= sortedProjects.length) {
      return;
    }

    const current = sortedProjects[currentIndex];
    const target = sortedProjects[targetIndex];

    setIsSavingProject(true);
    try {
      const moved = await patchProjectById(
        current.id,
        { position: targetIndex },
        { manageSavingState: false }
      );
      if (!moved) {
        return;
      }

      const swapped = await patchProjectById(
        target.id,
        { position: currentIndex },
        { manageSavingState: false }
      );
      if (!swapped) {
        await loadProjects();
        return;
      }

      await loadProjects();
      pushNotice("Порядок проектов обновлен.");
    } finally {
      setIsSavingProject(false);
    }
  }

  function toggleProjectTagSelection(tag: string) {
    const normalized = normalizeCategoryTagInput(tag);
    if (!normalized) {
      return;
    }

    const key = normalized.toLocaleLowerCase();
    setProjectTagSelection((prev) => {
      const exists = prev.some((item) => item.toLocaleLowerCase() === key);
      if (exists) {
        return prev.filter((item) => item.toLocaleLowerCase() !== key);
      }

      return [...prev, normalized];
    });
  }

  async function handleCreateProject() {
    const title = projectTitleDraft.trim();
    if (!title) {
      pushNotice("Введи название проекта.", "warn");
      return;
    }

    if (projectTagSelection.length === 0) {
      pushNotice("Выбери хотя бы один хэштег для проекта.", "warn");
      return;
    }

    setIsCreatingProject(true);
    try {
      const response = await authorizedFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          tags: projectTagSelection,
        }),
      });

      const payload = (await response.json()) as ProjectPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось создать проект.");
      }

      const created = normalizeProjectRow(payload.data);
      setProjects((prev) => [...prev, created].sort(sortProjects));
      setActiveProjectId(created.id);
      setShowProjectCreateModal(false);
      setProjectTagSelection([]);
      setProjectTagSearchQuery("");
      setProjectTitleDraft("");
      setProjectTitleDraftsById((prev) => ({
        ...prev,
        [created.id]: created.title,
      }));
      setSource((prev) => payload.source ?? prev);
      pushNotice(`Проект ${created.title} создан.`);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось создать проект."), "error");
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function patchProjectById(
    projectId: string,
    patch: Partial<{
      title: string;
      tags: string[];
      containerCategoryIds: string[];
      position: number;
    }>,
    options?: {
      manageSavingState?: boolean;
    }
  ) {
    const manageSavingState = options?.manageSavingState ?? true;

    if (manageSavingState) {
      setIsSavingProject(true);
    }

    try {
      const response = await authorizedFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      const payload = (await response.json()) as ProjectPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось обновить проект.");
      }

      const updated = normalizeProjectRow(payload.data);
      setProjects((prev) =>
        prev.map((project) => (project.id === updated.id ? updated : project))
      );
      setSource((prev) => payload.source ?? prev);
      return updated;
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось обновить проект."), "error");
      return null;
    } finally {
      if (manageSavingState) {
        setIsSavingProject(false);
      }
    }
  }

  async function handleAddProjectTag(sourceTag?: string) {
    if (!activeProject) {
      return;
    }

    const normalizedTag = normalizeCategoryTagInput(sourceTag ?? projectSettingsTagDraft);
    if (!normalizedTag) {
      pushNotice("Введи хэштег для проекта.", "warn");
      return;
    }

    const currentTags = parseCategoryTags(activeProject.tag_filter);
    const nextKey = normalizedTag.toLocaleLowerCase();
    if (currentTags.some((tag) => tag.toLocaleLowerCase() === nextKey)) {
      pushNotice("Этот хэштег уже есть в проекте.", "warn");
      return;
    }

    const updated = await patchProjectById(activeProject.id, {
      tags: [...currentTags, normalizedTag],
    });
    if (!updated) {
      return;
    }

    setProjectSettingsTagDraft("");
    pushNotice(`Хэштег ${normalizedTag} добавлен в проект.`);
  }

  async function handleRemoveProjectTag(tagToRemove: string) {
    if (!activeProject) {
      return;
    }

    const key = normalizeCategoryTagInput(tagToRemove).toLocaleLowerCase();
    if (!key) {
      return;
    }

    const currentTags = parseCategoryTags(activeProject.tag_filter);
    const nextTags = currentTags.filter((tag) => tag.toLocaleLowerCase() !== key);
    if (nextTags.length === currentTags.length) {
      return;
    }

    const updated = await patchProjectById(activeProject.id, {
      tags: nextTags,
    });
    if (!updated) {
      return;
    }

    pushNotice(`Хэштег ${normalizeCategoryTagInput(tagToRemove)} удален из проекта.`);
  }

  async function handleMoveCategoryToParent() {
    if (!currentCategory) {
      return;
    }

    const nextParentId = categoryMoveParentDraft.trim() || null;
    if (nextParentId === currentCategory.parent_id) {
      pushNotice("Категория уже находится в этом месте.", "warn");
      return;
    }

    const siblingCount = categories.filter(
      (node) => node.parent_id === nextParentId && node.id !== currentCategory.id
    ).length;

    const updated = await patchCurrentCategory({
      parentId: nextParentId,
      position: siblingCount,
    });
    if (!updated) {
      return;
    }

    setCategoryMoveParentDraft(updated.parent_id ?? "");
    pushNotice("Категория перемещена.");
  }

  async function patchCategoryById(
    categoryId: string,
    patch: Partial<{
      title: string;
      content: string;
      description: string;
      tag: string;
      format: CategoryFormat;
      categoryType: CategoryType;
      parentId: string | null;
      position: number;
    }>,
    options?: {
      preserveLocalContent?: boolean;
      sentContent?: string;
      contentVersion?: number;
    }
  ) {
    categoryRequestCountRef.current += 1;
    syncCategorySavingState();

    try {
      const response = await authorizedFetch(`/api/categories/${categoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      const payload = (await response.json()) as CategoryPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось обновить категорию.");
      }

      const updated = normalizeCategoryRow(payload.data);
      const patchHasContent = typeof patch.content === "string";
      const preserveContent = options?.preserveLocalContent || !patchHasContent;

      let shouldApplyUpdate = true;
      if (preserveContent) {
        if (options?.preserveLocalContent) {
          const version = options.contentVersion ?? 0;
          const ackVersion = categoryAckVersionRef.current[updated.id] ?? 0;
          if (version >= ackVersion) {
            categoryAckVersionRef.current[updated.id] = version;
            if (typeof options.sentContent === "string") {
              savedCategoryContentRef.current[updated.id] = options.sentContent;
            }
          } else {
            shouldApplyUpdate = false;
          }
        }
      } else {
        savedCategoryContentRef.current[updated.id] = updated.content;
        categoryDraftVersionRef.current[updated.id] = 0;
        categoryAckVersionRef.current[updated.id] = 0;
      }

      if (shouldApplyUpdate) {
        setCategories((prev) =>
          prev.map((category) => {
            if (category.id !== updated.id) {
              return category;
            }

            if (options?.preserveLocalContent) {
              return {
                ...category,
                updated_at: updated.updated_at,
              };
            }

            if (preserveContent) {
              return {
                ...updated,
                content: category.content,
              };
            }

            return updated;
          })
        );
      }

      setSource((prev) => payload.source ?? prev);
      return updated;
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось обновить категорию."), "error");
      return null;
    } finally {
      categoryRequestCountRef.current = Math.max(0, categoryRequestCountRef.current - 1);
      syncCategorySavingState();
    }
  }

  async function patchCurrentCategory(
    patch: Partial<{
      title: string;
      content: string;
      description: string;
      tag: string;
      format: CategoryFormat;
      categoryType: CategoryType;
      parentId: string | null;
      position: number;
    }>
  ) {
    if (!currentCategoryId) {
      return null;
    }

    return patchCategoryById(currentCategoryId, patch);
  }

  async function handleBack() {
    if (!currentCategory) {
      return;
    }

    const parentId = currentCategory.parent_id;
    if (parentId && visibleCategoriesById.has(parentId)) {
      openCategory(parentId);
      return;
    }

    if (isProjectMode && projectRootIdSet.has(currentCategory.id)) {
      pendingMessageSelectionRef.current = null;
      setCurrentCategoryId(null);
      setInsertionTargetId(null);
      setSelectedMessageId(null);
    }
  }

  async function handleAddCategory() {
    const parentId = insertionTargetId ?? null;

    if (!parentId && !isProjectMode) {
      pushNotice("Нажми на категорию, куда нужно добавить новую.", "warn");
      return;
    }

    setIsMutating(true);
    try {
      const response = await authorizedFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId,
          projectId: activeProjectId,
        }),
      });

      const payload = (await response.json()) as CategoryPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось создать категорию.");
      }

      const created = normalizeCategoryRow(payload.data);
      setCategories((prev) => [...prev, created]);

      if (activeProjectId) {
        setProjects((prev) =>
          prev.map((project) => {
            if (project.id !== activeProjectId) {
              return project;
            }

            const nextContainerIds = serializePlainList([
              ...parsePlainList(project.container_category_ids),
              created.id,
            ]);

            return {
              ...project,
              container_category_ids: nextContainerIds,
            };
          })
        );
      }

      savedCategoryContentRef.current[created.id] = created.content;
      categoryDraftVersionRef.current[created.id] = 0;
      categoryAckVersionRef.current[created.id] = 0;
      clearCategorySaveState(created.id);
      setSource((prev) => payload.source ?? prev);
      pushNotice(`Создана категория: ${created.title}.`);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось создать категорию."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function handleDeleteCategory() {
    if (!insertionTargetId) {
      pushNotice("Выбери категорию для удаления.", "warn");
      return;
    }

    const target = categories.find((node) => node.id === insertionTargetId);
    if (!target) {
      setInsertionTargetId(null);
      return;
    }

    if (isMainRootCategory(target)) {
      pushNotice("Категорию main нельзя удалить.", "warn");
      return;
    }

    setIsMutating(true);
    try {
      const response = await authorizedFetch(`/api/categories/${target.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json()) as {
        error?: string;
        source?: DataSource;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось удалить категорию.");
      }

      const links = categories.map((node) => ({
        id: node.id,
        parent_id: node.parent_id,
      }));

      const deletedIds = new Set([
        target.id,
        ...collectDescendantIds(links, target.id),
      ]);

      for (const categoryId of deletedIds) {
        clearCategorySaveState(categoryId);
        delete savedCategoryContentRef.current[categoryId];
        delete categoryDraftVersionRef.current[categoryId];
        delete categoryAckVersionRef.current[categoryId];
      }
      syncCategorySavingState();

      const nextCategories = categories.filter((node) => !deletedIds.has(node.id));

      const messageIdsToDelete = Object.entries(messagesByCategory)
        .filter(([categoryId]) => deletedIds.has(categoryId))
        .flatMap(([, messages]) => messages.map((message) => message.id));

      for (const messageId of messageIdsToDelete) {
        clearMessageSaveState(messageId);
        delete savedMessageContentRef.current[messageId];
        delete messageDraftVersionRef.current[messageId];
        delete messageAckVersionRef.current[messageId];
      }
      syncMessageSavingState();

      setMessagesByCategory((prev) => {
        const next: Record<string, MessageRow[]> = {};
        for (const [categoryId, messages] of Object.entries(prev)) {
          if (!deletedIds.has(categoryId)) {
            next[categoryId] = messages;
          }
        }
        return next;
      });

      setProjects((prev) =>
        prev.map((project) => {
          const nextContainerIds = parsePlainList(project.container_category_ids).filter(
            (categoryId) => !deletedIds.has(categoryId)
          );
          const serialized = serializePlainList(nextContainerIds);
          if (serialized === project.container_category_ids) {
            return project;
          }

          return {
            ...project,
            container_category_ids: serialized,
          };
        })
      );

      const nextCurrent = deletedIds.has(currentCategoryId ?? "")
        ? target.parent_id ?? getInitialCategoryId(nextCategories)
        : currentCategoryId;

      setCategories(nextCategories);
      setCurrentCategoryId(nextCurrent);
      setSelectedMessageId(null);
      setInsertionTargetId(nextCurrent);
      setSource((prev) => payload.source ?? prev);
      pushNotice(`Удалена категория: ${target.title}.`);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось удалить категорию."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function createMessageRequest(
    categoryId: string,
    title = "Новый блок",
    content = "",
    messageType: MessageType = "info"
  ): Promise<MessageRow> {
    const response = await authorizedFetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId,
        title,
        messageType,
        content,
      }),
    });

    const payload = (await response.json()) as MessagePayload;
    if (!response.ok || !payload.data) {
      throw new Error(payload.error ?? "Не удалось создать сообщение.");
    }

    setSource((prev) => payload.source ?? prev);
    return normalizeMessageRow(payload.data);
  }

  async function deleteMessageRequest(messageId: string): Promise<void> {
    const response = await authorizedFetch(`/api/messages/${messageId}`, {
      method: "DELETE",
    });

    const payload = (await response.json()) as {
      error?: string;
      source?: DataSource;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Не удалось удалить сообщение.");
    }

    setSource((prev) => payload.source ?? prev);
  }

  async function handleAddMessage() {
    if (!currentCategoryId || currentCategory?.format !== "block") {
      return;
    }

    setIsMutating(true);
    try {
      const created = await createMessageRequest(
        currentCategoryId,
        "Новый блок",
        "",
        "info"
      );
      savedMessageContentRef.current[created.id] = created.content;
      messageDraftVersionRef.current[created.id] = 0;
      messageAckVersionRef.current[created.id] = 0;
      clearMessageSaveState(created.id);
      setMessagesByCategory((prev) => ({
        ...prev,
        [currentCategoryId]: [...(prev[currentCategoryId] ?? []), created].sort(
          sortMessages
        ),
      }));
      setSelectedMessageId(created.id);
      pushNotice("Добавлено новое сообщение.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось добавить сообщение."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function patchMessage(
    messageId: string,
    categoryId: string,
    patch: Partial<{
      title: string;
      content: string;
      messageType: MessageType;
      position: number;
    }>,
    options?: {
      preserveLocalContent?: boolean;
      sentContent?: string;
      contentVersion?: number;
    }
  ) {
    messageRequestCountRef.current += 1;
    syncMessageSavingState();

    try {
      const response = await authorizedFetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      const payload = (await response.json()) as MessagePayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось обновить сообщение.");
      }

      const updated = normalizeMessageRow(payload.data);
      const patchHasContent = typeof patch.content === "string";
      const preserveContent = options?.preserveLocalContent || !patchHasContent;

      let shouldApplyUpdate = true;
      if (preserveContent) {
        if (options?.preserveLocalContent) {
          const version = options.contentVersion ?? 0;
          const ackVersion = messageAckVersionRef.current[updated.id] ?? 0;
          if (version >= ackVersion) {
            messageAckVersionRef.current[updated.id] = version;
            if (typeof options.sentContent === "string") {
              savedMessageContentRef.current[updated.id] = options.sentContent;
            }
          } else {
            shouldApplyUpdate = false;
          }
        }
      } else {
        savedMessageContentRef.current[updated.id] = updated.content;
        messageDraftVersionRef.current[updated.id] = 0;
        messageAckVersionRef.current[updated.id] = 0;
      }

      if (shouldApplyUpdate) {
        setMessagesByCategory((prev) => ({
          ...prev,
          [categoryId]: (prev[categoryId] ?? [])
            .map((message) => {
              if (message.id !== updated.id) {
                return message;
              }

              if (options?.preserveLocalContent) {
                return {
                  ...message,
                  updated_at: updated.updated_at,
                };
              }

              if (preserveContent) {
                return {
                  ...updated,
                  content: message.content,
                };
              }

              return updated;
            })
            .sort(sortMessages),
        }));
      }

      setSource((prev) => payload.source ?? prev);
      return updated;
    } finally {
      messageRequestCountRef.current = Math.max(0, messageRequestCountRef.current - 1);
      syncMessageSavingState();
    }
  }

  function enqueueMessageContentSave(
    categoryId: string,
    messageId: string,
    content: string,
    version: number
  ) {
    const ackVersion = messageAckVersionRef.current[messageId] ?? 0;
    if (savedMessageContentRef.current[messageId] === content && version <= ackVersion) {
      delete pendingMessageSaveRef.current[messageId];
      syncMessageSavingState();
      return;
    }

    if (messageSaveInFlightRef.current[messageId]) {
      pendingMessageSaveRef.current[messageId] = {
        categoryId,
        content,
        version,
      };
      syncMessageSavingState();
      return;
    }

    messageSaveInFlightRef.current[messageId] = true;
    syncMessageSavingState();

    void patchMessage(
      messageId,
      categoryId,
      { content },
      {
        preserveLocalContent: true,
        sentContent: content,
        contentVersion: version,
      }
    )
      .catch((error) => {
        pushNotice(toErrorMessage(error, "Не удалось сохранить сообщение."), "error");
      })
      .finally(() => {
        messageSaveInFlightRef.current[messageId] = false;

        const queued = pendingMessageSaveRef.current[messageId];
        if (queued) {
          delete pendingMessageSaveRef.current[messageId];
          enqueueMessageContentSave(
            queued.categoryId,
            messageId,
            queued.content,
            queued.version
          );
          return;
        }

        syncMessageSavingState();
      });
  }

  function scheduleMessageContentSave(
    categoryId: string,
    messageId: string,
    content: string,
    version: number
  ) {
    const ackVersion = messageAckVersionRef.current[messageId] ?? 0;
    if (savedMessageContentRef.current[messageId] === content && version <= ackVersion) {
      return;
    }

    const existingTimer = messageSaveTimersRef.current[messageId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    messageSaveTimersRef.current[messageId] = setTimeout(() => {
      delete messageSaveTimersRef.current[messageId];
      enqueueMessageContentSave(categoryId, messageId, content, version);
      syncMessageSavingState();
    }, 450);

    syncMessageSavingState();
  }

  function handleMessageContentChange(messageId: string, nextValue: string) {
    if (!currentCategoryId) {
      return;
    }

    const nextVersion = (messageDraftVersionRef.current[messageId] ?? 0) + 1;
    messageDraftVersionRef.current[messageId] = nextVersion;

    setMessagesByCategory((prev) => ({
      ...prev,
      [currentCategoryId]: (prev[currentCategoryId] ?? []).map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: nextValue,
              updated_at: new Date().toISOString(),
            }
          : message
      ),
    }));

    scheduleMessageContentSave(currentCategoryId, messageId, nextValue, nextVersion);
  }

  function enqueueContinuousSave(categoryId: string, content: string, version: number) {
    const ackVersion = categoryAckVersionRef.current[categoryId] ?? 0;
    if (savedCategoryContentRef.current[categoryId] === content && version <= ackVersion) {
      delete pendingCategorySaveRef.current[categoryId];
      syncCategorySavingState();
      return;
    }

    if (categorySaveInFlightRef.current[categoryId]) {
      pendingCategorySaveRef.current[categoryId] = {
        content,
        version,
      };
      syncCategorySavingState();
      return;
    }

    categorySaveInFlightRef.current[categoryId] = true;
    syncCategorySavingState();

    void patchCategoryById(
      categoryId,
      { content },
      {
        preserveLocalContent: true,
        sentContent: content,
        contentVersion: version,
      }
    ).finally(() => {
      categorySaveInFlightRef.current[categoryId] = false;

      const queued = pendingCategorySaveRef.current[categoryId];
      if (queued) {
        delete pendingCategorySaveRef.current[categoryId];
        enqueueContinuousSave(categoryId, queued.content, queued.version);
        return;
      }

      syncCategorySavingState();
    });
  }

  function scheduleContinuousSave(categoryId: string, content: string, version: number) {
    const ackVersion = categoryAckVersionRef.current[categoryId] ?? 0;
    if (savedCategoryContentRef.current[categoryId] === content && version <= ackVersion) {
      return;
    }

    const existingTimer = categorySaveTimersRef.current[categoryId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    categorySaveTimersRef.current[categoryId] = setTimeout(() => {
      delete categorySaveTimersRef.current[categoryId];
      enqueueContinuousSave(categoryId, content, version);
      syncCategorySavingState();
    }, 420);

    syncCategorySavingState();
  }

  function handleContinuousContentChange(nextValue: string) {
    if (!currentCategory) {
      return;
    }

    const nextVersion = (categoryDraftVersionRef.current[currentCategory.id] ?? 0) + 1;
    categoryDraftVersionRef.current[currentCategory.id] = nextVersion;

    setContinuousDraft(nextValue);
    setCategories((prev) =>
      prev.map((category) =>
        category.id === currentCategory.id
          ? {
              ...category,
              content: nextValue,
              updated_at: new Date().toISOString(),
            }
          : category
      )
    );

    scheduleContinuousSave(currentCategory.id, nextValue, nextVersion);
  }

  async function handleMessageTypeChange(nextType: MessageType) {
    if (!selectedMessage || !currentCategoryId) {
      return;
    }

    const previousType = selectedMessage.message_type;

    setMessagesByCategory((prev) => ({
      ...prev,
      [currentCategoryId]: (prev[currentCategoryId] ?? []).map((message) =>
        message.id === selectedMessage.id
          ? {
              ...message,
              message_type: nextType,
            }
          : message
      ),
    }));

    try {
      await patchMessage(selectedMessage.id, currentCategoryId, {
        messageType: nextType,
      });
      pushNotice("Режим сообщения обновлен.");
    } catch (error) {
      setMessagesByCategory((prev) => ({
        ...prev,
        [currentCategoryId]: (prev[currentCategoryId] ?? []).map((message) =>
          message.id === selectedMessage.id
            ? {
                ...message,
                message_type: previousType,
              }
            : message
        ),
      }));
      pushNotice(toErrorMessage(error, "Не удалось сменить тип сообщения."), "error");
    }
  }

  async function handleMessageTitleBlur() {
    if (!selectedMessage || !currentCategoryId) {
      return;
    }

    const previousTitle = selectedMessage.title;
    const normalizedTitle = normalizeMessageTitle(messageTitleDraft);

    if (normalizedTitle !== messageTitleDraft) {
      setMessageTitleDraft(normalizedTitle);
    }

    if (normalizedTitle === previousTitle) {
      return;
    }

    setMessagesByCategory((prev) => ({
      ...prev,
      [currentCategoryId]: (prev[currentCategoryId] ?? []).map((message) =>
        message.id === selectedMessage.id
          ? {
              ...message,
              title: normalizedTitle,
            }
          : message
      ),
    }));

    try {
      await patchMessage(selectedMessage.id, currentCategoryId, {
        title: normalizedTitle,
      });
      pushNotice("Название блока обновлено.");
    } catch (error) {
      setMessagesByCategory((prev) => ({
        ...prev,
        [currentCategoryId]: (prev[currentCategoryId] ?? []).map((message) =>
          message.id === selectedMessage.id
            ? {
                ...message,
                title: previousTitle,
              }
            : message
        ),
      }));
      setMessageTitleDraft(previousTitle);
      pushNotice(toErrorMessage(error, "Не удалось переименовать блок."), "error");
    }
  }

  async function handleDeleteMessage() {
    if (!selectedMessage || !currentCategoryId) {
      return;
    }

    setIsMutating(true);
    try {
      await deleteMessageRequest(selectedMessage.id);

      clearMessageSaveState(selectedMessage.id);
      delete savedMessageContentRef.current[selectedMessage.id];
      delete messageDraftVersionRef.current[selectedMessage.id];
      delete messageAckVersionRef.current[selectedMessage.id];
      syncMessageSavingState();

      setMessagesByCategory((prev) => ({
        ...prev,
        [currentCategoryId]: (prev[currentCategoryId] ?? []).filter(
          (message) => message.id !== selectedMessage.id
        ),
      }));
      setSelectedMessageId(null);
      pushNotice("Сообщение удалено.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось удалить сообщение."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function persistMessageOrder(categoryId: string, orderedIds: string[]) {
    try {
      const response = await authorizedFetch("/api/messages/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, orderedIds }),
      });

      const payload = (await response.json()) as MessagesPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось переставить сообщения.");
      }

      const rows = payload.data.map(normalizeMessageRow).sort(sortMessages);
      setMessagesByCategory((prev) => {
        const localById = new Map(
          (prev[categoryId] ?? []).map((message) => [message.id, message])
        );

        return {
          ...prev,
          [categoryId]: rows.map((row) => {
            const local = localById.get(row.id);
            if (!local) {
              return row;
            }

            const hasPendingDraft =
              (messageDraftVersionRef.current[row.id] ?? 0) >
                (messageAckVersionRef.current[row.id] ?? 0) ||
              Boolean(messageSaveTimersRef.current[row.id]) ||
              Boolean(messageSaveInFlightRef.current[row.id]) ||
              Boolean(pendingMessageSaveRef.current[row.id]);

            if (!hasPendingDraft) {
              return row;
            }

            return {
              ...row,
              content: local.content,
              updated_at: local.updated_at,
            };
          }),
        };
      });
      setSource((prev) => payload.source ?? prev);
      pushNotice("Порядок сообщений обновлен.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось переставить сообщения."), "error");
      void loadCategoryMessages(categoryId);
    }
  }

  function handleDropOnMessage(targetMessageId: string) {
    if (!dragMessageId || !currentCategoryId) {
      return;
    }

    if (dragMessageId === targetMessageId) {
      setDragMessageId(null);
      return;
    }

    const reordered = reorderMessages(currentMessages, dragMessageId, targetMessageId);
    setMessagesByCategory((prev) => ({
      ...prev,
      [currentCategoryId]: reordered,
    }));
    setDragMessageId(null);

    void persistMessageOrder(
      currentCategoryId,
      reordered.map((message) => message.id)
    );
  }

  function handleSearchOpenCategory(result: SearchResult) {
    if (result.kind === "message" && result.messageId) {
      openCategory(result.categoryId, result.messageId);
      return;
    }

    openCategory(result.categoryId);
  }

  function handleCategoryTitleBlur() {
    if (!currentCategory) {
      return;
    }

    const title = categoryForm.title.trim();
    if (!title) {
      setCategoryForm((prev) => ({ ...prev, title: currentCategory.title }));
      pushNotice("Название категории не может быть пустым.", "warn");
      return;
    }

    if (title !== currentCategory.title) {
      void patchCurrentCategory({ title }).then((updated) => {
        if (updated) {
          pushNotice("Название категории обновлено.");
        }
      });
    }
  }

  function handleCategoryDescriptionBlur() {
    if (!currentCategory) {
      return;
    }

    if (categoryForm.description !== currentCategory.description) {
      void patchCurrentCategory({ description: categoryForm.description }).then(
        (updated) => {
          if (updated) {
            pushNotice("Описание категории обновлено.");
          }
        }
      );
    }
  }

  function handleCategoryTagEditorBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setShowCategoryTagSuggestions(false);
  }

  function openCategoryTagLibrary() {
    if (isProjectMode) {
      pushNotice("В проектах теги категории нельзя менять. Перейди в ХАБ.", "warn");
      return;
    }

    setShowCategoryTagSuggestions(false);
    setShowCategoryTagLibrary(true);
  }

  function closeCategoryTagLibrary() {
    setShowCategoryTagLibrary(false);
  }

  async function handleAddCategoryTag(
    sourceTag?: string,
    options?: {
      keepInputFocus?: boolean;
      keepSuggestionsOpen?: boolean;
    }
  ) {
    if (isProjectMode) {
      pushNotice("В проектах теги категории нельзя менять. Перейди в ХАБ.", "warn");
      return;
    }

    if (!currentCategory) {
      return;
    }

    const keepInputFocus = options?.keepInputFocus ?? true;
    const keepSuggestionsOpen =
      options?.keepSuggestionsOpen ?? Boolean(sourceTag);

    const normalizedTag = normalizeCategoryTagInput(sourceTag ?? categoryForm.tag);
    if (!normalizedTag) {
      pushNotice("Введи хэштег и нажми +.", "warn");
      return;
    }

    const nextKey = normalizedTag.toLocaleLowerCase();
    const existingTags = parseCategoryTags(currentCategory.tag);
    if (existingTags.some((tag) => tag.toLocaleLowerCase() === nextKey)) {
      if (!sourceTag) {
        setCategoryForm((prev) => ({ ...prev, tag: "" }));
      }
      pushNotice("Этот хэштег уже привязан к категории.", "warn");
      setShowCategoryTagSuggestions(keepSuggestionsOpen);
      if (keepInputFocus) {
        categoryTagInputRef.current?.focus();
      }
      return;
    }

    const updated = await patchCurrentCategory({
      tag: serializeCategoryTags([...existingTags, normalizedTag]),
    });
    if (!updated) {
      return;
    }

    if (keepInputFocus || !sourceTag) {
      setCategoryForm((prev) => ({ ...prev, tag: "" }));
    }
    setShowCategoryTagSuggestions(keepSuggestionsOpen);
    if (keepInputFocus) {
      categoryTagInputRef.current?.focus();
    }
    pushNotice(`Хэштег ${normalizedTag} добавлен к категории.`);
  }

  async function handleRemoveCategoryTag(
    tagToRemove: string,
    options?: {
      keepInputFocus?: boolean;
    }
  ) {
    if (isProjectMode) {
      pushNotice("В проектах теги категории нельзя менять. Перейди в ХАБ.", "warn");
      return;
    }

    if (!currentCategory) {
      return;
    }

    const keepInputFocus = options?.keepInputFocus ?? true;

    const targetKey = normalizeCategoryTagInput(tagToRemove).toLocaleLowerCase();
    if (!targetKey) {
      return;
    }

    const existingTags = parseCategoryTags(currentCategory.tag);
    const nextTags = existingTags.filter(
      (tag) => tag.toLocaleLowerCase() !== targetKey
    );

    if (nextTags.length === existingTags.length) {
      return;
    }

    const serialized = serializeCategoryTags(nextTags);
    if (serialized === currentCategory.tag) {
      return;
    }

    const updated = await patchCurrentCategory({ tag: serialized });
    if (!updated) {
      return;
    }

    pushNotice(`Хэштег ${normalizeCategoryTagInput(tagToRemove)} снят с категории.`);
    if (keepInputFocus) {
      categoryTagInputRef.current?.focus();
    }
  }

  async function handleCategoryFormatChange(nextFormat: CategoryFormat) {
    if (!currentCategory) {
      return;
    }

    const categoryId = currentCategory.id;
    const previousFormat = currentCategory.format;
    if (nextFormat === previousFormat) {
      setCategoryForm((prev) => ({ ...prev, format: nextFormat }));
      return;
    }

    setCategoryForm((prev) => ({ ...prev, format: nextFormat }));
    setIsMutating(true);

    try {
      clearCategorySaveState(categoryId);
      syncCategorySavingState();

      if (previousFormat === "continuous" && nextFormat === "block") {
        const textFromContinuous = continuousDraft;
        const existingMessages = [...currentMessages];

        for (const message of existingMessages) {
          clearMessageSaveState(message.id);
          await deleteMessageRequest(message.id);
          delete savedMessageContentRef.current[message.id];
          delete messageDraftVersionRef.current[message.id];
          delete messageAckVersionRef.current[message.id];
        }
        syncMessageSavingState();

        const created = await createMessageRequest(
          categoryId,
          makeMessageTitleFromContent(textFromContinuous),
          textFromContinuous,
          "info"
        );
        savedMessageContentRef.current[created.id] = created.content;
        messageDraftVersionRef.current[created.id] = 0;
        messageAckVersionRef.current[created.id] = 0;
        clearMessageSaveState(created.id);
        setMessagesByCategory((prev) => ({
          ...prev,
          [categoryId]: [created],
        }));
        setSelectedMessageId(created.id);

        await patchCategoryById(categoryId, {
          format: nextFormat,
          content: textFromContinuous,
        });
      } else if (previousFormat === "block" && nextFormat === "continuous") {
        const orderedMessages = [...currentMessages].sort(sortMessages);
        const mergedText = orderedMessages.map((message) => message.content).join("\n\n");

        for (const message of orderedMessages) {
          clearMessageSaveState(message.id);
          await deleteMessageRequest(message.id);
          delete savedMessageContentRef.current[message.id];
          delete messageDraftVersionRef.current[message.id];
          delete messageAckVersionRef.current[message.id];
        }
        syncMessageSavingState();

        await patchCategoryById(categoryId, {
          format: nextFormat,
          content: mergedText,
        });

        setMessagesByCategory((prev) => ({
          ...prev,
          [categoryId]: [],
        }));
        setContinuousDraft(mergedText);
        setSelectedMessageId(null);
      } else {
        await patchCategoryById(categoryId, { format: nextFormat });
      }

      pushNotice("Формат категории обновлен.");
    } catch (error) {
      setCategoryForm((prev) => ({ ...prev, format: previousFormat }));
      pushNotice(toErrorMessage(error, "Не удалось сменить формат категории."), "error");
      await loadCategoryMessages(categoryId);
    } finally {
      setIsMutating(false);
    }
  }

  function handleCategoryTypeChange(nextType: CategoryType) {
    setCategoryForm((prev) => ({ ...prev, categoryType: nextType }));
    if (currentCategory && nextType !== currentCategory.category_type) {
      void patchCurrentCategory({ categoryType: nextType });
    }
  }

  async function handleAuthSignIn() {
    const normalizedUserId = normalizeUserId(authLoginUserIdDraft);
    const userIdValidationError = validateUserId(normalizedUserId);

    if (!authLoginUserIdDraft.trim() || !authLoginPassword) {
      setAuthError("Введи user-id и пароль.");
      return;
    }

    if (userIdValidationError) {
      setAuthError(userIdValidationError);
      return;
    }

    setIsAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      const response = await fetchWithCsrf("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: normalizedUserId,
          password: authLoginPassword,
        }),
      });
      const payload = (await response.json()) as AuthMutationPayload;

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось войти в аккаунт.");
      }

      setAuthUser({
        id: payload.data.id,
        email: payload.data.email,
      });
      setAuthInfo(null);

      setAuthLoginPassword("");
      setShowAuthLoginPassword(false);
      pushNotice("Вход выполнен.");
    } catch (error) {
      setAuthError(toErrorMessage(error, "Не удалось войти в аккаунт."));
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function handleAuthSignUp() {
    const email = authRegisterEmail.trim();
    const normalizedUserId = normalizeUserId(authRegisterUserIdDraft);
    const userIdValidationError = validateUserId(normalizedUserId);

    if (
      !email ||
      !authRegisterUserIdDraft.trim() ||
      !authRegisterPassword ||
      !authRegisterPasswordRepeat
    ) {
      setAuthError("Введи email, user-id и пароль два раза.");
      return;
    }

    if (authRegisterPassword !== authRegisterPasswordRepeat) {
      setAuthError("Пароли не совпадают.");
      return;
    }

    if (userIdValidationError) {
      setAuthError(userIdValidationError);
      return;
    }

    setIsAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      const availabilityResponse = await fetch(
        `/api/account/user-id/check?value=${encodeURIComponent(normalizedUserId)}`,
        { cache: "no-store" }
      );
      const availabilityPayload =
        (await availabilityResponse.json()) as UserIdAvailabilityPayload;
      if (!availabilityResponse.ok || !availabilityPayload.data) {
        throw new Error(availabilityPayload.error ?? "Не удалось проверить user-id.");
      }

      if (!availabilityPayload.data.available) {
        setAuthError("Такой user-id уже занят.");
        return;
      }

      const response = await fetchWithCsrf("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: authRegisterPassword,
          userId: normalizedUserId,
        }),
      });
      const payload = (await response.json()) as AuthMutationPayload;

      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось создать аккаунт.");
      }

      if (payload.requiresEmailVerification) {
        setAuthRegisterEmail("");
        setAuthRegisterUserIdDraft("");
        setAuthRegisterPassword("");
        setAuthRegisterPasswordRepeat("");
        setShowAuthRegisterPassword(false);
        setAuthLoginUserIdDraft(normalizedUserId);
        setAuthTab("login");
        setAuthInfo(
          "Аккаунт создан. Письмо подтверждения отправлено автоматически — подтверди email и войди."
        );
        pushNotice("Проверь почту и подтверди email.");
        return;
      }

      if (!payload.data) {
        throw new Error("Сервер не вернул данные нового аккаунта.");
      }

      setAuthUser({
        id: payload.data.id,
        email: payload.data.email,
      });

      setAuthRegisterEmail("");
      setAuthRegisterUserIdDraft("");
      setAuthRegisterPassword("");
      setAuthRegisterPasswordRepeat("");
      setShowAuthRegisterPassword(false);
      setAuthInfo(null);
      pushNotice("Аккаунт создан и вход выполнен.");
    } catch (error) {
      setAuthError(toErrorMessage(error, "Не удалось создать аккаунт."));
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function handleAuthSignOut() {
    setIsAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      const response = await authorizedFetch("/api/auth/logout", {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось выйти из аккаунта.");
      }

      setAuthUser(null);
      resetWorkspaceState();
      pushNotice("Вы вышли из аккаунта.");
    } catch (error) {
      setAuthError(toErrorMessage(error, "Не удалось выйти из аккаунта."));
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function handleSaveAccountProfile() {
    const nickname = accountNicknameDraft.trim();
    const profileDescription = accountProfileDescriptionDraft.trim();
    const avatarUrl = accountAvatarUrlDraft.trim();

    if (!nickname) {
      pushNotice("Ник не может быть пустым.", "warn");
      return;
    }

    if (nickname.length > 40) {
      pushNotice("Ник: максимум 40 символов.", "warn");
      return;
    }

    if (profileDescription.length > 320) {
      pushNotice("Описание профиля: максимум 320 символов.", "warn");
      return;
    }

    if (avatarUrl && !isValidHttpUrl(avatarUrl)) {
      pushNotice("Ссылка на аватар должна начинаться с http:// или https://", "warn");
      return;
    }

    setIsSavingAccountProfile(true);
    try {
      const response = await authorizedFetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          profileDescription,
          avatarUrl: avatarUrl || null,
        }),
      });

      const payload = (await response.json()) as AccountPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось обновить профиль аккаунта.");
      }

      setSource((prev) => payload.source ?? prev);
      setAccountUserId(payload.data.userId ?? null);
      setAccountUserIdDraft(payload.data.userId ?? "");
      setAccountNicknameDraft(payload.data.nickname);
      setAccountProfileDescriptionDraft(payload.data.profileDescription);
      setAccountAvatarUrlDraft(payload.data.avatarUrl ?? "");
      setAccountAvatarUrl(payload.data.avatarUrl ?? null);
      setAccountCanChangeUserIdNow(Boolean(payload.data.canChangeUserIdNow));
      setAccountNextUserIdChangeAt(payload.data.nextUserIdChangeAt ?? null);
      setActiveMigrationCodeMeta(payload.data.activeMigrationCode ?? null);
      setIssuedMigrationCode(null);
      pushNotice("Профиль аккаунта обновлен.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось обновить профиль аккаунта."), "error");
    } finally {
      setIsSavingAccountProfile(false);
    }
  }

  async function handleChangeAccountPassword() {
    const currentPassword = accountCurrentPasswordDraft.trim();
    const nextPassword = accountNewPasswordDraft.trim();

    if (!currentPassword || !nextPassword) {
      pushNotice("Введи текущий и новый пароль.", "warn");
      return;
    }

    if (currentPassword === nextPassword) {
      pushNotice("Новый пароль должен отличаться от текущего.", "warn");
      return;
    }

    setIsSavingAccountPassword(true);
    try {
      const response = await authorizedFetch("/api/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword: nextPassword,
        }),
      });

      const payload = (await response.json()) as AccountPasswordPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось обновить пароль.");
      }

      setAccountCurrentPasswordDraft("");
      setAccountNewPasswordDraft("");
      pushNotice("Пароль обновлен. Сессии на других устройствах завершены.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось обновить пароль."), "error");
    } finally {
      setIsSavingAccountPassword(false);
    }
  }

  async function handleSaveAccountUserId() {
    const normalized = normalizeUserId(accountUserIdDraft);
    if (!accountCanChangeUserIdNow && accountNextUserIdChangeAt) {
      pushNotice(
        `Сейчас смена user-id недоступна. Следующая дата: ${formatDateTime(accountNextUserIdChangeAt)}.`,
        "warn"
      );
      return;
    }

    if (normalized === accountUserId) {
      pushNotice("Введи новый user-id, текущий уже сохранен.", "warn");
      return;
    }

    const validationError = validateUserId(normalized);
    if (validationError) {
      pushNotice(validationError, "warn");
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Смена user-id",
      message:
        "Подтверждаешь смену user-id? После сохранения следующий раз поменять его можно через 30 дней.",
      confirmLabel: "сменить",
      cancelLabel: "отмена",
    });
    if (!confirmed) {
      pushNotice("Смена user-id отменена.", "warn");
      return;
    }

    setIsSavingAccountUserId(true);
    try {
      const response = await authorizedFetch("/api/account/user-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: normalized }),
      });

      const payload = (await response.json()) as AccountUserIdPayload;
      if (!response.ok || !payload.data) {
        if (payload.nextUserIdChangeAt) {
          setAccountCanChangeUserIdNow(false);
          setAccountNextUserIdChangeAt(payload.nextUserIdChangeAt);
        }

        throw new Error(payload.error ?? "Не удалось обновить user-id.");
      }

      setAccountUserId(payload.data.userId ?? null);
      setAccountUserIdDraft(payload.data.userId ?? "");
      setAccountCanChangeUserIdNow(Boolean(payload.data.canChangeUserIdNow));
      setAccountNextUserIdChangeAt(payload.data.nextUserIdChangeAt ?? null);
      setSource((prev) => payload.source ?? prev);
      if (payload.data.nextUserIdChangeAt) {
        pushNotice(
          `user-id изменен. Следующая смена доступна: ${formatDateTime(payload.data.nextUserIdChangeAt)}.`
        );
      } else {
        pushNotice("user-id сохранен.");
      }
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось обновить user-id."), "error");
    } finally {
      setIsSavingAccountUserId(false);
    }
  }

  async function handleIssueMigrationCode() {
    if (!accountUserId) {
      pushNotice("Сначала задай user-id.", "warn");
      return;
    }

    setIsIssuingMigrationCode(true);
    try {
      const response = await authorizedFetch("/api/account/migration-code", {
        method: "POST",
      });

      const payload = (await response.json()) as MigrationCodePayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось выпустить migration-код.");
      }

      setSource((prev) => payload.source ?? prev);
      setIssuedMigrationCode({
        code: payload.data.code,
        expiresAt: payload.data.expiresAt,
      });
      setActiveMigrationCodeMeta({
        codeHint: payload.data.codeHint,
        expiresAt: payload.data.expiresAt,
      });
      pushNotice("Новый migration-код создан.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось выпустить migration-код."), "error");
    } finally {
      setIsIssuingMigrationCode(false);
    }
  }

  async function handleExportCategoryTree() {
    if (!currentCategory) {
      pushNotice("Сначала выбери категорию для экспорта.", "warn");
      return;
    }

    setIsMutating(true);
    try {
      const response = await authorizedFetch(
        `/api/categories/${currentCategory.id}/export`,
        {
          cache: "no-store",
        }
      );

      const payload = (await response.json()) as CategoryTreePayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось экспортировать категорию.");
      }

      if (payload.data.schemaVersion !== CATEGORY_TREE_SCHEMA_VERSION) {
        throw new Error("Сервер вернул неподдерживаемую версию файла экспорта.");
      }

      const fileName = makeCategoryExportFileName(currentCategory.title);
      const blob = new Blob([JSON.stringify(payload.data, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      link.click();

      URL.revokeObjectURL(blobUrl);
      pushNotice("Категория экспортирована.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось экспортировать категорию."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  function handleOpenImportPicker() {
    if (!currentCategory) {
      pushNotice("Сначала выбери категорию для импорта.", "warn");
      return;
    }

    importFileRef.current?.click();
    pushNotice("Выбери JSON-файл импорта категории.");
  }

  async function handleImportCategoryTree(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file || !currentCategory) {
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Импорт дерева",
      message:
        "Импорт полностью заменит выбранную категорию, все вложенные категории и их сообщения. Продолжить?",
      confirmLabel: "импорт",
      cancelLabel: "отмена",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setIsMutating(true);
    try {
      const text = await file.text();
      const parsedJson = JSON.parse(text) as unknown;

      if (
        typeof parsedJson !== "object" ||
        parsedJson === null ||
        (parsedJson as { schemaVersion?: unknown }).schemaVersion !==
          CATEGORY_TREE_SCHEMA_VERSION
      ) {
        throw new Error("Неподдерживаемый формат файла импорта.");
      }

      const response = await authorizedFetch(
        `/api/categories/${currentCategory.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsedJson),
        }
      );

      const payload = (await response.json()) as {
        error?: string;
        source?: DataSource;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось импортировать категорию.");
      }

      setSource((prev) => payload.source ?? prev);
      await loadCategories();
      pushNotice("Импорт завершен. Данные синхронизированы с сервером.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось импортировать категорию."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  if (!isAuthReady) {
    return (
      <main className="workspace-root flex w-full items-stretch p-0">
        <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
          <div className="popup-3d w-full max-w-xl p-5">
            <h1 className="font-display text-5xl leading-none">Item Key</h1>
            <p className="mt-3 text-sm text-[#202020]">Проверяю сессию аккаунта...</p>
          </div>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="workspace-root flex w-full items-stretch p-0">
        <div className="frame-shell relative flex h-full w-full items-center justify-center p-4">
          <div className="popup-3d w-full max-w-xl p-5">
            <h1 className="font-display text-5xl leading-none">Item Key</h1>
            <p className="mt-3 text-sm text-[#202020]">
              {authTab === "login"
                ? "Введи данные для входа: user-id и пароль."
                : "Введи данные для регистрации аккаунта."}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={`mini-action ${authTab === "login" ? "border-[#4a4a4a] bg-[#bdbdbd]" : "opacity-70"}`}
                onClick={() => {
                  setAuthTab("login");
                  setAuthError(null);
                  setAuthInfo(null);
                }}
                disabled={isAuthBusy}
              >
                вход
              </button>
              <button
                type="button"
                className={`mini-action ${authTab === "register" ? "border-[#4a4a4a] bg-[#bdbdbd]" : "opacity-70"}`}
                onClick={() => {
                  setAuthTab("register");
                  setAuthError(null);
                  setAuthInfo(null);
                }}
                disabled={isAuthBusy}
              >
                регистрация
              </button>
            </div>

            {authTab === "login" ? (
              <>
                <label className="settings-label mt-4">user-id</label>
                <input
                  type="text"
                  value={authLoginUserIdDraft}
                  onChange={(event) => setAuthLoginUserIdDraft(event.target.value)}
                  className="settings-input"
                  placeholder="my.user-id"
                  autoComplete="username"
                  spellCheck={false}
                />

                <label className="settings-label mt-3">Пароль</label>
                <div className="settings-input-wrap">
                  <input
                    type={showAuthLoginPassword ? "text" : "password"}
                    value={authLoginPassword}
                    onChange={(event) => setAuthLoginPassword(event.target.value)}
                    className="settings-input pr-14"
                    placeholder="Твой пароль"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="input-inline-action"
                    onClick={() => setShowAuthLoginPassword((prev) => !prev)}
                    aria-label={
                      showAuthLoginPassword ? "Скрыть пароль" : "Показать пароль"
                    }
                  >
                    {showAuthLoginPassword ? "hide" : "show"}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleAuthSignIn()}
                    disabled={isAuthBusy}
                  >
                    войти
                  </button>
                  <a
                    href="/forgot-password"
                    className="mini-action inline-flex items-center justify-center"
                  >
                    забыли пароль
                  </a>
                </div>
              </>
            ) : (
              <>
                <label className="settings-label mt-4">Email</label>
                <input
                  type="email"
                  value={authRegisterEmail}
                  onChange={(event) => setAuthRegisterEmail(event.target.value)}
                  className="settings-input"
                  placeholder="you@example.com"
                  autoComplete="email"
                />

                <label className="settings-label mt-3">user-id</label>
                <input
                  type="text"
                  value={authRegisterUserIdDraft}
                  onChange={(event) => setAuthRegisterUserIdDraft(event.target.value)}
                  className="settings-input"
                  placeholder="my.user-id"
                  autoComplete="username"
                  spellCheck={false}
                />

                <label className="settings-label mt-3">Пароль</label>
                <div className="settings-input-wrap">
                  <input
                    type={showAuthRegisterPassword ? "text" : "password"}
                    value={authRegisterPassword}
                    onChange={(event) => setAuthRegisterPassword(event.target.value)}
                    className="settings-input pr-14"
                    placeholder="Минимум 6 символов"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="input-inline-action"
                    onClick={() => setShowAuthRegisterPassword((prev) => !prev)}
                    aria-label={
                      showAuthRegisterPassword ? "Скрыть пароль" : "Показать пароль"
                    }
                  >
                    {showAuthRegisterPassword ? "hide" : "show"}
                  </button>
                </div>

                <label className="settings-label mt-3">Повтори пароль</label>
                <input
                  type={showAuthRegisterPassword ? "text" : "password"}
                  value={authRegisterPasswordRepeat}
                  onChange={(event) => setAuthRegisterPasswordRepeat(event.target.value)}
                  className="settings-input"
                  placeholder="Повтори пароль"
                  autoComplete="new-password"
                />

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleAuthSignUp()}
                    disabled={isAuthBusy}
                  >
                    зарегистрироваться
                  </button>
                </div>

                <p className="settings-hint mt-3">
                  Письмо подтверждения отправляем автоматически после регистрации.
                </p>
              </>
            )}

            {authError && (
              <p className="mt-3 rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]">
                {authError}
              </p>
            )}

            {authInfo && (
              <p className="mt-3 rounded border-2 border-[#476018] bg-[#bdd39f] px-3 py-2 text-sm text-[#1f2d0d]">
                {authInfo}
              </p>
            )}

            <p className="settings-hint mt-3">
              После входа данные привязываются к твоему аккаунту и синхронизируются
              между устройствами.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="workspace-root flex w-full items-stretch p-0">
      <div className="frame-shell relative flex h-full w-full flex-col overflow-hidden">
        <header className="top-strip bevel-panel flex h-[4.7rem] flex-none items-center gap-2 px-2 py-2 sm:gap-3 sm:px-3">
          <button
            type="button"
            onClick={selectCurrentCategoryAsTarget}
            className={`title-chip flex min-w-[11rem] flex-1 items-center px-3 py-2 ${
              insertionTargetId === currentCategoryId ? "title-chip-active" : ""
            }`}
          >
            <span className="font-display text-[1.6rem] leading-none sm:text-[1.95rem]">
              :{(currentCategory?.title ?? "no category").toUpperCase()}
            </span>
          </button>

          <div className="project-topbar-group">
            <button
              type="button"
              className="project-hash-button font-display"
              onClick={openProjectCreateModal}
              aria-label="Создать проект по хэштегам"
            >
              #
            </button>

            <div className="project-tab-strip" role="tablist" aria-label="Список проектов">
              <button
                type="button"
                role="tab"
                aria-selected={activeProjectId === null}
                className={`project-tab ${activeProjectId === null ? "project-tab-active" : ""}`}
                onClick={() => handleSelectProjectTab(null)}
              >
                ХАБ
              </button>

              {sortedProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  role="tab"
                  aria-selected={activeProjectId === project.id}
                  className={`project-tab ${activeProjectId === project.id ? "project-tab-active" : ""}`}
                  onClick={() => handleSelectProjectTab(project.id)}
                >
                  {project.title}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="logo-cube font-display text-xl"
              onClick={toggleMenu}
              aria-label="Открыть боковое меню"
            >
              AKE
            </button>
          </div>
        </header>

        <div className="content-bay flex min-h-0 flex-1">
          <aside className="sidebar-rail flex flex-col p-0">
            <div className="sidebar-scroll flex-1">
              {childCategories.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={`sidebar-item w-full border-x-0 border-t-0 text-left font-display text-[1.7rem] leading-none sm:text-[1.95rem] ${
                    insertionTargetId === node.id ? "sidebar-item-active" : ""
                  }`}
                  onClick={() => openCategory(node.id)}
                >
                  {node.title}
                </button>
              ))}

              {Array.from({ length: sidebarFillerCount }).map((_, index) => (
                <div
                  key={`filler-${index}`}
                  className="sidebar-item pointer-events-none w-full border-x-0 border-t-0 opacity-45"
                  aria-hidden="true"
                />
              ))}
            </div>
          </aside>

          <section className="workspace-screen">
            {currentCategory?.format === "block" ? (
              <>
                <div className="message-toolbar">
                  <button
                    type="button"
                    className="mini-action"
                    onClick={handleAddMessage}
                    disabled={!currentCategoryId || isMutating}
                  >
                    + сообщение
                  </button>
                  <span className="toolbar-meta">формат: блочный</span>
                </div>

                <div className="message-board message-board-block" onClick={() => setSelectedMessageId(null)}>
                  {currentMessages.length === 0 ? (
                    <p className="empty-note">В этой категории пока нет сообщений. Нажми + сообщение.</p>
                  ) : (
                    currentMessages.map((message) => (
                      <article
                        key={message.id}
                        className={`message-item message-item-block ${
                          selectedMessageId === message.id ? "message-item-active" : ""
                        }`}
                        onDragOver={(event) => {
                          if (dragMessageId && dragMessageId !== message.id) {
                            event.preventDefault();
                          }
                        }}
                        onDrop={(event) => {
                          if (!dragMessageId) {
                            return;
                          }
                          event.preventDefault();
                          handleDropOnMessage(message.id);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedMessageId(message.id);
                        }}
                      >
                        <div className="message-head">
                          <span className="message-title">{message.title}</span>
                          <div className="message-head-right">
                            <span className="message-kind">
                              {toMessageTypeLabel(message.message_type)}
                            </span>
                            <button
                              type="button"
                              className={`message-drag ${
                                dragMessageId === message.id ? "message-drag-active" : ""
                              }`}
                              draggable={currentMessages.length > 1}
                              onMouseDown={(event) => event.stopPropagation()}
                              onDragStart={(event) => {
                                event.stopPropagation();
                                if (event.dataTransfer) {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", message.id);
                                }
                                setDragMessageId(message.id);
                              }}
                              onDragEnd={() => setDragMessageId(null)}
                              aria-label="Перетащить блок"
                            >
                              ::
                            </button>
                          </div>
                        </div>

                        <textarea
                          value={message.content}
                          onChange={(event) =>
                            handleMessageContentChange(message.id, event.target.value)
                          }
                          onFocus={() => setSelectedMessageId(message.id)}
                          className="message-editor"
                          placeholder="Текст сообщения..."
                        />
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="message-toolbar">
                  <span className="toolbar-meta">формат: сплошной</span>
                </div>
                <div className="continuous-wrap">
                  <textarea
                    value={continuousDraft}
                    onChange={(event) =>
                      handleContinuousContentChange(event.target.value)
                    }
                    onFocus={() => setSelectedMessageId(null)}
                    className="continuous-editor"
                    placeholder="Пиши сплошной текст как в Word..."
                    disabled={!currentCategoryId || isLoading || Boolean(loadError)}
                  />
                </div>
              </>
            )}

            {loadError && (
              <div className="mt-2 rounded border-2 border-[#6a1313] bg-[#dca3a3] px-3 py-2 text-sm text-[#3a0e0e]">
                {loadError}
              </div>
            )}
          </section>

          <aside className="settings-panel">
            <h2 className="settings-title font-display">settings</h2>

            {selectedMessage && currentCategory?.format === "block" ? (
              <div className="settings-group">
                <p className="settings-caption">
                  блок: {selectedMessage.title} / {currentCategory.title}
                </p>

                <label className="settings-label">название блока</label>
                <input
                  value={messageTitleDraft}
                  onChange={(event) => setMessageTitleDraft(event.target.value)}
                  onBlur={() => void handleMessageTitleBlur()}
                  className="settings-input"
                />

                <button
                  type="button"
                  className="mini-action"
                  onClick={() => setSelectedMessageId(null)}
                >
                  настройки категории
                </button>

                {currentCategory.category_type === "learning" && (
                  <>
                    <label className="settings-label">режим сообщения</label>
                    <select
                      value={selectedMessage.message_type}
                      className="settings-input"
                      onChange={(event) =>
                        void handleMessageTypeChange(event.target.value as MessageType)
                      }
                    >
                      <option value="info">информация</option>
                      <option value="exercise">упражнение</option>
                    </select>
                  </>
                )}

                <button
                  type="button"
                  className="danger-action"
                  onClick={handleDeleteMessage}
                  disabled={isMutating}
                >
                  удалить сообщение
                </button>
              </div>
            ) : currentCategory ? (
              <div className="settings-group">
                <p className="settings-caption">категория: {currentCategory.title}</p>

                {activeProject && (
                  <>
                    <p className="settings-caption">проект: {activeProject.title}</p>
                    <label className="settings-label">теги проекта</label>
                    <div className="category-tag-row">
                      <button
                        type="button"
                        className="category-tag-action category-tag-action-apply"
                        onClick={() => void handleAddProjectTag()}
                        disabled={isSavingProject || isMutating || isLoading}
                        aria-label="Добавить хэштег в проект"
                      >
                        +
                      </button>
                      <input
                        value={projectSettingsTagDraft}
                        onChange={(event) => setProjectSettingsTagDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") {
                            return;
                          }

                          event.preventDefault();
                          void handleAddProjectTag();
                        }}
                        className="settings-input"
                        placeholder="#project-filter"
                      />
                    </div>

                    {projectTagSuggestions.length > 0 && (
                      <div className="category-tag-suggestions">
                        {projectTagSuggestions.map((tag) => (
                          <button
                            key={`project-suggestion-${tag}`}
                            type="button"
                            className="category-tag-suggestion"
                            onClick={() => void handleAddProjectTag(tag)}
                            disabled={isSavingProject || isMutating || isLoading}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="category-tag-chip-list">
                      {activeProjectTags.length === 0 ? (
                        <p className="settings-hint">У проекта пока нет хэштегов.</p>
                      ) : (
                        activeProjectTags.map((tag) => (
                          <div key={`project-tag-${tag.toLocaleLowerCase()}`} className="category-tag-chip">
                            <button
                              type="button"
                              className="category-tag-chip-remove"
                              onClick={() => void handleRemoveProjectTag(tag)}
                              disabled={isSavingProject || isMutating || isLoading}
                              aria-label={`Удалить ${tag} из проекта`}
                            >
                              ×
                            </button>
                            <span className="category-tag-chip-text">{tag}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}

                <label className="settings-label">переименовать категорию</label>
                <input
                  value={categoryForm.title}
                  onChange={(event) =>
                    setCategoryForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                  onBlur={handleCategoryTitleBlur}
                  className="settings-input"
                />

                <label className="settings-label">описание категории</label>
                <textarea
                  value={categoryForm.description}
                  onChange={(event) =>
                    setCategoryForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  onBlur={handleCategoryDescriptionBlur}
                  className="settings-input settings-textarea"
                />

                <label className="settings-label">переместить категорию</label>
                <select
                  value={categoryMoveParentDraft}
                  className="settings-input"
                  onChange={(event) => setCategoryMoveParentDraft(event.target.value)}
                >
                  {moveParentOptions.map((option) => (
                    <option key={option.id ?? "root"} value={option.id ?? ""}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="mini-action"
                  onClick={() => void handleMoveCategoryToParent()}
                  disabled={isMutating || isLoading}
                >
                  переместить
                </button>

                <label className="settings-label"># категории</label>
                {isProjectMode ? (
                  <>
                    <div className="category-tag-chip-list">
                      {currentCategoryTags.length === 0 ? (
                        <p className="settings-hint">
                          В проектах # категории нельзя менять. Эта категория без хэштегов.
                        </p>
                      ) : (
                        currentCategoryTags.map((tag) => (
                          <div key={tag.toLocaleLowerCase()} className="category-tag-chip">
                            <span className="category-tag-chip-text">{tag}</span>
                          </div>
                        ))
                      )}
                    </div>
                    <p className="settings-hint">
                      Для изменения # категории перейди в проект ХАБ.
                    </p>
                  </>
                ) : (
                  <>
                    <div
                      className="category-tag-editor"
                      onBlur={handleCategoryTagEditorBlur}
                    >
                      <div className="category-tag-row">
                        <button
                          type="button"
                          className="category-tag-action category-tag-action-library"
                          onClick={openCategoryTagLibrary}
                          aria-label="Открыть список всех хэштегов"
                        >
                          <TagLibraryIcon />
                        </button>
                        <button
                          type="button"
                          className="category-tag-action category-tag-action-apply"
                          onClick={() => void handleAddCategoryTag()}
                          disabled={isMutating || isLoading}
                          aria-label="Добавить хэштег в категорию"
                        >
                          +
                        </button>
                        <input
                          ref={categoryTagInputRef}
                          value={categoryForm.tag}
                          onChange={(event) =>
                            setCategoryForm((prev) => ({ ...prev, tag: event.target.value }))
                          }
                          onFocus={() => setShowCategoryTagSuggestions(true)}
                          onClick={() => setShowCategoryTagSuggestions(true)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") {
                              return;
                            }

                            event.preventDefault();
                            void handleAddCategoryTag();
                          }}
                          placeholder="#learning"
                          className="settings-input"
                        />
                      </div>

                      {showCategoryTagSuggestions && categoryTagSuggestions.length > 0 && (
                        <div className="category-tag-suggestions">
                          {categoryTagSuggestions.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className="category-tag-suggestion"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() =>
                                void handleAddCategoryTag(tag, {
                                  keepInputFocus: true,
                                  keepSuggestionsOpen: true,
                                })
                              }
                              disabled={isMutating || isLoading}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="category-tag-chip-list">
                        {currentCategoryTags.length === 0 ? (
                          <p className="settings-hint">У этой категории пока нет хэштегов.</p>
                        ) : (
                          currentCategoryTags.map((tag) => (
                            <div key={tag.toLocaleLowerCase()} className="category-tag-chip">
                              <button
                                type="button"
                                className="category-tag-chip-remove"
                                onClick={() => void handleRemoveCategoryTag(tag)}
                                disabled={isMutating || isLoading}
                                aria-label={`Удалить ${tag} из категории`}
                              >
                                ×
                              </button>
                              <span className="category-tag-chip-text">{tag}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <p className="settings-hint">
                      Введи хэштег и нажми +. Клик по подсказке добавляет его сразу.
                    </p>
                  </>
                )}

                <label className="settings-label">формат категории</label>
                <select
                  value={categoryForm.format}
                  className="settings-input"
                  onChange={(event) =>
                    void handleCategoryFormatChange(event.target.value as CategoryFormat)
                  }
                >
                  <option value="block">блочный</option>
                  <option value="continuous">сплошной</option>
                </select>

                <label className="settings-label">тип категории</label>
                <select
                  value={categoryForm.categoryType}
                  className="settings-input"
                  onChange={(event) =>
                    handleCategoryTypeChange(event.target.value as CategoryType)
                  }
                >
                  <option value="learning">learning</option>
                </select>

                <p className="settings-hint">
                  Для типа learning у сообщений доступно: информация / упражнение.
                </p>

                <label className="settings-label">экспорт / импорт категории</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleExportCategoryTree()}
                    disabled={isMutating || isLoading}
                  >
                    экспорт дерева
                  </button>
                  <button
                    type="button"
                    className="mini-action"
                    onClick={handleOpenImportPicker}
                    disabled={isMutating || isLoading}
                  >
                    импорт дерева
                  </button>
                </div>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(event) => void handleImportCategoryTree(event)}
                />
                <p className="settings-hint">
                  Импорт заменяет текущую категорию вместе со всеми вложенными
                  подкатегориями и сообщениями.
                </p>
              </div>
            ) : (
              <p className="settings-caption">Выбери категорию.</p>
            )}

          </aside>
        </div>

        <footer className="bottom-strip bevel-panel flex h-[6rem] flex-none items-end justify-between gap-3 px-2 pb-2 pt-[1.1rem] sm:h-[6.2rem] sm:px-3 sm:pb-3 sm:pt-[1.15rem]">
          <div className="flex items-end gap-2 sm:gap-3">
            <button
              type="button"
              className="tool-button tool-red"
              onClick={handleBack}
              disabled={!canGoBack || isMutating}
              aria-label="Назад"
            >
              &lt;
            </button>
            <button
              type="button"
              className="tool-button tool-green"
              onClick={handleAddCategory}
              disabled={!canCreate || isMutating || isLoading}
              aria-label="Добавить категорию"
            >
              +
            </button>
            <button
              type="button"
              className="tool-button tool-yellow"
              onClick={handleDeleteCategory}
              disabled={!canDelete || isMutating || isLoading}
              aria-label="Удалить категорию"
            >
              -
            </button>
          </div>

          <p className={`hidden text-sm font-semibold sm:block ${statusColor}`}>{statusText}</p>

          <div className="flex items-end gap-2 sm:gap-3">
            <button
              type="button"
              className="tool-button tool-blue"
              onClick={() => setShowSearch(true)}
              disabled={isLoading || Boolean(loadError)}
              aria-label="Открыть поиск"
            >
              <SearchIcon />
            </button>
            <button
              type="button"
              className="tool-button tool-red"
              onClick={() =>
                pushNotice("Раздел «Больше инструментов» будет добавлен позже.")
              }
              aria-label="Больше инструментов"
            >
              &gt;
            </button>
          </div>
        </footer>

        {confirmDialog && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center p-3">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              onClick={() => settleConfirmDialog(false)}
              aria-label="Закрыть окно подтверждения"
            />

            <div className="confirm-modal popup-3d relative z-10 w-full max-w-xl p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-display text-4xl leading-none">{confirmDialog.title}</h2>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={() => settleConfirmDialog(false)}
                  aria-label="Закрыть подтверждение"
                >
                  x
                </button>
              </div>

              <p className="confirm-modal-message">{confirmDialog.message}</p>

              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="mini-action"
                  onClick={() => settleConfirmDialog(false)}
                >
                  {confirmDialog.cancelLabel}
                </button>
                <button
                  type="button"
                  className={
                    confirmDialog.tone === "danger"
                      ? "danger-action"
                      : "mini-action"
                  }
                  onClick={() => settleConfirmDialog(true)}
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}

        {showProjectCreateModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-3">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              onClick={closeProjectCreateModal}
              aria-label="Закрыть окно создания проекта"
            />

            <div className="project-create-modal popup-3d relative z-10 w-full max-w-2xl p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-display text-4xl leading-none">Новый проект</h2>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={closeProjectCreateModal}
                  aria-label="Закрыть создание проекта"
                >
                  x
                </button>
              </div>

              <div className="project-admin-panel">
                <h3 className="font-display text-[1.75rem] leading-none">Управление проектами</h3>
                <p className="settings-hint mt-1">
                  Переименовать, переставить в списке, удалить.
                </p>

                <div className="project-admin-list mt-2">
                  {sortedProjects.length === 0 ? (
                    <p className="settings-hint">Пока нет пользовательских проектов.</p>
                  ) : (
                    sortedProjects.map((project, index) => {
                      const titleDraft = projectTitleDraftsById[project.id] ?? project.title;
                      const canMoveUp = index > 0;
                      const canMoveDown = index < sortedProjects.length - 1;
                      const canRename =
                        titleDraft.trim().length > 0 && titleDraft.trim() !== project.title;

                      return (
                        <div key={`project-admin-${project.id}`} className="project-admin-item">
                          <div className="project-admin-order">
                            <button
                              type="button"
                              className="project-admin-move"
                              onClick={() => void handleMoveProject(project.id, -1)}
                              disabled={!canMoveUp || isSavingProject || isCreatingProject}
                              aria-label={`Поднять проект ${project.title}`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="project-admin-move"
                              onClick={() => void handleMoveProject(project.id, 1)}
                              disabled={!canMoveDown || isSavingProject || isCreatingProject}
                              aria-label={`Опустить проект ${project.title}`}
                            >
                              ↓
                            </button>
                          </div>

                          <input
                            value={titleDraft}
                            onChange={(event) =>
                              handleProjectTitleDraftChange(project.id, event.target.value)
                            }
                            className="settings-input project-admin-input"
                            placeholder="Название проекта"
                          />

                          <button
                            type="button"
                            className="mini-action project-admin-save"
                            onClick={() => void handleProjectRename(project)}
                            disabled={!canRename || isSavingProject || isCreatingProject}
                          >
                            сохранить
                          </button>

                          <button
                            type="button"
                            className="danger-action project-admin-delete"
                            onClick={() => void handleProjectDelete(project)}
                            disabled={isSavingProject || isCreatingProject}
                          >
                            удалить
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="project-create-divider" />

              <label className="settings-label">поиск хэштега</label>
              <input
                autoFocus
                value={projectTagSearchQuery}
                onChange={(event) => setProjectTagSearchQuery(event.target.value)}
                className="settings-input"
                placeholder="Искать #хэштеги..."
              />

              <div className="project-create-tag-list mt-3">
                {projectCreateTagOptions.length === 0 ? (
                  <p className="settings-hint">Не нашел хэштегов по этому запросу.</p>
                ) : (
                  projectCreateTagOptions.map((tag) => {
                    const checked = projectTagSelectionKeySet.has(
                      tag.toLocaleLowerCase()
                    );

                    return (
                      <label key={`project-create-${tag}`} className="project-create-tag-option">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProjectTagSelection(tag)}
                        />
                        <span>{tag}</span>
                      </label>
                    );
                  })
                )}
              </div>

              <p className="settings-hint mt-2">
                Выбрано хэштегов: {projectTagSelection.length}
              </p>

              <label className="settings-label mt-3">назвать проект</label>
              <input
                value={projectTitleDraft}
                onChange={(event) => setProjectTitleDraft(event.target.value)}
                className="settings-input"
                placeholder="Например: auxiliary drills"
              />

              <button
                type="button"
                className="mini-action mt-3"
                onClick={() => void handleCreateProject()}
                disabled={isCreatingProject || isMutating || isLoading}
              >
                создать проект
              </button>
            </div>
          </div>
        )}

        {showSearch && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 p-3">
            <div className="popup-3d w-full max-w-3xl p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-display text-4xl leading-none">Search</h2>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={() => setShowSearch(false)}
                  aria-label="Закрыть поиск"
                >
                  x
                </button>
              </div>

              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Введи текст для поиска..."
                className="w-full border-2 border-[#4a4a4a] bg-[#efefef] px-3 py-2 text-base text-[#1a1a1a] outline-none focus:border-[#355faa]"
              />

              <div className="mt-3 max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                {searchResults.length === 0 && searchQuery.trim().length > 0 && (
                  <p className="px-2 text-sm text-[#2e2e2e]">Ничего не найдено.</p>
                )}

                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="search-item w-full px-3 py-2 text-left"
                    onClick={() => handleSearchOpenCategory(result)}
                  >
                    <p className="font-display text-3xl leading-none">{result.title}</p>
                    <p className="mt-1 text-xs text-[#2f2f2f]">{result.path}</p>
                    <p className="mt-1 text-sm text-[#232323]">{result.preview}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {showCategoryTagLibrary && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-3">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              onClick={closeCategoryTagLibrary}
              aria-label="Закрыть список хэштегов"
            />

            <div className="category-tag-library popup-3d relative z-10 w-full max-w-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-4xl leading-none">Хэштеги</h2>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={closeCategoryTagLibrary}
                  aria-label="Закрыть окно хэштегов"
                >
                  x
                </button>
              </div>

              <p className="mt-2 text-xs text-[#2b2b2b]">
                Нажми + чтобы привязать хэштег к текущей категории, или - чтобы убрать.
              </p>

              <div className="category-tag-library-list">
                {allExistingCategoryTags.length === 0 ? (
                  <p className="settings-hint">Пока нет созданных хэштегов.</p>
                ) : (
                  allExistingCategoryTags.map((entry) => {
                    const tagKey = entry.tag.toLocaleLowerCase();
                    const attachedToCurrentCategory =
                      currentCategoryTagKeySet.has(tagKey);
                    const canAdd =
                      !attachedToCurrentCategory && !isMutating && !isLoading;
                    const canRemove =
                      attachedToCurrentCategory && !isMutating && !isLoading;

                    return (
                      <div key={tagKey} className="category-tag-library-item">
                        <div className="category-tag-library-actions">
                          <button
                            type="button"
                            className="category-tag-toggle category-tag-toggle-plus"
                            onClick={() =>
                              void handleAddCategoryTag(entry.tag, {
                                keepInputFocus: false,
                                keepSuggestionsOpen: false,
                              })
                            }
                            disabled={!canAdd}
                            aria-label={`Добавить ${entry.tag} в категорию`}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="category-tag-toggle category-tag-toggle-minus"
                            onClick={() =>
                              void handleRemoveCategoryTag(entry.tag, {
                                keepInputFocus: false,
                              })
                            }
                            disabled={!canRemove}
                            aria-label={`Убрать ${entry.tag} из категории`}
                          >
                            -
                          </button>
                        </div>

                        <div className="category-tag-library-meta">
                          <p className="category-tag-library-name">{entry.tag}</p>
                          <p className="category-tag-library-usage">
                            Используется: {entry.usageCount}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {showMenu && (
          <div className="absolute inset-0 z-30">
            <button
              type="button"
              className="absolute inset-0 bg-black/20"
              onClick={closeMenu}
              aria-label="Закрыть меню"
            />
            <aside className="menu-3d absolute right-0 top-0 flex h-full w-[22rem] max-w-[92vw] flex-col p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-5xl leading-none">Menu</h2>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={closeMenu}
                  aria-label="Закрыть меню"
                >
                  x
                </button>
              </div>

              <p className="mt-3 rounded border border-[#5a5a5a] bg-[#e7e7e7] px-3 py-2 text-xs text-[#252525]">
                аккаунт: {accountEmailLabel}
              </p>

              {menuPanel === "root" ? (
                <div className="menu-scroll mt-4 flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
                  <button
                    type="button"
                    className="menu-action px-4 py-3 text-left text-lg font-semibold"
                    onClick={() => openMenuPanel("account")}
                  >
                    Аккаунт
                  </button>

                  <button
                    type="button"
                    className="menu-action px-4 py-3 text-left text-lg font-semibold"
                    onClick={() => openMenuPanel("settings")}
                  >
                    Настройки
                  </button>

                  <div className="mt-auto">
                    <button
                      type="button"
                      className="danger-action w-full px-4 py-3 text-left text-base font-semibold"
                      onClick={() => void handleAuthSignOut()}
                      disabled={isAuthBusy}
                    >
                      Выйти
                    </button>
                  </div>
                </div>
              ) : menuPanel === "account" ? (
                <div className="menu-scroll mt-4 flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  <button
                    type="button"
                    className="mini-action self-start"
                    onClick={() => setMenuPanel("root")}
                  >
                    &lt; назад
                  </button>

                  <div className="account-avatar-shell mt-1">
                    {accountAvatarPreviewUrl ? (
                      <div
                        className="account-avatar-image"
                        style={{ backgroundImage: `url(${accountAvatarPreviewUrl})` }}
                        aria-label="Аватар профиля"
                      />
                    ) : (
                      <span className="font-display text-5xl leading-none text-[#1f1f1f]">
                        {accountAvatarInitial}
                      </span>
                    )}
                  </div>

                  <label className="settings-label">Ник</label>
                  <input
                    value={accountNicknameDraft}
                    onChange={(event) => setAccountNicknameDraft(event.target.value)}
                    className="settings-input"
                    placeholder="Как тебя отображать"
                    maxLength={40}
                  />

                  <label className="settings-label">user-id</label>
                  <p className="settings-hint break-all">
                    {accountUserId
                      ? `Текущий user-id: ${accountUserId}`
                      : "Сейчас user-id не задан."}
                  </p>

                  <label className="settings-label">Описание профиля</label>
                  <textarea
                    value={accountProfileDescriptionDraft}
                    onChange={(event) =>
                      setAccountProfileDescriptionDraft(event.target.value)
                    }
                    className="settings-input settings-textarea"
                    placeholder="Коротко о себе"
                    maxLength={320}
                  />

                  <label className="settings-label">Аватарка (URL)</label>
                  <input
                    value={accountAvatarUrlDraft}
                    onChange={(event) => setAccountAvatarUrlDraft(event.target.value)}
                    className="settings-input"
                    placeholder="https://example.com/avatar.png"
                    autoComplete="url"
                    spellCheck={false}
                  />

                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => void handleSaveAccountProfile()}
                      disabled={isSavingAccountProfile || isAuthBusy}
                    >
                      сохранить профиль
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => setMenuPanel("settings")}
                    >
                      открыть настройки
                    </button>
                  </div>

                  <div className="mt-auto pt-2">
                    <button
                      type="button"
                      className="danger-action w-full px-4 py-3 text-left text-base font-semibold"
                      onClick={() => void handleAuthSignOut()}
                      disabled={isAuthBusy}
                    >
                      Выйти
                    </button>
                  </div>
                </div>
              ) : (
                <div className="menu-scroll mt-4 flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  <button
                    type="button"
                    className="mini-action self-start"
                    onClick={() => setMenuPanel("root")}
                  >
                    &lt; назад
                  </button>

                  <label className="settings-label">Почта</label>
                  <input value={accountEmailLabel} className="settings-input" readOnly />

                  <label className="settings-label mt-2">Смена user-id</label>
                  <input
                    value={accountUserIdDraft}
                    onChange={(event) => setAccountUserIdDraft(event.target.value)}
                    className="settings-input"
                    placeholder="my.user-id"
                    autoComplete="username"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleSaveAccountUserId()}
                    disabled={isSavingAccountUserId || isAuthBusy}
                  >
                    сменить user-id
                  </button>
                  {!accountCanChangeUserIdNow && accountNextUserIdChangeAt && (
                    <p className="settings-hint">
                      Следующая смена user-id: {formatDateTime(accountNextUserIdChangeAt)}
                    </p>
                  )}

                  <label className="settings-label mt-2">Смена пароля</label>
                  <input
                    type="password"
                    value={accountCurrentPasswordDraft}
                    onChange={(event) => setAccountCurrentPasswordDraft(event.target.value)}
                    className="settings-input"
                    placeholder="Текущий пароль"
                    autoComplete="current-password"
                  />
                  <input
                    type="password"
                    value={accountNewPasswordDraft}
                    onChange={(event) => setAccountNewPasswordDraft(event.target.value)}
                    className="settings-input"
                    placeholder="Новый пароль"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleChangeAccountPassword()}
                    disabled={isSavingAccountPassword || isAuthBusy}
                  >
                    обновить пароль
                  </button>
                  <p className="settings-hint">
                    После смены пароля сессии на других устройствах завершаются.
                  </p>

                  <label className="settings-label mt-2">migration-код</label>
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleIssueMigrationCode()}
                    disabled={isIssuingMigrationCode || !accountUserId}
                  >
                    выпустить migration-код
                  </button>
                  {issuedMigrationCode && (
                    <p className="settings-hint break-all">
                      Новый код: {issuedMigrationCode.code} (до {formatDateTime(issuedMigrationCode.expiresAt)})
                    </p>
                  )}
                  {!issuedMigrationCode && activeMigrationCodeMeta && (
                    <p className="settings-hint break-all">
                      Активный код: {activeMigrationCodeMeta.codeHint} (до {formatDateTime(activeMigrationCodeMeta.expiresAt)})
                    </p>
                  )}

                  <div className="mt-auto pt-2">
                    <button
                      type="button"
                      className="danger-action w-full px-4 py-3 text-left text-base font-semibold"
                      onClick={() => void handleAuthSignOut()}
                      disabled={isAuthBusy}
                    >
                      Выйти
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function normalizeCategoryRow(category: CategoryRow): CategoryRow {
  return {
    ...category,
    description: category.description ?? "",
    tag: category.tag ?? "",
    format: category.format ?? "continuous",
    category_type: category.category_type ?? "learning",
  };
}

function normalizeProjectRow(project: ProjectRow): ProjectRow {
  return {
    ...project,
    tag_filter: project.tag_filter ?? "",
    container_category_ids: project.container_category_ids ?? "",
  };
}

function mergeProjectTitleDraftMap(
  current: Record<string, string>,
  projects: ProjectRow[]
): Record<string, string> {
  const next: Record<string, string> = {};

  for (const project of projects) {
    const existing = current[project.id];
    next[project.id] = typeof existing === "string" ? existing : project.title;
  }

  return next;
}

function sortProjects(a: ProjectRow, b: ProjectRow): number {
  if (a.position === b.position) {
    return a.created_at.localeCompare(b.created_at);
  }

  return a.position - b.position;
}

function dedupePlainList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function parsePlainList(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return dedupePlainList(
          parsed.filter((entry): entry is string => typeof entry === "string")
        );
      }
    } catch {
      return dedupePlainList([trimmed]);
    }
  }

  if (trimmed.includes("\n")) {
    return dedupePlainList(trimmed.split(/\r?\n/g));
  }

  return dedupePlainList([trimmed]);
}

function serializePlainList(values: string[]): string {
  return dedupePlainList(values).join("\n");
}

function normalizeCategoryTagInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const withoutHash = trimmed.replace(/^#+/, "").trim();
  if (withoutHash.length === 0) {
    return "";
  }

  return `#${withoutHash.replace(/\s+/g, " ")}`;
}

function dedupeCategoryTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const normalized = normalizeCategoryTagInput(tag);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function parseCategoryTags(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return dedupeCategoryTags(
          parsed.filter((entry): entry is string => typeof entry === "string")
        );
      }
    } catch {
      return dedupeCategoryTags([trimmed]);
    }
  }

  if (trimmed.includes("\n")) {
    return dedupeCategoryTags(trimmed.split(/\r?\n/g));
  }

  return dedupeCategoryTags([trimmed]);
}

function serializeCategoryTags(tags: string[]): string {
  return dedupeCategoryTags(tags).join("\n");
}

type ProjectVisibility = {
  visibleCategoryIdSet: Set<string>;
  rootIds: string[];
};

function collectProjectVisibility(
  categories: CategoryRow[],
  project: ProjectRow | null
): ProjectVisibility {
  const visibleCategoryIdSet = new Set<string>();

  if (!project) {
    for (const category of categories) {
      visibleCategoryIdSet.add(category.id);
    }
    return {
      visibleCategoryIdSet,
      rootIds: [],
    };
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const projectTagKeySet = new Set(
    parseCategoryTags(project.tag_filter).map((tag) => tag.toLocaleLowerCase())
  );

  const candidateRootIds = new Set<string>();
  for (const category of categories) {
    const categoryTags = parseCategoryTags(category.tag);
    const hasProjectTag = categoryTags.some((tag) =>
      projectTagKeySet.has(tag.toLocaleLowerCase())
    );

    if (hasProjectTag) {
      candidateRootIds.add(category.id);
    }
  }

  for (const categoryId of parsePlainList(project.container_category_ids)) {
    if (categoryById.has(categoryId)) {
      candidateRootIds.add(categoryId);
    }
  }

  const rootIds: string[] = [];
  for (const categoryId of candidateRootIds) {
    if (hasCandidateAncestor(categoryId, candidateRootIds, categoryById)) {
      continue;
    }

    rootIds.push(categoryId);
  }

  rootIds.sort((leftId, rightId) =>
    sortProjectRootCategory(
      categoryById.get(leftId) ?? null,
      categoryById.get(rightId) ?? null
    )
  );

  const links = categories.map((node) => ({
    id: node.id,
    parent_id: node.parent_id,
  }));

  for (const rootId of rootIds) {
    visibleCategoryIdSet.add(rootId);

    for (const descendantId of collectDescendantIds(links, rootId)) {
      visibleCategoryIdSet.add(descendantId);
    }
  }

  return {
    visibleCategoryIdSet,
    rootIds,
  };
}

function hasCandidateAncestor(
  categoryId: string,
  candidateIds: Set<string>,
  categoryById: Map<string, CategoryRow>
): boolean {
  let parentId = categoryById.get(categoryId)?.parent_id ?? null;
  const visited = new Set<string>();

  while (parentId) {
    if (visited.has(parentId)) {
      return false;
    }

    visited.add(parentId);

    if (candidateIds.has(parentId)) {
      return true;
    }

    parentId = categoryById.get(parentId)?.parent_id ?? null;
  }

  return false;
}

function sortProjectRootCategory(
  left: CategoryRow | null,
  right: CategoryRow | null
): number {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  if (left.updated_at !== right.updated_at) {
    return right.updated_at.localeCompare(left.updated_at);
  }

  if (left.created_at !== right.created_at) {
    return right.created_at.localeCompare(left.created_at);
  }

  if (left.position !== right.position) {
    return left.position - right.position;
  }

  return left.title.localeCompare(right.title, "ru-RU");
}

function normalizeMessageRow(message: MessageRow): MessageRow {
  return {
    ...message,
    title: normalizeMessageTitle(message.title),
    message_type: message.message_type ?? "info",
  };
}

function sortMessages(a: MessageRow, b: MessageRow): number {
  if (a.position === b.position) {
    return a.created_at.localeCompare(b.created_at);
  }

  return a.position - b.position;
}

function reorderMessages(
  source: MessageRow[],
  dragId: string,
  targetId: string
): MessageRow[] {
  const fromIndex = source.findIndex((message) => message.id === dragId);
  const toIndex = source.findIndex((message) => message.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return source;
  }

  const reordered = [...source];
  const [dragged] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, dragged);

  return reordered.map((message, index) => ({
    ...message,
    position: index,
  }));
}

function makePreview(content: string, query: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "(пустой текст)";
  }

  const lower = trimmed.toLowerCase();
  const index = lower.indexOf(query);
  if (index < 0) {
    return trimmed.length > 90 ? `${trimmed.slice(0, 90)}...` : trimmed;
  }

  const start = Math.max(0, index - 24);
  const end = Math.min(trimmed.length, index + query.length + 40);
  const segment = trimmed.slice(start, end);

  return `${start > 0 ? "..." : ""}${segment}${end < trimmed.length ? "..." : ""}`;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toMessageTypeLabel(type: MessageType): string {
  if (type === "exercise") {
    return "УПРАЖНЕНИЕ";
  }

  return "ИНФОРМАЦИЯ";
}

function normalizeMessageTitle(title: string | null | undefined): string {
  const normalized = typeof title === "string" ? title.trim() : "";
  if (normalized.length === 0) {
    return "Новый блок";
  }

  return normalized.slice(0, 80);
}

function makeMessageTitleFromContent(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return normalizeMessageTitle(firstLine);
}

function makeCategoryExportFileName(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  const base = normalized.length > 0 ? normalized : "category";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${base}-tree-${stamp}.json`;
}

function isMainRootCategory(node: CategoryRow | null): boolean {
  if (!node) {
    return false;
  }

  return !node.parent_id && node.title.trim().toLowerCase() === "main";
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-8 w-8"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="16.2" y1="16.2" x2="21" y2="21" />
    </svg>
  );
}

function TagLibraryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <line x1="5" y1="6" x2="19" y2="6" />
      <line x1="5" y1="12" x2="19" y2="12" />
      <line x1="5" y1="18" x2="19" y2="18" />
    </svg>
  );
}
