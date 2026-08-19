import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativeFromRepository: string): string {
  return readFileSync(new URL(`../../${relativeFromRepository}`, import.meta.url), "utf8");
}

const store = source("lib/planner/store.ts");
const mutationRoutes = [
  "app/api/planner/settings/route.ts",
  "app/api/planner/items/route.ts",
  "app/api/planner/items/[id]/route.ts",
  "app/api/planner/blocks/[id]/route.ts",
  "app/api/planner/blocks/[id]/action/route.ts",
  "app/api/planner/proposals/route.ts",
  "app/api/planner/proposals/[id]/apply/route.ts",
  "app/api/planner/change-sets/[id]/undo/route.ts",
  "app/api/planner/legacy-import/route.ts",
];

test("every planner mutation route authenticates the request and emits planner sync", () => {
  for (const route of mutationRoutes) {
    const content = source(route);
    assert.match(content, /getRequestUser\(request\)/, `${route} must authenticate`);
    if (!route.endsWith("proposals/route.ts")) {
      assert.match(content, /kind:\s*"planner"/, `${route} must publish planner sync`);
    }
  }
});

test("direct mutations require a revision while proposal apply verifies its base revision", () => {
  for (const route of [
    "app/api/planner/settings/route.ts",
    "app/api/planner/items/route.ts",
    "app/api/planner/items/[id]/route.ts",
    "app/api/planner/blocks/[id]/route.ts",
    "app/api/planner/blocks/[id]/action/route.ts",
    "app/api/planner/legacy-import/route.ts",
  ]) {
    assert.match(source(route), /assertPlannerRevision/, `${route} must validate expected revision`);
  }
  assert.match(store, /Number\(row\.base_revision\) !== current\.revision/);
  assert.match(store, /throw new PlannerRevisionError\(\)/);
});

test("proposal application and undo are transactional and account-scoped", () => {
  assert.match(store, /await client\.query\("BEGIN"\)/);
  assert.match(store, /await client\.query\("COMMIT"\)/);
  assert.match(store, /await client\.query\("ROLLBACK"\)/);
  assert.match(store, /where id=\$1::uuid and app_user_id=\$2::uuid for update/);
  assert.match(store, /where id=\$1::uuid and app_user_id=\$2::uuid and undone_at is null for update/);
  assert.match(store, /Number\(change\.to_revision\) !== current\.revision/);
});

test("legacy import is idempotent and never mutates legacy category/message tables", () => {
  const legacyStoreSection = store.slice(store.indexOf("async importLegacy"));
  assert.match(legacyStoreSection, /on conflict \(app_user_id,source_key\) do nothing/);
  assert.doesNotMatch(legacyStoreSection, /(?:update|delete from) public\.(?:categories|category_messages)/i);
});
