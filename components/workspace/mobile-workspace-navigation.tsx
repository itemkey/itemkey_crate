"use client";

import type { ReactNode } from "react";

type NavigationLabels = {
  back: string;
  categories: string;
  add: string;
  search: string;
  more: string;
  projects: string;
  tools: string;
  settings: string;
  account: string;
  close: string;
  navigation: string;
};

export function MobileWorkspaceDock({
  labels,
  searchIcon,
  canGoBack,
  canAdd,
  canSearch,
  onBack,
  onCategories,
  onAdd,
  onSearch,
  onMore,
}: {
  labels: NavigationLabels;
  searchIcon: ReactNode;
  canGoBack: boolean;
  canAdd: boolean;
  canSearch: boolean;
  onBack: () => void;
  onCategories: () => void;
  onAdd: () => void;
  onSearch: () => void;
  onMore: () => void;
}) {
  return (
    <nav className="mobile-dock mobile-only" aria-label={labels.navigation}>
      <button
        type="button"
        className="mobile-dock-action tool-red"
        onClick={onBack}
        disabled={!canGoBack}
      >
        <span aria-hidden="true">←</span>
        <small>{labels.back}</small>
      </button>
      <button
        type="button"
        className="mobile-dock-action tool-blue"
        onClick={onCategories}
        disabled={!canSearch}
      >
        <span aria-hidden="true">▦</span>
        <small>{labels.categories}</small>
      </button>
      <button
        type="button"
        className="mobile-dock-action tool-green"
        onClick={onAdd}
        disabled={!canAdd}
      >
        <span aria-hidden="true">+</span>
        <small>{labels.add}</small>
      </button>
      <button
        type="button"
        className="mobile-dock-action tool-yellow"
        onClick={onSearch}
        disabled={!canSearch}
      >
        {searchIcon}
        <small>{labels.search}</small>
      </button>
      <button type="button" className="mobile-dock-action tool-red" onClick={onMore}>
        <span aria-hidden="true">•••</span>
        <small>{labels.more}</small>
      </button>
    </nav>
  );
}

export function MobileMorePanel({
  labels,
  toolsDisabled,
  settingsDisabled,
  onClose,
  onProjects,
  onTools,
  onSettings,
  onAccount,
}: {
  labels: NavigationLabels;
  toolsDisabled: boolean;
  settingsDisabled: boolean;
  onClose: () => void;
  onProjects: () => void;
  onTools: () => void;
  onSettings: () => void;
  onAccount: () => void;
}) {
  return (
    <aside className="mobile-sheet mobile-more-sheet mobile-only">
      <div className="mobile-panel-head">
        <span className="font-display">{labels.more}</span>
        <button
          type="button"
          className="menu-action h-9 w-9 text-xl"
          onClick={onClose}
          aria-label={labels.close}
        >
          x
        </button>
      </div>
      <div className="mobile-more-grid">
        <button type="button" onClick={onProjects}>
          <span aria-hidden="true">#</span>
          {labels.projects}
        </button>
        <button type="button" onClick={onTools} disabled={toolsDisabled}>
          <span aria-hidden="true">+</span>
          {labels.tools}
        </button>
        <button type="button" onClick={onSettings} disabled={settingsDisabled}>
          <span aria-hidden="true">⚙</span>
          {labels.settings}
        </button>
        <button type="button" onClick={onAccount}>
          <span aria-hidden="true">@</span>
          {labels.account}
        </button>
      </div>
    </aside>
  );
}
