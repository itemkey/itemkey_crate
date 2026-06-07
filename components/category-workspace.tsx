"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type FocusEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  buildCategoryPath,
  collectDescendantIds,
  getChildren,
  getInitialCategoryId,
  sortByPosition,
} from "@/lib/categories";
import {
  CATEGORY_TREE_SCHEMA_VERSION,
  type CategoryTreeDocument,
} from "@/lib/category-transfer";
import { storePdfViewerFile } from "@/lib/pdf-viewer-store";
import type {
  DictionaryEntryIdentity as SharedDictionaryEntryIdentity,
  DictionaryGroupResolvedResult,
  DictionarySearchResult as GlobalDictionarySearchResult,
  DictionaryWordGroup,
} from "@/lib/dictionaries";
import {
  applyScheduleSpontaneousPreview,
  buildScheduleSuggestions,
  buildSpontaneousSchedulePreview,
  createDefaultScheduleBlock,
  createDefaultSchedulePayload,
  createScheduleId,
  formatScheduleDateShort,
  formatScheduleMinutes,
  formatScheduleTimeRange,
  getEventDurationMinutes,
  getScheduleDayEvents,
  getScheduleFreeWindows,
  getScheduleGoalProgress,
  getScheduleListEvents,
  getScheduleSummary,
  getScheduleWeekDates,
  minutesToTime,
  normalizeScheduleBlocks,
  normalizeScheduleEvent,
  normalizeScheduleEvents,
  normalizeScheduleGoals,
  normalizeSchedulePayload,
  normalizeScheduleSettings,
  parseMessageScheduleContent,
  serializeMessageScheduleContent,
  timeToMinutes,
  type ScheduleBlock,
  type ScheduleDayMode,
  type ScheduleEnergyMode,
  type ScheduleEvent,
  type ScheduleEventType,
  type ScheduleGoal,
  type ScheduleGoalPeriod,
  type SchedulePayload,
  type SchedulePreviewChange,
  type SchedulePriority,
  type ScheduleRescheduleMode,
  type ScheduleSettings,
  type ScheduleSpontaneousPreview,
  type ScheduleStatus,
  type ScheduleSuggestion,
  type ScheduleViewMode,
} from "@/lib/schedules";
import { normalizeUserId, validateUserId } from "@/lib/account-user-id";
import { toErrorMessage } from "@/lib/errors";
import type {
  CategoryFormat,
  CategoryRow,
  CategoryType,
  FriendRow,
  InboxItemRow,
  MessageRow,
  MessageType,
  ProjectRow,
  PublicCategoryMemberRole,
  PublicCategoryPanel,
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

type CategoryRestorePayload = {
  data?: {
    categories: CategoryRow[];
    messages: MessageRow[];
  };
  projects?: ProjectRow[];
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

type AccountImageMeta = {
  id: string;
  kind?: "avatar" | "motivation";
  url: string;
  createdAt: string;
  sizeBytes: number;
};

type AccountImagesPayload = {
  data?: AccountImageMeta[];
  source?: DataSource;
  error?: string;
};

type AccountImagePayload = {
  data?: AccountImageMeta;
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

type FriendsPayload = {
  data?: FriendRow[];
  source?: DataSource;
  error?: string;
};

type FriendPayload = {
  data?: FriendRow;
  source?: DataSource;
  error?: string;
};

type InboxPayload = {
  data?: InboxItemRow[];
  source?: DataSource;
  error?: string;
};

type InboxAcceptPayload = {
  data?: {
    item: InboxItemRow;
    categories: CategoryRow[];
    messages: MessageRow[];
  };
  source?: DataSource;
  error?: string;
};

type InboxItemPayload = {
  data?: InboxItemRow;
  source?: DataSource;
  error?: string;
};

type PublicPanelPayload = {
  data?: PublicCategoryPanel;
  source?: DataSource;
  error?: string;
};

type WorkspaceBootstrapPayload = {
  data?: {
    authUser: {
      id: string;
      email: string | null;
      emailVerifiedAt?: string | null;
    } | null;
    account?: AccountPayload["data"];
    categories?: CategoryRow[];
    projects?: ProjectRow[];
    friends?: FriendRow[];
    dictionaryGroups?: DictionaryWordGroup[];
    initialCategoryId?: string | null;
    initialMessages?: MessageRow[];
    publicPanel?: PublicCategoryPanel | null;
  };
  source?: DataSource;
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

type DictionaryGlobalSearchScope = "workspace" | "project" | "category";

type DictionarySearchPayload = {
  data?: GlobalDictionarySearchResult[];
  source?: DataSource;
  error?: string;
};

type DictionaryGroupsPayload = {
  data?: DictionaryWordGroup[];
  source?: DataSource;
  error?: string;
};

type DictionaryGroupPayload = {
  data?: DictionaryWordGroup;
  source?: DataSource;
  error?: string;
};

type DictionaryGroupSimilarPayload = {
  data?: {
    groups: Array<{
      id: string;
      title: string;
    }>;
    results: DictionaryGroupResolvedResult[];
  };
  source?: DataSource;
  error?: string;
};

type PendingDictionarySearchSource = {
  sourceCategoryId: string;
  sourceMessageId: string | null;
  dictionaryId: string | null;
};

type ChecklistItemOrderMode = "auto" | "custom";

type ChecklistBlock = {
  id: string;
  title: string;
  tags: string[];
  checkedCategoryIds: string[];
  orderMode: ChecklistItemOrderMode;
  customOrderCategoryIds: string[];
};

type ContinuousContentModel = {
  text: string;
  checklists: ChecklistBlock[];
  dictionaries: DictionaryBlock[];
  schedules: ScheduleBlock[];
};

type MessageChecklistPayload = {
  tags: string[];
  checkedCategoryIds: string[];
  orderMode: ChecklistItemOrderMode;
  customOrderCategoryIds: string[];
};

type ChecklistEditorSource = "continuous" | "block-message";

type ChecklistEditorState = {
  source: ChecklistEditorSource;
  sourceCategoryId: string;
  sourceMessageId: string | null;
  checklistId: string | null;
  titleDraft: string;
  tagSelection: string[];
  orderMode: ChecklistItemOrderMode;
  customOrderCategoryIds: string[];
};

type ChecklistParticipationEntry = {
  source: ChecklistEditorSource;
  sourceCategoryId: string;
  sourceCategoryTitle: string;
  sourceMessageId: string | null;
  checklistId: string;
  checklistTitle: string;
  tags: string[];
  checked: boolean;
};

type ChecklistCategoryOption = {
  categoryId: string;
  label: string;
  createdAt: string;
  position: number;
};

type ChecklistDragItem = {
  source: ChecklistEditorSource;
  sourceCategoryId: string;
  sourceMessageId: string | null;
  checklistId: string;
  categoryId: string;
  checked: boolean;
};

type DictionaryPromptSide = "side1" | "side2";
type DictionaryMotivationAdvanceMode = "auto" | "manual";
type DictionaryColumnKind = "word" | "note";
type DictionaryNoteDisplayMode = "continuous" | "separate";
type DictionaryStudyAnswerResult = "correct" | "wrong";
type DictionaryMotivationDismissAction = "advance" | "clear";
type DictionaryMotivationShowResult = "shown" | "skipped" | "canceled";
type DictionaryMotivationPhase = "entering" | "visible" | "exiting";

type DictionaryEntry = {
  id: string;
  values: Record<string, string>;
  side1?: string;
  side1Note?: string;
  side2?: string;
  side2Note?: string;
};

type DictionaryColumn = {
  id: string;
  side: DictionaryPromptSide;
  kind: DictionaryColumnKind;
  label: string;
  wordIndex?: number;
};

type DictionaryFieldLabels = Record<string, string>;

type DictionaryBlock = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  promptSide: DictionaryPromptSide;
  shuffle: boolean;
  autoSpeak: boolean;
  autoSpeakFields: DictionaryEntryField[];
  manualSpeakFields: DictionaryEntryField[];
  noteDisplayMode: DictionaryNoteDisplayMode;
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: DictionaryMotivationAdvanceMode;
  motivationAutoSeconds: number;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  entries: DictionaryEntry[];
};

type MessageDictionaryPayload = {
  description: string;
  tags: string[];
  promptSide: DictionaryPromptSide;
  shuffle: boolean;
  autoSpeak: boolean;
  autoSpeakFields: DictionaryEntryField[];
  manualSpeakFields: DictionaryEntryField[];
  noteDisplayMode: DictionaryNoteDisplayMode;
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: DictionaryMotivationAdvanceMode;
  motivationAutoSeconds: number;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  entries: DictionaryEntry[];
};

type ScheduleEditorSource = "continuous" | "block-message";

type ScheduleSourceRef = {
  source: ScheduleEditorSource;
  sourceCategoryId: string;
  sourceMessageId: string | null;
  scheduleId: string | null;
};

type ScheduleEventDraft = {
  title: string;
  description: string;
  date: string;
  start: string;
  durationMinutes: string;
  type: ScheduleEventType;
  category: string;
  priority: SchedulePriority;
  status: ScheduleStatus;
  canMove: boolean;
  canSplit: boolean;
  deadline: string;
  recurrence: string;
};

type ScheduleAssistantDraft = {
  text: string;
  durationMinutes: string;
  date: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  preferredTime: string;
  avoidedTime: string;
  deadline: string;
  priority: SchedulePriority;
  canMove: boolean;
  canSplit: boolean;
  category: string;
};

type ScheduleSpontaneousDraft = {
  text: string;
  date: string;
  start: string;
  durationMinutes: string;
  priority: SchedulePriority;
  canCancel: boolean;
  scope: "today" | "near";
};

type ScheduleGoalDraft = {
  id: string;
  title: string;
  category: string;
  period: ScheduleGoalPeriod;
  targetCount: string;
  targetMinutes: string;
};

type ScheduleModalState =
  | (ScheduleSourceRef & {
      mode: "event";
      eventId: string | null;
      draft: ScheduleEventDraft;
    })
  | (ScheduleSourceRef & {
      mode: "assistant";
      draft: ScheduleAssistantDraft;
      suggestions: ScheduleSuggestion[];
      status: string;
    })
  | (ScheduleSourceRef & {
      mode: "spontaneous";
      draft: ScheduleSpontaneousDraft;
      preview: ScheduleSpontaneousPreview | null;
      status: string;
    })
  | (ScheduleSourceRef & {
      mode: "goals";
      goalDrafts: ScheduleGoalDraft[];
      settingsDraft: ScheduleSettings;
    });

type DictionaryEditorState = {
  source: "continuous" | "block-message";
  sourceCategoryId: string;
  sourceMessageId: string | null;
  dictionaryId: string | null;
  titleDraft: string;
  descriptionDraft: string;
  tagsDraft: string;
  promptSide: DictionaryPromptSide;
  shuffle: boolean;
  autoSpeak: boolean;
  autoSpeakFields: DictionaryEntryField[];
  manualSpeakFields: DictionaryEntryField[];
  noteDisplayMode: DictionaryNoteDisplayMode;
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: DictionaryMotivationAdvanceMode;
  motivationAutoSeconds: number;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  entries: DictionaryEntry[];
};

type DictionaryStudyState = {
  sourceCategoryId: string;
  sourceMessageId: string | null;
  dictionaryId: string | null;
  title: string;
  promptSide: DictionaryPromptSide;
  labels: DictionaryFieldLabels;
  columns: DictionaryColumn[];
  baseCards: DictionaryEntry[];
  cards: DictionaryEntry[];
  shuffle: boolean;
  autoSpeak: boolean;
  autoSpeakFields: DictionaryEntryField[];
  manualSpeakFields: DictionaryEntryField[];
  noteDisplayMode: DictionaryNoteDisplayMode;
  progressMode: boolean;
  motivateOnCorrect: boolean;
  cardMode: boolean;
  adhdMode: boolean;
  motivationAdvanceMode: DictionaryMotivationAdvanceMode;
  motivationAutoSeconds: number;
  progressKey: string;
  currentIndex: number;
  isAnswerRevealed: boolean;
  progressStartedAt: number;
  progressCompletedAt: number | null;
  correctCount: number;
  wrongCount: number;
  answerResultsByEntryId: Record<string, DictionaryStudyAnswerResult>;
  isProgressComplete: boolean;
  motivationImageUrl: string | null;
  motivationDismissAction: DictionaryMotivationDismissAction;
  motivationPhase: DictionaryMotivationPhase;
  motivationImageKey: number;
  transitionKey: number;
  activeWordIndexBySide: Record<DictionaryPromptSide, number>;
  activeNoteIndexBySide: Record<DictionaryPromptSide, number>;
};

type DictionaryStudyProgress = {
  currentIndex: number;
  isAnswerRevealed: boolean;
  cardIds: string[];
  shuffle: boolean;
  progressMode: boolean;
  progressStartedAt: number;
  progressCompletedAt: number | null;
  correctCount: number;
  wrongCount: number;
  answerResultsByEntryId: Record<string, DictionaryStudyAnswerResult>;
  isProgressComplete: boolean;
};

type DictionaryEntryField = string;
type DictionaryLabelField = string;
type DictionaryEditorTab = "entries" | "transfer" | "general";
type AccountWindowTab = "account" | "settings" | "friends" | "motivation";

type DictionaryEditorSearchMatch = {
  entryId: string;
  field: DictionaryEntryField;
  start: number;
  end: number;
  isFuzzy: boolean;
};

type SidebarTab = "categories" | "dictionaryGroups";

type DictionarySimilarPopupState = {
  identity: SharedDictionaryEntryIdentity;
  groups: Array<{
    id: string;
    title: string;
  }>;
  results: DictionaryGroupResolvedResult[];
  isLoading: boolean;
  error: string | null;
};

type CategoryFormState = {
  title: string;
  description: string;
  tag: string;
  format: CategoryFormat;
  categoryType: CategoryType;
};

type RichEditorScope =
  | {
      kind: "block";
      messageId: string;
    }
  | {
      kind: "continuous";
    };

type SavedRichSelection = {
  scope: RichEditorScope;
  range: Range;
};

type RichImageSelection = {
  scope: RichEditorScope;
  imageId: string;
};

type RichFileSelection = {
  scope: RichEditorScope;
  fileId: string;
};

type RichFileObjectUrlCacheEntry = {
  source: string;
  objectUrl: string;
};

type DraggedRichImage = {
  scope: RichEditorScope;
  imageId: string;
};

type DraggedRichFile = {
  scope: RichEditorScope;
  fileId: string;
};

type RichImageResizeEdge = "left" | "right" | "top" | "bottom";

type RichImageResizeState = {
  pointerId: number;
  scope: RichEditorScope;
  imageId: string;
  edge: RichImageResizeEdge;
  startX: number;
  startY: number;
  startWidth: number;
  displayScale: number;
  editor: HTMLDivElement;
  figure: HTMLElement;
};

type RichImageOverlayRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type WorkspaceUiUndoSnapshot = {
  currentCategoryId: string | null;
  insertionTargetId: string | null;
  activeProjectId: string | null;
  selectedMessageId: string | null;
  activeRichEditor: RichEditorScope | null;
  editorTextScalePercent: number;
};

type WorkspaceUndoEntry =
  | {
      kind: "ui";
      snapshot: WorkspaceUiUndoSnapshot;
    }
  | {
      kind: "editor";
      snapshot: WorkspaceUiUndoSnapshot;
      scope: RichEditorScope;
      categoryId: string | null;
      html: string;
    }
  | {
      kind: "editors";
      snapshot: WorkspaceUiUndoSnapshot;
      entries: Array<{
        scope: RichEditorScope;
        categoryId: string | null;
        html: string;
      }>;
    }
  | {
      kind: "category-delete";
      snapshot: WorkspaceUiUndoSnapshot;
      document: CategoryTreeDocument;
      projects: ProjectRow[];
    };

type ConfirmDialogTone = "neutral" | "danger";

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmDialogTone;
};

type MenuPanel = "main" | "account" | "settings" | "friends";
type MobilePanel = "categories" | "projects" | "settings" | "tools" | null;
type OpenCategoryOptions = {
  keepMobilePanel?: boolean;
};
type AuthTab = "login" | "register";

const DEFAULT_CATEGORY_FORM: CategoryFormState = {
  title: "",
  description: "",
  tag: "",
  format: "continuous",
  categoryType: "learning",
};

const DEFAULT_TEXT_COLOR = "#1a1a1a";
const DEFAULT_EDITOR_TEXT_SCALE_PERCENT = 100;
const MIN_EDITOR_TEXT_SCALE_PERCENT = 70;
const MAX_EDITOR_TEXT_SCALE_PERCENT = 1000;
const EDITOR_TEXT_SCALE_STEP_PERCENT = 10;

const TEXT_COLOR_PRESETS = [
  "#1a1a1a",
  "#2f5fa3",
  "#0c7b46",
  "#8f6500",
  "#9b1f2a",
  "#6f2c8f",
  "#ffffff",
];

const RICH_IMAGE_CLASS_NAME = "rich-image-block";
const RICH_IMAGE_ZONE_CLASS_NAME = "rich-image-zone";
const RICH_IMAGE_SELECTED_CLASS_NAME = "rich-image-selected";
const RICH_IMAGE_DELETE_CONFIRM_CLASS_NAME = "rich-image-delete-confirm";
const RICH_IMAGE_DELETE_ROW_CLASS_NAME = "rich-image-delete-row";
const RICH_IMAGE_DELETE_LINE_CLASS_NAME = "rich-image-delete-line";
const RICH_IMAGE_DELETE_LINE_ACTIVE_CLASS_NAME = "rich-image-delete-line-active";
const RICH_IMAGE_DRAGGING_CLASS_NAME = "rich-image-dragging";
const RICH_IMAGE_RESIZING_CLASS_NAME = "rich-image-resizing";
const RICH_FILE_DELETE_CONFIRM_CLASS_NAME = "rich-file-delete-confirm";
const RICH_FILE_ZONE_CLASS_NAME = "rich-file-zone";
const RICH_FILE_ROW_CLASS_NAME = "rich-file-row";
const RICH_FILE_LINE_CLASS_NAME = "rich-file-line";
const RICH_FILE_DRAGGING_CLASS_NAME = "rich-file-dragging";
const DEFAULT_RICH_IMAGE_WIDTH = 320;
const MIN_RICH_IMAGE_WIDTH = 92;
const MAX_RICH_IMAGE_WIDTH = 1400;
const MAX_RICH_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
const ACCOUNT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const RICH_IMAGE_EDGE_HIT_SIZE = 12;
const MIN_RICH_IMAGE_DELETE_OVERLAY_WIDTH = 184;
const MIN_RICH_IMAGE_DELETE_OVERLAY_HEIGHT = 124;
const WORKSPACE_UNDO_LIMIT = 40;
const RICH_FILE_CLASS_NAME = "rich-file-link";
const MAX_RICH_FILE_BYTES = 16 * 1024 * 1024;
const EDITOR_INPUT_SYNC_DELAY_MS = 180;

export default function CategoryWorkspace() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [dictionaryGroups, setDictionaryGroups] = useState<DictionaryWordGroup[]>(
    []
  );
  const [messagesByCategory, setMessagesByCategory] = useState<
    Record<string, MessageRow[]>
  >({});
  const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null);
  const [insertionTargetId, setInsertionTargetId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [dragMessageId, setDragMessageId] = useState<string | null>(null);
  const [dragChecklistItem, setDragChecklistItem] = useState<ChecklistDragItem | null>(
    null
  );
  const [dragDictionaryId, setDragDictionaryId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] =
    useState<CategoryFormState>(DEFAULT_CATEGORY_FORM);
  const [messageTitleDraft, setMessageTitleDraft] = useState("");
  const [source, setSource] = useState<DataSource | "unknown">("unknown");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isSavingMessages, setIsSavingMessages] = useState(false);
  const [continuousDraft, setContinuousDraft] = useState("");
  const [continuousChecklists, setContinuousChecklists] = useState<ChecklistBlock[]>(
    []
  );
  const [continuousDictionaries, setContinuousDictionaries] = useState<
    DictionaryBlock[]
  >([]);
  const [continuousSchedules, setContinuousSchedules] = useState<ScheduleBlock[]>(
    []
  );
  const [editorTextScalePercent, setEditorTextScalePercent] = useState(
    DEFAULT_EDITOR_TEXT_SCALE_PERCENT
  );
  const [editorTextScaleInputValue, setEditorTextScaleInputValue] = useState(
    formatEditorTextScalePercent(DEFAULT_EDITOR_TEXT_SCALE_PERCENT)
  );
  const [undoRevision, setUndoRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showDictionaryGlobalSearch, setShowDictionaryGlobalSearch] =
    useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("categories");
  const [showMenu, setShowMenu] = useState(false);
  const [menuPanel, setMenuPanel] = useState<MenuPanel>("main");
  const [accountWindowTab, setAccountWindowTab] =
    useState<AccountWindowTab | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [showCategoryTagSuggestions, setShowCategoryTagSuggestions] =
    useState(false);
  const [showCategoryTagLibrary, setShowCategoryTagLibrary] = useState(false);
  const [showProjectCreateModal, setShowProjectCreateModal] = useState(false);
  const [checklistEditor, setChecklistEditor] =
    useState<ChecklistEditorState | null>(null);
  const [dictionaryEditor, setDictionaryEditor] =
    useState<DictionaryEditorState | null>(null);
  const [scheduleModal, setScheduleModal] = useState<ScheduleModalState | null>(
    null
  );
  const [dictionaryEditorTab, setDictionaryEditorTab] =
    useState<DictionaryEditorTab>("entries");
  const [dictionaryGroupEditor, setDictionaryGroupEditor] =
    useState<DictionaryWordGroup | null>(null);
  const [dictionaryStudy, setDictionaryStudy] =
    useState<DictionaryStudyState | null>(null);
  const [dictionarySimilarPopup, setDictionarySimilarPopup] =
    useState<DictionarySimilarPopupState | null>(null);
  const [dictionaryStudyCardScale, setDictionaryStudyCardScale] = useState(1);
  const [dictionaryImportDraft, setDictionaryImportDraft] = useState("");
  const dictionaryImportPreview = useMemo(
    () =>
      parseDictionaryImportDraft(
        dictionaryImportDraft,
        dictionaryEditor?.columns,
        dictionaryEditor?.labels
      ),
    [dictionaryImportDraft, dictionaryEditor?.columns, dictionaryEditor?.labels]
  );
  const [dictionarySearchQuery, setDictionarySearchQuery] = useState("");
  const [dictionarySearchActiveIndex, setDictionarySearchActiveIndex] =
    useState(0);
  const [dictionaryMobileSearchOpen, setDictionaryMobileSearchOpen] =
    useState(false);
  const [
    dictionarySearchNavigationVersion,
    setDictionarySearchNavigationVersion,
  ] = useState(0);
  const [checklistTagSearchQuery, setChecklistTagSearchQuery] = useState("");
  const [projectTagSearchQuery, setProjectTagSearchQuery] = useState("");
  const [projectTagSelection, setProjectTagSelection] = useState<string[]>([]);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [projectTitleDraftsById, setProjectTitleDraftsById] = useState<
    Record<string, string>
  >({});
  const [activeRichEditor, setActiveRichEditor] = useState<RichEditorScope | null>(
    null
  );
  const [richToolbarState, setRichToolbarState] = useState({
    bold: false,
    italic: false,
    color: DEFAULT_TEXT_COLOR,
  });
  const [customTextColor, setCustomTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [showTextColorPalette, setShowTextColorPalette] = useState(false);
  const [showLinkPlaceholderModal, setShowLinkPlaceholderModal] = useState(false);
  const [linkSelectionPreview, setLinkSelectionPreview] = useState("");
  const [selectedRichImage, setSelectedRichImage] =
    useState<RichImageSelection | null>(null);
  const [activeRichImageDeleteLine, setActiveRichImageDeleteLine] =
    useState<RichImageSelection | null>(null);
  const [richImageDeleteConfirm, setRichImageDeleteConfirm] =
    useState<RichImageSelection | null>(null);
  const [richImageDeleteConfirmRect, setRichImageDeleteConfirmRect] =
    useState<RichImageOverlayRect | null>(null);
  const [richFileDeleteConfirm, setRichFileDeleteConfirm] =
    useState<RichFileSelection | null>(null);
  const [richFileDeleteConfirmRect, setRichFileDeleteConfirmRect] =
    useState<RichImageOverlayRect | null>(null);
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
  const [isUploadingAccountAvatar, setIsUploadingAccountAvatar] = useState(false);
  const [isDeletingAccountAvatar, setIsDeletingAccountAvatar] = useState(false);
  const [motivationImages, setMotivationImages] = useState<AccountImageMeta[]>([]);
  const [isLoadingMotivationImages, setIsLoadingMotivationImages] = useState(false);
  const [isUploadingMotivationImage, setIsUploadingMotivationImage] =
    useState(false);
  const [deletingMotivationImageIds, setDeletingMotivationImageIds] = useState<
    string[]
  >([]);
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
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [friendRequestUserIdDraft, setFriendRequestUserIdDraft] = useState("");
  const [selectedFriendInboxId, setSelectedFriendInboxId] = useState<string | null>(
    null
  );
  const [friendInboxItems, setFriendInboxItems] = useState<
    Record<string, InboxItemRow[]>
  >({});
  const [inboxImportTargetIds, setInboxImportTargetIds] = useState<
    Record<string, string>
  >({});
  const [shareFriendId, setShareFriendId] = useState("");
  const [publicInviteFriendId, setPublicInviteFriendId] = useState("");
  const [publicPanel, setPublicPanel] = useState<PublicCategoryPanel | null>(null);
  const [isSavingFriendAction, setIsSavingFriendAction] = useState(false);
  const [isSavingInboxAction, setIsSavingInboxAction] = useState(false);
  const [isSavingPublicAction, setIsSavingPublicAction] = useState(false);

  const importFileRef = useRef<HTMLInputElement | null>(null);
  const dictionaryImportFileRef = useRef<HTMLInputElement | null>(null);
  const accountAvatarFileRef = useRef<HTMLInputElement | null>(null);
  const motivationImageFileRef = useRef<HTMLInputElement | null>(null);
  const dictionaryStudyCardShellRef = useRef<HTMLDivElement | null>(null);
  const dictionaryStudyCardContentRef = useRef<HTMLDivElement | null>(null);
  const dictionaryStudyCardFitRef = useRef<HTMLDivElement | null>(null);
  const dictionaryStudyWordSlotRef = useRef<HTMLDivElement | null>(null);
  const dictionaryStudyWordValueRef = useRef<HTMLDivElement | null>(null);
  const dictionaryStudyNoteSlotRef = useRef<HTMLDivElement | null>(null);
  const dictionaryStudyNoteValueRef = useRef<HTMLDivElement | null>(null);
  const dictionaryEditorCellRefsRef = useRef<
    Record<string, HTMLTextAreaElement | null>
  >({});
  const dictionarySearchShouldFocusRef = useRef(false);
  const dictionaryAutoSpeechTimerRef = useRef<number | null>(null);
  const dictionaryMotivationTimerRef = useRef<number | null>(null);
  const dictionaryMotivationExitTimerRef = useRef<number | null>(null);
  const dictionaryMotivationEnterFrameRef = useRef<number | null>(null);
  const loadedMotivationImageUrlsRef = useRef<Set<string>>(new Set());
  const readyMotivationImageSrcByUrlRef = useRef<Map<string, string>>(new Map());
  const loadingMotivationImagePromisesRef = useRef<
    Map<string, Promise<string | null>>
  >(new Map());
  const dictionaryMotivationRequestIdRef = useRef(0);
  const dictionaryDoomscrollClickInFlightRef = useRef(false);
  const richImageFileRef = useRef<HTMLInputElement | null>(null);
  const richFileRef = useRef<HTMLInputElement | null>(null);
  const richFileObjectUrlsRef = useRef<Map<string, RichFileObjectUrlCacheEntry>>(
    new Map()
  );
  const categoryTagInputRef = useRef<HTMLInputElement | null>(null);
  const continuousEditorRef = useRef<HTMLDivElement | null>(null);
  const blockEditorRefsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const savedRichSelectionRef = useRef<SavedRichSelection | null>(null);
  const draggedRichImageRef = useRef<DraggedRichImage | null>(null);
  const draggedRichFileRef = useRef<DraggedRichFile | null>(null);
  const richImageResizeStateRef = useRef<RichImageResizeState | null>(null);
  const workspaceUndoStackRef = useRef<WorkspaceUndoEntry[]>([]);
  const isRestoringWorkspaceUndoRef = useRef(false);
  const lastEditorUndoHtmlRef = useRef<Record<string, string>>({});
  const performWorkspaceUndoRef = useRef<() => void | Promise<void>>(() => {
    return;
  });
  const ensureRichImageDeleteLinesRef = useRef<(editor: HTMLDivElement) => void>(() => {
    return;
  });
  const ensureRichFileRowsRef = useRef<(editor: HTMLDivElement) => void>(() => {
    return;
  });
  const deleteRichImageBySelectionRef = useRef<
    (selection: RichImageSelection) => boolean
  >(() => {
    return false;
  });
  const deleteRichFileBySelectionRef = useRef<
    (selection: RichFileSelection) => boolean
  >(() => {
    return false;
  });
  const applyEditorDomValueRef = useRef<
    (scope: RichEditorScope, editor: HTMLDivElement) => void
  >(() => {
    return;
  });
  const rememberRichSelectionRef = useRef<(scope: RichEditorScope) => void>(() => {
    return;
  });
  const syncRichToolbarStateRef = useRef<
    (scope: RichEditorScope | null | undefined) => void
  >(() => {
    return;
  });
  const textColorButtonRef = useRef<HTMLButtonElement | null>(null);
  const textColorPaletteRef = useRef<HTMLDivElement | null>(null);
  const csrfTokenRef = useRef<string | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const currentCategoryIdRef = useRef<string | null>(null);
  const selectedFriendInboxIdRef = useRef<string | null>(null);
  const realtimeHandlersRef = useRef({
    loadFriends: async () => {},
    loadFriendInbox: async (_friendAppUserId: string) => {
      void _friendAppUserId;
    },
    loadProjects: async () => {},
    loadDictionaryGroups: async () => {},
    refreshCategoriesFromServer: async () => {},
    loadCategoryMessages: async (_categoryId: string) => {
      void _categoryId;
    },
    loadCurrentPublicPanel: async (_categoryId: string | null) => {
      void _categoryId;
    },
  });
  const confirmResolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categorySaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );
  const categoryInputSyncTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
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
  const messageInputSyncTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
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
  const pendingDictionarySearchSourceRef =
    useRef<PendingDictionarySearchSource | null>(null);
  const syncedContinuousCategoryIdRef = useRef<string | null>(null);
  const didAutoOpenMobileCategoriesRef = useRef(false);
  const [, startEditorTransition] = useTransition();

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

  const currentCategoryCanEdit = currentCategory?.access_role !== "viewer";
  const currentCategoryCanManagePublic = currentCategory?.access_role === "owner";
  const currentCategoryVisibilityLabel =
    currentCategory?.visibility === "public" ? "public" : "local";

  const insertionTarget = useMemo(
    () => visibleCategoriesById.get(insertionTargetId ?? "") ?? null,
    [visibleCategoriesById, insertionTargetId]
  );
  const insertionTargetCanEdit = insertionTarget?.access_role !== "viewer";

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

    return messagesByCategory[currentCategoryId] ?? [];
  }, [messagesByCategory, currentCategoryId]);

  const selectedMessage = useMemo(
    () => currentMessages.find((message) => message.id === selectedMessageId) ?? null,
    [currentMessages, selectedMessageId]
  );

  const hasEditableBlockMessages = useMemo(
    () =>
      currentMessages.some(
        (message) =>
          typeof message.content === "string" &&
          !isSpecialMessageContent(message.content)
      ),
    [currentMessages]
  );

  const canUseRichToolbar = Boolean(
    currentCategory &&
      currentCategoryCanEdit &&
      !isMutating &&
      !isLoading &&
      !loadError &&
      (currentCategory.format === "continuous" || hasEditableBlockMessages)
  );
  const canAdjustEditorTextScale = Boolean(
    currentCategory &&
      !isLoading &&
      !loadError &&
      (currentCategory.format === "continuous" || hasEditableBlockMessages)
  );
  const canDecreaseEditorTextScale =
    canAdjustEditorTextScale && editorTextScalePercent > MIN_EDITOR_TEXT_SCALE_PERCENT;
  const canIncreaseEditorTextScale =
    canAdjustEditorTextScale && editorTextScalePercent < MAX_EDITOR_TEXT_SCALE_PERCENT;
  const canUndoWorkspace = undoRevision >= 0 && workspaceUndoStackRef.current.length > 0;
  const editorDisplayScale = useMemo(
    () => getEditorDisplayScale(editorTextScalePercent),
    [editorTextScalePercent]
  );
  const editorTextScaleStyle = useMemo(
    () => ({
      fontSize: `${editorTextScalePercent}%`,
    }),
    [editorTextScalePercent]
  );
  const applyRichImageDisplayScaleToEditor = useCallback(
    (editor: HTMLDivElement | null, displayScale: number) => {
      if (!editor) {
        return;
      }

      for (const imageNode of Array.from(
        editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`)
      )) {
        applyRichImageWidth(imageNode, getRichImageBaseWidth(imageNode), displayScale);
      }
    },
    []
  );
  const applyRichImageDisplayScaleToMountedEditors = useCallback(
    (displayScale: number) => {
      applyRichImageDisplayScaleToEditor(continuousEditorRef.current, displayScale);

      for (const editor of Object.values(blockEditorRefsRef.current)) {
        applyRichImageDisplayScaleToEditor(editor, displayScale);
      }
    },
    [applyRichImageDisplayScaleToEditor]
  );

  const sidebarFillerCount = Math.max(0, 8 - childCategories.length);
  const canGoBack = Boolean(
    currentCategory &&
      ((currentCategory.parent_id &&
        visibleCategoriesById.has(currentCategory.parent_id)) ||
        (isProjectMode && projectRootIdSet.has(currentCategory.id)))
  );
  const canCreate = Boolean(
    (Boolean(insertionTargetId) || isProjectMode) && insertionTargetCanEdit
  );
  const canDeleteCategoryNode = (category: CategoryRow | null | undefined) =>
    Boolean(
      category &&
        !isMainRootCategory(category) &&
        (category.access_role === "owner" ||
          (category.access_role === "editor" &&
            category.visibility === "public" &&
            category.public_root_id !== category.id))
    );
  const canDelete = Boolean(insertionTargetId && canDeleteCategoryNode(insertionTarget));
  const isAuthenticated = Boolean(authUser);
  const acceptedFriends = useMemo(
    () => friends.filter((friend) => friend.status === "accepted"),
    [friends]
  );
  const selectedFriendInboxItems = useMemo(
    () => (selectedFriendInboxId ? friendInboxItems[selectedFriendInboxId] ?? [] : []),
    [friendInboxItems, selectedFriendInboxId]
  );
  const localCategoryOptions = useMemo(
    () =>
      categories
        .filter((category) => category.visibility !== "public")
        .map((category) => ({
          id: category.id,
          label: buildCategoryPath(categories, category.id)
            .map((node) => node.title)
            .join(" / "),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru-RU")),
    [categories]
  );
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

  const checklistTagOptions = useMemo(() => {
    if (!checklistEditor) {
      return [];
    }

    const normalized = checklistTagSearchQuery.trim().toLocaleLowerCase();
    return allExistingCategoryTags
      .filter((entry) => {
        if (!normalized) {
          return true;
        }

        return entry.tag.toLocaleLowerCase().includes(normalized);
      })
      .slice(0, 80)
      .map((entry) => entry.tag);
  }, [allExistingCategoryTags, checklistEditor, checklistTagSearchQuery]);

  const checklistTagSelectionKeySet = useMemo(
    () =>
      new Set(
        (checklistEditor?.tagSelection ?? []).map((tag) => tag.toLocaleLowerCase())
      ),
    [checklistEditor]
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
    if (draft && isDisplayImageUrl(draft)) {
      return draft;
    }

    if (accountAvatarUrl && isDisplayImageUrl(accountAvatarUrl)) {
      return accountAvatarUrl;
    }

    return null;
  }, [accountAvatarUrl, accountAvatarUrlDraft]);

  const deferredContinuousChecklists = useDeferredValue(continuousChecklists);
  const deferredChecklistCategories = useDeferredValue(categories);
  const deferredChecklistMessagesByCategory = useDeferredValue(messagesByCategory);

  const continuousChecklistCards = useMemo(() => {
    if (!currentCategory || currentCategory.format !== "continuous") {
      return [] as Array<{
        checklist: ChecklistBlock;
        items: Array<ChecklistCategoryOption & { checked: boolean }>;
      }>;
    }

    return continuousChecklists.map((checklist) => {
      const checkedKeySet = new Set(
        checklist.checkedCategoryIds.map((id) => id.toLocaleLowerCase())
      );
      const items = buildChecklistDisplayItems(
        collectChecklistCategoryOptions(categories, checklist.tags),
        checkedKeySet,
        checklist.orderMode,
        checklist.customOrderCategoryIds
      );

      return {
        checklist,
        items,
      };
    });
  }, [categories, continuousChecklists, currentCategory]);

  const continuousDictionaryCards = useMemo(() => {
    if (!currentCategory || currentCategory.format !== "continuous") {
      return [] as DictionaryBlock[];
    }

    return continuousDictionaries;
  }, [continuousDictionaries, currentCategory]);

  const continuousScheduleCards = useMemo(() => {
    if (!currentCategory || currentCategory.format !== "continuous") {
      return [] as ScheduleBlock[];
    }

    return continuousSchedules;
  }, [continuousSchedules, currentCategory]);

  const blockChecklistCardsByMessageId = useMemo(() => {
    const map = new Map<
      string,
      {
        payload: MessageChecklistPayload;
        items: Array<ChecklistCategoryOption & { checked: boolean }>;
      }
    >();

    if (!currentCategory || currentCategory.format !== "block") {
      return map;
    }

    for (const message of currentMessages) {
      const payload = parseMessageChecklistContent(message.content);
      if (!payload) {
        continue;
      }

      const checkedKeySet = new Set(
        payload.checkedCategoryIds.map((id) => id.toLocaleLowerCase())
      );
      const items = buildChecklistDisplayItems(
        collectChecklistCategoryOptions(categories, payload.tags),
        checkedKeySet,
        payload.orderMode,
        payload.customOrderCategoryIds
      );

      map.set(message.id, {
        payload,
        items,
      });
    }

    return map;
  }, [categories, currentCategory, currentMessages]);

  const blockDictionaryCardsByMessageId = useMemo(() => {
    const map = new Map<
      string,
      {
        payload: MessageDictionaryPayload;
      }
    >();

    if (!currentCategory || currentCategory.format !== "block") {
      return map;
    }

    for (const message of currentMessages) {
      const payload = parseMessageDictionaryContent(message.content);
      if (!payload) {
        continue;
      }

      map.set(message.id, {
        payload,
      });
    }

    return map;
  }, [currentCategory, currentMessages]);

  const blockScheduleCardsByMessageId = useMemo(() => {
    const map = new Map<
      string,
      {
        payload: SchedulePayload;
      }
    >();

    if (!currentCategory || currentCategory.format !== "block") {
      return map;
    }

    for (const message of currentMessages) {
      const payload = parseMessageScheduleContent(message.content);
      if (!payload) {
        continue;
      }

      map.set(message.id, {
        payload,
      });
    }

    return map;
  }, [currentCategory, currentMessages]);

  const checklistParticipation = useMemo(() => {
    if (!currentCategory) {
      return [] as ChecklistParticipationEntry[];
    }

    const currentCategoryKey = currentCategory.id.toLocaleLowerCase();
    const entries: ChecklistParticipationEntry[] = [];

    for (const sourceCategory of deferredChecklistCategories) {
      if (sourceCategory.format === "continuous") {
        const sourceChecklists =
          currentCategory.id === sourceCategory.id && currentCategory.format === "continuous"
            ? deferredContinuousChecklists
            : parseContinuousChecklists(sourceCategory.content);

        for (const checklist of sourceChecklists) {
          if (!categoryMatchesChecklistTags(currentCategory, checklist.tags)) {
            continue;
          }

          entries.push({
            source: "continuous",
            sourceCategoryId: sourceCategory.id,
            sourceCategoryTitle: sourceCategory.title,
            sourceMessageId: null,
            checklistId: checklist.id,
            checklistTitle: checklist.title,
            tags: checklist.tags,
            checked: checklist.checkedCategoryIds.some(
              (id) => id.toLocaleLowerCase() === currentCategoryKey
            ),
          });
        }
      }

      const sourceMessages = deferredChecklistMessagesByCategory[sourceCategory.id] ?? [];
      for (const message of sourceMessages) {
        const checklistPayload = parseMessageChecklistContent(message.content);
        if (!checklistPayload) {
          continue;
        }

        if (!categoryMatchesChecklistTags(currentCategory, checklistPayload.tags)) {
          continue;
        }

        entries.push({
          source: "block-message",
          sourceCategoryId: sourceCategory.id,
          sourceCategoryTitle: sourceCategory.title,
          sourceMessageId: message.id,
          checklistId: message.id,
          checklistTitle: message.title,
          tags: checklistPayload.tags,
          checked: checklistPayload.checkedCategoryIds.some(
            (id) => id.toLocaleLowerCase() === currentCategoryKey
          ),
        });
      }
    }

    return entries.sort((left, right) => {
      if (left.checklistTitle !== right.checklistTitle) {
        return left.checklistTitle.localeCompare(right.checklistTitle, "ru-RU");
      }

      if (left.sourceCategoryTitle !== right.sourceCategoryTitle) {
        return left.sourceCategoryTitle.localeCompare(right.sourceCategoryTitle, "ru-RU");
      }

      return left.sourceCategoryId.localeCompare(right.sourceCategoryId);
    });
  }, [
    deferredChecklistCategories,
    deferredContinuousChecklists,
    deferredChecklistMessagesByCategory,
    currentCategory,
  ]);

  const dictionarySearchMatches = useMemo(() => {
    if (!dictionaryEditor) {
      return [] as DictionaryEditorSearchMatch[];
    }

    const query = dictionarySearchQuery.trim();
    if (!query) {
      return [] as DictionaryEditorSearchMatch[];
    }

    const compiledQuery = compileDictionarySearchQuery(query);
    if (!compiledQuery) {
      return [] as DictionaryEditorSearchMatch[];
    }

    const matches: DictionaryEditorSearchMatch[] = [];

    for (const entry of dictionaryEditor.entries) {
      for (const column of dictionaryEditor.columns) {
        const field = column.id;
        const match = findDictionaryEditorSearchMatch(
          getDictionaryEntryFieldText(entry, field),
          compiledQuery
        );

        if (!match) {
          continue;
        }

        matches.push({
          entryId: entry.id,
          field,
          start: match.start,
          end: match.end,
          isFuzzy: match.isFuzzy,
        });
      }
    }

    return matches;
  }, [dictionaryEditor, dictionarySearchQuery]);

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
    pendingDictionarySearchSourceRef.current = null;
    syncedContinuousCategoryIdRef.current = null;
    savedRichSelectionRef.current = null;
    draggedRichImageRef.current = null;
    draggedRichFileRef.current = null;
    revokeRichFileObjectUrlCache(richFileObjectUrlsRef.current);
    richImageResizeStateRef.current = null;
    blockEditorRefsRef.current = {};

    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
      confirmResolverRef.current = null;
    }

    setCategories([]);
    setProjects([]);
    setDictionaryGroups([]);
    setMessagesByCategory({});
    setCurrentCategoryId(null);
    setInsertionTargetId(null);
    setActiveProjectId(null);
    setSelectedMessageId(null);
    setDragChecklistItem(null);
    setDragDictionaryId(null);
    setShowSearch(false);
    setShowDictionaryGlobalSearch(false);
    setSidebarTab("categories");
    setShowMenu(false);
    setAccountWindowTab(null);
    setMobilePanel(null);
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
    setContinuousChecklists([]);
    setContinuousDictionaries([]);
    setContinuousSchedules([]);
    setScheduleModal(null);
    setActiveRichEditor(null);
    setRichToolbarState({
      bold: false,
      italic: false,
      color: DEFAULT_TEXT_COLOR,
    });
    setCustomTextColor(DEFAULT_TEXT_COLOR);
    setShowTextColorPalette(false);
    setShowLinkPlaceholderModal(false);
    setLinkSelectionPreview("");
    setSelectedRichImage(null);
    setRichImageDeleteConfirm(null);
    setRichImageDeleteConfirmRect(null);
    setRichFileDeleteConfirm(null);
    setRichFileDeleteConfirmRect(null);
    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryGroupEditor(null);
    setDictionaryStudy(null);
    setDictionarySimilarPopup(null);
    setChecklistTagSearchQuery("");
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
    setIsUploadingAccountAvatar(false);
    setIsDeletingAccountAvatar(false);
    setMotivationImages([]);
    for (const readySrc of readyMotivationImageSrcByUrlRef.current.values()) {
      if (typeof window !== "undefined" && readySrc.startsWith("blob:")) {
        window.URL.revokeObjectURL(readySrc);
      }
    }
    readyMotivationImageSrcByUrlRef.current.clear();
    loadedMotivationImageUrlsRef.current.clear();
    loadingMotivationImagePromisesRef.current.clear();
    dictionaryMotivationRequestIdRef.current += 1;
    setIsLoadingMotivationImages(false);
    setIsUploadingMotivationImage(false);
    setDeletingMotivationImageIds([]);
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
    setFriends([]);
    setFriendRequestUserIdDraft("");
    setSelectedFriendInboxId(null);
    setFriendInboxItems({});
    setInboxImportTargetIds({});
    setShareFriendId("");
    setPublicInviteFriendId("");
    setPublicPanel(null);
    setIsSavingFriendAction(false);
    setIsSavingInboxAction(false);
    setIsSavingPublicAction(false);
    setMenuPanel("main");
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

  const getClientId = useCallback(() => {
    if (!clientIdRef.current) {
      clientIdRef.current =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    return clientIdRef.current;
  }, []);

  const fetchWithCsrf = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? undefined);
      headers.set("x-client-id", getClientId());

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
    [ensureCsrfToken, getClientId]
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

  void loadAuthSession;

  const loadWorkspaceBootstrap = useCallback(async (): Promise<boolean> => {
    setIsAuthReady(false);
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/workspace/bootstrap", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as WorkspaceBootstrapPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Unable to bootstrap workspace.");
      }

      if (!payload.data.authUser) {
        setAuthUser(null);
        resetWorkspaceState();
        setAuthError(null);
        return true;
      }

      const rows = (payload.data.categories ?? []).map(normalizeCategoryRow);
      const initialId =
        payload.data.initialCategoryId ?? getInitialCategoryId(rows) ?? rows[0]?.id ?? null;
      const initialMessages = (payload.data.initialMessages ?? [])
        .map(normalizeMessageRow)
        .sort(sortMessages);

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
      pendingDictionarySearchSourceRef.current = null;
      syncedContinuousCategoryIdRef.current = null;
      draggedRichImageRef.current = null;
      draggedRichFileRef.current = null;
      richImageResizeStateRef.current = null;
      savedRichSelectionRef.current = null;

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

      const savedMessageMap: Record<string, string> = {};
      const messageDraftMap: Record<string, number> = {};
      const messageAckMap: Record<string, number> = {};
      for (const row of initialMessages) {
        savedMessageMap[row.id] = row.content;
        messageDraftMap[row.id] = 0;
        messageAckMap[row.id] = 0;
      }
      savedMessageContentRef.current = savedMessageMap;
      messageDraftVersionRef.current = messageDraftMap;
      messageAckVersionRef.current = messageAckMap;

      setAuthUser({
        id: payload.data.authUser.id,
        email: payload.data.authUser.email,
      });
      setAuthError(null);
      setCategories(rows);
      setProjects((payload.data.projects ?? []).map(normalizeProjectRow));
      setDictionaryGroups(
        (payload.data.dictionaryGroups ?? []).map(normalizeDictionaryWordGroup)
      );
      setFriends(payload.data.friends ?? []);
      setCurrentCategoryId(initialId);
      setInsertionTargetId(initialId);
      setSelectedMessageId(null);
      setSelectedRichImage(null);
      setRichImageDeleteConfirm(null);
      setRichImageDeleteConfirmRect(null);
      setRichFileDeleteConfirm(null);
      setRichFileDeleteConfirmRect(null);
      setMessagesByCategory(initialId ? { [initialId]: initialMessages } : {});
      setPublicPanel(payload.data.publicPanel ?? null);
      setSource(payload.source ?? "unknown");

      if (payload.data.account) {
        setAccountUserId(payload.data.account.userId ?? null);
        setAccountUserIdDraft(payload.data.account.userId ?? "");
        setAccountNicknameDraft(payload.data.account.nickname);
        setAccountProfileDescriptionDraft(payload.data.account.profileDescription);
        setAccountAvatarUrlDraft(payload.data.account.avatarUrl ?? "");
        setAccountAvatarUrl(payload.data.account.avatarUrl ?? null);
        setAccountCanChangeUserIdNow(
          Boolean(payload.data.account.canChangeUserIdNow)
        );
        setAccountNextUserIdChangeAt(
          payload.data.account.nextUserIdChangeAt ?? null
        );
        setActiveMigrationCodeMeta(
          payload.data.account.activeMigrationCode ?? null
        );
      }

      setIsSavingCategory(false);
      setIsSavingMessages(false);
      return true;
    } catch (error) {
      const message = toErrorMessage(error, "Unable to bootstrap workspace.");
      setAuthUser(null);
      setLoadError(message);
      setAuthError(message);
      return false;
    } finally {
      setIsLoading(false);
      setIsAuthReady(true);
    }
  }, [resetWorkspaceState]);

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
      pendingDictionarySearchSourceRef.current = null;
      syncedContinuousCategoryIdRef.current = null;
      draggedRichImageRef.current = null;
      draggedRichFileRef.current = null;
      richImageResizeStateRef.current = null;
      savedRichSelectionRef.current = null;

      setCategories(rows);
      setCurrentCategoryId(initialId);
      setInsertionTargetId(initialId);
      setSelectedMessageId(null);
      setSelectedRichImage(null);
      setRichImageDeleteConfirm(null);
      setRichImageDeleteConfirmRect(null);
      setRichFileDeleteConfirm(null);
      setRichFileDeleteConfirmRect(null);
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

  const refreshCategoriesFromServer = useCallback(async () => {
    try {
      const response = await authorizedFetch("/api/categories", { cache: "no-store" });
      const payload = (await response.json()) as CategoriesPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось обновить категории.");
      }

      const rows = payload.data.map(normalizeCategoryRow);
      const hasPendingDraft = (categoryId: string) => {
        const draftVersion = categoryDraftVersionRef.current[categoryId] ?? 0;
        const ackVersion = categoryAckVersionRef.current[categoryId] ?? 0;

        return (
          draftVersion > ackVersion ||
          Boolean(categorySaveTimersRef.current[categoryId]) ||
          Boolean(categorySaveInFlightRef.current[categoryId]) ||
          Boolean(pendingCategorySaveRef.current[categoryId])
        );
      };

      setCategories((prev) => {
        const localById = new Map(prev.map((category) => [category.id, category]));
        return rows.map((row) => {
          const local = localById.get(row.id);
          if (!local || !hasPendingDraft(row.id)) {
            return row;
          }

          return {
            ...row,
            content: local.content,
            updated_at: local.updated_at,
          };
        });
      });

      for (const row of rows) {
        if (!hasPendingDraft(row.id)) {
          savedCategoryContentRef.current[row.id] = row.content;
        }

        if (typeof categoryDraftVersionRef.current[row.id] !== "number") {
          categoryDraftVersionRef.current[row.id] = 0;
        }
        if (typeof categoryAckVersionRef.current[row.id] !== "number") {
          categoryAckVersionRef.current[row.id] = 0;
        }
      }

      setSource((prev) => payload.source ?? prev);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось обновить категории."), "error");
    }
  }, [authorizedFetch, pushNotice]);

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

  const loadDictionaryGroups = useCallback(async () => {
    try {
      const response = await authorizedFetch("/api/dictionary-groups", {
        cache: "no-store",
      });
      const payload = (await response.json()) as DictionaryGroupsPayload;
      if (!response.ok || !payload.data) {
        throw new Error(
          payload.error ?? "Не удалось загрузить группы словарей."
        );
      }

      const groups = payload.data.map(normalizeDictionaryWordGroup);
      setDictionaryGroups(groups);
      setDictionaryGroupEditor((prev) =>
        prev
          ? groups.find((group) => group.id === prev.id) ?? null
          : null
      );
      setSource((prev) => payload.source ?? prev);
    } catch (error) {
      pushNotice(
        toErrorMessage(error, "Не удалось загрузить группы словарей."),
        "error"
      );
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

  void loadAccountProfile;

  function revokeMotivationImageObjectUrl(src: string) {
    if (typeof window !== "undefined" && src.startsWith("blob:")) {
      window.URL.revokeObjectURL(src);
    }
  }

  function releaseMotivationImageMemoryCache(url: string) {
    const readySrc = readyMotivationImageSrcByUrlRef.current.get(url);
    if (readySrc) {
      revokeMotivationImageObjectUrl(readySrc);
    }
    readyMotivationImageSrcByUrlRef.current.delete(url);
    loadedMotivationImageUrlsRef.current.delete(url);
    loadingMotivationImagePromisesRef.current.delete(url);
  }

  const decodeMotivationImageSrc = useCallback((src: string) => {
    if (typeof window === "undefined" || !src) {
      return Promise.resolve(false);
    }

    const preloadImage = new window.Image();
    preloadImage.decoding = "async";

    return new Promise<boolean>((resolve) => {
      let isSettled = false;
      const settle = (isLoaded: boolean) => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        resolve(isLoaded);
      };

      preloadImage.onload = () => {
        void preloadImage
          .decode()
          .then(() => settle(true))
          .catch(() => settle(true));
      };
      preloadImage.onerror = () => settle(false);
      preloadImage.src = src;
    });
  }, []);

  const ensureMotivationImageLoaded = useCallback(async (url: string) => {
    if (typeof window === "undefined" || !url) {
      return null;
    }

    const readySrc = readyMotivationImageSrcByUrlRef.current.get(url);
    if (readySrc) {
      return readySrc;
    }

    const pendingLoad = loadingMotivationImagePromisesRef.current.get(url);
    if (pendingLoad) {
      return pendingLoad;
    }

    const loadPromise = (async () => {
      let objectUrl: string | null = null;
      try {
        const response = await authorizedFetch(url, {
          cache: "force-cache",
        });
        if (response.ok) {
          const blob = await response.blob();
          objectUrl = window.URL.createObjectURL(blob);
          const isBlobDecoded = await decodeMotivationImageSrc(objectUrl);
          if (isBlobDecoded) {
            readyMotivationImageSrcByUrlRef.current.set(url, objectUrl);
            loadedMotivationImageUrlsRef.current.add(url);
            return objectUrl;
          }
        }
      } catch {
        // Fall back to the regular browser image cache below.
      }

      if (objectUrl) {
        revokeMotivationImageObjectUrl(objectUrl);
      }

      const isOriginalDecoded = await decodeMotivationImageSrc(url);
      if (isOriginalDecoded) {
        readyMotivationImageSrcByUrlRef.current.set(url, url);
        loadedMotivationImageUrlsRef.current.add(url);
        return url;
      }

      return null;
    })().finally(() => {
      loadingMotivationImagePromisesRef.current.delete(url);
    });

    loadingMotivationImagePromisesRef.current.set(url, loadPromise);
    return loadPromise;
  }, [authorizedFetch, decodeMotivationImageSrc]);

  const preloadMotivationImages = useCallback(
    (images: AccountImageMeta[]) => {
      if (typeof window === "undefined") {
        return;
      }

      for (const image of images) {
        if (!image.url) {
          continue;
        }

        void ensureMotivationImageLoaded(image.url);
      }
    },
    [ensureMotivationImageLoaded]
  );

  const loadFriends = useCallback(async () => {
    try {
      const response = await authorizedFetch("/api/friends", { cache: "no-store" });
      const payload = (await response.json()) as FriendsPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось загрузить друзей.");
      }

      setFriends(payload.data);
      setSource((prev) => payload.source ?? prev);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось загрузить друзей."), "error");
    }
  }, [authorizedFetch, pushNotice]);

  const loadMotivationImages = useCallback(async () => {
    setIsLoadingMotivationImages(true);
    try {
      const response = await authorizedFetch("/api/account/motivation-images", {
        cache: "no-store",
      });
      const payload = (await response.json()) as AccountImagesPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось загрузить мотивационные фото.");
      }

      setSource((prev) => payload.source ?? prev);
      const nextUrls = new Set(
        payload.data
          .map((image) => image.url)
          .filter((url): url is string => Boolean(url))
      );
      for (const cachedUrl of readyMotivationImageSrcByUrlRef.current.keys()) {
        if (!nextUrls.has(cachedUrl)) {
          const readySrc = readyMotivationImageSrcByUrlRef.current.get(cachedUrl);
          if (readySrc && readySrc.startsWith("blob:")) {
            window.URL.revokeObjectURL(readySrc);
          }
          readyMotivationImageSrcByUrlRef.current.delete(cachedUrl);
          loadedMotivationImageUrlsRef.current.delete(cachedUrl);
          loadingMotivationImagePromisesRef.current.delete(cachedUrl);
        }
      }
      setMotivationImages(payload.data);
      preloadMotivationImages(payload.data);
    } catch (error) {
      pushNotice(
        toErrorMessage(error, "Не удалось загрузить мотивационные фото."),
        "error"
      );
    } finally {
      setIsLoadingMotivationImages(false);
    }
  }, [authorizedFetch, preloadMotivationImages, pushNotice]);

  useEffect(() => {
    if (!dictionaryStudy?.motivateOnCorrect && !dictionaryStudy?.adhdMode) {
      return;
    }

    preloadMotivationImages(motivationImages);
  }, [
    dictionaryStudy?.adhdMode,
    dictionaryStudy?.motivateOnCorrect,
    motivationImages,
    preloadMotivationImages,
  ]);

  const loadFriendInbox = useCallback(
    async (friendAppUserId: string) => {
      try {
        const response = await authorizedFetch(
          `/api/friends/${friendAppUserId}/inbox`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as InboxPayload;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Не удалось загрузить inbox.");
        }

        setFriendInboxItems((prev) => ({
          ...prev,
          [friendAppUserId]: payload.data ?? [],
        }));
        setSource((prev) => payload.source ?? prev);
      } catch (error) {
        pushNotice(toErrorMessage(error, "Не удалось загрузить inbox."), "error");
      }
    },
    [authorizedFetch, pushNotice]
  );

  const loadCurrentPublicPanel = useCallback(
    async (categoryId: string | null) => {
      if (!categoryId) {
        setPublicPanel(null);
        return;
      }

      try {
        const response = await authorizedFetch(`/api/categories/${categoryId}/public`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as PublicPanelPayload;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Не удалось загрузить public-настройки.");
        }

        setPublicPanel(payload.data);
        setSource((prev) => payload.source ?? prev);
      } catch (error) {
        setPublicPanel(null);
        pushNotice(toErrorMessage(error, "Не удалось загрузить public-настройки."), "error");
      }
    },
    [authorizedFetch, pushNotice]
  );

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

  useLayoutEffect(() => {
    void loadWorkspaceBootstrap();
  }, [loadWorkspaceBootstrap]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void loadCurrentPublicPanel(currentCategoryId);
  }, [currentCategoryId, isAuthenticated, loadCurrentPublicPanel]);

  useEffect(() => {
    currentCategoryIdRef.current = currentCategoryId;
  }, [currentCategoryId]);

  useEffect(() => {
    selectedFriendInboxIdRef.current = selectedFriendInboxId;
  }, [selectedFriendInboxId]);

  useEffect(() => {
    realtimeHandlersRef.current = {
      loadFriends,
      loadFriendInbox,
      loadProjects,
      loadDictionaryGroups,
      refreshCategoriesFromServer,
      loadCategoryMessages,
      loadCurrentPublicPanel,
    };
  }, [
    loadCategoryMessages,
    loadCurrentPublicPanel,
    loadDictionaryGroups,
    loadFriendInbox,
    loadFriends,
    loadProjects,
    refreshCategoriesFromServer,
  ]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let eventSource: EventSource | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const closeEventSource = () => {
      eventSource?.close();
      eventSource = null;
    };

    const handleItemKeyEvent = (event: Event) => {
      let payload: {
        kind?: string;
        categoryIds?: string[];
      };

      try {
        payload = JSON.parse((event as MessageEvent).data) as {
          kind?: string;
          categoryIds?: string[];
        };
      } catch {
        return;
      }

      if (payload.kind === "friends" || payload.kind === "inbox") {
        void realtimeHandlersRef.current.loadFriends();
        const selectedInboxId = selectedFriendInboxIdRef.current;
        if (selectedInboxId) {
          void realtimeHandlersRef.current.loadFriendInbox(selectedInboxId);
        }
      }

      if (
        payload.kind === "workspace" ||
        payload.kind === "messages" ||
        payload.kind === "public"
      ) {
        void realtimeHandlersRef.current.refreshCategoriesFromServer();
        void realtimeHandlersRef.current.loadProjects();
        void realtimeHandlersRef.current.loadDictionaryGroups();
        const activeCategoryId = currentCategoryIdRef.current;
        if (activeCategoryId) {
          void realtimeHandlersRef.current.loadCategoryMessages(activeCategoryId);
          void realtimeHandlersRef.current.loadCurrentPublicPanel(activeCategoryId);
        }
      }
    };

    const scheduleReconnect = () => {
      if (stopped || document.visibilityState === "hidden") {
        return;
      }

      closeEventSource();
      const delay = Math.min(30000, 1000 * 2 ** reconnectAttempt);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      clearReconnectTimer();
      reconnectTimer = setTimeout(connect, delay);
    };

    function connect() {
      if (stopped || document.visibilityState === "hidden" || eventSource) {
        return;
      }

      eventSource = new EventSource(
        `/api/sync/events?clientId=${encodeURIComponent(getClientId())}`
      );
      eventSource.addEventListener("open", () => {
        reconnectAttempt = 0;
      });
      eventSource.addEventListener("itemkey", handleItemKeyEvent);
      eventSource.onerror = scheduleReconnect;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearReconnectTimer();
        closeEventSource();
        return;
      }

      reconnectAttempt = 0;
      connect();
    };

    const startTimer = setTimeout(connect, 650);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      clearTimeout(startTimer);
      clearReconnectTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      closeEventSource();
    };
  }, [getClientId, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void loadMotivationImages();
  }, [isAuthenticated, loadMotivationImages]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const refreshCollaboration = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void loadFriends();
      const selectedInboxId = selectedFriendInboxIdRef.current;
      if (selectedInboxId) {
        void loadFriendInbox(selectedInboxId);
      }
    };

    if (accountWindowTab === "friends") {
      refreshCollaboration();
    }

    const interval = window.setInterval(
      refreshCollaboration,
      accountWindowTab === "friends" ? 2500 : 8000
    );

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshCollaboration();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [accountWindowTab, isAuthenticated, loadFriendInbox, loadFriends]);

  useEffect(() => {
    if (!isAuthenticated || !currentCategoryId) {
      return;
    }

    void loadCategoryMessages(currentCategoryId);
  }, [currentCategoryId, isAuthenticated, loadCategoryMessages]);

  useEffect(() => {
    if (
      didAutoOpenMobileCategoriesRef.current ||
      !isAuthenticated ||
      isLoading ||
      loadError ||
      visibleCategories.length === 0 ||
      typeof window === "undefined" ||
      !window.matchMedia("(max-width: 900px)").matches
    ) {
      return;
    }

    didAutoOpenMobileCategoriesRef.current = true;
    setShowMenu(false);
    setMobilePanel((currentPanel) => currentPanel ?? "categories");
  }, [isAuthenticated, isLoading, loadError, visibleCategories.length]);

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
    if (!dictionarySearchQuery.trim() || dictionarySearchMatches.length === 0) {
      if (dictionarySearchActiveIndex !== 0) {
        setDictionarySearchActiveIndex(0);
      }
      return;
    }

    if (dictionarySearchActiveIndex >= dictionarySearchMatches.length) {
      setDictionarySearchActiveIndex(dictionarySearchMatches.length - 1);
    }
  }, [
    dictionarySearchActiveIndex,
    dictionarySearchMatches.length,
    dictionarySearchQuery,
  ]);

  useEffect(() => {
    if (!dictionarySearchShouldFocusRef.current) {
      return;
    }

    if (dictionaryEditorTab !== "entries") {
      return;
    }

    const activeMatch = dictionarySearchMatches[dictionarySearchActiveIndex];
    if (!activeMatch) {
      return;
    }

    const cellKey = makeDictionaryEditorCellKey(
      activeMatch.entryId,
      activeMatch.field
    );
    const textarea = dictionaryEditorCellRefsRef.current[cellKey];
    if (!textarea) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(activeMatch.start, activeMatch.end);
      textarea.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "smooth",
      });
      dictionarySearchShouldFocusRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    dictionaryEditorTab,
    dictionarySearchActiveIndex,
    dictionarySearchMatches,
    dictionarySearchNavigationVersion,
  ]);

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
      setContinuousChecklists([]);
      setContinuousDictionaries([]);
      setContinuousSchedules([]);
      return;
    }

    if (syncedContinuousCategoryIdRef.current === currentCategory.id) {
      return;
    }

    syncedContinuousCategoryIdRef.current = currentCategory.id;
    const parsedContinuous = parseContinuousContent(currentCategory.content);
    setContinuousDraft(parsedContinuous.text);
    setContinuousChecklists(parsedContinuous.checklists);
    setContinuousDictionaries(parsedContinuous.dictionaries);
    setContinuousSchedules(parsedContinuous.schedules);
  }, [currentCategory]);

  useEffect(() => {
    const pending = pendingDictionarySearchSourceRef.current;
    if (!pending || currentCategory?.id !== pending.sourceCategoryId) {
      return;
    }

    if (pending.dictionaryId) {
      if (currentCategory.format !== "continuous") {
        pendingDictionarySearchSourceRef.current = null;
        pushNotice("Источник #DICT больше не является сплошной категорией.", "warn");
        return;
      }

      const exists = continuousDictionaries.some(
        (dictionary) => dictionary.id === pending.dictionaryId
      );
      if (!exists) {
        return;
      }

      pendingDictionarySearchSourceRef.current = null;
      setChecklistEditor(null);
      setChecklistTagSearchQuery("");
      setDictionaryStudy(null);
      setDictionaryImportDraft("");
      dictionarySearchShouldFocusRef.current = false;
      setDictionarySearchQuery("");
      setDictionarySearchActiveIndex(0);
      setDictionaryMobileSearchOpen(false);
      setDictionaryEditorTab("entries");
      const dictionary = continuousDictionaries.find(
        (item) => item.id === pending.dictionaryId
      );
      if (!dictionary) {
        return;
      }
      setDictionaryEditor({
        source: "continuous",
        sourceCategoryId: currentCategory.id,
        sourceMessageId: null,
        dictionaryId: dictionary.id,
        titleDraft: dictionary.title,
        descriptionDraft: dictionary.description,
        tagsDraft: serializeDictionaryTags(dictionary.tags),
        promptSide: dictionary.promptSide,
        shuffle: dictionary.shuffle,
        autoSpeak: dictionary.autoSpeak,
        autoSpeakFields: normalizeDictionaryAutoSpeakFields(
          dictionary.autoSpeakFields,
          getDefaultDictionaryAutoSpeakFields(dictionary.columns),
          dictionary.columns
        ),
        manualSpeakFields: normalizeDictionaryManualSpeakFields(
          dictionary.manualSpeakFields,
          getDefaultDictionaryManualSpeakFields(dictionary.columns),
          dictionary.columns
        ),
        noteDisplayMode: dictionary.noteDisplayMode,
        progressMode: dictionary.progressMode,
        motivateOnCorrect: dictionary.motivateOnCorrect,
        cardMode: dictionary.cardMode,
        adhdMode: dictionary.adhdMode,
        motivationAdvanceMode: dictionary.motivationAdvanceMode,
        motivationAutoSeconds: dictionary.motivationAutoSeconds,
        labels: normalizeDictionaryLabels(dictionary.labels, dictionary.columns),
        columns: dictionary.columns,
        entries: makeDictionaryEditorEntries(dictionary),
      });
      return;
    }

    if (!pending.sourceMessageId) {
      pendingDictionarySearchSourceRef.current = null;
      return;
    }

    const message = (messagesByCategory[pending.sourceCategoryId] ?? []).find(
      (item) => item.id === pending.sourceMessageId
    );
    if (!message) {
      return;
    }

    const payload = parseMessageDictionaryContent(message.content);
    if (!payload) {
      pendingDictionarySearchSourceRef.current = null;
      pushNotice("Источник #DICT больше не найден.", "warn");
      return;
    }

    pendingDictionarySearchSourceRef.current = null;
    setChecklistEditor(null);
    setChecklistTagSearchQuery("");
    setScheduleModal(null);
    setDictionaryStudy(null);
    setDictionaryImportDraft("");
    dictionarySearchShouldFocusRef.current = false;
    setDictionarySearchQuery("");
    setDictionarySearchActiveIndex(0);
    setDictionaryMobileSearchOpen(false);
    setDictionaryEditorTab("entries");
    setSelectedMessageId(message.id);
    setDictionaryEditor({
      source: "block-message",
      sourceCategoryId: pending.sourceCategoryId,
      sourceMessageId: message.id,
      dictionaryId: null,
      titleDraft: message.title,
      descriptionDraft: payload.description,
      tagsDraft: serializeDictionaryTags(payload.tags),
      promptSide: payload.promptSide,
      shuffle: payload.shuffle,
      autoSpeak: payload.autoSpeak,
      autoSpeakFields: normalizeDictionaryAutoSpeakFields(
        payload.autoSpeakFields,
        getDefaultDictionaryAutoSpeakFields(payload.columns),
        payload.columns
      ),
      manualSpeakFields: normalizeDictionaryManualSpeakFields(
        payload.manualSpeakFields,
        getDefaultDictionaryManualSpeakFields(payload.columns),
        payload.columns
      ),
      noteDisplayMode: payload.noteDisplayMode,
      progressMode: payload.progressMode,
      motivateOnCorrect: payload.motivateOnCorrect,
      cardMode: payload.cardMode,
      adhdMode: payload.adhdMode,
      motivationAdvanceMode: payload.motivationAdvanceMode,
      motivationAutoSeconds: payload.motivationAutoSeconds,
      labels: normalizeDictionaryLabels(payload.labels, payload.columns),
      columns: payload.columns,
      entries: makeDictionaryEditorEntries(payload),
    });
  }, [currentCategory, continuousDictionaries, messagesByCategory, pushNotice]);

  useEffect(() => {
    if (currentCategory?.format !== "block" && selectedMessageId) {
      setSelectedMessageId(null);
    }
  }, [currentCategory?.format, selectedMessageId]);

  useEffect(() => {
    if (!activeRichEditor) {
      return;
    }

    if (activeRichEditor.kind === "continuous") {
      if (currentCategory?.format === "continuous") {
        return;
      }

      setActiveRichEditor(null);
      savedRichSelectionRef.current = null;
      return;
    }

    const stillExists = currentMessages.some(
      (message) =>
        message.id === activeRichEditor.messageId &&
        !isSpecialMessageContent(message.content)
    );

    if (!stillExists) {
      setActiveRichEditor(null);
      savedRichSelectionRef.current = null;
    }
  }, [activeRichEditor, currentCategory?.format, currentMessages]);

  useEffect(() => {
    if (!canUseRichToolbar) {
      setShowTextColorPalette(false);
      return;
    }

    if (showLinkPlaceholderModal && !activeRichEditor) {
      setShowLinkPlaceholderModal(false);
      setLinkSelectionPreview("");
    }
  }, [activeRichEditor, canUseRichToolbar, showLinkPlaceholderModal]);

  useEffect(() => {
    if (!showTextColorPalette) {
      return;
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      const button = textColorButtonRef.current;
      const panel = textColorPaletteRef.current;
      if (button?.contains(target) || panel?.contains(target)) {
        return;
      }

      setShowTextColorPalette(false);
    }

    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showTextColorPalette]);

  useEffect(() => {
    if (!selectedRichImage) {
      setActiveRichImageDeleteLine(null);
    }
  }, [selectedRichImage]);

  useEffect(() => {
    const editors: HTMLDivElement[] = [];
    if (continuousEditorRef.current) {
      editors.push(continuousEditorRef.current);
    }
    for (const editor of Object.values(blockEditorRefsRef.current)) {
      if (editor) {
        editors.push(editor);
      }
    }

    for (const editor of editors) {
      ensureRichImageDeleteLinesRef.current(editor);
      ensureRichFileRowsRef.current(editor);

      for (const node of Array.from(
        editor.querySelectorAll<HTMLElement>(
          [
            `.${RICH_IMAGE_CLASS_NAME}.${RICH_IMAGE_SELECTED_CLASS_NAME}`,
            `.${RICH_IMAGE_CLASS_NAME}.${RICH_IMAGE_DELETE_CONFIRM_CLASS_NAME}`,
            `.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}.${RICH_IMAGE_DELETE_LINE_ACTIVE_CLASS_NAME}`,
            `.${RICH_FILE_CLASS_NAME}.${RICH_FILE_DELETE_CONFIRM_CLASS_NAME}`,
            `.${RICH_FILE_CLASS_NAME}.${RICH_FILE_DRAGGING_CLASS_NAME}`,
            `.${RICH_FILE_ROW_CLASS_NAME}.${RICH_FILE_DRAGGING_CLASS_NAME}`,
          ].join(",")
        )
      )) {
        node.classList.remove(RICH_IMAGE_SELECTED_CLASS_NAME);
        node.classList.remove(RICH_IMAGE_DELETE_CONFIRM_CLASS_NAME);
        node.classList.remove(RICH_IMAGE_DELETE_LINE_ACTIVE_CLASS_NAME);
        node.classList.remove(RICH_FILE_DELETE_CONFIRM_CLASS_NAME);
        node.classList.remove(RICH_FILE_DRAGGING_CLASS_NAME);
      }
    }

    if (selectedRichImage) {
      const editor = getEditorElement(selectedRichImage.scope);
      if (!editor) {
        setSelectedRichImage(null);
      } else {
        const imageNode = getRichImageElementById(editor, selectedRichImage.imageId);
        if (!imageNode) {
          setSelectedRichImage(null);
        } else {
          imageNode.classList.add(RICH_IMAGE_SELECTED_CLASS_NAME);
        }
      }
    }

    if (activeRichImageDeleteLine) {
      const deleteLineEditor = getEditorElement(activeRichImageDeleteLine.scope);
      if (!deleteLineEditor) {
        setActiveRichImageDeleteLine(null);
      } else {
        const deleteLineNode = getRichImageDeleteLineElementById(
          deleteLineEditor,
          activeRichImageDeleteLine.imageId
        );
        if (!deleteLineNode) {
          setActiveRichImageDeleteLine(null);
        } else {
          deleteLineNode.classList.add(RICH_IMAGE_DELETE_LINE_ACTIVE_CLASS_NAME);
        }
      }
    }

    if (richImageDeleteConfirm) {
      const confirmEditor = getEditorElement(richImageDeleteConfirm.scope);
      if (!confirmEditor) {
        setRichImageDeleteConfirm(null);
        setRichImageDeleteConfirmRect(null);
      } else {
        const confirmImageNode = getRichImageElementById(
          confirmEditor,
          richImageDeleteConfirm.imageId
        );
        if (!confirmImageNode) {
          setRichImageDeleteConfirm(null);
          setRichImageDeleteConfirmRect(null);
        } else {
          confirmImageNode.classList.add(RICH_IMAGE_DELETE_CONFIRM_CLASS_NAME);
        }
      }
    }

    if (richFileDeleteConfirm) {
      const fileConfirmEditor = getEditorElement(richFileDeleteConfirm.scope);
      if (!fileConfirmEditor) {
        setRichFileDeleteConfirm(null);
        setRichFileDeleteConfirmRect(null);
      } else {
        const fileNode = getRichFileElementById(fileConfirmEditor, richFileDeleteConfirm.fileId);
        if (!fileNode) {
          setRichFileDeleteConfirm(null);
          setRichFileDeleteConfirmRect(null);
        } else {
          fileNode.classList.add(RICH_FILE_DELETE_CONFIRM_CLASS_NAME);
        }
      }
    }
  }, [
    selectedRichImage,
    activeRichImageDeleteLine,
    richImageDeleteConfirm,
    richFileDeleteConfirm,
  ]);

  useEffect(() => {
    if (!richImageDeleteConfirm) {
      return;
    }

    const isSameSelection = (() => {
      if (!selectedRichImage || selectedRichImage.imageId !== richImageDeleteConfirm.imageId) {
        return false;
      }

      if (selectedRichImage.scope.kind !== richImageDeleteConfirm.scope.kind) {
        return false;
      }

      if (selectedRichImage.scope.kind === "continuous") {
        return true;
      }

      if (richImageDeleteConfirm.scope.kind !== "block") {
        return false;
      }

      return selectedRichImage.scope.messageId === richImageDeleteConfirm.scope.messageId;
    })();

    if (!isSameSelection) {
      setRichImageDeleteConfirm(null);
      setRichImageDeleteConfirmRect(null);
      return;
    }

    let animationFrameId = 0;
    const updateOverlayRect = () => {
      const editor =
        richImageDeleteConfirm.scope.kind === "continuous"
          ? continuousEditorRef.current
          : blockEditorRefsRef.current[richImageDeleteConfirm.scope.messageId] ?? null;
      if (!editor) {
        setRichImageDeleteConfirm(null);
        setRichImageDeleteConfirmRect(null);
        return;
      }

      const imageNode =
        Array.from(editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`)).find(
          (node) =>
            node.getAttribute("data-rich-image-id") === richImageDeleteConfirm.imageId
        ) ?? null;
      if (!imageNode) {
        setRichImageDeleteConfirm(null);
        setRichImageDeleteConfirmRect(null);
        return;
      }

      const rect = imageNode.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        setRichImageDeleteConfirmRect(null);
        return;
      }

      const nextRect = getDeleteConfirmOverlayRect(rect);

      setRichImageDeleteConfirmRect((previousRect) => {
        if (
          previousRect &&
          Math.abs(previousRect.top - nextRect.top) < 0.5 &&
          Math.abs(previousRect.left - nextRect.left) < 0.5 &&
          Math.abs(previousRect.width - nextRect.width) < 0.5 &&
          Math.abs(previousRect.height - nextRect.height) < 0.5
        ) {
          return previousRect;
        }

        return nextRect;
      });
    };

    updateOverlayRect();
    animationFrameId = window.requestAnimationFrame(updateOverlayRect);
    window.addEventListener("resize", updateOverlayRect);
    window.addEventListener("scroll", updateOverlayRect, true);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", updateOverlayRect);
      window.removeEventListener("scroll", updateOverlayRect, true);
    };
  }, [richImageDeleteConfirm, selectedRichImage]);

  useEffect(() => {
    if (!richFileDeleteConfirm) {
      return;
    }

    let animationFrameId = 0;
    const updateOverlayRect = () => {
      const editor =
        richFileDeleteConfirm.scope.kind === "continuous"
          ? continuousEditorRef.current
          : blockEditorRefsRef.current[richFileDeleteConfirm.scope.messageId] ?? null;
      if (!editor) {
        setRichFileDeleteConfirm(null);
        setRichFileDeleteConfirmRect(null);
        return;
      }

      const fileNode = getRichFileElementById(editor, richFileDeleteConfirm.fileId);
      if (!fileNode) {
        setRichFileDeleteConfirm(null);
        setRichFileDeleteConfirmRect(null);
        return;
      }

      const rect = fileNode.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        setRichFileDeleteConfirmRect(null);
        return;
      }

      const nextRect = getDeleteConfirmOverlayRect(rect);

      setRichFileDeleteConfirmRect((previousRect) => {
        if (
          previousRect &&
          Math.abs(previousRect.top - nextRect.top) < 0.5 &&
          Math.abs(previousRect.left - nextRect.left) < 0.5 &&
          Math.abs(previousRect.width - nextRect.width) < 0.5 &&
          Math.abs(previousRect.height - nextRect.height) < 0.5
        ) {
          return previousRect;
        }

        return nextRect;
      });
    };

    updateOverlayRect();
    animationFrameId = window.requestAnimationFrame(updateOverlayRect);
    window.addEventListener("resize", updateOverlayRect);
    window.addEventListener("scroll", updateOverlayRect, true);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", updateOverlayRect);
      window.removeEventListener("scroll", updateOverlayRect, true);
    };
  }, [richFileDeleteConfirm]);

  useEffect(() => {
    function handleImageDelete(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (richImageDeleteConfirm) {
        if (event.key === "Enter") {
          event.preventDefault();

          deleteRichImageBySelectionRef.current(richImageDeleteConfirm);
          return;
        }

        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
        }

        return;
      }

      if (richFileDeleteConfirm) {
        if (event.key === "Enter") {
          event.preventDefault();
          deleteRichFileBySelectionRef.current(richFileDeleteConfirm);
          return;
        }

        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", handleImageDelete);
    return () => {
      window.removeEventListener("keydown", handleImageDelete);
    };
  }, [richImageDeleteConfirm, richFileDeleteConfirm]);

  useEffect(() => {
    function finalizeRichImageResize(pointerId?: number) {
      const resizeState = richImageResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      if (typeof pointerId === "number" && resizeState.pointerId !== pointerId) {
        return;
      }

      try {
        if (resizeState.figure.hasPointerCapture(resizeState.pointerId)) {
          resizeState.figure.releasePointerCapture(resizeState.pointerId);
        }
      } catch {
        // ignore capture errors
      }

      resizeState.figure.classList.remove(RICH_IMAGE_RESIZING_CLASS_NAME);
      richImageResizeStateRef.current = null;
      applyEditorDomValueRef.current(resizeState.scope, resizeState.editor);
      rememberRichSelectionRef.current(resizeState.scope);
      syncRichToolbarStateRef.current(resizeState.scope);
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = richImageResizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();

      let delta = 0;
      if (resizeState.edge === "left") {
        delta = resizeState.startX - event.clientX;
      } else if (resizeState.edge === "right") {
        delta = event.clientX - resizeState.startX;
      } else if (resizeState.edge === "top") {
        delta = resizeState.startY - event.clientY;
      } else {
        delta = event.clientY - resizeState.startY;
      }

      applyRichImageWidth(
        resizeState.figure,
        resizeState.startWidth + delta / resizeState.displayScale,
        resizeState.displayScale
      );
    }

    function handlePointerUp(event: PointerEvent) {
      finalizeRichImageResize(event.pointerId);
    }

    function handlePointerCancel(event: PointerEvent) {
      finalizeRichImageResize(event.pointerId);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, []);

  useEffect(() => {
    if (currentCategory?.format !== "continuous") {
      return;
    }

    const editor = continuousEditorRef.current;
    if (!editor) {
      return;
    }

    if (editor === document.activeElement) {
      return;
    }

    const nextValue = sanitizeRichTextHtml(continuousDraft);
    if (sanitizeRichTextHtml(editor.innerHTML) === nextValue) {
      ensureRichImageDeleteLinesRef.current(editor);
      ensureRichFileRowsRef.current(editor);
      applyRichImageDisplayScaleToEditor(editor, editorDisplayScale);
      return;
    }

    editor.innerHTML = nextValue;
    ensureRichImageDeleteLinesRef.current(editor);
    ensureRichFileRowsRef.current(editor);
    applyRichImageDisplayScaleToEditor(editor, editorDisplayScale);
  }, [
    applyRichImageDisplayScaleToEditor,
    continuousDraft,
    currentCategory?.format,
    currentCategory?.id,
    editorDisplayScale,
  ]);

  useEffect(() => {
    if (currentCategory?.format !== "block") {
      return;
    }

    for (const message of currentMessages) {
      if (isSpecialMessageContent(message.content)) {
        continue;
      }

      const editor = blockEditorRefsRef.current[message.id];
      if (!editor || editor === document.activeElement) {
        continue;
      }

      const nextValue = normalizePersistedMessageContent(message.content);
      if (sanitizeRichTextHtml(editor.innerHTML) === nextValue) {
        ensureRichImageDeleteLinesRef.current(editor);
        ensureRichFileRowsRef.current(editor);
        applyRichImageDisplayScaleToEditor(editor, editorDisplayScale);
        continue;
      }

      editor.innerHTML = nextValue;
      ensureRichImageDeleteLinesRef.current(editor);
      ensureRichFileRowsRef.current(editor);
      applyRichImageDisplayScaleToEditor(editor, editorDisplayScale);
    }
  }, [
    applyRichImageDisplayScaleToEditor,
    currentCategory?.format,
    currentMessages,
    editorDisplayScale,
  ]);

  useEffect(() => {
    applyRichImageDisplayScaleToMountedEditors(editorDisplayScale);
  }, [applyRichImageDisplayScaleToMountedEditors, editorDisplayScale]);

  useEffect(() => {
    setEditorTextScaleInputValue(formatEditorTextScalePercent(editorTextScalePercent));
  }, [editorTextScalePercent]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (richImageDeleteConfirm) {
          event.preventDefault();
          cancelRichImageDeleteConfirmation();
          return;
        }

        if (richFileDeleteConfirm) {
          event.preventDefault();
          cancelRichFileDeleteConfirmation();
          return;
        }

        if (confirmResolverRef.current) {
          confirmResolverRef.current(false);
          confirmResolverRef.current = null;
        }

        setConfirmDialog(null);
        setShowSearch(false);
        setShowDictionaryGlobalSearch(false);
        setShowMenu(false);
        setMobilePanel(null);
        setShowCategoryTagLibrary(false);
        setShowProjectCreateModal(false);
        setShowTextColorPalette(false);
        setShowLinkPlaceholderModal(false);
        setLinkSelectionPreview("");
        setSelectedRichImage(null);
        setChecklistEditor(null);
        setDictionaryEditor(null);
        setDictionaryStudy(null);
        setChecklistTagSearchQuery("");
        setMenuPanel("main");
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [richImageDeleteConfirm, richFileDeleteConfirm]);

  useEffect(() => {
    function handleWorkspaceUndoKey(event: KeyboardEvent) {
      const isUndoKey =
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "z";
      if (!isUndoKey) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      void performWorkspaceUndoRef.current();
    }

    window.addEventListener("keydown", handleWorkspaceUndoKey);
    return () => {
      window.removeEventListener("keydown", handleWorkspaceUndoKey);
    };
  }, []);

  useEffect(() => {
    if (!dictionaryStudy) {
      setDictionaryStudyCardScale(1);
      return;
    }

    const shell = dictionaryStudyCardShellRef.current;
    const content = dictionaryStudyCardContentRef.current;
    const fit = dictionaryStudyCardFitRef.current;
    if (!shell || !content || !fit) {
      return;
    }

    const allowVerticalScroll =
      dictionaryStudy.noteDisplayMode === "continuous" &&
      !dictionaryStudy.isProgressComplete;
    const useSeparateAutoFit =
      dictionaryStudy.noteDisplayMode === "separate" &&
      !dictionaryStudy.isProgressComplete;
    let animationFrameId = 0;
    const applyFit = () => {
      const rootFontSize =
        Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) ||
        16;
      const clampPx = (min: number, value: number, max: number) =>
        Math.max(min, Math.min(value, max));
      const shellRect = shell.getBoundingClientRect();
      const shellWidth = Math.max(1, shellRect.width);
      const shellHeight = Math.max(1, shellRect.height);
      if (useSeparateAutoFit) {
        const wordSlot = dictionaryStudyWordSlotRef.current;
        const wordValue = dictionaryStudyWordValueRef.current;
        const noteSlot = dictionaryStudyNoteSlotRef.current;
        const noteValue = dictionaryStudyNoteValueRef.current;
        const separatePadding = clampPx(
          0.42 * rootFontSize,
          Math.min(shellWidth * 0.018, shellHeight * 0.035),
          0.95 * rootFontSize
        );
        const separateGap = clampPx(
          0.3 * rootFontSize,
          shellHeight * 0.014,
          0.62 * rootFontSize
        );
        const separateNotePaddingY = clampPx(
          0.22 * rootFontSize,
          shellHeight * 0.01,
          0.42 * rootFontSize
        );
        const separateNotePaddingX = clampPx(
          0.36 * rootFontSize,
          shellWidth * 0.009,
          0.68 * rootFontSize
        );

        content.style.setProperty("--dictionary-study-scale", "1");
        content.style.setProperty(
          "--dictionary-study-padding",
          `${separatePadding}px`
        );
        content.style.setProperty("--dictionary-study-gap", `${separateGap}px`);
        content.style.setProperty(
          "--dictionary-study-note-padding",
          `${separateNotePaddingY}px ${separateNotePaddingX}px`
        );

        const getSlotSize = (
          slot: HTMLDivElement | null,
          fallbackWidth: number,
          fallbackHeight: number,
          minValidWidth = rootFontSize,
          minValidHeight = rootFontSize
        ) => {
          const rect = slot?.getBoundingClientRect();
          const measuredWidth = Math.max(
            slot?.clientWidth ?? 0,
            rect?.width ?? 0
          );
          const measuredHeight = Math.max(
            slot?.clientHeight ?? 0,
            rect?.height ?? 0
          );

          return {
            width:
              measuredWidth >= minValidWidth
                ? measuredWidth
                : Math.max(1, fallbackWidth),
            height:
              measuredHeight >= minValidHeight
                ? measuredHeight
                : Math.max(1, fallbackHeight),
          };
        };
        const fitsTextBox = (
          element: HTMLDivElement,
          slotSize: { width: number; height: number },
          variableName: string,
          fontSize: number,
          mode: "box" | "height-only",
          widthSafetyPx = 2,
          heightSafetyPx = 2
        ) => {
          content.style.setProperty(variableName, `${fontSize}px`);
          const widthLimit = Math.max(
            1,
            slotSize.width - Math.max(widthSafetyPx, fontSize * 0.04)
          );
          const heightLimit = Math.max(
            1,
            slotSize.height - Math.max(heightSafetyPx, fontSize * 0.12)
          );

          if (mode === "height-only") {
            return element.scrollHeight <= heightLimit;
          }

          return element.scrollWidth <= widthLimit && element.scrollHeight <= heightLimit;
        };
        const findBestFontSize = (
          element: HTMLDivElement | null,
          slot: HTMLDivElement | null,
          variableName: string,
          minSize: number,
          maxSize: number,
          slotSize: { width: number; height: number },
          mode: "box" | "height-only",
          widthSafetyPx = 2,
          heightSafetyPx = 2
        ) => {
          if (!element || !slot || !element.textContent?.trim()) {
            return maxSize;
          }

          let low = minSize;
          let high = Math.max(minSize, maxSize);
          let best = minSize;

          if (
            fitsTextBox(
              element,
              slotSize,
              variableName,
              high,
              mode,
              widthSafetyPx,
              heightSafetyPx
            )
          ) {
            return high;
          }

          for (let index = 0; index < 14; index += 1) {
            const nextSize = (low + high) / 2;

            if (
              fitsTextBox(
                element,
                slotSize,
                variableName,
                nextSize,
                mode,
                widthSafetyPx,
                heightSafetyPx
              )
            ) {
              best = nextSize;
              low = nextSize;
            } else {
              high = nextSize;
            }
          }

          return best;
        };
        const wordSlotSize = getSlotSize(
          wordSlot,
          shellWidth * 0.74,
          shellHeight * (noteSlot ? 0.5 : 0.68),
          rootFontSize * 10,
          rootFontSize * 4
        );
        const noteSlotSize = getSlotSize(
          noteSlot,
          shellWidth * 0.72,
          shellHeight * 0.2,
          rootFontSize * 8,
          rootFontSize * 2.25
        );
        const wordMinSize = Math.max(10, 0.62 * rootFontSize);
        const noteMinSize = Math.max(9, 0.56 * rootFontSize);
        const wordMaxSize = clampPx(
          1.35 * rootFontSize,
          Math.min(wordSlotSize.width * 0.16, wordSlotSize.height * 0.72),
          6.2 * rootFontSize
        );
        const noteMaxSize = clampPx(
          0.98 * rootFontSize,
          Math.min(noteSlotSize.width * 0.09, noteSlotSize.height * 0.62),
          2.7 * rootFontSize
        );
        const wordFontSize = findBestFontSize(
          wordValue,
          wordSlot,
          "--dictionary-study-word-size",
          wordMinSize,
          wordMaxSize,
          wordSlotSize,
          "height-only",
          4,
          6
        );
        const noteFontSize = findBestFontSize(
          noteValue,
          noteSlot,
          "--dictionary-study-note-size",
          noteMinSize,
          noteMaxSize,
          noteSlotSize,
          "box",
          2,
          3
        );

        content.style.setProperty(
          "--dictionary-study-word-size",
          `${wordFontSize}px`
        );
        content.style.setProperty(
          "--dictionary-study-note-size",
          `${noteFontSize}px`
        );
        setDictionaryStudyCardScale((prev) =>
          Math.abs(prev - 1) < 0.01 ? prev : 1
        );
        return;
      }

      const baseWordSize = allowVerticalScroll
        ? clampPx(
            1.05 * rootFontSize,
            Math.min(shellWidth * 0.055, shellHeight * 0.12),
            2.4 * rootFontSize
          )
        : clampPx(
            2.25 * rootFontSize,
            Math.min(shellWidth * 0.24, shellHeight * 0.54),
            12 * rootFontSize
          );
      const baseNoteSize = allowVerticalScroll
        ? clampPx(
            0.78 * rootFontSize,
            Math.min(shellWidth * 0.018, shellHeight * 0.045),
            1.05 * rootFontSize
          )
        : clampPx(
            0.92 * rootFontSize,
            Math.min(shellWidth * 0.028, shellHeight * 0.085),
            1.45 * rootFontSize
          );
      const basePadding = allowVerticalScroll
        ? clampPx(
            0.42 * rootFontSize,
            Math.min(shellWidth * 0.018, shellHeight * 0.035),
            0.85 * rootFontSize
          )
        : clampPx(
            0.78 * rootFontSize,
            Math.min(shellWidth * 0.035, shellHeight * 0.065),
            1.45 * rootFontSize
          );
      const baseGap = allowVerticalScroll
        ? clampPx(0.34 * rootFontSize, shellHeight * 0.015, 0.65 * rootFontSize)
        : clampPx(0.5 * rootFontSize, shellHeight * 0.025, 0.95 * rootFontSize);
      const baseNotePaddingY = (allowVerticalScroll ? 0.3 : 0.46) * rootFontSize;
      const baseNotePaddingX = (allowVerticalScroll ? 0.48 : 0.64) * rootFontSize;
      const minWordSize = (allowVerticalScroll ? 0.9 : 1.3) * rootFontSize;
      const minNoteSize = (allowVerticalScroll ? 0.72 : 0.95) * rootFontSize;
      const getScaleMetrics = (wordScale: number, noteScale: number) => {
        const layoutScale = Math.min(wordScale, noteScale);
        const nextPadding = Math.max(0.32 * rootFontSize, basePadding * layoutScale);
        return {
          layoutScale,
          padding: nextPadding,
          wordSize: Math.max(minWordSize, baseWordSize * wordScale),
          noteSize: Math.max(minNoteSize, baseNoteSize * noteScale),
          gap: Math.max(
            0.45 * rootFontSize,
            baseGap * layoutScale,
            baseWordSize * wordScale * 0.08
          ),
          notePaddingY: Math.max(0.18 * rootFontSize, baseNotePaddingY * noteScale),
          notePaddingX: Math.max(0.26 * rootFontSize, baseNotePaddingX * noteScale),
        };
      };
      const applyScale = (wordScale: number, noteScale: number) => {
        const metrics = getScaleMetrics(wordScale, noteScale);
        content.style.setProperty(
          "--dictionary-study-scale",
          String(metrics.layoutScale)
        );
        content.style.setProperty(
          "--dictionary-study-word-size",
          `${metrics.wordSize}px`
        );
        content.style.setProperty(
          "--dictionary-study-note-size",
          `${metrics.noteSize}px`
        );
        content.style.setProperty("--dictionary-study-padding", `${metrics.padding}px`);
        content.style.setProperty("--dictionary-study-gap", `${metrics.gap}px`);
        content.style.setProperty(
          "--dictionary-study-note-padding",
          `${metrics.notePaddingY}px ${metrics.notePaddingX}px`
        );
      };

      const fitsAtScale = (wordScale: number, noteScale: number) => {
        const metrics = getScaleMetrics(wordScale, noteScale);
        applyScale(wordScale, noteScale);
        const availableWidth = shellWidth - metrics.padding * 2;
        const availableHeight = shellHeight - metrics.padding * 2 - 8;

        return (
          fit.scrollWidth <= Math.max(1, availableWidth) + 2 &&
          (allowVerticalScroll ||
            fit.scrollHeight <= Math.max(1, availableHeight))
        );
      };

      const findBestScale = (
        minScale: number,
        maxScale: number,
        fits: (scale: number) => boolean
      ) => {
        let low = minScale;
        let high = maxScale;
        let best = fits(low) ? low : minScale;
        if (fits(high)) {
          return high;
        }

        for (let index = 0; index < 12; index += 1) {
          const scale = (low + high) / 2;

          if (fits(scale)) {
            best = scale;
            low = scale;
          } else {
            high = scale;
          }
        }

        if (!fits(best)) {
          return minScale;
        }

        return best;
      };

      let wordScale = findBestScale(0.1, 1, (scale) =>
        fitsAtScale(scale, 1)
      );
      let noteScale = 1;
      if (!fitsAtScale(wordScale, noteScale)) {
        noteScale = findBestScale(0.18, 1, (scale) =>
          fitsAtScale(wordScale, scale)
        );
      }
      if (!fitsAtScale(wordScale, noteScale)) {
        wordScale = findBestScale(0.06, wordScale, (scale) =>
          fitsAtScale(scale, noteScale)
        );
      }

      applyScale(wordScale, noteScale);
      const cardScale = Math.min(wordScale, noteScale);
      setDictionaryStudyCardScale((prev) =>
        Math.abs(prev - cardScale) < 0.01 ? prev : cardScale
      );
    };

    const scheduleFit = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(applyFit);
    };

    applyFit();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleFit);
    const observedElements = [
      shell,
      fit,
      dictionaryStudyWordSlotRef.current,
      dictionaryStudyNoteSlotRef.current,
    ].filter((element): element is HTMLDivElement => Boolean(element));
    observedElements.forEach((element) => resizeObserver?.observe(element));
    window.addEventListener("resize", scheduleFit);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleFit);
    };
  }, [
    dictionaryStudy,
    dictionaryStudy?.currentIndex,
    dictionaryStudy?.isAnswerRevealed,
    dictionaryStudy?.transitionKey,
  ]);

  useEffect(() => {
    const categorySaveTimers = categorySaveTimersRef.current;
    const categoryInputSyncTimers = categoryInputSyncTimersRef.current;
    const messageSaveTimers = messageSaveTimersRef.current;
    const messageInputSyncTimers = messageInputSyncTimersRef.current;
    const richFileObjectUrls = richFileObjectUrlsRef.current;

    return () => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }

      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }

      for (const timer of Object.values(categorySaveTimers)) {
        clearTimeout(timer);
      }

      for (const timer of Object.values(categoryInputSyncTimers)) {
        clearTimeout(timer);
      }

      for (const timer of Object.values(messageSaveTimers)) {
        clearTimeout(timer);
      }

      for (const timer of Object.values(messageInputSyncTimers)) {
        clearTimeout(timer);
      }

      richImageResizeStateRef.current?.figure.classList.remove(
        RICH_IMAGE_RESIZING_CLASS_NAME
      );
      richImageResizeStateRef.current = null;
      draggedRichImageRef.current = null;
      draggedRichFileRef.current = null;
      revokeRichFileObjectUrlCache(richFileObjectUrls);
    };
  }, []);

  function isSameRichEditorScope(
    left: RichEditorScope | null,
    right: RichEditorScope | null
  ): boolean {
    if (!left && !right) {
      return true;
    }

    if (!left || !right) {
      return false;
    }

    if (left.kind !== right.kind) {
      return false;
    }

    if (left.kind === "continuous" && right.kind === "continuous") {
      return true;
    }

    if (left.kind === "block" && right.kind === "block") {
      return left.messageId === right.messageId;
    }

    return false;
  }

  function cloneRichEditorScope(scope: RichEditorScope | null): RichEditorScope | null {
    if (!scope) {
      return null;
    }

    return scope.kind === "continuous"
      ? { kind: "continuous" }
      : { kind: "block", messageId: scope.messageId };
  }

  function getRichEditorUndoKey(scope: RichEditorScope): string {
    return scope.kind === "continuous" ? "continuous" : `block:${scope.messageId}`;
  }

  function areWorkspaceUiUndoSnapshotsEqual(
    left: WorkspaceUiUndoSnapshot,
    right: WorkspaceUiUndoSnapshot
  ): boolean {
    return (
      left.currentCategoryId === right.currentCategoryId &&
      left.insertionTargetId === right.insertionTargetId &&
      left.activeProjectId === right.activeProjectId &&
      left.selectedMessageId === right.selectedMessageId &&
      left.editorTextScalePercent === right.editorTextScalePercent &&
      isSameRichEditorScope(left.activeRichEditor, right.activeRichEditor)
    );
  }

  function captureWorkspaceUiUndoSnapshot(): WorkspaceUiUndoSnapshot {
    return {
      currentCategoryId,
      insertionTargetId,
      activeProjectId,
      selectedMessageId,
      activeRichEditor: cloneRichEditorScope(activeRichEditor),
      editorTextScalePercent,
    };
  }

  function getCategoryIdForRichEditorScope(scope: RichEditorScope): string | null {
    if (scope.kind === "continuous") {
      return currentCategory?.format === "continuous"
        ? currentCategory.id
        : currentCategoryId;
    }

    if (currentMessages.some((message) => message.id === scope.messageId)) {
      return currentCategoryId;
    }

    for (const [categoryId, messages] of Object.entries(messagesByCategory)) {
      if (messages.some((message) => message.id === scope.messageId)) {
        return categoryId;
      }
    }

    return null;
  }

  function getRichEditorHtmlForUndo(scope: RichEditorScope): string {
    const editor = getEditorElement(scope);
    if (editor) {
      ensureRichImageDeleteLinesIfNeeded(editor);
      ensureRichFileRows(editor);
      return sanitizeRichTextHtml(editor.innerHTML);
    }

    if (scope.kind === "continuous") {
      return sanitizeRichTextHtml(continuousDraft);
    }

    const categoryId = getCategoryIdForRichEditorScope(scope);
    const sourceMessages = categoryId ? messagesByCategory[categoryId] ?? [] : currentMessages;
    const message = sourceMessages.find((row) => row.id === scope.messageId) ?? null;

    return sanitizeRichTextHtml(message?.content ?? "");
  }

  function refreshWorkspaceUndoAvailability() {
    setUndoRevision((prev) => prev + 1);
  }

  function pushWorkspaceUndoEntry(entry: WorkspaceUndoEntry) {
    if (isRestoringWorkspaceUndoRef.current) {
      return;
    }

    const stack = workspaceUndoStackRef.current;
    const previous = stack[stack.length - 1] ?? null;
    if (
      previous?.kind === "ui" &&
      entry.kind === "ui" &&
      areWorkspaceUiUndoSnapshotsEqual(previous.snapshot, entry.snapshot)
    ) {
      return;
    }

    if (
      previous?.kind === "editor" &&
      entry.kind === "editor" &&
      isSameRichEditorScope(previous.scope, entry.scope) &&
      previous.categoryId === entry.categoryId &&
      previous.html === entry.html
    ) {
      return;
    }

    stack.push(entry);
    if (stack.length > WORKSPACE_UNDO_LIMIT) {
      stack.splice(0, stack.length - WORKSPACE_UNDO_LIMIT);
    }
    refreshWorkspaceUndoAvailability();
  }

  function pushUiUndoSnapshot() {
    pushWorkspaceUndoEntry({
      kind: "ui",
      snapshot: captureWorkspaceUiUndoSnapshot(),
    });
  }

  function pushEditorUndoSnapshot(scope: RichEditorScope) {
    pushWorkspaceUndoEntry({
      kind: "editor",
      snapshot: captureWorkspaceUiUndoSnapshot(),
      scope: cloneRichEditorScope(scope) ?? scope,
      categoryId: getCategoryIdForRichEditorScope(scope),
      html: getRichEditorHtmlForUndo(scope),
    });
  }

  function pushEditorUndoSnapshots(scopes: RichEditorScope[]) {
    const entries = scopes
      .map((scope) => ({
        scope: cloneRichEditorScope(scope) ?? scope,
        categoryId: getCategoryIdForRichEditorScope(scope),
        html: getRichEditorHtmlForUndo(scope),
      }))
      .filter((entry, index, source) =>
        source.findIndex((candidate) => isSameRichEditorScope(candidate.scope, entry.scope)) ===
        index
      );

    if (entries.length === 0) {
      return;
    }

    if (entries.length === 1) {
      pushWorkspaceUndoEntry({
        kind: "editor",
        snapshot: captureWorkspaceUiUndoSnapshot(),
        ...entries[0],
      });
      return;
    }

    pushWorkspaceUndoEntry({
      kind: "editors",
      snapshot: captureWorkspaceUiUndoSnapshot(),
      entries,
    });
  }

  function rememberCurrentEditorUndoHtml(scope: RichEditorScope, editor?: HTMLDivElement | null) {
    lastEditorUndoHtmlRef.current[getRichEditorUndoKey(scope)] = sanitizeRichTextHtml(
      editor?.innerHTML ?? getRichEditorHtmlForUndo(scope)
    );
  }

  function applyWorkspaceUiUndoSnapshot(snapshot: WorkspaceUiUndoSnapshot) {
    setActiveProjectId(snapshot.activeProjectId);
    setCurrentCategoryId(snapshot.currentCategoryId);
    setInsertionTargetId(snapshot.insertionTargetId);
    setSelectedMessageId(snapshot.selectedMessageId);
    setActiveRichEditor(cloneRichEditorScope(snapshot.activeRichEditor));
    setEditorTextScalePercent(snapshot.editorTextScalePercent);
    setSelectedRichImage(null);
    setActiveRichImageDeleteLine(null);
    setRichImageDeleteConfirm(null);
    setRichImageDeleteConfirmRect(null);
    setRichFileDeleteConfirm(null);
    setRichFileDeleteConfirmRect(null);
    setShowTextColorPalette(false);
    savedRichSelectionRef.current = null;
  }

  function writeEditorHtmlAfterUndo(scope: RichEditorScope, html: string) {
    const editor = getEditorElement(scope);
    if (!editor) {
      return;
    }

    editor.innerHTML = html;
    ensureRichImageDeleteLines(editor);
    applyRichImageDisplayScaleToEditor(editor, editorDisplayScale);
    rememberCurrentEditorUndoHtml(scope, editor);
  }

  function restoreEditorUndoEntry(entry: Extract<WorkspaceUndoEntry, { kind: "editor" }>) {
    applyWorkspaceUiUndoSnapshot(entry.snapshot);

    if (entry.scope.kind === "continuous") {
      if (entry.categoryId) {
        const currentDocument = getContinuousDocumentForCategory(entry.categoryId);
        commitContinuousDocumentForCategory(entry.categoryId, {
          text: entry.html,
          checklists: currentDocument?.checklists ?? [],
          dictionaries: currentDocument?.dictionaries ?? [],
          schedules: currentDocument?.schedules ?? [],
        });

        if (entry.snapshot.currentCategoryId === entry.categoryId) {
          setContinuousDraft(entry.html);
        }
      }
    } else if (entry.categoryId) {
      syncMessageContentChange(entry.categoryId, entry.scope.messageId, entry.html);
    }

    writeEditorHtmlAfterUndo(entry.scope, entry.html);
    window.setTimeout(() => {
      writeEditorHtmlAfterUndo(entry.scope, entry.html);
    }, 0);
  }

  function restoreEditorUndoPayload(payload: {
    scope: RichEditorScope;
    categoryId: string | null;
    html: string;
  }) {
    if (payload.scope.kind === "continuous") {
      if (payload.categoryId) {
        const currentDocument = getContinuousDocumentForCategory(payload.categoryId);
        commitContinuousDocumentForCategory(payload.categoryId, {
          text: payload.html,
          checklists: currentDocument?.checklists ?? [],
          dictionaries: currentDocument?.dictionaries ?? [],
          schedules: currentDocument?.schedules ?? [],
        });
      }
    } else if (payload.categoryId) {
      syncMessageContentChange(payload.categoryId, payload.scope.messageId, payload.html);
    }

    writeEditorHtmlAfterUndo(payload.scope, payload.html);
    window.setTimeout(() => {
      writeEditorHtmlAfterUndo(payload.scope, payload.html);
    }, 0);
  }

  function restoreEditorsUndoEntry(entry: Extract<WorkspaceUndoEntry, { kind: "editors" }>) {
    applyWorkspaceUiUndoSnapshot(entry.snapshot);
    for (const payload of entry.entries) {
      restoreEditorUndoPayload(payload);
    }
  }

  async function restoreCategoryDeleteUndoEntry(
    entry: Extract<WorkspaceUndoEntry, { kind: "category-delete" }>
  ) {
    setIsMutating(true);
    try {
      const response = await authorizedFetch("/api/categories/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: entry.document,
          projects: entry.projects.map((project) => ({
            id: project.id,
            containerCategoryIds: parsePlainList(project.container_category_ids),
          })),
        }),
      });

      const payload = (await response.json()) as CategoryRestorePayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось восстановить категорию.");
      }

      const restoredCategories = payload.data.categories.map(normalizeCategoryRow);
      const restoredCategoryIds = new Set(
        restoredCategories.map((category) => category.id)
      );
      const restoredMessagesByCategory: Record<string, MessageRow[]> = {};
      for (const message of payload.data.messages.map(normalizeMessageRow)) {
        const list = restoredMessagesByCategory[message.category_id] ?? [];
        list.push(message);
        restoredMessagesByCategory[message.category_id] = list;
      }

      setCategories((prev) =>
        [
          ...prev.filter((category) => !restoredCategoryIds.has(category.id)),
          ...restoredCategories,
        ].sort(sortByPosition)
      );
      setMessagesByCategory((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(restoredMessagesByCategory).map(([categoryId, messages]) => [
            categoryId,
            messages.sort(sortMessages),
          ])
        ),
      }));

      for (const category of restoredCategories) {
        savedCategoryContentRef.current[category.id] = category.content;
        categoryDraftVersionRef.current[category.id] = 0;
        categoryAckVersionRef.current[category.id] = 0;
        clearCategorySaveState(category.id);
      }

      for (const messages of Object.values(restoredMessagesByCategory)) {
        for (const message of messages) {
          savedMessageContentRef.current[message.id] = message.content;
          messageDraftVersionRef.current[message.id] = 0;
          messageAckVersionRef.current[message.id] = 0;
          clearMessageSaveState(message.id);
        }
      }

      setProjects(
        (payload.projects?.map(normalizeProjectRow) ?? entry.projects).sort(sortProjects)
      );
      setSource((prev) => payload.source ?? prev);
      applyWorkspaceUiUndoSnapshot(entry.snapshot);
      pushNotice(`Категория восстановлена: ${entry.document.categories[0]?.title ?? "#"}.`);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось восстановить удалённую категорию."), "error");
    } finally {
      syncCategorySavingState();
      syncMessageSavingState();
      setIsMutating(false);
    }
  }

  async function performWorkspaceUndo() {
    const entry = workspaceUndoStackRef.current.pop();
    refreshWorkspaceUndoAvailability();
    if (!entry) {
      return;
    }

    isRestoringWorkspaceUndoRef.current = true;
    try {
      if (entry.kind === "ui") {
        applyWorkspaceUiUndoSnapshot(entry.snapshot);
      } else if (entry.kind === "editor") {
        restoreEditorUndoEntry(entry);
      } else if (entry.kind === "editors") {
        restoreEditorsUndoEntry(entry);
      } else {
        await restoreCategoryDeleteUndoEntry(entry);
      }
    } finally {
      window.setTimeout(() => {
        isRestoringWorkspaceUndoRef.current = false;
      }, 0);
    }
  }

  function setActiveRichEditorIfChanged(scope: RichEditorScope | null) {
    setActiveRichEditor((prev) => {
      if (isSameRichEditorScope(prev, scope)) {
        return prev;
      }

      return scope;
    });
  }

  function deleteRichImageBySelection(selection: RichImageSelection): boolean {
    const editor = getEditorElement(selection.scope);
    if (!editor) {
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      setRichImageDeleteConfirm(null);
      setRichImageDeleteConfirmRect(null);
      return false;
    }

    const imageNode = getRichImageElementById(editor, selection.imageId);
    if (!imageNode) {
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      setRichImageDeleteConfirm(null);
      setRichImageDeleteConfirmRect(null);
      return false;
    }

    pushEditorUndoSnapshot(selection.scope);

    const imageRow = getRichImageDeleteRowElementByChild(imageNode);
    const deleteLine = getRichImageDeleteLineElementById(editor, selection.imageId);
    const legacyTrailingBreak =
      imageRow || deleteLine || !(imageNode.nextSibling instanceof HTMLBRElement)
        ? null
        : imageNode.nextSibling;

    clearActiveRichImageResize();
    if (imageRow) {
      imageRow.remove();
    } else {
      imageNode.remove();
      deleteLine?.remove();
    }
    legacyTrailingBreak?.remove();
    setSelectedRichImage(null);
    setActiveRichImageDeleteLine(null);
    setRichImageDeleteConfirm(null);
    setRichImageDeleteConfirmRect(null);
    applyEditorDomValueRef.current(selection.scope, editor);
    rememberRichSelectionRef.current(selection.scope);
    syncRichToolbarStateRef.current(selection.scope);
    return true;
  }

  function getEditorElement(scope: RichEditorScope): HTMLDivElement | null {
    if (scope.kind === "continuous") {
      return continuousEditorRef.current;
    }

    return blockEditorRefsRef.current[scope.messageId] ?? null;
  }

  function setBlockEditorElement(messageId: string, element: HTMLDivElement | null) {
    if (element) {
      blockEditorRefsRef.current[messageId] = element;
      return;
    }

    delete blockEditorRefsRef.current[messageId];
  }

  function getRichImageElementById(
    editor: HTMLDivElement,
    imageId: string
  ): HTMLElement | null {
    const normalizedId = imageId.trim();
    if (!normalizedId) {
      return null;
    }

    return (
      Array.from(editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`)).find(
        (node) => node.getAttribute("data-rich-image-id") === normalizedId
      ) ?? null
    );
  }

  function createRichImageDeleteRowElement(ownerDocument: Document): HTMLElement {
    const row = ownerDocument.createElement("span");
    row.className = `${RICH_IMAGE_ZONE_CLASS_NAME} ${RICH_IMAGE_DELETE_ROW_CLASS_NAME}`;
    row.setAttribute("data-rich-image-delete-row", "true");
    row.setAttribute("contenteditable", "false");
    row.setAttribute("draggable", "false");
    return row;
  }

  function normalizeRichImageDeleteRowElement(row: HTMLElement) {
    row.classList.add(RICH_IMAGE_ZONE_CLASS_NAME);
    row.classList.add(RICH_IMAGE_DELETE_ROW_CLASS_NAME);
    row.setAttribute("data-rich-image-delete-row", "true");
    row.setAttribute("contenteditable", "false");
    row.setAttribute("draggable", "false");
  }

  function createRichImageDeleteLineElement(
    ownerDocument: Document,
    imageId: string,
    position: "before" | "after"
  ): HTMLElement {
    const line = ownerDocument.createElement("span");
    line.className = RICH_IMAGE_DELETE_LINE_CLASS_NAME;
    line.setAttribute("data-rich-image-id", imageId);
    line.setAttribute("data-rich-image-buffer-position", position);
    line.setAttribute("contenteditable", "false");
    line.setAttribute("draggable", "false");
    line.setAttribute("aria-hidden", "true");
    return line;
  }

  function normalizeRichImageDeleteLineElement(
    line: HTMLElement,
    imageId: string,
    position: "before" | "after"
  ) {
    line.classList.add(RICH_IMAGE_DELETE_LINE_CLASS_NAME);
    line.setAttribute("data-rich-image-id", imageId);
    line.setAttribute("data-rich-image-buffer-position", position);
    line.setAttribute("contenteditable", "false");
    line.setAttribute("draggable", "false");
    line.setAttribute("aria-hidden", "true");
    line.textContent = "";
  }

  function getRichImageDeleteRowElementByChild(child: Node | null): HTMLElement | null {
    if (!(child instanceof Node)) {
      return null;
    }

    const parent = child.parentElement;
    if (!parent || !parent.classList.contains(RICH_IMAGE_DELETE_ROW_CLASS_NAME)) {
      return null;
    }

    return parent;
  }

  function getRichImageDeleteRowElementFromNode(node: Node | null): HTMLElement | null {
    if (!node) {
      return null;
    }

    if (
      node instanceof HTMLElement &&
      node.classList.contains(RICH_IMAGE_DELETE_ROW_CLASS_NAME)
    ) {
      return node;
    }

    if (node instanceof Element) {
      return node.closest<HTMLElement>(`.${RICH_IMAGE_DELETE_ROW_CLASS_NAME}`);
    }

    return node.parentElement?.closest<HTMLElement>(`.${RICH_IMAGE_DELETE_ROW_CLASS_NAME}`) ?? null;
  }

  function createRichImageDeleteRowWithImage(
    ownerDocument: Document,
    imageNode: HTMLElement,
    imageId: string
  ): HTMLElement {
    const row = createRichImageDeleteRowElement(ownerDocument);
    row.appendChild(createRichImageDeleteLineElement(ownerDocument, imageId, "before"));
    row.appendChild(imageNode);
    row.appendChild(createRichImageDeleteLineElement(ownerDocument, imageId, "after"));
    row.setAttribute("data-rich-image-id", imageId);
    return row;
  }

  function getRichImageDeleteLineElementById(
    editor: HTMLDivElement,
    imageId: string
  ): HTMLElement | null {
    const normalizedId = imageId.trim();
    if (!normalizedId) {
      return null;
    }

    return (
      Array.from(editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`)).find(
        (node) => node.getAttribute("data-rich-image-id") === normalizedId
      ) ?? null
    );
  }

  function getRichImageDeleteLineElementFromRow(row: HTMLElement): HTMLElement | null {
    return row.querySelector<HTMLElement>(`.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`);
  }

  function getRichImageDeleteLineElementsFromRow(row: HTMLElement): HTMLElement[] {
    return Array.from(row.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`));
  }

  function getRichImageDeleteLineElementFromEventTarget(
    target: EventTarget | null
  ): HTMLElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    const line = target.closest<HTMLElement>(`.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`);
    if (!line) {
      return null;
    }

    return line;
  }

  function getRichImageElementFromNode(node: Node | null): HTMLElement | null {
    if (!node) {
      return null;
    }

    if (node instanceof HTMLElement && node.classList.contains(RICH_IMAGE_CLASS_NAME)) {
      return node;
    }

    if (node instanceof Element) {
      return node.closest<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`);
    }

    return node.parentElement?.closest<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`) ?? null;
  }

  function getRichImageDeleteLineElementFromNode(node: Node | null): HTMLElement | null {
    if (!node) {
      return null;
    }

    if (
      node instanceof HTMLElement &&
      node.classList.contains(RICH_IMAGE_DELETE_LINE_CLASS_NAME)
    ) {
      return node;
    }

    if (node instanceof Element) {
      return node.closest<HTMLElement>(`.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`);
    }

    const parentElement = node.parentElement;
    if (!parentElement) {
      return null;
    }

    return parentElement.closest<HTMLElement>(`.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`);
  }

  function getAdjacentNodeForCollapsedRange(
    editor: HTMLDivElement,
    node: Node,
    direction: "before" | "after"
  ): Node | null {
    let cursor: Node | null = node;
    while (cursor && cursor !== editor) {
      const sibling = direction === "before" ? cursor.previousSibling : cursor.nextSibling;
      if (sibling) {
        return sibling;
      }

      cursor = cursor.parentNode;
    }

    return null;
  }

  function getRichImageElementFromSelection(editor: HTMLDivElement): HTMLElement | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return null;
    }

    const directMatch = getRichImageElementFromNode(range.startContainer);
    if (directMatch && editor.contains(directMatch)) {
      return directMatch;
    }

    if (!range.collapsed) {
      return null;
    }

    let previousNode: Node | null = null;
    let nextNode: Node | null = null;

    if (range.startContainer instanceof Element) {
      const container = range.startContainer;
      previousNode =
        range.startOffset > 0
          ? container.childNodes[range.startOffset - 1] ?? null
          : getAdjacentNodeForCollapsedRange(editor, container, "before");
      nextNode =
        container.childNodes[range.startOffset] ??
        getAdjacentNodeForCollapsedRange(editor, container, "after");
    } else {
      const textNode = range.startContainer;
      const textLength = textNode.textContent?.length ?? 0;
      if (range.startOffset === 0) {
        previousNode = getAdjacentNodeForCollapsedRange(editor, textNode, "before");
      }
      if (range.startOffset >= textLength) {
        nextNode = getAdjacentNodeForCollapsedRange(editor, textNode, "after");
      }
    }

    const adjacentMatch =
      getRichImageElementFromNode(previousNode) ?? getRichImageElementFromNode(nextNode);
    if (adjacentMatch && editor.contains(adjacentMatch)) {
      return adjacentMatch;
    }

    return null;
  }

  function getRichImageDeleteLineElementFromSelection(
    editor: HTMLDivElement
  ): HTMLElement | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return null;
    }

    const directMatch = getRichImageDeleteLineElementFromNode(range.startContainer);
    if (directMatch && editor.contains(directMatch)) {
      return directMatch;
    }

    if (
      range.startContainer instanceof HTMLElement &&
      range.startContainer.classList.contains(RICH_IMAGE_DELETE_ROW_CLASS_NAME)
    ) {
      const row = range.startContainer;
      const linesFromRow = getRichImageDeleteLineElementsFromRow(row);
      if (linesFromRow.length > 0) {
        const rowChildNodes = Array.from(row.childNodes);
        const lineAtCaret =
          linesFromRow.find((line) => rowChildNodes.indexOf(line) === range.startOffset) ??
          [...linesFromRow]
            .reverse()
            .find((line) => rowChildNodes.indexOf(line) < range.startOffset) ??
          null;

        if (lineAtCaret && editor.contains(lineAtCaret)) {
          return lineAtCaret;
        }
      }
    }

    if (!range.collapsed) {
      return null;
    }

    let previousNode: Node | null = null;
    let nextNode: Node | null = null;

    if (range.startContainer instanceof Element) {
      const container = range.startContainer;
      previousNode =
        range.startOffset > 0
          ? container.childNodes[range.startOffset - 1] ?? null
          : getAdjacentNodeForCollapsedRange(editor, container, "before");
      nextNode =
        container.childNodes[range.startOffset] ??
        getAdjacentNodeForCollapsedRange(editor, container, "after");
    } else {
      const textNode = range.startContainer;
      const textLength = textNode.textContent?.length ?? 0;
      if (range.startOffset === 0) {
        previousNode = getAdjacentNodeForCollapsedRange(editor, textNode, "before");
      }
      if (range.startOffset >= textLength) {
        nextNode = getAdjacentNodeForCollapsedRange(editor, textNode, "after");
      }
    }

    const adjacentMatch =
      getRichImageDeleteLineElementFromNode(previousNode) ??
      getRichImageDeleteLineElementFromNode(nextNode);
    if (adjacentMatch && editor.contains(adjacentMatch)) {
      return adjacentMatch;
    }

    if (
      previousNode instanceof HTMLElement &&
      previousNode.classList.contains(RICH_IMAGE_DELETE_ROW_CLASS_NAME)
    ) {
      const lineFromPreviousRow = getRichImageDeleteLineElementFromRow(previousNode);
      if (lineFromPreviousRow && editor.contains(lineFromPreviousRow)) {
        return lineFromPreviousRow;
      }
    }

    return null;
  }

  function getCollapsedSelectionRangeInEditor(editor: HTMLDivElement): Range | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (
      !range.collapsed ||
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return null;
    }

    return range;
  }

  function getAdjacentNodesFromCollapsedRange(
    editor: HTMLDivElement,
    range: Range
  ): {
    previousNode: Node | null;
    nextNode: Node | null;
  } {
    let previousNode: Node | null = null;
    let nextNode: Node | null = null;

    if (range.startContainer instanceof Element) {
      const container = range.startContainer;
      previousNode =
        range.startOffset > 0
          ? container.childNodes[range.startOffset - 1] ?? null
          : getAdjacentNodeForCollapsedRange(editor, container, "before");
      nextNode =
        container.childNodes[range.startOffset] ??
        getAdjacentNodeForCollapsedRange(editor, container, "after");

      return {
        previousNode,
        nextNode,
      };
    }

    const textNode = range.startContainer;
    const textLength = textNode.textContent?.length ?? 0;
    if (range.startOffset === 0) {
      previousNode = getAdjacentNodeForCollapsedRange(editor, textNode, "before");
    }
    if (range.startOffset >= textLength) {
      nextNode = getAdjacentNodeForCollapsedRange(editor, textNode, "after");
    }

    return {
      previousNode,
      nextNode,
    };
  }

  function getRichImageElementFromRowNode(node: Node | null): HTMLElement | null {
    const row = getRichImageDeleteRowElementFromNode(node);
    if (!row) {
      return null;
    }

    return row.querySelector<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`);
  }

  function getRichImageElementFromNodeOrRow(node: Node | null): HTMLElement | null {
    const fromNode = getRichImageElementFromNode(node);
    if (fromNode) {
      return fromNode;
    }

    const fromRow = getRichImageElementFromRowNode(node);
    if (fromRow) {
      return fromRow;
    }

    return null;
  }

  function getAdjacentRichImageElementFromCollapsedSelection(
    editor: HTMLDivElement,
    direction: "before" | "after"
  ): HTMLElement | null {
    const range = getCollapsedSelectionRangeInEditor(editor);
    if (!range) {
      return null;
    }

    const { previousNode, nextNode } = getAdjacentNodesFromCollapsedRange(editor, range);
    const adjacentNode = direction === "before" ? previousNode : nextNode;

    const adjacentImage = getRichImageElementFromNodeOrRow(adjacentNode);
    if (!adjacentImage || !editor.contains(adjacentImage)) {
      return null;
    }

    return adjacentImage;
  }

  function getInterImageBreakTargetFromCollapsedSelection(
    editor: HTMLDivElement,
    direction: "before" | "after"
  ): {
    breakNode: HTMLBRElement;
    nextImage: HTMLElement;
  } | null {
    const range = getCollapsedSelectionRangeInEditor(editor);
    if (!range) {
      return null;
    }

    const { previousNode, nextNode } = getAdjacentNodesFromCollapsedRange(editor, range);
    const breakNode =
      direction === "before"
        ? previousNode instanceof HTMLBRElement
          ? previousNode
          : null
        : nextNode instanceof HTMLBRElement
          ? nextNode
          : null;
    if (!breakNode) {
      return null;
    }

    const previousRow = getRichImageDeleteRowElementFromNode(breakNode.previousSibling);
    const nextRow = getRichImageDeleteRowElementFromNode(breakNode.nextSibling);
    if (!previousRow || !nextRow) {
      return null;
    }

    const nextImage = nextRow.querySelector<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`);
    if (!nextImage || !editor.contains(nextImage)) {
      return null;
    }

    return {
      breakNode,
      nextImage,
    };
  }

  function placeCaretBeforeRichImage(imageNode: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const row = getRichImageDeleteRowElementByChild(imageNode);
    const anchorNode = row ?? imageNode;

    const range = document.createRange();
    range.setStartBefore(anchorNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAfterRichImage(imageNode: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const row = getRichImageDeleteRowElementByChild(imageNode);
    const anchorNode = row ?? imageNode;

    const range = document.createRange();
    range.setStartAfter(anchorNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getRichImageDeleteLineTargetFromLineBelowCaret(
    editor: HTMLDivElement
  ): {
    row: HTMLElement;
    line: HTMLElement;
    breakNode: HTMLBRElement;
    imageId: string;
  } | null {
    const range = getCollapsedSelectionRangeInEditor(editor);
    if (!range) {
      return null;
    }

    let previousNode: Node | null = null;
    let nextNode: Node | null = null;
    if (range.startContainer instanceof Element) {
      const container = range.startContainer;
      previousNode =
        range.startOffset > 0
          ? container.childNodes[range.startOffset - 1] ?? null
          : getAdjacentNodeForCollapsedRange(editor, container, "before");
      nextNode =
        container.childNodes[range.startOffset] ??
        getAdjacentNodeForCollapsedRange(editor, container, "after");
    } else {
      if (range.startOffset !== 0) {
        return null;
      }

      previousNode = getAdjacentNodeForCollapsedRange(editor, range.startContainer, "before");
      nextNode = range.startContainer;
    }

    if (!(previousNode instanceof HTMLBRElement)) {
      return null;
    }

    if (nextNode && !(nextNode instanceof HTMLBRElement)) {
      return null;
    }

    const row =
      previousNode.previousSibling instanceof HTMLElement &&
      previousNode.previousSibling.classList.contains(RICH_IMAGE_DELETE_ROW_CLASS_NAME)
        ? previousNode.previousSibling
        : null;
    if (!row) {
      return null;
    }

    const line = getRichImageDeleteLineElementFromRow(row);
    if (!line) {
      return null;
    }

    const imageId = line.getAttribute("data-rich-image-id")?.trim() ?? "";
    if (!imageId) {
      return null;
    }

    return {
      row,
      line,
      breakNode: previousNode,
      imageId,
    };
  }

  function placeCaretOnRichImageDeleteLine(line: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.setStartBefore(line);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretOnLineBelowRichImageRow(row: HTMLElement) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.setStartAfter(row);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretOutsideRichImageDeleteLine(line: HTMLElement) {
    const selection = window.getSelection();
    const row = getRichImageDeleteRowElementFromNode(line);
    if (!selection || !row) {
      return false;
    }

    const position = line.getAttribute("data-rich-image-buffer-position");
    const range = document.createRange();
    if (position === "before") {
      range.setStartBefore(row);
    } else {
      range.setStartAfter(row);
    }

    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function focusRichImageDeleteLineInScope(
    scope: RichEditorScope,
    line: HTMLElement
  ): RichImageSelection | null {
    const imageId = line.getAttribute("data-rich-image-id")?.trim() ?? "";
    if (!imageId) {
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      return null;
    }

    const lineSelection: RichImageSelection = {
      scope,
      imageId,
    };
    placeCaretOnRichImageDeleteLine(line);
    setSelectedRichImageInScope(scope, imageId);
    setActiveRichImageDeleteLine(lineSelection);
    return lineSelection;
  }

  function ensureRichImageDeleteLines(editor: HTMLDivElement) {
    const figures = Array.from(editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`));
    const expectedRows = new Set<HTMLElement>();

    for (const figure of figures) {
      const imageId = figure.getAttribute("data-rich-image-id")?.trim() ?? "";
      if (!imageId) {
        continue;
      }

      let row = getRichImageDeleteRowElementByChild(figure);
      if (!row) {
        row = createRichImageDeleteRowElement(editor.ownerDocument);
        figure.insertAdjacentElement("beforebegin", row);
      } else {
        normalizeRichImageDeleteRowElement(row);
      }

      row.setAttribute("data-rich-image-id", imageId);

      if (!row.contains(figure)) {
        row.appendChild(figure);
      }

      let beforeLine =
        getRichImageDeleteLineElementsFromRow(row).find(
          (line) => line.getAttribute("data-rich-image-buffer-position") === "before"
        ) ?? null;
      let afterLine =
        getRichImageDeleteLineElementsFromRow(row).find(
          (line) => line.getAttribute("data-rich-image-buffer-position") === "after"
        ) ?? null;

      if (!beforeLine) {
        beforeLine = createRichImageDeleteLineElement(editor.ownerDocument, imageId, "before");
      }
      if (!afterLine) {
        afterLine = createRichImageDeleteLineElement(editor.ownerDocument, imageId, "after");
      }

      normalizeRichImageDeleteLineElement(beforeLine, imageId, "before");
      normalizeRichImageDeleteLineElement(afterLine, imageId, "after");

      for (const childNode of Array.from(row.childNodes)) {
        if (childNode !== beforeLine && childNode !== figure && childNode !== afterLine) {
          childNode.remove();
        }
      }

      if (row.firstChild !== beforeLine) {
        row.insertBefore(beforeLine, row.firstChild);
      }
      if (beforeLine.nextSibling !== figure) {
        row.insertBefore(figure, beforeLine.nextSibling);
      }
      if (figure.nextSibling !== afterLine) {
        row.insertBefore(afterLine, figure.nextSibling);
      }

      expectedRows.add(row);

    }

    for (const line of Array.from(
      editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`)
    )) {
      const parentRow = getRichImageDeleteRowElementFromNode(line);
      if (!parentRow || !expectedRows.has(parentRow)) {
        line.remove();
      }
    }

    for (const row of Array.from(
      editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_DELETE_ROW_CLASS_NAME}`)
    )) {
      if (expectedRows.has(row)) {
        continue;
      }

      const hasImage = row.querySelector(`.${RICH_IMAGE_CLASS_NAME}`);
      if (hasImage && row.parentNode) {
        while (row.firstChild) {
          row.parentNode.insertBefore(row.firstChild, row);
        }
        row.remove();
        continue;
      }

      const nextBreak = row.nextSibling instanceof HTMLBRElement ? row.nextSibling : null;
      row.remove();
      nextBreak?.remove();
    }
  }

  function ensureRichFileRows(editor: HTMLDivElement) {
    const fileNodes = Array.from(
      editor.querySelectorAll<HTMLAnchorElement>(`a.${RICH_FILE_CLASS_NAME}`)
    );
    const expectedRows = new Set<HTMLElement>();

    for (const fileNode of fileNodes) {
      const fileId = fileNode.getAttribute("data-rich-file-id")?.trim() ?? "";
      if (!fileId) {
        continue;
      }

      fileNode.setAttribute("contenteditable", "false");
      fileNode.setAttribute("draggable", "true");

      let row = getRichFileRowElementByChild(fileNode);
      if (!row) {
        row = createRichFileRowElement(editor.ownerDocument);
        fileNode.insertAdjacentElement("beforebegin", row);
      } else {
        normalizeRichFileRowElement(row);
      }

      row.setAttribute("data-rich-file-id", fileId);

      if (!row.contains(fileNode)) {
        row.appendChild(fileNode);
      }

      let beforeLine =
        getRichFileLineElementsFromRow(row).find(
          (line) => line.getAttribute("data-rich-file-buffer-position") === "before"
        ) ?? null;
      let afterLine =
        getRichFileLineElementsFromRow(row).find(
          (line) => line.getAttribute("data-rich-file-buffer-position") === "after"
        ) ?? null;

      if (!beforeLine) {
        beforeLine = createRichFileLineElement(editor.ownerDocument, fileId, "before");
      }
      if (!afterLine) {
        afterLine = createRichFileLineElement(editor.ownerDocument, fileId, "after");
      }

      normalizeRichFileLineElement(beforeLine, fileId, "before");
      normalizeRichFileLineElement(afterLine, fileId, "after");

      for (const childNode of Array.from(row.childNodes)) {
        if (childNode !== beforeLine && childNode !== fileNode && childNode !== afterLine) {
          childNode.remove();
        }
      }

      if (row.firstChild !== beforeLine) {
        row.insertBefore(beforeLine, row.firstChild);
      }
      if (beforeLine.nextSibling !== fileNode) {
        row.insertBefore(fileNode, beforeLine.nextSibling);
      }
      if (fileNode.nextSibling !== afterLine) {
        row.insertBefore(afterLine, fileNode.nextSibling);
      }

      expectedRows.add(row);
    }

    for (const line of Array.from(
      editor.querySelectorAll<HTMLElement>(`.${RICH_FILE_LINE_CLASS_NAME}`)
    )) {
      const parentRow = getRichFileRowElementFromNode(line);
      if (!parentRow || !expectedRows.has(parentRow)) {
        line.remove();
      }
    }

    for (const row of Array.from(
      editor.querySelectorAll<HTMLElement>(`.${RICH_FILE_ROW_CLASS_NAME}`)
    )) {
      if (expectedRows.has(row)) {
        continue;
      }

      const fileNode = row.querySelector(`a.${RICH_FILE_CLASS_NAME}`);
      if (fileNode && row.parentNode) {
        while (row.firstChild) {
          row.parentNode.insertBefore(row.firstChild, row);
        }
        row.remove();
        continue;
      }

      row.remove();
    }
  }

  function hasRichImageArtifacts(editor: HTMLDivElement): boolean {
    return Boolean(
      editor.querySelector(
        [
          `.${RICH_IMAGE_CLASS_NAME}`,
          `.${RICH_IMAGE_ZONE_CLASS_NAME}`,
          `.${RICH_IMAGE_DELETE_ROW_CLASS_NAME}`,
          `.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`,
        ].join(",")
      )
    );
  }

  function ensureRichImageDeleteLinesIfNeeded(editor: HTMLDivElement): boolean {
    if (!hasRichImageArtifacts(editor)) {
      return false;
    }

    ensureRichImageDeleteLines(editor);
    return true;
  }

  function getRichImageElementFromEventTarget(
    target: EventTarget | null
  ): HTMLElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    const figure = target.closest<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`);
    if (!figure) {
      return null;
    }

    return figure;
  }

  function getRichFileElementFromEventTarget(
    target: EventTarget | null
  ): HTMLAnchorElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest<HTMLAnchorElement>(`a.${RICH_FILE_CLASS_NAME}`);
  }

  function getRichFileElementById(
    editor: HTMLDivElement,
    fileId: string
  ): HTMLAnchorElement | null {
    const normalizedId = fileId.trim();
    if (!normalizedId) {
      return null;
    }

    return (
      Array.from(editor.querySelectorAll<HTMLAnchorElement>(`a.${RICH_FILE_CLASS_NAME}`)).find(
        (node) => node.getAttribute("data-rich-file-id") === normalizedId
      ) ?? null
    );
  }

  function getRichFileElementFromNode(node: Node | null): HTMLAnchorElement | null {
    if (!node) {
      return null;
    }

    if (node instanceof HTMLAnchorElement && node.classList.contains(RICH_FILE_CLASS_NAME)) {
      return node;
    }

    if (node instanceof Element) {
      return (
        node.closest<HTMLAnchorElement>(`a.${RICH_FILE_CLASS_NAME}`) ??
        node.querySelector<HTMLAnchorElement>(`a.${RICH_FILE_CLASS_NAME}`)
      );
    }

    return (
      node.parentElement?.closest<HTMLAnchorElement>(`a.${RICH_FILE_CLASS_NAME}`) ?? null
    );
  }

  function createRichFileLineElement(
    ownerDocument: Document,
    fileId: string,
    position: "before" | "after"
  ): HTMLElement {
    const line = ownerDocument.createElement("span");
    line.className = RICH_FILE_LINE_CLASS_NAME;
    line.setAttribute("data-rich-file-id", fileId);
    line.setAttribute("data-rich-file-buffer-position", position);
    line.setAttribute("contenteditable", "false");
    line.setAttribute("draggable", "false");
    line.setAttribute("aria-hidden", "true");
    return line;
  }

  function normalizeRichFileLineElement(
    line: HTMLElement,
    fileId: string,
    position: "before" | "after"
  ) {
    line.classList.add(RICH_FILE_LINE_CLASS_NAME);
    line.setAttribute("data-rich-file-id", fileId);
    line.setAttribute("data-rich-file-buffer-position", position);
    line.setAttribute("contenteditable", "false");
    line.setAttribute("draggable", "false");
    line.setAttribute("aria-hidden", "true");
    line.textContent = "";
  }

  function createRichFileRowElement(ownerDocument: Document): HTMLElement {
    const row = ownerDocument.createElement("span");
    row.className = `${RICH_FILE_ZONE_CLASS_NAME} ${RICH_FILE_ROW_CLASS_NAME}`;
    row.setAttribute("data-rich-file-row", "true");
    row.setAttribute("contenteditable", "false");
    row.setAttribute("draggable", "false");
    return row;
  }

  function normalizeRichFileRowElement(row: HTMLElement) {
    row.classList.add(RICH_FILE_ZONE_CLASS_NAME);
    row.classList.add(RICH_FILE_ROW_CLASS_NAME);
    row.setAttribute("data-rich-file-row", "true");
    row.setAttribute("contenteditable", "false");
    row.setAttribute("draggable", "false");
  }

  function getRichFileRowElementByChild(child: Node | null): HTMLElement | null {
    if (!(child instanceof Node)) {
      return null;
    }

    const parent = child.parentElement;
    if (!parent || !parent.classList.contains(RICH_FILE_ROW_CLASS_NAME)) {
      return null;
    }

    return parent;
  }

  function getRichFileRowElementFromNode(node: Node | null): HTMLElement | null {
    if (!node) {
      return null;
    }

    if (
      node instanceof HTMLElement &&
      node.classList.contains(RICH_FILE_ROW_CLASS_NAME)
    ) {
      return node;
    }

    if (node instanceof Element) {
      return node.closest<HTMLElement>(`.${RICH_FILE_ROW_CLASS_NAME}`);
    }

    return node.parentElement?.closest<HTMLElement>(`.${RICH_FILE_ROW_CLASS_NAME}`) ?? null;
  }

  function getRichFileLineElementsFromRow(row: HTMLElement): HTMLElement[] {
    return Array.from(row.querySelectorAll<HTMLElement>(`.${RICH_FILE_LINE_CLASS_NAME}`));
  }

  function getRichFileLineElementFromEventTarget(
    target: EventTarget | null
  ): HTMLElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest<HTMLElement>(`.${RICH_FILE_LINE_CLASS_NAME}`);
  }

  function placeCaretOutsideRichFileLine(line: HTMLElement): boolean {
    const selection = window.getSelection();
    const row = getRichFileRowElementFromNode(line);
    if (!selection || !row) {
      return false;
    }

    const range = document.createRange();
    if (line.getAttribute("data-rich-file-buffer-position") === "before") {
      range.setStartBefore(row);
    } else {
      range.setStartAfter(row);
    }

    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function createRichFileRowWithFile(
    ownerDocument: Document,
    fileNode: HTMLAnchorElement,
    fileId: string
  ): HTMLElement {
    const row = createRichFileRowElement(ownerDocument);
    row.appendChild(createRichFileLineElement(ownerDocument, fileId, "before"));
    row.appendChild(fileNode);
    row.appendChild(createRichFileLineElement(ownerDocument, fileId, "after"));
    row.setAttribute("data-rich-file-id", fileId);
    return row;
  }

  function getRichFileElementFromNodeOrBreakNeighbor(
    node: Node | null,
    direction: "before" | "after"
  ): HTMLAnchorElement | null {
    const directMatch = getRichFileElementFromNode(node);
    if (directMatch) {
      return directMatch;
    }

    if (!(node instanceof HTMLBRElement)) {
      return null;
    }

    const neighbor = direction === "before" ? node.previousSibling : node.nextSibling;
    return getRichFileElementFromNode(neighbor);
  }

  function resolveRichFileDeleteSelectionFromEditorSelection(
    scope: RichEditorScope,
    editor: HTMLDivElement,
    key: "Backspace" | "Delete"
  ): RichFileSelection | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return null;
    }

    const toSelection = (fileNode: HTMLAnchorElement | null): RichFileSelection | null => {
      const fileId = fileNode?.getAttribute("data-rich-file-id")?.trim() ?? "";
      if (!fileId) {
        return null;
      }

      return {
        scope,
        fileId,
      };
    };

    const directMatch =
      getRichFileElementFromNode(range.startContainer) ??
      getRichFileElementFromNode(range.endContainer);
    if (directMatch && editor.contains(directMatch)) {
      return toSelection(directMatch);
    }

    if (!range.collapsed) {
      const fileInsideSelection = Array.from(
        editor.querySelectorAll<HTMLAnchorElement>(`a.${RICH_FILE_CLASS_NAME}`)
      ).find((fileNode) => {
        try {
          return range.intersectsNode(fileNode);
        } catch {
          return false;
        }
      });

      return toSelection(fileInsideSelection ?? null);
    }

    const { previousNode, nextNode } = getAdjacentNodesFromCollapsedRange(editor, range);
    const candidate =
      key === "Backspace"
        ? getRichFileElementFromNodeOrBreakNeighbor(previousNode, "before")
        : getRichFileElementFromNodeOrBreakNeighbor(nextNode, "after");

    return toSelection(candidate);
  }

  function deleteRichFileBySelection(selection: RichFileSelection): boolean {
    const editor = getEditorElement(selection.scope);
    if (!editor) {
      setRichFileDeleteConfirm(null);
      setRichFileDeleteConfirmRect(null);
      return false;
    }

    const fileNode = getRichFileElementById(editor, selection.fileId);
    if (!fileNode) {
      setRichFileDeleteConfirm(null);
      setRichFileDeleteConfirmRect(null);
      return false;
    }

    const fileRow = getRichFileRowElementByChild(fileNode);
    const removableNode = fileRow ?? fileNode;
    const trailingBreak =
      !fileRow && fileNode.nextSibling instanceof HTMLBRElement
        ? fileNode.nextSibling
        : null;
    const previousSibling = removableNode.previousSibling;
    const selectionApi = window.getSelection();

    pushEditorUndoSnapshot(selection.scope);
    removableNode.remove();
    trailingBreak?.remove();
    releaseRichFileObjectUrl(richFileObjectUrlsRef.current, selection.fileId);

    if (selectionApi) {
      const nextRange = document.createRange();
      if (previousSibling && previousSibling.parentNode === editor) {
        nextRange.setStartAfter(previousSibling);
      } else {
        nextRange.setStart(editor, 0);
      }
      nextRange.collapse(true);
      selectionApi.removeAllRanges();
      selectionApi.addRange(nextRange);
    }

    setRichFileDeleteConfirm(null);
    setRichFileDeleteConfirmRect(null);
    applyEditorDomValueRef.current(selection.scope, editor);
    rememberRichSelectionRef.current(selection.scope);
    syncRichToolbarStateRef.current(selection.scope);
    return true;
  }

  function detectRichImageResizeEdge(
    imageNode: HTMLElement,
    clientX: number,
    clientY: number
  ): RichImageResizeEdge | null {
    const rect = imageNode.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const hit = Math.min(
      RICH_IMAGE_EDGE_HIT_SIZE,
      Math.floor(rect.width / 3),
      Math.floor(rect.height / 3)
    );

    if (hit < 4) {
      return null;
    }

    const leftDistance = Math.abs(clientX - rect.left);
    const rightDistance = Math.abs(rect.right - clientX);
    const topDistance = Math.abs(clientY - rect.top);
    const bottomDistance = Math.abs(rect.bottom - clientY);

    const candidates = [
      { edge: "left" as RichImageResizeEdge, distance: leftDistance },
      { edge: "right" as RichImageResizeEdge, distance: rightDistance },
      { edge: "top" as RichImageResizeEdge, distance: topDistance },
      { edge: "bottom" as RichImageResizeEdge, distance: bottomDistance },
    ].filter((entry) => entry.distance <= hit);

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => left.distance - right.distance);
    return candidates[0]?.edge ?? null;
  }

  function setSelectedRichImageInScope(scope: RichEditorScope, imageId: string) {
    setActiveRichEditorIfChanged(scope);
    setSelectedRichImage({
      scope,
      imageId,
    });
  }

  function getRangeFromPointInEditor(
    editor: HTMLDivElement,
    clientX: number,
    clientY: number
  ): Range | null {
    const documentWithCaret = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    };

    const directRange = documentWithCaret.caretRangeFromPoint?.(clientX, clientY);
    if (directRange) {
      if (
        editor.contains(directRange.startContainer) &&
        editor.contains(directRange.endContainer)
      ) {
        return directRange;
      }

      return null;
    }

    const position = documentWithCaret.caretPositionFromPoint?.(clientX, clientY);
    if (!position || !editor.contains(position.offsetNode)) {
      return null;
    }

    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  function placeCaretAtEditorPoint(
    editor: HTMLDivElement,
    clientX: number,
    clientY: number
  ) {
    const pointRange = getRangeFromPointInEditor(editor, clientX, clientY);
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    if (!pointRange) {
      placeCaretAtEditorEnd(editor);
      return;
    }

    selection.removeAllRanges();
    selection.addRange(pointRange);
  }

  function ensureSelectionRangeInEditor(editor: HTMLDivElement): Range | null {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
        return range;
      }
    }

    placeCaretAtEditorEnd(editor);
    const nextSelection = window.getSelection();
    if (!nextSelection || nextSelection.rangeCount === 0) {
      return null;
    }

    return nextSelection.getRangeAt(0);
  }

  function normalizeRichImageInsertionRange(
    editor: HTMLDivElement,
    sourceRange: Range
  ): Range {
    const range = sourceRange.cloneRange();
    if (!range.collapsed) {
      range.collapse(false);
    }

    if (range.startContainer instanceof Text) {
      const textNode = range.startContainer;
      const textLength = textNode.textContent?.length ?? 0;
      if (range.startOffset > 0 && range.startOffset < textLength) {
        range.setStartAfter(textNode);
        range.collapse(true);
      }
    }

    let containerNode: Node | null =
      range.startContainer instanceof Text
        ? range.startContainer.parentNode
        : range.startContainer;

    while (containerNode && containerNode !== editor && containerNode.parentNode !== editor) {
      containerNode = containerNode.parentNode;
    }

    if (containerNode && containerNode !== editor && containerNode.parentNode === editor) {
      range.setStartAfter(containerNode);
      range.collapse(true);
    }

    return range;
  }

  function insertRichImageAtCurrentSelection(
    scope: RichEditorScope,
    editor: HTMLDivElement,
    src: string,
    options?: {
      width?: number;
    }
  ): string | null {
    const safeSrc = normalizeRichImageSource(src);
    if (!safeSrc) {
      return null;
    }

    const selectionRange = ensureSelectionRangeInEditor(editor);
    if (!selectionRange) {
      return null;
    }

    const range = normalizeRichImageInsertionRange(editor, selectionRange);
    pushEditorUndoSnapshot(scope);

    const imageNode = createRichImageBlockElement(editor.ownerDocument, safeSrc, {
      width: options?.width,
      displayScale: editorDisplayScale,
    });
    const imageId = imageNode.getAttribute("data-rich-image-id") ?? "";
    const imageRowNode = createRichImageDeleteRowWithImage(
      editor.ownerDocument,
      imageNode,
      imageId
    );

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    range.insertNode(imageRowNode);

    if (selection) {
      placeCaretAfterRichImage(imageNode);
    }

    setSelectedRichImageInScope(scope, imageId);
    setActiveRichImageDeleteLine(null);
    return imageId;
  }

  function insertRichFileAtCurrentSelection(
    scope: RichEditorScope,
    editor: HTMLDivElement,
    fileMeta: {
      src: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }
  ): string | null {
    const safeSrc = normalizeRichFileSource(fileMeta.src);
    if (!safeSrc) {
      return null;
    }

    const selectionRange = ensureSelectionRangeInEditor(editor);
    if (!selectionRange) {
      return null;
    }

    const range = normalizeRichImageInsertionRange(editor, selectionRange);
    pushEditorUndoSnapshot(scope);

    const fileNode = createRichFileAttachmentElement(editor.ownerDocument, {
      src: safeSrc,
      fileName: fileMeta.fileName,
      mimeType: fileMeta.mimeType,
      sizeBytes: fileMeta.sizeBytes,
    });
    const fileId = fileNode.getAttribute("data-rich-file-id") ?? "";
    const fileRowNode = createRichFileRowWithFile(
      editor.ownerDocument,
      fileNode,
      fileId
    );

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    range.insertNode(fileRowNode);

    if (selection) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(fileRowNode);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
    }

    setSelectedRichImage(null);
    setActiveRichImageDeleteLine(null);
    setActiveRichEditor(scope);
    return fileId || null;
  }

  async function insertRichImagesFromFiles(
    scope: RichEditorScope,
    editor: HTMLDivElement,
    files: File[]
  ): Promise<number> {
    let insertedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      const imageDataUrl = await fileToRichImageDataUrl(file);
      if (!imageDataUrl) {
        skippedCount += 1;
        continue;
      }

      const insertedId = insertRichImageAtCurrentSelection(scope, editor, imageDataUrl);
      if (!insertedId) {
        skippedCount += 1;
        continue;
      }

      insertedCount += 1;
    }

    if (insertedCount > 0) {
      applyEditorDomValue(scope, editor);
      rememberRichSelection(scope);
      syncRichToolbarState(scope);
    }

    if (skippedCount > 0) {
      pushNotice(
        "Некоторые файлы пропущены: поддерживаются PNG, JPG, WEBP, GIF, BMP до 8MB.",
        "warn"
      );
    }

    return insertedCount;
  }

  async function insertRichFilesFromFiles(
    scope: RichEditorScope,
    editor: HTMLDivElement,
    files: File[]
  ): Promise<number> {
    let insertedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      const fileData = await fileToRichFileData(file);
      if (!fileData) {
        skippedCount += 1;
        continue;
      }

      const insertedId = insertRichFileAtCurrentSelection(scope, editor, fileData);
      if (!insertedId) {
        skippedCount += 1;
        continue;
      }

      insertedCount += 1;
    }

    if (insertedCount > 0) {
      applyEditorDomValue(scope, editor);
      rememberRichSelection(scope);
      syncRichToolbarState(scope);
    }

    if (skippedCount > 0) {
      pushNotice(
        "Некоторые файлы пропущены: максимальный размер файла 16MB.",
        "warn"
      );
    }

    return insertedCount;
  }

  function clearActiveRichImageResize(pointerId?: number) {
    const resizeState = richImageResizeStateRef.current;
    if (!resizeState) {
      return;
    }

    if (typeof pointerId === "number" && resizeState.pointerId !== pointerId) {
      return;
    }

    try {
      if (resizeState.figure.hasPointerCapture(resizeState.pointerId)) {
        resizeState.figure.releasePointerCapture(resizeState.pointerId);
      }
    } catch {
      // ignore capture errors
    }

    resizeState.figure.classList.remove(RICH_IMAGE_RESIZING_CLASS_NAME);
    richImageResizeStateRef.current = null;
  }

  function resolveRichEditorScope(): RichEditorScope | null {
    if (activeRichEditor) {
      return activeRichEditor;
    }

    if (!currentCategory) {
      return null;
    }

    if (currentCategory.format === "continuous") {
      return {
        kind: "continuous",
      };
    }

    if (
      selectedMessage &&
      !isSpecialMessageContent(selectedMessage.content)
    ) {
      return {
        kind: "block",
        messageId: selectedMessage.id,
      };
    }

    const firstEditableMessage = currentMessages.find(
      (message) => !isSpecialMessageContent(message.content)
    );

    if (!firstEditableMessage) {
      return null;
    }

    return {
      kind: "block",
      messageId: firstEditableMessage.id,
    };
  }

  function placeCaretAtEditorEnd(editor: HTMLDivElement) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function rememberRichSelection(scope: RichEditorScope) {
    const editor = getEditorElement(scope);
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0) {
      savedRichSelectionRef.current = null;
      return;
    }

    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return;
    }

    savedRichSelectionRef.current = {
      scope,
      range: range.cloneRange(),
    };
  }

  function restoreRichSelection(scope: RichEditorScope): boolean {
    const editor = getEditorElement(scope);
    const savedSelection = savedRichSelectionRef.current;
    const selection = window.getSelection();

    if (!editor || !savedSelection || !selection) {
      return false;
    }

    if (!isSameRichEditorScope(savedSelection.scope, scope)) {
      return false;
    }

    const savedRange = savedSelection.range;
    if (!savedRange.startContainer.isConnected || !savedRange.endContainer.isConnected) {
      savedRichSelectionRef.current = null;
      return false;
    }

    if (
      !editor.contains(savedRange.startContainer) ||
      !editor.contains(savedRange.endContainer)
    ) {
      savedRichSelectionRef.current = null;
      return false;
    }

    try {
      const rangeToRestore = savedRange.cloneRange();
      selection.removeAllRanges();
      selection.addRange(rangeToRestore);
      return true;
    } catch {
      savedRichSelectionRef.current = null;
      return false;
    }
  }

  function syncRichToolbarState(scope: RichEditorScope | null = activeRichEditor) {
    if (!scope) {
      setRichToolbarState((prev) => {
        if (!prev.bold && !prev.italic) {
          return prev;
        }

        return {
          ...prev,
          bold: false,
          italic: false,
        };
      });
      return;
    }

    const editor = getEditorElement(scope);
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return;
    }

    const nextBold = document.queryCommandState("bold");
    const nextItalic = document.queryCommandState("italic");
    const nextColor = normalizeCssColorToHex(document.queryCommandValue("foreColor"));

    setRichToolbarState((prev) => {
      const resolvedColor = nextColor ?? prev.color;
      if (
        prev.bold === nextBold &&
        prev.italic === nextItalic &&
        prev.color === resolvedColor
      ) {
        return prev;
      }

      return {
        bold: nextBold,
        italic: nextItalic,
        color: resolvedColor,
      };
    });

    if (nextColor) {
      setCustomTextColor(nextColor);
    }
  }

  function focusRichEditorForToolbar(scope: RichEditorScope): HTMLDivElement | null {
    const editor = getEditorElement(scope);
    if (!editor) {
      return null;
    }

    ensureRichImageDeleteLines(editor);

    if (scope.kind === "block") {
      setSelectedMessageId(scope.messageId);
    } else {
      setSelectedMessageId(null);
    }

    setActiveRichEditorIfChanged(scope);
    editor.focus();

    const restored = restoreRichSelection(scope);
    if (!restored) {
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode ?? null;
      const hasSelectionInEditor =
        Boolean(anchorNode) && editor.contains(anchorNode);
      if (!hasSelectionInEditor) {
        placeCaretAtEditorEnd(editor);
      }
    }

    return editor;
  }

  function applyEditorDomValue(scope: RichEditorScope, editor: HTMLDivElement): void {
    const normalizedHtml = sanitizeRichTextHtml(editor.innerHTML);

    if (scope.kind === "continuous") {
      if (continuousDraft === normalizedHtml) {
        return;
      }

      syncContinuousContentChange(currentCategory?.id ?? null, normalizedHtml);
      return;
    }

    const currentValue =
      currentMessages.find((message) => message.id === scope.messageId)?.content ?? "";
    if (currentValue === normalizedHtml) {
      return;
    }

    syncMessageContentChange(currentCategoryId, scope.messageId, normalizedHtml);
  }

  function normalizeEditorLinks(editor: HTMLDivElement) {
    const anchors = Array.from(editor.querySelectorAll("a"));
    for (const anchor of anchors) {
      const isRichFileLink =
        anchor.classList.contains(RICH_FILE_CLASS_NAME) ||
        anchor.getAttribute("data-rich-file") === "true";
      if (isRichFileLink) {
        continue;
      }

      const safeHref = normalizeRichLinkUrl(anchor.getAttribute("href") ?? "");
      if (!safeHref) {
        const parent = anchor.parentNode;
        if (!parent) {
          continue;
        }

        while (anchor.firstChild) {
          parent.insertBefore(anchor.firstChild, anchor);
        }
        parent.removeChild(anchor);
        continue;
      }

      anchor.setAttribute("href", safeHref);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }

  function runRichTextCommand(command: "bold" | "italic" | "foreColor", value?: string) {
    const scope = resolveRichEditorScope();
    if (!scope) {
      pushNotice("Выбери текстовый редактор для форматирования.", "warn");
      return;
    }

    const editor = focusRichEditorForToolbar(scope);
    if (!editor) {
      pushNotice("Не удалось открыть редактор текста.", "error");
      return;
    }

    pushEditorUndoSnapshot(scope);
    document.execCommand(command, false, value);
    normalizeEditorLinks(editor);
    applyEditorDomValue(scope, editor);
    rememberRichSelection(scope);
    syncRichToolbarState(scope);
  }

  function handleToolbarBold() {
    setShowTextColorPalette(false);
    runRichTextCommand("bold");
  }

  function handleToolbarItalic() {
    setShowTextColorPalette(false);
    runRichTextCommand("italic");
  }

  function handleToolbarColorChange(color: string) {
    const normalizedColor = normalizeHexColor(color) ?? DEFAULT_TEXT_COLOR;
    setCustomTextColor(normalizedColor);
    runRichTextCommand("foreColor", normalizedColor);
    setShowTextColorPalette(false);
  }

  function toggleToolbarColorPalette() {
    if (!canUseRichToolbar) {
      return;
    }

    const scope = resolveRichEditorScope();
    if (scope) {
      rememberRichSelection(scope);
    }

    setShowTextColorPalette((prev) => !prev);
  }

  function handleToolbarImage() {
    if (!canUseRichToolbar) {
      return;
    }

    const scope = resolveRichEditorScope();
    if (!scope) {
      pushNotice("Выбери текстовый редактор для добавления фото.", "warn");
      return;
    }

    const editor = focusRichEditorForToolbar(scope);
    if (!editor) {
      pushNotice("Не удалось открыть редактор текста.", "error");
      return;
    }

    setShowTextColorPalette(false);
    rememberRichSelection(scope);
    richImageFileRef.current?.click();
  }

  function handleToolbarFile() {
    if (!canUseRichToolbar) {
      return;
    }

    const scope = resolveRichEditorScope();
    if (!scope) {
      pushNotice("Выбери текстовый редактор для добавления файла.", "warn");
      return;
    }

    const editor = focusRichEditorForToolbar(scope);
    if (!editor) {
      pushNotice("Не удалось открыть редактор текста.", "error");
      return;
    }

    setShowTextColorPalette(false);
    rememberRichSelection(scope);
    richFileRef.current?.click();
  }

  async function handleToolbarImageInputChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const scope = resolveRichEditorScope();
    if (!scope) {
      pushNotice("Выбери текстовый редактор для добавления фото.", "warn");
      return;
    }

    const editor = focusRichEditorForToolbar(scope);
    if (!editor) {
      pushNotice("Не удалось открыть редактор текста.", "error");
      return;
    }

    if (!restoreRichSelection(scope)) {
      placeCaretAtEditorEnd(editor);
    }

    const inserted = await insertRichImagesFromFiles(scope, editor, files);
    if (inserted > 0) {
      pushNotice(`Добавлено фото: ${inserted}.`);
    }
  }

  async function handleToolbarFileInputChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const scope = resolveRichEditorScope();
    if (!scope) {
      pushNotice("Выбери текстовый редактор для добавления файла.", "warn");
      return;
    }

    const editor = focusRichEditorForToolbar(scope);
    if (!editor) {
      pushNotice("Не удалось открыть редактор текста.", "error");
      return;
    }

    if (!restoreRichSelection(scope)) {
      placeCaretAtEditorEnd(editor);
    }

    const inserted = await insertRichFilesFromFiles(scope, editor, files);
    if (inserted > 0) {
      pushNotice(`Добавлено файлов: ${inserted}.`);
    }
  }

  function collectImageFilesFromTransfer(dataTransfer: DataTransfer): File[] {
    return Array.from(dataTransfer.files).filter((file) => isSupportedRichImageFile(file));
  }

  function collectAttachmentFilesFromTransfer(dataTransfer: DataTransfer): File[] {
    return Array.from(dataTransfer.files).filter((file) => !isSupportedRichImageFile(file));
  }

  function moveDraggedRichImageToDropTarget(
    targetScope: RichEditorScope,
    targetEditor: HTMLDivElement
  ): boolean {
    const draggedImage = draggedRichImageRef.current;
    if (!draggedImage) {
      return false;
    }

    const sourceEditor = getEditorElement(draggedImage.scope);
    if (!sourceEditor) {
      draggedRichImageRef.current = null;
      return false;
    }

    const sourceImageNode = getRichImageElementById(sourceEditor, draggedImage.imageId);
    if (!sourceImageNode) {
      draggedRichImageRef.current = null;
      return false;
    }

    const selectionRange = ensureSelectionRangeInEditor(targetEditor);
    if (!selectionRange) {
      draggedRichImageRef.current = null;
      return false;
    }

    const sourceRow = getRichImageDeleteRowElementByChild(sourceImageNode);
    if (
      sourceImageNode.contains(selectionRange.startContainer) ||
      sourceRow?.contains(selectionRange.startContainer)
    ) {
      draggedRichImageRef.current = null;
      sourceImageNode.classList.remove(RICH_IMAGE_DRAGGING_CLASS_NAME);
      return false;
    }

    pushEditorUndoSnapshots(
      isSameRichEditorScope(draggedImage.scope, targetScope)
        ? [targetScope]
        : [draggedImage.scope, targetScope]
    );

    if (sourceRow) {
      sourceRow.remove();
    } else {
      const sourceDeleteLine = getRichImageDeleteLineElementById(
        sourceEditor,
        draggedImage.imageId
      );
      sourceImageNode.remove();
      sourceDeleteLine?.remove();
    }
    sourceImageNode.classList.remove(RICH_IMAGE_DRAGGING_CLASS_NAME);

    const targetRange = ensureSelectionRangeInEditor(targetEditor);
    if (!targetRange) {
      draggedRichImageRef.current = null;
      return false;
    }

    const insertionRange = normalizeRichImageInsertionRange(targetEditor, targetRange);

    const imageRowNode = createRichImageDeleteRowWithImage(
      targetEditor.ownerDocument,
      sourceImageNode,
      draggedImage.imageId
    );

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(insertionRange);
    }

    insertionRange.insertNode(imageRowNode);
    ensureRichImageDeleteLines(sourceEditor);
    ensureRichImageDeleteLines(targetEditor);

    if (selection) {
      placeCaretAfterRichImage(sourceImageNode);
    }

    if (isSameRichEditorScope(draggedImage.scope, targetScope)) {
      applyEditorDomValue(targetScope, targetEditor);
    } else {
      applyEditorDomValue(draggedImage.scope, sourceEditor);
      applyEditorDomValue(targetScope, targetEditor);
    }

    setSelectedRichImageInScope(targetScope, draggedImage.imageId);
    setActiveRichImageDeleteLine(null);
    rememberRichSelection(targetScope);
    syncRichToolbarState(targetScope);
    draggedRichImageRef.current = null;
    return true;
  }

  function moveDraggedRichFileToDropTarget(
    targetScope: RichEditorScope,
    targetEditor: HTMLDivElement
  ): boolean {
    const draggedFile = draggedRichFileRef.current;
    if (!draggedFile) {
      return false;
    }

    const sourceEditor = getEditorElement(draggedFile.scope);
    if (!sourceEditor) {
      draggedRichFileRef.current = null;
      return false;
    }

    const sourceFileNode = getRichFileElementById(sourceEditor, draggedFile.fileId);
    if (!sourceFileNode) {
      draggedRichFileRef.current = null;
      return false;
    }

    const selectionRange = ensureSelectionRangeInEditor(targetEditor);
    if (!selectionRange) {
      draggedRichFileRef.current = null;
      return false;
    }

    const sourceRow = getRichFileRowElementByChild(sourceFileNode);
    if (
      sourceFileNode.contains(selectionRange.startContainer) ||
      sourceRow?.contains(selectionRange.startContainer)
    ) {
      draggedRichFileRef.current = null;
      sourceFileNode.classList.remove(RICH_FILE_DRAGGING_CLASS_NAME);
      sourceRow?.classList.remove(RICH_FILE_DRAGGING_CLASS_NAME);
      return false;
    }

    pushEditorUndoSnapshots(
      isSameRichEditorScope(draggedFile.scope, targetScope)
        ? [targetScope]
        : [draggedFile.scope, targetScope]
    );

    if (sourceRow) {
      sourceRow.remove();
    } else {
      sourceFileNode.remove();
    }
    sourceFileNode.classList.remove(RICH_FILE_DRAGGING_CLASS_NAME);
    sourceRow?.classList.remove(RICH_FILE_DRAGGING_CLASS_NAME);

    const targetRange = ensureSelectionRangeInEditor(targetEditor);
    if (!targetRange) {
      draggedRichFileRef.current = null;
      return false;
    }

    const insertionRange = normalizeRichImageInsertionRange(targetEditor, targetRange);
    const fileRowNode = createRichFileRowWithFile(
      targetEditor.ownerDocument,
      sourceFileNode,
      draggedFile.fileId
    );
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(insertionRange);
    }

    insertionRange.insertNode(fileRowNode);
    ensureRichFileRows(sourceEditor);
    ensureRichFileRows(targetEditor);

    if (selection) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(fileRowNode);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
    }

    if (isSameRichEditorScope(draggedFile.scope, targetScope)) {
      applyEditorDomValue(targetScope, targetEditor);
    } else {
      applyEditorDomValue(draggedFile.scope, sourceEditor);
      applyEditorDomValue(targetScope, targetEditor);
    }

    setSelectedRichImage(null);
    setActiveRichImageDeleteLine(null);
    rememberRichSelection(targetScope);
    syncRichToolbarState(targetScope);
    draggedRichFileRef.current = null;
    return true;
  }

  function handleRichEditorPointerDown(
    scope: RichEditorScope,
    event: React.PointerEvent<HTMLDivElement>
  ) {
    if (event.button !== 0) {
      return;
    }

    const editor = getEditorElement(scope);
    if (!editor) {
      return;
    }

    const fileLineNode = getRichFileLineElementFromEventTarget(event.target);
    if (fileLineNode && editor.contains(fileLineNode)) {
      editor.focus();
      if (placeCaretOutsideRichFileLine(fileLineNode)) {
        event.preventDefault();
        event.stopPropagation();
      }
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      clearActiveRichImageResize(event.pointerId);
      return;
    }

    const deleteLineNode = getRichImageDeleteLineElementFromEventTarget(event.target);
    const imageNode = getRichImageElementFromEventTarget(event.target);
    if (deleteLineNode || imageNode) {
      ensureRichImageDeleteLinesIfNeeded(editor);
    }

    if (deleteLineNode && editor.contains(deleteLineNode)) {
      editor.focus();
      if (!focusRichImageDeleteLineInScope(scope, deleteLineNode)) {
        setSelectedRichImage(null);
        setActiveRichImageDeleteLine(null);
        clearActiveRichImageResize(event.pointerId);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      clearActiveRichImageResize(event.pointerId);
      return;
    }

    if (!imageNode || !editor.contains(imageNode)) {
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      clearActiveRichImageResize(event.pointerId);
      return;
    }

    const imageId = imageNode.getAttribute("data-rich-image-id")?.trim();
    if (!imageId) {
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      clearActiveRichImageResize(event.pointerId);
      return;
    }

    const isDeleteConfirmTarget = Boolean(
      richImageDeleteConfirm &&
        richImageDeleteConfirm.imageId === imageId &&
        isSameRichEditorScope(richImageDeleteConfirm.scope, scope)
    );
    if (isDeleteConfirmTarget) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    setSelectedRichImageInScope(scope, imageId);
    setActiveRichImageDeleteLine(null);

    const resizeEdge = detectRichImageResizeEdge(imageNode, event.clientX, event.clientY);
    if (!resizeEdge) {
      clearActiveRichImageResize(event.pointerId);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    pushEditorUndoSnapshot(scope);
    clearActiveRichImageResize();
    const displayScale = editorDisplayScale;
    const currentWidth = clampRichImageWidth(
      imageNode.getBoundingClientRect().width / displayScale
    );
    applyRichImageWidth(imageNode, currentWidth, displayScale);
    imageNode.classList.add(RICH_IMAGE_RESIZING_CLASS_NAME);
    try {
      imageNode.setPointerCapture(event.pointerId);
    } catch {
      // ignore capture errors
    }
    richImageResizeStateRef.current = {
      pointerId: event.pointerId,
      scope,
      imageId,
      edge: resizeEdge,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: currentWidth,
      displayScale,
      editor,
      figure: imageNode,
    };
  }

  function handleRichEditorDragStart(
    scope: RichEditorScope,
    event: DragEvent<HTMLElement>
  ) {
    const editor = getEditorElement(scope);
    if (!editor) {
      return;
    }

    const imageNode = getRichImageElementFromEventTarget(event.target);
    if (imageNode && editor.contains(imageNode)) {
      const imageId = imageNode.getAttribute("data-rich-image-id")?.trim();
      const isDeleteConfirmTarget = Boolean(
        richImageDeleteConfirm &&
          richImageDeleteConfirm.imageId === imageId &&
          isSameRichEditorScope(richImageDeleteConfirm.scope, scope)
      );
      if (!imageId || richImageResizeStateRef.current || isDeleteConfirmTarget) {
        event.preventDefault();
        return;
      }

      draggedRichImageRef.current = {
        scope,
        imageId,
      };

      imageNode.classList.add(RICH_IMAGE_DRAGGING_CLASS_NAME);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `rich-image:${imageId}`);
      }

      setSelectedRichImageInScope(scope, imageId);
      return;
    }

    const fileNode = getRichFileElementFromEventTarget(event.target);
    if (!fileNode || !editor.contains(fileNode)) {
      return;
    }

    const fileId = fileNode.getAttribute("data-rich-file-id")?.trim();
    const isFileDeleteConfirmTarget = Boolean(
      richFileDeleteConfirm &&
        richFileDeleteConfirm.fileId === fileId &&
        isSameRichEditorScope(richFileDeleteConfirm.scope, scope)
    );
    if (!fileId || isFileDeleteConfirmTarget) {
      event.preventDefault();
      return;
    }

    draggedRichFileRef.current = {
      scope,
      fileId,
    };

    fileNode.classList.add(RICH_FILE_DRAGGING_CLASS_NAME);
    getRichFileRowElementByChild(fileNode)?.classList.add(RICH_FILE_DRAGGING_CLASS_NAME);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `rich-file:${fileId}`);
    }

    setSelectedRichImage(null);
    setActiveRichImageDeleteLine(null);
  }

  function handleRichEditorDragEnd(event: DragEvent<HTMLElement>) {
    draggedRichImageRef.current = null;
    draggedRichFileRef.current = null;

    for (const node of Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        `.${RICH_IMAGE_DRAGGING_CLASS_NAME}, .${RICH_FILE_DRAGGING_CLASS_NAME}`
      )
    )) {
      node.classList.remove(RICH_IMAGE_DRAGGING_CLASS_NAME);
      node.classList.remove(RICH_FILE_DRAGGING_CLASS_NAME);
    }
  }

  function handleRichEditorClick(
    scope: RichEditorScope,
    event: React.MouseEvent<HTMLDivElement>
  ) {
    const editor = getEditorElement(scope);
    if (!editor) {
      return;
    }

    const fileLink = getRichFileElementFromEventTarget(event.target);
    if (!fileLink || !editor.contains(fileLink)) {
      return;
    }

    const rect = fileLink.getBoundingClientRect();
    const clickOffsetX = event.clientX - rect.left;
    const openButtonZoneWidth = Math.max(42, Math.min(rect.width, 56));
    if (clickOffsetX > openButtonZoneWidth) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const safeHref = normalizeRichFileSource(fileLink.getAttribute("href") ?? "");
    if (!safeHref) {
      pushNotice("Не удалось открыть файл: ссылка повреждена.", "warn");
      return;
    }

    if (safeHref.startsWith("data:") && isRichFilePdf(fileLink)) {
      const pdfBlob = richFileDataUrlToBlob(safeHref);
      if (!pdfBlob) {
        pushNotice("Не удалось открыть PDF: файл повреждён.", "warn");
        return;
      }

      const fileName = getRichFileLinkName(fileLink);
      const viewerId = crypto.randomUUID();
      const viewerHref = buildPdfViewerHref(viewerId, fileName);
      const viewerWindow = openPendingPdfViewerWindow(fileName);
      if (!viewerWindow) {
        pushNotice("Не удалось открыть PDF: браузер не создал вкладку.", "warn");
        return;
      }

      void storePdfViewerFile({
        id: viewerId,
        fileName,
        mimeType: "application/pdf",
        sizeBytes:
          normalizeRichFileSizeBytes(
            fileLink.getAttribute("data-rich-file-size-bytes") ?? ""
          ) ?? pdfBlob.size,
        blob: pdfBlob,
        createdAt: Date.now(),
      })
        .then(() => {
          viewerWindow.location.href = viewerHref;
          try {
            viewerWindow.opener = null;
          } catch {
            return;
          }
        })
        .catch(() => {
          try {
            viewerWindow.close();
          } catch {
            return;
          }
          pushNotice("Не удалось передать PDF в новую вкладку. Попробуй открыть ещё раз.", "warn");
        });
      return;
    }

    const fileId = fileLink.getAttribute("data-rich-file-id")?.trim() ?? "";
    const openHref = getRichFileOpenHref(
      richFileObjectUrlsRef.current,
      fileId,
      safeHref
    );
    if (!openHref || !openRichFileHref(fileLink.ownerDocument, openHref)) {
      pushNotice("Не удалось открыть файл: ссылка повреждена.", "warn");
    }
  }

  function handleRichEditorDragOver(event: DragEvent<HTMLElement>) {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }

    const hasDraggedRichImage = Boolean(draggedRichImageRef.current);
    const hasDraggedRichFile = Boolean(draggedRichFileRef.current);
    const hasFilePayload = Array.from(transfer.types ?? []).includes("Files");
    const hasSupportedFile =
      hasFilePayload &&
      (Array.from(transfer.items ?? []).some((item) => item.kind === "file") ||
        transfer.items.length === 0);

    if (!hasDraggedRichImage && !hasDraggedRichFile && !hasSupportedFile) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    transfer.dropEffect = hasSupportedFile ? "copy" : "move";
  }

  async function handleRichEditorDrop(
    scope: RichEditorScope,
    event: DragEvent<HTMLElement>
  ) {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }

    const droppedImageFiles = collectImageFilesFromTransfer(transfer);
    const droppedAttachmentFiles = collectAttachmentFilesFromTransfer(transfer);
    const hasDraggedRichImage = Boolean(draggedRichImageRef.current);
    const hasDraggedRichFile = Boolean(draggedRichFileRef.current);
    const hasFilePayload = Array.from(transfer.types ?? []).includes("Files");
    if (!hasDraggedRichImage && !hasDraggedRichFile && !hasFilePayload) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (
      !hasDraggedRichImage &&
      !hasDraggedRichFile &&
      droppedImageFiles.length === 0 &&
      droppedAttachmentFiles.length === 0
    ) {
      pushNotice(
        "Не удалось распознать файлы для загрузки.",
        "warn"
      );
      return;
    }

    const editor = getEditorElement(scope);
    if (!editor) {
      draggedRichImageRef.current = null;
      draggedRichFileRef.current = null;
      return;
    }

    ensureRichImageDeleteLines(editor);
    ensureRichFileRows(editor);

    if (scope.kind === "block") {
      setSelectedMessageId(scope.messageId);
    } else {
      setSelectedMessageId(null);
    }

    setActiveRichEditorIfChanged(scope);
    editor.focus();
    placeCaretAtEditorPoint(editor, event.clientX, event.clientY);

    if (hasDraggedRichImage) {
      moveDraggedRichImageToDropTarget(scope, editor);
    }
    if (hasDraggedRichFile) {
      moveDraggedRichFileToDropTarget(scope, editor);
    }

    let insertedImages = 0;
    let insertedFiles = 0;

    if (droppedImageFiles.length > 0) {
      insertedImages = await insertRichImagesFromFiles(scope, editor, droppedImageFiles);
    }

    if (droppedAttachmentFiles.length > 0) {
      insertedFiles = await insertRichFilesFromFiles(scope, editor, droppedAttachmentFiles);
    }

    if (insertedImages > 0 && insertedFiles > 0) {
      pushNotice(`Добавлено: фото ${insertedImages}, файлов ${insertedFiles}.`);
    } else if (insertedImages > 0) {
      pushNotice(`Добавлено фото: ${insertedImages}.`);
    } else if (insertedFiles > 0) {
      pushNotice(`Добавлено файлов: ${insertedFiles}.`);
    }

    ensureRichImageDeleteLines(editor);
    ensureRichFileRows(editor);
  }

  function cancelRichImageDeleteConfirmation() {
    setRichImageDeleteConfirm(null);
    setRichImageDeleteConfirmRect(null);
  }

  function cancelRichFileDeleteConfirmation() {
    setRichFileDeleteConfirm(null);
    setRichFileDeleteConfirmRect(null);
  }

  function confirmRichImageDeleteConfirmation() {
    if (!richImageDeleteConfirm) {
      return;
    }

    deleteRichImageBySelection(richImageDeleteConfirm);
  }

  function confirmRichFileDeleteConfirmation() {
    if (!richFileDeleteConfirm) {
      return;
    }

    deleteRichFileBySelection(richFileDeleteConfirm);
  }

  function closeLinkPlaceholderModal() {
    setShowLinkPlaceholderModal(false);
    setLinkSelectionPreview("");
  }

  function getSelectionRangeInEditor(scope: RichEditorScope): {
    editor: HTMLDivElement;
    selection: Selection;
    range: Range;
  } | null {
    const editor = getEditorElement(scope);
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return null;
    }

    return {
      editor,
      selection,
      range,
    };
  }

  function handleToolbarLink() {
    const scope = resolveRichEditorScope();
    if (!scope) {
      pushNotice("Выбери текстовый редактор для добавления ссылки.", "warn");
      return;
    }

    const editor = focusRichEditorForToolbar(scope);
    if (!editor) {
      return;
    }

    const selectionInfo = getSelectionRangeInEditor(scope);
    if (!selectionInfo || selectionInfo.range.collapsed) {
      pushNotice("Сначала выдели текст, затем нажми link.", "warn");
      return;
    }

    setShowTextColorPalette(false);
    setLinkSelectionPreview(selectionInfo.selection.toString().trim());
    setShowLinkPlaceholderModal(true);
  }

  function handleToolbarControlMouseDown(event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    const scope = resolveRichEditorScope();
    if (!scope) {
      return;
    }

    rememberRichSelection(scope);
  }

  function handleToolbarColorInputMouseDown() {
    const scope = resolveRichEditorScope();
    if (!scope) {
      return;
    }

    rememberRichSelection(scope);
  }

  function isPlainCharacterKey(event: React.KeyboardEvent<HTMLElement>): boolean {
    return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  }

  function syncRichImageSelectionFromEditorSelection(scope: RichEditorScope) {
    const editor = getEditorElement(scope);
    if (!editor) {
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      return;
    }

    if (!ensureRichImageDeleteLinesIfNeeded(editor)) {
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      return;
    }

    const activeDeleteLine = getRichImageDeleteLineElementFromSelection(editor);
    if (activeDeleteLine) {
      const imageId = activeDeleteLine.getAttribute("data-rich-image-id")?.trim() ?? "";
      if (!imageId) {
        setSelectedRichImage(null);
        setActiveRichImageDeleteLine(null);
        return;
      }

      setSelectedRichImageInScope(scope, imageId);
      setActiveRichImageDeleteLine({
        scope,
        imageId,
      });
      return;
    }

    const activeImage = getRichImageElementFromSelection(editor);
    if (activeImage) {
      const imageId = activeImage.getAttribute("data-rich-image-id")?.trim() ?? "";
      if (!imageId) {
        setSelectedRichImage(null);
        setActiveRichImageDeleteLine(null);
        return;
      }

      setSelectedRichImageInScope(scope, imageId);
      setActiveRichImageDeleteLine(null);
      return;
    }

    setSelectedRichImage(null);
    setActiveRichImageDeleteLine(null);
  }

  function handleRichEditorKeyDown(
    scope: RichEditorScope,
    event: React.KeyboardEvent<HTMLDivElement>
  ) {
    const editor = getEditorElement(scope);
    if (!editor) {
      return;
    }

    const hasModifierKey =
      event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
    if (
      !hasModifierKey &&
      (event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown")
    ) {
      ensureRichImageDeleteLinesIfNeeded(editor);
      ensureRichFileRows(editor);
    }

    const fileDeleteSelection =
      !hasModifierKey && (event.key === "Backspace" || event.key === "Delete")
        ? resolveRichFileDeleteSelectionFromEditorSelection(scope, editor, event.key)
        : null;
    if (fileDeleteSelection) {
      event.preventDefault();
      setRichFileDeleteConfirmRect(null);
      setRichFileDeleteConfirm(fileDeleteSelection);
      return;
    }

    const selectedImageInScope =
      selectedRichImage && isSameRichEditorScope(selectedRichImage.scope, scope)
        ? selectedRichImage
        : null;
    const selectedImageNode = selectedImageInScope
      ? getRichImageElementById(editor, selectedImageInScope.imageId)
      : null;

    if (selectedImageInScope && !selectedImageNode) {
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
    }

    if (
      !hasModifierKey &&
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedImageInScope &&
      selectedImageNode
    ) {
      event.preventDefault();
      setRichImageDeleteConfirmRect(null);
      setRichImageDeleteConfirm(selectedImageInScope);
      return;
    }

    if (!hasModifierKey && event.key === "Backspace") {
      const interImageBreakTarget = getInterImageBreakTargetFromCollapsedSelection(
        editor,
        "before"
      );
      if (interImageBreakTarget) {
        event.preventDefault();
        interImageBreakTarget.breakNode.remove();
        placeCaretBeforeRichImage(interImageBreakTarget.nextImage);
        setSelectedRichImage(null);
        setActiveRichImageDeleteLine(null);
        applyEditorDomValue(scope, editor);
        rememberRichSelection(scope);
        syncRichToolbarState(scope);
        return;
      }
    }

    if (!hasModifierKey && event.key === "Delete") {
      const interImageBreakTarget = getInterImageBreakTargetFromCollapsedSelection(editor, "after");
      if (interImageBreakTarget) {
        event.preventDefault();
        interImageBreakTarget.breakNode.remove();
        placeCaretBeforeRichImage(interImageBreakTarget.nextImage);
        setSelectedRichImage(null);
        setActiveRichImageDeleteLine(null);
        applyEditorDomValue(scope, editor);
        rememberRichSelection(scope);
        syncRichToolbarState(scope);
        return;
      }
    }

    if (!hasModifierKey && (event.key === "Backspace" || event.key === "Delete")) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const selectionRange = selection.getRangeAt(0);
        if (
          !selectionRange.collapsed &&
          editor.contains(selectionRange.startContainer) &&
          editor.contains(selectionRange.endContainer)
        ) {
          const imageInsideSelection = Array.from(
            editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`)
          ).find((imageNode) => {
            try {
              return selectionRange.intersectsNode(imageNode);
            } catch {
              return false;
            }
          });

          if (imageInsideSelection) {
            event.preventDefault();
            const imageId = imageInsideSelection.getAttribute("data-rich-image-id")?.trim() ?? "";
            if (!imageId) {
              return;
            }
            const imageSelection = {
              scope,
              imageId,
            };
            setSelectedRichImageInScope(scope, imageId);
            setActiveRichImageDeleteLine(null);
            setRichImageDeleteConfirmRect(null);
            setRichImageDeleteConfirm(imageSelection);
            rememberRichSelection(scope);
            syncRichToolbarState(scope);
            return;
          }
        }
      }
    }

    if (!hasModifierKey && event.key === "Backspace") {
      const imageBeforeCaret =
        selectedImageNode ??
        getAdjacentRichImageElementFromCollapsedSelection(editor, "before");
      if (imageBeforeCaret) {
        event.preventDefault();
        const imageId = imageBeforeCaret.getAttribute("data-rich-image-id")?.trim() ?? "";
        if (!imageId) {
          return;
        }
        setSelectedRichImageInScope(scope, imageId);
        setActiveRichImageDeleteLine(null);
        setRichImageDeleteConfirmRect(null);
        setRichImageDeleteConfirm({ scope, imageId });
        rememberRichSelection(scope);
        syncRichToolbarState(scope);
        return;
      }
    }

    if (!hasModifierKey && event.key === "Delete") {
      const imageAfterCaret = getAdjacentRichImageElementFromCollapsedSelection(editor, "after");
      if (imageAfterCaret) {
        event.preventDefault();
        const imageId = imageAfterCaret.getAttribute("data-rich-image-id")?.trim() ?? "";
        if (!imageId) {
          return;
        }
        setSelectedRichImageInScope(scope, imageId);
        setActiveRichImageDeleteLine(null);
        setRichImageDeleteConfirmRect(null);
        setRichImageDeleteConfirm({ scope, imageId });
        rememberRichSelection(scope);
        syncRichToolbarState(scope);
        return;
      }
    }

    if (selectedImageNode && (event.key === "Enter" || isPlainCharacterKey(event))) {
      event.preventDefault();
      placeCaretAfterRichImage(selectedImageNode);
      if (event.key === "Enter") {
        document.execCommand("insertLineBreak");
      } else {
        document.execCommand("insertText", false, event.key);
      }
      setSelectedRichImage(null);
      setActiveRichImageDeleteLine(null);
      applyEditorDomValue(scope, editor);
      rememberRichSelection(scope);
      syncRichToolbarState(scope);
      return;
    }

    const fromLineBelow =
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (event.key === "Backspace" || event.key === "ArrowUp")
        ? getRichImageDeleteLineTargetFromLineBelowCaret(editor)
        : null;
    if (fromLineBelow) {
      event.preventDefault();

      if (event.key === "Backspace") {
        fromLineBelow.breakNode.remove();
      }

      const lineSelection = focusRichImageDeleteLineInScope(scope, fromLineBelow.line);
      if (!lineSelection) {
        return;
      }

      if (event.key === "Backspace") {
        applyEditorDomValue(scope, editor);
        rememberRichSelection(scope);
        syncRichToolbarState(scope);
      }

      return;
    }

    const activeDeleteLine = getRichImageDeleteLineElementFromSelection(editor);
    if (!activeDeleteLine) {
      return;
    }

    const lineSelection = focusRichImageDeleteLineInScope(scope, activeDeleteLine);
    if (!lineSelection) {
      return;
    }

    if (
      event.key === "ArrowDown" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const deleteRow = getRichImageDeleteRowElementByChild(activeDeleteLine);
      if (deleteRow) {
        event.preventDefault();
        placeCaretOnLineBelowRichImageRow(deleteRow);
        setActiveRichImageDeleteLine(null);
        setSelectedRichImage(null);
      }
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      setRichImageDeleteConfirmRect(null);
      setRichImageDeleteConfirm(lineSelection);
      return;
    }

    if (event.key === "Enter" || isPlainCharacterKey(event)) {
      event.preventDefault();
      if (!placeCaretOutsideRichImageDeleteLine(activeDeleteLine)) {
        return;
      }

      if (event.key === "Enter") {
        document.execCommand("insertLineBreak");
      } else {
        document.execCommand("insertText", false, event.key);
      }

      setActiveRichImageDeleteLine(null);
      setSelectedRichImage(null);
      applyEditorDomValue(scope, editor);
      rememberRichSelection(scope);
      syncRichToolbarState(scope);
    }
  }

  function handleRichEditorFocus(scope: RichEditorScope) {
    const editor = getEditorElement(scope);
    if (editor) {
      ensureRichImageDeleteLinesIfNeeded(editor);
      rememberCurrentEditorUndoHtml(scope, editor);
    }

    setActiveRichEditorIfChanged(scope);
    syncRichImageSelectionFromEditorSelection(scope);
    rememberRichSelection(scope);
    syncRichToolbarState(scope);
  }

  function handleRichEditorSelectionActivity(scope: RichEditorScope) {
    setActiveRichEditorIfChanged(scope);
    syncRichImageSelectionFromEditorSelection(scope);
    rememberRichSelection(scope);
    syncRichToolbarState(scope);
  }

  function handleRichEditorInputActivity(scope: RichEditorScope) {
    setActiveRichEditorIfChanged(scope);
    rememberRichSelection(scope);
  }

  function handleRichEditorMouseUp(
    scope: RichEditorScope,
    event: React.MouseEvent<HTMLDivElement>
  ) {
    const editor = getEditorElement(scope);
    if (!editor) {
      return;
    }

    const targetNode = event.target instanceof Node ? event.target : null;
    const imageNode = getRichImageElementFromNodeOrRow(targetNode);
    if (!imageNode || !editor.contains(imageNode)) {
      handleRichEditorSelectionActivity(scope);
      return;
    }

    const imageId = imageNode.getAttribute("data-rich-image-id")?.trim() ?? "";
    if (!imageId) {
      handleRichEditorSelectionActivity(scope);
      return;
    }

    setSelectedRichImageInScope(scope, imageId);
    setActiveRichImageDeleteLine(null);
    placeCaretAfterRichImage(imageNode);
    rememberRichSelection(scope);
    syncRichToolbarState(scope);
  }

  function handleRichEditorKeyUp(
    scope: RichEditorScope,
    event: React.KeyboardEvent<HTMLDivElement>
  ) {
    if (event.key === "Delete" || event.key === "Backspace") {
      const editor = getEditorElement(scope);
      const selectedImageInScope =
        selectedRichImage && isSameRichEditorScope(selectedRichImage.scope, scope)
          ? selectedRichImage
          : null;
      const selectedImageNode =
        editor && selectedImageInScope
          ? getRichImageElementById(editor, selectedImageInScope.imageId)
          : null;

      if (selectedImageNode) {
        rememberRichSelection(scope);
        syncRichToolbarState(scope);
        return;
      }
    }

    if (event.key === "Enter" || isPlainCharacterKey(event)) {
      setActiveRichEditorIfChanged(scope);
      rememberRichSelection(scope);
      return;
    }

    handleRichEditorSelectionActivity(scope);
  }

  function handleRichEditorCopy(
    scope: RichEditorScope,
    event: React.ClipboardEvent<HTMLDivElement>
  ) {
    const editor = getEditorElement(scope);
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return;
    }

    const selectedImageInScope =
      selectedRichImage && isSameRichEditorScope(selectedRichImage.scope, scope)
        ? getRichImageElementById(editor, selectedRichImage.imageId)
        : null;
    const imageInsideSelection =
      selectedImageInScope ??
      Array.from(editor.querySelectorAll<HTMLElement>(`.${RICH_IMAGE_CLASS_NAME}`)).find(
        (imageNode) => {
          try {
            return range.intersectsNode(imageNode);
          } catch {
            return false;
          }
        }
      ) ??
      null;

    let html = "";
    if (imageInsideSelection) {
      html = sanitizeRichTextHtml(imageInsideSelection.outerHTML);
    } else if (!range.collapsed) {
      const fragment = range.cloneContents();
      const wrapper = document.createElement("div");
      wrapper.appendChild(fragment);
      html = sanitizeRichTextHtml(wrapper.innerHTML);
    }

    if (!html) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/plain", richTextToPlainText(html));
  }

  function handleBlockEditorInput(
    messageId: string,
    event: FormEvent<HTMLDivElement>
  ) {
    if (!currentCategoryId || !currentCategoryCanEdit) {
      return;
    }

    const scope: RichEditorScope = {
      kind: "block",
      messageId,
    };

    queueMessageContentSync(currentCategoryId, messageId, event.currentTarget);
    setSelectedRichImage(null);
    setActiveRichImageDeleteLine(null);
    handleRichEditorInputActivity(scope);
  }

  function handleContinuousEditorInput(event: FormEvent<HTMLDivElement>) {
    if (
      !currentCategory ||
      currentCategory.format !== "continuous" ||
      !currentCategoryCanEdit
    ) {
      return;
    }

    const scope: RichEditorScope = {
      kind: "continuous",
    };

    queueContinuousContentSync(currentCategory.id, event.currentTarget);
    setSelectedRichImage(null);
    setActiveRichImageDeleteLine(null);
    handleRichEditorInputActivity(scope);
  }

  function openCategory(
    categoryId: string,
    messageId?: string,
    options?: OpenCategoryOptions
  ) {
    if (currentCategoryId !== categoryId || selectedMessageId !== (messageId ?? null)) {
      pushUiUndoSnapshot();
    }

    setCurrentCategoryId(categoryId);
    setInsertionTargetId(categoryId);
    setActiveRichEditor(null);
    setSelectedRichImage(null);
    setDragChecklistItem(null);
    savedRichSelectionRef.current = null;
    draggedRichImageRef.current = null;
    draggedRichFileRef.current = null;
    richImageResizeStateRef.current = null;
    setShowTextColorPalette(false);
    setShowLinkPlaceholderModal(false);
    setLinkSelectionPreview("");
    if (messageId) {
      pendingMessageSelectionRef.current = messageId;
    } else {
      pendingMessageSelectionRef.current = null;
      setSelectedMessageId(null);
    }
    setShowSearch(false);
    setShowDictionaryGlobalSearch(false);
    if (!options?.keepMobilePanel) {
      setMobilePanel(null);
    }
    setShowCategoryTagLibrary(false);
    setShowProjectCreateModal(false);
    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setChecklistTagSearchQuery("");
  }

  function openMobilePanel(panel: Exclude<MobilePanel, null>) {
    setMobilePanel(panel);
    setShowMenu(false);
  }

  function closeMobilePanel() {
    setMobilePanel(null);
  }

  function closeMenu() {
    setShowMenu(false);
    setMenuPanel("main");
  }

  function openMenuPanel(panel: AccountWindowTab) {
    setShowMenu(false);
    setMenuPanel("main");
    setAccountWindowTab(panel);
    if (panel === "friends") {
      void loadFriends();
    }
    if (panel === "motivation") {
      void loadMotivationImages();
    }
    pushNotice(
      panel === "account"
        ? "Открыт раздел «Аккаунт»."
        : panel === "friends"
          ? "Открыт раздел «Друзья»."
          : panel === "motivation"
            ? "Открыта мотивационная панель."
            : "Открыт раздел «Настройки»."
    );
  }

  function closeAccountWindow() {
    setAccountWindowTab(null);
    setSelectedFriendInboxId(null);
  }

  function goToEntryMenu() {
    setAccountWindowTab(null);
    closeMenu();
    window.location.assign("/");
  }

  function toggleMenu() {
    setMobilePanel(null);
    setAccountWindowTab(null);
    setShowMenu((prev) => {
      const next = !prev;
      if (next) {
        setMenuPanel("main");
      }
      return next;
    });
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
    if (activeProjectId !== projectId || currentCategoryId || selectedMessageId) {
      pushUiUndoSnapshot();
    }

    setActiveProjectId(projectId);
    setCurrentCategoryId(null);
    setInsertionTargetId(null);
    setSelectedMessageId(null);
    setDragChecklistItem(null);
    setActiveRichEditor(null);
    setSelectedRichImage(null);
    savedRichSelectionRef.current = null;
    draggedRichImageRef.current = null;
    draggedRichFileRef.current = null;
    richImageResizeStateRef.current = null;
    setShowTextColorPalette(false);
    setShowLinkPlaceholderModal(false);
    setLinkSelectionPreview("");
    setShowCategoryTagSuggestions(false);
    setShowCategoryTagLibrary(false);
    setMobilePanel(null);
    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setChecklistTagSearchQuery("");
  }

  function openProjectCreateModal() {
    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setChecklistTagSearchQuery("");
    setProjectTagSearchQuery("");
    setProjectTagSelection([]);
    setProjectTitleDraft("");
    setProjectTitleDraftsById((prev) =>
      mergeProjectTitleDraftMap(prev, sortedProjects)
    );
    setMobilePanel(null);
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

    const shouldKeepMobileCategoriesOpen = mobilePanel === "categories";
    const parentId = currentCategory.parent_id;
    if (parentId && visibleCategoriesById.has(parentId)) {
      openCategory(parentId, undefined, {
        keepMobilePanel: shouldKeepMobileCategoriesOpen,
      });
      return;
    }

    if (isProjectMode && projectRootIdSet.has(currentCategory.id)) {
      pendingMessageSelectionRef.current = null;
      setCurrentCategoryId(null);
      setInsertionTargetId(null);
      setSelectedMessageId(null);
      if (!shouldKeepMobileCategoriesOpen) {
        setMobilePanel(null);
      }
    }
  }

  async function handleAddCategory() {
    const parentId = insertionTargetId ?? null;
    const shouldKeepMobileCategoriesOpen = mobilePanel === "categories";

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
      openCategory(created.id, undefined, {
        keepMobilePanel: shouldKeepMobileCategoriesOpen,
      });
      pushNotice(`Создана категория: ${created.title}.`);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось создать категорию."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function deleteCategoryById(categoryId: string) {
    if (!categoryId) {
      pushNotice("Выбери категорию для удаления.", "warn");
      return;
    }

    const target = categories.find((node) => node.id === categoryId);
    if (!target) {
      if (insertionTargetId === categoryId) {
        setInsertionTargetId(null);
      }
      return;
    }

    if (isMainRootCategory(target)) {
      pushNotice("Категорию main нельзя удалить.", "warn");
      return;
    }

    setIsMutating(true);
    try {
      const shouldCreateDeleteUndo = target.access_role === "owner";
      const undoSnapshot = shouldCreateDeleteUndo
        ? captureWorkspaceUiUndoSnapshot()
        : null;
      const projectsBeforeDelete = shouldCreateDeleteUndo
        ? projects.map(normalizeProjectRow)
        : [];
      let exportDocument: CategoryTreeDocument | null = null;

      if (shouldCreateDeleteUndo) {
        const exportResponse = await authorizedFetch(
          `/api/categories/${target.id}/export`,
          {
            cache: "no-store",
          }
        );
        const exportPayload = (await exportResponse.json()) as CategoryTreePayload;
        if (!exportResponse.ok || !exportPayload.data) {
          throw new Error(
            exportPayload.error ?? "Не удалось подготовить восстановление категории."
          );
        }
        exportDocument = exportPayload.data;
      }

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
      if (undoSnapshot && exportDocument) {
        pushWorkspaceUndoEntry({
          kind: "category-delete",
          snapshot: undoSnapshot,
          document: exportDocument,
          projects: projectsBeforeDelete,
        });
      }
      setSource((prev) => payload.source ?? prev);
      pushNotice(`Удалена категория: ${target.title}.`);
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось удалить категорию."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  async function confirmCategoryDeletion(target: CategoryRow): Promise<boolean> {
    return requestConfirmation({
      title: "Delete category",
      message: `Delete "${target.title}" and all nested subcategories?`,
      confirmLabel: "delete",
      cancelLabel: "cancel",
      tone: "danger",
    });
  }

  async function handleDeleteCategory() {
    if (!insertionTargetId) {
      pushNotice("Select a category to delete.", "warn");
      return;
    }

    const target = categories.find((node) => node.id === insertionTargetId);
    if (!target) {
      setInsertionTargetId(null);
      return;
    }

    if (!(await confirmCategoryDeletion(target))) {
      return;
    }

    await deleteCategoryById(target.id);
  }

  async function handleDeleteCategoryFromPanel(categoryId: string) {
    const target = categories.find((node) => node.id === categoryId);
    if (!target) {
      return;
    }

    if (!(await confirmCategoryDeletion(target))) {
      return;
    }

    await deleteCategoryById(target.id);
  }

  async function createMessageRequest(
    categoryId: string,
    title = "Новый блок",
    content = "",
    messageType: MessageType = "info"
  ): Promise<MessageRow> {
    const normalizedContent = normalizePersistedMessageContent(content);

    const response = await authorizedFetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId,
        title,
        messageType,
        content: normalizedContent,
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
    const normalizedPatch = {
      ...patch,
      ...(typeof patch.content === "string"
        ? { content: normalizePersistedMessageContent(patch.content) }
        : {}),
    };
    const normalizedSentContent =
      typeof options?.sentContent === "string"
        ? normalizePersistedMessageContent(options.sentContent)
        : options?.sentContent;

    messageRequestCountRef.current += 1;
    syncMessageSavingState();

    try {
      const response = await authorizedFetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedPatch),
      });

      const payload = (await response.json()) as MessagePayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось обновить сообщение.");
      }

      const updated = normalizeMessageRow(payload.data);
      const patchHasContent = typeof normalizedPatch.content === "string";
      const preserveContent = options?.preserveLocalContent || !patchHasContent;

      let shouldApplyUpdate = true;
      if (preserveContent) {
        if (options?.preserveLocalContent) {
            const version = options.contentVersion ?? 0;
            const ackVersion = messageAckVersionRef.current[updated.id] ?? 0;
            if (version >= ackVersion) {
              messageAckVersionRef.current[updated.id] = version;
              if (typeof normalizedSentContent === "string") {
                savedMessageContentRef.current[updated.id] = normalizedSentContent;
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
    rawContent: string,
    version: number
  ) {
    const content = sanitizeRichTextHtml(rawContent);
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

  function syncMessageContentChange(
    categoryId: string | null,
    messageId: string,
    nextValue: string
  ) {
    if (!categoryId) {
      return;
    }

    const nextVersion = (messageDraftVersionRef.current[messageId] ?? 0) + 1;
    messageDraftVersionRef.current[messageId] = nextVersion;

    startEditorTransition(() => {
      setMessagesByCategory((prev) => ({
        ...prev,
        [categoryId]: (prev[categoryId] ?? []).map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: nextValue,
                updated_at: new Date().toISOString(),
              }
            : message
        ),
      }));
    });

    scheduleMessageContentSave(categoryId, messageId, nextValue, nextVersion);
  }

  function queueMessageContentSync(
    categoryId: string,
    messageId: string,
    editor: HTMLDivElement
  ) {
    const existingTimer = messageInputSyncTimersRef.current[messageId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    messageInputSyncTimersRef.current[messageId] = setTimeout(() => {
      delete messageInputSyncTimersRef.current[messageId];
      syncMessageContentChange(categoryId, messageId, editor.innerHTML);
    }, EDITOR_INPUT_SYNC_DELAY_MS);
  }

  function flushMessageContentSync(
    categoryId: string,
    messageId: string,
    editor: HTMLDivElement
  ) {
    const existingTimer = messageInputSyncTimersRef.current[messageId];
    if (existingTimer) {
      clearTimeout(existingTimer);
      delete messageInputSyncTimersRef.current[messageId];
    }

    syncMessageContentChange(categoryId, messageId, editor.innerHTML);
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

  function scheduleContinuousDocumentSave(
    categoryId: string,
    document: ContinuousContentModel,
    version: number
  ) {
    const existingTimer = categorySaveTimersRef.current[categoryId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    categorySaveTimersRef.current[categoryId] = setTimeout(() => {
      delete categorySaveTimersRef.current[categoryId];

      const latestVersion = categoryDraftVersionRef.current[categoryId] ?? 0;
      if (version < latestVersion) {
        syncCategorySavingState();
        return;
      }

      const serializedContent = serializeContinuousContent(document);
      const ackVersion = categoryAckVersionRef.current[categoryId] ?? 0;
      if (
        savedCategoryContentRef.current[categoryId] === serializedContent &&
        version <= ackVersion
      ) {
        syncCategorySavingState();
        return;
      }

      startEditorTransition(() => {
        setCategories((prev) =>
          prev.map((category) =>
            category.id === categoryId
              ? {
                  ...category,
                  content: serializedContent,
                  updated_at: new Date().toISOString(),
                }
              : category
          )
        );
      });

      enqueueContinuousSave(categoryId, serializedContent, version);
      syncCategorySavingState();
    }, 420);

    syncCategorySavingState();
  }

  function getContinuousDocumentForCategory(
    categoryId: string
  ): ContinuousContentModel | null {
    const sourceCategory = categories.find((category) => category.id === categoryId);
    if (!sourceCategory || sourceCategory.format !== "continuous") {
      return null;
    }

    if (currentCategory?.id === categoryId && currentCategory.format === "continuous") {
      return {
        text: continuousEditorRef.current?.innerHTML ?? continuousDraft,
        checklists: normalizeChecklistBlocks(continuousChecklists),
        dictionaries: normalizeDictionaryBlocks(continuousDictionaries),
        schedules: normalizeScheduleBlocks(continuousSchedules),
      };
    }

    return parseContinuousContent(sourceCategory.content);
  }

  function commitContinuousDocumentForCategory(
    categoryId: string,
    document: ContinuousContentModel
  ): boolean {
    const sourceCategory = categories.find((category) => category.id === categoryId);
    if (!sourceCategory || sourceCategory.format !== "continuous") {
      return false;
    }

    const nextDocument: ContinuousContentModel = {
      text: document.text,
      checklists: normalizeChecklistBlocks(document.checklists),
      dictionaries: normalizeDictionaryBlocks(document.dictionaries),
      schedules: normalizeScheduleBlocks(document.schedules),
    };
    const serialized = serializeContinuousContent(nextDocument);

    if (sourceCategory.content === serialized) {
      if (currentCategory?.id === categoryId && currentCategory.format === "continuous") {
        setContinuousDraft(nextDocument.text);
        setContinuousChecklists(nextDocument.checklists);
        setContinuousDictionaries(nextDocument.dictionaries);
        setContinuousSchedules(nextDocument.schedules);
      }
      return false;
    }

    const nextVersion = (categoryDraftVersionRef.current[categoryId] ?? 0) + 1;
    categoryDraftVersionRef.current[categoryId] = nextVersion;

    if (currentCategory?.id === categoryId && currentCategory.format === "continuous") {
      setContinuousDraft(nextDocument.text);
      setContinuousChecklists(nextDocument.checklists);
      setContinuousDictionaries(nextDocument.dictionaries);
      setContinuousSchedules(nextDocument.schedules);
    }

    setCategories((prev) =>
      prev.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              content: serialized,
              updated_at: new Date().toISOString(),
            }
          : category
      )
    );

    scheduleContinuousSave(categoryId, serialized, nextVersion);
    return true;
  }

  function syncContinuousContentChange(
    categoryId: string | null,
    nextValue: string
  ) {
    if (!categoryId) {
      return;
    }

    const nextVersion = (categoryDraftVersionRef.current[categoryId] ?? 0) + 1;
    categoryDraftVersionRef.current[categoryId] = nextVersion;
    const nextDocument = getContinuousDocumentForCategory(categoryId);

    startEditorTransition(() => {
      if (currentCategory?.id === categoryId && currentCategory.format === "continuous") {
        setContinuousDraft(nextValue);
      }
    });

    scheduleContinuousDocumentSave(
      categoryId,
      {
        text: nextValue,
        checklists: nextDocument?.checklists ?? [],
        dictionaries: nextDocument?.dictionaries ?? [],
        schedules: nextDocument?.schedules ?? [],
      },
      nextVersion
    );
  }

  function queueContinuousContentSync(categoryId: string, editor: HTMLDivElement) {
    const existingTimer = categoryInputSyncTimersRef.current[categoryId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    categoryInputSyncTimersRef.current[categoryId] = setTimeout(() => {
      delete categoryInputSyncTimersRef.current[categoryId];
      syncContinuousContentChange(categoryId, editor.innerHTML);
    }, EDITOR_INPUT_SYNC_DELAY_MS);
  }

  function flushContinuousContentSync(categoryId: string, editor: HTMLDivElement) {
    const existingTimer = categoryInputSyncTimersRef.current[categoryId];
    if (existingTimer) {
      clearTimeout(existingTimer);
      delete categoryInputSyncTimersRef.current[categoryId];
    }

    syncContinuousContentChange(categoryId, editor.innerHTML);
  }

  function openChecklistEditorForCreate() {
    if (!currentCategory) {
      return;
    }

    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setScheduleModal(null);
    setChecklistTagSearchQuery("");
    setChecklistEditor({
      source: currentCategory.format === "block" ? "block-message" : "continuous",
      sourceCategoryId: currentCategory.id,
      sourceMessageId: null,
      checklistId: null,
      titleDraft: "#Checklist",
      tagSelection: [],
      orderMode: "auto",
      customOrderCategoryIds: [],
    });
  }

  function openChecklistEditorForChecklist(checklistId: string) {
    if (!currentCategory || currentCategory.format !== "continuous") {
      return;
    }

    const existingChecklist = continuousChecklists.find(
      (checklist) => checklist.id === checklistId
    );
    if (!existingChecklist) {
      return;
    }

    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setChecklistTagSearchQuery("");
    setChecklistEditor({
      source: "continuous",
      sourceCategoryId: currentCategory.id,
      sourceMessageId: null,
      checklistId,
      titleDraft: existingChecklist.title,
      tagSelection: existingChecklist.tags,
      orderMode: existingChecklist.orderMode,
      customOrderCategoryIds: existingChecklist.customOrderCategoryIds,
    });
  }

  function openChecklistEditorForBlockMessage(
    message: MessageRow,
    checklistPayload: MessageChecklistPayload
  ) {
    if (!currentCategory || currentCategory.format !== "block") {
      return;
    }

    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setChecklistTagSearchQuery("");
    setChecklistEditor({
      source: "block-message",
      sourceCategoryId: currentCategory.id,
      sourceMessageId: message.id,
      checklistId: null,
      titleDraft: message.title,
      tagSelection: checklistPayload.tags,
      orderMode: checklistPayload.orderMode,
      customOrderCategoryIds: checklistPayload.customOrderCategoryIds,
    });
  }

  function closeChecklistEditor() {
    setChecklistEditor(null);
    setChecklistTagSearchQuery("");
  }

  function updateChecklistEditorTitle(value: string) {
    setChecklistEditor((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        titleDraft: value,
      };
    });
  }

  function updateChecklistEditorOrderMode(mode: ChecklistItemOrderMode) {
    setChecklistEditor((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        orderMode: mode,
      };
    });
  }

  function resetChecklistEditorCustomOrder() {
    setChecklistEditor((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        orderMode: "auto",
        customOrderCategoryIds: [],
      };
    });
  }

  function toggleChecklistEditorTag(tag: string) {
    const normalized = normalizeCategoryTagInput(tag);
    if (!normalized) {
      return;
    }

    const key = normalized.toLocaleLowerCase();
    setChecklistEditor((prev) => {
      if (!prev) {
        return prev;
      }

      const exists = prev.tagSelection.some(
        (item) => item.toLocaleLowerCase() === key
      );

      return {
        ...prev,
        tagSelection: exists
          ? prev.tagSelection.filter((item) => item.toLocaleLowerCase() !== key)
          : [...prev.tagSelection, normalized],
      };
    });
  }

  async function handleSaveChecklistEditor() {
    if (!checklistEditor) {
      return;
    }

    const nextTags = dedupeCategoryTags(checklistEditor.tagSelection);
    if (nextTags.length === 0) {
      pushNotice("Выбери хотя бы один хэштег для #Checklist.", "warn");
      return;
    }

    const nextTitle = normalizeChecklistTitle(checklistEditor.titleDraft);
    const nextOrderMode = normalizeChecklistItemOrderMode(checklistEditor.orderMode);

    if (checklistEditor.source === "block-message") {
      const sourceCategoryId = checklistEditor.sourceCategoryId;

      if (checklistEditor.sourceMessageId) {
        const targetMessage = (messagesByCategory[sourceCategoryId] ?? []).find(
          (message) => message.id === checklistEditor.sourceMessageId
        );
        if (!targetMessage) {
          pushNotice("Чеклист-блок не найден.", "warn");
          closeChecklistEditor();
          return;
        }

        const currentPayload = parseMessageChecklistContent(targetMessage.content);
        if (!currentPayload) {
          pushNotice("Содержимое блока больше не является #Checklist.", "warn");
          closeChecklistEditor();
          return;
        }

        const eligibleCategoryIdKeySet = new Set(
          collectChecklistCategoryOptions(categories, nextTags).map((item) =>
            item.categoryId.toLocaleLowerCase()
          )
        );

        const nextPayload: MessageChecklistPayload = {
          tags: nextTags,
          checkedCategoryIds: currentPayload.checkedCategoryIds.filter((id) =>
            eligibleCategoryIdKeySet.has(id.toLocaleLowerCase())
          ),
          orderMode: nextOrderMode,
          customOrderCategoryIds:
            nextOrderMode === "custom"
              ? dedupePlainList(checklistEditor.customOrderCategoryIds).filter((id) =>
                  eligibleCategoryIdKeySet.has(id.toLocaleLowerCase())
                )
              : [],
        };
        const serializedContent = serializeMessageChecklistContent(nextPayload);

        const previousTitle = targetMessage.title;
        const previousContent = targetMessage.content;

        setMessagesByCategory((prev) => ({
          ...prev,
          [sourceCategoryId]: (prev[sourceCategoryId] ?? []).map((message) =>
            message.id === targetMessage.id
              ? {
                  ...message,
                  title: nextTitle,
                  content: serializedContent,
                  updated_at: new Date().toISOString(),
                }
              : message
          ),
        }));

        try {
          await patchMessage(targetMessage.id, sourceCategoryId, {
            title: nextTitle,
            content: serializedContent,
          });
          pushNotice("#Checklist обновлен.");
        } catch (error) {
          setMessagesByCategory((prev) => ({
            ...prev,
            [sourceCategoryId]: (prev[sourceCategoryId] ?? []).map((message) =>
              message.id === targetMessage.id
                ? {
                    ...message,
                    title: previousTitle,
                    content: previousContent,
                  }
                : message
            ),
          }));
          pushNotice(toErrorMessage(error, "Не удалось обновить #Checklist."), "error");
        } finally {
          closeChecklistEditor();
        }

        return;
      }

      setIsMutating(true);
      try {
        const created = await createMessageRequest(
          sourceCategoryId,
          nextTitle,
          serializeMessageChecklistContent({
            tags: nextTags,
            checkedCategoryIds: [],
            orderMode: nextOrderMode,
            customOrderCategoryIds: [],
          }),
          "info"
        );

        savedMessageContentRef.current[created.id] = created.content;
        messageDraftVersionRef.current[created.id] = 0;
        messageAckVersionRef.current[created.id] = 0;
        clearMessageSaveState(created.id);

        setMessagesByCategory((prev) => ({
          ...prev,
          [sourceCategoryId]: [...(prev[sourceCategoryId] ?? []), created].sort(
            sortMessages
          ),
        }));
        setSelectedMessageId(created.id);
        pushNotice("#Checklist добавлен.");
      } catch (error) {
        pushNotice(toErrorMessage(error, "Не удалось добавить #Checklist."), "error");
      } finally {
        setIsMutating(false);
        closeChecklistEditor();
      }

      return;
    }

    const sourceDocument = getContinuousDocumentForCategory(
      checklistEditor.sourceCategoryId
    );
    if (!sourceDocument) {
      pushNotice("Не удалось открыть источник чеклиста.", "error");
      return;
    }

    if (checklistEditor.checklistId) {
      const eligibleCategoryIdKeySet = new Set(
        collectChecklistCategoryOptions(categories, nextTags).map((item) =>
          item.categoryId.toLocaleLowerCase()
        )
      );

      let foundChecklist = false;
      const nextChecklists = sourceDocument.checklists.map((checklist) => {
        if (checklist.id !== checklistEditor.checklistId) {
          return checklist;
        }

        foundChecklist = true;
        return {
          ...checklist,
          title: nextTitle,
          tags: nextTags,
          checkedCategoryIds: checklist.checkedCategoryIds.filter((id) =>
            eligibleCategoryIdKeySet.has(id.toLocaleLowerCase())
          ),
          orderMode: nextOrderMode,
          customOrderCategoryIds:
            nextOrderMode === "custom"
              ? dedupePlainList(checklistEditor.customOrderCategoryIds).filter((id) =>
                  eligibleCategoryIdKeySet.has(id.toLocaleLowerCase())
                )
              : [],
        };
      });

      if (!foundChecklist) {
        pushNotice("Чеклист не найден.", "warn");
        closeChecklistEditor();
        return;
      }

      commitContinuousDocumentForCategory(checklistEditor.sourceCategoryId, {
        text: sourceDocument.text,
        checklists: nextChecklists,
        dictionaries: sourceDocument.dictionaries,
        schedules: sourceDocument.schedules,
      });
      pushNotice("#Checklist обновлен.");
      closeChecklistEditor();
      return;
    }

    const createdChecklist: ChecklistBlock = {
      id: crypto.randomUUID(),
      title: nextTitle,
      tags: nextTags,
      checkedCategoryIds: [],
      orderMode: nextOrderMode,
      customOrderCategoryIds: [],
    };

    commitContinuousDocumentForCategory(checklistEditor.sourceCategoryId, {
      text: sourceDocument.text,
      checklists: [...sourceDocument.checklists, createdChecklist],
      dictionaries: sourceDocument.dictionaries,
      schedules: sourceDocument.schedules,
    });
    pushNotice("#Checklist добавлен.");
    closeChecklistEditor();
  }

  async function handleDeleteChecklistFromEditor() {
    if (!checklistEditor) {
      return;
    }

    if (checklistEditor.source === "block-message") {
      if (!checklistEditor.sourceMessageId) {
        closeChecklistEditor();
        return;
      }

      const sourceCategoryId = checklistEditor.sourceCategoryId;
      const messageId = checklistEditor.sourceMessageId;

      setIsMutating(true);
      try {
        await deleteMessageRequest(messageId);

        clearMessageSaveState(messageId);
        delete savedMessageContentRef.current[messageId];
        delete messageDraftVersionRef.current[messageId];
        delete messageAckVersionRef.current[messageId];
        syncMessageSavingState();

        setMessagesByCategory((prev) => ({
          ...prev,
          [sourceCategoryId]: (prev[sourceCategoryId] ?? []).filter(
            (message) => message.id !== messageId
          ),
        }));

        if (selectedMessageId === messageId) {
          setSelectedMessageId(null);
        }

        pushNotice("#Checklist удален.");
      } catch (error) {
        pushNotice(toErrorMessage(error, "Не удалось удалить #Checklist."), "error");
      } finally {
        setIsMutating(false);
        closeChecklistEditor();
      }

      return;
    }

    if (!checklistEditor.checklistId) {
      return;
    }

    const sourceDocument = getContinuousDocumentForCategory(
      checklistEditor.sourceCategoryId
    );
    if (!sourceDocument) {
      pushNotice("Не удалось удалить чеклист.", "error");
      return;
    }

    const nextChecklists = sourceDocument.checklists.filter(
      (checklist) => checklist.id !== checklistEditor.checklistId
    );

    if (nextChecklists.length === sourceDocument.checklists.length) {
      closeChecklistEditor();
      return;
    }

    commitContinuousDocumentForCategory(checklistEditor.sourceCategoryId, {
      text: sourceDocument.text,
      checklists: nextChecklists,
      dictionaries: sourceDocument.dictionaries,
      schedules: sourceDocument.schedules,
    });
    pushNotice("#Checklist удален.");
    closeChecklistEditor();
  }

  function handleAddDictionaryBlock() {
    if (!currentCategory) {
      return;
    }

    const columns = createDefaultDictionaryColumns();

    setChecklistEditor(null);
    setChecklistTagSearchQuery("");
    setScheduleModal(null);
    setDictionaryStudy(null);
    setDictionaryImportDraft("");
    resetDictionaryEditorSearch();
    setDictionaryEditorTab("entries");
    setDictionaryEditor({
      source: currentCategory.format === "block" ? "block-message" : "continuous",
      sourceCategoryId: currentCategory.id,
      sourceMessageId: null,
      dictionaryId: null,
      titleDraft: "Словарь",
      descriptionDraft: "",
      tagsDraft: "",
      promptSide: "side1",
      shuffle: false,
      autoSpeak: false,
      autoSpeakFields: getDefaultDictionaryAutoSpeakFields(columns),
      manualSpeakFields: getDefaultDictionaryManualSpeakFields(columns),
      noteDisplayMode: DEFAULT_DICTIONARY_NOTE_DISPLAY_MODE,
      progressMode: false,
      motivateOnCorrect: false,
      cardMode: false,
      adhdMode: false,
      motivationAdvanceMode: DEFAULT_DICTIONARY_MOTIVATION_ADVANCE_MODE,
      motivationAutoSeconds: DEFAULT_DICTIONARY_MOTIVATION_AUTO_SECONDS,
      labels: createDefaultDictionaryLabels(columns),
      columns,
      entries: [createEmptyDictionaryEntry(columns)],
    });
  }

  function openDictionaryEditorForBlockMessage(
    message: MessageRow,
    payload: MessageDictionaryPayload
  ) {
    if (!currentCategory || currentCategory.format !== "block") {
      return;
    }

    setChecklistEditor(null);
    setChecklistTagSearchQuery("");
    setScheduleModal(null);
    setDictionaryStudy(null);
    setDictionaryImportDraft("");
    resetDictionaryEditorSearch();
    setDictionaryEditorTab("entries");
    setDictionaryEditor({
      source: "block-message",
      sourceCategoryId: currentCategory.id,
      sourceMessageId: message.id,
      dictionaryId: null,
      titleDraft: message.title,
      descriptionDraft: payload.description,
      tagsDraft: serializeDictionaryTags(payload.tags),
      promptSide: payload.promptSide,
      shuffle: payload.shuffle,
      autoSpeak: payload.autoSpeak,
      autoSpeakFields: normalizeDictionaryAutoSpeakFields(
        payload.autoSpeakFields,
        getDefaultDictionaryAutoSpeakFields(payload.columns),
        payload.columns
      ),
      manualSpeakFields: normalizeDictionaryManualSpeakFields(
        payload.manualSpeakFields,
        getDefaultDictionaryManualSpeakFields(payload.columns),
        payload.columns
      ),
      noteDisplayMode: payload.noteDisplayMode,
      progressMode: payload.progressMode,
      motivateOnCorrect: payload.motivateOnCorrect,
      cardMode: payload.cardMode,
      adhdMode: payload.adhdMode,
      motivationAdvanceMode: payload.motivationAdvanceMode,
      motivationAutoSeconds: payload.motivationAutoSeconds,
      labels: normalizeDictionaryLabels(payload.labels, payload.columns),
      columns: payload.columns,
      entries: makeDictionaryEditorEntries(payload),
    });
  }

  function openDictionaryEditorForContinuousDictionary(dictionaryId: string) {
    if (!currentCategory || currentCategory.format !== "continuous") {
      return;
    }

    const dictionary = continuousDictionaries.find((item) => item.id === dictionaryId);
    if (!dictionary) {
      return;
    }

    setChecklistEditor(null);
    setChecklistTagSearchQuery("");
    setDictionaryStudy(null);
    setDictionaryImportDraft("");
    resetDictionaryEditorSearch();
    setDictionaryEditorTab("entries");
    setDictionaryEditor({
      source: "continuous",
      sourceCategoryId: currentCategory.id,
      sourceMessageId: null,
      dictionaryId: dictionary.id,
      titleDraft: dictionary.title,
      descriptionDraft: dictionary.description,
      tagsDraft: serializeDictionaryTags(dictionary.tags),
      promptSide: dictionary.promptSide,
      shuffle: dictionary.shuffle,
      autoSpeak: dictionary.autoSpeak,
      autoSpeakFields: normalizeDictionaryAutoSpeakFields(
        dictionary.autoSpeakFields,
        getDefaultDictionaryAutoSpeakFields(dictionary.columns),
        dictionary.columns
      ),
      manualSpeakFields: normalizeDictionaryManualSpeakFields(
        dictionary.manualSpeakFields,
        getDefaultDictionaryManualSpeakFields(dictionary.columns),
        dictionary.columns
      ),
      noteDisplayMode: dictionary.noteDisplayMode,
      progressMode: dictionary.progressMode,
      motivateOnCorrect: dictionary.motivateOnCorrect,
      cardMode: dictionary.cardMode,
      adhdMode: dictionary.adhdMode,
      motivationAdvanceMode: dictionary.motivationAdvanceMode,
      motivationAutoSeconds: dictionary.motivationAutoSeconds,
      labels: normalizeDictionaryLabels(dictionary.labels, dictionary.columns),
      columns: dictionary.columns,
      entries: makeDictionaryEditorEntries(dictionary),
    });
  }

  function moveContinuousDictionary(dictionaryId: string, offset: number) {
    if (
      !currentCategory ||
      currentCategory.format !== "continuous" ||
      !currentCategoryCanEdit
    ) {
      return;
    }

    const sourceDocument = getContinuousDocumentForCategory(currentCategory.id);
    if (!sourceDocument || sourceDocument.dictionaries.length < 2) {
      return;
    }

    const fromIndex = sourceDocument.dictionaries.findIndex(
      (dictionary) => dictionary.id === dictionaryId
    );
    const toIndex = fromIndex + offset;
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      toIndex >= sourceDocument.dictionaries.length
    ) {
      return;
    }

    const nextDictionaries = [...sourceDocument.dictionaries];
    const [moved] = nextDictionaries.splice(fromIndex, 1);
    nextDictionaries.splice(toIndex, 0, moved);

    commitContinuousDocumentForCategory(currentCategory.id, {
      text: sourceDocument.text,
      checklists: sourceDocument.checklists,
      dictionaries: nextDictionaries,
      schedules: sourceDocument.schedules,
    });
  }

  function handleContinuousDictionaryDragStart(
    event: DragEvent<HTMLButtonElement>,
    dictionaryId: string
  ) {
    if (!currentCategoryCanEdit || continuousDictionaryCards.length < 2) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dictionaryId);
    }
    setDragDictionaryId(dictionaryId);
  }

  function handleDropOnContinuousDictionary(targetDictionaryId: string) {
    if (
      !currentCategory ||
      currentCategory.format !== "continuous" ||
      !currentCategoryCanEdit ||
      !dragDictionaryId ||
      dragDictionaryId === targetDictionaryId
    ) {
      setDragDictionaryId(null);
      return;
    }

    const sourceDocument = getContinuousDocumentForCategory(currentCategory.id);
    if (!sourceDocument) {
      setDragDictionaryId(null);
      return;
    }

    const orderedIds = reorderIdListByTarget(
      sourceDocument.dictionaries.map((dictionary) => dictionary.id),
      dragDictionaryId,
      targetDictionaryId
    );
    if (orderedIds.length !== sourceDocument.dictionaries.length) {
      setDragDictionaryId(null);
      return;
    }

    const byId = new Map(
      sourceDocument.dictionaries.map((dictionary) => [dictionary.id, dictionary])
    );
    const nextDictionaries = orderedIds
      .map((id) => byId.get(id))
      .filter((dictionary): dictionary is DictionaryBlock => Boolean(dictionary));

    commitContinuousDocumentForCategory(currentCategory.id, {
      text: sourceDocument.text,
      checklists: sourceDocument.checklists,
      dictionaries: nextDictionaries,
      schedules: sourceDocument.schedules,
    });
    setDragDictionaryId(null);
  }

  function closeDictionaryEditor() {
    setDictionaryImportDraft("");
    resetDictionaryEditorSearch();
    setDictionaryEditorTab("entries");
    setDictionaryEditor(null);
  }

  function closeScheduleModal() {
    setScheduleModal(null);
  }

  function getSchedulePayloadForSource(ref: ScheduleSourceRef): SchedulePayload | null {
    if (ref.source === "continuous") {
      if (!ref.scheduleId) {
        return null;
      }

      const sourceDocument = getContinuousDocumentForCategory(ref.sourceCategoryId);
      const schedule = sourceDocument?.schedules.find(
        (candidate) => candidate.id === ref.scheduleId
      );
      return schedule ? normalizeSchedulePayload(schedule) : null;
    }

    if (!ref.sourceMessageId) {
      return null;
    }

    const message = (messagesByCategory[ref.sourceCategoryId] ?? []).find(
      (candidate) => candidate.id === ref.sourceMessageId
    );
    return parseMessageScheduleContent(message?.content);
  }

  function commitSchedulePayloadForSource(
    ref: ScheduleSourceRef,
    payload: SchedulePayload
  ): boolean {
    const nextPayload = normalizeSchedulePayload(payload);

    if (ref.source === "continuous") {
      if (!ref.scheduleId) {
        return false;
      }

      const sourceDocument = getContinuousDocumentForCategory(ref.sourceCategoryId);
      if (!sourceDocument) {
        pushNotice("Не удалось сохранить расписание.", "error");
        return false;
      }

      let foundSchedule = false;
      const nextSchedules = sourceDocument.schedules.map((schedule) => {
        if (schedule.id !== ref.scheduleId) {
          return schedule;
        }

        foundSchedule = true;
        return {
          ...schedule,
          ...nextPayload,
        };
      });

      if (!foundSchedule) {
        pushNotice("Расписание не найдено.", "warn");
        return false;
      }

      commitContinuousDocumentForCategory(ref.sourceCategoryId, {
        text: sourceDocument.text,
        checklists: sourceDocument.checklists,
        dictionaries: sourceDocument.dictionaries,
        schedules: nextSchedules,
      });
      return true;
    }

    if (!ref.sourceMessageId) {
      return false;
    }

    syncMessageContentChange(
      ref.sourceCategoryId,
      ref.sourceMessageId,
      serializeMessageScheduleContent(nextPayload)
    );
    return true;
  }

  function updateSchedulePayload(
    ref: ScheduleSourceRef,
    updater: (payload: SchedulePayload) => SchedulePayload
  ): boolean {
    const payload = getSchedulePayloadForSource(ref);
    if (!payload) {
      pushNotice("Расписание не найдено.", "warn");
      return false;
    }

    return commitSchedulePayloadForSource(ref, updater(payload));
  }

  function updateScheduleViewMode(ref: ScheduleSourceRef, viewMode: ScheduleViewMode) {
    updateSchedulePayload(ref, (payload) => ({ ...payload, viewMode }));
  }

  function updateScheduleSelectedDate(ref: ScheduleSourceRef, selectedDate: string) {
    updateSchedulePayload(ref, (payload) => ({ ...payload, selectedDate }));
  }

  function updateScheduleEventStatus(
    ref: ScheduleSourceRef,
    eventId: string,
    status: ScheduleStatus
  ) {
    updateSchedulePayload(ref, (payload) => ({
      ...payload,
      events: normalizeScheduleEvents(
        payload.events.map((event) =>
          event.id === eventId ? { ...event, status } : event
        )
      ),
    }));
  }

  function deleteScheduleEvent(ref: ScheduleSourceRef, eventId: string) {
    updateSchedulePayload(ref, (payload) => ({
      ...payload,
      events: payload.events.filter((event) => event.id !== eventId),
    }));
  }

  async function deleteScheduleBlock(ref: ScheduleSourceRef) {
    const confirmed = await requestConfirmation({
      title: "Удалить расписание",
      message: "Блок расписания будет удален полностью. Продолжить?",
      confirmLabel: "удалить",
      cancelLabel: "отмена",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    if (ref.source === "continuous") {
      if (!ref.scheduleId) {
        return;
      }

      const sourceDocument = getContinuousDocumentForCategory(ref.sourceCategoryId);
      if (!sourceDocument) {
        pushNotice("Не удалось удалить расписание.", "error");
        return;
      }

      commitContinuousDocumentForCategory(ref.sourceCategoryId, {
        text: sourceDocument.text,
        checklists: sourceDocument.checklists,
        dictionaries: sourceDocument.dictionaries,
        schedules: sourceDocument.schedules.filter(
          (schedule) => schedule.id !== ref.scheduleId
        ),
      });
      pushNotice("Расписание удалено.");
      return;
    }

    if (!ref.sourceMessageId) {
      return;
    }

    setIsMutating(true);
    try {
      await deleteMessageRequest(ref.sourceMessageId);
      clearMessageSaveState(ref.sourceMessageId);
      delete savedMessageContentRef.current[ref.sourceMessageId];
      delete messageDraftVersionRef.current[ref.sourceMessageId];
      delete messageAckVersionRef.current[ref.sourceMessageId];
      syncMessageSavingState();
      setMessagesByCategory((prev) => ({
        ...prev,
        [ref.sourceCategoryId]: (prev[ref.sourceCategoryId] ?? []).filter(
          (message) => message.id !== ref.sourceMessageId
        ),
      }));
      if (selectedMessageId === ref.sourceMessageId) {
        setSelectedMessageId(null);
      }
      pushNotice("Расписание удалено.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось удалить расписание."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  function makeScheduleEventDraft(
    payload: SchedulePayload,
    event: ScheduleEvent | null = null
  ): ScheduleEventDraft {
    return {
      title: event?.title ?? "",
      description: event?.description ?? "",
      date: event?.date ?? payload.selectedDate,
      start: event?.start ?? "",
      durationMinutes: String(event ? getEventDurationMinutes(event) : 60),
      type: event?.type ?? "flexible",
      category: event?.category ?? "",
      priority: event?.priority ?? "medium",
      status: event?.status ?? "planned",
      canMove: event?.canMove ?? true,
      canSplit: event?.canSplit ?? false,
      deadline: event?.deadline ?? "",
      recurrence: event?.recurrence ?? "",
    };
  }

  function scheduleEventFromDraft(
    draft: ScheduleEventDraft,
    eventId: string | null
  ): ScheduleEvent {
    const durationMinutes = draft.durationMinutes.trim()
      ? Number(draft.durationMinutes)
      : 60;
    const start = draft.start || undefined;
    const end =
      start && Number.isFinite(durationMinutes)
        ? minutesToTime(timeToMinutes(start) + durationMinutes)
        : undefined;

    return normalizeScheduleEvent({
      id: eventId ?? createScheduleId("event"),
      title: draft.title,
      description: draft.description,
      date: draft.date,
      start,
      end,
      durationMinutes,
      type: draft.type,
      category: draft.category,
      priority: draft.priority,
      status: draft.status,
      canMove: draft.canMove,
      canSplit: draft.canSplit,
      deadline: draft.deadline || undefined,
      recurrence: draft.recurrence || undefined,
    });
  }

  function openScheduleEventModal(ref: ScheduleSourceRef, eventId: string | null = null) {
    const payload = getSchedulePayloadForSource(ref);
    if (!payload) {
      pushNotice("Расписание не найдено.", "warn");
      return;
    }

    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    const existingEvent = eventId
      ? payload.events.find((event) => event.id === eventId) ?? null
      : null;
    setScheduleModal({
      ...ref,
      mode: "event",
      eventId,
      draft: makeScheduleEventDraft(payload, existingEvent),
    });
  }

  function saveScheduleEventFromModal() {
    if (!scheduleModal || scheduleModal.mode !== "event") {
      return;
    }

    const title = scheduleModal.draft.title.trim();
    if (!title) {
      pushNotice("У дела должно быть название.", "warn");
      return;
    }

    const event = scheduleEventFromDraft(scheduleModal.draft, scheduleModal.eventId);
    const saved = updateSchedulePayload(scheduleModal, (payload) => ({
      ...payload,
      selectedDate: event.date ?? payload.selectedDate,
      events: normalizeScheduleEvents(
        scheduleModal.eventId
          ? payload.events.map((candidate) =>
              candidate.id === scheduleModal.eventId ? event : candidate
            )
          : [...payload.events, event]
      ),
    }));

    if (saved) {
      pushNotice(scheduleModal.eventId ? "Дело обновлено." : "Дело добавлено.");
      closeScheduleModal();
    }
  }

  function openScheduleAssistantModal(ref: ScheduleSourceRef) {
    const payload = getSchedulePayloadForSource(ref);
    if (!payload) {
      pushNotice("Расписание не найдено.", "warn");
      return;
    }

    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setScheduleModal({
      ...ref,
      mode: "assistant",
      draft: {
        text: "",
        durationMinutes: "",
        date: "",
        dateRangeStart: payload.selectedDate,
        dateRangeEnd: "",
        preferredTime: "",
        avoidedTime: "",
        deadline: "",
        priority: "medium",
        canMove: true,
        canSplit: false,
        category: "",
      },
      suggestions: [],
      status: "",
    });
  }

  function calculateScheduleAssistantSuggestions() {
    if (!scheduleModal || scheduleModal.mode !== "assistant") {
      return;
    }

    const payload = getSchedulePayloadForSource(scheduleModal);
    if (!payload) {
      pushNotice("Расписание не найдено.", "warn");
      return;
    }

    const durationText = scheduleModal.draft.durationMinutes.trim();
    const durationMinutes = durationText ? Number(durationText) : undefined;
    const suggestions = buildScheduleSuggestions(payload, {
      text: scheduleModal.draft.text,
      durationMinutes:
        typeof durationMinutes === "number" && durationMinutes > 0 && Number.isFinite(durationMinutes)
          ? durationMinutes
          : undefined,
      date: scheduleModal.draft.date || undefined,
      dateRangeStart: scheduleModal.draft.dateRangeStart || undefined,
      dateRangeEnd: scheduleModal.draft.dateRangeEnd || undefined,
      preferredTime: scheduleModal.draft.preferredTime || undefined,
      avoidedTime: scheduleModal.draft.avoidedTime || undefined,
      deadline: scheduleModal.draft.deadline || undefined,
      priority: scheduleModal.draft.priority,
      category: scheduleModal.draft.category || undefined,
      canMove: scheduleModal.draft.canMove,
      canSplit: scheduleModal.draft.canSplit,
    });

    setScheduleModal({
      ...scheduleModal,
      suggestions,
      status:
        suggestions.length > 0
          ? "Выберите подходящее окно."
          : "Подходящего свободного окна нет. Можно перенести гибкие дела или выбрать другой день.",
    });
  }

  function insertScheduleSuggestion(suggestion: ScheduleSuggestion) {
    if (!scheduleModal || scheduleModal.mode !== "assistant") {
      return;
    }

    const saved = updateSchedulePayload(scheduleModal, (payload) => ({
      ...payload,
      viewMode: "day",
      selectedDate: suggestion.date,
      events: normalizeScheduleEvents([...payload.events, suggestion.event]),
    }));

    if (saved) {
      pushNotice("Дело вставлено в расписание.");
      closeScheduleModal();
    }
  }

  function openScheduleSpontaneousModal(ref: ScheduleSourceRef) {
    const payload = getSchedulePayloadForSource(ref);
    if (!payload) {
      pushNotice("Расписание не найдено.", "warn");
      return;
    }

    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setScheduleModal({
      ...ref,
      mode: "spontaneous",
      draft: {
        text: "",
        date: payload.selectedDate,
        start: "",
        durationMinutes: "",
        priority: "high",
        canCancel: false,
        scope: "near",
      },
      preview: null,
      status: "",
    });
  }

  function calculateScheduleSpontaneousPreview() {
    if (!scheduleModal || scheduleModal.mode !== "spontaneous") {
      return;
    }

    const payload = getSchedulePayloadForSource(scheduleModal);
    if (!payload) {
      pushNotice("Расписание не найдено.", "warn");
      return;
    }

    const durationText = scheduleModal.draft.durationMinutes.trim();
    const durationMinutes = durationText ? Number(durationText) : undefined;
    const preview = buildSpontaneousSchedulePreview(payload, {
      text: scheduleModal.draft.text,
      date: scheduleModal.draft.date || undefined,
      start: scheduleModal.draft.start || undefined,
      durationMinutes:
        typeof durationMinutes === "number" && durationMinutes > 0 && Number.isFinite(durationMinutes)
          ? durationMinutes
          : undefined,
      priority: scheduleModal.draft.priority,
      canCancel: scheduleModal.draft.canCancel,
      scope: scheduleModal.draft.scope,
    });

    setScheduleModal({
      ...scheduleModal,
      preview,
      status: preview.message,
    });
  }

  function applyScheduleSpontaneousPreviewFromModal() {
    if (!scheduleModal || scheduleModal.mode !== "spontaneous" || !scheduleModal.preview) {
      return;
    }

    const payload = getSchedulePayloadForSource(scheduleModal);
    if (!payload) {
      pushNotice("Расписание не найдено.", "warn");
      return;
    }

    const nextPayload = applyScheduleSpontaneousPreview(payload, scheduleModal.preview);
    const addChange = scheduleModal.preview.changes.find(
      (change): change is Extract<SchedulePreviewChange, { kind: "add" }> =>
        change.kind === "add"
    );
    const saved = commitSchedulePayloadForSource(scheduleModal, {
      ...nextPayload,
      viewMode: "day",
      selectedDate: addChange?.event.date ?? nextPayload.selectedDate,
    });

    if (saved) {
      pushNotice("Изменения применены.");
      closeScheduleModal();
    }
  }

  function scheduleGoalToDraft(goal: ScheduleGoal): ScheduleGoalDraft {
    return {
      id: goal.id,
      title: goal.title,
      category: goal.category ?? "",
      period: goal.period,
      targetCount: goal.targetCount ? String(goal.targetCount) : "",
      targetMinutes: goal.targetMinutes ? String(goal.targetMinutes) : "",
    };
  }

  function scheduleGoalFromDraft(draft: ScheduleGoalDraft): ScheduleGoal {
    return {
      id: draft.id,
      title: draft.title.trim() || "Норма",
      category: draft.category.trim() || undefined,
      period: draft.period,
      targetCount: draft.targetCount ? Number(draft.targetCount) : undefined,
      targetMinutes: draft.targetMinutes ? Number(draft.targetMinutes) : undefined,
    };
  }

  function openScheduleGoalsModal(ref: ScheduleSourceRef) {
    const payload = getSchedulePayloadForSource(ref);
    if (!payload) {
      pushNotice("Расписание не найдено.", "warn");
      return;
    }

    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setScheduleModal({
      ...ref,
      mode: "goals",
      goalDrafts: payload.goals.map(scheduleGoalToDraft),
      settingsDraft: normalizeScheduleSettings(payload.settings),
    });
  }

  function addScheduleGoalDraft() {
    setScheduleModal((prev) =>
      prev?.mode === "goals"
        ? {
            ...prev,
            goalDrafts: [
              ...prev.goalDrafts,
              {
                id: createScheduleId("goal"),
                title: "",
                category: "",
                period: "week",
                targetCount: "",
                targetMinutes: "",
              },
            ],
          }
        : prev
    );
  }

  function saveScheduleGoalsFromModal() {
    if (!scheduleModal || scheduleModal.mode !== "goals") {
      return;
    }

    const goals = normalizeScheduleGoals(
      scheduleModal.goalDrafts
        .map(scheduleGoalFromDraft)
        .filter((goal) => goal.title.trim())
    );
    const settings = normalizeScheduleSettings(scheduleModal.settingsDraft);
    const saved = updateSchedulePayload(scheduleModal, (payload) => ({
      ...payload,
      goals,
      settings,
    }));

    if (saved) {
      pushNotice("Нормы расписания сохранены.");
      closeScheduleModal();
    }
  }

  async function handleAddScheduleBlock() {
    if (!currentCategory) {
      return;
    }

    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setScheduleModal(null);

    if (currentCategory.format === "continuous") {
      const sourceDocument = getContinuousDocumentForCategory(currentCategory.id);
      if (!sourceDocument) {
        pushNotice("Не удалось добавить расписание.", "error");
        return;
      }

      const createdSchedule = createDefaultScheduleBlock();
      commitContinuousDocumentForCategory(currentCategory.id, {
        text: sourceDocument.text,
        checklists: sourceDocument.checklists,
        dictionaries: sourceDocument.dictionaries,
        schedules: [...sourceDocument.schedules, createdSchedule],
      });
      pushNotice("Расписание добавлено.");
      return;
    }

    setIsMutating(true);
    try {
      const created = await createMessageRequest(
        currentCategory.id,
        "Расписание",
        serializeMessageScheduleContent(createDefaultSchedulePayload()),
        "info"
      );
      savedMessageContentRef.current[created.id] = created.content;
      messageDraftVersionRef.current[created.id] = 0;
      messageAckVersionRef.current[created.id] = 0;
      clearMessageSaveState(created.id);
      setMessagesByCategory((prev) => ({
        ...prev,
        [currentCategory.id]: [...(prev[currentCategory.id] ?? []), created].sort(
          sortMessages
        ),
      }));
      setSelectedMessageId(created.id);
      pushNotice("Расписание добавлено.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось добавить расписание."), "error");
    } finally {
      setIsMutating(false);
    }
  }

  function resetDictionaryEditorSearch() {
    dictionarySearchShouldFocusRef.current = false;
    setDictionarySearchQuery("");
    setDictionarySearchActiveIndex(0);
    setDictionaryMobileSearchOpen(false);
  }

  function updateDictionaryEditorSearchQuery(value: string) {
    dictionarySearchShouldFocusRef.current = false;
    setDictionarySearchQuery(value);
    setDictionarySearchActiveIndex(0);
  }

  function moveDictionaryEditorSearch(delta: number) {
    if (dictionarySearchMatches.length === 0) {
      return;
    }

    dictionarySearchShouldFocusRef.current = true;
    setDictionarySearchActiveIndex((prev) =>
      wrapIndex(prev + delta, dictionarySearchMatches.length)
    );
    setDictionarySearchNavigationVersion((prev) => prev + 1);
  }

  function handleDictionaryEditorSearchKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      moveDictionaryEditorSearch(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      resetDictionaryEditorSearch();
    }
  }

  function updateDictionaryEditorTitle(value: string) {
    setDictionaryEditor((prev) => (prev ? { ...prev, titleDraft: value } : prev));
  }

  function updateDictionaryEditorDescription(value: string) {
    setDictionaryEditor((prev) =>
      prev ? { ...prev, descriptionDraft: value } : prev
    );
  }

  function updateDictionaryEditorTags(value: string) {
    setDictionaryEditor((prev) => (prev ? { ...prev, tagsDraft: value } : prev));
  }

  function updateDictionaryEditorPromptSide(side: DictionaryPromptSide) {
    setDictionaryEditor((prev) =>
      prev ? { ...prev, promptSide: normalizeDictionaryPromptSide(side) } : prev
    );
  }

  function updateDictionaryEditorShuffle(shuffle: boolean) {
    setDictionaryEditor((prev) => (prev ? { ...prev, shuffle } : prev));
  }

  function updateDictionaryEditorAutoSpeak(autoSpeak: boolean) {
    setDictionaryEditor((prev) => {
      if (!prev) {
        return prev;
      }

      const autoSpeakFields =
        autoSpeak && prev.autoSpeakFields.length === 0
          ? [...DEFAULT_DICTIONARY_AUTO_SPEAK_FIELDS]
          : prev.autoSpeakFields;

      return { ...prev, autoSpeak, autoSpeakFields };
    });
  }

  function updateDictionaryEditorProgressMode(progressMode: boolean) {
    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            progressMode,
          }
        : prev
    );
  }

  function updateDictionaryEditorMotivateOnCorrect(motivateOnCorrect: boolean) {
    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            motivateOnCorrect,
          }
        : prev
    );
  }

  function updateDictionaryEditorCardMode(cardMode: boolean) {
    setDictionaryEditor((prev) => (prev ? { ...prev, cardMode } : prev));
  }

  function updateDictionaryEditorAdhdMode(adhdMode: boolean) {
    setDictionaryEditor((prev) => (prev ? { ...prev, adhdMode } : prev));
  }

  function updateDictionaryEditorMotivationAdvanceMode(
    motivationAdvanceMode: DictionaryMotivationAdvanceMode
  ) {
    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            motivationAdvanceMode: normalizeDictionaryMotivationAdvanceMode(
              motivationAdvanceMode
            ),
          }
        : prev
    );
  }

  function updateDictionaryEditorMotivationAutoSeconds(value: string) {
    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            motivationAutoSeconds: normalizeDictionaryMotivationAutoSeconds(value),
          }
        : prev
    );
  }

  function toggleDictionaryEditorAutoSpeakField(field: DictionaryEntryField) {
    if (!dictionaryEditor) {
      return;
    }

    const visibleFields = normalizeDictionaryAutoSpeakFields(
      dictionaryEditor.autoSpeakFields,
      [],
      dictionaryEditor.columns
    );
    if (
      dictionaryEditor.autoSpeak &&
      visibleFields.includes(field) &&
      visibleFields.length <= 1
    ) {
      pushNotice("Для автоозвучки нужна хотя бы одна выбранная сторона.", "warn");
      return;
    }

    setDictionaryEditor((prev) => {
      if (!prev) {
        return prev;
      }

      const currentFields = normalizeDictionaryAutoSpeakFields(
        prev.autoSpeakFields,
        [],
        prev.columns
      );
      const isSelected = currentFields.includes(field);
      if (isSelected) {
        return {
          ...prev,
          autoSpeakFields: currentFields.filter((item) => item !== field),
        };
      }

      return {
        ...prev,
        autoSpeakFields: [...currentFields, field],
      };
    });
  }

  function toggleDictionaryEditorManualSpeakField(field: DictionaryEntryField) {
    if (!dictionaryEditor) {
      return;
    }

    const visibleFields = normalizeDictionaryManualSpeakFields(
      dictionaryEditor.manualSpeakFields,
      [],
      dictionaryEditor.columns
    );
    if (visibleFields.includes(field) && visibleFields.length <= 1) {
      pushNotice("Для кнопки озвучки нужно хотя бы одно выбранное поле.", "warn");
      return;
    }

    setDictionaryEditor((prev) => {
      if (!prev) {
        return prev;
      }

      const currentFields = normalizeDictionaryManualSpeakFields(
        prev.manualSpeakFields,
        [],
        prev.columns
      );
      const isSelected = currentFields.includes(field);
      if (isSelected) {
        return {
          ...prev,
          manualSpeakFields: currentFields.filter((item) => item !== field),
        };
      }

      return {
        ...prev,
        manualSpeakFields: [...currentFields, field],
      };
    });
  }

  function updateDictionaryEditorLabel(
    field: DictionaryLabelField,
    value: string
  ) {
    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            labels: {
              ...prev.labels,
              [field]: value,
            },
            columns: prev.columns.map((column) =>
              column.id === field ? { ...column, label: value } : column
            ),
          }
        : prev
    );
  }

  function updateDictionaryEditorNoteDisplayMode(
    noteDisplayMode: DictionaryNoteDisplayMode
  ) {
    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            noteDisplayMode: normalizeDictionaryNoteDisplayMode(noteDisplayMode),
          }
        : prev
    );
  }

  function canChangeDictionaryColumnKind(
    columns: DictionaryColumn[],
    columnId: string,
    nextKind: DictionaryColumnKind
  ): boolean {
    const target = columns.find((column) => column.id === columnId);
    if (!target || target.kind !== "word" || nextKind === "word") {
      return true;
    }

    return columns.some(
      (column) =>
        column.id !== columnId &&
        column.side === target.side &&
        column.kind === "word"
    );
  }

  function updateDictionaryEditorColumnKind(
    columnId: string,
    kind: DictionaryColumnKind
  ) {
    setDictionaryEditor((prev) => {
      if (!prev) {
        return prev;
      }

      if (!canChangeDictionaryColumnKind(prev.columns, columnId, kind)) {
        pushNotice("На каждой стороне должна остаться хотя бы одна колонка «Слово».", "warn");
        return prev;
      }

      return {
        ...prev,
        columns: normalizeDictionaryColumns(
          prev.columns.map((column) => {
            if (column.id !== columnId) {
              return column;
            }

            if (kind === "word") {
              const wordColumn = { ...column, kind };
              delete wordColumn.wordIndex;
              return wordColumn;
            }

            return { ...column, kind };
          }),
          prev.labels
        ),
      };
    });
  }

  function updateDictionaryEditorColumnWordIndex(
    columnId: string,
    wordIndex: number
  ) {
    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            columns: normalizeDictionaryColumns(
              prev.columns.map((column) =>
                column.id === columnId && column.kind === "note"
                  ? { ...column, wordIndex }
                  : column
              ),
              prev.labels
            ),
          }
        : prev
    );
  }

  function addDictionaryEditorColumn(side: DictionaryPromptSide) {
    setDictionaryEditor((prev) => {
      if (!prev) {
        return prev;
      }

      const sideColumns = getDictionarySideColumns(prev.columns, side);
      const label = `пояснение ${side === "side1" ? "1" : "2"}.${
        sideColumns.length + 1
      }`;
      const column: DictionaryColumn = {
        id: `${side}-note-${crypto.randomUUID()}`,
        side,
        kind: "note",
        label,
        wordIndex: 0,
      };

      const nextColumns = normalizeDictionaryColumns(
        side === "side1"
          ? [
              ...prev.columns.filter((item) => item.side === "side1"),
              column,
              ...prev.columns.filter((item) => item.side === "side2"),
            ]
          : [...prev.columns, column],
        prev.labels
      );

      return {
        ...prev,
        columns: nextColumns,
        labels: {
          ...prev.labels,
          [column.id]: column.label,
        },
        entries: prev.entries.map((entry) => ({
          ...entry,
          values: {
            ...entry.values,
            [column.id]: "",
          },
        })),
      };
    });
  }

  async function removeDictionaryEditorColumn(columnId: string) {
    if (!dictionaryEditor) {
      return;
    }

    const target = dictionaryEditor.columns.find((column) => column.id === columnId);
    if (!target) {
      return;
    }

    if (
      target.kind === "word" &&
      !canChangeDictionaryColumnKind(dictionaryEditor.columns, columnId, "note")
    ) {
      pushNotice("Нельзя удалить последнюю колонку «Слово» на стороне.", "warn");
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Удалить столбец #DICT",
      message: `Столбец «${target.label}» и его значения будут удалены из всех строк. Продолжить?`,
      confirmLabel: "удалить",
      cancelLabel: "отмена",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setDictionaryEditor((prev) => {
      if (!prev) {
        return prev;
      }

      const nextLabels = { ...prev.labels };
      delete nextLabels[columnId];
      const nextColumns = normalizeDictionaryColumns(
        prev.columns.filter((column) => column.id !== columnId),
        nextLabels
      );
      const autoFallback = getDefaultDictionaryAutoSpeakFields(nextColumns);
      const manualFallback = getDefaultDictionaryManualSpeakFields(nextColumns);

      return {
        ...prev,
        columns: nextColumns,
        labels: nextLabels,
        autoSpeakFields: normalizeDictionaryAutoSpeakFields(
          prev.autoSpeakFields.filter((field) => field !== columnId),
          autoFallback,
          nextColumns
        ),
        manualSpeakFields: normalizeDictionaryManualSpeakFields(
          prev.manualSpeakFields.filter((field) => field !== columnId),
          manualFallback,
          nextColumns
        ),
        entries: prev.entries.map((entry) => {
          const values = { ...entry.values };
          delete values[columnId];
          return { ...entry, values };
        }),
      };
    });
  }

  function updateDictionaryEditorEntry(
    entryId: string,
    field: DictionaryEntryField,
    value: string
  ) {
    setDictionaryEditor((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        entries: prev.entries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                values: {
                  ...entry.values,
                  [field]: value,
                },
              }
            : entry
        ),
      };
    });
  }

  function addDictionaryEditorEntry() {
    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            entries: [...prev.entries, createEmptyDictionaryEntry(prev.columns)],
          }
        : prev
    );
  }

  function removeDictionaryEditorEntry(entryId: string) {
    setDictionaryEditor((prev) => {
      if (!prev) {
        return prev;
      }

      const entries = prev.entries.filter((entry) => entry.id !== entryId);
      return {
        ...prev,
        entries:
          entries.length > 0 ? entries : [createEmptyDictionaryEntry(prev.columns)],
      };
    });
  }

  function getDictionaryEditorNormalizedDraft(): {
    title: string;
    payload: MessageDictionaryPayload;
  } | null {
    if (!dictionaryEditor) {
      return null;
    }

    const columns = normalizeDictionaryColumns(
      dictionaryEditor.columns,
      dictionaryEditor.labels
    );
    const labels = normalizeDictionaryLabels(dictionaryEditor.labels, columns);
    const validation = validateDictionaryEditorEntries(
      dictionaryEditor.entries,
      columns
    );
    if (validation.error) {
      pushNotice(validation.error, "warn");
      return null;
    }

    const autoSpeakFields = normalizeDictionaryAutoSpeakFields(
      dictionaryEditor.autoSpeakFields,
      [],
      columns
    );
    if (dictionaryEditor.autoSpeak && autoSpeakFields.length === 0) {
      pushNotice("Выбери хотя бы одно поле для автоозвучки.", "warn");
      return null;
    }

    const manualSpeakFields = normalizeDictionaryManualSpeakFields(
      dictionaryEditor.manualSpeakFields,
      [],
      columns
    );
    if (manualSpeakFields.length === 0) {
      pushNotice("Выбери хотя бы одно поле для кнопки озвучки.", "warn");
      return null;
    }

    return {
      title: normalizeDictionaryTitle(dictionaryEditor.titleDraft),
      payload: {
        description: normalizeDictionaryDescription(
          dictionaryEditor.descriptionDraft
        ),
        tags: parseDictionaryTags(dictionaryEditor.tagsDraft),
        promptSide: dictionaryEditor.promptSide,
        shuffle: dictionaryEditor.shuffle,
        autoSpeak: dictionaryEditor.autoSpeak,
        autoSpeakFields,
        manualSpeakFields,
        noteDisplayMode: dictionaryEditor.noteDisplayMode,
        progressMode: dictionaryEditor.progressMode,
        motivateOnCorrect: dictionaryEditor.motivateOnCorrect,
        cardMode: dictionaryEditor.cardMode,
        adhdMode: dictionaryEditor.adhdMode,
        motivationAdvanceMode: dictionaryEditor.motivationAdvanceMode,
        motivationAutoSeconds: dictionaryEditor.motivationAutoSeconds,
        labels,
        columns,
        entries: validation.entries,
      },
    };
  }

  function handleExportDictionaryJson() {
    const draft = getDictionaryEditorNormalizedDraft();
    if (!draft) {
      return;
    }

    const document = buildDictionaryExportDocument(draft.title, draft.payload);
    downloadTextFile(
      makeDictionaryExportFileName(draft.title, "json"),
      JSON.stringify(document, null, 2),
      "application/json;charset=utf-8"
    );
    pushNotice("#DICT экспортирован в JSON.");
  }

  function handleExportDictionaryTsv() {
    const draft = getDictionaryEditorNormalizedDraft();
    if (!draft) {
      return;
    }

    downloadTextFile(
      makeDictionaryExportFileName(draft.title, "tsv"),
      dictionaryPayloadToTsv(draft.payload),
      "text/tab-separated-values;charset=utf-8"
    );
    pushNotice("#DICT экспортирован в TSV.");
  }

  function handleOpenDictionaryImportFilePicker() {
    dictionaryImportFileRef.current?.click();
  }

  async function handleDictionaryImportFileChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setDictionaryImportDraft(text);
      const parsed = parseDictionaryImportDraft(
        text,
        dictionaryEditor?.columns,
        dictionaryEditor?.labels
      );
      if (parsed.ok) {
        pushNotice(`Файл прочитан: ${parsed.entries.length} пар.`);
      } else {
        pushNotice(parsed.error, "warn");
      }
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось прочитать файл импорта."), "error");
    }
  }

  async function readInsertedDictionaryImportFile(file: File | null) {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setDictionaryImportDraft(text);
      const parsed = parseDictionaryImportDraft(
        text,
        dictionaryEditor?.columns,
        dictionaryEditor?.labels
      );
      if (parsed.ok) {
        pushNotice(`Файл прочитан: ${parsed.entries.length} пар.`);
      } else {
        pushNotice(parsed.error, "warn");
      }
    } catch (error) {
      pushNotice(
        toErrorMessage(error, "Не удалось прочитать файл импорта."),
        "error"
      );
    }
  }

  function getDictionaryImportClipboardFile(
    event: ClipboardEvent<HTMLTextAreaElement>
  ): File | null {
    const directFile = event.clipboardData.files?.[0] ?? null;
    if (directFile) {
      return directFile;
    }

    for (const item of Array.from(event.clipboardData.items ?? [])) {
      if (item.kind !== "file") {
        continue;
      }

      const file = item.getAsFile();
      if (file) {
        return file;
      }
    }

    return null;
  }

  function handleDictionaryImportPaste(
    event: ClipboardEvent<HTMLTextAreaElement>
  ) {
    const file = getDictionaryImportClipboardFile(event);
    if (!file) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void readInsertedDictionaryImportFile(file);
  }

  function handleDictionaryImportDragOver(
    event: DragEvent<HTMLDivElement | HTMLTextAreaElement>
  ) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDictionaryImportDrop(
    event: DragEvent<HTMLDivElement | HTMLTextAreaElement>
  ) {
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void readInsertedDictionaryImportFile(file);
  }

  async function handleApplyDictionaryImport() {
    if (!dictionaryEditor) {
      return;
    }

    if (!dictionaryImportPreview.ok) {
      pushNotice(dictionaryImportPreview.error, "warn");
      return;
    }

    const message =
      dictionaryImportPreview.kind === "json"
        ? `JSON импорт заменит весь черновик словаря и загрузит ${dictionaryImportPreview.entries.length} пар. Продолжить?`
        : `Импорт таблицы полностью заменит текущие строки словаря на ${dictionaryImportPreview.entries.length} пар. Название, описание, теги, подписи и настройки останутся как сейчас. Продолжить?`;

    const confirmed = await requestConfirmation({
      title: "Импорт #DICT",
      message,
      confirmLabel: "заменить",
      cancelLabel: "отмена",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    if (dictionaryImportPreview.kind === "json") {
      setDictionaryEditor((prev) =>
        prev
          ? {
              ...prev,
              titleDraft: dictionaryImportPreview.title,
              descriptionDraft: dictionaryImportPreview.payload.description,
              tagsDraft: serializeDictionaryTags(dictionaryImportPreview.payload.tags),
              promptSide: dictionaryImportPreview.payload.promptSide,
              shuffle: dictionaryImportPreview.payload.shuffle,
              autoSpeak: dictionaryImportPreview.payload.autoSpeak,
              autoSpeakFields: normalizeDictionaryAutoSpeakFields(
                dictionaryImportPreview.payload.autoSpeakFields,
                getDefaultDictionaryAutoSpeakFields(
                  dictionaryImportPreview.payload.columns
                ),
                dictionaryImportPreview.payload.columns
              ),
              manualSpeakFields: normalizeDictionaryManualSpeakFields(
                dictionaryImportPreview.payload.manualSpeakFields,
                getDefaultDictionaryManualSpeakFields(
                  dictionaryImportPreview.payload.columns
                ),
                dictionaryImportPreview.payload.columns
              ),
              noteDisplayMode: dictionaryImportPreview.payload.noteDisplayMode,
              progressMode: dictionaryImportPreview.payload.progressMode,
              motivateOnCorrect: dictionaryImportPreview.payload.motivateOnCorrect,
              cardMode: dictionaryImportPreview.payload.cardMode,
              adhdMode: dictionaryImportPreview.payload.adhdMode,
              motivationAdvanceMode:
                dictionaryImportPreview.payload.motivationAdvanceMode,
              motivationAutoSeconds:
                dictionaryImportPreview.payload.motivationAutoSeconds,
              labels: normalizeDictionaryLabels(
                dictionaryImportPreview.payload.labels,
                dictionaryImportPreview.payload.columns
              ),
              columns: dictionaryImportPreview.payload.columns,
              entries: makeDictionaryEditorEntries(dictionaryImportPreview.payload),
            }
          : prev
      );
      setDictionaryImportDraft("");
      pushNotice("JSON импортирован в черновик #DICT.");
      return;
    }

    setDictionaryEditor((prev) =>
      prev
        ? {
            ...prev,
            entries: dictionaryImportPreview.entries.map((entry) => ({
              id: entry.id,
              values: normalizeDictionaryEntryValues(entry, prev.columns),
            })),
          }
        : prev
    );
    setDictionaryImportDraft("");
    pushNotice("Строки #DICT заменены импортом.");
  }

  async function handleSaveDictionaryEditor(
    options: { openStudyAfterSave?: boolean } = {}
  ) {
    if (!dictionaryEditor) {
      return;
    }

    const sourceCategoryId = dictionaryEditor.sourceCategoryId;
    const columns = normalizeDictionaryColumns(
      dictionaryEditor.columns,
      dictionaryEditor.labels
    );
    const labels = normalizeDictionaryLabels(dictionaryEditor.labels, columns);
    const validation = validateDictionaryEditorEntries(
      dictionaryEditor.entries,
      columns
    );
    if (validation.error) {
      pushNotice(validation.error, "warn");
      return;
    }

    const autoSpeakFields = normalizeDictionaryAutoSpeakFields(
      dictionaryEditor.autoSpeakFields,
      [],
      columns
    );
    if (dictionaryEditor.autoSpeak && autoSpeakFields.length === 0) {
      pushNotice("Выбери хотя бы одно поле для автоозвучки.", "warn");
      return;
    }

    const manualSpeakFields = normalizeDictionaryManualSpeakFields(
      dictionaryEditor.manualSpeakFields,
      [],
      columns
    );
    if (manualSpeakFields.length === 0) {
      pushNotice("Выбери хотя бы одно поле для кнопки озвучки.", "warn");
      return;
    }

    const nextTitle = normalizeDictionaryTitle(dictionaryEditor.titleDraft);
    const nextPayload: MessageDictionaryPayload = {
      description: normalizeDictionaryDescription(
        dictionaryEditor.descriptionDraft
      ),
      tags: parseDictionaryTags(dictionaryEditor.tagsDraft),
      promptSide: dictionaryEditor.promptSide,
      shuffle: dictionaryEditor.shuffle,
      autoSpeak: dictionaryEditor.autoSpeak,
      autoSpeakFields,
      manualSpeakFields,
      noteDisplayMode: dictionaryEditor.noteDisplayMode,
      progressMode: dictionaryEditor.progressMode,
      motivateOnCorrect: dictionaryEditor.motivateOnCorrect,
      cardMode: dictionaryEditor.cardMode,
      adhdMode: dictionaryEditor.adhdMode,
      motivationAdvanceMode: dictionaryEditor.motivationAdvanceMode,
      motivationAutoSeconds: dictionaryEditor.motivationAutoSeconds,
      labels,
      columns,
      entries: validation.entries,
    };
    const serializedContent = serializeMessageDictionaryContent(nextPayload);
    const finishDictionarySave = (studyOptions: {
      sourceCategoryId: string;
      sourceMessageId: string | null;
      dictionaryId: string | null;
      title: string;
      payload: MessageDictionaryPayload;
    }) => {
      if (options.openStudyAfterSave) {
        openDictionaryStudy(studyOptions);
        return;
      }

      closeDictionaryEditor();
    };

    if (dictionaryEditor.source === "continuous") {
      const sourceDocument = getContinuousDocumentForCategory(sourceCategoryId);
      if (!sourceDocument) {
        pushNotice("Не удалось открыть сплошной словарь.", "error");
        return;
      }

      if (dictionaryEditor.dictionaryId) {
        let foundDictionary = false;
        const nextDictionaries = sourceDocument.dictionaries.map((dictionary) => {
          if (dictionary.id !== dictionaryEditor.dictionaryId) {
            return dictionary;
          }

          foundDictionary = true;
          return {
            id: dictionary.id,
            title: nextTitle,
            ...nextPayload,
          };
        });

        if (!foundDictionary) {
          pushNotice("Словарь не найден.", "warn");
          closeDictionaryEditor();
          return;
        }

        commitContinuousDocumentForCategory(sourceCategoryId, {
          text: sourceDocument.text,
          checklists: sourceDocument.checklists,
          dictionaries: nextDictionaries,
          schedules: sourceDocument.schedules,
        });
        pushNotice("#DICT обновлен.");
        finishDictionarySave({
          sourceCategoryId,
          sourceMessageId: null,
          dictionaryId: dictionaryEditor.dictionaryId,
          title: nextTitle,
          payload: nextPayload,
        });
        return;
      }

      const createdDictionary: DictionaryBlock = {
        id: crypto.randomUUID(),
        title: nextTitle,
        ...nextPayload,
      };

      commitContinuousDocumentForCategory(sourceCategoryId, {
        text: sourceDocument.text,
        checklists: sourceDocument.checklists,
        dictionaries: [...sourceDocument.dictionaries, createdDictionary],
        schedules: sourceDocument.schedules,
      });
      pushNotice("#DICT добавлен.");
      finishDictionarySave({
        sourceCategoryId,
        sourceMessageId: null,
        dictionaryId: createdDictionary.id,
        title: nextTitle,
        payload: nextPayload,
      });
      return;
    }

    if (!dictionaryEditor.sourceMessageId) {
      let shouldCloseEditor = true;
      setIsMutating(true);
      try {
        const created = await createMessageRequest(
          sourceCategoryId,
          nextTitle,
          serializedContent,
          "info"
        );
        savedMessageContentRef.current[created.id] = created.content;
        messageDraftVersionRef.current[created.id] = 0;
        messageAckVersionRef.current[created.id] = 0;
        clearMessageSaveState(created.id);
        setMessagesByCategory((prev) => ({
          ...prev,
          [sourceCategoryId]: [...(prev[sourceCategoryId] ?? []), created].sort(
            sortMessages
          ),
        }));
        setSelectedMessageId(created.id);
        pushNotice("#DICT добавлен.");
        if (options.openStudyAfterSave) {
          shouldCloseEditor = false;
          openDictionaryStudy({
            sourceCategoryId,
            sourceMessageId: created.id,
            dictionaryId: null,
            title: nextTitle,
            payload: nextPayload,
          });
        }
      } catch (error) {
        pushNotice(toErrorMessage(error, "Не удалось добавить #DICT."), "error");
      } finally {
        setIsMutating(false);
        if (shouldCloseEditor) {
          closeDictionaryEditor();
        }
      }
      return;
    }

    const targetMessage = (messagesByCategory[sourceCategoryId] ?? []).find(
      (message) => message.id === dictionaryEditor.sourceMessageId
    );
    if (!targetMessage) {
      pushNotice("Словарь не найден.", "warn");
      closeDictionaryEditor();
      return;
    }

    if (!parseMessageDictionaryContent(targetMessage.content)) {
      pushNotice("Содержимое блока больше не является #DICT.", "warn");
      closeDictionaryEditor();
      return;
    }

    const previousTitle = targetMessage.title;
    const previousContent = targetMessage.content;

    setMessagesByCategory((prev) => ({
      ...prev,
      [sourceCategoryId]: (prev[sourceCategoryId] ?? []).map((message) =>
        message.id === targetMessage.id
          ? {
              ...message,
              title: nextTitle,
              content: serializedContent,
              updated_at: new Date().toISOString(),
            }
          : message
      ),
    }));

    let shouldCloseEditor = true;
    try {
      await patchMessage(targetMessage.id, sourceCategoryId, {
        title: nextTitle,
        content: serializedContent,
      });
      pushNotice("#DICT обновлен.");
      if (options.openStudyAfterSave) {
        shouldCloseEditor = false;
        openDictionaryStudy({
          sourceCategoryId,
          sourceMessageId: targetMessage.id,
          dictionaryId: null,
          title: nextTitle,
          payload: nextPayload,
        });
      }
    } catch (error) {
      setMessagesByCategory((prev) => ({
        ...prev,
        [sourceCategoryId]: (prev[sourceCategoryId] ?? []).map((message) =>
          message.id === targetMessage.id
            ? {
                ...message,
                title: previousTitle,
                content: previousContent,
              }
            : message
        ),
      }));
      pushNotice(toErrorMessage(error, "Не удалось обновить #DICT."), "error");
    } finally {
      if (shouldCloseEditor) {
        closeDictionaryEditor();
      }
    }
  }

  async function handleDeleteDictionaryFromEditor() {
    const confirmed = await requestConfirmation({
      title: "Удалить #DICT",
      message:
        "Словарь будет удален полностью. Это действие нельзя отменить через настройки словаря. Продолжить?",
      confirmLabel: "удалить",
      cancelLabel: "отмена",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    if (dictionaryEditor?.source === "continuous") {
      if (!dictionaryEditor.dictionaryId) {
        closeDictionaryEditor();
        return;
      }

      const sourceDocument = getContinuousDocumentForCategory(
        dictionaryEditor.sourceCategoryId
      );
      if (!sourceDocument) {
        pushNotice("Не удалось удалить словарь.", "error");
        return;
      }

      const nextDictionaries = sourceDocument.dictionaries.filter(
        (dictionary) => dictionary.id !== dictionaryEditor.dictionaryId
      );

      if (nextDictionaries.length === sourceDocument.dictionaries.length) {
        closeDictionaryEditor();
        return;
      }

      commitContinuousDocumentForCategory(dictionaryEditor.sourceCategoryId, {
        text: sourceDocument.text,
        checklists: sourceDocument.checklists,
        dictionaries: nextDictionaries,
        schedules: sourceDocument.schedules,
      });
      setDictionaryStudy((prev) =>
        prev?.dictionaryId === dictionaryEditor.dictionaryId ? null : prev
      );
      pushNotice("#DICT удален.");
      closeDictionaryEditor();
      return;
    }

    if (!dictionaryEditor?.sourceMessageId) {
      closeDictionaryEditor();
      return;
    }

    const sourceCategoryId = dictionaryEditor.sourceCategoryId;
    const messageId = dictionaryEditor.sourceMessageId;

    setIsMutating(true);
    try {
      await deleteMessageRequest(messageId);

      clearMessageSaveState(messageId);
      delete savedMessageContentRef.current[messageId];
      delete messageDraftVersionRef.current[messageId];
      delete messageAckVersionRef.current[messageId];
      syncMessageSavingState();

      setMessagesByCategory((prev) => ({
        ...prev,
        [sourceCategoryId]: (prev[sourceCategoryId] ?? []).filter(
          (message) => message.id !== messageId
        ),
      }));

      if (selectedMessageId === messageId) {
        setSelectedMessageId(null);
      }

      setDictionaryStudy((prev) =>
        prev?.sourceMessageId === messageId ? null : prev
      );
      pushNotice("#DICT удален.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось удалить #DICT."), "error");
    } finally {
      setIsMutating(false);
      closeDictionaryEditor();
    }
  }

  function clearDictionaryMotivationTimer() {
    dictionaryMotivationRequestIdRef.current += 1;
    if (dictionaryMotivationTimerRef.current) {
      clearTimeout(dictionaryMotivationTimerRef.current);
      dictionaryMotivationTimerRef.current = null;
    }
    if (dictionaryMotivationExitTimerRef.current) {
      clearTimeout(dictionaryMotivationExitTimerRef.current);
      dictionaryMotivationExitTimerRef.current = null;
    }
    if (dictionaryMotivationEnterFrameRef.current) {
      cancelAnimationFrame(dictionaryMotivationEnterFrameRef.current);
      dictionaryMotivationEnterFrameRef.current = null;
    }
  }

  function cancelDictionarySpeech() {
    if (dictionaryAutoSpeechTimerRef.current) {
      clearTimeout(dictionaryAutoSpeechTimerRef.current);
      dictionaryAutoSpeechTimerRef.current = null;
    }

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
  }

  function commitDictionaryStudyState(
    nextStudy: DictionaryStudyState,
    options: { autoSpeak?: boolean } = {}
  ) {
    saveDictionaryStudyProgress(nextStudy);
    setDictionaryStudy(nextStudy);

    if (options.autoSpeak) {
      queueDictionaryAutoSpeech(nextStudy);
    }
  }

  function queueDictionaryAutoSpeech(study: DictionaryStudyState) {
    if (
      !study.autoSpeak ||
      study.isProgressComplete ||
      study.motivationImageUrl ||
      typeof window === "undefined"
    ) {
      return;
    }

    if (dictionaryAutoSpeechTimerRef.current) {
      clearTimeout(dictionaryAutoSpeechTimerRef.current);
    }

    dictionaryAutoSpeechTimerRef.current = window.setTimeout(() => {
      dictionaryAutoSpeechTimerRef.current = null;
      speakDictionaryStudyTextSegments(
        getDictionaryStudyActiveTextSegments(study, "auto"),
        {
          warn: false,
        }
      );
    }, 120);
  }

  function openDictionaryStudy(options: {
    sourceCategoryId: string;
    sourceMessageId: string | null;
    dictionaryId: string | null;
    title: string;
    payload: MessageDictionaryPayload;
  }) {
    const payload = options.payload;
    const baseCards = [...payload.entries];
    const defaultCards =
      payload.shuffle && baseCards.length > 1
        ? shuffleDictionaryEntries(baseCards)
        : baseCards;

    if (defaultCards.length === 0) {
      pushNotice("Добавь пары в словарь перед заучиванием.", "warn");
      return;
    }

    const progressKey = makeDictionaryStudyProgressKey(options);
    const restoredProgress = restoreDictionaryStudyProgress(
      readDictionaryStudyProgress(progressKey),
      baseCards,
      defaultCards,
      payload.shuffle,
      payload.progressMode
    );
    const nextStudy: DictionaryStudyState = {
      sourceCategoryId: options.sourceCategoryId,
      sourceMessageId: options.sourceMessageId,
      dictionaryId: options.dictionaryId,
      title: options.title,
      promptSide: payload.promptSide,
      labels: normalizeDictionaryLabels(payload.labels, payload.columns),
      columns: payload.columns,
      baseCards,
      cards: restoredProgress.cards,
      shuffle: payload.shuffle,
      autoSpeak: payload.autoSpeak,
      autoSpeakFields: normalizeDictionaryAutoSpeakFields(
        payload.autoSpeakFields,
        getDefaultDictionaryAutoSpeakFields(payload.columns),
        payload.columns
      ),
      manualSpeakFields: normalizeDictionaryManualSpeakFields(
        payload.manualSpeakFields,
        getDefaultDictionaryManualSpeakFields(payload.columns),
        payload.columns
      ),
      noteDisplayMode: payload.noteDisplayMode,
      progressMode: payload.progressMode,
      motivateOnCorrect: payload.motivateOnCorrect,
      cardMode: payload.cardMode,
      adhdMode: payload.adhdMode,
      motivationAdvanceMode: payload.motivationAdvanceMode,
      motivationAutoSeconds: payload.motivationAutoSeconds,
      progressKey,
      currentIndex: restoredProgress.currentIndex,
      isAnswerRevealed: restoredProgress.isAnswerRevealed,
      progressStartedAt: restoredProgress.progressStartedAt,
      progressCompletedAt: restoredProgress.progressCompletedAt,
      correctCount: restoredProgress.correctCount,
      wrongCount: restoredProgress.wrongCount,
      answerResultsByEntryId: restoredProgress.answerResultsByEntryId,
      isProgressComplete: restoredProgress.isProgressComplete,
      motivationImageUrl: null,
      motivationDismissAction: "clear",
      motivationPhase: "visible",
      motivationImageKey: 0,
      transitionKey: 0,
      activeWordIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
      activeNoteIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
    };

    cancelDictionarySpeech();
    clearDictionaryMotivationTimer();
    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryImportDraft("");
    if ((nextStudy.motivateOnCorrect || nextStudy.adhdMode) && motivationImages.length === 0) {
      void loadMotivationImages();
    } else if (nextStudy.motivateOnCorrect || nextStudy.adhdMode) {
      preloadMotivationImages(motivationImages);
    }

    if (nextStudy.adhdMode && !nextStudy.isProgressComplete) {
      void showDictionaryStudyMotivation(nextStudy, "clear", {
        autoSpeakOnEmpty: true,
      });
      return;
    }

    commitDictionaryStudyState(nextStudy, {
      autoSpeak: !nextStudy.isProgressComplete,
    });
  }

  function closeDictionaryStudy() {
    cancelDictionarySpeech();
    clearDictionaryMotivationTimer();
    setDictionarySimilarPopup(null);
    setDictionaryStudy(null);
  }

  async function openDictionaryStudySimilar(identity: SharedDictionaryEntryIdentity) {
    setDictionarySimilarPopup({
      identity,
      groups: [],
      results: [],
      isLoading: true,
      error: null,
    });

    try {
      const params = new URLSearchParams({
        sourceCategoryId: identity.sourceCategoryId,
        entryId: identity.entryId,
      });
      if (identity.sourceMessageId) {
        params.set("sourceMessageId", identity.sourceMessageId);
      }
      if (identity.dictionaryId) {
        params.set("dictionaryId", identity.dictionaryId);
      }

      const response = await authorizedFetch(
        `/api/dictionary-groups/similar?${params.toString()}`,
        {
          cache: "no-store",
        }
      );
      const payload = (await response.json()) as DictionaryGroupSimilarPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось загрузить похожие слова.");
      }

      setDictionarySimilarPopup({
        identity,
        groups: payload.data.groups,
        results: payload.data.results,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setDictionarySimilarPopup({
        identity,
        groups: [],
        results: [],
        isLoading: false,
        error: toErrorMessage(error, "Не удалось загрузить похожие слова."),
      });
    }
  }

  function openDictionaryEditorFromStudy() {
    if (!dictionaryStudy) {
      return;
    }

    cancelDictionarySpeech();
    setChecklistEditor(null);
    setChecklistTagSearchQuery("");
    setDictionaryImportDraft("");
    resetDictionaryEditorSearch();
    setDictionaryEditorTab("entries");

    if (dictionaryStudy.dictionaryId) {
      const sourceDocument = getContinuousDocumentForCategory(
        dictionaryStudy.sourceCategoryId
      );
      const dictionary = sourceDocument?.dictionaries.find(
        (item) => item.id === dictionaryStudy.dictionaryId
      );
      if (!dictionary) {
        pushNotice("Не удалось открыть настройки словаря.", "warn");
        return;
      }

      setDictionaryStudy(null);
      setDictionaryEditor({
        source: "continuous",
        sourceCategoryId: dictionaryStudy.sourceCategoryId,
        sourceMessageId: null,
        dictionaryId: dictionary.id,
        titleDraft: dictionary.title,
        descriptionDraft: dictionary.description,
        tagsDraft: serializeDictionaryTags(dictionary.tags),
        promptSide: dictionary.promptSide,
        shuffle: dictionary.shuffle,
        autoSpeak: dictionary.autoSpeak,
        autoSpeakFields: normalizeDictionaryAutoSpeakFields(
          dictionary.autoSpeakFields,
          getDefaultDictionaryAutoSpeakFields(dictionary.columns),
          dictionary.columns
        ),
        manualSpeakFields: normalizeDictionaryManualSpeakFields(
          dictionary.manualSpeakFields,
          getDefaultDictionaryManualSpeakFields(dictionary.columns),
          dictionary.columns
        ),
        noteDisplayMode: dictionary.noteDisplayMode,
        progressMode: dictionary.progressMode,
        motivateOnCorrect: dictionary.motivateOnCorrect,
        cardMode: dictionary.cardMode,
        adhdMode: dictionary.adhdMode,
        motivationAdvanceMode: dictionary.motivationAdvanceMode,
        motivationAutoSeconds: dictionary.motivationAutoSeconds,
        labels: normalizeDictionaryLabels(dictionary.labels, dictionary.columns),
        columns: dictionary.columns,
        entries: makeDictionaryEditorEntries(dictionary),
      });
      return;
    }

    if (!dictionaryStudy.sourceMessageId) {
      pushNotice("Не удалось найти словарь для настроек.", "warn");
      return;
    }

    const message = (messagesByCategory[dictionaryStudy.sourceCategoryId] ?? []).find(
      (item) => item.id === dictionaryStudy.sourceMessageId
    );
    const payload = parseMessageDictionaryContent(message?.content ?? "");
    if (!message || !payload) {
      pushNotice("Не удалось открыть настройки словаря.", "warn");
      return;
    }

    setSelectedMessageId(message.id);
    setDictionaryStudy(null);
    setDictionaryEditor({
      source: "block-message",
      sourceCategoryId: dictionaryStudy.sourceCategoryId,
      sourceMessageId: message.id,
      dictionaryId: null,
      titleDraft: message.title,
      descriptionDraft: payload.description,
      tagsDraft: serializeDictionaryTags(payload.tags),
      promptSide: payload.promptSide,
      shuffle: payload.shuffle,
      autoSpeak: payload.autoSpeak,
      autoSpeakFields: normalizeDictionaryAutoSpeakFields(
        payload.autoSpeakFields,
        getDefaultDictionaryAutoSpeakFields(payload.columns),
        payload.columns
      ),
      manualSpeakFields: normalizeDictionaryManualSpeakFields(
        payload.manualSpeakFields,
        getDefaultDictionaryManualSpeakFields(payload.columns),
        payload.columns
      ),
      noteDisplayMode: payload.noteDisplayMode,
      progressMode: payload.progressMode,
      motivateOnCorrect: payload.motivateOnCorrect,
      cardMode: payload.cardMode,
      adhdMode: payload.adhdMode,
      motivationAdvanceMode: payload.motivationAdvanceMode,
      motivationAutoSeconds: payload.motivationAutoSeconds,
      labels: normalizeDictionaryLabels(payload.labels, payload.columns),
      columns: payload.columns,
      entries: makeDictionaryEditorEntries(payload),
    });
  }

  function toggleDictionaryStudySide() {
    if (!dictionaryStudy) {
      return;
    }
    if (dictionaryStudy.isProgressComplete || dictionaryStudy.motivationImageUrl) {
      return;
    }

    const currentEntry = dictionaryStudy.cards[dictionaryStudy.currentIndex] ?? null;
    if (
      dictionaryStudy.progressMode &&
      currentEntry &&
      dictionaryStudy.answerResultsByEntryId[currentEntry.id]
    ) {
      return;
    }

    cancelDictionarySpeech();
    commitDictionaryStudyState(
      {
        ...dictionaryStudy,
        isAnswerRevealed: !dictionaryStudy.isAnswerRevealed,
        activeWordIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
        activeNoteIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
        transitionKey: dictionaryStudy.transitionKey + 1,
      },
      { autoSpeak: true }
    );
  }

  function moveDictionaryStudySideValue(
    kind: DictionaryColumnKind,
    offset: number
  ) {
    if (!dictionaryStudy || dictionaryStudy.isProgressComplete) {
      return;
    }
    if (dictionaryStudy.motivationImageUrl || offset === 0) {
      return;
    }

    const activeSide = dictionaryStudy.isAnswerRevealed
      ? oppositeDictionaryPromptSide(dictionaryStudy.promptSide)
      : dictionaryStudy.promptSide;
    const currentEntry = dictionaryStudy.cards[dictionaryStudy.currentIndex] ?? null;
    if (!currentEntry) {
      return;
    }

    const wordValues = getDictionaryEntrySideValues(
      currentEntry,
      dictionaryStudy.columns,
      activeSide,
      "word"
    );
    const values =
      kind === "word"
        ? wordValues
        : (() => {
            const activeWordIndex = wrapIndex(
              dictionaryStudy.activeWordIndexBySide[activeSide] ?? 0,
              Math.max(1, wordValues.length)
            );
            const activeWord = wordValues[activeWordIndex] ?? null;
            if (!activeWord) {
              return [];
            }

            return getDictionaryEntrySideValues(
              currentEntry,
              dictionaryStudy.columns,
              activeSide,
              "note"
            ).filter((note) => note.wordIndex === activeWord.wordIndex);
          })();

    if (values.length <= 1) {
      return;
    }

    setDictionaryStudy((prev) => {
      if (!prev) {
        return prev;
      }

      const source =
        kind === "word" ? prev.activeWordIndexBySide : prev.activeNoteIndexBySide;
      const nextIndex = wrapIndex((source[activeSide] ?? 0) + offset, values.length);
      const nextIndexes = {
        ...source,
        [activeSide]: nextIndex,
      };

      return kind === "word"
        ? {
            ...prev,
            activeWordIndexBySide: nextIndexes,
            activeNoteIndexBySide: {
              ...prev.activeNoteIndexBySide,
              [activeSide]: 0,
            },
          }
        : {
            ...prev,
            activeNoteIndexBySide: nextIndexes,
          };
    });
  }

  function moveDictionaryStudy(offset: number) {
    if (!dictionaryStudy || dictionaryStudy.cards.length === 0) {
      return;
    }
    if (dictionaryStudy.motivationImageUrl) {
      return;
    }
    clearDictionaryMotivationTimer();

    if (dictionaryStudy.progressMode) {
      moveDictionaryProgressStudy(offset);
      return;
    }

    cancelDictionarySpeech();
    const nextIndex =
      (dictionaryStudy.currentIndex + offset + dictionaryStudy.cards.length) %
      dictionaryStudy.cards.length;
    const nextStudy: DictionaryStudyState = {
      ...dictionaryStudy,
      currentIndex: nextIndex,
      isAnswerRevealed: false,
      activeWordIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
      activeNoteIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
      motivationImageUrl: null,
      motivationDismissAction: "clear",
      motivationPhase: "visible",
      transitionKey: dictionaryStudy.transitionKey + 1,
    };

    if (dictionaryStudy.adhdMode || dictionaryStudy.motivateOnCorrect) {
      void showDictionaryStudyMotivation(nextStudy, "clear", {
        autoSpeakOnEmpty: true,
      });
      return;
    }

    commitDictionaryStudyState(nextStudy, { autoSpeak: true });
  }

  function moveDictionaryProgressStudy(offset: number) {
    if (!dictionaryStudy || dictionaryStudy.isProgressComplete || offset === 0) {
      return;
    }

    const currentEntry = dictionaryStudy.cards[dictionaryStudy.currentIndex] ?? null;
    const currentAnswerResult = currentEntry
      ? dictionaryStudy.answerResultsByEntryId[currentEntry.id] ?? null
      : null;

    if (offset > 0 && !currentAnswerResult) {
      return;
    }

    if (offset < 0 && dictionaryStudy.currentIndex <= 0) {
      return;
    }

    if (offset > 0 && dictionaryStudy.currentIndex >= dictionaryStudy.cards.length - 1) {
      const counts = getDictionaryStudyAnswerResultCounts(
        dictionaryStudy.answerResultsByEntryId,
        dictionaryStudy.cards
      );
      if (counts.answered >= dictionaryStudy.cards.length) {
        commitDictionaryStudyState({
          ...dictionaryStudy,
          correctCount: counts.correct,
          wrongCount: counts.wrong,
          isProgressComplete: true,
          progressCompletedAt: dictionaryStudy.progressCompletedAt ?? Date.now(),
          motivationImageUrl: null,
          motivationDismissAction: "clear",
          motivationPhase: "visible",
          transitionKey: dictionaryStudy.transitionKey + 1,
        });
      }
      return;
    }

    cancelDictionarySpeech();
    clearDictionaryMotivationTimer();
    const nextIndex = Math.min(
      dictionaryStudy.cards.length - 1,
      Math.max(0, dictionaryStudy.currentIndex + offset)
    );
    const nextEntry = dictionaryStudy.cards[nextIndex] ?? null;
    const nextAnswerResult = nextEntry
      ? dictionaryStudy.answerResultsByEntryId[nextEntry.id] ?? null
      : null;

    commitDictionaryStudyState(
      {
        ...dictionaryStudy,
        currentIndex: nextIndex,
        isAnswerRevealed: Boolean(nextAnswerResult),
        activeWordIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
        activeNoteIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
        motivationImageUrl: null,
        motivationDismissAction: "clear",
        motivationPhase: "visible",
        transitionKey: dictionaryStudy.transitionKey + 1,
      },
      { autoSpeak: !nextAnswerResult }
    );
  }

  function setDictionaryStudyShuffle(shuffle: boolean) {
    if (!dictionaryStudy) {
      return;
    }

    cancelDictionarySpeech();
    clearDictionaryMotivationTimer();
    const nextCards =
      shuffle && dictionaryStudy.baseCards.length > 1
        ? shuffleDictionaryEntries(dictionaryStudy.baseCards)
        : [...dictionaryStudy.baseCards];
    const now = Date.now();
    const nextStudy: DictionaryStudyState = {
      ...dictionaryStudy,
      cards: nextCards,
      shuffle,
      currentIndex: 0,
      isAnswerRevealed: false,
      activeWordIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
      activeNoteIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
      progressStartedAt: now,
      progressCompletedAt: null,
      correctCount: 0,
      wrongCount: 0,
      answerResultsByEntryId: {},
      isProgressComplete: false,
      motivationImageUrl: null,
      motivationDismissAction: "clear",
      motivationPhase: "visible",
      transitionKey: dictionaryStudy.transitionKey + 1,
    };

    if (nextStudy.adhdMode) {
      void showDictionaryStudyMotivation(nextStudy, "clear", {
        autoSpeakOnEmpty: true,
      });
      return;
    }

    commitDictionaryStudyState(nextStudy, { autoSpeak: true });
  }

  function setDictionaryStudyAdhdMode(adhdMode: boolean) {
    if (!dictionaryStudy || dictionaryStudy.adhdMode === adhdMode) {
      return;
    }

    cancelDictionarySpeech();

    if (adhdMode) {
      if (motivationImages.length === 0) {
        void loadMotivationImages();
      } else {
        preloadMotivationImages(motivationImages);
      }
    } else {
      clearDictionaryMotivationTimer();
    }

    commitDictionaryStudyState(
      {
        ...dictionaryStudy,
        adhdMode,
        motivationImageUrl: adhdMode ? dictionaryStudy.motivationImageUrl : null,
        motivationDismissAction: adhdMode
          ? dictionaryStudy.motivationDismissAction
          : "clear",
        motivationPhase: "visible",
        transitionKey: dictionaryStudy.transitionKey + 1,
      },
      {
        autoSpeak:
          !adhdMode &&
          Boolean(dictionaryStudy.motivationImageUrl) &&
          !dictionaryStudy.isProgressComplete,
      }
    );
  }

  function resetDictionaryStudyProgress() {
    if (!dictionaryStudy) {
      return;
    }

    cancelDictionarySpeech();
    clearDictionaryMotivationTimer();
    const nextCards =
      dictionaryStudy.shuffle && dictionaryStudy.baseCards.length > 1
        ? shuffleDictionaryEntries(dictionaryStudy.baseCards)
        : [...dictionaryStudy.baseCards];
    const now = Date.now();
    const nextStudy: DictionaryStudyState = {
      ...dictionaryStudy,
      cards: nextCards,
      currentIndex: 0,
      isAnswerRevealed: false,
      activeWordIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
      activeNoteIndexBySide: makeDefaultDictionaryStudyColumnIndexes(),
      progressStartedAt: now,
      progressCompletedAt: null,
      correctCount: 0,
      wrongCount: 0,
      answerResultsByEntryId: {},
      isProgressComplete: false,
      motivationImageUrl: null,
      motivationDismissAction: "clear",
      motivationPhase: "visible",
      transitionKey: dictionaryStudy.transitionKey + 1,
    };

    if (nextStudy.adhdMode) {
      void showDictionaryStudyMotivation(nextStudy, "clear", {
        autoSpeakOnEmpty: true,
      });
      return;
    }

    commitDictionaryStudyState(nextStudy, { autoSpeak: true });
  }

  function getRandomReadyMotivationImageSrc(): string | null {
    const availableImageUrls = motivationImages
      .map((image) => image.url)
      .filter((url): url is string => Boolean(url));
    if (availableImageUrls.length === 0) {
      return null;
    }

    preloadMotivationImages(motivationImages);
    const readyImageSrcs = availableImageUrls
      .map((url) => readyMotivationImageSrcByUrlRef.current.get(url) ?? null)
      .filter((src): src is string => Boolean(src));
    if (readyImageSrcs.length === 0) {
      return null;
    }

    const index = Math.floor(Math.random() * readyImageSrcs.length);
    return readyImageSrcs[index] ?? null;
  }

  function makeDictionaryStudyMotivationState(
    study: DictionaryStudyState,
    dismissAction: DictionaryMotivationDismissAction
  ): DictionaryStudyState | null {
    const motivationImageSrc = getRandomReadyMotivationImageSrc();
    if (!motivationImageSrc) {
      return null;
    }

    return {
      ...study,
      motivationImageUrl: motivationImageSrc,
      motivationDismissAction: dismissAction,
      motivationPhase: "visible",
      motivationImageKey: study.motivationImageKey + 1,
    };
  }

  function scheduleDictionaryStudyMotivation(motivatedStudy: DictionaryStudyState) {
    if (
      motivatedStudy.motivationAdvanceMode !== "auto" ||
      typeof window === "undefined"
    ) {
      return;
    }

    dictionaryMotivationTimerRef.current = window.setTimeout(() => {
      dictionaryMotivationTimerRef.current = null;
      dismissDictionaryMotivation(motivatedStudy);
    }, getDictionaryMotivationAutoDelayMs(motivatedStudy.motivationAutoSeconds));
  }

  function showDictionaryStudyMotivation(
    study: DictionaryStudyState,
    dismissAction: DictionaryMotivationDismissAction,
    options: { autoSpeakOnEmpty?: boolean; commitOnSkip?: boolean } = {}
  ): DictionaryMotivationShowResult {
    clearDictionaryMotivationTimer();
    const motivatedStudy = makeDictionaryStudyMotivationState(study, dismissAction);
    if (!motivatedStudy) {
      if (options.commitOnSkip ?? true) {
        commitDictionaryStudyState(study, {
          autoSpeak: Boolean(options.autoSpeakOnEmpty && !study.isProgressComplete),
        });
      }
      return "skipped";
    }

    commitDictionaryStudyState(motivatedStudy);
    scheduleDictionaryStudyMotivation(motivatedStudy);
    return "shown";
  }

  function makeAdvancedDictionaryProgressStudy(
    markedStudy: DictionaryStudyState
  ): DictionaryStudyState {
    const nextIndex = markedStudy.currentIndex + 1;
    const counts = getDictionaryStudyAnswerResultCounts(
      markedStudy.answerResultsByEntryId,
      markedStudy.cards
    );
    const isComplete =
      nextIndex >= markedStudy.cards.length && counts.answered >= markedStudy.cards.length;
    const nextEntry = isComplete ? null : (markedStudy.cards[nextIndex] ?? null);
    const nextAnswerResult = nextEntry
      ? markedStudy.answerResultsByEntryId[nextEntry.id] ?? null
      : null;
    const nextStudy: DictionaryStudyState = {
      ...markedStudy,
      currentIndex: isComplete ? markedStudy.currentIndex : nextIndex,
      isAnswerRevealed: Boolean(nextAnswerResult),
      correctCount: counts.correct,
      wrongCount: counts.wrong,
      isProgressComplete: isComplete,
      progressCompletedAt: isComplete ? Date.now() : null,
      motivationImageUrl: null,
      motivationDismissAction: "clear",
      motivationPhase: "visible",
      transitionKey: markedStudy.transitionKey + 1,
    };

    return nextStudy;
  }

  function advanceDictionaryProgressStudy(markedStudy: DictionaryStudyState) {
    const nextStudy = makeAdvancedDictionaryProgressStudy(markedStudy);

    commitDictionaryStudyState(nextStudy, {
      autoSpeak: !nextStudy.isProgressComplete && !nextStudy.isAnswerRevealed,
    });
  }

  async function markDictionaryStudyAnswer(isCorrect: boolean) {
    if (!dictionaryStudy || !dictionaryStudy.progressMode) {
      return;
    }

    if (
      dictionaryStudy.isProgressComplete ||
      dictionaryStudy.motivationImageUrl ||
      !dictionaryStudy.isAnswerRevealed
    ) {
      return;
    }

    const currentEntry = dictionaryStudy.cards[dictionaryStudy.currentIndex] ?? null;
    if (
      !currentEntry ||
      dictionaryStudy.answerResultsByEntryId[currentEntry.id]
    ) {
      return;
    }

    cancelDictionarySpeech();
    clearDictionaryMotivationTimer();

    const answerResultsByEntryId: Record<string, DictionaryStudyAnswerResult> = {
      ...dictionaryStudy.answerResultsByEntryId,
      [currentEntry.id]: isCorrect ? "correct" : "wrong",
    };
    const counts = getDictionaryStudyAnswerResultCounts(
      answerResultsByEntryId,
      dictionaryStudy.cards
    );
    const markedStudy: DictionaryStudyState = {
      ...dictionaryStudy,
      correctCount: counts.correct,
      wrongCount: counts.wrong,
      answerResultsByEntryId,
      motivationImageUrl: null,
      motivationDismissAction: "clear",
      motivationPhase: "visible",
      transitionKey: dictionaryStudy.transitionKey + 1,
    };
    const shouldShowMotivation =
      dictionaryStudy.adhdMode ||
      (isCorrect && dictionaryStudy.motivateOnCorrect);

    if (shouldShowMotivation) {
      const nextStudy = makeAdvancedDictionaryProgressStudy(markedStudy);
      const motivationResult = await showDictionaryStudyMotivation(
        nextStudy,
        "clear",
        { commitOnSkip: false }
      );
      if (motivationResult === "shown" || motivationResult === "canceled") {
        return;
      }

      commitDictionaryStudyState(nextStudy, {
        autoSpeak: !nextStudy.isProgressComplete && !nextStudy.isAnswerRevealed,
      });
      return;
    }

    commitDictionaryStudyState(markedStudy);
    advanceDictionaryProgressStudy(markedStudy);
  }

  function dismissDictionaryMotivation(study = dictionaryStudy) {
    if (!study?.motivationImageUrl) {
      return;
    }

    runAfterDictionaryMotivationExit(study, (exitedStudy) => {
      commitDictionaryStudyState(
        {
          ...exitedStudy,
          motivationImageUrl: null,
          motivationDismissAction: "clear",
          motivationPhase: "visible",
        },
        {
          autoSpeak:
            !exitedStudy.isProgressComplete && !exitedStudy.isAnswerRevealed,
        }
      );
    });
  }

  function continueDictionaryMotivation() {
    dismissDictionaryMotivation();
  }

  function getDictionaryMotivationExitDelayMs() {
    if (typeof window === "undefined") {
      return 0;
    }

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : DICTIONARY_MOTIVATION_EXIT_MS;
  }

  function runAfterDictionaryMotivationExit(
    study: DictionaryStudyState,
    onExited: (exitedStudy: DictionaryStudyState) => void
  ) {
    if (study.motivationPhase === "exiting") {
      return;
    }

    clearDictionaryMotivationTimer();
    const exitingStudy: DictionaryStudyState = {
      ...study,
      motivationPhase: "exiting",
    };
    commitDictionaryStudyState(exitingStudy);

    const finishExit = () => {
      dictionaryMotivationExitTimerRef.current = null;
      onExited(exitingStudy);
    };
    const exitDelayMs = getDictionaryMotivationExitDelayMs();
    if (exitDelayMs <= 0 || typeof window === "undefined") {
      finishExit();
      return;
    }

    dictionaryMotivationExitTimerRef.current = window.setTimeout(
      finishExit,
      exitDelayMs
    );
  }

  function releaseDictionaryDoomscrollClickGuard() {
    if (typeof window === "undefined") {
      dictionaryDoomscrollClickInFlightRef.current = false;
      return;
    }

    window.setTimeout(() => {
      dictionaryDoomscrollClickInFlightRef.current = false;
    }, 140);
  }

  async function handleDictionaryDoomscrollClick() {
    if (!dictionaryStudy || dictionaryDoomscrollClickInFlightRef.current) {
      return;
    }

    dictionaryDoomscrollClickInFlightRef.current = true;
    try {
      if (dictionaryStudy.motivationImageUrl) {
        continueDictionaryMotivation();
        return;
      }

      if (dictionaryStudy.isProgressComplete) {
        return;
      }

      const currentEntry =
        dictionaryStudy.cards[dictionaryStudy.currentIndex] ?? null;
      const currentAnswerResult = currentEntry
        ? dictionaryStudy.answerResultsByEntryId[currentEntry.id] ?? null
        : null;

      if (!dictionaryStudy.isAnswerRevealed) {
        toggleDictionaryStudySide();
        return;
      }

      if (dictionaryStudy.progressMode) {
        if (currentAnswerResult) {
          moveDictionaryStudy(1);
          return;
        }

        await markDictionaryStudyAnswer(true);
        return;
      }

      moveDictionaryStudy(1);
    } finally {
      releaseDictionaryDoomscrollClickGuard();
    }
  }

  function resolveDictionarySpeechLanguage(text: string): string {
    const latinCount = text.match(/[A-Za-z]/g)?.length ?? 0;
    const cyrillicCount = text.match(/[А-Яа-яЁё]/g)?.length ?? 0;
    const startsWithLatin = /^[^A-Za-zА-Яа-яЁё]*[A-Za-z]/.test(text);

    if (latinCount > 0 && (startsWithLatin || latinCount >= cyrillicCount)) {
      return "en-US";
    }

    if (cyrillicCount > 0) {
      return "ru-RU";
    }

    return window.navigator.language || "ru-RU";
  }

  function getDictionarySpeechVoice(lang: string): SpeechSynthesisVoice | null {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return null;
    }

    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      return null;
    }

    const exact = voices.find(
      (voice) => voice.lang.toLocaleLowerCase() === lang.toLocaleLowerCase()
    );
    if (exact) {
      return exact;
    }

    const languagePrefix = lang.split("-")[0]?.toLocaleLowerCase() ?? "";
    return (
      voices.find((voice) =>
        voice.lang.toLocaleLowerCase().startsWith(`${languagePrefix}-`)
      ) ?? null
    );
  }

  function speakDictionaryStudyCurrentCard() {
    if (!dictionaryStudy || dictionaryStudy.isProgressComplete) {
      return;
    }

    speakDictionaryStudyTextSegments(
      getDictionaryStudyActiveTextSegments(dictionaryStudy, "manual"),
      {
        warn: true,
      }
    );
  }

  function speakDictionaryStudyTextSegments(
    segments: string[],
    options: { warn: boolean }
  ) {
    const textSegments = segments.map((text) => text.trim()).filter(Boolean);

    if (textSegments.length === 0) {
      if (options.warn) {
        pushNotice("На карточке нечего озвучить.", "warn");
      }
      return;
    }

    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      if (options.warn) {
        pushNotice("Браузер не поддерживает озвучку.", "warn");
      }
      return;
    }

    window.speechSynthesis.cancel();
    for (const textToSpeak of textSegments) {
      const speechLanguage = resolveDictionarySpeechLanguage(textToSpeak);
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = speechLanguage;
      const voice = getDictionarySpeechVoice(speechLanguage);
      if (voice) {
        utterance.voice = voice;
      }
      window.speechSynthesis.speak(utterance);
    }
  }

  function toggleChecklistMessageCategoryCheckState(
    sourceCategoryId: string,
    sourceMessageId: string,
    targetCategoryId: string,
    checked: boolean
  ) {
    const sourceMessage = (messagesByCategory[sourceCategoryId] ?? []).find(
      (message) => message.id === sourceMessageId
    );
    if (!sourceMessage) {
      return;
    }

    const sourcePayload = parseMessageChecklistContent(sourceMessage.content);
    if (!sourcePayload) {
      return;
    }

    const nextPayload: MessageChecklistPayload = {
      tags: sourcePayload.tags,
      checkedCategoryIds: togglePlainIdSelection(
        sourcePayload.checkedCategoryIds,
        targetCategoryId,
        checked
      ),
      orderMode: sourcePayload.orderMode,
      customOrderCategoryIds: sourcePayload.customOrderCategoryIds,
    };

    const serializedContent = serializeMessageChecklistContent(nextPayload);
    if (serializedContent === sourceMessage.content) {
      return;
    }

    const nextVersion = (messageDraftVersionRef.current[sourceMessageId] ?? 0) + 1;
    messageDraftVersionRef.current[sourceMessageId] = nextVersion;

    setMessagesByCategory((prev) => ({
      ...prev,
      [sourceCategoryId]: (prev[sourceCategoryId] ?? []).map((message) =>
        message.id === sourceMessageId
          ? {
              ...message,
              content: serializedContent,
              updated_at: new Date().toISOString(),
            }
          : message
      ),
    }));

    scheduleMessageContentSave(
      sourceCategoryId,
      sourceMessageId,
      serializedContent,
      nextVersion
    );
  }

  function toggleChecklistParticipationCheckState(
    entry: ChecklistParticipationEntry,
    targetCategoryId: string,
    checked: boolean
  ) {
    if (entry.source === "continuous") {
      toggleChecklistCategoryCheckState(
        entry.sourceCategoryId,
        entry.checklistId,
        targetCategoryId,
        checked
      );
      return;
    }

    if (!entry.sourceMessageId) {
      return;
    }

    toggleChecklistMessageCategoryCheckState(
      entry.sourceCategoryId,
      entry.sourceMessageId,
      targetCategoryId,
      checked
    );
  }

  function toggleChecklistCategoryCheckState(
    sourceCategoryId: string,
    checklistId: string,
    targetCategoryId: string,
    checked: boolean
  ) {
    const sourceDocument = getContinuousDocumentForCategory(sourceCategoryId);
    if (!sourceDocument) {
      return;
    }

    const nextChecklists = sourceDocument.checklists.map((checklist) => {
      if (checklist.id !== checklistId) {
        return checklist;
      }

      return {
        ...checklist,
        checkedCategoryIds: togglePlainIdSelection(
          checklist.checkedCategoryIds,
          targetCategoryId,
          checked
        ),
      };
    });

    commitContinuousDocumentForCategory(sourceCategoryId, {
      text: sourceDocument.text,
      checklists: nextChecklists,
      dictionaries: sourceDocument.dictionaries,
      schedules: sourceDocument.schedules,
    });
  }

  function handleChecklistItemDragStart(
    event: DragEvent<HTMLButtonElement>,
    item: ChecklistDragItem
  ) {
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.categoryId);
    }

    setDragChecklistItem(item);
  }

  function handleViewChecklistItem(categoryId: string) {
    const exists = categories.some((category) => category.id === categoryId);
    if (!exists) {
      pushNotice("Категория пункта не найдена.", "warn");
      return;
    }

    setActiveProjectId(null);
    openCategory(categoryId);
  }

  function handleDropOnContinuousChecklistItem(
    checklistId: string,
    targetCategoryId: string,
    targetChecked: boolean
  ) {
    const dragged = dragChecklistItem;
    if (!dragged || dragged.source !== "continuous") {
      return;
    }

    if (!currentCategory || currentCategory.format !== "continuous") {
      setDragChecklistItem(null);
      return;
    }

    if (
      dragged.sourceCategoryId !== currentCategory.id ||
      dragged.checklistId !== checklistId ||
      dragged.checked !== targetChecked
    ) {
      setDragChecklistItem(null);
      return;
    }

    const sourceDocument = getContinuousDocumentForCategory(currentCategory.id);
    if (!sourceDocument) {
      setDragChecklistItem(null);
      return;
    }

    const sourceChecklist = sourceDocument.checklists.find((checklist) => checklist.id === checklistId);
    if (!sourceChecklist) {
      setDragChecklistItem(null);
      return;
    }

    const checkedKeySet = new Set(
      sourceChecklist.checkedCategoryIds.map((id) => id.toLocaleLowerCase())
    );
    const orderedItems = buildChecklistDisplayItems(
      collectChecklistCategoryOptions(categories, sourceChecklist.tags),
      checkedKeySet,
      sourceChecklist.orderMode,
      sourceChecklist.customOrderCategoryIds
    );

    const uncheckedIds = orderedItems
      .filter((item) => !item.checked)
      .map((item) => item.categoryId);
    const checkedIds = orderedItems
      .filter((item) => item.checked)
      .map((item) => item.categoryId);

    const sourceGroupIds = targetChecked ? checkedIds : uncheckedIds;
    const reorderedGroupIds = reorderIdListByTarget(
      sourceGroupIds,
      dragged.categoryId,
      targetCategoryId
    );

    if (isStringListEqual(sourceGroupIds, reorderedGroupIds)) {
      setDragChecklistItem(null);
      return;
    }

    const nextCustomOrderCategoryIds = targetChecked
      ? [...uncheckedIds, ...reorderedGroupIds]
      : [...reorderedGroupIds, ...checkedIds];

    const nextChecklists: ChecklistBlock[] = sourceDocument.checklists.map((checklist) => {
      if (checklist.id !== checklistId) {
        return checklist;
      }

      return {
        ...checklist,
        orderMode: "custom" as ChecklistItemOrderMode,
        customOrderCategoryIds: dedupePlainList(nextCustomOrderCategoryIds),
      };
    });

    commitContinuousDocumentForCategory(currentCategory.id, {
      text: sourceDocument.text,
      checklists: nextChecklists,
      dictionaries: sourceDocument.dictionaries,
      schedules: sourceDocument.schedules,
    });
    setDragChecklistItem(null);
  }

  function handleDropOnBlockChecklistItem(
    sourceMessageId: string,
    targetCategoryId: string,
    targetChecked: boolean
  ) {
    const dragged = dragChecklistItem;
    if (!dragged || dragged.source !== "block-message") {
      return;
    }

    if (!currentCategoryId) {
      setDragChecklistItem(null);
      return;
    }

    if (
      dragged.sourceCategoryId !== currentCategoryId ||
      dragged.sourceMessageId !== sourceMessageId ||
      dragged.checklistId !== sourceMessageId ||
      dragged.checked !== targetChecked
    ) {
      setDragChecklistItem(null);
      return;
    }

    const sourceMessage = (messagesByCategory[currentCategoryId] ?? []).find(
      (message) => message.id === sourceMessageId
    );
    if (!sourceMessage) {
      setDragChecklistItem(null);
      return;
    }

    const sourcePayload = parseMessageChecklistContent(sourceMessage.content);
    if (!sourcePayload) {
      setDragChecklistItem(null);
      return;
    }

    const checkedKeySet = new Set(
      sourcePayload.checkedCategoryIds.map((id) => id.toLocaleLowerCase())
    );
    const orderedItems = buildChecklistDisplayItems(
      collectChecklistCategoryOptions(categories, sourcePayload.tags),
      checkedKeySet,
      sourcePayload.orderMode,
      sourcePayload.customOrderCategoryIds
    );

    const uncheckedIds = orderedItems
      .filter((item) => !item.checked)
      .map((item) => item.categoryId);
    const checkedIds = orderedItems
      .filter((item) => item.checked)
      .map((item) => item.categoryId);

    const sourceGroupIds = targetChecked ? checkedIds : uncheckedIds;
    const reorderedGroupIds = reorderIdListByTarget(
      sourceGroupIds,
      dragged.categoryId,
      targetCategoryId
    );

    if (isStringListEqual(sourceGroupIds, reorderedGroupIds)) {
      setDragChecklistItem(null);
      return;
    }

    const nextCustomOrderCategoryIds = targetChecked
      ? [...uncheckedIds, ...reorderedGroupIds]
      : [...reorderedGroupIds, ...checkedIds];

    const nextPayload: MessageChecklistPayload = {
      ...sourcePayload,
      orderMode: "custom",
      customOrderCategoryIds: dedupePlainList(nextCustomOrderCategoryIds),
    };

    const serializedContent = serializeMessageChecklistContent(nextPayload);
    if (serializedContent === sourceMessage.content) {
      setDragChecklistItem(null);
      return;
    }

    const nextVersion = (messageDraftVersionRef.current[sourceMessageId] ?? 0) + 1;
    messageDraftVersionRef.current[sourceMessageId] = nextVersion;

    setMessagesByCategory((prev) => ({
      ...prev,
      [currentCategoryId]: (prev[currentCategoryId] ?? []).map((message) =>
        message.id === sourceMessageId
          ? {
              ...message,
              content: serializedContent,
              updated_at: new Date().toISOString(),
            }
          : message
      ),
    }));

    scheduleMessageContentSave(
      currentCategoryId,
      sourceMessageId,
      serializedContent,
      nextVersion
    );
    setDragChecklistItem(null);
  }

  function handleOpenChecklistSourceCategory(
    sourceCategoryId: string,
    sourceMessageId?: string | null
  ) {
    const sourceExists = categories.some((category) => category.id === sourceCategoryId);
    if (!sourceExists) {
      pushNotice("Категория со списком не найдена.", "warn");
      return;
    }

    setActiveProjectId(null);
    openCategory(sourceCategoryId, sourceMessageId ?? undefined);
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
      setDictionaryStudy((prev) =>
        prev?.sourceMessageId === selectedMessage.id ? null : prev
      );
      setDictionaryEditor((prev) =>
        prev?.sourceMessageId === selectedMessage.id ? null : prev
      );
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

  function openDictionaryGlobalSearch() {
    setShowSearch(false);
    setShowDictionaryGlobalSearch(true);
  }

  function handleDictionaryGroupUpdated(group: DictionaryWordGroup) {
    const normalized = normalizeDictionaryWordGroup(group);
    setDictionaryGroups((prev) =>
      [...prev.filter((item) => item.id !== normalized.id), normalized].sort(
        sortDictionaryWordGroups
      )
    );
    setDictionaryGroupEditor((prev) =>
      prev?.id === normalized.id ? normalized : prev
    );
  }

  function openDictionaryGroupEditor(group: DictionaryWordGroup) {
    setChecklistEditor(null);
    setDictionaryEditor(null);
    setDictionaryStudy(null);
    setDictionarySimilarPopup(null);
    setDictionaryGroupEditor(normalizeDictionaryWordGroup(group));
    setSidebarTab("dictionaryGroups");
  }

  function closeDictionaryGroupEditor() {
    setDictionaryGroupEditor(null);
  }

  async function handleCreateDictionaryGroup() {
    setIsMutating(true);
    try {
      const response = await authorizedFetch("/api/dictionary-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Группа слов",
        }),
      });
      const payload = (await response.json()) as DictionaryGroupPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось создать группу словарей.");
      }

      const created = normalizeDictionaryWordGroup(payload.data);
      setDictionaryGroups((prev) => [...prev, created].sort(sortDictionaryWordGroups));
      setDictionaryGroupEditor(created);
      setSidebarTab("dictionaryGroups");
      setSource((prev) => payload.source ?? prev);
      pushNotice("Группа словарей создана.");
    } catch (error) {
      pushNotice(
        toErrorMessage(error, "Не удалось создать группу словарей."),
        "error"
      );
    } finally {
      setIsMutating(false);
    }
  }

  async function handleDeleteDictionaryGroup(group: DictionaryWordGroup) {
    const confirmed = await requestConfirmation({
      title: "Удалить группу",
      message: `Удалить группу «${group.title}»?`,
      confirmLabel: "удалить",
      cancelLabel: "отмена",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setIsMutating(true);
    try {
      const response = await authorizedFetch(`/api/dictionary-groups/${group.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        source?: DataSource;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось удалить группу словарей.");
      }

      setDictionaryGroups((prev) => prev.filter((item) => item.id !== group.id));
      setDictionaryGroupEditor((prev) => (prev?.id === group.id ? null : prev));
      setSource((prev) => payload.source ?? prev);
      pushNotice("Группа словарей удалена.");
    } catch (error) {
      pushNotice(
        toErrorMessage(error, "Не удалось удалить группу словарей."),
        "error"
      );
    } finally {
      setIsMutating(false);
    }
  }

  function handleDictionaryGlobalSearchOpenSource(
    result: GlobalDictionarySearchResult
  ) {
    const sourceCategory = categories.find(
      (category) => category.id === result.sourceCategoryId
    );
    if (!sourceCategory) {
      pushNotice("Категория источника не найдена.", "warn");
      return;
    }

    pendingDictionarySearchSourceRef.current = {
      sourceCategoryId: result.sourceCategoryId,
      sourceMessageId: result.sourceMessageId,
      dictionaryId: result.dictionaryId,
    };

    setShowDictionaryGlobalSearch(false);
    setShowSearch(false);
    if (activeProjectId && !visibleCategoriesById.has(result.sourceCategoryId)) {
      setActiveProjectId(null);
    }
    openCategory(result.sourceCategoryId, result.sourceMessageId ?? undefined);
  }

  function handleDictionarySimilarOpenSource(result: DictionaryGroupResolvedResult) {
    cancelDictionarySpeech();
    setDictionarySimilarPopup(null);
    setDictionaryStudy(null);
    handleDictionaryGlobalSearchOpenSource({
      id: result.id,
      entry: result.entry,
      labels: result.labels,
      columns: result.columns,
      matchedFields: [],
      hasFuzzyMatch: false,
      sourceCategoryId: result.sourceCategoryId,
      sourceMessageId: result.sourceMessageId,
      dictionaryId: result.dictionaryId,
      dictionaryTitle: result.dictionaryTitle,
      categoryPath: result.categoryPath,
    });
  }

  function handleDictionaryGroupEditorOpenSource(
    result: DictionaryGroupResolvedResult
  ) {
    setDictionaryGroupEditor(null);
    handleDictionaryGlobalSearchOpenSource({
      id: result.id,
      entry: result.entry,
      labels: result.labels,
      columns: result.columns,
      matchedFields: [],
      hasFuzzyMatch: false,
      sourceCategoryId: result.sourceCategoryId,
      sourceMessageId: result.sourceMessageId,
      dictionaryId: result.dictionaryId,
      dictionaryTitle: result.dictionaryTitle,
      categoryPath: result.categoryPath,
    });
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

        setContinuousChecklists([]);
        setContinuousDictionaries([]);
        setContinuousSchedules([]);
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
        setContinuousChecklists([]);
        setContinuousDictionaries([]);
        setContinuousSchedules([]);
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
      const workspaceReady = await loadWorkspaceBootstrap();
      if (!workspaceReady) {
        return;
      }
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
      const workspaceReady = await loadWorkspaceBootstrap();
      if (!workspaceReady) {
        return;
      }
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

    setIsSavingAccountProfile(true);
    try {
      const response = await authorizedFetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          profileDescription,
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

  async function handleAccountAvatarFileChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!isSupportedAccountImageFile(file)) {
      pushNotice("Поддерживаются PNG, JPG, WebP, GIF и BMP.", "warn");
      return;
    }

    if (file.size > ACCOUNT_IMAGE_MAX_BYTES) {
      pushNotice("Аватар должен быть не больше 5 МБ.", "warn");
      return;
    }

    setIsUploadingAccountAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await authorizedFetch("/api/account/avatar", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as AccountPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось загрузить аватар.");
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
      pushNotice("Аватар обновлен.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось загрузить аватар."), "error");
    } finally {
      setIsUploadingAccountAvatar(false);
    }
  }

  async function handleDeleteAccountAvatar() {
    if (!accountAvatarUrl) {
      return;
    }

    setIsDeletingAccountAvatar(true);
    try {
      const response = await authorizedFetch("/api/account/avatar", {
        method: "DELETE",
      });
      const payload = (await response.json()) as AccountPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось удалить аватар.");
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
      pushNotice("Аватар удален.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось удалить аватар."), "error");
    } finally {
      setIsDeletingAccountAvatar(false);
    }
  }

  async function handleMotivationImageFileChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    setIsUploadingMotivationImage(true);
    try {
      const createdImages: AccountImageMeta[] = [];
      for (const file of files) {
        if (!isSupportedAccountImageFile(file)) {
          pushNotice(`${file.name}: поддерживаются PNG, JPG, WebP, GIF и BMP.`, "warn");
          continue;
        }

        if (file.size > ACCOUNT_IMAGE_MAX_BYTES) {
          pushNotice(`${file.name}: максимум 5 МБ.`, "warn");
          continue;
        }

        const formData = new FormData();
        formData.append("file", file);
        const response = await authorizedFetch("/api/account/motivation-images", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as AccountImagePayload;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Не удалось загрузить фото.");
        }

        setSource((prev) => payload.source ?? prev);
        createdImages.push(payload.data);
      }

      if (createdImages.length > 0) {
        setMotivationImages((prev) => {
          const nextImages = [...createdImages, ...prev].slice(0, 24);
          preloadMotivationImages(nextImages);
          return nextImages;
        });
        pushNotice(`Добавлено мотивационных фото: ${createdImages.length}.`);
      }
    } catch (error) {
      pushNotice(
        toErrorMessage(error, "Не удалось загрузить мотивационное фото."),
        "error"
      );
      void loadMotivationImages();
    } finally {
      setIsUploadingMotivationImage(false);
    }
  }

  async function handleDeleteMotivationImage(imageId: string) {
    setDeletingMotivationImageIds((prev) =>
      prev.includes(imageId) ? prev : [...prev, imageId]
    );
    try {
      const response = await authorizedFetch(
        `/api/account/motivation-images/${imageId}`,
        { method: "DELETE" }
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Не удалось удалить фото.");
      }

      setMotivationImages((prev) => {
        const deletedImage = prev.find((image) => image.id === imageId);
        if (deletedImage?.url) {
          releaseMotivationImageMemoryCache(deletedImage.url);
        }
        return prev.filter((image) => image.id !== imageId);
      });
      pushNotice("Мотивационное фото удалено.");
    } catch (error) {
      pushNotice(
        toErrorMessage(error, "Не удалось удалить мотивационное фото."),
        "error"
      );
    } finally {
      setDeletingMotivationImageIds((prev) =>
        prev.filter((id) => id !== imageId)
      );
    }
  }

  async function handleSendFriendRequest() {
    const normalized = normalizeUserId(friendRequestUserIdDraft);
    const validation = validateUserId(normalized);
    if (validation) {
      pushNotice(validation, "warn");
      return;
    }

    setIsSavingFriendAction(true);
    try {
      const response = await authorizedFetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: normalized }),
      });
      const payload = (await response.json()) as FriendPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось отправить приглашение.");
      }

      setFriendRequestUserIdDraft("");
      await loadFriends();
      pushNotice("Приглашение в друзья отправлено.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось отправить приглашение."), "error");
    } finally {
      setIsSavingFriendAction(false);
    }
  }

  async function handleAcceptFriendRequest(friend: FriendRow) {
    if (friend.direction !== "incoming" || friend.status !== "pending") {
      return;
    }

    setIsSavingFriendAction(true);
    try {
      const response = await authorizedFetch("/api/friends/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendAppUserId: friend.friendAppUserId }),
      });
      const payload = (await response.json()) as FriendPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось принять приглашение.");
      }

      await loadFriends();
      pushNotice("Друг добавлен.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось принять приглашение."), "error");
    } finally {
      setIsSavingFriendAction(false);
    }
  }

  async function handleDeclineFriendRequest(friend: FriendRow) {
    if (friend.direction !== "incoming" || friend.status !== "pending") {
      return;
    }

    setIsSavingFriendAction(true);
    try {
      const response = await authorizedFetch("/api/friends/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendAppUserId: friend.friendAppUserId }),
      });
      const payload = (await response.json()) as FriendPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось отклонить приглашение.");
      }

      await loadFriends();
      pushNotice("Приглашение отклонено.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось отклонить приглашение."), "error");
    } finally {
      setIsSavingFriendAction(false);
    }
  }

  function handleToggleFriendInbox(friendAppUserId: string) {
    setSelectedFriendInboxId((prev) => {
      const next = prev === friendAppUserId ? null : friendAppUserId;
      if (next) {
        void loadFriendInbox(next);
      }
      return next;
    });
  }

  async function handleShareCurrentCategory() {
    if (!currentCategory) {
      return;
    }

    if (!currentCategoryCanEdit) {
      pushNotice("Категорию в режиме просмотра нельзя отправить.", "warn");
      return;
    }

    if (!shareFriendId) {
      pushNotice("Выбери друга для отправки категории.", "warn");
      return;
    }

    setIsSavingInboxAction(true);
    try {
      const response = await authorizedFetch(`/api/categories/${currentCategory.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendAppUserId: shareFriendId }),
      });
      const payload = (await response.json()) as InboxItemPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось отправить категорию.");
      }

      setShareFriendId("");
      await loadFriends();
      pushNotice("Категория отправлена в inbox друга.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось отправить категорию."), "error");
    } finally {
      setIsSavingInboxAction(false);
    }
  }

  async function handleAcceptInboxItem(item: InboxItemRow) {
    let targetParentId: string | null = null;
    if (item.type === "category_share" || item.type === "public_invite") {
      if (localCategoryOptions.length === 0) {
        pushNotice("Нет локальной категории для импорта.", "warn");
        return;
      }

      targetParentId = inboxImportTargetIds[item.id] ?? "";
      if (!targetParentId) {
        pushNotice("Выбери локальную категорию для импорта.", "warn");
        return;
      }
    }

    setIsSavingInboxAction(true);
    try {
      const response = await authorizedFetch(`/api/inbox/${item.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetParentId }),
      });
      const payload = (await response.json()) as InboxAcceptPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось принять inbox-сообщение.");
      }

      if (selectedFriendInboxId) {
        await loadFriendInbox(selectedFriendInboxId);
      }
      await loadFriends();
      await refreshCategoriesFromServer();
      setInboxImportTargetIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      if (payload.data.categories[0]) {
        openCategory(payload.data.categories[0].id);
      }
      pushNotice(item.type === "public_invite" ? "Public-приглашение принято." : "Категория импортирована.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось принять inbox-сообщение."), "error");
    } finally {
      setIsSavingInboxAction(false);
    }
  }

  async function handleDeclineInboxItem(item: InboxItemRow) {
    const confirmed = await requestConfirmation({
      title: "Отклонить inbox",
      message: `Отклонить «${item.title}»? Это действие просто уберет приглашение из inbox.`,
      confirmLabel: "отклонить",
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    setIsSavingInboxAction(true);
    try {
      const response = await authorizedFetch(`/api/inbox/${item.id}/decline`, {
        method: "POST",
      });
      const payload = (await response.json()) as InboxItemPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось отклонить inbox-сообщение.");
      }

      if (selectedFriendInboxId) {
        await loadFriendInbox(selectedFriendInboxId);
      }
      await loadFriends();
      pushNotice("Inbox-сообщение отклонено.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось отклонить inbox-сообщение."), "error");
    } finally {
      setIsSavingInboxAction(false);
    }
  }

  async function handleEnablePublicCategory() {
    if (!currentCategory) {
      return;
    }

    setIsSavingPublicAction(true);
    try {
      const response = await authorizedFetch(`/api/categories/${currentCategory.id}/public`, {
        method: "POST",
      });
      const payload = (await response.json()) as PublicPanelPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось включить public-категорию.");
      }

      setPublicPanel(payload.data);
      await refreshCategoriesFromServer();
      pushNotice("Public-категория включена.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось включить public-категорию."), "error");
    } finally {
      setIsSavingPublicAction(false);
    }
  }

  async function handleDisablePublicCategory() {
    if (!currentCategory) {
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Выключить public",
      message: "Доступ у всех участников будет удален. Продолжить?",
      confirmLabel: "выключить",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setIsSavingPublicAction(true);
    try {
      const response = await authorizedFetch(`/api/categories/${currentCategory.id}/public`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as PublicPanelPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось выключить public-категорию.");
      }

      setPublicPanel(payload.data);
      await refreshCategoriesFromServer();
      pushNotice("Public-категория выключена.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось выключить public-категорию."), "error");
    } finally {
      setIsSavingPublicAction(false);
    }
  }

  async function handleInviteFriendToPublicCategory() {
    if (!currentCategory) {
      return;
    }

    if (!publicInviteFriendId) {
      pushNotice("Выбери друга для public-приглашения.", "warn");
      return;
    }

    setIsSavingPublicAction(true);
    try {
      const response = await authorizedFetch(
        `/api/categories/${currentCategory.id}/public/invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ friendAppUserId: publicInviteFriendId }),
        }
      );
      const payload = (await response.json()) as InboxItemPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось отправить public-приглашение.");
      }

      setPublicInviteFriendId("");
      await loadCurrentPublicPanel(currentCategory.id);
      pushNotice("Public-приглашение отправлено.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось отправить public-приглашение."), "error");
    } finally {
      setIsSavingPublicAction(false);
    }
  }

  async function handleUpdatePublicMemberRole(
    memberId: string,
    role: PublicCategoryMemberRole
  ) {
    if (!currentCategory) {
      return;
    }

    setIsSavingPublicAction(true);
    try {
      const response = await authorizedFetch(
        `/api/categories/${currentCategory.id}/public/members/${memberId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }
      );
      const payload = (await response.json()) as PublicPanelPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось обновить права.");
      }

      setPublicPanel(payload.data);
      pushNotice("Права участника обновлены.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось обновить права."), "error");
    } finally {
      setIsSavingPublicAction(false);
    }
  }

  async function handleRemovePublicMember(memberId: string) {
    if (!currentCategory) {
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Удалить доступ",
      message: "Участник потеряет доступ к public-категории.",
      confirmLabel: "удалить",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setIsSavingPublicAction(true);
    try {
      const response = await authorizedFetch(
        `/api/categories/${currentCategory.id}/public/members/${memberId}`,
        { method: "DELETE" }
      );
      const payload = (await response.json()) as PublicPanelPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось удалить участника.");
      }

      setPublicPanel(payload.data);
      pushNotice("Доступ удален.");
    } catch (error) {
      pushNotice(toErrorMessage(error, "Не удалось удалить участника."), "error");
    } finally {
      setIsSavingPublicAction(false);
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

  applyEditorDomValueRef.current = applyEditorDomValue;
  ensureRichImageDeleteLinesRef.current = ensureRichImageDeleteLines;
  ensureRichFileRowsRef.current = ensureRichFileRows;
  deleteRichImageBySelectionRef.current = deleteRichImageBySelection;
  deleteRichFileBySelectionRef.current = deleteRichFileBySelection;
  rememberRichSelectionRef.current = rememberRichSelection;
  syncRichToolbarStateRef.current = syncRichToolbarState;
  performWorkspaceUndoRef.current = performWorkspaceUndo;

  function handleDecreaseEditorTextScale() {
    pushUiUndoSnapshot();
    setEditorTextScalePercent((prev) =>
      clampEditorTextScalePercent(prev - EDITOR_TEXT_SCALE_STEP_PERCENT)
    );
  }

  function handleIncreaseEditorTextScale() {
    pushUiUndoSnapshot();
    setEditorTextScalePercent((prev) =>
      clampEditorTextScalePercent(prev + EDITOR_TEXT_SCALE_STEP_PERCENT)
    );
  }

  function handleEditorTextScaleInputMouseDown(
    event: React.MouseEvent<HTMLInputElement>
  ) {
    event.stopPropagation();

    const scope = resolveRichEditorScope();
    if (!scope) {
      return;
    }

    rememberRichSelection(scope);
  }

  function handleEditorTextScaleInputFocus(event: FocusEvent<HTMLInputElement>) {
    event.currentTarget.select();
  }

  function handleEditorTextScaleInputChange(event: ChangeEvent<HTMLInputElement>) {
    setEditorTextScaleInputValue(event.target.value);
  }

  function applyEditorTextScaleInputValue(rawValue: string) {
    const nextScale = parseEditorTextScalePercentInput(rawValue);
    if (nextScale === null) {
      setEditorTextScaleInputValue(formatEditorTextScalePercent(editorTextScalePercent));
      return;
    }

    if (nextScale !== editorTextScalePercent) {
      pushUiUndoSnapshot();
    }
    setEditorTextScalePercent(nextScale);
    setEditorTextScaleInputValue(formatEditorTextScalePercent(nextScale));
  }

  function cancelEditorTextScaleInputValue(input: HTMLInputElement) {
    const currentValue = formatEditorTextScalePercent(editorTextScalePercent);
    input.value = currentValue;
    setEditorTextScaleInputValue(currentValue);
  }

  function handleEditorTextScaleInputBlur(event: FocusEvent<HTMLInputElement>) {
    applyEditorTextScaleInputValue(event.currentTarget.value);
  }

  function handleEditorTextScaleInputKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      applyEditorTextScaleInputValue(event.currentTarget.value);
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditorTextScaleInputValue(event.currentTarget);
      event.currentTarget.blur();
    }
  }

  function handleWorkspaceUndoButtonMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function handleWorkspaceUndoButtonClick() {
    void performWorkspaceUndo();
  }

  function renderEditorTextScaleControls() {
    return (
      <div
        className="toolbar-zoom-controls"
        role="group"
        aria-label="Масштаб текстового редактора"
      >
        <button
          type="button"
          className="mini-action toolbar-zoom-button toolbar-undo-button"
          onMouseDown={handleWorkspaceUndoButtonMouseDown}
          onClick={handleWorkspaceUndoButtonClick}
          disabled={!canUndoWorkspace}
          aria-label="Отменить последнее действие"
          title="Отменить последнее действие"
        >
          ↶
        </button>

        <button
          type="button"
          className="mini-action toolbar-zoom-button"
          onMouseDown={handleToolbarControlMouseDown}
          onClick={handleDecreaseEditorTextScale}
          disabled={!canDecreaseEditorTextScale}
          aria-label="Уменьшить масштаб текста"
        >
          -
        </button>

        <input
          type="text"
          inputMode="numeric"
          className="toolbar-zoom-value"
          value={editorTextScaleInputValue}
          onMouseDown={handleEditorTextScaleInputMouseDown}
          onFocus={handleEditorTextScaleInputFocus}
          onChange={handleEditorTextScaleInputChange}
          onBlur={handleEditorTextScaleInputBlur}
          onKeyDown={handleEditorTextScaleInputKeyDown}
          disabled={!canAdjustEditorTextScale}
          aria-label="Editor zoom percent"
        />

        <button
          type="button"
          className="mini-action toolbar-zoom-button"
          onMouseDown={handleToolbarControlMouseDown}
          onClick={handleIncreaseEditorTextScale}
          disabled={!canIncreaseEditorTextScale}
          aria-label="Увеличить масштаб текста"
        >
          +
        </button>
      </div>
    );
  }

  function renderRichTextTools(scopePrefix: "block" | "continuous") {
    return (
      <>
        <div className="text-tools-inline">
          <button
            type="button"
            className={`mini-action text-tool-button ${richToolbarState.bold ? "text-tool-button-active" : ""}`}
            onMouseDown={handleToolbarControlMouseDown}
            onClick={handleToolbarBold}
            disabled={!canUseRichToolbar}
            aria-label="Жирный"
          >
            B
          </button>

          <button
            type="button"
            className={`mini-action text-tool-button ${richToolbarState.italic ? "text-tool-button-active" : ""}`}
            onMouseDown={handleToolbarControlMouseDown}
            onClick={handleToolbarItalic}
            disabled={!canUseRichToolbar}
            aria-label="Курсив"
          >
            I
          </button>

          <button
            type="button"
            className="mini-action text-tool-button"
            onMouseDown={handleToolbarControlMouseDown}
            onClick={handleToolbarLink}
            disabled={!canUseRichToolbar}
          >
            link
          </button>

          <button
            type="button"
            className="mini-action text-tool-button"
            onMouseDown={handleToolbarControlMouseDown}
            onClick={handleToolbarImage}
            disabled={!canUseRichToolbar}
          >
            image
          </button>

          <button
            type="button"
            className="mini-action text-tool-button"
            onMouseDown={handleToolbarControlMouseDown}
            onClick={handleToolbarFile}
            disabled={!canUseRichToolbar}
          >
            file
          </button>

          <div className="text-color-wrap">
            <button
              ref={textColorButtonRef}
              type="button"
              className={`mini-action text-tool-button text-color-trigger ${showTextColorPalette ? "text-tool-button-active" : ""}`}
              onMouseDown={handleToolbarControlMouseDown}
              onClick={toggleToolbarColorPalette}
              disabled={!canUseRichToolbar}
              aria-label="Открыть палитру цвета"
            >
              color
              <span
                className="text-color-chip"
                style={{ backgroundColor: richToolbarState.color }}
                aria-hidden="true"
              />
            </button>

            {showTextColorPalette && (
              <div
                ref={textColorPaletteRef}
                className="text-color-popover"
                role="dialog"
                aria-label="Палитра цвета текста"
              >
                <div className="text-color-palette" role="group" aria-label="Цвет текста">
                  {TEXT_COLOR_PRESETS.map((color) => (
                    <button
                      key={`${scopePrefix}-text-color-${color}`}
                      type="button"
                      className={`text-color-swatch ${
                        richToolbarState.color === color ? "text-color-swatch-active" : ""
                      }`}
                      style={{ backgroundColor: color }}
                      onMouseDown={handleToolbarControlMouseDown}
                      onClick={() => handleToolbarColorChange(color)}
                      disabled={!canUseRichToolbar}
                      aria-label={`Цвет текста ${color}`}
                    />
                  ))}
                </div>

                <input
                  type="color"
                  value={customTextColor}
                  className="text-color-picker"
                  onMouseDown={handleToolbarColorInputMouseDown}
                  onChange={(event) => handleToolbarColorChange(event.target.value)}
                  disabled={!canUseRichToolbar}
                  aria-label="Выбрать свой цвет текста"
                />
              </div>
            )}
          </div>
        </div>

        <span className="toolbar-meta">инструменты текста</span>
      </>
    );
  }

  function renderScheduleModal() {
    if (!scheduleModal) {
      return null;
    }

    return (
      <div className="absolute inset-0 z-[72] flex items-center justify-center p-3">
        <button
          type="button"
          className="absolute inset-0 bg-black/45"
          onClick={closeScheduleModal}
          aria-label="Закрыть окно расписания"
        />

        <div className="project-create-modal schedule-modal popup-3d relative z-10 w-full max-w-5xl p-4 sm:p-5">
          <div className="dictionary-editor-header mb-3 flex justify-between gap-3">
            <div className="dictionary-editor-title-wrap">
              <h2 className="font-display text-4xl leading-none">
                {scheduleModal.mode === "event"
                  ? scheduleModal.eventId
                    ? "Дело"
                    : "Новое дело"
                  : scheduleModal.mode === "assistant"
                    ? "Помощник расписания"
                    : scheduleModal.mode === "spontaneous"
                      ? "Спонтанное действие"
                      : "Нормы расписания"}
              </h2>
              <span className="dictionary-editor-title-badge">Расписание</span>
            </div>
            <button
              type="button"
              className="menu-action h-9 w-9 text-xl"
              onClick={closeScheduleModal}
              aria-label="Закрыть окно расписания"
            >
              x
            </button>
          </div>

          {scheduleModal.mode === "event" && (
            <>
              <div className="schedule-form-grid">
                <label className="dictionary-editor-field">
                  <span className="settings-label">название</span>
                  <input
                    value={scheduleModal.draft.title}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, title: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                    placeholder="Позаниматься английским"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">дата</span>
                  <input
                    type="date"
                    value={scheduleModal.draft.date}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, date: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">начало</span>
                  <input
                    type="time"
                    value={scheduleModal.draft.start}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, start: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">длительность, мин</span>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={scheduleModal.draft.durationMinutes}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                durationMinutes: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">тип</span>
                  <select
                    value={scheduleModal.draft.type}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                type: event.target.value as ScheduleEventType,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="fixed">фиксированное</option>
                    <option value="flexible">гибкое</option>
                    <option value="habit">привычка/норма</option>
                    <option value="spontaneous">спонтанное</option>
                  </select>
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">важность</span>
                  <select
                    value={scheduleModal.draft.priority}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                priority: event.target.value as SchedulePriority,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="low">низкая</option>
                    <option value="medium">средняя</option>
                    <option value="high">высокая</option>
                  </select>
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">статус</span>
                  <select
                    value={scheduleModal.draft.status}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                status: event.target.value as ScheduleStatus,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="planned">запланировано</option>
                    <option value="done">выполнено</option>
                    <option value="skipped">пропущено</option>
                  </select>
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">категория</span>
                  <input
                    value={scheduleModal.draft.category}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, category: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                    placeholder="учеба, работа, отдых"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">дедлайн</span>
                  <input
                    type="date"
                    value={scheduleModal.draft.deadline}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, deadline: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">повторяемость</span>
                  <input
                    value={scheduleModal.draft.recurrence}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                recurrence: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                    placeholder="например: 5 раз в неделю"
                  />
                </label>
                <label className="dictionary-editor-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleModal.draft.canMove}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, canMove: event.target.checked },
                            }
                          : prev
                      )
                    }
                  />
                  <span>можно переносить</span>
                </label>
                <label className="dictionary-editor-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleModal.draft.canSplit}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "event"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, canSplit: event.target.checked },
                            }
                          : prev
                      )
                    }
                  />
                  <span>можно делить</span>
                </label>
              </div>
              <label className="dictionary-editor-field mt-3">
                <span className="settings-label">описание</span>
                <textarea
                  value={scheduleModal.draft.description}
                  onChange={(event) =>
                    setScheduleModal((prev) =>
                      prev?.mode === "event"
                        ? {
                            ...prev,
                            draft: { ...prev.draft, description: event.target.value },
                          }
                        : prev
                    )
                  }
                  className="settings-input settings-textarea"
                />
              </label>
              <div className="dictionary-editor-actions">
                <button type="button" className="mini-action" onClick={closeScheduleModal}>
                  отмена
                </button>
                <button
                  type="button"
                  className="mini-action"
                  onClick={saveScheduleEventFromModal}
                >
                  сохранить
                </button>
              </div>
            </>
          )}

          {scheduleModal.mode === "assistant" && (
            <>
              <label className="dictionary-editor-field">
                <span className="settings-label">что нужно запланировать?</span>
                <textarea
                  value={scheduleModal.draft.text}
                  onChange={(event) =>
                    setScheduleModal((prev) =>
                      prev?.mode === "assistant"
                        ? {
                            ...prev,
                            draft: { ...prev.draft, text: event.target.value },
                            suggestions: [],
                            status: "",
                          }
                        : prev
                    )
                  }
                  className="settings-input settings-textarea schedule-helper-textarea"
                  placeholder="Например: позаниматься английским 1 час вечером на этой неделе"
                />
              </label>
              <div className="schedule-form-grid mt-3">
                <label className="dictionary-editor-field">
                  <span className="settings-label">длительность, мин</span>
                  <input
                    type="number"
                    min="5"
                    value={scheduleModal.draft.durationMinutes}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                durationMinutes: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">день</span>
                  <input
                    type="date"
                    value={scheduleModal.draft.date}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, date: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">диапазон с</span>
                  <input
                    type="date"
                    value={scheduleModal.draft.dateRangeStart}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                dateRangeStart: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">диапазон до</span>
                  <input
                    type="date"
                    value={scheduleModal.draft.dateRangeEnd}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                dateRangeEnd: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">предпочтительное время</span>
                  <input
                    value={scheduleModal.draft.preferredTime}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                preferredTime: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                    placeholder="18:00 или вечером"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">дедлайн</span>
                  <input
                    type="date"
                    value={scheduleModal.draft.deadline}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, deadline: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">категория</span>
                  <input
                    value={scheduleModal.draft.category}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, category: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">важность</span>
                  <select
                    value={scheduleModal.draft.priority}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                priority: event.target.value as SchedulePriority,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="low">низкая</option>
                    <option value="medium">средняя</option>
                    <option value="high">высокая</option>
                  </select>
                </label>
                <label className="dictionary-editor-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleModal.draft.canMove}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, canMove: event.target.checked },
                            }
                          : prev
                      )
                    }
                  />
                  <span>можно переносить</span>
                </label>
                <label className="dictionary-editor-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleModal.draft.canSplit}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "assistant"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, canSplit: event.target.checked },
                            }
                          : prev
                      )
                    }
                  />
                  <span>можно делить</span>
                </label>
              </div>
              <div className="schedule-suggestions">
                {scheduleModal.status && (
                  <p className="dictionary-editor-import-status">{scheduleModal.status}</p>
                )}
                {scheduleModal.suggestions.map((suggestion) => (
                  <div key={suggestion.id} className="schedule-suggestion">
                    <div>
                      <strong>
                        {formatScheduleDateShort(suggestion.date)} {suggestion.start}-
                        {suggestion.end}
                      </strong>
                      <p>{suggestion.title}</p>
                      <small>{suggestion.reason}</small>
                    </div>
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => insertScheduleSuggestion(suggestion)}
                    >
                      вставить
                    </button>
                  </div>
                ))}
              </div>
              <div className="dictionary-editor-actions">
                <button type="button" className="mini-action" onClick={closeScheduleModal}>
                  отмена
                </button>
                <button
                  type="button"
                  className="mini-action"
                  onClick={calculateScheduleAssistantSuggestions}
                >
                  найти место
                </button>
              </div>
            </>
          )}

          {scheduleModal.mode === "spontaneous" && (
            <>
              <label className="dictionary-editor-field">
                <span className="settings-label">что изменилось?</span>
                <textarea
                  value={scheduleModal.draft.text}
                  onChange={(event) =>
                    setScheduleModal((prev) =>
                      prev?.mode === "spontaneous"
                        ? {
                            ...prev,
                            draft: { ...prev.draft, text: event.target.value },
                            preview: null,
                            status: "",
                          }
                        : prev
                    )
                  }
                  className="settings-input settings-textarea schedule-helper-textarea"
                  placeholder="Например: меня позвали гулять сегодня с 18:00 до 21:00"
                />
              </label>
              <div className="schedule-form-grid mt-3">
                <label className="dictionary-editor-field">
                  <span className="settings-label">дата</span>
                  <input
                    type="date"
                    value={scheduleModal.draft.date}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "spontaneous"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, date: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">начало</span>
                  <input
                    type="time"
                    value={scheduleModal.draft.start}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "spontaneous"
                          ? {
                              ...prev,
                              draft: { ...prev.draft, start: event.target.value },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">длительность, мин</span>
                  <input
                    type="number"
                    min="5"
                    value={scheduleModal.draft.durationMinutes}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "spontaneous"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                durationMinutes: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">важность</span>
                  <select
                    value={scheduleModal.draft.priority}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "spontaneous"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                priority: event.target.value as SchedulePriority,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="low">низкая</option>
                    <option value="medium">средняя</option>
                    <option value="high">высокая</option>
                  </select>
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">перестраивать</span>
                  <select
                    value={scheduleModal.draft.scope}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "spontaneous"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                scope: event.target.value as "today" | "near",
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="today">только сегодня</option>
                    <option value="near">ближайшие дни</option>
                  </select>
                </label>
                <label className="dictionary-editor-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleModal.draft.canCancel}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "spontaneous"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                canCancel: event.target.checked,
                              },
                            }
                          : prev
                      )
                    }
                  />
                  <span>можно отменить</span>
                </label>
              </div>
              <div className="schedule-suggestions">
                {scheduleModal.status && (
                  <p className="dictionary-editor-import-status">{scheduleModal.status}</p>
                )}
                {scheduleModal.preview?.changes.map((change) => (
                  <div key={change.id} className="schedule-suggestion">
                    <div>{renderSchedulePreviewChange(change)}</div>
                  </div>
                ))}
              </div>
              <div className="dictionary-editor-actions">
                <button type="button" className="mini-action" onClick={closeScheduleModal}>
                  отмена
                </button>
                {scheduleModal.preview && (
                  <button
                    type="button"
                    className="mini-action"
                    onClick={applyScheduleSpontaneousPreviewFromModal}
                  >
                    применить
                  </button>
                )}
                <button
                  type="button"
                  className="mini-action"
                  onClick={calculateScheduleSpontaneousPreview}
                >
                  перестроить
                </button>
              </div>
            </>
          )}

          {scheduleModal.mode === "goals" && (
            <>
              <div className="schedule-form-grid">
                <label className="dictionary-editor-field">
                  <span className="settings-label">начало дня</span>
                  <input
                    type="time"
                    value={scheduleModal.settingsDraft.defaultDayStart ?? "08:00"}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "goals"
                          ? {
                              ...prev,
                              settingsDraft: {
                                ...prev.settingsDraft,
                                defaultDayStart: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">конец дня</span>
                  <input
                    type="time"
                    value={scheduleModal.settingsDraft.defaultDayEnd ?? "22:00"}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "goals"
                          ? {
                              ...prev,
                              settingsDraft: {
                                ...prev.settingsDraft,
                                defaultDayEnd: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">буфер, мин</span>
                  <input
                    type="number"
                    min="0"
                    value={scheduleModal.settingsDraft.bufferMinutes ?? 15}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "goals"
                          ? {
                              ...prev,
                              settingsDraft: {
                                ...prev.settingsDraft,
                                bufferMinutes: Number(event.target.value),
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  />
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">энергия</span>
                  <select
                    value={scheduleModal.settingsDraft.energyMode ?? "normal"}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "goals"
                          ? {
                              ...prev,
                              settingsDraft: {
                                ...prev.settingsDraft,
                                energyMode: event.target.value as ScheduleEnergyMode,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="low">низкая</option>
                    <option value="normal">нормальная</option>
                    <option value="high">высокая</option>
                  </select>
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">режим дня</span>
                  <select
                    value={scheduleModal.settingsDraft.dayMode ?? "normal"}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "goals"
                          ? {
                              ...prev,
                              settingsDraft: {
                                ...prev.settingsDraft,
                                dayMode: event.target.value as ScheduleDayMode,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="normal">обычный</option>
                    <option value="shifted">сбитый</option>
                    <option value="recovery">восстановительный</option>
                  </select>
                </label>
                <label className="dictionary-editor-field">
                  <span className="settings-label">перестройка</span>
                  <select
                    value={scheduleModal.settingsDraft.rescheduleMode ?? "normal"}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "goals"
                          ? {
                              ...prev,
                              settingsDraft: {
                                ...prev.settingsDraft,
                                rescheduleMode:
                                  event.target.value as ScheduleRescheduleMode,
                              },
                            }
                          : prev
                      )
                    }
                    className="settings-input"
                  >
                    <option value="soft">мягко</option>
                    <option value="normal">нормально</option>
                    <option value="strict">жестко</option>
                  </select>
                </label>
                <label className="dictionary-editor-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleModal.settingsDraft.preserveFreeTime ?? true}
                    onChange={(event) =>
                      setScheduleModal((prev) =>
                        prev?.mode === "goals"
                          ? {
                              ...prev,
                              settingsDraft: {
                                ...prev.settingsDraft,
                                preserveFreeTime: event.target.checked,
                              },
                            }
                          : prev
                      )
                    }
                  />
                  <span>оставлять свободное время</span>
                </label>
              </div>
              <div className="schedule-goal-editor">
                <div className="dictionary-editor-transfer-head">
                  <span className="settings-label">дневные и недельные нормы</span>
                  <button
                    type="button"
                    className="mini-action"
                    onClick={addScheduleGoalDraft}
                  >
                    + норма
                  </button>
                </div>
                {scheduleModal.goalDrafts.length === 0 ? (
                  <p className="settings-hint">
                    Норм пока нет. Добавьте цель по количеству или минутам.
                  </p>
                ) : (
                  scheduleModal.goalDrafts.map((goal) => (
                    <div key={goal.id} className="schedule-goal-row">
                      <input
                        value={goal.title}
                        onChange={(event) =>
                          setScheduleModal((prev) =>
                            prev?.mode === "goals"
                              ? {
                                  ...prev,
                                  goalDrafts: prev.goalDrafts.map((candidate) =>
                                    candidate.id === goal.id
                                      ? { ...candidate, title: event.target.value }
                                      : candidate
                                  ),
                                }
                              : prev
                          )
                        }
                        className="settings-input"
                        placeholder="Английский"
                      />
                      <input
                        value={goal.category}
                        onChange={(event) =>
                          setScheduleModal((prev) =>
                            prev?.mode === "goals"
                              ? {
                                  ...prev,
                                  goalDrafts: prev.goalDrafts.map((candidate) =>
                                    candidate.id === goal.id
                                      ? { ...candidate, category: event.target.value }
                                      : candidate
                                  ),
                                }
                              : prev
                          )
                        }
                        className="settings-input"
                        placeholder="категория"
                      />
                      <select
                        value={goal.period}
                        onChange={(event) =>
                          setScheduleModal((prev) =>
                            prev?.mode === "goals"
                              ? {
                                  ...prev,
                                  goalDrafts: prev.goalDrafts.map((candidate) =>
                                    candidate.id === goal.id
                                      ? {
                                          ...candidate,
                                          period:
                                            event.target.value as ScheduleGoalPeriod,
                                        }
                                      : candidate
                                  ),
                                }
                              : prev
                          )
                        }
                        className="settings-input"
                      >
                        <option value="day">день</option>
                        <option value="week">неделя</option>
                      </select>
                      <input
                        type="number"
                        min="1"
                        value={goal.targetCount}
                        onChange={(event) =>
                          setScheduleModal((prev) =>
                            prev?.mode === "goals"
                              ? {
                                  ...prev,
                                  goalDrafts: prev.goalDrafts.map((candidate) =>
                                    candidate.id === goal.id
                                      ? {
                                          ...candidate,
                                          targetCount: event.target.value,
                                        }
                                      : candidate
                                  ),
                                }
                              : prev
                          )
                        }
                        className="settings-input"
                        placeholder="раз"
                      />
                      <input
                        type="number"
                        min="1"
                        value={goal.targetMinutes}
                        onChange={(event) =>
                          setScheduleModal((prev) =>
                            prev?.mode === "goals"
                              ? {
                                  ...prev,
                                  goalDrafts: prev.goalDrafts.map((candidate) =>
                                    candidate.id === goal.id
                                      ? {
                                          ...candidate,
                                          targetMinutes: event.target.value,
                                        }
                                      : candidate
                                  ),
                                }
                              : prev
                          )
                        }
                        className="settings-input"
                        placeholder="мин"
                      />
                      <button
                        type="button"
                        className="danger-action schedule-small-danger"
                        onClick={() =>
                          setScheduleModal((prev) =>
                            prev?.mode === "goals"
                              ? {
                                  ...prev,
                                  goalDrafts: prev.goalDrafts.filter(
                                    (candidate) => candidate.id !== goal.id
                                  ),
                                }
                              : prev
                          )
                        }
                      >
                        -
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="dictionary-editor-actions">
                <button type="button" className="mini-action" onClick={closeScheduleModal}>
                  отмена
                </button>
                <button
                  type="button"
                  className="mini-action"
                  onClick={saveScheduleGoalsFromModal}
                >
                  сохранить
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
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
      <div
        className={`frame-shell relative flex h-full w-full flex-col overflow-hidden ${
          mobilePanel ? `mobile-panel-${mobilePanel}-open` : ""
        }`}
      >
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
            <span className="visibility-badge ml-2">
              {currentCategoryVisibilityLabel}
            </span>
          </button>

          <button
            type="button"
            className="mobile-header-action mobile-project-trigger mobile-only"
            onClick={() => openMobilePanel("projects")}
            aria-label="Open projects"
          >
            #{activeProject?.title ?? "HUB"}
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
            <div className="mobile-panel-head mobile-only">
              <span className="font-display">categories</span>
              <button
                type="button"
                className="menu-action h-9 w-9 text-xl"
                onClick={closeMobilePanel}
                aria-label="Close categories"
              >
                x
              </button>
            </div>
            <div className="sidebar-tab-strip" role="tablist" aria-label="Левая панель">
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === "categories"}
                className={`sidebar-tab ${
                  sidebarTab === "categories" ? "sidebar-tab-active" : ""
                }`}
                onClick={() => setSidebarTab("categories")}
              >
                Категории
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarTab === "dictionaryGroups"}
                className={`sidebar-tab ${
                  sidebarTab === "dictionaryGroups" ? "sidebar-tab-active" : ""
                }`}
                onClick={() => setSidebarTab("dictionaryGroups")}
              >
                Группы словарей
              </button>
            </div>
            <div className="sidebar-scroll flex-1">
              {sidebarTab === "categories" ? (
                <>
                  {childCategories.map((node) => {
                    const isActive = insertionTargetId === node.id;
                    const canDeleteNode = canDeleteCategoryNode(node);

                    return (
                      <div
                        key={node.id}
                        className={`sidebar-item-row ${isActive ? "sidebar-item-row-active" : ""}`}
                      >
                        <button
                          type="button"
                          className={`sidebar-item sidebar-item-main w-full border-x-0 border-t-0 text-left font-display text-[1.7rem] leading-none sm:text-[1.95rem] ${
                            isActive ? "sidebar-item-active" : ""
                          }`}
                          onClick={() =>
                            openCategory(node.id, undefined, {
                              keepMobilePanel: mobilePanel === "categories",
                            })
                          }
                        >
                          <span className="sidebar-item-title">{node.title}</span>
                        </button>

                        <button
                          type="button"
                          className="sidebar-delete mobile-only"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteCategoryFromPanel(node.id);
                          }}
                          disabled={!canDeleteNode || isMutating || isLoading}
                          aria-label={`Delete category ${node.title}`}
                        >
                          -
                        </button>
                      </div>
                    );
                  })}

                  {Array.from({ length: sidebarFillerCount }).map((_, index) => (
                    <div
                      key={`filler-${index}`}
                      className="sidebar-item pointer-events-none w-full border-x-0 border-t-0 opacity-45"
                      aria-hidden="true"
                    />
                  ))}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="sidebar-item dictionary-group-create w-full border-x-0 border-t-0 text-left font-display text-[1.35rem] leading-none"
                    onClick={() => void handleCreateDictionaryGroup()}
                    disabled={isMutating || isLoading}
                  >
                    + группа
                  </button>
                  {dictionaryGroups.map((group) => {
                    const isActive = dictionaryGroupEditor?.id === group.id;

                    return (
                      <div
                        key={group.id}
                        className={`sidebar-item-row ${isActive ? "sidebar-item-row-active" : ""}`}
                      >
                        <button
                          type="button"
                          className={`sidebar-item sidebar-item-main dictionary-group-sidebar-item w-full border-x-0 border-t-0 text-left font-display text-[1.35rem] leading-none ${
                            isActive ? "sidebar-item-active" : ""
                          }`}
                          onClick={() => openDictionaryGroupEditor(group)}
                        >
                          <span className="sidebar-item-title">{group.title}</span>
                          <small>{group.items.length} слов</small>
                        </button>
                        <button
                          type="button"
                          className="sidebar-delete dictionary-group-delete"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteDictionaryGroup(group);
                          }}
                          disabled={isMutating || isLoading}
                          aria-label={`Удалить группу ${group.title}`}
                        >
                          -
                        </button>
                      </div>
                    );
                  })}
                  {dictionaryGroups.length === 0 && (
                    <p className="dictionary-group-empty">пока нет групп</p>
                  )}
                </>
              )}
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
                    disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating}
                  >
                    + сообщение
                  </button>
                  <div className="toolbar-right">
                    <span className="toolbar-meta">формат: блочный</span>
                    {renderEditorTextScaleControls()}
                  </div>
                </div>

                <div className="message-toolbar message-toolbar-tools">
                  <button
                    type="button"
                    className="mini-action"
                    onClick={openChecklistEditorForCreate}
                    disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
                  >
                    #CL
                  </button>
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleAddDictionaryBlock()}
                    disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
                  >
                    #DICT
                  </button>
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleAddScheduleBlock()}
                    disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
                  >
                    Расписание
                  </button>
                  {renderRichTextTools("block")}
                </div>

                <div
                  className="message-board message-board-block"
                  onClick={() => {
                    if (selectedMessageId || activeRichEditor) {
                      pushUiUndoSnapshot();
                    }
                    setSelectedMessageId(null);
                    setActiveRichEditor(null);
                    setSelectedRichImage(null);
                    savedRichSelectionRef.current = null;
                    setShowTextColorPalette(false);
                  }}
                >
                  {currentMessages.length === 0 ? (
                    <p className="empty-note">В этой категории пока нет сообщений. Нажми + сообщение.</p>
                  ) : (
                    currentMessages.map((message) => {
                      const checklistCard = blockChecklistCardsByMessageId.get(message.id);
                      const dictionaryCard = blockDictionaryCardsByMessageId.get(message.id);
                      const scheduleCard = blockScheduleCardsByMessageId.get(message.id);
                      const scheduleSourceRef: ScheduleSourceRef = {
                        source: "block-message",
                        sourceCategoryId: message.category_id,
                        sourceMessageId: message.id,
                        scheduleId: null,
                      };

                      return (
                        <article
                          key={message.id}
                          className={`message-item message-item-block ${
                            selectedMessageId === message.id ? "message-item-active" : ""
                          }`}
                          onDragOver={(event) => {
                            if (dragMessageId && dragMessageId !== message.id) {
                              event.preventDefault();
                              return;
                            }

                            const hasRichImagePayload =
                              Boolean(draggedRichImageRef.current) ||
                              Array.from(event.dataTransfer?.types ?? []).includes("Files");
                            if (hasRichImagePayload && !dragMessageId) {
                              event.preventDefault();
                            }
                          }}
                          onDrop={(event) => {
                            if (dragMessageId) {
                              event.preventDefault();
                              handleDropOnMessage(message.id);
                              return;
                            }

                            const hasRichImagePayload =
                              Boolean(draggedRichImageRef.current) ||
                              Array.from(event.dataTransfer?.types ?? []).includes("Files");
                            if (!hasRichImagePayload) {
                              return;
                            }

                            void handleRichEditorDrop(
                              {
                                kind: "block",
                                messageId: message.id,
                              },
                              event
                            );
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (selectedMessageId !== message.id) {
                              pushUiUndoSnapshot();
                            }
                            setSelectedMessageId(message.id);

                            const target = event.target;
                            if (
                              !(target instanceof Element) ||
                              (!target.closest(`.${RICH_IMAGE_CLASS_NAME}`) &&
                                !target.closest(`.${RICH_IMAGE_DELETE_LINE_CLASS_NAME}`) &&
                                !target.closest(`.${RICH_IMAGE_DELETE_ROW_CLASS_NAME}`))
                            ) {
                              setSelectedRichImage(null);
                            }
                          }}
                        >
                          <div className="message-head">
                            <span className="message-title">{message.title}</span>
                            <div className="message-head-right">
                              <span className="message-kind">
                                {scheduleCard
                                  ? "Расписание"
                                  : dictionaryCard
                                  ? "#DICT"
                                  : checklistCard
                                  ? "#Checklist"
                                  : toMessageTypeLabel(message.message_type)}
                              </span>
                              {checklistCard && (
                                <button
                                  type="button"
                                  className="continuous-checklist-gear"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openChecklistEditorForBlockMessage(
                                      message,
                                      checklistCard.payload
                                    );
                                  }}
                                  aria-label={`Открыть настройки списка ${message.title}`}
                                >
                                  gear
                                </button>
                              )}
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

                          {scheduleCard ? (
                            <div
                              className="message-editor message-editor-schedule"
                              style={editorTextScaleStyle}
                            >
                              <ScheduleCard
                                title={message.title}
                                payload={scheduleCard.payload}
                                sourceRef={scheduleSourceRef}
                                canEdit={currentCategoryCanEdit && !isMutating && !isLoading}
                                onViewModeChange={updateScheduleViewMode}
                                onDateChange={updateScheduleSelectedDate}
                                onOpenEvent={openScheduleEventModal}
                                onOpenAssistant={openScheduleAssistantModal}
                                onOpenSpontaneous={openScheduleSpontaneousModal}
                                onOpenGoals={openScheduleGoalsModal}
                                onStatusChange={updateScheduleEventStatus}
                                onDeleteEvent={deleteScheduleEvent}
                                onDeleteBlock={(ref) => void deleteScheduleBlock(ref)}
                              />
                            </div>
                          ) : checklistCard ? (
                            <div
                              className="message-editor message-editor-checklist"
                              style={editorTextScaleStyle}
                            >
                              {(() => {
                                const uncheckedItemCount = checklistCard.items.filter(
                                  (item) => !item.checked
                                ).length;
                                const checkedItemCount = checklistCard.items.filter(
                                  (item) => item.checked
                                ).length;

                                return (
                              <div className="continuous-checklist-items">
                                {checklistCard.items.map((item) => (
                                  <div
                                    key={`block-checklist-item-${message.id}-${item.categoryId}`}
                                    className="continuous-checklist-item"
                                    onDragOver={(event) => {
                                      const dragged = dragChecklistItem;
                                      if (
                                        !dragged ||
                                        dragged.source !== "block-message" ||
                                        dragged.sourceCategoryId !== currentCategoryId ||
                                        dragged.sourceMessageId !== message.id ||
                                        dragged.checklistId !== message.id ||
                                        dragged.checked !== item.checked ||
                                        dragged.categoryId === item.categoryId
                                      ) {
                                        return;
                                      }

                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    onDrop={(event) => {
                                      const dragged = dragChecklistItem;
                                      if (
                                        !dragged ||
                                        dragged.source !== "block-message" ||
                                        dragged.sourceCategoryId !== currentCategoryId ||
                                        dragged.sourceMessageId !== message.id ||
                                        dragged.checklistId !== message.id ||
                                        dragged.checked !== item.checked
                                      ) {
                                        return;
                                      }

                                      event.preventDefault();
                                      event.stopPropagation();
                                      handleDropOnBlockChecklistItem(
                                        message.id,
                                        item.categoryId,
                                        item.checked
                                      );
                                    }}
                                  >
                                    <label className="checklist-item-toggle">
                                      <input
                                        type="checkbox"
                                        checked={item.checked}
                                        onChange={(event) => {
                                          if (!currentCategoryId) {
                                            return;
                                          }

                                          toggleChecklistMessageCategoryCheckState(
                                            currentCategoryId,
                                            message.id,
                                            item.categoryId,
                                            event.target.checked
                                          );
                                        }}
                                      />
                                      <span className="checklist-item-label">{item.label}</span>
                                    </label>

                                    <div className="checklist-item-actions">
                                      <button
                                        type="button"
                                        className="mini-action checklist-item-view"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleViewChecklistItem(item.categoryId);
                                        }}
                                      >
                                        view
                                      </button>
                                      <button
                                        type="button"
                                        className={`checklist-item-drag ${
                                          dragChecklistItem?.source === "block-message" &&
                                          dragChecklistItem.sourceMessageId === message.id &&
                                          dragChecklistItem.categoryId === item.categoryId
                                            ? "checklist-item-drag-active"
                                            : ""
                                        }`}
                                        draggable={
                                          (item.checked ? checkedItemCount : uncheckedItemCount) > 1 &&
                                          !isMutating &&
                                          !isLoading
                                        }
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onDragStart={(event) =>
                                          handleChecklistItemDragStart(event, {
                                            source: "block-message",
                                            sourceCategoryId: currentCategoryId ?? "",
                                            sourceMessageId: message.id,
                                            checklistId: message.id,
                                            categoryId: item.categoryId,
                                            checked: item.checked,
                                          })
                                        }
                                        onDragEnd={() => setDragChecklistItem(null)}
                                        disabled={
                                          (item.checked ? checkedItemCount : uncheckedItemCount) <= 1 ||
                                          isMutating ||
                                          isLoading
                                        }
                                        aria-label={`Перетащить пункт ${item.label}`}
                                      >
                                        ::
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                                );
                              })()}
                            </div>
                          ) : dictionaryCard ? (
                            <div
                              className="message-editor message-editor-dictionary"
                              style={editorTextScaleStyle}
                            >
                              <div className="dictionary-block-card">
                                <div className="dictionary-block-meta">
                                  <span>{dictionaryCard.payload.entries.length} пар</span>
                                  <span>
                                    показывать:{" "}
                                    {toDictionaryPromptSideLabel(
                                      dictionaryCard.payload.promptSide,
                                      dictionaryCard.payload.labels,
                                      dictionaryCard.payload.columns
                                    )}
                                  </span>
                                  {dictionaryCard.payload.shuffle && (
                                    <span>перемешивание</span>
                                  )}
                                  {dictionaryCard.payload.autoSpeak && (
                                    <span>автоозвучка</span>
                                  )}
                                </div>

                                <p className="dictionary-block-name">{message.title}</p>

                                {(dictionaryCard.payload.description ||
                                  dictionaryCard.payload.tags.length > 0) && (
                                  <div className="dictionary-block-info">
                                    {dictionaryCard.payload.description && (
                                      <p className="dictionary-block-description">
                                        {dictionaryCard.payload.description}
                                      </p>
                                    )}
                                    {dictionaryCard.payload.tags.length > 0 && (
                                      <div className="dictionary-block-tags">
                                        {dictionaryCard.payload.tags.map((tag) => (
                                          <span key={tag}>{tag}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="dictionary-block-actions">
                                  <button
                                    type="button"
                                    className="mini-action"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openDictionaryStudy({
                                        sourceCategoryId: message.category_id,
                                        sourceMessageId: message.id,
                                        dictionaryId: null,
                                        title: message.title,
                                        payload: dictionaryCard.payload,
                                      });
                                    }}
                                    disabled={dictionaryCard.payload.entries.length === 0}
                                  >
                                    заучивание
                                  </button>
                                  <button
                                    type="button"
                                    className="mini-action"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openDictionaryEditorForBlockMessage(
                                        message,
                                        dictionaryCard.payload
                                      );
                                    }}
                                  >
                                    настройки
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div
                              ref={(element) => setBlockEditorElement(message.id, element)}
                              contentEditable={
                                currentCategoryCanEdit && !isMutating && !isLoading
                              }
                              suppressContentEditableWarning
                              onInput={(event) => handleBlockEditorInput(message.id, event)}
                              onBlur={(event) => {
                                if (!currentCategoryId) {
                                  return;
                                }

                                flushMessageContentSync(
                                  currentCategoryId,
                                  message.id,
                                  event.currentTarget
                                );
                              }}
                              onPointerDown={(event) =>
                                handleRichEditorPointerDown(
                                  {
                                    kind: "block",
                                    messageId: message.id,
                                  },
                                  event
                                )
                              }
                              onDragStart={(event) =>
                                handleRichEditorDragStart(
                                  {
                                    kind: "block",
                                    messageId: message.id,
                                  },
                                  event
                                )
                              }
                              onDragEnd={handleRichEditorDragEnd}
                              onDragOver={handleRichEditorDragOver}
                              onDrop={(event) =>
                                void handleRichEditorDrop(
                                  {
                                    kind: "block",
                                    messageId: message.id,
                                  },
                                  event
                                )
                              }
                              onFocus={() => {
                                setSelectedMessageId(message.id);
                                handleRichEditorFocus({
                                  kind: "block",
                                  messageId: message.id,
                                });
                              }}
                              onClick={(event) =>
                                handleRichEditorClick(
                                  {
                                    kind: "block",
                                    messageId: message.id,
                                  },
                                  event
                                )
                              }
                              onMouseUp={(event) =>
                                handleRichEditorMouseUp(
                                  {
                                    kind: "block",
                                    messageId: message.id,
                                  },
                                  event
                                )
                              }
                              onKeyDown={(event) =>
                                handleRichEditorKeyDown(
                                  {
                                    kind: "block",
                                    messageId: message.id,
                                  },
                                  event
                                )
                              }
                              onKeyUp={(event) =>
                                handleRichEditorKeyUp(
                                  {
                                    kind: "block",
                                    messageId: message.id,
                                  },
                                  event
                                )
                              }
                              onCopy={(event) =>
                                handleRichEditorCopy(
                                  {
                                    kind: "block",
                                    messageId: message.id,
                                  },
                                  event
                                )
                              }
                              className="message-editor message-editor-rich"
                              style={editorTextScaleStyle}
                              data-placeholder="Текст сообщения..."
                              role="textbox"
                              aria-multiline="true"
                            />
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="message-toolbar">
                  <span className="toolbar-meta">формат: сплошной</span>
                  {renderEditorTextScaleControls()}
                </div>
                <div className="message-toolbar message-toolbar-tools">
                  <button
                    type="button"
                    className="mini-action"
                    onClick={openChecklistEditorForCreate}
                    disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
                  >
                    #CL
                  </button>
                  <button
                    type="button"
                    className="mini-action"
                    onClick={handleAddDictionaryBlock}
                    disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
                  >
                    #DICT
                  </button>
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleAddScheduleBlock()}
                    disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
                  >
                    Расписание
                  </button>
                  {renderRichTextTools("continuous")}
                </div>
                <div className="continuous-wrap">
                  {continuousChecklistCards.length > 0 && (
                    <div
                      className="continuous-checklist-board"
                      style={editorTextScaleStyle}
                    >
                      {continuousChecklistCards.map(({ checklist, items }) => {
                        const uncheckedItemCount = items.filter((item) => !item.checked).length;
                        const checkedItemCount = items.filter((item) => item.checked).length;

                        return (
                          <article
                            key={`continuous-checklist-${checklist.id}`}
                            className="continuous-checklist-card"
                          >
                            <div className="continuous-checklist-head">
                              <div className="min-w-0">
                                <p className="continuous-checklist-title">{checklist.title}</p>
                                <p className="continuous-checklist-tags">
                                  {checklist.tags.join(" ")}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="continuous-checklist-gear"
                                onClick={() => openChecklistEditorForChecklist(checklist.id)}
                                aria-label={`Открыть настройки списка ${checklist.title}`}
                              >
                                gear
                              </button>
                            </div>

                            <div className="continuous-checklist-items">
                              {items.map((item) => (
                                <div
                                  key={`checklist-item-${checklist.id}-${item.categoryId}`}
                                  className="continuous-checklist-item"
                                  onDragOver={(event) => {
                                    const dragged = dragChecklistItem;
                                    if (
                                      !dragged ||
                                      dragged.source !== "continuous" ||
                                      dragged.sourceCategoryId !== (currentCategoryId ?? "") ||
                                      dragged.checklistId !== checklist.id ||
                                      dragged.checked !== item.checked ||
                                      dragged.categoryId === item.categoryId
                                    ) {
                                      return;
                                    }

                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  onDrop={(event) => {
                                    const dragged = dragChecklistItem;
                                    if (
                                      !dragged ||
                                      dragged.source !== "continuous" ||
                                      dragged.sourceCategoryId !== (currentCategoryId ?? "") ||
                                      dragged.checklistId !== checklist.id ||
                                      dragged.checked !== item.checked
                                    ) {
                                      return;
                                    }

                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleDropOnContinuousChecklistItem(
                                      checklist.id,
                                      item.categoryId,
                                      item.checked
                                    );
                                  }}
                                >
                                  <label className="checklist-item-toggle">
                                    <input
                                      type="checkbox"
                                      checked={item.checked}
                                      onChange={(event) => {
                                        if (!currentCategoryId) {
                                          return;
                                        }

                                        toggleChecklistCategoryCheckState(
                                          currentCategoryId,
                                          checklist.id,
                                          item.categoryId,
                                          event.target.checked
                                        );
                                      }}
                                    />
                                    <span className="checklist-item-label">{item.label}</span>
                                  </label>

                                  <div className="checklist-item-actions">
                                    <button
                                      type="button"
                                      className="mini-action checklist-item-view"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleViewChecklistItem(item.categoryId);
                                      }}
                                    >
                                      view
                                    </button>
                                    <button
                                      type="button"
                                      className={`checklist-item-drag ${
                                        dragChecklistItem?.source === "continuous" &&
                                        dragChecklistItem.sourceCategoryId ===
                                          (currentCategoryId ?? "") &&
                                        dragChecklistItem.checklistId === checklist.id &&
                                        dragChecklistItem.categoryId === item.categoryId
                                          ? "checklist-item-drag-active"
                                          : ""
                                      }`}
                                      draggable={
                                        (item.checked ? checkedItemCount : uncheckedItemCount) > 1 &&
                                        !isMutating &&
                                        !isLoading
                                      }
                                      onMouseDown={(event) => event.stopPropagation()}
                                      onDragStart={(event) =>
                                        handleChecklistItemDragStart(event, {
                                          source: "continuous",
                                          sourceCategoryId: currentCategoryId ?? "",
                                          sourceMessageId: null,
                                          checklistId: checklist.id,
                                          categoryId: item.categoryId,
                                          checked: item.checked,
                                        })
                                      }
                                      onDragEnd={() => setDragChecklistItem(null)}
                                      disabled={
                                        (item.checked ? checkedItemCount : uncheckedItemCount) <= 1 ||
                                        isMutating ||
                                        isLoading
                                      }
                                      aria-label={`Перетащить пункт ${item.label}`}
                                    >
                                      ::
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {continuousDictionaryCards.length > 0 && (
                    <div
                      className="continuous-dictionary-board"
                      style={editorTextScaleStyle}
                    >
                      {continuousDictionaryCards.map((dictionary, dictionaryIndex) => (
                        <article
                          key={`continuous-dictionary-${dictionary.id}`}
                          className={`continuous-dictionary-card ${
                            dragDictionaryId === dictionary.id
                              ? "continuous-dictionary-card-dragging"
                              : ""
                          }`}
                          onDragOver={(event) => {
                            if (
                              !dragDictionaryId ||
                              dragDictionaryId === dictionary.id ||
                              !currentCategoryCanEdit
                            ) {
                              return;
                            }

                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onDrop={(event) => {
                            if (!dragDictionaryId || !currentCategoryCanEdit) {
                              return;
                            }

                            event.preventDefault();
                            event.stopPropagation();
                            handleDropOnContinuousDictionary(dictionary.id);
                          }}
                        >
                          <div className="continuous-checklist-head">
                            <div className="min-w-0">
                              <p className="continuous-checklist-title">
                                {dictionary.title}
                              </p>
                              <p className="continuous-checklist-tags">
                                {dictionary.entries.length} пар · показывать{" "}
                                {toDictionaryPromptSideLabel(
                                  dictionary.promptSide,
                                  dictionary.labels,
                                  dictionary.columns
                                )}
                                {dictionary.shuffle ? " · перемешивание" : ""}
                                {dictionary.autoSpeak ? " · автоозвучка" : ""}
                              </p>
                            </div>
                            <div className="dictionary-reorder-actions">
                              <button
                                type="button"
                                className="mini-action dictionary-reorder-button"
                                onClick={() => moveContinuousDictionary(dictionary.id, -1)}
                                disabled={
                                  !currentCategoryCanEdit ||
                                  dictionaryIndex === 0 ||
                                  isMutating ||
                                  isLoading
                                }
                                aria-label={`Поднять словарь ${dictionary.title}`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="mini-action dictionary-reorder-button"
                                onClick={() => moveContinuousDictionary(dictionary.id, 1)}
                                disabled={
                                  !currentCategoryCanEdit ||
                                  dictionaryIndex === continuousDictionaryCards.length - 1 ||
                                  isMutating ||
                                  isLoading
                                }
                                aria-label={`Опустить словарь ${dictionary.title}`}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className={`checklist-item-drag ${
                                  dragDictionaryId === dictionary.id
                                    ? "checklist-item-drag-active"
                                    : ""
                                }`}
                                draggable={
                                  currentCategoryCanEdit &&
                                  continuousDictionaryCards.length > 1 &&
                                  !isMutating &&
                                  !isLoading
                                }
                                onMouseDown={(event) => event.stopPropagation()}
                                onDragStart={(event) =>
                                  handleContinuousDictionaryDragStart(event, dictionary.id)
                                }
                                onDragEnd={() => setDragDictionaryId(null)}
                                disabled={
                                  !currentCategoryCanEdit ||
                                  continuousDictionaryCards.length <= 1 ||
                                  isMutating ||
                                  isLoading
                                }
                                aria-label={`Перетащить словарь ${dictionary.title}`}
                              >
                                ::
                              </button>
                            </div>
                          </div>

                          {(dictionary.description || dictionary.tags.length > 0) && (
                            <div className="dictionary-block-info">
                              {dictionary.description && (
                                <p className="dictionary-block-description">
                                  {dictionary.description}
                                </p>
                              )}
                              {dictionary.tags.length > 0 && (
                                <div className="dictionary-block-tags">
                                  {dictionary.tags.map((tag) => (
                                    <span key={tag}>{tag}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="dictionary-block-actions">
                            <button
                              type="button"
                              className="mini-action"
                              onClick={() =>
                                openDictionaryStudy({
                                  sourceCategoryId: currentCategoryId ?? "",
                                  sourceMessageId: null,
                                  dictionaryId: dictionary.id,
                                  title: dictionary.title,
                                  payload: dictionary,
                                })
                              }
                              disabled={dictionary.entries.length === 0}
                            >
                              заучивание
                            </button>
                            <button
                              type="button"
                              className="mini-action"
                              onClick={() =>
                                openDictionaryEditorForContinuousDictionary(
                                  dictionary.id
                                )
                              }
                            >
                              настройки
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}

                  {continuousScheduleCards.length > 0 && (
                    <div
                      className="continuous-schedule-board"
                      style={editorTextScaleStyle}
                    >
                      {continuousScheduleCards.map((schedule) => {
                        const scheduleSourceRef: ScheduleSourceRef = {
                          source: "continuous",
                          sourceCategoryId: currentCategoryId ?? "",
                          sourceMessageId: null,
                          scheduleId: schedule.id,
                        };

                        return (
                          <ScheduleCard
                            key={`continuous-schedule-${schedule.id}`}
                            title={schedule.title}
                            payload={schedule}
                            sourceRef={scheduleSourceRef}
                            canEdit={currentCategoryCanEdit && !isMutating && !isLoading}
                            onViewModeChange={updateScheduleViewMode}
                            onDateChange={updateScheduleSelectedDate}
                            onOpenEvent={openScheduleEventModal}
                            onOpenAssistant={openScheduleAssistantModal}
                            onOpenSpontaneous={openScheduleSpontaneousModal}
                            onOpenGoals={openScheduleGoalsModal}
                            onStatusChange={updateScheduleEventStatus}
                            onDeleteEvent={deleteScheduleEvent}
                            onDeleteBlock={(ref) => void deleteScheduleBlock(ref)}
                          />
                        );
                      })}
                    </div>
                  )}

                  <div
                    ref={continuousEditorRef}
                    contentEditable={
                      currentCategoryCanEdit &&
                      !(!currentCategoryId || isLoading || Boolean(loadError))
                    }
                    suppressContentEditableWarning
                    onInput={handleContinuousEditorInput}
                    onBlur={(event) => {
                      if (!currentCategory || currentCategory.format !== "continuous") {
                        return;
                      }

                      flushContinuousContentSync(currentCategory.id, event.currentTarget);
                    }}
                    onPointerDown={(event) =>
                      handleRichEditorPointerDown(
                        {
                          kind: "continuous",
                        },
                        event
                      )
                    }
                    onDragStart={(event) =>
                      handleRichEditorDragStart(
                        {
                          kind: "continuous",
                        },
                        event
                      )
                    }
                    onDragEnd={handleRichEditorDragEnd}
                    onDragOver={handleRichEditorDragOver}
                    onDrop={(event) =>
                      void handleRichEditorDrop(
                        {
                          kind: "continuous",
                        },
                        event
                      )
                    }
                    onFocus={() => {
                      setSelectedMessageId(null);
                      handleRichEditorFocus({
                        kind: "continuous",
                      });
                    }}
                    onClick={(event) =>
                      handleRichEditorClick(
                        {
                          kind: "continuous",
                        },
                        event
                      )
                    }
                    onMouseUp={(event) =>
                      handleRichEditorMouseUp(
                        {
                          kind: "continuous",
                        },
                        event
                      )
                    }
                    onKeyDown={(event) =>
                      handleRichEditorKeyDown(
                        {
                          kind: "continuous",
                        },
                        event
                      )
                    }
                    onKeyUp={(event) =>
                      handleRichEditorKeyUp(
                        {
                          kind: "continuous",
                        },
                        event
                      )
                    }
                    onCopy={(event) =>
                      handleRichEditorCopy(
                        {
                          kind: "continuous",
                        },
                        event
                      )
                    }
                    className="continuous-editor continuous-editor-main continuous-editor-rich"
                    style={editorTextScaleStyle}
                    data-placeholder="Пиши сплошной текст как в Word..."
                    role="textbox"
                    aria-multiline="true"
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
            <div className="mobile-panel-head mobile-only">
              <span className="font-display">settings</span>
              <button
                type="button"
                className="menu-action h-9 w-9 text-xl"
                onClick={closeMobilePanel}
                aria-label="Close settings"
              >
                x
              </button>
            </div>
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
                  disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                      disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                  disabled={!currentCategoryCanEdit || isMutating}
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
                  disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                  disabled={!currentCategoryCanEdit || isMutating || isLoading}
                />

                <label className="settings-label">переместить категорию</label>
                <select
                  value={categoryMoveParentDraft}
                  className="settings-input"
                  onChange={(event) => setCategoryMoveParentDraft(event.target.value)}
                  disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                  disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                          disabled={!currentCategoryCanEdit || isMutating || isLoading}
                          aria-label="Открыть список всех хэштегов"
                        >
                          <TagLibraryIcon />
                        </button>
                        <button
                          type="button"
                          className="category-tag-action category-tag-action-apply"
                          onClick={() => void handleAddCategoryTag()}
                          disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                          disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                              disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                                disabled={!currentCategoryCanEdit || isMutating || isLoading}
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

                <label className="settings-label">участие в #Checklist</label>
                <div className="settings-checklist-links">
                  {checklistParticipation.length === 0 ? (
                    <p className="settings-hint">
                      Эта категория пока не участвует ни в одном #Checklist.
                    </p>
                  ) : (
                    checklistParticipation.map((entry) => {
                      const sourceIsCurrent = entry.sourceCategoryId === currentCategory.id;

                      return (
                        <div
                          key={`settings-checklist-${entry.source}-${entry.sourceCategoryId}-${entry.checklistId}`}
                          className="settings-checklist-link-item"
                        >
                          <label className="settings-checklist-toggle">
                            <input
                              type="checkbox"
                              checked={entry.checked}
                              onChange={(event) =>
                                toggleChecklistParticipationCheckState(
                                  entry,
                                  currentCategory.id,
                                  event.target.checked
                                )
                              }
                              disabled={!currentCategoryCanEdit || isMutating || isLoading}
                            />
                            <span>
                              {entry.checklistTitle}
                              {entry.tags.length > 0 ? ` ${entry.tags.join(" ")}` : ""}
                            </span>
                          </label>

                          <div className="settings-checklist-actions">
                            <p className="settings-hint">
                              источник: {entry.sourceCategoryTitle}
                            </p>
                            <button
                              type="button"
                              className="mini-action settings-checklist-open"
                              onClick={() =>
                                handleOpenChecklistSourceCategory(
                                  entry.sourceCategoryId,
                                  entry.sourceMessageId
                                )
                              }
                              disabled={sourceIsCurrent}
                            >
                              {sourceIsCurrent ? "здесь" : "к списку"}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <label className="settings-label">формат категории</label>
                <select
                  value={categoryForm.format}
                  className="settings-input"
                  onChange={(event) =>
                    void handleCategoryFormatChange(event.target.value as CategoryFormat)
                  }
                  disabled={!currentCategoryCanEdit || isMutating || isLoading}
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
                  disabled={!currentCategoryCanEdit || isMutating || isLoading}
                >
                  <option value="learning">learning</option>
                </select>

                <p className="settings-hint">
                  Для типа learning у сообщений доступно: информация / упражнение.
                </p>

                <label className="settings-label">поделиться</label>
                <div className="category-share-panel">
                  <select
                    value={shareFriendId}
                    className="settings-input"
                    onChange={(event) => setShareFriendId(event.target.value)}
                    disabled={
                      !currentCategoryCanEdit ||
                      acceptedFriends.length === 0 ||
                      isSavingInboxAction
                    }
                  >
                    <option value="">выбери друга</option>
                    {acceptedFriends.map((friend) => (
                      <option key={`share-${friend.friendAppUserId}`} value={friend.friendAppUserId}>
                        {friend.nickname || friend.friendUserId || friend.friendAppUserId}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => void handleShareCurrentCategory()}
                    disabled={
                      !currentCategory ||
                      !currentCategoryCanEdit ||
                      !shareFriendId ||
                      isSavingInboxAction
                    }
                  >
                    отправить копию
                  </button>
                </div>
                <p className="settings-hint">
                  Друг получит копию дерева категории в inbox и сам выберет, куда ее принять.
                </p>

                <label className="settings-label">public category</label>
                <div className="public-category-panel">
                  <div className="public-category-state">
                    <span>{publicPanel?.enabled ? "public включен" : "local"}</span>
                    {publicPanel?.role && <span>роль: {publicPanel.role}</span>}
                  </div>

                  {currentCategoryCanManagePublic ? (
                    <div className="flex flex-wrap gap-2">
                      {publicPanel?.enabled ? (
                        <button
                          type="button"
                          className="danger-action"
                          onClick={() => void handleDisablePublicCategory()}
                          disabled={isSavingPublicAction}
                        >
                          выключить public
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => void handleEnablePublicCategory()}
                          disabled={isSavingPublicAction}
                        >
                          сделать public
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="settings-hint">
                      Управление public-доступом доступно только владельцу.
                    </p>
                  )}

                  {currentCategoryCanManagePublic && publicPanel?.enabled && (
                    <>
                      <div className="category-share-panel mt-2">
                        <select
                          value={publicInviteFriendId}
                          className="settings-input"
                          onChange={(event) => setPublicInviteFriendId(event.target.value)}
                          disabled={acceptedFriends.length === 0 || isSavingPublicAction}
                        >
                          <option value="">пригласить друга</option>
                          {acceptedFriends.map((friend) => (
                            <option
                              key={`public-invite-${friend.friendAppUserId}`}
                              value={friend.friendAppUserId}
                            >
                              {friend.nickname || friend.friendUserId || friend.friendAppUserId}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => void handleInviteFriendToPublicCategory()}
                          disabled={!publicInviteFriendId || isSavingPublicAction}
                        >
                          invite
                        </button>
                      </div>

                      <div className="public-member-list">
                        {publicPanel.members.length === 0 ? (
                          <p className="settings-hint">В user:panel пока нет участников.</p>
                        ) : (
                          publicPanel.members.map((member) => {
                            const memberName =
                              member.nickname || member.userId || member.appUserId;
                            const memberInitial =
                              memberName.trim().charAt(0).toUpperCase() || "U";

                            return (
                            <div key={member.id} className="public-member-item">
                              <div className="friend-identity">
                                <div className="friend-avatar">
                                  {member.avatarUrl &&
                                  isDisplayImageUrl(member.avatarUrl) ? (
                                    <span
                                      className="friend-avatar-image"
                                      style={{
                                        backgroundImage: `url(${member.avatarUrl})`,
                                      }}
                                      aria-label="Аватар участника"
                                    />
                                  ) : (
                                    <span>{memberInitial}</span>
                                  )}
                                </div>
                                <span className="public-member-name">
                                  {memberName}
                                </span>
                              </div>
                              <select
                                value={member.role}
                                className="settings-input public-member-role"
                                onChange={(event) =>
                                  void handleUpdatePublicMemberRole(
                                    member.id,
                                    event.target.value as PublicCategoryMemberRole
                                  )
                                }
                                disabled={isSavingPublicAction}
                              >
                                <option value="viewer">просмотр</option>
                                <option value="editor">редактор</option>
                              </select>
                              <button
                                type="button"
                                className="danger-action public-member-remove"
                                onClick={() => void handleRemovePublicMember(member.id)}
                                disabled={isSavingPublicAction}
                              >
                                удалить
                              </button>
                            </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>

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
                    disabled={!currentCategoryCanEdit || isMutating || isLoading}
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

        {mobilePanel && mobilePanel !== "categories" && (
          <button
            type="button"
            className="mobile-panel-backdrop mobile-only"
            onClick={closeMobilePanel}
            aria-label="Close mobile panel"
          />
        )}

        {mobilePanel === "projects" && (
          <aside className="mobile-sheet mobile-project-sheet mobile-only">
            <div className="mobile-panel-head">
              <span className="font-display">projects</span>
              <button
                type="button"
                className="menu-action h-9 w-9 text-xl"
                onClick={closeMobilePanel}
                aria-label="Close projects"
              >
                x
              </button>
            </div>

            <div className="mobile-project-list" role="tablist" aria-label="Projects">
              <button
                type="button"
                role="tab"
                aria-selected={activeProjectId === null}
                className={`project-tab ${activeProjectId === null ? "project-tab-active" : ""}`}
                onClick={() => {
                  handleSelectProjectTab(null);
                  closeMobilePanel();
                }}
              >
                HUB
              </button>

              {sortedProjects.map((project) => (
                <button
                  key={`mobile-project-${project.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeProjectId === project.id}
                  className={`project-tab ${
                    activeProjectId === project.id ? "project-tab-active" : ""
                  }`}
                  onClick={() => {
                    handleSelectProjectTab(project.id);
                    closeMobilePanel();
                  }}
                >
                  {project.title}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="mini-action mobile-wide-action"
              onClick={openProjectCreateModal}
            >
              manage / create project
            </button>
          </aside>
        )}

        {mobilePanel === "tools" && (
          <aside className="mobile-sheet mobile-tools-sheet mobile-only">
            <div className="mobile-panel-head">
              <span className="font-display">tools</span>
              <button
                type="button"
                className="menu-action h-9 w-9 text-xl"
                onClick={closeMobilePanel}
                aria-label="Close tools"
              >
                x
              </button>
            </div>

            <div className="mobile-tools-actions">
              {currentCategory?.format === "block" && (
                <button
                  type="button"
                  className="mini-action"
                  onClick={() => {
                    closeMobilePanel();
                    void handleAddMessage();
                  }}
                  disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating}
                >
                  + message
                </button>
              )}
              <button
                type="button"
                className="mini-action"
                onClick={() => {
                  closeMobilePanel();
                  openChecklistEditorForCreate();
                }}
                disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
              >
                #CL
              </button>
              <button
                type="button"
                className="mini-action"
                onClick={() => {
                  closeMobilePanel();
                  void handleAddDictionaryBlock();
                }}
                disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
              >
                #DICT
              </button>
              <button
                type="button"
                className="mini-action"
                onClick={() => {
                  closeMobilePanel();
                  void handleAddScheduleBlock();
                }}
                disabled={!currentCategoryId || !currentCategoryCanEdit || isMutating || isLoading}
              >
                Расписание
              </button>
              {renderEditorTextScaleControls()}
            </div>

            <div className="mobile-rich-tools">
              {renderRichTextTools(
                currentCategory?.format === "block" ? "block" : "continuous"
              )}
            </div>
          </aside>
        )}

        <footer className="bottom-strip bevel-panel flex h-[6rem] flex-none items-end justify-between gap-3 px-2 pb-2 pt-[1.1rem] sm:h-[6.2rem] sm:px-3 sm:pb-3 sm:pt-[1.15rem]">
          <div className="flex items-end gap-2 sm:gap-3">
            <button
              type="button"
              className="tool-button tool-red"
              onClick={() => {
                if (mobilePanel !== "categories") {
                  closeMobilePanel();
                }
                void handleBack();
              }}
              disabled={!canGoBack || isMutating}
              aria-label="Назад"
            >
              &lt;
            </button>
            <button
              type="button"
              className="tool-button tool-blue mobile-only"
              onClick={() => openMobilePanel("categories")}
              disabled={isLoading || Boolean(loadError)}
              aria-label="Open categories"
            >
              cat
            </button>
            <button
              type="button"
              className="tool-button tool-green"
              onClick={() => {
                if (mobilePanel !== "categories") {
                  closeMobilePanel();
                }
                void handleAddCategory();
              }}
              disabled={!canCreate || isMutating || isLoading}
              aria-label="Добавить категорию"
            >
              +
            </button>
            <button
              type="button"
              className="tool-button tool-yellow mobile-hide"
              onClick={handleDeleteCategory}
              disabled={!canDelete || isMutating || isLoading}
              aria-label="Удалить категорию"
            >
              -
            </button>
          </div>

          <p className={`mobile-hide hidden text-sm font-semibold sm:block ${statusColor}`}>{statusText}</p>

          <div className="flex items-end gap-2 sm:gap-3">
            <button
              type="button"
              className="tool-button tool-blue"
              onClick={() => {
                closeMobilePanel();
                setShowDictionaryGlobalSearch(false);
                setShowSearch(true);
              }}
              disabled={isLoading || Boolean(loadError)}
              aria-label="Открыть поиск"
            >
              <SearchIcon />
            </button>
            <button
              type="button"
              className="tool-button tool-red mobile-only"
              onClick={() => openMobilePanel("tools")}
              disabled={!currentCategory || isLoading}
              aria-label="Open tools"
            >
              tools
            </button>
            <button
              type="button"
              className="tool-button tool-yellow mobile-only"
              onClick={() => openMobilePanel("settings")}
              disabled={!currentCategory || isLoading}
              aria-label="Open settings"
            >
              set
            </button>
            <button
              type="button"
              className="tool-button tool-red mobile-hide"
              onClick={() =>
                pushNotice("Раздел «Больше инструментов» будет добавлен позже.")
              }
              aria-label="Больше инструментов"
            >
              &gt;
            </button>
          </div>
        </footer>

        <input
          ref={richImageFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          multiple
          className="hidden"
          onChange={(event) => void handleToolbarImageInputChange(event)}
        />

        <input
          ref={richFileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void handleToolbarFileInputChange(event)}
        />

        {richImageDeleteConfirm && richImageDeleteConfirmRect && (
          <div
            className="rich-image-delete-confirm-overlay"
            style={{
              top: `${richImageDeleteConfirmRect.top}px`,
              left: `${richImageDeleteConfirmRect.left}px`,
              width: `${richImageDeleteConfirmRect.width}px`,
              height: `${richImageDeleteConfirmRect.height}px`,
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение удаления фото"
          >
            <div className="rich-image-delete-confirm-content">
              <p className="rich-image-delete-confirm-title">Подтвердить удаления</p>

              <div className="rich-image-delete-confirm-actions">
                <button
                  type="button"
                  className="danger-action"
                  onClick={confirmRichImageDeleteConfirmation}
                >
                  удалить
                </button>
                <button
                  type="button"
                  className="mini-action"
                  onClick={cancelRichImageDeleteConfirmation}
                >
                  отменить
                </button>
              </div>

              <p className="rich-image-delete-confirm-hint">
                нажать enter - чтобы удалить, либо у esc - чтобы отменить
              </p>
            </div>
          </div>
        )}

        {richFileDeleteConfirm && richFileDeleteConfirmRect && (
          <div
            className="rich-image-delete-confirm-overlay"
            style={{
              top: `${richFileDeleteConfirmRect.top}px`,
              left: `${richFileDeleteConfirmRect.left}px`,
              width: `${richFileDeleteConfirmRect.width}px`,
              height: `${richFileDeleteConfirmRect.height}px`,
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение удаления файла"
          >
            <div className="rich-image-delete-confirm-content">
              <p className="rich-image-delete-confirm-title">Подтвердить удаление файла</p>

              <div className="rich-image-delete-confirm-actions">
                <button
                  type="button"
                  className="danger-action"
                  onClick={confirmRichFileDeleteConfirmation}
                >
                  удалить
                </button>
                <button
                  type="button"
                  className="mini-action"
                  onClick={cancelRichFileDeleteConfirmation}
                >
                  отменить
                </button>
              </div>

              <p className="rich-image-delete-confirm-hint">
                нажать enter - чтобы удалить, либо у esc - чтобы отменить
              </p>
            </div>
          </div>
        )}

        {showLinkPlaceholderModal && (
          <div className="absolute inset-0 z-[68] flex items-center justify-center p-3">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              onClick={closeLinkPlaceholderModal}
              aria-label="Закрыть окно ссылки"
            />

            <div className="confirm-modal popup-3d relative z-10 w-full max-w-lg p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-display text-4xl leading-none">Ссылка</h2>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={closeLinkPlaceholderModal}
                  aria-label="Закрыть окно ссылки"
                >
                  x
                </button>
              </div>

              <p className="settings-hint">
                Здесь появится выбор, на что ссылаться. Пока это окно-заглушка.
              </p>
              <p className="settings-hint mt-2 break-words">
                Выделенный текст: {linkSelectionPreview || "(пусто)"}
              </p>

              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="mini-action"
                  onClick={closeLinkPlaceholderModal}
                >
                  закрыть
                </button>
              </div>
            </div>
          </div>
        )}

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

        {renderScheduleModal()}

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

        {checklistEditor && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-3">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              onClick={closeChecklistEditor}
              aria-label="Закрыть окно чеклиста"
            />

            <div className="project-create-modal checklist-editor-modal popup-3d relative z-10 w-full max-w-2xl p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-display text-4xl leading-none">
                  {checklistEditor.checklistId ? "Настройки #Checklist" : "Новый #Checklist"}
                </h2>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={closeChecklistEditor}
                  aria-label="Закрыть окно чеклиста"
                >
                  x
                </button>
              </div>

              <label className="settings-label">название списка</label>
              <input
                value={checklistEditor.titleDraft}
                onChange={(event) => updateChecklistEditorTitle(event.target.value)}
                className="settings-input"
                placeholder="Например: уроки"
              />

              <label className="settings-label mt-3">поиск хэштега</label>
              <input
                autoFocus
                value={checklistTagSearchQuery}
                onChange={(event) => setChecklistTagSearchQuery(event.target.value)}
                className="settings-input"
                placeholder="Искать #хэштеги..."
              />

              <div className="project-create-tag-list mt-3">
                {checklistTagOptions.length === 0 ? (
                  <p className="settings-hint">Не нашел хэштегов по этому запросу.</p>
                ) : (
                  checklistTagOptions.map((tag) => {
                    const checked = checklistTagSelectionKeySet.has(
                      tag.toLocaleLowerCase()
                    );

                    return (
                      <label key={`checklist-create-${tag}`} className="project-create-tag-option">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChecklistEditorTag(tag)}
                        />
                        <span>{tag}</span>
                      </label>
                    );
                  })
                )}
              </div>

              <p className="settings-hint mt-2">
                Выбрано хэштегов: {checklistEditor.tagSelection.length}
              </p>

              <div className="checklist-order-settings mt-3">
                <label className="settings-label">порядок пунктов</label>
                <select
                  value={checklistEditor.orderMode}
                  className="settings-input"
                  onChange={(event) =>
                    updateChecklistEditorOrderMode(
                      normalizeChecklistItemOrderMode(event.target.value)
                    )
                  }
                >
                  <option value="auto">история + галочки</option>
                  <option value="custom">пользовательский</option>
                </select>

                <button
                  type="button"
                  className="mini-action checklist-order-reset"
                  onClick={resetChecklistEditorCustomOrder}
                  disabled={checklistEditor.customOrderCategoryIds.length === 0}
                >
                  сбросить пользовательский порядок
                </button>

                <p className="settings-hint">
                  Если перетащишь пункт в списке, режим автоматически станет
                  пользовательским.
                </p>
              </div>

              <div className="checklist-editor-actions">
                {(checklistEditor.source === "continuous" &&
                  checklistEditor.checklistId) ||
                (checklistEditor.source === "block-message" &&
                  checklistEditor.sourceMessageId) ? (
                  <button
                    type="button"
                    className="danger-action"
                    onClick={() => void handleDeleteChecklistFromEditor()}
                  >
                    удалить список
                  </button>
                ) : null}

                <button
                  type="button"
                  className="mini-action"
                  onClick={() => void handleSaveChecklistEditor()}
                >
                  сохранить
                </button>
              </div>
            </div>
          </div>
        )}

        {dictionaryEditor &&
          (() => {
            const dictionaryEditorLabels = normalizeDictionaryLabels(
              dictionaryEditor.labels,
              dictionaryEditor.columns
            );
            const dictionaryEditorSide1Columns = getDictionarySideColumns(
              dictionaryEditor.columns,
              "side1"
            );
            const dictionaryEditorSide2Columns = getDictionarySideColumns(
              dictionaryEditor.columns,
              "side2"
            );
            const dictionaryEditorSide1WordColumns = getDictionarySideColumns(
              dictionaryEditor.columns,
              "side1",
              "word"
            );
            const dictionaryEditorSide2WordColumns = getDictionarySideColumns(
              dictionaryEditor.columns,
              "side2",
              "word"
            );
            const dictionaryImportStatus = dictionaryImportDraft.trim()
              ? dictionaryImportPreview.ok
                ? `${dictionaryImportPreview.entries.length} пар готово к замене`
                : dictionaryImportPreview.error
              : "Поддерживаются JSON экспорта #DICT, TSV и CSV.";
            const dictionaryTransferPlaceholder = `Вставь TSV/CSV: ${dictionaryEditor.columns
              .map((column) =>
                getDictionaryFieldLabel(
                  column.id,
                  dictionaryEditorLabels,
                  dictionaryEditor.columns
                )
              )
              .join("\t")}`;
            const dictionaryTitleBadge = normalizeDictionaryTitle(
              dictionaryEditor.titleDraft
            );
            const dictionarySearchHasQuery =
              dictionarySearchQuery.trim().length > 0;
            const dictionarySearchActiveMatch =
              dictionarySearchMatches[dictionarySearchActiveIndex] ?? null;
            const dictionarySearchActiveCellKey = dictionarySearchActiveMatch
              ? makeDictionaryEditorCellKey(
                  dictionarySearchActiveMatch.entryId,
                  dictionarySearchActiveMatch.field
                )
              : "";
            const dictionarySearchMatchedCellKeys = new Set(
              dictionarySearchMatches.map((match) =>
                makeDictionaryEditorCellKey(match.entryId, match.field)
              )
            );
            const dictionarySearchMatchedRowIds = new Set(
              dictionarySearchMatches.map((match) => match.entryId)
            );
            const dictionarySearchHasFuzzyMatches = dictionarySearchMatches.some(
              (match) => match.isFuzzy
            );
            const dictionarySearchStatus = dictionarySearchHasQuery
              ? dictionarySearchMatches.length > 0
                ? `${dictionarySearchActiveIndex + 1} / ${
                    dictionarySearchMatches.length
                  }${dictionarySearchHasFuzzyMatches ? " · похожие" : ""}`
                : "нет совпадений"
              : "";

            return (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-3">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              onClick={closeDictionaryEditor}
              aria-label="Закрыть окно словаря"
            />

            <div className="project-create-modal dictionary-editor-modal popup-3d relative z-10 w-full max-w-5xl p-4 sm:p-5">
              <div className="dictionary-editor-header mb-3 flex justify-between gap-3">
                <div className="dictionary-editor-title-wrap">
                  <h2 className="font-display text-4xl leading-none">
                    Настройки #DICT
                  </h2>
                  <span className="dictionary-editor-title-badge">
                    {dictionaryTitleBadge}
                  </span>
                </div>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={closeDictionaryEditor}
                  aria-label="Закрыть окно словаря"
                >
                  x
                </button>
              </div>

              <div className="dictionary-editor-tabs" role="tablist">
                <button
                  type="button"
                  className={`mini-action dictionary-editor-tab ${
                    dictionaryEditorTab === "entries"
                      ? "dictionary-editor-tab-active"
                      : ""
                  }`}
                  onClick={() => setDictionaryEditorTab("entries")}
                >
                  слова
                </button>
                <button
                  type="button"
                  className={`mini-action dictionary-editor-tab ${
                    dictionaryEditorTab === "transfer"
                      ? "dictionary-editor-tab-active"
                      : ""
                  }`}
                  onClick={() => setDictionaryEditorTab("transfer")}
                >
                  импорт / экспорт
                </button>
                <button
                  type="button"
                  className={`mini-action dictionary-editor-tab ${
                    dictionaryEditorTab === "general"
                      ? "dictionary-editor-tab-active"
                      : ""
                  }`}
                  onClick={() => setDictionaryEditorTab("general")}
                >
                  общие
                </button>
              </div>

              <div className="dictionary-editor-body">
                {dictionaryEditorTab === "entries" && (
                  <div className="dictionary-editor-table-wrap">
                    <div className="dictionary-editor-mobile-column-actions mobile-only">
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => addDictionaryEditorColumn("side1")}
                      >
                        + side 1
                      </button>
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => addDictionaryEditorColumn("side2")}
                      >
                        + side 2
                      </button>
                    </div>
                    <table className="dictionary-editor-table dictionary-editor-table-dynamic">
                      <thead>
                        <tr>
                          {dictionaryEditorSide1Columns.map((column) => (
                            <th key={column.id}>
                              <div className="dictionary-editor-column-head">
                                <select
                                  value={column.kind}
                                  className="settings-input dictionary-editor-column-type"
                                  onChange={(event) =>
                                    updateDictionaryEditorColumnKind(
                                      column.id,
                                      normalizeDictionaryColumnKind(event.target.value)
                                    )
                                  }
                                  aria-label={`Тип столбца ${column.label}`}
                                >
                                  <option value="word">Слово</option>
                                  <option value="note">Пояснение</option>
                                </select>
                                {column.kind === "note" && (
                                  <select
                                    value={clampDictionaryColumnWordIndex(
                                      column.wordIndex,
                                      dictionaryEditorSide1WordColumns.length
                                    )}
                                    className="settings-input dictionary-editor-column-word-link"
                                    onChange={(event) =>
                                      updateDictionaryEditorColumnWordIndex(
                                        column.id,
                                        Number(event.target.value)
                                      )
                                    }
                                    aria-label={`Привязка пояснения ${column.label} к слову`}
                                  >
                                    {dictionaryEditorSide1WordColumns.map(
                                      (wordColumn, wordIndex) => (
                                        <option
                                          key={wordColumn.id}
                                          value={wordIndex}
                                        >
                                          к слову {wordIndex + 1}
                                        </option>
                                      )
                                    )}
                                  </select>
                                )}
                                <input
                                  value={dictionaryEditorLabels[column.id] ?? column.label}
                                  onChange={(event) =>
                                    updateDictionaryEditorLabel(
                                      column.id,
                                      event.target.value
                                    )
                                  }
                                  className="settings-input dictionary-editor-label-input"
                                  aria-label={`Подпись столбца ${column.label}`}
                                  placeholder={column.label}
                                />
                                {dictionaryEditor.columns.length > 2 && (
                                  <button
                                    type="button"
                                    className="danger-action dictionary-editor-column-remove"
                                    onClick={() =>
                                      void removeDictionaryEditorColumn(column.id)
                                    }
                                    aria-label={`Удалить столбец ${column.label}`}
                                  >
                                    -
                                  </button>
                                )}
                              </div>
                            </th>
                          ))}
                          <th className="dictionary-editor-side-divider-head">
                            <button
                              type="button"
                              className="mini-action dictionary-editor-column-add"
                              onClick={() => addDictionaryEditorColumn("side1")}
                              aria-label="Добавить столбец к карточке 1"
                            >
                              +
                            </button>
                          </th>
                          {dictionaryEditorSide2Columns.map((column) => (
                            <th key={column.id}>
                              <div className="dictionary-editor-column-head">
                                <select
                                  value={column.kind}
                                  className="settings-input dictionary-editor-column-type"
                                  onChange={(event) =>
                                    updateDictionaryEditorColumnKind(
                                      column.id,
                                      normalizeDictionaryColumnKind(event.target.value)
                                    )
                                  }
                                  aria-label={`Тип столбца ${column.label}`}
                                >
                                  <option value="word">Слово</option>
                                  <option value="note">Пояснение</option>
                                </select>
                                {column.kind === "note" && (
                                  <select
                                    value={clampDictionaryColumnWordIndex(
                                      column.wordIndex,
                                      dictionaryEditorSide2WordColumns.length
                                    )}
                                    className="settings-input dictionary-editor-column-word-link"
                                    onChange={(event) =>
                                      updateDictionaryEditorColumnWordIndex(
                                        column.id,
                                        Number(event.target.value)
                                      )
                                    }
                                    aria-label={`Привязка пояснения ${column.label} к слову`}
                                  >
                                    {dictionaryEditorSide2WordColumns.map(
                                      (wordColumn, wordIndex) => (
                                        <option
                                          key={wordColumn.id}
                                          value={wordIndex}
                                        >
                                          к слову {wordIndex + 1}
                                        </option>
                                      )
                                    )}
                                  </select>
                                )}
                                <input
                                  value={dictionaryEditorLabels[column.id] ?? column.label}
                                  onChange={(event) =>
                                    updateDictionaryEditorLabel(
                                      column.id,
                                      event.target.value
                                    )
                                  }
                                  className="settings-input dictionary-editor-label-input"
                                  aria-label={`Подпись столбца ${column.label}`}
                                  placeholder={column.label}
                                />
                                {dictionaryEditor.columns.length > 2 && (
                                  <button
                                    type="button"
                                    className="danger-action dictionary-editor-column-remove"
                                    onClick={() =>
                                      void removeDictionaryEditorColumn(column.id)
                                    }
                                    aria-label={`Удалить столбец ${column.label}`}
                                  >
                                    -
                                  </button>
                                )}
                              </div>
                            </th>
                          ))}
                          <th className="dictionary-editor-side-add-head">
                            <button
                              type="button"
                              className="mini-action dictionary-editor-column-add"
                              onClick={() => addDictionaryEditorColumn("side2")}
                              aria-label="Добавить столбец к карточке 2"
                            >
                              +
                            </button>
                          </th>
                          <th aria-label="действия" />
                        </tr>
                      </thead>
                      <tbody>
                        {dictionaryEditor.entries.map((entry, index) => {
                          const rowHasSearchMatch =
                            dictionarySearchMatchedRowIds.has(entry.id);

                          return (
                            <tr
                              key={entry.id}
                              className={
                                rowHasSearchMatch
                                  ? "dictionary-editor-row-match"
                                  : undefined
                              }
                            >
                              {dictionaryEditorSide1Columns.map((column) => {
                                const cellKey = makeDictionaryEditorCellKey(
                                  entry.id,
                                  column.id
                                );
                                const label =
                                  dictionaryEditorLabels[column.id] ?? column.label;

                                return (
                                  <td key={column.id} data-label={label}>
                                    <textarea
                                      ref={(node) => {
                                        dictionaryEditorCellRefsRef.current[
                                          cellKey
                                        ] = node;
                                      }}
                                      value={getDictionaryEntryFieldDraftText(
                                        entry,
                                        column.id
                                      )}
                                      onChange={(event) =>
                                        updateDictionaryEditorEntry(
                                          entry.id,
                                          column.id,
                                          event.target.value
                                        )
                                      }
                                      className={`settings-input dictionary-editor-cell ${
                                        dictionarySearchMatchedCellKeys.has(cellKey)
                                          ? "dictionary-editor-cell-match"
                                          : ""
                                      } ${
                                        dictionarySearchActiveCellKey === cellKey
                                          ? "dictionary-editor-cell-active-match"
                                          : ""
                                      }`}
                                      placeholder={`${label} ${index + 1}`}
                                    />
                                  </td>
                                );
                              })}
                              {index === 0 && (
                                <td
                                  rowSpan={dictionaryEditor.entries.length}
                                  className="dictionary-editor-side-add-cell dictionary-editor-side-add-cell-side1"
                                  data-label=""
                                >
                                  <button
                                    type="button"
                                    className="mini-action dictionary-editor-column-add dictionary-editor-column-add-vertical"
                                    onClick={() => addDictionaryEditorColumn("side1")}
                                    aria-label="Add side 1 column"
                                  >
                                    +
                                  </button>
                                </td>
                              )}
                              {dictionaryEditorSide2Columns.map((column) => {
                                const cellKey = makeDictionaryEditorCellKey(
                                  entry.id,
                                  column.id
                                );
                                const label =
                                  dictionaryEditorLabels[column.id] ?? column.label;

                                return (
                                  <td key={column.id} data-label={label}>
                                    <textarea
                                      ref={(node) => {
                                        dictionaryEditorCellRefsRef.current[
                                          cellKey
                                        ] = node;
                                      }}
                                      value={getDictionaryEntryFieldDraftText(
                                        entry,
                                        column.id
                                      )}
                                      onChange={(event) =>
                                        updateDictionaryEditorEntry(
                                          entry.id,
                                          column.id,
                                          event.target.value
                                        )
                                      }
                                      className={`settings-input dictionary-editor-cell ${
                                        dictionarySearchMatchedCellKeys.has(cellKey)
                                          ? "dictionary-editor-cell-match"
                                          : ""
                                      } ${
                                        dictionarySearchActiveCellKey === cellKey
                                          ? "dictionary-editor-cell-active-match"
                                          : ""
                                      }`}
                                      placeholder={`${label} ${index + 1}`}
                                    />
                                  </td>
                                );
                              })}
                              {index === 0 && (
                                <td
                                  rowSpan={dictionaryEditor.entries.length}
                                  className="dictionary-editor-side-add-cell dictionary-editor-side-add-cell-side2"
                                  data-label=""
                                >
                                  <button
                                    type="button"
                                    className="mini-action dictionary-editor-column-add dictionary-editor-column-add-vertical"
                                    onClick={() => addDictionaryEditorColumn("side2")}
                                    aria-label="Add side 2 column"
                                  >
                                    +
                                  </button>
                                </td>
                              )}
                              <td data-label="actions">
                                <button
                                  type="button"
                                  className="danger-action dictionary-editor-remove"
                                  onClick={() => removeDictionaryEditorEntry(entry.id)}
                                >
                                  -
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {dictionaryEditor && false && (
                    <table
                      className="dictionary-editor-table dictionary-editor-table-hidden"
                      aria-hidden="true"
                    >
                      <thead>
                        <tr>
                          <th>
                            <input
                              value={dictionaryEditor!.labels.side1}
                              onChange={(event) =>
                                updateDictionaryEditorLabel("side1", event.target.value)
                              }
                              className="settings-input dictionary-editor-label-input"
                              aria-label="Подпись стороны 1"
                              placeholder={DEFAULT_DICTIONARY_FIELD_LABELS.side1}
                            />
                          </th>
                          <th>
                            <input
                              value={dictionaryEditor!.labels.side1Note}
                              onChange={(event) =>
                                updateDictionaryEditorLabel(
                                  "side1Note",
                                  event.target.value
                                )
                              }
                              className="settings-input dictionary-editor-label-input"
                              aria-label="Подпись пояснения 1"
                              placeholder={DEFAULT_DICTIONARY_FIELD_LABELS.side1Note}
                            />
                          </th>
                          <th>
                            <input
                              value={dictionaryEditor!.labels.side2}
                              onChange={(event) =>
                                updateDictionaryEditorLabel("side2", event.target.value)
                              }
                              className="settings-input dictionary-editor-label-input"
                              aria-label="Подпись стороны 2"
                              placeholder={DEFAULT_DICTIONARY_FIELD_LABELS.side2}
                            />
                          </th>
                          <th>
                            <input
                              value={dictionaryEditor!.labels.side2Note}
                              onChange={(event) =>
                                updateDictionaryEditorLabel(
                                  "side2Note",
                                  event.target.value
                                )
                              }
                              className="settings-input dictionary-editor-label-input"
                              aria-label="Подпись пояснения 2"
                              placeholder={DEFAULT_DICTIONARY_FIELD_LABELS.side2Note}
                            />
                          </th>
                          <th aria-label="действия" />
                        </tr>
                      </thead>
                      <tbody>
                        {dictionaryEditor!.entries.map((entry, index) => {
                          const side1CellKey = makeDictionaryEditorCellKey(
                            entry.id,
                            "side1"
                          );
                          const side1NoteCellKey = makeDictionaryEditorCellKey(
                            entry.id,
                            "side1Note"
                          );
                          const side2CellKey = makeDictionaryEditorCellKey(
                            entry.id,
                            "side2"
                          );
                          const side2NoteCellKey = makeDictionaryEditorCellKey(
                            entry.id,
                            "side2Note"
                          );
                          const rowHasSearchMatch =
                            dictionarySearchMatchedRowIds.has(entry.id);

                          return (
                            <tr
                              key={entry.id}
                              className={
                                rowHasSearchMatch
                                  ? "dictionary-editor-row-match"
                                  : undefined
                              }
                            >
                              <td data-label={dictionaryEditorLabels.side1}>
                                <textarea
                                  ref={(node) => {
                                    dictionaryEditorCellRefsRef.current[
                                      side1CellKey
                                    ] = node;
                                  }}
                                  value={getDictionaryEntryFieldDraftText(
                                    entry,
                                    "side1"
                                  )}
                                  onChange={(event) =>
                                    updateDictionaryEditorEntry(
                                      entry.id,
                                      "side1",
                                      event.target.value
                                    )
                                  }
                                  className={`settings-input dictionary-editor-cell ${
                                    dictionarySearchMatchedCellKeys.has(side1CellKey)
                                      ? "dictionary-editor-cell-match"
                                      : ""
                                  } ${
                                    dictionarySearchActiveCellKey === side1CellKey
                                      ? "dictionary-editor-cell-active-match"
                                      : ""
                                  }`}
                                  placeholder={`${dictionaryEditorLabels.side1} ${index + 1}`}
                                />
                              </td>
                              <td data-label={dictionaryEditorLabels.side1Note}>
                                <textarea
                                  ref={(node) => {
                                    dictionaryEditorCellRefsRef.current[
                                      side1NoteCellKey
                                    ] = node;
                                  }}
                                  value={getDictionaryEntryFieldDraftText(
                                    entry,
                                    "side1Note"
                                  )}
                                  onChange={(event) =>
                                    updateDictionaryEditorEntry(
                                      entry.id,
                                      "side1Note",
                                      event.target.value
                                    )
                                  }
                                  className={`settings-input dictionary-editor-cell ${
                                    dictionarySearchMatchedCellKeys.has(
                                      side1NoteCellKey
                                    )
                                      ? "dictionary-editor-cell-match"
                                      : ""
                                  } ${
                                    dictionarySearchActiveCellKey ===
                                    side1NoteCellKey
                                      ? "dictionary-editor-cell-active-match"
                                      : ""
                                  }`}
                                  placeholder={dictionaryEditorLabels.side1Note}
                                />
                              </td>
                              <td data-label={dictionaryEditorLabels.side2}>
                                <textarea
                                  ref={(node) => {
                                    dictionaryEditorCellRefsRef.current[
                                      side2CellKey
                                    ] = node;
                                  }}
                                  value={getDictionaryEntryFieldDraftText(
                                    entry,
                                    "side2"
                                  )}
                                  onChange={(event) =>
                                    updateDictionaryEditorEntry(
                                      entry.id,
                                      "side2",
                                      event.target.value
                                    )
                                  }
                                  className={`settings-input dictionary-editor-cell ${
                                    dictionarySearchMatchedCellKeys.has(side2CellKey)
                                      ? "dictionary-editor-cell-match"
                                      : ""
                                  } ${
                                    dictionarySearchActiveCellKey === side2CellKey
                                      ? "dictionary-editor-cell-active-match"
                                      : ""
                                  }`}
                                  placeholder={dictionaryEditorLabels.side2}
                                />
                              </td>
                              <td data-label={dictionaryEditorLabels.side2Note}>
                                <textarea
                                  ref={(node) => {
                                    dictionaryEditorCellRefsRef.current[
                                      side2NoteCellKey
                                    ] = node;
                                  }}
                                  value={getDictionaryEntryFieldDraftText(
                                    entry,
                                    "side2Note"
                                  )}
                                  onChange={(event) =>
                                    updateDictionaryEditorEntry(
                                      entry.id,
                                      "side2Note",
                                      event.target.value
                                    )
                                  }
                                  className={`settings-input dictionary-editor-cell ${
                                    dictionarySearchMatchedCellKeys.has(
                                      side2NoteCellKey
                                    )
                                      ? "dictionary-editor-cell-match"
                                      : ""
                                  } ${
                                    dictionarySearchActiveCellKey ===
                                    side2NoteCellKey
                                      ? "dictionary-editor-cell-active-match"
                                      : ""
                                  }`}
                                  placeholder={dictionaryEditorLabels.side2Note}
                                />
                              </td>
                              <td data-label="actions">
                                <button
                                  type="button"
                                  className="danger-action dictionary-editor-remove"
                                  onClick={() => removeDictionaryEditorEntry(entry.id)}
                                >
                                  -
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    )}
                  </div>
                )}

                {dictionaryEditorTab === "transfer" && (
                  <div
                    className="dictionary-editor-transfer"
                    onDragOver={handleDictionaryImportDragOver}
                    onDrop={handleDictionaryImportDrop}
                  >
                    <div className="dictionary-editor-transfer-head">
                      <label className="settings-label" htmlFor="dictionary-import-draft">
                        экспорт / импорт #DICT
                      </label>
                      <div className="dictionary-editor-transfer-actions">
                        <button
                          type="button"
                          className="mini-action"
                          onClick={handleExportDictionaryJson}
                        >
                          экспорт JSON
                        </button>
                        <button
                          type="button"
                          className="mini-action"
                          onClick={handleExportDictionaryTsv}
                        >
                          экспорт TSV
                        </button>
                        <button
                          type="button"
                          className="mini-action"
                          onClick={handleOpenDictionaryImportFilePicker}
                        >
                          файл
                        </button>
                      </div>
                    </div>
                    <textarea
                      id="dictionary-import-draft"
                      value={dictionaryImportDraft}
                      onChange={(event) => setDictionaryImportDraft(event.target.value)}
                      onPaste={handleDictionaryImportPaste}
                      onDragOver={handleDictionaryImportDragOver}
                      onDrop={handleDictionaryImportDrop}
                      className="settings-input settings-textarea dictionary-editor-import-textarea"
                      placeholder={dictionaryTransferPlaceholder}
                    />
                    <div className="dictionary-editor-transfer-footer">
                      <p
                        className={`dictionary-editor-import-status ${
                          dictionaryImportDraft.trim() && !dictionaryImportPreview.ok
                            ? "dictionary-editor-import-status-error"
                            : ""
                        }`}
                      >
                        {dictionaryImportStatus}
                      </p>
                      <button
                        type="button"
                        className="danger-action"
                        onClick={() => void handleApplyDictionaryImport()}
                      >
                        импорт: заменить
                      </button>
                    </div>
                    <input
                      ref={dictionaryImportFileRef}
                      type="file"
                      accept=".json,.tsv,.csv,text/plain,application/json,text/csv,text/tab-separated-values"
                      className="sr-only"
                      onChange={(event) => void handleDictionaryImportFileChange(event)}
                    />
                  </div>
                )}

                {dictionaryEditorTab === "general" && (
                  <div className="dictionary-editor-general">
                    <div className="dictionary-editor-settings">
                      <label className="dictionary-editor-field">
                        <span className="settings-label">название словаря</span>
                        <input
                          value={dictionaryEditor.titleDraft}
                          onChange={(event) =>
                            updateDictionaryEditorTitle(event.target.value)
                          }
                          className="settings-input"
                          placeholder="Словарь"
                        />
                      </label>

                      <label className="dictionary-editor-field dictionary-editor-field-wide">
                        <span className="settings-label">теги словаря</span>
                        <input
                          value={dictionaryEditor.tagsDraft}
                          onChange={(event) =>
                            updateDictionaryEditorTags(event.target.value)
                          }
                          className="settings-input"
                          placeholder="#verbs #lesson-1"
                        />
                      </label>

                      <label className="dictionary-editor-field">
                        <span className="settings-label">в заучивании показывать</span>
                        <select
                          value={dictionaryEditor.promptSide}
                          className="settings-input"
                          onChange={(event) =>
                            updateDictionaryEditorPromptSide(
                              normalizeDictionaryPromptSide(event.target.value)
                            )
                          }
                        >
                          <option value="side1">
                            {toDictionaryPromptSideLabel(
                              "side1",
                              dictionaryEditorLabels,
                              dictionaryEditor.columns
                            )}
                          </option>
                          <option value="side2">
                            {toDictionaryPromptSideLabel(
                              "side2",
                              dictionaryEditorLabels,
                              dictionaryEditor.columns
                            )}
                          </option>
                        </select>
                      </label>

                      <label className="dictionary-editor-field">
                        <span className="settings-label">пояснения в заучивании</span>
                        <select
                          value={dictionaryEditor.noteDisplayMode}
                          className="settings-input"
                          onChange={(event) =>
                            updateDictionaryEditorNoteDisplayMode(
                              normalizeDictionaryNoteDisplayMode(event.target.value)
                            )
                          }
                        >
                          <option value="continuous">сплошной режим</option>
                          <option value="separate">отдельный режим</option>
                        </select>
                      </label>

                      <label className="dictionary-editor-toggle">
                        <input
                          type="checkbox"
                          checked={dictionaryEditor.shuffle}
                          onChange={(event) =>
                            updateDictionaryEditorShuffle(event.target.checked)
                          }
                        />
                        <span>давать слова в перемешку</span>
                      </label>

                      <label className="dictionary-editor-toggle">
                        <input
                          type="checkbox"
                          checked={dictionaryEditor.progressMode}
                          onChange={(event) =>
                            updateDictionaryEditorProgressMode(event.target.checked)
                          }
                        />
                        <span>режим прогресса</span>
                      </label>

                      <label className="dictionary-editor-toggle">
                        <input
                          type="checkbox"
                          checked={dictionaryEditor.cardMode}
                          onChange={(event) =>
                            updateDictionaryEditorCardMode(event.target.checked)
                          }
                        />
                        <span>режим карточек</span>
                      </label>

                      <label className="dictionary-editor-toggle">
                        <input
                          type="checkbox"
                          checked={dictionaryEditor.motivateOnCorrect}
                          onChange={(event) =>
                            updateDictionaryEditorMotivateOnCorrect(
                              event.target.checked
                            )
                          }
                        />
                        <span>показывать мотивацию</span>
                      </label>

                      <label className="dictionary-editor-toggle">
                        <input
                          type="checkbox"
                          checked={dictionaryEditor.adhdMode}
                          onChange={(event) =>
                            updateDictionaryEditorAdhdMode(event.target.checked)
                          }
                        />
                        <span>Режим СДВГ</span>
                      </label>

                      <div
                        className={`dictionary-editor-motivation-settings ${
                          !(dictionaryEditor.motivateOnCorrect || dictionaryEditor.adhdMode)
                            ? "dictionary-editor-motivation-settings-disabled"
                            : ""
                        }`}
                      >
                        <label className="dictionary-editor-field">
                          <span className="settings-label">
                            смена мотивационного фото
                          </span>
                          <select
                            value={dictionaryEditor.motivationAdvanceMode}
                            className="settings-input"
                            disabled={
                              !(dictionaryEditor.motivateOnCorrect || dictionaryEditor.adhdMode)
                            }
                            onChange={(event) =>
                              updateDictionaryEditorMotivationAdvanceMode(
                                normalizeDictionaryMotivationAdvanceMode(
                                  event.target.value
                                )
                              )
                            }
                          >
                            <option value="auto">авто</option>
                            <option value="manual">ручное</option>
                          </select>
                        </label>

                        {dictionaryEditor.motivationAdvanceMode === "auto" && (
                          <label className="dictionary-editor-field">
                            <span className="settings-label">
                              убрать через, сек.
                            </span>
                            <input
                              type="number"
                              min={MIN_DICTIONARY_MOTIVATION_AUTO_SECONDS}
                              max={MAX_DICTIONARY_MOTIVATION_AUTO_SECONDS}
                              step="0.5"
                              value={dictionaryEditor.motivationAutoSeconds}
                              className="settings-input"
                              disabled={
                                !(dictionaryEditor.motivateOnCorrect || dictionaryEditor.adhdMode)
                              }
                              onChange={(event) =>
                                updateDictionaryEditorMotivationAutoSeconds(
                                  event.target.value
                                )
                              }
                            />
                          </label>
                        )}
                      </div>

                      <label className="dictionary-editor-toggle">
                        <input
                          type="checkbox"
                          checked={dictionaryEditor.autoSpeak}
                          onChange={(event) =>
                            updateDictionaryEditorAutoSpeak(event.target.checked)
                          }
                        />
                        <span>автоозвучка новой стороны</span>
                      </label>

                      <div className="dictionary-editor-autospeak-fields">
                        <span className="settings-label">автоозвучивать</span>
                        <div className="dictionary-editor-autospeak-grid">
                          {dictionaryEditor.columns.map((column) => {
                            const field = column.id;
                            const checked = normalizeDictionaryAutoSpeakFields(
                              dictionaryEditor.autoSpeakFields,
                              [],
                              dictionaryEditor.columns
                            ).includes(field);

                            return (
                              <label
                                key={`dictionary-autospeak-${field}`}
                                className="dictionary-editor-autospeak-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    toggleDictionaryEditorAutoSpeakField(field)
                                  }
                                />
                                <span>
                                  {getDictionaryFieldLabel(
                                    field,
                                    dictionaryEditorLabels,
                                    dictionaryEditor.columns
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="dictionary-editor-autospeak-fields">
                        <span className="settings-label">озвучивать кнопкой</span>
                        <div className="dictionary-editor-autospeak-grid">
                          {dictionaryEditor.columns.map((column) => {
                            const field = column.id;
                            const checked = normalizeDictionaryManualSpeakFields(
                              dictionaryEditor.manualSpeakFields,
                              [],
                              dictionaryEditor.columns
                            ).includes(field);

                            return (
                              <label
                                key={`dictionary-manual-speak-${field}`}
                                className="dictionary-editor-autospeak-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    toggleDictionaryEditorManualSpeakField(field)
                                  }
                                />
                                <span>
                                  {getDictionaryFieldLabel(
                                    field,
                                    dictionaryEditorLabels,
                                    dictionaryEditor.columns
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <label className="dictionary-editor-field">
                      <span className="settings-label">описание словаря</span>
                      <textarea
                        value={dictionaryEditor.descriptionDraft}
                        onChange={(event) =>
                          updateDictionaryEditorDescription(event.target.value)
                        }
                        className="settings-input settings-textarea"
                        placeholder="Для чего этот словарь, тема, заметки..."
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="dictionary-editor-actions">
                {dictionaryEditorTab === "entries" && (
                  <>
                  <button
                    type="button"
                    className="mini-action dictionary-editor-mobile-search-toggle mobile-only"
                    onClick={() => setDictionaryMobileSearchOpen((open) => !open)}
                    aria-expanded={dictionaryMobileSearchOpen}
                  >
                    search
                  </button>
                  <button
                    type="button"
                    className="mini-action dictionary-editor-mobile-add-entry mobile-only"
                    onClick={addDictionaryEditorEntry}
                  >
                    + pair
                  </button>
                  <div
                    className={`dictionary-editor-search-panel ${
                      dictionaryMobileSearchOpen
                        ? "dictionary-editor-search-panel-open"
                        : ""
                    }`}
                  >
                    <label
                      className="dictionary-editor-search-field"
                      htmlFor="dictionary-editor-search"
                    >
                      <span className="settings-label">поиск</span>
                      <input
                        id="dictionary-editor-search"
                        value={dictionarySearchQuery}
                        onChange={(event) =>
                          updateDictionaryEditorSearchQuery(event.target.value)
                        }
                        onKeyDown={handleDictionaryEditorSearchKeyDown}
                        className="settings-input dictionary-editor-search-input"
                        placeholder="слово или слово с ошибкой..."
                        aria-label="Поиск по текущему словарю"
                      />
                    </label>

                    {dictionarySearchHasQuery && (
                      <span
                        className={`dictionary-editor-search-status ${
                          dictionarySearchMatches.length === 0
                            ? "dictionary-editor-search-status-empty"
                            : ""
                        }`}
                        aria-live="polite"
                      >
                        {dictionarySearchStatus}
                      </span>
                    )}

                    <div
                      className="dictionary-editor-search-controls"
                      role="group"
                      aria-label="Навигация по совпадениям"
                    >
                      <button
                        type="button"
                        className="mini-action dictionary-editor-search-step"
                        onClick={() => moveDictionaryEditorSearch(-1)}
                        disabled={dictionarySearchMatches.length === 0}
                        aria-label="Предыдущее совпадение"
                      >
                        &lt;
                      </button>
                      <button
                        type="button"
                        className="mini-action dictionary-editor-search-step"
                        onClick={() => moveDictionaryEditorSearch(1)}
                        disabled={dictionarySearchMatches.length === 0}
                        aria-label="Следующее совпадение"
                      >
                        &gt;
                      </button>
                      <button
                        type="button"
                        className="mini-action dictionary-editor-search-clear"
                        onClick={resetDictionaryEditorSearch}
                        disabled={!dictionarySearchHasQuery}
                      >
                        сброс
                      </button>
                    </div>

                    <button
                      type="button"
                      className="mini-action dictionary-editor-add-entry"
                      onClick={addDictionaryEditorEntry}
                    >
                      + пара
                    </button>
                  </div>
                  </>
                )}

                {(dictionaryEditor.source === "continuous" &&
                  dictionaryEditor.dictionaryId) ||
                (dictionaryEditor.source === "block-message" &&
                  dictionaryEditor.sourceMessageId) ? (
                  <button
                    type="button"
                    className="danger-action"
                    onClick={() => void handleDeleteDictionaryFromEditor()}
                  >
                    удалить словарь
                  </button>
                ) : null}

                <button
                  type="button"
                  className="mini-action"
                  onClick={() =>
                    void handleSaveDictionaryEditor({ openStudyAfterSave: true })
                  }
                >
                  заучивание
                </button>

                <button
                  type="button"
                  className="mini-action"
                  onClick={() => void handleSaveDictionaryEditor()}
                >
                  сохранить
                </button>
              </div>
            </div>
          </div>
            );
          })()}

        {dictionaryStudy &&
          (() => {
            const currentEntry =
              dictionaryStudy.cards[dictionaryStudy.currentIndex] ?? null;
            if (!currentEntry) {
              return null;
            }

            const activeSide = dictionaryStudy.isAnswerRevealed
              ? oppositeDictionaryPromptSide(dictionaryStudy.promptSide)
              : dictionaryStudy.promptSide;
            const hiddenSide = oppositeDictionaryPromptSide(activeSide);
            const activeSideLabel = toDictionaryPromptSideLabel(
              activeSide,
              dictionaryStudy.labels,
              dictionaryStudy.columns
            );
            const hiddenSideLabel = toDictionaryPromptSideLabel(
              hiddenSide,
              dictionaryStudy.labels,
              dictionaryStudy.columns
            );
            const autoSpeakFieldLabels = normalizeDictionaryAutoSpeakFields(
              dictionaryStudy.autoSpeakFields,
              getDefaultDictionaryAutoSpeakFields(dictionaryStudy.columns),
              dictionaryStudy.columns
            )
              .map((field) =>
                getDictionaryFieldLabel(
                  field,
                  dictionaryStudy.labels,
                  dictionaryStudy.columns
                )
              )
              .join(" + ");
            const activeWordItems = getDictionaryEntrySideValues(
              currentEntry,
              dictionaryStudy.columns,
              activeSide,
              "word"
            );
            const activeWordGroups = getDictionaryEntrySideWordGroups(
              currentEntry,
              dictionaryStudy.columns,
              activeSide
            );
            const allActiveNoteItems = getDictionaryEntrySideValues(
              currentEntry,
              dictionaryStudy.columns,
              activeSide,
              "note"
            );
            const activeWordIndex = wrapIndex(
              dictionaryStudy.activeWordIndexBySide[activeSide] ?? 0,
              Math.max(1, activeWordItems.length)
            );
            const activeWordItem = activeWordItems[activeWordIndex] ?? null;
            const activeNoteItems = activeWordItem
              ? allActiveNoteItems.filter(
                  (note) => note.wordIndex === activeWordItem.wordIndex
                )
              : [];
            const activeNoteIndex = wrapIndex(
              dictionaryStudy.activeNoteIndexBySide[activeSide] ?? 0,
              Math.max(1, activeNoteItems.length)
            );
            const activeNoteItem = activeNoteItems[activeNoteIndex] ?? null;
            const hasActiveSideNotes = allActiveNoteItems.length > 0;
            const progressStats =
              getDictionaryStudyProgressStats(dictionaryStudy);
            const currentAnswerResult =
              dictionaryStudy.answerResultsByEntryId[currentEntry.id] ?? null;
            const canGradeDictionaryAnswer =
              dictionaryStudy.progressMode &&
              dictionaryStudy.isAnswerRevealed &&
              !dictionaryStudy.isProgressComplete &&
              !dictionaryStudy.motivationImageUrl &&
              !currentAnswerResult;
            const canToggleDictionarySide =
              !dictionaryStudy.isProgressComplete &&
              !dictionaryStudy.motivationImageUrl &&
              !currentAnswerResult;
            const canMoveDictionaryPrevious =
              !dictionaryStudy.isProgressComplete &&
              !dictionaryStudy.motivationImageUrl &&
              dictionaryStudy.currentIndex > 0;
            const canMoveDictionaryNext =
              !dictionaryStudy.isProgressComplete &&
              !dictionaryStudy.motivationImageUrl &&
              (!dictionaryStudy.progressMode || Boolean(currentAnswerResult));
            const currentEntryIdentity = makeDictionaryStudyEntryIdentity(
              dictionaryStudy,
              currentEntry
            );
            const currentSimilarGroups = findDictionaryGroupsForIdentity(
              dictionaryGroups,
              currentEntryIdentity
            );
            const canOpenSimilarDictionaryWords =
              currentSimilarGroups.length > 0 &&
              !dictionaryStudy.isProgressComplete &&
              !dictionaryStudy.motivationImageUrl;

            return (
              <div className="dictionary-study-overlay absolute inset-0 z-[80]">
                <div className="dictionary-study-backdrop" />
                <div className="dictionary-study-panel">
                  <header className="dictionary-study-head">
                    <div className="min-w-0">
                      <p className="dictionary-study-kicker">#DICT</p>
                      <h2 className="dictionary-study-title">
                        {dictionaryStudy.title}
                      </h2>
                    </div>
                    <div className="dictionary-study-head-actions">
                      <button
                        type="button"
                        className="menu-action h-9 w-9"
                        onClick={openDictionaryEditorFromStudy}
                        aria-label="Открыть настройки словаря"
                        title="Открыть настройки словаря"
                      >
                        gear
                      </button>
                      <button
                        type="button"
                        className="menu-action h-9 w-9 text-xl"
                        onClick={closeDictionaryStudy}
                        aria-label="Закрыть заучивание"
                      >
                        x
                      </button>
                    </div>
                  </header>

                  <div className="dictionary-study-meta-row">
                    <div className="dictionary-study-counter">
                      {dictionaryStudy.isProgressComplete
                        ? "готово"
                        : `${dictionaryStudy.currentIndex + 1} / ${dictionaryStudy.cards.length}`}
                    </div>
                    <label className="dictionary-study-toggle dictionary-study-adhd-toggle">
                      <input
                        type="checkbox"
                        checked={dictionaryStudy.adhdMode}
                        onChange={(event) =>
                          setDictionaryStudyAdhdMode(event.target.checked)
                        }
                      />
                      <span>режим сдвг</span>
                    </label>
                    <label className="dictionary-study-toggle dictionary-study-shuffle-toggle">
                      <input
                        type="checkbox"
                        checked={dictionaryStudy.shuffle}
                        onChange={(event) =>
                          setDictionaryStudyShuffle(event.target.checked)
                        }
                      />
                      <span>перемешивание</span>
                    </label>
                    <button
                      type="button"
                      className="mini-action dictionary-study-reset-button"
                      onClick={resetDictionaryStudyProgress}
                      disabled={dictionaryStudy.cards.length === 0}
                    >
                      {dictionaryStudy.shuffle ? "перемешать" : "сбросить прогресс"}
                    </button>
                    {dictionaryStudy.progressMode && (
                      <span className="dictionary-study-progress-badge">
                        верно {dictionaryStudy.correctCount} / неверно{" "}
                        {dictionaryStudy.wrongCount}
                      </span>
                    )}
                    {dictionaryStudy.autoSpeak && (
                      <span className="dictionary-study-autospeak-badge">
                        автоозвучка: {autoSpeakFieldLabels}
                      </span>
                    )}
                  </div>

                  <div
                    ref={dictionaryStudyCardShellRef}
                    className={`dictionary-study-card-shell ${
                      dictionaryStudy.cardMode && canToggleDictionarySide
                        ? "dictionary-study-card-shell-flippable"
                        : ""
                    }`}
                    onClick={
                      dictionaryStudy.cardMode && canToggleDictionarySide
                        ? toggleDictionaryStudySide
                        : undefined
                    }
                    onKeyDown={(event) => {
                      if (!dictionaryStudy.cardMode || !canToggleDictionarySide) {
                        return;
                      }

                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleDictionaryStudySide();
                      }
                    }}
                    role={
                      dictionaryStudy.cardMode && canToggleDictionarySide
                        ? "button"
                        : undefined
                    }
                    tabIndex={
                      dictionaryStudy.cardMode && canToggleDictionarySide ? 0 : undefined
                    }
                    aria-label={
                      dictionaryStudy.cardMode && canToggleDictionarySide
                        ? `Показать ${hiddenSideLabel}`
                        : undefined
                    }
                  >
                    <div
                      ref={dictionaryStudyCardContentRef}
                      className={`dictionary-study-card-content ${
                        !dictionaryStudy.isProgressComplete &&
                        dictionaryStudy.noteDisplayMode === "continuous"
                          ? "dictionary-study-card-content-scroll"
                          : ""
                      }`}
                      style={
                        {
                          "--dictionary-study-scale": dictionaryStudyCardScale,
                        } as CSSProperties
                      }
                    >
                      <div
                        ref={dictionaryStudyCardFitRef}
                        className={`dictionary-study-card-fit ${
                          !dictionaryStudy.isProgressComplete &&
                          dictionaryStudy.noteDisplayMode === "separate"
                            ? `dictionary-study-card-fit-separate ${
                                hasActiveSideNotes
                                  ? "dictionary-study-card-fit-separate-with-notes"
                                  : ""
                              }`
                            : !dictionaryStudy.isProgressComplete &&
                                dictionaryStudy.noteDisplayMode === "continuous"
                              ? "dictionary-study-card-fit-continuous"
                              : ""
                        }`}
                      >
                        {dictionaryStudy.isProgressComplete ? (
                          <div className="dictionary-study-results">
                            <p className="dictionary-study-side">статистика</p>
                            <div className="dictionary-study-result-score">
                              {progressStats.percent}%
                            </div>
                            <div className="dictionary-study-result-grid">
                              <span>слов</span>
                              <strong>{progressStats.total}</strong>
                              <span>правильно</span>
                              <strong>{progressStats.correct}</strong>
                              <span>не правильно</span>
                              <strong>{progressStats.wrong}</strong>
                              <span>время</span>
                              <strong>{progressStats.elapsed}</strong>
                              <span>среднее</span>
                              <strong>{progressStats.average}</strong>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="dictionary-study-side">{activeSideLabel}</p>
                            {dictionaryStudy.noteDisplayMode === "separate" ? (
                              <>
                                <div className="dictionary-study-words">
                                  <div
                                    className={`dictionary-study-value-switch dictionary-study-word-switch ${
                                      activeWordItems.length > 1
                                        ? "dictionary-study-word-switch-with-arrows"
                                        : ""
                                    }`}
                                  >
                                    {activeWordItems.length > 1 ? (
                                      <button
                                        type="button"
                                        className="tool-button tool-blue dictionary-study-inline-arrow dictionary-study-window-arrow dictionary-study-window-arrow-left"
                                        onPointerDown={(event) =>
                                          event.stopPropagation()
                                        }
                                        onMouseDown={(event) =>
                                          event.stopPropagation()
                                        }
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          moveDictionaryStudySideValue("word", -1);
                                        }}
                                        aria-label="previous word"
                                      >
                                        &lt;
                                      </button>
                                    ) : (
                                      <span
                                        className="dictionary-study-inline-arrow dictionary-study-inline-arrow-placeholder dictionary-study-window-arrow dictionary-study-window-arrow-left"
                                        aria-hidden="true"
                                      />
                                    )}
                                    <div
                                      ref={dictionaryStudyWordSlotRef}
                                      className="dictionary-study-word-slot"
                                    >
                                      <div
                                        ref={dictionaryStudyWordValueRef}
                                        className="dictionary-study-word"
                                      >
                                        {activeWordItem?.text ?? ""}
                                      </div>
                                    </div>
                                    {activeWordItems.length > 1 ? (
                                      <button
                                        type="button"
                                        className="tool-button tool-blue dictionary-study-inline-arrow dictionary-study-window-arrow dictionary-study-window-arrow-right"
                                        onPointerDown={(event) =>
                                          event.stopPropagation()
                                        }
                                        onMouseDown={(event) =>
                                          event.stopPropagation()
                                        }
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          moveDictionaryStudySideValue("word", 1);
                                        }}
                                        aria-label="next word"
                                      >
                                        &gt;
                                      </button>
                                    ) : (
                                      <span
                                        className="dictionary-study-inline-arrow dictionary-study-inline-arrow-placeholder dictionary-study-window-arrow dictionary-study-window-arrow-right"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </div>
                                </div>
                                {hasActiveSideNotes ? (
                                  <div className="dictionary-study-value-switch dictionary-study-note-switch">
                                    {activeNoteItems.length > 1 ? (
                                      <button
                                        type="button"
                                        className="tool-button tool-blue dictionary-study-inline-arrow"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          moveDictionaryStudySideValue("note", -1);
                                        }}
                                        aria-label="previous note"
                                      >
                                        &lt;
                                      </button>
                                    ) : (
                                      <span
                                        className="dictionary-study-inline-arrow dictionary-study-inline-arrow-placeholder"
                                        aria-hidden="true"
                                      />
                                    )}
                                    <div
                                      ref={dictionaryStudyNoteSlotRef}
                                      className="dictionary-study-note-slot"
                                    >
                                      <div
                                        ref={dictionaryStudyNoteValueRef}
                                        className={`dictionary-study-note ${
                                          activeNoteItem
                                            ? ""
                                            : "dictionary-study-note-placeholder"
                                        }`}
                                        aria-hidden={activeNoteItem ? undefined : true}
                                      >
                                        {activeNoteItem?.text ?? ""}
                                      </div>
                                    </div>
                                    {activeNoteItems.length > 1 ? (
                                      <button
                                        type="button"
                                        className="tool-button tool-blue dictionary-study-inline-arrow"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          moveDictionaryStudySideValue("note", 1);
                                        }}
                                        aria-label="next note"
                                      >
                                        &gt;
                                      </button>
                                    ) : (
                                      <span
                                        className="dictionary-study-inline-arrow dictionary-study-inline-arrow-placeholder"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <div className="dictionary-study-word-groups">
                                {activeWordGroups.map((group) => (
                                  <div
                                    key={group.word.column.id}
                                    className="dictionary-study-word-group"
                                  >
                                    <div className="dictionary-study-word">
                                      {group.word.text}
                                    </div>
                                    {group.notes.length > 0 && (
                                      <div className="dictionary-study-word-group-notes">
                                        {group.notes.map((note) => (
                                          <div
                                            key={note.column.id}
                                            className="dictionary-study-note"
                                          >
                                            {note.text}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {dictionaryStudy.progressMode && currentAnswerResult && (
                              <div
                                className={`dictionary-study-answer-status dictionary-study-answer-status-${currentAnswerResult}`}
                              >
                                ответ:{" "}
                                {currentAnswerResult === "correct"
                                  ? "верно"
                                  : "неверно"}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {dictionaryStudy.motivationImageUrl && (
                    <div
                      key={dictionaryStudy.motivationImageKey}
                      className={`dictionary-study-motivation ${
                        dictionaryStudy.adhdMode
                          ? "dictionary-study-motivation-adhd"
                          : ""
                      } ${
                        dictionaryStudy.motivationPhase === "entering"
                          ? "dictionary-study-motivation-entering"
                          : ""
                      } ${
                        dictionaryStudy.motivationPhase === "exiting"
                          ? "dictionary-study-motivation-exit"
                          : ""
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="dictionary-study-motivation-image"
                        src={dictionaryStudy.motivationImageUrl}
                        alt="Мотивация"
                        loading="eager"
                        decoding="sync"
                        draggable={false}
                      />
                      {!dictionaryStudy.adhdMode &&
                        dictionaryStudy.motivationAdvanceMode === "manual" && (
                        <button
                          type="button"
                          className="mini-action dictionary-study-motivation-next"
                          onClick={continueDictionaryMotivation}
                        >
                          дальше
                        </button>
                      )}
                    </div>
                  )}

                  {dictionaryStudy.isProgressComplete ? (
                    <div className="dictionary-study-actions dictionary-study-complete-actions">
                      <button
                        type="button"
                        className="mini-action dictionary-study-reveal"
                        onClick={resetDictionaryStudyProgress}
                      >
                        пройти заново
                      </button>
                    </div>
                  ) : dictionaryStudy.progressMode ? (
                    <div className="dictionary-study-progress-action-stack">
                      <div className="dictionary-study-actions dictionary-study-progress-actions">
                        <button
                          type="button"
                          className="tool-button tool-blue dictionary-study-arrow"
                          onClick={() => moveDictionaryStudy(-1)}
                          disabled={!canMoveDictionaryPrevious}
                          aria-label="Предыдущая карточка"
                        >
                          &lt;
                        </button>
                        <button
                          type="button"
                          className={`mini-action dictionary-study-similar ${
                            canOpenSimilarDictionaryWords
                              ? "dictionary-study-similar-active"
                              : "dictionary-study-similar-empty"
                          }`}
                          onClick={() =>
                            void openDictionaryStudySimilar(currentEntryIdentity)
                          }
                          disabled={!canOpenSimilarDictionaryWords}
                          title={
                            canOpenSimilarDictionaryWords
                              ? currentSimilarGroups
                                  .map((group) => group.title)
                                  .join(", ")
                              : "Слово не состоит в группе"
                          }
                        >
                          похожее
                        </button>
                        <button
                          type="button"
                          className="tool-button tool-yellow dictionary-study-speak"
                          onClick={speakDictionaryStudyCurrentCard}
                          aria-label={`Озвучить ${activeSideLabel}`}
                          title={`Озвучить ${activeSideLabel}`}
                          disabled={Boolean(dictionaryStudy.motivationImageUrl)}
                        >
                          <SpeakerIcon />
                        </button>
                        <button
                          type="button"
                          className="mini-action dictionary-study-reveal"
                          onClick={toggleDictionaryStudySide}
                          disabled={!canToggleDictionarySide}
                        >
                          {hiddenSideLabel}
                        </button>
                        <button
                          type="button"
                          className="tool-button tool-green dictionary-study-arrow"
                          onClick={() => moveDictionaryStudy(1)}
                          disabled={!canMoveDictionaryNext}
                          aria-label="Следующая карточка"
                        >
                          &gt;
                        </button>
                      </div>
                      <div className="dictionary-study-grade-row">
                        <button
                          type="button"
                          className="tool-button tool-red dictionary-study-grade-wide"
                          onClick={() => void markDictionaryStudyAnswer(false)}
                          disabled={!canGradeDictionaryAnswer}
                          aria-label="Ответ неправильный"
                        >
                          × неверно
                        </button>
                        <button
                          type="button"
                          className="tool-button tool-green dictionary-study-grade-wide"
                          onClick={() => void markDictionaryStudyAnswer(true)}
                          disabled={!canGradeDictionaryAnswer}
                          aria-label="Ответ правильный"
                        >
                          ✓ верно
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="dictionary-study-actions">
                      <button
                        type="button"
                        className="tool-button tool-blue dictionary-study-arrow"
                        onClick={() => moveDictionaryStudy(-1)}
                        aria-label="Предыдущая карточка"
                      >
                        &lt;
                      </button>
                      <button
                        type="button"
                        className={`mini-action dictionary-study-similar ${
                          canOpenSimilarDictionaryWords
                            ? "dictionary-study-similar-active"
                            : "dictionary-study-similar-empty"
                        }`}
                        onClick={() =>
                          void openDictionaryStudySimilar(currentEntryIdentity)
                        }
                        disabled={!canOpenSimilarDictionaryWords}
                        title={
                          canOpenSimilarDictionaryWords
                            ? currentSimilarGroups.map((group) => group.title).join(", ")
                            : "Слово не состоит в группе"
                        }
                      >
                        похожее
                      </button>
                      <button
                        type="button"
                        className="tool-button tool-yellow dictionary-study-speak"
                        onClick={speakDictionaryStudyCurrentCard}
                        aria-label={`Озвучить ${activeSideLabel}`}
                        title={`Озвучить ${activeSideLabel}`}
                      >
                        <SpeakerIcon />
                      </button>
                      <button
                        type="button"
                        className="mini-action dictionary-study-reveal"
                        onClick={toggleDictionaryStudySide}
                        disabled={!canToggleDictionarySide}
                      >
                        {hiddenSideLabel}
                      </button>
                      <button
                        type="button"
                        className="tool-button tool-green dictionary-study-arrow"
                        onClick={() => moveDictionaryStudy(1)}
                        disabled={!canMoveDictionaryNext}
                        aria-label="Следующая карточка"
                      >
                        &gt;
                      </button>
                    </div>
                  )}
                  {dictionaryStudy.adhdMode &&
                    (!dictionaryStudy.isProgressComplete ||
                      Boolean(dictionaryStudy.motivationImageUrl)) && (
                      <div className="dictionary-study-doomscroll-row">
                        <button
                          type="button"
                          className="mini-action dictionary-study-doomscroll-button"
                          onClick={() => void handleDictionaryDoomscrollClick()}
                          aria-label="Пошаговый режим СДВГ"
                        >
                          клик
                        </button>
                      </div>
                    )}
                </div>
              </div>
            );
          })()}

        {dictionarySimilarPopup && (
          <DictionarySimilarPopup
            state={dictionarySimilarPopup}
            onClose={() => setDictionarySimilarPopup(null)}
            onOpenSource={handleDictionarySimilarOpenSource}
          />
        )}

        {dictionaryGroupEditor && (
          <DictionaryGroupEditorPopup
            group={dictionaryGroupEditor}
            authorizedFetch={authorizedFetch}
            onClose={closeDictionaryGroupEditor}
            onGroupUpdated={handleDictionaryGroupUpdated}
            onOpenSource={handleDictionaryGroupEditorOpenSource}
          />
        )}

        {showSearch && (
          <SiteSearchPopup
            visibleCategories={visibleCategories}
            visibleCategoriesById={visibleCategoriesById}
            messagesByCategory={messagesByCategory}
            onClose={() => setShowSearch(false)}
            onOpenResult={handleSearchOpenCategory}
            onOpenDictionarySearch={openDictionaryGlobalSearch}
          />
        )}

        {showDictionaryGlobalSearch && (
          <DictionaryGlobalSearchPopup
            activeProject={activeProject}
            currentCategory={currentCategory}
            onClose={() => setShowDictionaryGlobalSearch(false)}
            onOpenSiteSearch={() => {
              setShowDictionaryGlobalSearch(false);
              setShowSearch(true);
            }}
            onOpenSource={handleDictionaryGlobalSearchOpenSource}
          />
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

              {menuPanel === "main" ? (
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

                  <button
                    type="button"
                    className="menu-action px-4 py-3 text-left text-lg font-semibold"
                    onClick={() => openMenuPanel("friends")}
                  >
                    Друзья
                  </button>

                  <button
                    type="button"
                    className="menu-action px-4 py-3 text-left text-lg font-semibold"
                    onClick={() => openMenuPanel("motivation")}
                  >
                    Мотивационная панель
                  </button>

                  <button
                    type="button"
                    className="menu-action px-4 py-3 text-left text-lg font-semibold"
                    onClick={goToEntryMenu}
                  >
                    Главное меню
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
                    onClick={() => setMenuPanel("main")}
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

                  <div className="mt-auto flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      className="menu-action w-full px-4 py-3 text-left text-base font-semibold"
                      onClick={goToEntryMenu}
                      disabled={isAuthBusy}
                    >
                      Главное меню
                    </button>
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
              ) : menuPanel === "friends" ? (
                <div className="menu-scroll mt-4 flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
                  <button
                    type="button"
                    className="mini-action self-start"
                    onClick={() => setMenuPanel("main")}
                  >
                    &lt; назад
                  </button>

                  <section className="friends-panel">
                    <label className="settings-label">пригласить в друзья</label>
                    <div className="friend-action-row">
                      <input
                        value={friendRequestUserIdDraft}
                        onChange={(event) => setFriendRequestUserIdDraft(event.target.value)}
                        className="settings-input"
                        placeholder="user-id друга"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => void handleSendFriendRequest()}
                        disabled={isSavingFriendAction}
                      >
                        отправить
                      </button>
                    </div>
                  </section>

                  <section className="friends-panel">
                    <div className="friends-panel-head">
                      <span className="settings-label">список друзей</span>
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => void loadFriends()}
                        disabled={isSavingFriendAction}
                      >
                        обновить
                      </button>
                    </div>

                    {friends.length === 0 ? (
                      <p className="settings-hint">Друзей и приглашений пока нет.</p>
                    ) : (
                      <div className="friend-list">
                        {friends.map((friend) => {
                          const friendName =
                            friend.nickname ||
                            friend.friendUserId ||
                            friend.friendAppUserId;
                          const statusLabel =
                            friend.status === "accepted" ? "друг" : "приглашение отправлено";
                          const inboxOpen = selectedFriendInboxId === friend.friendAppUserId;
                          const inboxItems = inboxOpen
                            ? selectedFriendInboxItems
                            : friendInboxItems[friend.friendAppUserId] ?? [];

                          return (
                            <div key={friend.friendshipId} className="friend-item">
                              <div className="friend-item-main">
                                <div>
                                  <p className="friend-name">{friendName}</p>
                                  <p className="settings-hint break-all">
                                    {friend.friendUserId ?? friend.friendAppUserId}
                                  </p>
                                </div>
                                {friend.direction === "incoming" &&
                                friend.status === "pending" ? (
                                  <div className="friend-request-actions">
                                    <button
                                      type="button"
                                      className="mini-action"
                                      onClick={() => void handleAcceptFriendRequest(friend)}
                                      disabled={isSavingFriendAction}
                                    >
                                      принять
                                    </button>
                                    <button
                                      type="button"
                                      className="danger-action"
                                      onClick={() => void handleDeclineFriendRequest(friend)}
                                      disabled={isSavingFriendAction}
                                    >
                                      отклонить
                                    </button>
                                  </div>
                                ) : (
                                  <span className="friend-status">{statusLabel}</span>
                                )}
                              </div>

                              {friend.status === "accepted" && (
                                <>
                                  <button
                                    type="button"
                                    className="mini-action friend-inbox-button"
                                    onClick={() =>
                                      handleToggleFriendInbox(friend.friendAppUserId)
                                    }
                                    disabled={isSavingInboxAction}
                                  >
                                    inbox
                                    {friend.inboxPendingCount > 0
                                      ? ` (${friend.inboxPendingCount})`
                                      : ""}
                                  </button>

                                  {inboxOpen && (
                                    <div className="friend-inbox-list">
                                      {inboxItems.length === 0 ? (
                                        <p className="settings-hint">Inbox пуст.</p>
                                      ) : (
                                        inboxItems.map((item) => (
                                          <div key={item.id} className="friend-inbox-item">
                                            <div>
                                              <p className="friend-inbox-title">
                                                {item.title}
                                              </p>
                                              <p className="settings-hint">
                                                {item.type === "public_invite"
                                                  ? "public-приглашение"
                                                  : "копия категории"}
                                              </p>
                                            </div>

                                            {(item.type === "category_share" ||
                                              item.type === "public_invite") && (
                                              <div className="friend-inbox-placement">
                                              <select
                                                value={inboxImportTargetIds[item.id] ?? ""}
                                                className="settings-input"
                                                onChange={(event) =>
                                                  setInboxImportTargetIds((prev) => ({
                                                    ...prev,
                                                    [item.id]: event.target.value,
                                                  }))
                                                }
                                                disabled={
                                                  localCategoryOptions.length === 0 ||
                                                  isSavingInboxAction
                                                }
                                              >
                                                <option value="">куда добавить</option>
                                                {localCategoryOptions.map((option) => (
                                                  <option
                                                    key={`inbox-target-${item.id}-${option.id}`}
                                                    value={option.id}
                                                  >
                                                    {option.label}
                                                  </option>
                                                ))}
                                              </select>
                                                {item.type === "public_invite" && (
                                                  <p className="settings-hint">
                                                    Это общая public-категория, не копия.
                                                  </p>
                                                )}
                                              </div>
                                            )}

                                            <div className="friend-inbox-actions">
                                              <button
                                                type="button"
                                                className="mini-action"
                                                onClick={() => void handleAcceptInboxItem(item)}
                                                disabled={
                                                  isSavingInboxAction ||
                                                  ((item.type === "category_share" ||
                                                    item.type === "public_invite") &&
                                                    !inboxImportTargetIds[item.id])
                                                }
                                              >
                                                принять
                                              </button>
                                              <button
                                                type="button"
                                                className="danger-action"
                                                onClick={() => void handleDeclineInboxItem(item)}
                                                disabled={isSavingInboxAction}
                                              >
                                                отклонить
                                              </button>
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              ) : (
                <div className="menu-scroll mt-4 flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  <button
                    type="button"
                    className="mini-action self-start"
                    onClick={() => setMenuPanel("main")}
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

                  <div className="mt-auto flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      className="menu-action w-full px-4 py-3 text-left text-base font-semibold"
                      onClick={goToEntryMenu}
                      disabled={isAuthBusy}
                    >
                      Главное меню
                    </button>
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

        {accountWindowTab && (
          <div className="account-window-overlay absolute inset-0 z-[70]">
            <button
              type="button"
              className="account-window-backdrop"
              onClick={closeAccountWindow}
              aria-label="Закрыть окно аккаунта"
            />

            <section className="account-window popup-3d" aria-modal="true" role="dialog">
              <header className="account-window-head">
                <div>
                  <p className="account-window-kicker">профиль</p>
                  <h2 className="account-window-title font-display">
                    {accountWindowTab === "account"
                      ? "Аккаунт"
                      : accountWindowTab === "settings"
                        ? "Настройки"
                        : accountWindowTab === "friends"
                          ? "Друзья"
                          : "Мотивация"}
                  </h2>
                </div>
                <button
                  type="button"
                  className="menu-action h-9 w-9 text-xl"
                  onClick={closeAccountWindow}
                  aria-label="Закрыть окно аккаунта"
                >
                  x
                </button>
              </header>

              <nav className="account-window-tabs" aria-label="Разделы аккаунта">
                <button
                  type="button"
                  className={`mini-action account-window-tab ${
                    accountWindowTab === "account" ? "account-window-tab-active" : ""
                  }`}
                  onClick={() => openMenuPanel("account")}
                >
                  аккаунт
                </button>
                <button
                  type="button"
                  className={`mini-action account-window-tab ${
                    accountWindowTab === "settings" ? "account-window-tab-active" : ""
                  }`}
                  onClick={() => openMenuPanel("settings")}
                >
                  настройки
                </button>
                <button
                  type="button"
                  className={`mini-action account-window-tab ${
                    accountWindowTab === "friends" ? "account-window-tab-active" : ""
                  }`}
                  onClick={() => openMenuPanel("friends")}
                >
                  друзья
                </button>
                <button
                  type="button"
                  className={`mini-action account-window-tab ${
                    accountWindowTab === "motivation"
                      ? "account-window-tab-active"
                      : ""
                  }`}
                  onClick={() => openMenuPanel("motivation")}
                >
                  мотивация
                </button>
              </nav>

              <div className="account-window-body">
                {accountWindowTab === "account" && (
                  <div className="account-profile-grid">
                    <section className="account-profile-card">
                      <div className="account-avatar-shell account-window-avatar">
                        {accountAvatarPreviewUrl ? (
                          <div
                            className="account-avatar-image"
                            style={{
                              backgroundImage: `url(${accountAvatarPreviewUrl})`,
                            }}
                            aria-label="Аватар профиля"
                          />
                        ) : (
                          <span className="font-display text-6xl leading-none text-[#1f1f1f]">
                            {accountAvatarInitial}
                          </span>
                        )}
                      </div>
                      <div className="account-profile-actions">
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => accountAvatarFileRef.current?.click()}
                          disabled={isUploadingAccountAvatar || isDeletingAccountAvatar}
                        >
                          загрузить аватар
                        </button>
                        <button
                          type="button"
                          className="danger-action"
                          onClick={() => void handleDeleteAccountAvatar()}
                          disabled={
                            !accountAvatarUrl ||
                            isUploadingAccountAvatar ||
                            isDeletingAccountAvatar
                          }
                        >
                          удалить
                        </button>
                      </div>
                      <input
                        ref={accountAvatarFileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                        className="sr-only"
                        onChange={(event) => void handleAccountAvatarFileChange(event)}
                      />
                      <p className="settings-hint">
                        PNG, JPG, WebP, GIF или BMP. Максимум 5 МБ.
                      </p>
                    </section>

                    <section className="account-profile-form">
                      <label className="settings-label">Ник</label>
                      <input
                        value={accountNicknameDraft}
                        onChange={(event) =>
                          setAccountNicknameDraft(event.target.value)
                        }
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

                      <div className="account-window-actions">
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
                          onClick={() => openMenuPanel("settings")}
                        >
                          открыть настройки
                        </button>
                      </div>
                    </section>
                  </div>
                )}

                {accountWindowTab === "settings" && (
                  <div className="account-settings-grid">
                    <section className="account-window-section">
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
                          Следующая смена user-id:{" "}
                          {formatDateTime(accountNextUserIdChangeAt)}
                        </p>
                      )}
                    </section>

                    <section className="account-window-section">
                      <label className="settings-label">Смена пароля</label>
                      <input
                        type="password"
                        value={accountCurrentPasswordDraft}
                        onChange={(event) =>
                          setAccountCurrentPasswordDraft(event.target.value)
                        }
                        className="settings-input"
                        placeholder="Текущий пароль"
                        autoComplete="current-password"
                      />
                      <input
                        type="password"
                        value={accountNewPasswordDraft}
                        onChange={(event) =>
                          setAccountNewPasswordDraft(event.target.value)
                        }
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
                    </section>

                    <section className="account-window-section">
                      <label className="settings-label">migration-код</label>
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
                          Новый код: {issuedMigrationCode.code} (до{" "}
                          {formatDateTime(issuedMigrationCode.expiresAt)})
                        </p>
                      )}
                      {!issuedMigrationCode && activeMigrationCodeMeta && (
                        <p className="settings-hint break-all">
                          Активный код: {activeMigrationCodeMeta.codeHint} (до{" "}
                          {formatDateTime(activeMigrationCodeMeta.expiresAt)})
                        </p>
                      )}
                    </section>
                  </div>
                )}

                {accountWindowTab === "friends" && (
                  <div className="account-friends-layout">
                    <section className="friends-panel account-window-section">
                      <label className="settings-label">пригласить в друзья</label>
                      <div className="friend-action-row">
                        <input
                          value={friendRequestUserIdDraft}
                          onChange={(event) =>
                            setFriendRequestUserIdDraft(event.target.value)
                          }
                          className="settings-input"
                          placeholder="user-id друга"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => void handleSendFriendRequest()}
                          disabled={isSavingFriendAction}
                        >
                          отправить
                        </button>
                      </div>
                    </section>

                    <section className="friends-panel account-window-section">
                      <div className="friends-panel-head">
                        <span className="settings-label">список друзей</span>
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => void loadFriends()}
                          disabled={isSavingFriendAction}
                        >
                          обновить
                        </button>
                      </div>

                      {friends.length === 0 ? (
                        <p className="settings-hint">
                          Друзей и приглашений пока нет.
                        </p>
                      ) : (
                        <div className="friend-list">
                          {friends.map((friend) => {
                            const friendName =
                              friend.nickname ||
                              friend.friendUserId ||
                              friend.friendAppUserId;
                            const statusLabel =
                              friend.status === "accepted"
                                ? "друг"
                                : "приглашение отправлено";
                            const inboxOpen =
                              selectedFriendInboxId === friend.friendAppUserId;
                            const inboxItems = inboxOpen
                              ? selectedFriendInboxItems
                              : friendInboxItems[friend.friendAppUserId] ?? [];
                            const friendInitial =
                              friendName.trim().charAt(0).toUpperCase() || "U";

                            return (
                              <div key={friend.friendshipId} className="friend-item">
                                <div className="friend-item-main">
                                  <div className="friend-identity">
                                    <div className="friend-avatar">
                                      {friend.avatarUrl &&
                                      isDisplayImageUrl(friend.avatarUrl) ? (
                                        <span
                                          className="friend-avatar-image"
                                          style={{
                                            backgroundImage: `url(${friend.avatarUrl})`,
                                          }}
                                          aria-label="Аватар друга"
                                        />
                                      ) : (
                                        <span>{friendInitial}</span>
                                      )}
                                    </div>
                                    <div>
                                      <p className="friend-name">{friendName}</p>
                                      <p className="settings-hint break-all">
                                        {friend.friendUserId ?? friend.friendAppUserId}
                                      </p>
                                    </div>
                                  </div>
                                  {friend.direction === "incoming" &&
                                  friend.status === "pending" ? (
                                    <div className="friend-request-actions">
                                      <button
                                        type="button"
                                        className="mini-action"
                                        onClick={() =>
                                          void handleAcceptFriendRequest(friend)
                                        }
                                        disabled={isSavingFriendAction}
                                      >
                                        принять
                                      </button>
                                      <button
                                        type="button"
                                        className="danger-action"
                                        onClick={() =>
                                          void handleDeclineFriendRequest(friend)
                                        }
                                        disabled={isSavingFriendAction}
                                      >
                                        отклонить
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="friend-status">{statusLabel}</span>
                                  )}
                                </div>

                                {friend.status === "accepted" && (
                                  <>
                                    <button
                                      type="button"
                                      className="mini-action friend-inbox-button"
                                      onClick={() =>
                                        handleToggleFriendInbox(friend.friendAppUserId)
                                      }
                                      disabled={isSavingInboxAction}
                                    >
                                      inbox
                                      {friend.inboxPendingCount > 0
                                        ? ` (${friend.inboxPendingCount})`
                                        : ""}
                                    </button>

                                    {inboxOpen && (
                                      <div className="friend-inbox-list">
                                        {inboxItems.length === 0 ? (
                                          <p className="settings-hint">Inbox пуст.</p>
                                        ) : (
                                          inboxItems.map((item) => (
                                            <div
                                              key={item.id}
                                              className="friend-inbox-item"
                                            >
                                              <div>
                                                <p className="friend-inbox-title">
                                                  {item.title}
                                                </p>
                                                <p className="settings-hint">
                                                  {item.type === "public_invite"
                                                    ? "public-приглашение"
                                                    : "копия категории"}
                                                </p>
                                              </div>

                                              {(item.type === "category_share" ||
                                                item.type === "public_invite") && (
                                                <div className="friend-inbox-placement">
                                                  <select
                                                    value={
                                                      inboxImportTargetIds[item.id] ?? ""
                                                    }
                                                    className="settings-input"
                                                    onChange={(event) =>
                                                      setInboxImportTargetIds(
                                                        (prev) => ({
                                                          ...prev,
                                                          [item.id]:
                                                            event.target.value,
                                                        })
                                                      )
                                                    }
                                                    disabled={
                                                      localCategoryOptions.length ===
                                                        0 || isSavingInboxAction
                                                    }
                                                  >
                                                    <option value="">
                                                      куда добавить
                                                    </option>
                                                    {localCategoryOptions.map(
                                                      (option) => (
                                                        <option
                                                          key={`account-inbox-target-${item.id}-${option.id}`}
                                                          value={option.id}
                                                        >
                                                          {option.label}
                                                        </option>
                                                      )
                                                    )}
                                                  </select>
                                                  {item.type === "public_invite" && (
                                                    <p className="settings-hint">
                                                      Это общая public-категория, не
                                                      копия.
                                                    </p>
                                                  )}
                                                </div>
                                              )}

                                              <div className="friend-inbox-actions">
                                                <button
                                                  type="button"
                                                  className="mini-action"
                                                  onClick={() =>
                                                    void handleAcceptInboxItem(item)
                                                  }
                                                  disabled={
                                                    isSavingInboxAction ||
                                                    ((item.type === "category_share" ||
                                                      item.type ===
                                                        "public_invite") &&
                                                      !inboxImportTargetIds[item.id])
                                                  }
                                                >
                                                  принять
                                                </button>
                                                <button
                                                  type="button"
                                                  className="danger-action"
                                                  onClick={() =>
                                                    void handleDeclineInboxItem(item)
                                                  }
                                                  disabled={isSavingInboxAction}
                                                >
                                                  отклонить
                                                </button>
                                              </div>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {accountWindowTab === "motivation" && (
                  <div className="motivation-panel">
                    <div className="motivation-panel-head">
                      <div>
                        <p className="settings-label">Мотивационная панель</p>
                        <p className="settings-hint">
                          Эти фото будут появляться в #DICT, когда включена мотивация.
                        </p>
                      </div>
                      <div className="motivation-panel-actions">
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => motivationImageFileRef.current?.click()}
                          disabled={
                            isUploadingMotivationImage ||
                            motivationImages.length >= 24
                          }
                        >
                          загрузить фото
                        </button>
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => void loadMotivationImages()}
                          disabled={isLoadingMotivationImages}
                        >
                          обновить
                        </button>
                      </div>
                    </div>
                    <input
                      ref={motivationImageFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                      className="sr-only"
                      multiple
                      onChange={(event) =>
                        void handleMotivationImageFileChange(event)
                      }
                    />

                    {isLoadingMotivationImages ? (
                      <p className="settings-hint">Загружаем фото...</p>
                    ) : motivationImages.length === 0 ? (
                      <p className="settings-hint">
                        Пока нет фото. Загрузи то, что помогает вернуться к учебе.
                      </p>
                    ) : (
                      <div className="motivation-grid">
                        {motivationImages.map((image) => {
                          const deleting = deletingMotivationImageIds.includes(
                            image.id
                          );

                          return (
                            <article key={image.id} className="motivation-card">
                              <div
                                className="motivation-card-image"
                                style={{ backgroundImage: `url(${image.url})` }}
                              />
                              <div className="motivation-card-meta">
                                <span>{formatFileSize(image.sizeBytes)}</span>
                                <button
                                  type="button"
                                  className="danger-action"
                                  onClick={() =>
                                    void handleDeleteMotivationImage(image.id)
                                  }
                                  disabled={deleting}
                                >
                                  удалить
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <footer className="account-window-footer">
                <button
                  type="button"
                  className="menu-action px-4 py-3 text-left text-base font-semibold"
                  onClick={goToEntryMenu}
                  disabled={isAuthBusy}
                >
                  Главное меню
                </button>
                <button
                  type="button"
                  className="danger-action px-4 py-3 text-left text-base font-semibold"
                  onClick={() => void handleAuthSignOut()}
                  disabled={isAuthBusy}
                >
                  Выйти
                </button>
              </footer>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

type ScheduleCardProps = {
  title: string;
  payload: SchedulePayload;
  sourceRef: ScheduleSourceRef;
  canEdit: boolean;
  style?: CSSProperties;
  onViewModeChange: (ref: ScheduleSourceRef, viewMode: ScheduleViewMode) => void;
  onDateChange: (ref: ScheduleSourceRef, date: string) => void;
  onOpenEvent: (ref: ScheduleSourceRef, eventId?: string | null) => void;
  onOpenAssistant: (ref: ScheduleSourceRef) => void;
  onOpenSpontaneous: (ref: ScheduleSourceRef) => void;
  onOpenGoals: (ref: ScheduleSourceRef) => void;
  onStatusChange: (
    ref: ScheduleSourceRef,
    eventId: string,
    status: ScheduleStatus
  ) => void;
  onDeleteEvent: (ref: ScheduleSourceRef, eventId: string) => void;
  onDeleteBlock: (ref: ScheduleSourceRef) => void;
};

const SCHEDULE_EVENT_TYPE_LABELS: Record<ScheduleEventType, string> = {
  fixed: "фикс.",
  flexible: "гибкое",
  habit: "норма",
  spontaneous: "спонтанно",
};

const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  planned: "план",
  done: "готово",
  skipped: "пропуск",
};

function ScheduleCard({
  title,
  payload,
  sourceRef,
  canEdit,
  style,
  onViewModeChange,
  onDateChange,
  onOpenEvent,
  onOpenAssistant,
  onOpenSpontaneous,
  onOpenGoals,
  onStatusChange,
  onDeleteEvent,
  onDeleteBlock,
}: ScheduleCardProps) {
  const normalized = normalizeSchedulePayload(payload);
  const weekDates = getScheduleWeekDates(normalized.selectedDate);
  const activeDates =
    normalized.viewMode === "week" ? weekDates : [normalized.selectedDate];
  const summary = getScheduleSummary(normalized, activeDates);
  const goalProgress = getScheduleGoalProgress(normalized, normalized.selectedDate);
  const dayEvents = getScheduleDayEvents(normalized, normalized.selectedDate);
  const listEvents = getScheduleListEvents(normalized);
  const freeWindows = getScheduleFreeWindows(normalized, normalized.selectedDate)
    .filter((window) => window.durationMinutes >= 15)
    .slice(0, 3);

  const renderEvent = (event: ScheduleEvent) => (
    <div key={event.id} className={`schedule-event schedule-event-${event.type}`}>
      <div className="schedule-event-main">
        <div className="schedule-event-line">
          <span className="schedule-event-time">{formatScheduleTimeRange(event)}</span>
          <span className="schedule-event-title">{event.title}</span>
        </div>
        <div className="schedule-event-meta">
          <span>{SCHEDULE_EVENT_TYPE_LABELS[event.type]}</span>
          <span>{SCHEDULE_STATUS_LABELS[event.status]}</span>
          {event.priority && <span>{toSchedulePriorityLabel(event.priority)}</span>}
          {event.category && <span>{event.category}</span>}
          {event.canMove === false && <span>не двигать</span>}
          {event.canSplit && <span>делить</span>}
        </div>
        {event.description && (
          <p className="schedule-event-description">{event.description}</p>
        )}
      </div>

      <div className="schedule-event-actions">
        <select
          value={event.status}
          className="settings-input schedule-status-select"
          onChange={(changeEvent) =>
            onStatusChange(
              sourceRef,
              event.id,
              changeEvent.target.value as ScheduleStatus
            )
          }
          disabled={!canEdit}
          aria-label={`Статус ${event.title}`}
        >
          <option value="planned">план</option>
          <option value="done">готово</option>
          <option value="skipped">пропуск</option>
        </select>
        <button
          type="button"
          className="mini-action"
          onClick={() => onOpenEvent(sourceRef, event.id)}
          disabled={!canEdit}
        >
          править
        </button>
        <button
          type="button"
          className="danger-action schedule-small-danger"
          onClick={() => onDeleteEvent(sourceRef, event.id)}
          disabled={!canEdit}
        >
          -
        </button>
      </div>
    </div>
  );

  return (
    <article className="schedule-card" style={style}>
      <header className="schedule-card-head">
        <div className="min-w-0">
          <p className="schedule-card-kicker">schedule</p>
          <h3 className="schedule-card-title">{title}</h3>
        </div>
        <button
          type="button"
          className="danger-action schedule-card-delete"
          onClick={() => onDeleteBlock(sourceRef)}
          disabled={!canEdit}
        >
          удалить
        </button>
      </header>

      <div className="schedule-toolbar">
        <div className="schedule-tabs" role="tablist" aria-label="Режим расписания">
          {(["day", "week", "list"] as ScheduleViewMode[]).map((viewMode) => (
            <button
              key={viewMode}
              type="button"
              className={`mini-action schedule-tab ${
                normalized.viewMode === viewMode ? "schedule-tab-active" : ""
              }`}
              onClick={() => onViewModeChange(sourceRef, viewMode)}
              disabled={!canEdit}
            >
              {viewMode === "day" ? "День" : viewMode === "week" ? "Неделя" : "Список"}
            </button>
          ))}
        </div>

        <input
          type="date"
          value={normalized.selectedDate}
          className="settings-input schedule-date-input"
          onChange={(event) => onDateChange(sourceRef, event.target.value)}
          disabled={!canEdit}
          aria-label="Дата расписания"
        />

        <button
          type="button"
          className="mini-action"
          onClick={() => onOpenEvent(sourceRef, null)}
          disabled={!canEdit}
        >
          + дело
        </button>
        <button
          type="button"
          className="mini-action"
          onClick={() => onOpenAssistant(sourceRef)}
          disabled={!canEdit}
        >
          помощник
        </button>
        <button
          type="button"
          className="mini-action"
          onClick={() => onOpenSpontaneous(sourceRef)}
          disabled={!canEdit}
        >
          спонтанное
        </button>
        <button
          type="button"
          className="mini-action"
          onClick={() => onOpenGoals(sourceRef)}
          disabled={!canEdit}
        >
          нормы
        </button>
      </div>

      <div className="schedule-summary">
        <span>дел: {summary.eventCount}</span>
        <span>план: {formatScheduleMinutes(summary.plannedMinutes)}</span>
        <span>готово: {formatScheduleMinutes(summary.doneMinutes)}</span>
        <span>свободно: {formatScheduleMinutes(summary.freeMinutes)}</span>
      </div>

      {goalProgress.length > 0 && (
        <div className="schedule-goals-strip">
          {goalProgress.slice(0, 4).map((goal) => (
            <span key={goal.id}>
              {goal.title}:{" "}
              {goal.targetCount
                ? `${goal.currentCount}/${goal.targetCount}`
                : `${formatScheduleMinutes(goal.currentMinutes)} / ${formatScheduleMinutes(
                    goal.targetMinutes ?? 0
                  )}`}
            </span>
          ))}
        </div>
      )}

      {normalized.viewMode === "day" && (
        <div className="schedule-body">
          {freeWindows.length > 0 && (
            <div className="schedule-free-row">
              {freeWindows.map((window) => (
                <span key={`${window.date}-${window.start}-${window.end}`}>
                  окно {window.start}-{window.end}
                </span>
              ))}
            </div>
          )}
          {dayEvents.length === 0 ? (
            <p className="schedule-empty">
              Пока расписание пустое. Добавьте дело вручную или воспользуйтесь помощником.
            </p>
          ) : (
            <div className="schedule-event-list">{dayEvents.map(renderEvent)}</div>
          )}
        </div>
      )}

      {normalized.viewMode === "week" && (
        <div className="schedule-week-grid">
          {weekDates.map((date) => {
            const events = getScheduleDayEvents(normalized, date);
            const daySummary = getScheduleSummary(normalized, [date]);
            return (
              <button
                key={date}
                type="button"
                className={`schedule-week-day ${
                  date === normalized.selectedDate ? "schedule-week-day-active" : ""
                }`}
                onClick={() => onDateChange(sourceRef, date)}
                disabled={!canEdit}
              >
                <span>{formatScheduleDateShort(date)}</span>
                <strong>{events.length} дел</strong>
                <small>{formatScheduleMinutes(daySummary.plannedMinutes)}</small>
              </button>
            );
          })}
        </div>
      )}

      {normalized.viewMode === "list" && (
        <div className="schedule-body">
          {listEvents.length === 0 ? (
            <p className="schedule-empty">
              Пока расписание пустое. Добавьте дело вручную или воспользуйтесь помощником.
            </p>
          ) : (
            <div className="schedule-event-list">{listEvents.map(renderEvent)}</div>
          )}
        </div>
      )}
    </article>
  );
}

function toSchedulePriorityLabel(priority: SchedulePriority): string {
  if (priority === "high") {
    return "важно";
  }
  if (priority === "low") {
    return "низко";
  }
  return "средне";
}

function renderSchedulePreviewChange(change: SchedulePreviewChange) {
  if (change.kind === "add") {
    return (
      <>
        <strong>
          добавить: {change.event.title}{" "}
          {change.event.date ? formatScheduleDateShort(change.event.date) : ""}{" "}
          {formatScheduleTimeRange(change.event)}
        </strong>
        <p>{change.reason}</p>
      </>
    );
  }

  if (change.kind === "move") {
    return (
      <>
        <strong>
          перенести: {change.title} с {change.fromDate ?? "-"}{" "}
          {change.fromStart ?? ""}-{change.fromEnd ?? ""} на{" "}
          {formatScheduleDateShort(change.toDate)} {change.toStart}-{change.toEnd}
        </strong>
        <p>{change.reason}</p>
      </>
    );
  }

  return (
    <>
      <strong>{change.title}</strong>
      <p>{change.reason}</p>
    </>
  );
}

function schedulePayloadToPlainText(payload: SchedulePayload, title = "Расписание"): string {
  const normalized = normalizeSchedulePayload(payload);
  const eventText = normalized.events
    .map((event) =>
      [
        event.title,
        event.description,
        event.date,
        event.start,
        event.end,
        event.category,
        event.type,
        event.status,
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join("\n");
  const goalText = normalized.goals
    .map((goal) =>
      [
        goal.title,
        goal.category,
        goal.period,
        goal.targetCount ? `${goal.targetCount} раз` : "",
        goal.targetMinutes ? `${goal.targetMinutes} минут` : "",
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join("\n");

  return [title, eventText, goalText].filter(Boolean).join("\n");
}

type SiteSearchPlainTextCacheEntry = {
  signature: string;
  value: string;
};

const siteSearchCategoryPlainContentCache = new Map<
  string,
  SiteSearchPlainTextCacheEntry
>();
const siteSearchMessagePlainContentCache = new Map<
  string,
  SiteSearchPlainTextCacheEntry
>();

function getSiteSearchCategoryPlainContent(category: CategoryRow): string {
  const signature = `${category.format}\n${category.updated_at}\n${category.content}`;
  const cached = siteSearchCategoryPlainContentCache.get(category.id);
  if (cached?.signature === signature) {
    return cached.value;
  }

  const value =
    category.format === "continuous"
      ? (() => {
          const document = parseContinuousContent(category.content);
          const dictionaryText = document.dictionaries
            .map((dictionary) =>
              `${dictionary.title}\n${dictionaryPayloadToPlainText(dictionary)}`
            )
            .join("\n");
          const scheduleText = document.schedules
            .map((schedule) => schedulePayloadToPlainText(schedule, schedule.title))
            .join("\n");
          return `${richTextToPlainText(document.text)}\n${dictionaryText}\n${scheduleText}`.trim();
        })()
      : richTextToPlainText(category.content);

  siteSearchCategoryPlainContentCache.set(category.id, { signature, value });
  return value;
}

function getSiteSearchMessagePlainContent(message: MessageRow): string {
  const signature = `${message.updated_at}\n${message.content}`;
  const cached = siteSearchMessagePlainContentCache.get(message.id);
  if (cached?.signature === signature) {
    return cached.value;
  }

  const checklistPayload = parseMessageChecklistContent(message.content);
  const dictionaryPayload = parseMessageDictionaryContent(message.content);
  const schedulePayload = parseMessageScheduleContent(message.content);
  const value = checklistPayload
    ? ""
    : dictionaryPayload
      ? dictionaryPayloadToPlainText(dictionaryPayload)
      : schedulePayload
        ? schedulePayloadToPlainText(schedulePayload, message.title)
      : richTextToPlainText(message.content);

  siteSearchMessagePlainContentCache.set(message.id, { signature, value });
  return value;
}

function SiteSearchPopup({
  visibleCategories,
  visibleCategoriesById,
  messagesByCategory,
  onClose,
  onOpenResult,
  onOpenDictionarySearch,
}: {
  visibleCategories: CategoryRow[];
  visibleCategoriesById: Map<string, CategoryRow>;
  messagesByCategory: Record<string, MessageRow[]>;
  onClose: () => void;
  onOpenResult: (result: SearchResult) => void;
  onOpenDictionarySearch: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!normalizedSearchQuery) {
      return [] as SearchResult[];
    }

    const resultLimit = 45;
    const results: SearchResult[] = [];

    for (const category of visibleCategories) {
      const plainContent = getSiteSearchCategoryPlainContent(category);
      const text =
        `${category.title} ${category.description} ${category.tag} ${plainContent}`.toLowerCase();
      if (!text.includes(normalizedSearchQuery)) {
        continue;
      }

      results.push({
        id: `category-${category.id}`,
        kind: "category",
        categoryId: category.id,
        title: category.title,
        path: buildCategoryPath(visibleCategories, category.id)
          .map((part) => part.title)
          .join(" / "),
        preview: makePreview(
          `${category.description || plainContent || category.tag}`,
          normalizedSearchQuery
        ),
      });

      if (results.length >= resultLimit) {
        return results;
      }
    }

    messageSearch: for (const messages of Object.values(messagesByCategory)) {
      for (const message of messages) {
        if (!visibleCategoriesById.has(message.category_id)) {
          continue;
        }

        const plainContent = getSiteSearchMessagePlainContent(message);
        const messageText = `${message.title} ${plainContent}`.toLowerCase();
        if (!messageText.includes(normalizedSearchQuery)) {
          continue;
        }

        const titleFromMessage = message.title || "Новый блок";

        results.push({
          id: `message-${message.id}`,
          kind: "message",
          categoryId: message.category_id,
          messageId: message.id,
          title: titleFromMessage,
          path: `${buildCategoryPath(visibleCategories, message.category_id)
            .map((part) => part.title)
            .join(" / ")} / сообщение`,
          preview: makePreview(plainContent, normalizedSearchQuery),
        });

        if (results.length >= resultLimit) {
          break messageSearch;
        }
      }
    }

    return results;
  }, [
    messagesByCategory,
    normalizedSearchQuery,
    visibleCategories,
    visibleCategoriesById,
  ]);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 p-3">
      <div className="search-modal popup-3d w-full max-w-3xl p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-4xl leading-none">Search</h2>
          <button
            type="button"
            className="menu-action h-9 w-9 text-xl"
            onClick={onClose}
            aria-label="Закрыть поиск"
          >
            x
          </button>
        </div>

        <div className="search-tabs" role="tablist" aria-label="Режим поиска">
          <button
            type="button"
            role="tab"
            className="mini-action search-tab search-tab-active"
            aria-selected="true"
          >
            по сайту
          </button>
          <button
            type="button"
            role="tab"
            className="mini-action search-tab"
            onClick={onOpenDictionarySearch}
          >
            по dict
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
              onClick={() => onOpenResult(result)}
            >
              <p className="font-display text-3xl leading-none">{result.title}</p>
              <p className="mt-1 text-xs text-[#2f2f2f]">{result.path}</p>
              <p className="mt-1 text-sm text-[#232323]">{result.preview}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DictionaryGlobalSearchPopup({
  activeProject,
  currentCategory,
  onClose,
  onOpenSiteSearch,
  onOpenSource,
}: {
  activeProject: ProjectRow | null;
  currentCategory: CategoryRow | null;
  onClose: () => void;
  onOpenSiteSearch: () => void;
  onOpenSource: (result: GlobalDictionarySearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [scope, setScope] = useState<DictionaryGlobalSearchScope>("workspace");
  const [includeContinuous, setIncludeContinuous] = useState(true);
  const [includeBlock, setIncludeBlock] = useState(true);
  const [results, setResults] = useState<GlobalDictionarySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestDictionarySearchRequestKeyRef = useRef("");
  const trimmedQuery = deferredQuery.trim();
  const compiledDictionaryQuery = useMemo(
    () => compileDictionarySearchQuery(trimmedQuery),
    [trimmedQuery]
  );
  const canSearchDictionaryQuery = Boolean(compiledDictionaryQuery);
  const effectiveScope: DictionaryGlobalSearchScope =
    scope === "project" && !activeProject
      ? "workspace"
      : scope === "category" && !currentCategory
        ? "workspace"
        : scope;

  useEffect(() => {
    if (!trimmedQuery || !canSearchDictionaryQuery) {
      return;
    }

    const controller = new AbortController();
    const requestKey = [
      trimmedQuery,
      effectiveScope,
      includeContinuous,
      includeBlock,
      activeProject?.id ?? "",
      currentCategory?.id ?? "",
    ].join("\0");
    latestDictionarySearchRequestKeyRef.current = requestKey;

    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        q: trimmedQuery,
        scope: effectiveScope,
        includeContinuous: String(includeContinuous),
        includeBlock: String(includeBlock),
      });

      if (activeProject) {
        params.set("projectId", activeProject.id);
      }
      if (currentCategory) {
        params.set("categoryId", currentCategory.id);
      }

      setIsLoading(true);
      setError(null);

      void fetch(`/api/dictionaries/search?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as DictionarySearchPayload;
          if (!response.ok || !payload.data) {
            throw new Error(payload.error ?? "Не удалось выполнить поиск.");
          }
          if (latestDictionarySearchRequestKeyRef.current !== requestKey) {
            return;
          }

          setResults(payload.data);
        })
        .catch((fetchError) => {
          if (
            controller.signal.aborted ||
            latestDictionarySearchRequestKeyRef.current !== requestKey
          ) {
            return;
          }

          setResults([]);
          setError(toErrorMessage(fetchError, "Не удалось выполнить поиск."));
        })
        .finally(() => {
          if (
            !controller.signal.aborted &&
            latestDictionarySearchRequestKeyRef.current === requestKey
          ) {
            setIsLoading(false);
          }
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeProject,
    currentCategory,
    includeBlock,
    includeContinuous,
    effectiveScope,
    canSearchDictionaryQuery,
    trimmedQuery,
  ]);

  function updateQuery(nextQuery: string) {
    latestDictionarySearchRequestKeyRef.current = "";
    setQuery(nextQuery);
    setResults([]);
    setError(null);
    setIsLoading(Boolean(compileDictionarySearchQuery(nextQuery.trim())));
  }

  function resetDictionaryGlobalSearchResults() {
    latestDictionarySearchRequestKeyRef.current = "";
    setResults([]);
    setError(null);
    setIsLoading(canSearchDictionaryQuery);
  }

  function updateScope(nextScope: DictionaryGlobalSearchScope) {
    if (scope === nextScope) {
      return;
    }

    setScope(nextScope);
    resetDictionaryGlobalSearchResults();
  }

  function toggleContinuous(nextChecked: boolean) {
    if (!nextChecked && !includeBlock) {
      return;
    }

    setIncludeContinuous(nextChecked);
    resetDictionaryGlobalSearchResults();
  }

  function toggleBlock(nextChecked: boolean) {
    if (!nextChecked && !includeContinuous) {
      return;
    }

    setIncludeBlock(nextChecked);
    resetDictionaryGlobalSearchResults();
  }

  const statusText = !query.trim()
    ? "Введи слово или точную фразу."
    : !canSearchDictionaryQuery
      ? "Минимум 2 буквы для поиска."
      : isLoading
        ? "Ищу..."
        : error
          ? error
          : results.length === 0
            ? "Ничего не найдено."
            : `${results.length} совпадений${results.some((result) => result.hasFuzzyMatch) ? " · опечатка" : ""}`;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-3">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        aria-label="Закрыть поиск по #DICT"
      />

      <div className="project-create-modal dictionary-global-search-modal popup-3d relative z-10 w-full max-w-6xl p-4 sm:p-5">
        <div className="dictionary-editor-header mb-3 flex justify-between gap-3">
          <div className="dictionary-editor-title-wrap">
            <h2 className="font-display text-4xl leading-none">Search</h2>
            <span className="dictionary-editor-title-badge">по dict</span>
          </div>
          <button
            type="button"
            className="menu-action h-9 w-9 text-xl"
            onClick={onClose}
            aria-label="Закрыть поиск по #DICT"
          >
            x
          </button>
        </div>

        <div className="search-tabs" role="tablist" aria-label="Режим поиска">
          <button
            type="button"
            role="tab"
            className="mini-action search-tab"
            onClick={onOpenSiteSearch}
          >
            по сайту
          </button>
          <button
            type="button"
            role="tab"
            className="mini-action search-tab search-tab-active"
            aria-selected="true"
          >
            по dict
          </button>
        </div>

        <div className="dictionary-global-search-settings">
          <label className="dictionary-global-search-field">
            <span className="settings-label">слово</span>
            <input
              autoFocus
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              className="settings-input"
              placeholder="слово или точная фраза..."
            />
          </label>

          <div className="dictionary-global-search-source-settings">
            <span className="settings-label">откуда брать слова</span>
            <div className="dictionary-global-search-scope-row">
              <button
                type="button"
                className={`mini-action search-tab ${
                  effectiveScope === "workspace" ? "search-tab-active" : ""
                }`}
                onClick={() => updateScope("workspace")}
              >
                весь workspace
              </button>
              <button
                type="button"
                className={`mini-action search-tab ${
                  effectiveScope === "project" ? "search-tab-active" : ""
                }`}
                onClick={() => updateScope("project")}
                disabled={!activeProject}
                title={activeProject ? activeProject.title : "Нет активного проекта"}
              >
                текущий проект
              </button>
              <button
                type="button"
                className={`mini-action search-tab ${
                  effectiveScope === "category" ? "search-tab-active" : ""
                }`}
                onClick={() => updateScope("category")}
                disabled={!currentCategory}
                title={currentCategory ? currentCategory.title : "Категория не выбрана"}
              >
                текущая категория
              </button>
            </div>
            <div className="dictionary-global-search-type-row">
              <label className="dictionary-editor-toggle">
                <input
                  type="checkbox"
                  checked={includeContinuous}
                  onChange={(event) => toggleContinuous(event.target.checked)}
                />
                <span>continuous #DICT</span>
              </label>
              <label className="dictionary-editor-toggle">
                <input
                  type="checkbox"
                  checked={includeBlock}
                  onChange={(event) => toggleBlock(event.target.checked)}
                />
                <span>block #DICT</span>
              </label>
            </div>
          </div>
        </div>

        <p
          className={`dictionary-global-search-status ${
            error ? "dictionary-global-search-status-error" : ""
          }`}
          aria-live="polite"
        >
          {statusText}
        </p>

        <div className="dictionary-global-search-table-wrap">
          <table className="dictionary-editor-table dictionary-global-search-table">
            <thead>
              <tr>
                <th>{DEFAULT_DICTIONARY_FIELD_LABELS.side1}</th>
                <th>{DEFAULT_DICTIONARY_FIELD_LABELS.side2}</th>
                <th>Источник</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr
                  key={result.id}
                  className={
                    result.hasFuzzyMatch ? "dictionary-editor-row-match" : undefined
                  }
                >
                  {renderDictionaryGlobalSearchSideCell(result, "side1")}
                  {renderDictionaryGlobalSearchSideCell(result, "side2")}
                  <td data-label="Источник">
                    <button
                      type="button"
                      className="mini-action dictionary-global-search-source"
                      onClick={() => onOpenSource(result)}
                    >
                      <span>{result.dictionaryTitle}</span>
                      <small>
                        {result.categoryPath}
                        {result.sourceMessageId ? " / сообщение" : ""}
                      </small>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function renderDictionaryGlobalSearchSideCell(
  result: GlobalDictionarySearchResult,
  side: DictionaryPromptSide
) {
  return renderDictionaryResultSideCell(result, side, result.matchedFields);
}

function DictionaryGroupEditorPopup({
  group,
  authorizedFetch,
  onClose,
  onGroupUpdated,
  onOpenSource,
}: {
  group: DictionaryWordGroup;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onGroupUpdated: (group: DictionaryWordGroup) => void;
  onOpenSource: (result: DictionaryGroupResolvedResult) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(group.title);
  const [descriptionDraft, setDescriptionDraft] = useState(group.description);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();
  const [results, setResults] = useState<GlobalDictionarySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestKeyRef = useRef("");
  const compiledDictionaryQuery = useMemo(
    () => compileDictionarySearchQuery(trimmedQuery),
    [trimmedQuery]
  );
  const existingIdentityKeys = useMemo(
    () =>
      new Set(
        group.items.map((item) =>
          dictionaryEntryIdentityKey({
            sourceCategoryId: item.sourceCategoryId,
            sourceMessageId: item.sourceMessageId,
            dictionaryId: item.dictionaryId,
            entryId: item.entryId,
          })
        )
      ),
    [group.items]
  );

  useEffect(() => {
    setTitleDraft(group.title);
    setDescriptionDraft(group.description);
  }, [group.description, group.id, group.title]);

  useEffect(() => {
    if (!trimmedQuery || !compiledDictionaryQuery) {
      return;
    }

    const controller = new AbortController();
    const requestKey = trimmedQuery;
    latestRequestKeyRef.current = requestKey;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        q: trimmedQuery,
        scope: "workspace",
        includeContinuous: "true",
        includeBlock: "true",
      });

      setIsLoading(true);
      setError(null);
      void fetch(`/api/dictionaries/search?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as DictionarySearchPayload;
          if (!response.ok || !payload.data) {
            throw new Error(payload.error ?? "Не удалось выполнить поиск.");
          }
          if (latestRequestKeyRef.current !== requestKey) {
            return;
          }
          setResults(payload.data);
        })
        .catch((fetchError) => {
          if (controller.signal.aborted || latestRequestKeyRef.current !== requestKey) {
            return;
          }
          setResults([]);
          setError(toErrorMessage(fetchError, "Не удалось выполнить поиск."));
        })
        .finally(() => {
          if (
            !controller.signal.aborted &&
            latestRequestKeyRef.current === requestKey
          ) {
            setIsLoading(false);
          }
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [compiledDictionaryQuery, trimmedQuery]);

  function updateQuery(nextQuery: string) {
    latestRequestKeyRef.current = "";
    setQuery(nextQuery);
    setResults([]);
    setError(null);
    setIsLoading(Boolean(compileDictionarySearchQuery(nextQuery.trim())));
  }

  async function saveGroup() {
    const title = titleDraft.trim();
    if (!title) {
      setError("Название группы не может быть пустым.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const response = await authorizedFetch(`/api/dictionary-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: descriptionDraft,
        }),
      });
      const payload = (await response.json()) as DictionaryGroupPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось сохранить группу.");
      }

      onGroupUpdated(payload.data);
    } catch (saveError) {
      setError(toErrorMessage(saveError, "Не удалось сохранить группу."));
    } finally {
      setIsSaving(false);
    }
  }

  async function addResult(result: GlobalDictionarySearchResult) {
    setIsSaving(true);
    setError(null);
    try {
      const response = await authorizedFetch(`/api/dictionary-groups/${group.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCategoryId: result.sourceCategoryId,
          sourceMessageId: result.sourceMessageId,
          dictionaryId: result.dictionaryId,
          entryId: result.entry.id,
        }),
      });
      const payload = (await response.json()) as DictionaryGroupPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось добавить запись.");
      }

      onGroupUpdated(payload.data);
    } catch (addError) {
      setError(toErrorMessage(addError, "Не удалось добавить запись."));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeItem(itemId: string) {
    setIsSaving(true);
    setError(null);
    try {
      const response = await authorizedFetch(
        `/api/dictionary-groups/${group.id}/items/${itemId}`,
        {
          method: "DELETE",
        }
      );
      const payload = (await response.json()) as DictionaryGroupPayload;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Не удалось удалить запись.");
      }

      onGroupUpdated(payload.data);
    } catch (removeError) {
      setError(toErrorMessage(removeError, "Не удалось удалить запись."));
    } finally {
      setIsSaving(false);
    }
  }

  const statusText = !query.trim()
    ? "Найди слово в #DICT и добавь его в группу."
    : !compiledDictionaryQuery
      ? "Минимум 2 буквы для поиска."
      : isLoading
        ? "Ищу..."
        : error
          ? error
          : results.length === 0
            ? "Ничего не найдено."
            : `${results.length} совпадений`;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-3">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        aria-label="Закрыть группу словарей"
      />

      <div className="project-create-modal dictionary-group-modal popup-3d relative z-10 w-full max-w-6xl p-4 sm:p-5">
        <div className="dictionary-editor-header mb-3 flex justify-between gap-3">
          <div className="dictionary-editor-title-wrap">
            <h2 className="font-display text-4xl leading-none">Группа словарей</h2>
            <span className="dictionary-editor-title-badge">
              {group.items.length} слов
            </span>
          </div>
          <button
            type="button"
            className="menu-action h-9 w-9 text-xl"
            onClick={onClose}
            aria-label="Закрыть группу словарей"
          >
            x
          </button>
        </div>

        <div className="dictionary-group-settings">
          <label className="dictionary-editor-field">
            <span className="settings-label">название</span>
            <input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              className="settings-input"
            />
          </label>
          <label className="dictionary-editor-field">
            <span className="settings-label">описание</span>
            <input
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              className="settings-input"
            />
          </label>
          <button
            type="button"
            className="mini-action dictionary-group-save"
            onClick={() => void saveGroup()}
            disabled={isSaving}
          >
            сохранить
          </button>
        </div>

        <div className="dictionary-group-body">
          <section className="dictionary-group-section">
            <div className="dictionary-group-section-head">
              <span className="settings-label">в группе</span>
            </div>
            <div className="dictionary-global-search-table-wrap dictionary-group-table-wrap">
              <table className="dictionary-editor-table dictionary-global-search-table dictionary-group-table">
                <thead>
                  <tr>
                    <th>{DEFAULT_DICTIONARY_FIELD_LABELS.side1}</th>
                    <th>{DEFAULT_DICTIONARY_FIELD_LABELS.side2}</th>
                    <th>Источник</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => {
                    const result = item.resolvedResult;
                    return (
                      <tr
                        key={item.id}
                        className={!result.sourceExists ? "dictionary-group-stale-row" : undefined}
                      >
                        {renderDictionaryGroupResultSideCell(result, "side1")}
                        {renderDictionaryGroupResultSideCell(result, "side2")}
                        <td data-label="Источник">
                          <button
                            type="button"
                            className="mini-action dictionary-global-search-source"
                            onClick={() => onOpenSource(result)}
                            disabled={!result.sourceExists}
                          >
                            <span>{result.dictionaryTitle}</span>
                            <small>
                              {result.sourceExists
                                ? result.categoryPath
                                : "источник не найден"}
                            </small>
                          </button>
                        </td>
                        <td data-label="">
                          <button
                            type="button"
                            className="mini-action danger-action dictionary-group-remove"
                            onClick={() => void removeItem(item.id)}
                            disabled={isSaving}
                          >
                            удалить
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {group.items.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="dictionary-group-empty-table">
                          Добавь слова через поиск ниже.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="dictionary-group-section">
            <div className="dictionary-global-search-settings dictionary-group-search-settings">
              <label className="dictionary-global-search-field">
                <span className="settings-label">поиск #DICT</span>
                <input
                  value={query}
                  onChange={(event) => updateQuery(event.target.value)}
                  className="settings-input"
                  placeholder="слово или точная фраза..."
                />
              </label>
            </div>
            <p
              className={`dictionary-global-search-status ${
                error ? "dictionary-global-search-status-error" : ""
              }`}
              aria-live="polite"
            >
              {statusText}
            </p>
            <div className="dictionary-global-search-table-wrap dictionary-group-table-wrap">
              <table className="dictionary-editor-table dictionary-global-search-table dictionary-group-table">
                <thead>
                  <tr>
                    <th>{DEFAULT_DICTIONARY_FIELD_LABELS.side1}</th>
                    <th>{DEFAULT_DICTIONARY_FIELD_LABELS.side2}</th>
                    <th>Источник</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => {
                    const identity = getDictionarySearchResultIdentity(result);
                    const exists = existingIdentityKeys.has(
                      dictionaryEntryIdentityKey(identity)
                    );

                    return (
                      <tr
                        key={result.id}
                        className={
                          result.hasFuzzyMatch ? "dictionary-editor-row-match" : undefined
                        }
                      >
                        {renderDictionaryGlobalSearchSideCell(result, "side1")}
                        {renderDictionaryGlobalSearchSideCell(result, "side2")}
                        <td data-label="Источник">
                          <div className="dictionary-global-search-source dictionary-group-static-source">
                            <span>{result.dictionaryTitle}</span>
                            <small>
                              {result.categoryPath}
                              {result.sourceMessageId ? " / сообщение" : ""}
                            </small>
                          </div>
                        </td>
                        <td data-label="">
                          <button
                            type="button"
                            className="mini-action dictionary-group-add"
                            onClick={() => void addResult(result)}
                            disabled={isSaving || exists}
                          >
                            {exists ? "добавлено" : "добавить"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DictionarySimilarPopup({
  state,
  onClose,
  onOpenSource,
}: {
  state: DictionarySimilarPopupState;
  onClose: () => void;
  onOpenSource: (result: DictionaryGroupResolvedResult) => void;
}) {
  const statusText = state.isLoading
    ? "Загружаю похожие слова..."
    : state.error
      ? state.error
      : state.results.length === 0
        ? "Для этого слова пока нет похожих."
        : `${state.results.length} слов`;

  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center p-3">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Закрыть похожие слова"
      />

      <div className="project-create-modal dictionary-global-search-modal dictionary-similar-modal popup-3d relative z-10 w-full max-w-6xl p-4 sm:p-5">
        <div className="dictionary-editor-header mb-3 flex justify-between gap-3">
          <div className="dictionary-editor-title-wrap">
            <h2 className="font-display text-4xl leading-none">Похожее</h2>
            <span className="dictionary-editor-title-badge">группы словарей</span>
          </div>
          <button
            type="button"
            className="menu-action h-9 w-9 text-xl"
            onClick={onClose}
            aria-label="Закрыть похожие слова"
          >
            x
          </button>
        </div>

        <div className="dictionary-similar-groups">
          {state.groups.map((group) => (
            <span key={group.id}>{group.title}</span>
          ))}
        </div>

        <p
          className={`dictionary-global-search-status ${
            state.error ? "dictionary-global-search-status-error" : ""
          }`}
          aria-live="polite"
        >
          {statusText}
        </p>

        <div className="dictionary-global-search-table-wrap">
          <table className="dictionary-editor-table dictionary-global-search-table dictionary-group-table">
            <thead>
              <tr>
                <th>{DEFAULT_DICTIONARY_FIELD_LABELS.side1}</th>
                <th>{DEFAULT_DICTIONARY_FIELD_LABELS.side2}</th>
                <th>Источник</th>
              </tr>
            </thead>
            <tbody>
              {state.results.map((result) => (
                <tr
                  key={result.id}
                  className={result.isCurrent ? "dictionary-group-current-row" : undefined}
                >
                  {renderDictionaryGroupResultSideCell(result, "side1")}
                  {renderDictionaryGroupResultSideCell(result, "side2")}
                  <td data-label="Источник">
                    <button
                      type="button"
                      className="mini-action dictionary-global-search-source"
                      onClick={() => onOpenSource(result)}
                      disabled={!result.sourceExists}
                    >
                      <span>{result.dictionaryTitle}</span>
                      <small>
                        {result.sourceExists ? result.categoryPath : "источник не найден"}
                      </small>
                      <small>
                        {result.groups.map((group) => group.title).join(", ")}
                        {result.isCurrent ? " / текущее" : ""}
                      </small>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function renderDictionaryGroupResultSideCell(
  result: DictionaryGroupResolvedResult,
  side: DictionaryPromptSide
) {
  return renderDictionaryResultSideCell(result, side);
}

function renderDictionaryResultSideCell(
  result:
    | Pick<
        GlobalDictionarySearchResult,
        "entry" | "labels" | "columns"
      >
    | Pick<
        DictionaryGroupResolvedResult,
        "entry" | "labels" | "columns"
      >,
  side: DictionaryPromptSide,
  matchedFields: DictionaryEntryField[] = []
) {
  const sideColumns = getDictionarySideColumns(result.columns, side);
  const sideLabel = toDictionaryPromptSideLabel(
    side,
    result.labels,
    result.columns
  );
  const visibleColumns = sideColumns.length > 0
    ? sideColumns
    : getDictionarySideColumns(DEFAULT_DICTIONARY_COLUMNS, side);

  return (
    <td data-label={sideLabel}>
      <div className="dictionary-global-search-side-cell">
        {visibleColumns.map((column) => {
          const text = getDictionaryEntryFieldText(result.entry, column.id);
          const label = getDictionaryFieldLabel(
            column.id,
            result.labels,
            result.columns
          );
          const isMatch = matchedFields.includes(column.id);

          return (
            <div
              key={column.id}
              className={`dictionary-global-search-field-cell ${
                isMatch ? "dictionary-editor-cell-match" : ""
              }`}
            >
              <span>{label}</span>
              <strong>{text || "-"}</strong>
            </div>
          );
        })}
      </div>
    </td>
  );
}

function normalizeCategoryRow(category: CategoryRow): CategoryRow {
  const normalizedFormat = category.format ?? "continuous";
  const normalizedContent =
    normalizedFormat === "continuous"
      ? serializeContinuousContent(parseContinuousContent(category.content))
      : sanitizeRichTextHtml(category.content);

  return {
    ...category,
    created_at: normalizeTimestamp(category.created_at),
    updated_at: normalizeTimestamp(category.updated_at),
    content: normalizedContent,
    description: category.description ?? "",
    tag: category.tag ?? "",
    format: normalizedFormat,
    category_type: category.category_type ?? "learning",
  };
}

function normalizeProjectRow(project: ProjectRow): ProjectRow {
  return {
    ...project,
    created_at: normalizeTimestamp(project.created_at),
    updated_at: normalizeTimestamp(project.updated_at),
    tag_filter: project.tag_filter ?? "",
    container_category_ids: project.container_category_ids ?? "",
  };
}

function normalizeDictionaryWordGroup(group: DictionaryWordGroup): DictionaryWordGroup {
  return {
    ...group,
    description: group.description ?? "",
    position: Number.isFinite(group.position) ? group.position : 0,
    createdAt: normalizeTimestamp(group.createdAt),
    updatedAt: normalizeTimestamp(group.updatedAt),
    items: (group.items ?? []).map((item) => ({
      ...item,
      sourceMessageId: item.sourceMessageId ?? null,
      dictionaryId: item.dictionaryId ?? null,
      position: Number.isFinite(item.position) ? item.position : 0,
      createdAt: normalizeTimestamp(item.createdAt),
      updatedAt: normalizeTimestamp(item.updatedAt),
    })),
  };
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return new Date(0).toISOString();
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

function sortDictionaryWordGroups(
  a: DictionaryWordGroup,
  b: DictionaryWordGroup
): number {
  if (a.position === b.position) {
    return a.createdAt.localeCompare(b.createdAt);
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

const RICH_ALLOWED_TAGS = new Set([
  "A",
  "BR",
  "DIV",
  "EM",
  "FIGURE",
  "IMG",
  "LI",
  "OL",
  "P",
  "SPAN",
  "STRONG",
  "UL",
]);

const RICH_IMAGE_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const RICH_FILE_DEFAULT_MIME_TYPE = "application/octet-stream";

function clampRichImageWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RICH_IMAGE_WIDTH;
  }

  return Math.min(MAX_RICH_IMAGE_WIDTH, Math.max(MIN_RICH_IMAGE_WIDTH, Math.round(value)));
}

function clampEditorTextScalePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_EDITOR_TEXT_SCALE_PERCENT;
  }

  return Math.min(
    MAX_EDITOR_TEXT_SCALE_PERCENT,
    Math.max(MIN_EDITOR_TEXT_SCALE_PERCENT, Math.round(value))
  );
}

function formatEditorTextScalePercent(value: number): string {
  return `${clampEditorTextScalePercent(value)}%`;
}

function parseEditorTextScalePercentInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withoutPercent = trimmed.endsWith("%")
    ? trimmed.slice(0, -1).trim()
    : trimmed;
  if (!withoutPercent) {
    return null;
  }

  const normalized = withoutPercent.replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clampEditorTextScalePercent(parsed);
}

function normalizeEditorDisplayScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return value;
}

function getEditorDisplayScale(textScalePercent: number): number {
  return normalizeEditorDisplayScale(
    clampEditorTextScalePercent(textScalePercent) / DEFAULT_EDITOR_TEXT_SCALE_PERCENT
  );
}

function getDeleteConfirmOverlayRect(anchorRect: DOMRect): RichImageOverlayRect {
  const width = Math.max(anchorRect.width, MIN_RICH_IMAGE_DELETE_OVERLAY_WIDTH);
  const height = Math.max(anchorRect.height, MIN_RICH_IMAGE_DELETE_OVERLAY_HEIGHT);
  const viewportWidth =
    typeof window === "undefined" ? anchorRect.left + width : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? anchorRect.top + height : window.innerHeight;
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - width / 2;
  const centeredTop = anchorRect.top + anchorRect.height / 2 - height / 2;
  const left = Math.min(Math.max(8, centeredLeft), Math.max(8, viewportWidth - width - 8));
  const top = Math.min(Math.max(8, centeredTop), Math.max(8, viewportHeight - height - 8));

  return {
    top,
    left,
    width: Math.min(width, Math.max(80, viewportWidth - 16)),
    height: Math.min(height, Math.max(80, viewportHeight - 16)),
  };
}

function normalizeRichImageMimeType(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const resolved = normalized === "image/jpg" ? "image/jpeg" : normalized;

  return RICH_IMAGE_ALLOWED_MIME_TYPES.has(resolved) ? resolved : null;
}

function inferRichImageMimeTypeByFileName(fileName: string): string | null {
  const lower = fileName.trim().toLowerCase();
  if (!lower) {
    return null;
  }

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

function isSupportedRichImageFile(file: File): boolean {
  return Boolean(
    normalizeRichImageMimeType(file.type) ?? inferRichImageMimeTypeByFileName(file.name)
  );
}

function isSupportedAccountImageFile(file: File): boolean {
  return isSupportedRichImageFile(file);
}

function normalizeRichImageSource(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^data:/i.test(trimmed)) {
    const match = trimmed.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) {
      return null;
    }

    const mimeType = normalizeRichImageMimeType(match[1]);
    if (!mimeType) {
      return null;
    }

    const base64Body = match[2]?.replace(/\s+/g, "") ?? "";
    if (!base64Body || !/^[a-z0-9+/]+=*$/i.test(base64Body)) {
      return null;
    }

    return `data:${mimeType};base64,${base64Body}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeRichImageId(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (/^[a-z0-9_-]{3,100}$/i.test(trimmed)) {
    return trimmed;
  }

  return crypto.randomUUID();
}

function parseRichImageWidth(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/px$/i, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clampRichImageWidth(parsed);
}

function getRichImageBaseWidth(imageNode: HTMLElement): number {
  return (
    parseRichImageWidth(imageNode.getAttribute("data-rich-image-width")) ??
    parseRichImageWidth(imageNode.style.width) ??
    parseRichImageWidth(imageNode.getAttribute("width")) ??
    DEFAULT_RICH_IMAGE_WIDTH
  );
}

function applyRichImageWidth(
  imageNode: HTMLElement,
  width: number,
  displayScale = 1
): number {
  const clamped = clampRichImageWidth(width);
  const displayWidth =
    Math.round(clamped * normalizeEditorDisplayScale(displayScale) * 100) / 100;
  imageNode.style.width = `${displayWidth}px`;
  imageNode.setAttribute("data-rich-image-width", String(clamped));
  return clamped;
}

function createRichImageBlockElement(
  ownerDocument: Document,
  src: string,
  options?: {
    imageId?: string;
    width?: number;
    displayScale?: number;
  }
): HTMLElement {
  const imageId = normalizeRichImageId(options?.imageId);
  const width = clampRichImageWidth(options?.width ?? DEFAULT_RICH_IMAGE_WIDTH);

  const figure = ownerDocument.createElement("figure");
  figure.className = RICH_IMAGE_CLASS_NAME;
  figure.setAttribute("data-rich-image-id", imageId);
  figure.setAttribute("draggable", "true");
  figure.setAttribute("contenteditable", "false");
  applyRichImageWidth(figure, width, options?.displayScale);

  const image = ownerDocument.createElement("img");
  image.setAttribute("src", src);
  image.setAttribute("alt", "photo");
  image.setAttribute("draggable", "false");
  image.setAttribute("loading", "lazy");
  figure.appendChild(image);

  return figure;
}

async function fileToRichImageDataUrl(file: File): Promise<string | null> {
  const mimeType = normalizeRichImageMimeType(file.type) ?? inferRichImageMimeTypeByFileName(file.name);
  if (!mimeType || file.size > MAX_RICH_IMAGE_FILE_BYTES) {
    return null;
  }

  if (typeof FileReader === "undefined") {
    return null;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      if (commaIndex < 0) {
        resolve(null);
        return;
      }

      const base64Body = result.slice(commaIndex + 1).replace(/\s+/g, "");
      resolve(normalizeRichImageSource(`data:${mimeType};base64,${base64Body}`));
    };
    reader.readAsDataURL(file);
  });
}

function normalizeRichFileMimeType(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function inferRichFileMimeTypeByFileName(fileName: string): string | null {
  const lower = fileName.trim().toLowerCase();
  if (!lower) {
    return null;
  }

  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  if (lower.endsWith(".md")) {
    return "text/markdown";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".xml")) {
    return "application/xml";
  }
  if (lower.endsWith(".zip")) {
    return "application/zip";
  }
  if (lower.endsWith(".rar")) {
    return "application/vnd.rar";
  }
  if (lower.endsWith(".7z")) {
    return "application/x-7z-compressed";
  }
  if (lower.endsWith(".doc")) {
    return "application/msword";
  }
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xls")) {
    return "application/vnd.ms-excel";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".ppt")) {
    return "application/vnd.ms-powerpoint";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".rtf")) {
    return "application/rtf";
  }

  return null;
}

function normalizeRichFileSource(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^data:/i.test(trimmed)) {
    const match = trimmed.match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) {
      return null;
    }

    const mimeType = normalizeRichFileMimeType(match[1]);
    if (!mimeType) {
      return null;
    }

    const base64Body = match[2]?.replace(/\s+/g, "") ?? "";
    if (!base64Body || !/^[a-z0-9+/]+=*$/i.test(base64Body)) {
      return null;
    }

    return `data:${mimeType};base64,${base64Body}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function getRichFileLinkName(fileLink: HTMLAnchorElement): string {
  return normalizeRichFileName(
    fileLink.getAttribute("data-rich-file-name") ?? fileLink.textContent ?? ""
  );
}

function isRichFilePdf(fileLink: HTMLAnchorElement): boolean {
  const fileName = getRichFileLinkName(fileLink);
  const mimeType =
    normalizeRichFileMimeType(fileLink.getAttribute("data-rich-file-mime-type") ?? "") ??
    inferRichFileMimeTypeByFileName(fileName);

  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function buildPdfViewerHref(fileId: string, fileName: string): string {
  const params = new URLSearchParams({
    id: fileId,
    name: fileName,
  });

  return `/pdf-viewer?${params.toString()}`;
}

function openPendingPdfViewerWindow(fileName: string): Window | null {
  const viewerWindow = window.open("", "_blank");
  if (!viewerWindow) {
    return null;
  }

  try {
    const safeTitle = escapeHtmlText(fileName || "PDF");
    viewerWindow.document.title = safeTitle;
    viewerWindow.document.body.style.margin = "0";
    viewerWindow.document.body.style.background = "#8f8f8f";
    viewerWindow.document.body.style.color = "#191919";
    viewerWindow.document.body.style.fontFamily = "system-ui, sans-serif";
    viewerWindow.document.body.innerHTML = [
      '<main style="min-height:100vh;display:grid;place-items:center;padding:1rem">',
      '<section style="width:min(100%,34rem);border:1px solid #555;background:#d7d7d7;padding:1rem">',
      `<h1 style="margin:0 0 .5rem;font-size:1.15rem;overflow-wrap:anywhere">${safeTitle}</h1>`,
      '<p style="margin:0;font-weight:700">Готовим PDF...</p>',
      "</section>",
      "</main>",
    ].join("");
  } catch {
    return viewerWindow;
  }

  return viewerWindow;
}

function richFileDataUrlToBlob(source: string): Blob | null {
  const match = source.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  const mimeType = normalizeRichFileMimeType(match?.[1]);
  const base64Body = match?.[2] ?? "";
  if (!mimeType || !base64Body || typeof atob === "undefined") {
    return null;
  }

  try {
    const binary = atob(base64Body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  } catch {
    return null;
  }
}

function releaseRichFileObjectUrl(
  cache: Map<string, RichFileObjectUrlCacheEntry>,
  fileId: string
) {
  const cached = cache.get(fileId);
  if (!cached) {
    return;
  }

  URL.revokeObjectURL(cached.objectUrl);
  cache.delete(fileId);
}

function revokeRichFileObjectUrlCache(cache: Map<string, RichFileObjectUrlCacheEntry>) {
  for (const fileId of cache.keys()) {
    releaseRichFileObjectUrl(cache, fileId);
  }
}

function getRichFileOpenHref(
  cache: Map<string, RichFileObjectUrlCacheEntry>,
  fileId: string,
  source: string
): string | null {
  const cached = cache.get(fileId);
  if (!source.startsWith("data:")) {
    if (cached) {
      releaseRichFileObjectUrl(cache, fileId);
    }
    return source;
  }

  if (!fileId) {
    return null;
  }

  if (cached?.source === source) {
    return cached.objectUrl;
  }

  if (cached) {
    releaseRichFileObjectUrl(cache, fileId);
  }

  const blob = richFileDataUrlToBlob(source);
  if (!blob) {
    return null;
  }

  try {
    const objectUrl = URL.createObjectURL(blob);
    cache.set(fileId, {
      source,
      objectUrl,
    });
    return objectUrl;
  } catch {
    return null;
  }
}

function openRichFileHref(ownerDocument: Document, href: string): boolean {
  if (!ownerDocument.body) {
    return false;
  }

  const link = ownerDocument.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-hidden", "true");
  link.style.display = "none";
  ownerDocument.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}

function normalizeRichFileId(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (/^[a-z0-9_-]{3,100}$/i.test(trimmed)) {
    return trimmed;
  }

  return crypto.randomUUID();
}

function normalizeRichFileName(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!normalized) {
    return "file";
  }

  return normalized.slice(0, 220);
}

function normalizeRichFileSizeBytes(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed <= 0) {
    return 0;
  }

  return Math.min(MAX_RICH_FILE_BYTES, Math.round(parsed));
}

function inferRichFileSizeBytesFromDataUrl(source: string): number | null {
  const match = source.match(/^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    return null;
  }

  const body = match[1].replace(/\s+/g, "");
  if (!body) {
    return 0;
  }

  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

function formatRichFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function createRichFileAttachmentElement(
  ownerDocument: Document,
  options: {
    src: string;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
    fileId?: string;
  }
): HTMLAnchorElement {
  const safeSrc = normalizeRichFileSource(options.src) ?? "";
  const fileName = normalizeRichFileName(options.fileName);
  const mimeType =
    normalizeRichFileMimeType(options.mimeType) ??
    inferRichFileMimeTypeByFileName(fileName) ??
    RICH_FILE_DEFAULT_MIME_TYPE;
  const normalizedSize =
    normalizeRichFileSizeBytes(options.sizeBytes) ??
    inferRichFileSizeBytesFromDataUrl(safeSrc) ??
    0;
  const sizeLabel = formatRichFileSize(normalizedSize);

  const link = ownerDocument.createElement("a");
  link.className = RICH_FILE_CLASS_NAME;
  link.setAttribute("data-rich-file", "true");
  link.setAttribute("data-rich-file-id", normalizeRichFileId(options.fileId));
  link.setAttribute("data-rich-file-name", fileName);
  link.setAttribute("data-rich-file-mime-type", mimeType);
  link.setAttribute("data-rich-file-size-bytes", String(normalizedSize));
  link.setAttribute("data-rich-file-size-label", sizeLabel);
  link.setAttribute("href", safeSrc || "#");
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  link.setAttribute("contenteditable", "false");
  link.setAttribute("draggable", "true");
  link.setAttribute("aria-label", `Открыть файл ${fileName}`);
  link.setAttribute("title", `${fileName} (${sizeLabel})`);
  link.textContent = fileName;
  return link;
}

async function fileToRichFileData(file: File): Promise<{
  src: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
} | null> {
  if (file.size > MAX_RICH_FILE_BYTES) {
    return null;
  }

  const fileName = normalizeRichFileName(file.name);
  const mimeType =
    normalizeRichFileMimeType(file.type) ??
    inferRichFileMimeTypeByFileName(fileName) ??
    RICH_FILE_DEFAULT_MIME_TYPE;

  if (typeof FileReader === "undefined") {
    return null;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = result.indexOf(",");
      if (commaIndex < 0) {
        resolve(null);
        return;
      }

      const base64Body = result.slice(commaIndex + 1).replace(/\s+/g, "");
      const safeSrc = normalizeRichFileSource(`data:${mimeType};base64,${base64Body}`);
      if (!safeSrc) {
        resolve(null);
        return;
      }

      resolve({
        src: safeSrc,
        fileName,
        mimeType,
        sizeBytes: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(value);
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("#")) {
    return null;
  }

  const hex = normalized.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }

  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }

  if (hex.length === 6) {
    return `#${hex}`;
  }

  return null;
}

function normalizeCssColorToHex(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fromHex = normalizeHexColor(trimmed);
  if (fromHex) {
    return fromHex;
  }

  const rgbMatch = trimmed.match(
    /^rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\)$/i
  );
  if (rgbMatch) {
    const red = Number(rgbMatch[1]);
    const green = Number(rgbMatch[2]);
    const blue = Number(rgbMatch[3]);
    if (
      Number.isFinite(red) &&
      Number.isFinite(green) &&
      Number.isFinite(blue) &&
      red >= 0 &&
      red <= 255 &&
      green >= 0 &&
      green <= 255 &&
      blue >= 0 &&
      blue <= 255
    ) {
      const toHex = (channel: number) =>
        Math.round(channel).toString(16).padStart(2, "0");
      return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
    }
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const probe = document.createElement("span");
  probe.style.color = "";
  probe.style.color = trimmed;

  if (!probe.style.color || !document.body) {
    return null;
  }

  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe).color;
  probe.remove();

  if (!computed || computed.toLowerCase() === trimmed.toLowerCase()) {
    return null;
  }

  return normalizeCssColorToHex(computed);
}

function normalizeRichLinkUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  let candidate = trimmed;
  if (
    !/^(https?:|mailto:|tel:)/i.test(candidate) &&
    /^[^\s]+\.[^\s]+/.test(candidate)
  ) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:" ||
      parsed.protocol === "tel:"
    ) {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeRichNode(sourceNode: Node, ownerDocument: Document): Node | null {
  if (sourceNode.nodeType === Node.TEXT_NODE) {
    return ownerDocument.createTextNode(sourceNode.textContent ?? "");
  }

  if (sourceNode.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const sourceElement = sourceNode as HTMLElement;
  const sourceTag = sourceElement.tagName.toUpperCase();
  const normalizedTag =
    sourceTag === "B"
      ? "STRONG"
      : sourceTag === "I"
        ? "EM"
        : sourceTag === "FONT"
          ? "SPAN"
          : sourceTag;

  const appendChildren = (targetNode: Node) => {
    for (const child of Array.from(sourceElement.childNodes)) {
      const sanitizedChild = sanitizeRichNode(child, ownerDocument);
      if (sanitizedChild) {
        targetNode.appendChild(sanitizedChild);
      }
    }
  };

  if (normalizedTag === "BR") {
    return ownerDocument.createElement("br");
  }

  if (normalizedTag === "IMG") {
    const safeSrc = normalizeRichImageSource(sourceElement.getAttribute("src") ?? "");
    if (!safeSrc) {
      return null;
    }

    const width =
      parseRichImageWidth(sourceElement.getAttribute("data-rich-image-width")) ??
      parseRichImageWidth(sourceElement.style.width) ??
      parseRichImageWidth(sourceElement.getAttribute("width")) ??
      DEFAULT_RICH_IMAGE_WIDTH;

    return createRichImageBlockElement(ownerDocument, safeSrc, {
      imageId: sourceElement.getAttribute("data-rich-image-id") ?? "",
      width,
    });
  }

  if (normalizedTag === "FIGURE") {
    const sourceImage = sourceElement.querySelector("img");
    if (!sourceImage) {
      const fragment = ownerDocument.createDocumentFragment();
      appendChildren(fragment);
      return fragment;
    }

    const safeSrc = normalizeRichImageSource(sourceImage.getAttribute("src") ?? "");
    if (!safeSrc) {
      const fragment = ownerDocument.createDocumentFragment();
      appendChildren(fragment);
      return fragment;
    }

    const width =
      parseRichImageWidth(sourceElement.getAttribute("data-rich-image-width")) ??
      parseRichImageWidth(sourceElement.style.width) ??
      parseRichImageWidth(sourceImage.getAttribute("data-rich-image-width")) ??
      parseRichImageWidth(sourceImage.style.width) ??
      parseRichImageWidth(sourceImage.getAttribute("width")) ??
      DEFAULT_RICH_IMAGE_WIDTH;

    const imageId =
      sourceElement.getAttribute("data-rich-image-id") ??
      sourceImage.getAttribute("data-rich-image-id") ??
      "";

    return createRichImageBlockElement(ownerDocument, safeSrc, {
      imageId,
      width,
    });
  }

  if (!RICH_ALLOWED_TAGS.has(normalizedTag)) {
    const fragment = ownerDocument.createDocumentFragment();
    appendChildren(fragment);
    return fragment;
  }

  if (normalizedTag === "A") {
    const isRichFileLink =
      sourceElement.getAttribute("data-rich-file") === "true" ||
      sourceElement.classList.contains(RICH_FILE_CLASS_NAME) ||
      sourceElement.hasAttribute("data-rich-file-id");

    if (isRichFileLink) {
      const safeSrc = normalizeRichFileSource(sourceElement.getAttribute("href") ?? "");
      if (!safeSrc) {
        const fragment = ownerDocument.createDocumentFragment();
        appendChildren(fragment);
        return fragment;
      }

      const fileName = normalizeRichFileName(
        sourceElement.getAttribute("data-rich-file-name") ?? sourceElement.textContent ?? ""
      );
      const mimeType =
        normalizeRichFileMimeType(sourceElement.getAttribute("data-rich-file-mime-type") ?? "") ??
        inferRichFileMimeTypeByFileName(fileName) ??
        RICH_FILE_DEFAULT_MIME_TYPE;
      const sizeBytes =
        normalizeRichFileSizeBytes(
          sourceElement.getAttribute("data-rich-file-size-bytes") ?? ""
        ) ?? inferRichFileSizeBytesFromDataUrl(safeSrc) ?? 0;

      return createRichFileAttachmentElement(ownerDocument, {
        src: safeSrc,
        fileName,
        mimeType,
        sizeBytes,
        fileId: sourceElement.getAttribute("data-rich-file-id") ?? "",
      });
    }

    const href = normalizeRichLinkUrl(sourceElement.getAttribute("href") ?? "");
    if (!href) {
      const fragment = ownerDocument.createDocumentFragment();
      appendChildren(fragment);
      return fragment;
    }

    const anchor = ownerDocument.createElement("a");
    anchor.setAttribute("href", href);
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
    appendChildren(anchor);
    return anchor;
  }

  if (normalizedTag === "SPAN") {
    const safeColor = normalizeCssColorToHex(
      sourceElement.style.color || sourceElement.getAttribute("color") || ""
    );
    if (!safeColor) {
      const fragment = ownerDocument.createDocumentFragment();
      appendChildren(fragment);
      return fragment;
    }

    const span = ownerDocument.createElement("span");
    span.style.color = safeColor;
    appendChildren(span);
    return span;
  }

  const safeElement = ownerDocument.createElement(normalizedTag.toLowerCase());
  appendChildren(safeElement);
  return safeElement;
}

function sanitizeRichTextHtml(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw.trim()) {
    return "";
  }

  if (!looksLikeHtml(raw)) {
    return escapeHtmlText(raw).replace(/\r?\n/g, "<br>");
  }

  if (typeof DOMParser === "undefined") {
    return escapeHtmlText(raw).replace(/\r?\n/g, "<br>");
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${raw}</div>`, "text/html");
  const sourceRoot = parsed.body.firstElementChild;

  if (!sourceRoot) {
    return "";
  }

  const safeRoot = parsed.createElement("div");
  for (const child of Array.from(sourceRoot.childNodes)) {
    const sanitizedChild = sanitizeRichNode(child, parsed);
    if (sanitizedChild) {
      safeRoot.appendChild(sanitizedChild);
    }
  }

  return safeRoot.innerHTML.trim();
}

function richTextToPlainText(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw) {
    return "";
  }

  if (!looksLikeHtml(raw)) {
    return raw;
  }

  const htmlWithBreaks = sanitizeRichTextHtml(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|figure)>/gi, "\n");

  if (typeof document === "undefined") {
    return htmlWithBreaks
      .replace(/<[^>]+>/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n");
  }

  const probe = document.createElement("div");
  probe.innerHTML = htmlWithBreaks;
  return (probe.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

const CONTINUOUS_CONTENT_KIND = "itemkey-continuous-v1";
const MESSAGE_CHECKLIST_KIND = "itemkey-message-checklist-v1";
const MESSAGE_DICTIONARY_KIND = "itemkey-message-dictionary-v1";
const DICTIONARY_EXPORT_KIND = "itemkey-dict-export";
const DICTIONARY_EXPORT_SCHEMA_VERSION = 2;
const DICTIONARY_LABEL_MAX_LENGTH = 42;
const DICTIONARY_STUDY_PROGRESS_STORAGE_PREFIX =
  "itemkey:dictionary-study-progress:v1";

const DEFAULT_DICTIONARY_FIELD_LABELS: DictionaryFieldLabels = {
  side1: "сторона 1",
  side1Note: "пояснение 1",
  side2: "сторона 2",
  side2Note: "пояснение 2",
};

const DEFAULT_DICTIONARY_COLUMNS: DictionaryColumn[] = [
  {
    id: "side1",
    side: "side1",
    kind: "word",
    label: DEFAULT_DICTIONARY_FIELD_LABELS.side1,
  },
  {
    id: "side1Note",
    side: "side1",
    kind: "note",
    label: DEFAULT_DICTIONARY_FIELD_LABELS.side1Note,
    wordIndex: 0,
  },
  {
    id: "side2",
    side: "side2",
    kind: "word",
    label: DEFAULT_DICTIONARY_FIELD_LABELS.side2,
  },
  {
    id: "side2Note",
    side: "side2",
    kind: "note",
    label: DEFAULT_DICTIONARY_FIELD_LABELS.side2Note,
    wordIndex: 0,
  },
];

const DICTIONARY_EDITOR_SEARCH_FIELDS: DictionaryEntryField[] = [
  "side1",
  "side1Note",
  "side2",
  "side2Note",
];
const DEFAULT_DICTIONARY_AUTO_SPEAK_FIELDS: DictionaryEntryField[] = [
  "side1",
  "side2",
];
const DEFAULT_DICTIONARY_MANUAL_SPEAK_FIELDS: DictionaryEntryField[] = [
  ...DICTIONARY_EDITOR_SEARCH_FIELDS,
];
const DEFAULT_DICTIONARY_MOTIVATION_ADVANCE_MODE: DictionaryMotivationAdvanceMode =
  "auto";
const DEFAULT_DICTIONARY_NOTE_DISPLAY_MODE: DictionaryNoteDisplayMode =
  "continuous";
const DEFAULT_DICTIONARY_MOTIVATION_AUTO_SECONDS = 3;
const MIN_DICTIONARY_MOTIVATION_AUTO_SECONDS = 1;
const MAX_DICTIONARY_MOTIVATION_AUTO_SECONDS = 30;
const DICTIONARY_MOTIVATION_EXIT_MS = 420;

type DictionaryImportPreview =
  | {
      ok: false;
      error: string;
    }
  | {
      ok: true;
      kind: "json";
      title: string;
      payload: MessageDictionaryPayload;
      entries: DictionaryEntry[];
    }
  | {
      ok: true;
      kind: "table";
      entries: DictionaryEntry[];
    };

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeChecklistTitle(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "#Checklist";
  }

  return normalized.slice(0, 80);
}

function normalizeChecklistItemOrderMode(value: unknown): ChecklistItemOrderMode {
  return value === "custom" ? "custom" : "auto";
}

function normalizeDictionaryPromptSide(value: unknown): DictionaryPromptSide {
  return value === "side2" ? "side2" : "side1";
}

function normalizeDictionaryMotivationAdvanceMode(
  value: unknown
): DictionaryMotivationAdvanceMode {
  return value === "manual" ? "manual" : DEFAULT_DICTIONARY_MOTIVATION_ADVANCE_MODE;
}

function normalizeDictionaryColumnKind(value: unknown): DictionaryColumnKind {
  return value === "word" ? "word" : "note";
}

function normalizeDictionaryNoteDisplayMode(
  value: unknown
): DictionaryNoteDisplayMode {
  return value === "separate" ? "separate" : DEFAULT_DICTIONARY_NOTE_DISPLAY_MODE;
}

function normalizeDictionaryMotivationAutoSeconds(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_DICTIONARY_MOTIVATION_AUTO_SECONDS;
  }

  const clamped = Math.min(
    MAX_DICTIONARY_MOTIVATION_AUTO_SECONDS,
    Math.max(MIN_DICTIONARY_MOTIVATION_AUTO_SECONDS, numericValue)
  );
  return Math.round(clamped * 10) / 10;
}

function getDictionaryMotivationAutoDelayMs(value: unknown): number {
  return Math.round(normalizeDictionaryMotivationAutoSeconds(value) * 1000);
}

function normalizeDictionaryText(value: string | null | undefined): string {
  return (typeof value === "string" ? value : "").trim();
}

function normalizeDictionaryTitle(value: string | null | undefined): string {
  const normalized = normalizeMessageTitle(value);
  return normalized === "Новый блок" ? "Словарь" : normalized;
}

function normalizeDictionaryDescription(value: string | null | undefined): string {
  return normalizeDictionaryText(value).slice(0, 420);
}

function normalizeDictionaryLabel(value: unknown, fallback: string): string {
  const normalized =
    typeof value === "string"
      ? normalizeDictionaryText(value).slice(0, DICTIONARY_LABEL_MAX_LENGTH)
      : "";

  return normalized || fallback;
}

function readDictionaryLabels(value: unknown): DictionaryFieldLabels {
  if (!isObjectRecord(value)) {
    return {};
  }

  const labels: DictionaryFieldLabels = {};
  for (const [key, label] of Object.entries(value)) {
    if (typeof label === "string") {
      labels[key] = label;
    }
  }

  return labels;
}

function normalizeDictionaryColumnId(value: unknown, fallback: string): string {
  const normalized =
    typeof value === "string"
      ? normalizeDictionaryText(value).slice(0, 64)
      : "";
  return normalized || fallback;
}

function readDictionaryColumnWordIndex(value: unknown): number | null {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, Math.floor(numericValue));
}

function clampDictionaryColumnWordIndex(
  value: unknown,
  wordCount: number,
  fallback = 0
): number {
  const parsed = readDictionaryColumnWordIndex(value);
  const maxIndex = Math.max(0, wordCount - 1);
  return Math.min(maxIndex, parsed ?? fallback);
}

function normalizeDictionaryColumnWordIndexes(
  columns: DictionaryColumn[]
): DictionaryColumn[] {
  const wordCountBySide: Record<DictionaryPromptSide, number> = {
    side1: getDictionarySideColumns(columns, "side1", "word").length,
    side2: getDictionarySideColumns(columns, "side2", "word").length,
  };
  const seenWordCountBySide: Record<DictionaryPromptSide, number> = {
    side1: 0,
    side2: 0,
  };

  return columns.map((column) => {
    if (column.kind === "word") {
      seenWordCountBySide[column.side] += 1;
      const wordColumn = { ...column };
      delete wordColumn.wordIndex;
      return wordColumn;
    }

    const fallbackWordIndex = Math.max(0, seenWordCountBySide[column.side] - 1);
    return {
      ...column,
      wordIndex: clampDictionaryColumnWordIndex(
        column.wordIndex,
        wordCountBySide[column.side],
        fallbackWordIndex
      ),
    };
  });
}

function makeDictionaryColumnFallbackId(
  side: DictionaryPromptSide,
  kind: DictionaryColumnKind,
  index: number
): string {
  return `${side}-${kind}-${index + 1}`;
}

function makeDictionaryColumnFallbackLabel(
  side: DictionaryPromptSide,
  kind: DictionaryColumnKind,
  index: number
): string {
  if (side === "side1" && kind === "word" && index === 0) {
    return DEFAULT_DICTIONARY_FIELD_LABELS.side1;
  }
  if (side === "side1" && kind === "note" && index === 1) {
    return DEFAULT_DICTIONARY_FIELD_LABELS.side1Note;
  }
  if (side === "side2" && kind === "word" && index === 2) {
    return DEFAULT_DICTIONARY_FIELD_LABELS.side2;
  }
  if (side === "side2" && kind === "note" && index === 3) {
    return DEFAULT_DICTIONARY_FIELD_LABELS.side2Note;
  }

  const sideNumber = side === "side1" ? "1" : "2";
  const typeLabel = kind === "word" ? "слово" : "пояснение";
  return `${typeLabel} ${sideNumber}.${index + 1}`;
}

function createDefaultDictionaryColumns(
  labels: unknown = DEFAULT_DICTIONARY_FIELD_LABELS
): DictionaryColumn[] {
  const rawLabels = isObjectRecord(labels) ? labels : {};
  return DEFAULT_DICTIONARY_COLUMNS.map((column) => ({
    ...column,
    label: normalizeDictionaryLabel(rawLabels[column.id], column.label),
  }));
}

function normalizeDictionaryColumns(
  value: unknown,
  labels: unknown = DEFAULT_DICTIONARY_FIELD_LABELS
): DictionaryColumn[] {
  if (!Array.isArray(value) || value.length === 0) {
    return createDefaultDictionaryColumns(labels);
  }

  const rawLabels = isObjectRecord(labels) ? labels : {};
  const seen = new Set<string>();
  const result: DictionaryColumn[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const rawColumn = value[index];
    if (!isObjectRecord(rawColumn)) {
      continue;
    }

    const side = normalizeDictionaryPromptSide(rawColumn.side);
    const kind = normalizeDictionaryColumnKind(rawColumn.kind);
    const baseId = normalizeDictionaryColumnId(
      rawColumn.id,
      makeDictionaryColumnFallbackId(side, kind, index)
    );
    let resolvedId = baseId;
    let suffix = 2;
    while (seen.has(resolvedId.toLocaleLowerCase())) {
      resolvedId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(resolvedId.toLocaleLowerCase());

    const fallbackColumn = DEFAULT_DICTIONARY_COLUMNS.find(
      (column) => column.id === resolvedId
    );
    const fallbackLabel =
      fallbackColumn?.label ?? makeDictionaryColumnFallbackLabel(side, kind, index);

    const column: DictionaryColumn = {
      id: resolvedId,
      side,
      kind,
      label: normalizeDictionaryLabel(
        rawColumn.label ?? rawLabels[resolvedId],
        fallbackLabel
      ),
    };

    if (kind === "note") {
      column.wordIndex = readDictionaryColumnWordIndex(rawColumn.wordIndex) ?? undefined;
    }

    result.push(column);
  }

  if (result.length === 0) {
    return createDefaultDictionaryColumns(labels);
  }

  for (const side of ["side1", "side2"] as const) {
    if (result.some((column) => column.side === side && column.kind === "word")) {
      continue;
    }

    const fallbackColumn = DEFAULT_DICTIONARY_COLUMNS.find(
      (column) => column.side === side && column.kind === "word"
    );
    if (fallbackColumn && !seen.has(fallbackColumn.id.toLocaleLowerCase())) {
      result.unshift({ ...fallbackColumn });
    }
  }

  return normalizeDictionaryColumnWordIndexes(result);
}

function createDefaultDictionaryLabels(
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryFieldLabels {
  return Object.fromEntries(columns.map((column) => [column.id, column.label]));
}

function normalizeDictionaryLabels(
  value: unknown,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryFieldLabels {
  const raw = isObjectRecord(value) ? value : {};
  return Object.fromEntries(
    columns.map((column) => [
      column.id,
      normalizeDictionaryLabel(raw[column.id] ?? column.label, column.label),
    ])
  );
}

function parseDictionaryTags(value: string | null | undefined): string[] {
  const raw = typeof value === "string" ? value : "";
  return dedupeCategoryTags(raw.split(/[\s,;]+/g));
}

function serializeDictionaryTags(tags: string[]): string {
  return dedupeCategoryTags(tags).join(" ");
}

function normalizeDictionaryEntryValues(
  entry: unknown,
  columns: DictionaryColumn[]
): Record<string, string> {
  const rawEntry = isObjectRecord(entry) ? entry : {};
  const rawValues = isObjectRecord(rawEntry.values) ? rawEntry.values : {};
  const values: Record<string, string> = {};

  for (const column of columns) {
    const rawValue = rawValues[column.id];
    const directValue = rawEntry[column.id];
    values[column.id] = normalizeDictionaryText(
      typeof rawValue === "string"
        ? rawValue
        : typeof directValue === "string"
          ? directValue
          : ""
    );
  }

  return values;
}

function normalizeDictionaryEntries(
  entries: unknown,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set<string>();
  const result: DictionaryEntry[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const values = normalizeDictionaryEntryValues(entry, columns);
    const hasSide1Word = columns.some(
      (column) =>
        column.side === "side1" && column.kind === "word" && Boolean(values[column.id])
    );
    const hasSide2Word = columns.some(
      (column) =>
        column.side === "side2" && column.kind === "word" && Boolean(values[column.id])
    );

    if (!hasSide1Word || !hasSide2Word) {
      continue;
    }

    const rawId = normalizeDictionaryText(
      isObjectRecord(entry) && typeof entry.id === "string" ? entry.id : ""
    );
    const baseId = rawId || `entry-${index + 1}`;
    let resolvedId = baseId;
    let suffix = 2;
    while (seen.has(resolvedId.toLocaleLowerCase())) {
      resolvedId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(resolvedId.toLocaleLowerCase());

    result.push({
      id: resolvedId,
      values,
    });
  }

  return result;
}

function isDictionaryEntryField(
  value: unknown,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): value is DictionaryEntryField {
  return (
    typeof value === "string" &&
    columns.some((column) => column.id === value)
  );
}

function getDictionarySideColumns(
  columns: DictionaryColumn[],
  side: DictionaryPromptSide,
  kind?: DictionaryColumnKind
): DictionaryColumn[] {
  return columns.filter(
    (column) => column.side === side && (!kind || column.kind === kind)
  );
}

function getDictionaryFieldLabel(
  field: DictionaryEntryField,
  labels: DictionaryFieldLabels = DEFAULT_DICTIONARY_FIELD_LABELS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): string {
  const column = columns.find((candidate) => candidate.id === field);
  return labels[field] ?? column?.label ?? field;
}

function getDictionaryEntryFieldText(
  entry: DictionaryEntry,
  field: DictionaryEntryField
): string {
  return normalizeDictionaryText(getDictionaryEntryFieldDraftText(entry, field));
}

function getDictionaryEntryFieldDraftText(
  entry: DictionaryEntry,
  field: DictionaryEntryField
): string {
  return (
    entry.values?.[field] ??
    (typeof entry[field as keyof DictionaryEntry] === "string"
      ? (entry[field as keyof DictionaryEntry] as string)
      : "")
  );
}

function getDefaultDictionaryAutoSpeakFields(
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntryField[] {
  return columns
    .filter((column) => column.kind === "word")
    .map((column) => column.id);
}

function getDefaultDictionaryManualSpeakFields(
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntryField[] {
  return columns.map((column) => column.id);
}

function normalizeDictionarySpeakFields(
  value: unknown,
  columns: DictionaryColumn[],
  fallback: DictionaryEntryField[]
): DictionaryEntryField[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const result: DictionaryEntryField[] = [];
  for (const field of value) {
    if (!isDictionaryEntryField(field, columns) || result.includes(field)) {
      continue;
    }

    result.push(field);
  }

  return result.length > 0 ? result : [...fallback];
}

function normalizeDictionaryAutoSpeakFields(
  value: unknown,
  fallback: DictionaryEntryField[] = DEFAULT_DICTIONARY_AUTO_SPEAK_FIELDS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntryField[] {
  return normalizeDictionarySpeakFields(value, columns, fallback);
}

function normalizeDictionaryManualSpeakFields(
  value: unknown,
  fallback: DictionaryEntryField[] = DEFAULT_DICTIONARY_MANUAL_SPEAK_FIELDS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntryField[] {
  return normalizeDictionarySpeakFields(value, columns, fallback);
}

function normalizeMessageDictionaryPayload(
  payload: MessageDictionaryPayload
): MessageDictionaryPayload {
  const columns = normalizeDictionaryColumns(payload.columns, payload.labels);
  const labels = normalizeDictionaryLabels(payload.labels, columns);

  return {
    description: normalizeDictionaryDescription(payload.description),
    tags: dedupeCategoryTags(Array.isArray(payload.tags) ? payload.tags : []),
    promptSide: normalizeDictionaryPromptSide(payload.promptSide),
    shuffle: Boolean(payload.shuffle),
    autoSpeak: Boolean(payload.autoSpeak),
    autoSpeakFields: normalizeDictionaryAutoSpeakFields(
      payload.autoSpeakFields,
      getDefaultDictionaryAutoSpeakFields(columns),
      columns
    ),
    manualSpeakFields: normalizeDictionaryManualSpeakFields(
      payload.manualSpeakFields,
      getDefaultDictionaryManualSpeakFields(columns),
      columns
    ),
    noteDisplayMode: normalizeDictionaryNoteDisplayMode(payload.noteDisplayMode),
    progressMode: Boolean(payload.progressMode),
    motivateOnCorrect: Boolean(payload.motivateOnCorrect),
    cardMode: Boolean(payload.cardMode),
    adhdMode: Boolean(payload.adhdMode),
    motivationAdvanceMode: normalizeDictionaryMotivationAdvanceMode(
      payload.motivationAdvanceMode
    ),
    motivationAutoSeconds: normalizeDictionaryMotivationAutoSeconds(
      payload.motivationAutoSeconds
    ),
    labels,
    columns,
    entries: normalizeDictionaryEntries(payload.entries, columns),
  };
}

function normalizeDictionaryBlocks(dictionaries: DictionaryBlock[]): DictionaryBlock[] {
  const seen = new Set<string>();
  const result: DictionaryBlock[] = [];

  for (let index = 0; index < dictionaries.length; index += 1) {
    const dictionary = dictionaries[index];
    const rawId = normalizeDictionaryText(dictionary.id);
    const baseId = rawId || `dictionary-${index + 1}`;
    let resolvedId = baseId;
    let suffix = 2;
    while (seen.has(resolvedId.toLocaleLowerCase())) {
      resolvedId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(resolvedId.toLocaleLowerCase());

    const normalizedPayload = normalizeMessageDictionaryPayload(dictionary);
    if (normalizedPayload.entries.length === 0) {
      continue;
    }

    result.push({
      id: resolvedId,
      title: normalizeDictionaryTitle(dictionary.title),
      ...normalizedPayload,
    });
  }

  return result;
}

function normalizeMessageChecklistPayload(
  payload: MessageChecklistPayload
): MessageChecklistPayload {
  const orderMode = normalizeChecklistItemOrderMode(payload.orderMode);

  return {
    tags: dedupeCategoryTags(payload.tags),
    checkedCategoryIds: dedupePlainList(payload.checkedCategoryIds),
    orderMode,
    customOrderCategoryIds:
      orderMode === "custom" ? dedupePlainList(payload.customOrderCategoryIds) : [],
  };
}

function parseMessageChecklistContent(
  value: string | null | undefined
): MessageChecklistPayload | null {
  const raw = typeof value === "string" ? value : "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObjectRecord(parsed) || parsed.kind !== MESSAGE_CHECKLIST_KIND) {
      return null;
    }

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    const checkedCategoryIds = Array.isArray(parsed.checkedCategoryIds)
      ? parsed.checkedCategoryIds.filter((id): id is string => typeof id === "string")
      : [];
    const customOrderCategoryIds = Array.isArray(parsed.customOrderCategoryIds)
      ? parsed.customOrderCategoryIds.filter((id): id is string => typeof id === "string")
      : [];
    const orderMode = normalizeChecklistItemOrderMode(parsed.orderMode);

    const normalized = normalizeMessageChecklistPayload({
      tags,
      checkedCategoryIds,
      orderMode,
      customOrderCategoryIds,
    });
    if (normalized.tags.length === 0) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
}

function serializeMessageChecklistContent(payload: MessageChecklistPayload): string {
  const normalized = normalizeMessageChecklistPayload(payload);
  return JSON.stringify({
    kind: MESSAGE_CHECKLIST_KIND,
    tags: normalized.tags,
    checkedCategoryIds: normalized.checkedCategoryIds,
    orderMode: normalized.orderMode,
    customOrderCategoryIds: normalized.customOrderCategoryIds,
  });
}

function parseMessageDictionaryContent(
  value: string | null | undefined
): MessageDictionaryPayload | null {
  const raw = typeof value === "string" ? value : "";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObjectRecord(parsed) || parsed.kind !== MESSAGE_DICTIONARY_KIND) {
      return null;
    }

    return normalizeMessageDictionaryPayload({
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      promptSide: normalizeDictionaryPromptSide(parsed.promptSide),
      shuffle: Boolean(parsed.shuffle),
      autoSpeak: Boolean(parsed.autoSpeak),
      autoSpeakFields: Array.isArray(parsed.autoSpeakFields)
        ? parsed.autoSpeakFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [],
      manualSpeakFields: Array.isArray(parsed.manualSpeakFields)
        ? parsed.manualSpeakFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [],
      noteDisplayMode: normalizeDictionaryNoteDisplayMode(parsed.noteDisplayMode),
      progressMode: Boolean(parsed.progressMode),
      motivateOnCorrect: Boolean(parsed.motivateOnCorrect),
      cardMode: Boolean(parsed.cardMode),
      adhdMode: Boolean(parsed.adhdMode),
      motivationAdvanceMode: normalizeDictionaryMotivationAdvanceMode(
        parsed.motivationAdvanceMode
      ),
      motivationAutoSeconds: normalizeDictionaryMotivationAutoSeconds(
        parsed.motivationAutoSeconds
      ),
      labels: readDictionaryLabels(parsed.labels),
      columns: normalizeDictionaryColumns(parsed.columns, parsed.labels),
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    });
  } catch {
    return null;
  }
}

function serializeMessageDictionaryContent(payload: MessageDictionaryPayload): string {
  const normalized = normalizeMessageDictionaryPayload(payload);
  return JSON.stringify({
    kind: MESSAGE_DICTIONARY_KIND,
    description: normalized.description,
    tags: normalized.tags,
    promptSide: normalized.promptSide,
    shuffle: normalized.shuffle,
    autoSpeak: normalized.autoSpeak,
    autoSpeakFields: normalized.autoSpeakFields,
    manualSpeakFields: normalized.manualSpeakFields,
    noteDisplayMode: normalized.noteDisplayMode,
    progressMode: normalized.progressMode,
    motivateOnCorrect: normalized.motivateOnCorrect,
    cardMode: normalized.cardMode,
    adhdMode: normalized.adhdMode,
    motivationAdvanceMode: normalized.motivationAdvanceMode,
    motivationAutoSeconds: normalized.motivationAutoSeconds,
    columns: normalized.columns,
    labels: normalized.labels,
    entries: normalized.entries,
  });
}

function isSpecialMessageContent(value: string | null | undefined): boolean {
  return Boolean(
    parseMessageChecklistContent(value) ||
      parseMessageDictionaryContent(value) ||
      parseMessageScheduleContent(value)
  );
}

function normalizePersistedMessageContent(value: string): string {
  const checklistPayload = parseMessageChecklistContent(value);
  if (checklistPayload) {
    return serializeMessageChecklistContent(checklistPayload);
  }

  const dictionaryPayload = parseMessageDictionaryContent(value);
  if (dictionaryPayload) {
    return serializeMessageDictionaryContent(dictionaryPayload);
  }

  const schedulePayload = parseMessageScheduleContent(value);
  if (schedulePayload) {
    return serializeMessageScheduleContent(schedulePayload);
  }

  return sanitizeRichTextHtml(value);
}

function normalizeChecklistBlocks(checklists: ChecklistBlock[]): ChecklistBlock[] {
  const seen = new Set<string>();
  const result: ChecklistBlock[] = [];

  for (let index = 0; index < checklists.length; index += 1) {
    const checklist = checklists[index];
    const rawId = typeof checklist.id === "string" ? checklist.id.trim() : "";
    const baseId = rawId || `checklist-${index + 1}`;

    let resolvedId = baseId;
    let suffix = 2;
    while (seen.has(resolvedId.toLocaleLowerCase())) {
      resolvedId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(resolvedId.toLocaleLowerCase());

    const orderMode = normalizeChecklistItemOrderMode(checklist.orderMode);

    result.push({
      id: resolvedId,
      title: normalizeChecklistTitle(checklist.title),
      tags: dedupeCategoryTags(checklist.tags),
      checkedCategoryIds: dedupePlainList(checklist.checkedCategoryIds),
      orderMode,
      customOrderCategoryIds:
        orderMode === "custom" ? dedupePlainList(checklist.customOrderCategoryIds) : [],
    });
  }

  return result;
}

function parseContinuousChecklistCollection(value: unknown): ChecklistBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsedChecklists: ChecklistBlock[] = [];
  for (const rawChecklist of value) {
    if (!isObjectRecord(rawChecklist)) {
      continue;
    }

    const tags = Array.isArray(rawChecklist.tags)
      ? rawChecklist.tags.filter((tag): tag is string => typeof tag === "string")
      : [];

    const checkedCategoryIds = Array.isArray(rawChecklist.checkedCategoryIds)
      ? rawChecklist.checkedCategoryIds.filter((id): id is string => typeof id === "string")
      : [];
    const customOrderCategoryIds = Array.isArray(rawChecklist.customOrderCategoryIds)
      ? rawChecklist.customOrderCategoryIds.filter((id): id is string => typeof id === "string")
      : [];
    const orderMode = normalizeChecklistItemOrderMode(rawChecklist.orderMode);

    parsedChecklists.push({
      id: typeof rawChecklist.id === "string" ? rawChecklist.id : "",
      title: typeof rawChecklist.title === "string" ? rawChecklist.title : "",
      tags,
      checkedCategoryIds,
      orderMode,
      customOrderCategoryIds,
    });
  }

  return normalizeChecklistBlocks(parsedChecklists);
}

function parseContinuousDictionaryCollection(value: unknown): DictionaryBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsedDictionaries: DictionaryBlock[] = [];
  for (const rawDictionary of value) {
    if (!isObjectRecord(rawDictionary)) {
      continue;
    }

    parsedDictionaries.push({
      id: typeof rawDictionary.id === "string" ? rawDictionary.id : "",
      title: typeof rawDictionary.title === "string" ? rawDictionary.title : "",
      description:
        typeof rawDictionary.description === "string"
          ? rawDictionary.description
          : "",
      tags: Array.isArray(rawDictionary.tags)
        ? rawDictionary.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      promptSide: normalizeDictionaryPromptSide(rawDictionary.promptSide),
      shuffle: Boolean(rawDictionary.shuffle),
      autoSpeak: Boolean(rawDictionary.autoSpeak),
      autoSpeakFields: Array.isArray(rawDictionary.autoSpeakFields)
        ? rawDictionary.autoSpeakFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [],
      manualSpeakFields: Array.isArray(rawDictionary.manualSpeakFields)
        ? rawDictionary.manualSpeakFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [],
      noteDisplayMode: normalizeDictionaryNoteDisplayMode(
        rawDictionary.noteDisplayMode
      ),
      progressMode: Boolean(rawDictionary.progressMode),
      motivateOnCorrect: Boolean(rawDictionary.motivateOnCorrect),
      cardMode: Boolean(rawDictionary.cardMode),
      adhdMode: Boolean(rawDictionary.adhdMode),
      motivationAdvanceMode: normalizeDictionaryMotivationAdvanceMode(
        rawDictionary.motivationAdvanceMode
      ),
      motivationAutoSeconds: normalizeDictionaryMotivationAutoSeconds(
        rawDictionary.motivationAutoSeconds
      ),
      labels: readDictionaryLabels(rawDictionary.labels),
      columns: normalizeDictionaryColumns(
        rawDictionary.columns,
        rawDictionary.labels
      ),
      entries: Array.isArray(rawDictionary.entries) ? rawDictionary.entries : [],
    });
  }

  return normalizeDictionaryBlocks(parsedDictionaries);
}

function parseContinuousChecklists(value: string | null | undefined): ChecklistBlock[] {
  const raw = typeof value === "string" ? value : "";
  const trimmed = raw.trim();

  if (!trimmed.startsWith("{")) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObjectRecord(parsed) || parsed.kind !== CONTINUOUS_CONTENT_KIND) {
      return [];
    }

    return parseContinuousChecklistCollection(parsed.checklists);
  } catch {
    return [];
  }
}

function parseContinuousScheduleCollection(value: unknown): ScheduleBlock[] {
  return normalizeScheduleBlocks(value);
}

function parseContinuousContent(value: string | null | undefined): ContinuousContentModel {
  const raw = typeof value === "string" ? value : "";
  const trimmed = raw.trim();

  if (!trimmed.startsWith("{")) {
    return {
      text: sanitizeRichTextHtml(raw),
      checklists: [],
      dictionaries: [],
      schedules: [],
    };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObjectRecord(parsed)) {
      return {
        text: sanitizeRichTextHtml(raw),
        checklists: [],
        dictionaries: [],
        schedules: [],
      };
    }

    if (
      parsed.kind !== CONTINUOUS_CONTENT_KIND ||
      typeof parsed.text !== "string" ||
      !Array.isArray(parsed.checklists)
    ) {
      return {
        text: sanitizeRichTextHtml(raw),
        checklists: [],
        dictionaries: [],
        schedules: [],
      };
    }

    return {
      text: sanitizeRichTextHtml(parsed.text),
      checklists: parseContinuousChecklistCollection(parsed.checklists),
      dictionaries: parseContinuousDictionaryCollection(parsed.dictionaries),
      schedules: parseContinuousScheduleCollection(parsed.schedules),
    };
  } catch {
    return {
      text: sanitizeRichTextHtml(raw),
      checklists: [],
      dictionaries: [],
      schedules: [],
    };
  }
}

function serializeContinuousContent(document: ContinuousContentModel): string {
  const nextDocument: ContinuousContentModel = {
    text: sanitizeRichTextHtml(document.text),
    checklists: normalizeChecklistBlocks(document.checklists),
    dictionaries: normalizeDictionaryBlocks(document.dictionaries),
    schedules: normalizeScheduleBlocks(document.schedules),
  };

  if (
    nextDocument.checklists.length === 0 &&
    nextDocument.dictionaries.length === 0 &&
    nextDocument.schedules.length === 0
  ) {
    return nextDocument.text;
  }

  return JSON.stringify({
    kind: CONTINUOUS_CONTENT_KIND,
    text: nextDocument.text,
    checklists: nextDocument.checklists,
    dictionaries: nextDocument.dictionaries,
    schedules: nextDocument.schedules,
  });
}

function categoryMatchesChecklistTags(category: CategoryRow, tags: string[]): boolean {
  const normalizedTags = dedupeCategoryTags(tags);
  if (normalizedTags.length === 0) {
    return false;
  }

  const selectedTagKeySet = new Set(
    normalizedTags.map((tag) => tag.toLocaleLowerCase())
  );

  return parseCategoryTags(category.tag).some((tag) =>
    selectedTagKeySet.has(tag.toLocaleLowerCase())
  );
}

function collectChecklistCategoryOptions(
  categories: CategoryRow[],
  tags: string[]
): ChecklistCategoryOption[] {
  const normalizedTags = dedupeCategoryTags(tags);
  if (normalizedTags.length === 0) {
    return [];
  }

  return categories
    .filter((category) => categoryMatchesChecklistTags(category, normalizedTags))
    .map((category) => ({
      categoryId: category.id,
      label: buildCategoryPath(categories, category.id)
        .map((part) => part.title)
        .join(" / "),
      createdAt: category.created_at,
      position: category.position,
    }));
}

function compareChecklistOptionByHistory(
  left: ChecklistCategoryOption,
  right: ChecklistCategoryOption
): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt.localeCompare(left.createdAt);
  }

  if (left.position !== right.position) {
    return left.position - right.position;
  }

  if (left.label !== right.label) {
    return left.label.localeCompare(right.label, "ru-RU");
  }

  return left.categoryId.localeCompare(right.categoryId);
}

function buildChecklistDisplayItems(
  options: ChecklistCategoryOption[],
  checkedCategoryKeySet: Set<string>,
  orderMode: ChecklistItemOrderMode,
  customOrderCategoryIds: string[]
): Array<ChecklistCategoryOption & { checked: boolean }> {
  const items = options.map((option) => ({
    ...option,
    checked: checkedCategoryKeySet.has(option.categoryId.toLocaleLowerCase()),
  }));

  const uncheckedItems = items
    .filter((item) => !item.checked)
    .sort(compareChecklistOptionByHistory);
  const checkedItems = items
    .filter((item) => item.checked)
    .sort(compareChecklistOptionByHistory);

  if (orderMode !== "custom") {
    return [...uncheckedItems, ...checkedItems];
  }

  const customOrderById = new Map(
    dedupePlainList(customOrderCategoryIds).map((id, index) => [id.toLocaleLowerCase(), index])
  );

  const sortGroupByCustom = (group: Array<ChecklistCategoryOption & { checked: boolean }>) => {
    return [...group].sort((left, right) => {
      const leftCustomIndex = customOrderById.get(left.categoryId.toLocaleLowerCase());
      const rightCustomIndex = customOrderById.get(right.categoryId.toLocaleLowerCase());

      if (typeof leftCustomIndex === "number" || typeof rightCustomIndex === "number") {
        if (typeof leftCustomIndex !== "number") {
          return 1;
        }
        if (typeof rightCustomIndex !== "number") {
          return -1;
        }
        if (leftCustomIndex !== rightCustomIndex) {
          return leftCustomIndex - rightCustomIndex;
        }
      }

      return compareChecklistOptionByHistory(left, right);
    });
  };

  return [...sortGroupByCustom(uncheckedItems), ...sortGroupByCustom(checkedItems)];
}

function createEmptyDictionaryEntry(
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): DictionaryEntry {
  return {
    id: crypto.randomUUID(),
    values: Object.fromEntries(columns.map((column) => [column.id, ""])),
  };
}

function makeDictionaryEditorEntries(
  payload: MessageDictionaryPayload
): DictionaryEntry[] {
  return payload.entries.length > 0
    ? payload.entries.map((entry) => ({
        id: entry.id,
        values: normalizeDictionaryEntryValues(entry, payload.columns),
      }))
    : [createEmptyDictionaryEntry(payload.columns)];
}

function validateDictionaryEditorEntries(
  entries: DictionaryEntry[],
  columns: DictionaryColumn[]
): {
  entries: DictionaryEntry[];
  error: string | null;
} {
  const draftEntries: DictionaryEntry[] = [];
  const side1WordColumns = getDictionarySideColumns(columns, "side1", "word");
  const side2WordColumns = getDictionarySideColumns(columns, "side2", "word");

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const values = normalizeDictionaryEntryValues(entry, columns);
    const hasAnyValue = Object.values(values).some(Boolean);

    if (!hasAnyValue) {
      continue;
    }

    const hasSide1Word = side1WordColumns.some((column) => values[column.id]);
    const hasSide2Word = side2WordColumns.some((column) => values[column.id]);

    if (!hasSide1Word || !hasSide2Word) {
      return {
        entries: [],
        error: `Заполни обе стороны в строке ${index + 1}.`,
      };
    }

    draftEntries.push({
      id: normalizeDictionaryText(entry.id) || `entry-${index + 1}`,
      values,
    });
  }

  if (draftEntries.length === 0) {
    return {
      entries: [],
      error: "Добавь хотя бы одну пару слов.",
    };
  }

  return {
    entries: normalizeDictionaryEntries(draftEntries, columns),
    error: null,
  };
}

function buildDictionaryExportDocument(
  title: string,
  payload: MessageDictionaryPayload
) {
  const normalized = normalizeMessageDictionaryPayload(payload);

  return {
    kind: DICTIONARY_EXPORT_KIND,
    schemaVersion: DICTIONARY_EXPORT_SCHEMA_VERSION,
    title: normalizeDictionaryTitle(title),
    description: normalized.description,
    tags: normalized.tags,
    promptSide: normalized.promptSide,
    shuffle: normalized.shuffle,
    autoSpeak: normalized.autoSpeak,
    autoSpeakFields: normalized.autoSpeakFields,
    manualSpeakFields: normalized.manualSpeakFields,
    noteDisplayMode: normalized.noteDisplayMode,
    progressMode: normalized.progressMode,
    motivateOnCorrect: normalized.motivateOnCorrect,
    cardMode: normalized.cardMode,
    adhdMode: normalized.adhdMode,
    motivationAdvanceMode: normalized.motivationAdvanceMode,
    motivationAutoSeconds: normalized.motivationAutoSeconds,
    columns: normalized.columns,
    labels: normalized.labels,
    entries: normalized.entries,
  };
}

function parseDictionaryImportDraft(
  value: string,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS,
  labels?: DictionaryFieldLabels
): DictionaryImportPreview {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Вставь текст импорта или выбери файл.",
    };
  }

  if (trimmed.startsWith("{")) {
    return parseDictionaryJsonImport(trimmed);
  }

  return parseDictionaryTableImport(trimmed, columns, labels);
}

function parseDictionaryJsonImport(value: string): DictionaryImportPreview {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isObjectRecord(parsed)) {
      throw new Error("JSON должен быть объектом экспорта #DICT.");
    }

    if (
      parsed.kind !== DICTIONARY_EXPORT_KIND ||
      (parsed.schemaVersion !== 1 &&
        parsed.schemaVersion !== DICTIONARY_EXPORT_SCHEMA_VERSION)
    ) {
      throw new Error("Поддерживается только JSON экспорта #DICT v1.");
    }

    const payload = normalizeMessageDictionaryPayload({
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      promptSide: normalizeDictionaryPromptSide(parsed.promptSide),
      shuffle: Boolean(parsed.shuffle),
      autoSpeak: Boolean(parsed.autoSpeak),
      autoSpeakFields: Array.isArray(parsed.autoSpeakFields)
        ? parsed.autoSpeakFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [],
      manualSpeakFields: Array.isArray(parsed.manualSpeakFields)
        ? parsed.manualSpeakFields.filter(
            (field): field is string => typeof field === "string"
          )
        : [],
      noteDisplayMode: normalizeDictionaryNoteDisplayMode(parsed.noteDisplayMode),
      progressMode: Boolean(parsed.progressMode),
      motivateOnCorrect: Boolean(parsed.motivateOnCorrect),
      cardMode: Boolean(parsed.cardMode),
      adhdMode: Boolean(parsed.adhdMode),
      motivationAdvanceMode: normalizeDictionaryMotivationAdvanceMode(
        parsed.motivationAdvanceMode
      ),
      motivationAutoSeconds: normalizeDictionaryMotivationAutoSeconds(
        parsed.motivationAutoSeconds
      ),
      labels: readDictionaryLabels(parsed.labels),
      columns: normalizeDictionaryColumns(parsed.columns, parsed.labels),
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    });

    if (payload.entries.length === 0) {
      throw new Error("В JSON нет ни одной полной пары слов.");
    }

    return {
      ok: true,
      kind: "json",
      title:
        typeof parsed.title === "string"
          ? normalizeDictionaryTitle(parsed.title)
          : "Словарь",
      payload,
      entries: payload.entries,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error, "Не удалось прочитать JSON импорт #DICT."),
    };
  }
}

function parseDictionaryTableImport(
  value: string,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS,
  labels?: DictionaryFieldLabels
): DictionaryImportPreview {
  const delimiter = detectDictionaryTableDelimiter(value);
  const rows = parseDelimitedRows(value, delimiter)
    .map((row) => row.map((cell) => normalizeDictionaryText(cell)))
    .filter((row) => row.some(Boolean));

  if (rows.length === 0) {
    return {
      ok: false,
      error: "В таблице импорта нет строк.",
    };
  }

  const normalizedColumns = normalizeDictionaryColumns(columns, labels);
  const dataRows = isDictionaryTableHeaderRow(rows[0], labels, normalizedColumns)
    ? rows.slice(1)
    : rows;
  const entries: DictionaryEntry[] = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const rowNumber = index + (dataRows.length === rows.length ? 1 : 2);
    const nonEmptyCells = row.filter(Boolean);

    if (nonEmptyCells.length === 0) {
      continue;
    }

    if (
      row.length !== normalizedColumns.length &&
      (row.length < 2 || row.length === 3)
    ) {
      return {
        ok: false,
        error: `Строка ${rowNumber}: нужно 2 или 4 колонки.`,
      };
    }

    const values: Record<string, string> = {};
    if (row.length === normalizedColumns.length) {
      for (
        let columnIndex = 0;
        columnIndex < normalizedColumns.length;
        columnIndex += 1
      ) {
        const column = normalizedColumns[columnIndex];
        if (column) {
          values[column.id] = row[columnIndex] ?? "";
        }
      }
    } else {
      values.side1 = row[0] ?? "";
      values.side1Note = row.length >= 4 ? (row[1] ?? "") : "";
      values.side2 = row.length >= 4 ? (row[2] ?? "") : (row[1] ?? "");
      values.side2Note = row.length >= 4 ? (row[3] ?? "") : "";
    }

    const hasSide1Word = getDictionarySideColumns(
      normalizedColumns,
      "side1",
      "word"
    ).some((column) => values[column.id]);
    const hasSide2Word = getDictionarySideColumns(
      normalizedColumns,
      "side2",
      "word"
    ).some((column) => values[column.id]);

    if (!hasSide1Word || !hasSide2Word) {
      return {
        ok: false,
        error: `Строка ${rowNumber}: заполни обе стороны пары.`,
      };
    }

    entries.push({
      id: `entry-${index + 1}`,
      values,
    });
  }

  const normalizedEntries = normalizeDictionaryEntries(entries, normalizedColumns);
  if (normalizedEntries.length === 0) {
    return {
      ok: false,
      error: "В таблице нет ни одной полной пары слов.",
    };
  }

  return {
    ok: true,
    kind: "table",
    entries: normalizedEntries,
  };
}

function detectDictionaryTableDelimiter(value: string): string {
  const sample = value
    .split(/\r?\n/g)
    .filter((line) => line.trim().length > 0)
    .slice(0, 8)
    .join("\n");
  const candidates = ["\t", ";", ","];

  return candidates
    .map((delimiter) => ({
      delimiter,
      score: sample.split(delimiter).length - 1,
    }))
    .sort((left, right) => right.score - left.score)[0]?.delimiter ?? "\t";
}

function parseDelimitedRows(value: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let isQuoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const nextChar = value[index + 1];

    if (char === "\"") {
      if (isQuoted && nextChar === "\"") {
        cell += "\"";
        index += 1;
      } else {
        isQuoted = !isQuoted;
      }
      continue;
    }

    if (!isQuoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!isQuoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function isDictionaryTableHeaderRow(
  row: string[],
  labels?: DictionaryFieldLabels,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): boolean {
  const normalizedCells = row.map((cell) => cell.trim().toLocaleLowerCase());
  const normalizedLabels = normalizeDictionaryLabels(
    labels,
    columns
  );
  const headerWords = new Set([
    "side1",
    "side 1",
    "side2",
    "side 2",
    "term",
    "definition",
    "термин",
    "определение",
    DEFAULT_DICTIONARY_FIELD_LABELS.side1,
    DEFAULT_DICTIONARY_FIELD_LABELS.side1Note,
    DEFAULT_DICTIONARY_FIELD_LABELS.side2,
    DEFAULT_DICTIONARY_FIELD_LABELS.side2Note,
    ...Object.values(normalizedLabels).map((label) => label.toLocaleLowerCase()),
  ]);

  return normalizedCells.some(
    (cell) =>
      headerWords.has(cell) ||
      cell.includes("сторона") ||
      cell.includes("пояснение")
  );
}

function dictionaryPayloadToTsv(payload: MessageDictionaryPayload): string {
  const normalized = normalizeMessageDictionaryPayload(payload);
  const header = normalized.columns.map((column) =>
    getDictionaryFieldLabel(column.id, normalized.labels, normalized.columns)
  );
  const rows = normalized.entries.map((entry) =>
    normalized.columns.map((column) =>
      getDictionaryEntryFieldText(entry, column.id)
    )
  );

  return [header, ...rows]
    .map((row) => row.map(escapeDictionaryTableCell).join("\t"))
    .join("\n");
}

function escapeDictionaryTableCell(value: string): string {
  if (!/["\t\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

function dictionaryPayloadToPlainText(payload: MessageDictionaryPayload): string {
  const normalized = normalizeMessageDictionaryPayload(payload);
  return [
    normalized.description,
    normalized.tags.join(" "),
    normalized.entries
      .map((entry) =>
        [
          getDictionarySideColumns(normalized.columns, "side1")
            .map((column) => getDictionaryEntryFieldText(entry, column.id))
            .filter(Boolean)
            .join(" / "),
          "-",
          getDictionarySideColumns(normalized.columns, "side2")
            .map((column) => getDictionaryEntryFieldText(entry, column.id))
            .filter(Boolean)
            .join(" / "),
        ]
          .filter(Boolean)
          .join(" ")
      )
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

function oppositeDictionaryPromptSide(
  side: DictionaryPromptSide
): DictionaryPromptSide {
  return side === "side1" ? "side2" : "side1";
}

function makeDefaultDictionaryStudyColumnIndexes(): Record<
  DictionaryPromptSide,
  number
> {
  return { side1: 0, side2: 0 };
}

type DictionaryEntrySideValue = {
  column: DictionaryColumn;
  text: string;
  wordIndex: number;
};

type DictionaryEntrySideWordGroup = {
  word: DictionaryEntrySideValue;
  notes: DictionaryEntrySideValue[];
};

function getDictionaryColumnResolvedWordIndex(
  column: DictionaryColumn,
  columns: DictionaryColumn[]
): number {
  const wordColumns = getDictionarySideColumns(columns, column.side, "word");
  if (column.kind === "word") {
    return Math.max(
      0,
      wordColumns.findIndex((wordColumn) => wordColumn.id === column.id)
    );
  }

  return clampDictionaryColumnWordIndex(column.wordIndex, wordColumns.length);
}

function getDictionaryEntrySideValues(
  entry: DictionaryEntry,
  columns: DictionaryColumn[],
  side: DictionaryPromptSide,
  kind: DictionaryColumnKind
): DictionaryEntrySideValue[] {
  return getDictionarySideColumns(columns, side, kind)
    .map((column) => ({
      column,
      text: getDictionaryEntryFieldText(entry, column.id),
      wordIndex: getDictionaryColumnResolvedWordIndex(column, columns),
    }))
    .filter((item) => Boolean(item.text));
}

function getDictionaryEntrySideWordGroups(
  entry: DictionaryEntry,
  columns: DictionaryColumn[],
  side: DictionaryPromptSide
): DictionaryEntrySideWordGroup[] {
  const notes = getDictionaryEntrySideValues(entry, columns, side, "note");

  return getDictionarySideColumns(columns, side, "word")
    .map((column, wordIndex): DictionaryEntrySideWordGroup | null => {
      const text = getDictionaryEntryFieldText(entry, column.id);
      if (!text) {
        return null;
      }

      return {
        word: {
          column,
          text,
          wordIndex,
        },
        notes: notes.filter((note) => note.wordIndex === wordIndex),
      };
    })
    .filter((group): group is DictionaryEntrySideWordGroup => Boolean(group));
}

function toDictionaryPromptSideLabel(
  side: DictionaryPromptSide,
  labels: DictionaryFieldLabels = DEFAULT_DICTIONARY_FIELD_LABELS,
  columns: DictionaryColumn[] = DEFAULT_DICTIONARY_COLUMNS
): string {
  const wordColumn = columns.find(
    (column) => column.side === side && column.kind === "word"
  );
  return wordColumn
    ? getDictionaryFieldLabel(wordColumn.id, labels, columns)
    : side === "side1"
      ? DEFAULT_DICTIONARY_FIELD_LABELS.side1
      : DEFAULT_DICTIONARY_FIELD_LABELS.side2;
}

function getDictionarySideAutoSpeakFields(
  side: DictionaryPromptSide,
  fields: DictionaryEntryField[],
  columns: DictionaryColumn[]
): DictionaryEntryField[] {
  const allowedFields = new Set(
    getDictionarySideColumns(columns, side).map((column) => column.id)
  );

  return fields.filter((field) => allowedFields.has(field));
}

function shuffleDictionaryEntries(entries: DictionaryEntry[]): DictionaryEntry[] {
  const shuffled = [...entries];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function makeDictionaryStudyProgressKey(options: {
  sourceCategoryId: string;
  sourceMessageId: string | null;
  dictionaryId: string | null;
  title: string;
}): string {
  const sourceKey = options.dictionaryId
    ? `dictionary:${options.dictionaryId}`
    : options.sourceMessageId
      ? `message:${options.sourceMessageId}`
      : `title:${options.title}`;

  return [
    DICTIONARY_STUDY_PROGRESS_STORAGE_PREFIX,
    options.sourceCategoryId,
    sourceKey,
  ]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

function readDictionaryStudyProgress(
  progressKey: string
): DictionaryStudyProgress | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(progressKey);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return null;
    }

    const cardIds = Array.isArray(parsed.cardIds)
      ? parsed.cardIds.filter((id): id is string => typeof id === "string")
      : [];
    const answerResultsByEntryId =
      parseDictionaryStudyAnswerResultsByEntryId(parsed.answerResultsByEntryId);

    return {
      currentIndex:
        typeof parsed.currentIndex === "number" &&
        Number.isFinite(parsed.currentIndex)
          ? Math.max(0, Math.floor(parsed.currentIndex))
          : 0,
      isAnswerRevealed: Boolean(parsed.isAnswerRevealed),
      cardIds,
      shuffle: Boolean(parsed.shuffle),
      progressMode: Boolean(parsed.progressMode),
      progressStartedAt:
        typeof parsed.progressStartedAt === "number" &&
        Number.isFinite(parsed.progressStartedAt)
          ? Math.max(0, parsed.progressStartedAt)
          : Date.now(),
      progressCompletedAt:
        typeof parsed.progressCompletedAt === "number" &&
        Number.isFinite(parsed.progressCompletedAt)
          ? Math.max(0, parsed.progressCompletedAt)
          : null,
      correctCount:
        typeof parsed.correctCount === "number" &&
        Number.isFinite(parsed.correctCount)
          ? Math.max(0, Math.floor(parsed.correctCount))
          : 0,
      wrongCount:
        typeof parsed.wrongCount === "number" && Number.isFinite(parsed.wrongCount)
          ? Math.max(0, Math.floor(parsed.wrongCount))
          : 0,
      answerResultsByEntryId,
      isProgressComplete: Boolean(parsed.isProgressComplete),
    };
  } catch {
    return null;
  }
}

function saveDictionaryStudyProgress(study: DictionaryStudyState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const progress: DictionaryStudyProgress = {
      currentIndex: study.currentIndex,
      isAnswerRevealed: study.isAnswerRevealed,
      cardIds: study.cards.map((entry) => entry.id),
      shuffle: study.shuffle,
      progressMode: study.progressMode,
      progressStartedAt: study.progressStartedAt,
      progressCompletedAt: study.progressCompletedAt,
      correctCount: study.correctCount,
      wrongCount: study.wrongCount,
      answerResultsByEntryId: study.answerResultsByEntryId,
      isProgressComplete: study.isProgressComplete,
    };
    window.localStorage.setItem(study.progressKey, JSON.stringify(progress));
  } catch {
    return;
  }
}

function restoreDictionaryStudyProgress(
  progress: DictionaryStudyProgress | null,
  baseCards: DictionaryEntry[],
  defaultCards: DictionaryEntry[],
  shuffle: boolean,
  progressMode: boolean
): {
  cards: DictionaryEntry[];
  currentIndex: number;
  isAnswerRevealed: boolean;
  progressStartedAt: number;
  progressCompletedAt: number | null;
  correctCount: number;
  wrongCount: number;
  answerResultsByEntryId: Record<string, DictionaryStudyAnswerResult>;
  isProgressComplete: boolean;
} {
  const fresh = {
    cards: defaultCards,
    currentIndex: 0,
    isAnswerRevealed: false,
    progressStartedAt: Date.now(),
    progressCompletedAt: null,
    correctCount: 0,
    wrongCount: 0,
    answerResultsByEntryId: {},
    isProgressComplete: false,
  };

  if (!progress || baseCards.length === 0) {
    return fresh;
  }

  if (progressMode && !progress.progressMode) {
    return fresh;
  }

  const cardsById = new Map(baseCards.map((entry) => [entry.id, entry]));
  const restoredCards =
    shuffle && progress.shuffle
      ? [
          ...progress.cardIds
            .map((id) => cardsById.get(id))
            .filter((entry): entry is DictionaryEntry => Boolean(entry)),
          ...baseCards.filter((entry) => !progress.cardIds.includes(entry.id)),
        ]
      : [...baseCards];
  const cards = restoredCards.length > 0 ? restoredCards : defaultCards;
  const answerResultsByEntryId = normalizeDictionaryStudyAnswerResultsByEntryId(
    progress.answerResultsByEntryId,
    cards
  );
  const counts = getDictionaryStudyAnswerResultCounts(
    answerResultsByEntryId,
    cards
  );
  if (
    progressMode &&
    progress.progressMode &&
    counts.answered === 0 &&
    progress.correctCount + progress.wrongCount > 0
  ) {
    return fresh;
  }

  return {
    cards,
    currentIndex: Math.min(progress.currentIndex, cards.length - 1),
    isAnswerRevealed:
      !progressMode || !progress.isProgressComplete
        ? progress.isAnswerRevealed
        : true,
    progressStartedAt: progress.progressMode
      ? progress.progressStartedAt
      : Date.now(),
    progressCompletedAt:
      progressMode && progress.progressMode ? progress.progressCompletedAt : null,
    correctCount: progressMode && progress.progressMode ? counts.correct : 0,
    wrongCount: progressMode && progress.progressMode ? counts.wrong : 0,
    answerResultsByEntryId:
      progressMode && progress.progressMode ? answerResultsByEntryId : {},
    isProgressComplete:
      progressMode &&
      progress.progressMode &&
      progress.isProgressComplete &&
      counts.answered >= cards.length,
  };
}

function parseDictionaryStudyAnswerResultsByEntryId(
  value: unknown
): Record<string, DictionaryStudyAnswerResult> {
  if (!isObjectRecord(value)) {
    return {};
  }

  const result: Record<string, DictionaryStudyAnswerResult> = {};
  for (const [entryId, answerResult] of Object.entries(value)) {
    if (
      typeof entryId !== "string" ||
      !entryId ||
      (answerResult !== "correct" && answerResult !== "wrong")
    ) {
      continue;
    }

    result[entryId] = answerResult;
  }

  return result;
}

function normalizeDictionaryStudyAnswerResultsByEntryId(
  value: unknown,
  cards: DictionaryEntry[]
): Record<string, DictionaryStudyAnswerResult> {
  const parsed = parseDictionaryStudyAnswerResultsByEntryId(value);
  const allowedIds = new Set(cards.map((entry) => entry.id));
  const result: Record<string, DictionaryStudyAnswerResult> = {};

  for (const [entryId, answerResult] of Object.entries(parsed)) {
    if (allowedIds.has(entryId)) {
      result[entryId] = answerResult;
    }
  }

  return result;
}

function getDictionaryStudyAnswerResultCounts(
  answerResultsByEntryId: Record<string, DictionaryStudyAnswerResult>,
  cards: DictionaryEntry[]
) {
  let correct = 0;
  let wrong = 0;

  for (const entry of cards) {
    const answerResult = answerResultsByEntryId[entry.id];
    if (answerResult === "correct") {
      correct += 1;
    } else if (answerResult === "wrong") {
      wrong += 1;
    }
  }

  return {
    answered: correct + wrong,
    correct,
    wrong,
  };
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} сек.`;
  }

  return `${minutes} мин. ${seconds.toString().padStart(2, "0")} сек.`;
}

function getDictionaryStudyProgressStats(study: DictionaryStudyState) {
  const resultCounts = getDictionaryStudyAnswerResultCounts(
    study.answerResultsByEntryId,
    study.cards
  );
  const answered = resultCounts.answered;
  const completedAt = study.progressCompletedAt ?? Date.now();
  const elapsedMs = Math.max(0, completedAt - study.progressStartedAt);
  const percent = answered > 0 ? Math.round((resultCounts.correct / answered) * 100) : 0;

  return {
    total: study.cards.length,
    answered,
    correct: resultCounts.correct,
    wrong: resultCounts.wrong,
    percent,
    elapsed: formatDuration(elapsedMs),
    average: answered > 0 ? formatDuration(elapsedMs / answered) : "0 сек.",
  };
}

function getDictionaryStudyActiveTextSegments(
  study: DictionaryStudyState,
  mode: "auto" | "manual"
): string[] {
  const currentEntry = study.cards[study.currentIndex] ?? null;
  if (!currentEntry) {
    return [];
  }

  const activeSide = study.isAnswerRevealed
    ? oppositeDictionaryPromptSide(study.promptSide)
    : study.promptSide;

  const fieldsToSpeak =
    mode === "auto"
      ? getDictionarySideAutoSpeakFields(
          activeSide,
          normalizeDictionaryAutoSpeakFields(
            study.autoSpeakFields,
            getDefaultDictionaryAutoSpeakFields(study.columns),
            study.columns
          ),
          study.columns
        )
      : getDictionarySideAutoSpeakFields(
          activeSide,
          normalizeDictionaryManualSpeakFields(
            study.manualSpeakFields,
            getDefaultDictionaryManualSpeakFields(study.columns),
            study.columns
          ),
          study.columns
        );

  return fieldsToSpeak
    .map((field) => getDictionaryEntryFieldText(currentEntry, field))
    .map((text) => text.trim())
    .filter(Boolean);
}

function makeDictionaryStudyEntryIdentity(
  study: DictionaryStudyState,
  entry: DictionaryEntry
): SharedDictionaryEntryIdentity {
  return {
    sourceCategoryId: study.sourceCategoryId,
    sourceMessageId: study.sourceMessageId,
    dictionaryId: study.dictionaryId,
    entryId: entry.id,
  };
}

function dictionaryEntryIdentityKey(identity: SharedDictionaryEntryIdentity): string {
  return [
    identity.sourceCategoryId,
    identity.sourceMessageId ?? "",
    identity.dictionaryId ?? "",
    identity.entryId,
  ].join("\0");
}

function getDictionarySearchResultIdentity(
  result: GlobalDictionarySearchResult
): SharedDictionaryEntryIdentity {
  return {
    sourceCategoryId: result.sourceCategoryId,
    sourceMessageId: result.sourceMessageId,
    dictionaryId: result.dictionaryId,
    entryId: result.entry.id,
  };
}

function findDictionaryGroupsForIdentity(
  groups: DictionaryWordGroup[],
  identity: SharedDictionaryEntryIdentity
): DictionaryWordGroup[] {
  const key = dictionaryEntryIdentityKey(identity);
  return groups.filter((group) =>
    group.items.some((item) => dictionaryEntryIdentityKey(item) === key)
  );
}

function reorderIdListByTarget(source: string[], dragId: string, targetId: string): string[] {
  const dragKey = dragId.trim().toLocaleLowerCase();
  const targetKey = targetId.trim().toLocaleLowerCase();
  if (!dragKey || !targetKey || dragKey === targetKey) {
    return source;
  }

  const fromIndex = source.findIndex((id) => id.toLocaleLowerCase() === dragKey);
  const toIndex = source.findIndex((id) => id.toLocaleLowerCase() === targetKey);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return source;
  }

  const reordered = [...source];
  const [dragged] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, dragged);
  return reordered;
}

function isStringListEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function togglePlainIdSelection(
  source: string[],
  targetId: string,
  checked: boolean
): string[] {
  const normalizedTarget = targetId.trim();
  const current = dedupePlainList(source);

  if (!normalizedTarget) {
    return current;
  }

  const targetKey = normalizedTarget.toLocaleLowerCase();
  const hasTarget = current.some((id) => id.toLocaleLowerCase() === targetKey);

  if (checked) {
    if (hasTarget) {
      return current;
    }

    return [...current, normalizedTarget];
  }

  if (!hasTarget) {
    return current;
  }

  return current.filter((id) => id.toLocaleLowerCase() !== targetKey);
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
    created_at: normalizeTimestamp(message.created_at),
    updated_at: normalizeTimestamp(message.updated_at),
    content: normalizePersistedMessageContent(message.content),
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
  const plainText = richTextToPlainText(content);
  const trimmed = plainText.trim();
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

function makeDictionaryEditorCellKey(
  entryId: string,
  field: DictionaryEntryField
): string {
  return `${entryId}:${field}`;
}

type DictionarySearchToken = {
  text: string;
  start: number;
  end: number;
};

type DictionarySearchMatchKind = "phrase" | "exact" | "prefix" | "substring" | "fuzzy";

type DictionarySearchMatch = {
  start: number;
  end: number;
  isFuzzy: boolean;
  kind: DictionarySearchMatchKind;
  score: number;
};

type CompiledDictionarySearchQuery = {
  query: string;
  tokens: string[];
  significantLength: number;
};

const DICTIONARY_SEARCH_FUZZY_MIN_LENGTH = 5;

function normalizeDictionarySearchText(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function getDictionarySearchTokens(value: string): DictionarySearchToken[] {
  const tokens: DictionarySearchToken[] = [];
  const wordPattern = /[0-9A-Za-zА-Яа-яЁё]+/g;
  let match: RegExpExecArray | null = wordPattern.exec(value);

  while (match) {
    const rawText = match[0];
    tokens.push({
      text: normalizeDictionarySearchText(rawText),
      start: match.index,
      end: match.index + rawText.length,
    });
    match = wordPattern.exec(value);
  }

  return tokens.filter((token) => token.text.length > 0);
}

function compileDictionarySearchQuery(
  query: string
): CompiledDictionarySearchQuery | null {
  const tokens = getDictionarySearchTokens(query).map((token) => token.text);
  const significantLength = tokens.join("").length;
  if (significantLength < 2 || tokens.length === 0) {
    return null;
  }

  return {
    query: normalizeDictionarySearchText(query),
    tokens,
    significantLength,
  };
}

function findDictionaryEditorSearchMatch(
  value: string,
  query: CompiledDictionarySearchQuery
): DictionarySearchMatch | null {
  const valueTokens = getDictionarySearchTokens(value);
  if (query.tokens.length === 0 || valueTokens.length === 0) {
    return null;
  }

  if (query.tokens.length > 1) {
    return findDictionaryPhraseSearchMatch(valueTokens, query.tokens);
  }

  return findDictionarySingleTokenSearchMatch(valueTokens, query.tokens[0] ?? "");
}

function findDictionaryPhraseSearchMatch(
  valueTokens: DictionarySearchToken[],
  queryTokens: string[]
): DictionarySearchMatch | null {
  if (queryTokens.length > valueTokens.length) {
    return null;
  }

  for (
    let valueStartIndex = 0;
    valueStartIndex <= valueTokens.length - queryTokens.length;
    valueStartIndex += 1
  ) {
    const isExactPhrase = queryTokens.every(
      (queryToken, queryIndex) =>
        valueTokens[valueStartIndex + queryIndex]?.text === queryToken
    );

    if (!isExactPhrase) {
      continue;
    }

    const firstToken = valueTokens[valueStartIndex];
    const lastToken = valueTokens[valueStartIndex + queryTokens.length - 1];
    if (!firstToken || !lastToken) {
      return null;
    }

    return {
      start: firstToken.start,
      end: lastToken.end,
      isFuzzy: false,
      kind: "phrase",
      score: 600,
    };
  }

  return null;
}

function findDictionarySingleTokenSearchMatch(
  valueTokens: DictionarySearchToken[],
  queryToken: string
): DictionarySearchMatch | null {
  if (!queryToken) {
    return null;
  }

  const exactToken = valueTokens.find((valueToken) => valueToken.text === queryToken);
  if (exactToken) {
    return {
      start: exactToken.start,
      end: exactToken.end,
      isFuzzy: false,
      kind: "exact",
      score: 500,
    };
  }

  if (queryToken.length <= 2) {
    return null;
  }

  const prefixToken = valueTokens.find((valueToken) =>
    valueToken.text.startsWith(queryToken)
  );
  if (prefixToken) {
    return {
      start: prefixToken.start,
      end: prefixToken.end,
      isFuzzy: false,
      kind: "prefix",
      score: 400,
    };
  }

  if (queryToken.length >= DICTIONARY_SEARCH_FUZZY_MIN_LENGTH) {
    const substringToken = valueTokens.find((valueToken) =>
      valueToken.text.includes(queryToken)
    );
    if (substringToken) {
      return {
        start: substringToken.start,
        end: substringToken.end,
        isFuzzy: false,
        kind: "substring",
        score: 300,
      };
    }
  }

  if (queryToken.length < DICTIONARY_SEARCH_FUZZY_MIN_LENGTH) {
    return null;
  }

  const maxDistance = getDictionarySearchMaxDistance(queryToken.length);
  let bestFuzzyToken: DictionarySearchToken | null = null;
  let bestDistance = maxDistance + 1;

  for (const valueToken of valueTokens) {
    if (Math.abs(queryToken.length - valueToken.text.length) > maxDistance) {
      continue;
    }

    const distance = getBoundedLevenshteinDistance(
      queryToken,
      valueToken.text,
      maxDistance
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestFuzzyToken = valueToken;
    }
  }

  if (!bestFuzzyToken || bestDistance > maxDistance) {
    return null;
  }

  return {
    start: bestFuzzyToken.start,
    end: bestFuzzyToken.end,
    isFuzzy: true,
    kind: "fuzzy",
    score: 100 - bestDistance,
  };
}

function getDictionarySearchMaxDistance(length: number): number {
  if (length <= 8) {
    return 1;
  }

  return 2;
}

function getBoundedLevenshteinDistance(
  left: string,
  right: string,
  maxDistance: number
): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const nextDistance = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );

      current[rightIndex] = nextDistance;
      rowMinimum = Math.min(rowMinimum, nextDistance);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[right.length];
}

function wrapIndex(value: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return ((value % length) + length) % length;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isInternalAccountImageUrl(value: string): boolean {
  return /^\/api\/account\/images\/[0-9a-f-]{36}$/i.test(value.trim());
}

function isDisplayImageUrl(value: string): boolean {
  return isValidHttpUrl(value) || isInternalAccountImageUrl(value);
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

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
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
  const firstLine = richTextToPlainText(content)
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

function makeDictionaryExportFileName(title: string, extension: "json" | "tsv"): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  const base = normalized.length > 0 ? normalized : "dict";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${base}-dict-${stamp}.${extension}`;
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(blobUrl);
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

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16 8.5a4 4 0 0 1 0 7" />
      <path d="M18.5 6a7 7 0 0 1 0 12" />
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
