import assert from "node:assert/strict";
import test from "node:test";

import { shouldKeepCategoryPanelOpen } from "./workspace-navigation.ts";

test("category name drills into the level and keeps its mobile panel open", () => {
  assert.equal(shouldKeepCategoryPanelOpen("drill", "categories"), true);
});

test("category arrow enters content and closes its mobile panel", () => {
  assert.equal(shouldKeepCategoryPanelOpen("enter", "categories"), false);
});

test("back navigation keeps the category panel open", () => {
  assert.equal(shouldKeepCategoryPanelOpen("back", "categories"), true);
});
