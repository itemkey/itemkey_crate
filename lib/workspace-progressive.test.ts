import assert from "node:assert/strict";
import test from "node:test";

import type { CategoryDetailPayload, CategoryRow, CategorySummaryRow } from "./types.ts";
import {
  buildWorkspaceTree,
  LatestRequestController,
  mergeWorkspaceSummaries,
  toCategorySummary,
} from "./workspace-progressive.ts";

function category(
  id: string,
  parentId: string | null,
  overrides: Partial<CategoryRow> = {}
): CategoryRow {
  return {
    id,
    workspace_id: "workspace",
    parent_id: parentId,
    title: id,
    content: `large content for ${id}`,
    description: "",
    tag: "",
    format: "continuous",
    category_type: "learning",
    position: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("summary never includes category content", () => {
  const summary = toCategorySummary(category("main", null));
  assert.equal("content" in summary, false);
});

test("tree includes local and mounted public descendants", () => {
  const rows: CategorySummaryRow[] = [
    toCategorySummary(category("main", null)),
    toCategorySummary(category("local", "main")),
    toCategorySummary(category("public-root", "main", { visibility: "public" })),
    toCategorySummary(category("public-child", "public-root", { visibility: "public" })),
  ];
  const tree = buildWorkspaceTree(rows);
  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0].children.map((node) => node.id), ["local", "public-root"]);
  assert.equal(tree[0].children[1].children[0].id, "public-child");
});

test("empty workspace tree is valid", () => {
  assert.deepEqual(buildWorkspaceTree([]), []);
});

test("summary refresh preserves an unsynchronized detail draft", () => {
  const original = category("main", null);
  const draft = { ...original, content: "unsynchronized draft" };
  const detail: CategoryDetailPayload = { category: draft, messages: [] };
  const remote = [
    toCategorySummary({ ...original, updated_at: "2026-01-02T00:00:00.000Z" }),
  ];
  const merged = mergeWorkspaceSummaries(remote, { main: detail }, new Set(["main"]));
  assert.equal(merged.details.main.category.content, "unsynchronized draft");
});

test("starting a newer request aborts and invalidates the older request", () => {
  const requests = new LatestRequestController();
  const first = requests.start();
  const second = requests.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(requests.isCurrent(first), false);
  assert.equal(requests.isCurrent(second), true);
});

test("large workspace shell size is independent from total saved content", () => {
  const smallRows = Array.from({ length: 2_000 }, (_, index) =>
    category(`category-${index}`, index === 0 ? null : "category-0", {
      content: "x",
      position: index,
    })
  );
  const largeRows = smallRows.map((row) => ({
    ...row,
    content: "private-material".repeat(1_000),
  }));
  const smallShell = JSON.stringify(smallRows.map(toCategorySummary));
  const largeShell = JSON.stringify(largeRows.map(toCategorySummary));
  assert.equal(largeShell.length, smallShell.length);
  assert.equal(largeShell.includes("private-material"), false);
});
