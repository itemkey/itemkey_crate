import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativeFromRepository: string): string {
  return readFileSync(new URL(`../../${relativeFromRepository}`, import.meta.url), "utf8");
}

const store = source("lib/planner/store.ts");
const plannerUpgrade = source("postgres/planner-upgrade.sql");
const freshSchema = source("postgres/schema.sql");
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
  "app/api/planner/reset/route.ts",
  "app/api/planner/sleep/check-in/route.ts",
];

test("every planner mutation route authenticates the request and emits planner sync", () => {
  for (const route of mutationRoutes) {
    const content = source(route);
    assert.match(content, /getRequestUser\(request\)/, `${route} must authenticate`);
    if (!route.endsWith("proposals/route.ts")) {
      assert.match(content, /kind:\s*"planner"/, `${route} must publish planner sync`);
    }
    assert.match(content, /assertPlannerCsrf\(request\)/, `${route} must validate CSRF`);
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
    "app/api/planner/reset/route.ts",
    "app/api/planner/sleep/check-in/route.ts",
  ]) {
    assert.match(source(route), /assertPlannerRevision/, `${route} must validate expected revision`);
  }
  assert.match(store, /Number\(row\.base_revision\) !== current\.revision/);
  assert.match(store, /throw new PlannerRevisionError\(\)/);
});

test("assistant parsing stays private and reset verifies password, revision and rate limits", () => {
  const assistant = source("app/api/planner/assistant/parse/route.ts");
  const reset = source("app/api/planner/reset/route.ts");
  assert.match(assistant, /getRequestUser\(request\)/);
  assert.match(assistant, /assertPlannerCsrf\(request\)/);
  assert.match(reset, /assertPlannerRevision/);
  assert.match(reset, /assertAuthRateLimit/);
  assert.match(reset, /planner_reset/);
  assert.match(store, /verifyPassword\(password, rows\[0\]\.password_hash\)/);
  assert.match(store, /delete from public\.planner_sleep_events/);
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

test("planner upgrade is idempotent and fresh installs include protected sleep", () => {
  assert.match(plannerUpgrade, /add column if not exists sleep_schedule/);
  assert.match(plannerUpgrade, /create table if not exists public\.planner_sleep_events/);
  assert.match(plannerUpgrade, /add column if not exists restedness/);
  assert.match(plannerUpgrade, /add column if not exists estimated_start_from_at/);
  assert.match(plannerUpgrade, /add column if not exists planning_policy/);
  assert.match(plannerUpgrade, /add column if not exists deadline_type/);
  assert.match(plannerUpgrade, /set deadline_type = 'target'/);
  assert.match(plannerUpgrade, /add column if not exists milestones/);
  assert.match(plannerUpgrade, /add column if not exists allowed_windows/);
  assert.match(plannerUpgrade, /add column if not exists uncertainty_policy/);
  assert.match(plannerUpgrade, /add column if not exists commitment_level/);
  assert.match(plannerUpgrade, /add column if not exists planning_rank/);
  assert.match(plannerUpgrade, /add column if not exists role/);
  assert.match(plannerUpgrade, /add column if not exists soft/);
  assert.match(plannerUpgrade, /add column if not exists planned_duration_minutes/);
  assert.match(plannerUpgrade, /add column if not exists sleepiness_level/);
  assert.match(plannerUpgrade, /activation_transition/);
  assert.match(plannerUpgrade, /planner_reset/);
  assert.doesNotMatch(plannerUpgrade, /drop table if exists public\.planner_(?:profiles|items|blocks|sleep_events)/);
  assert.match(freshSchema, /create table public\.planner_sleep_events/);
  assert.match(freshSchema, /event_kind text not null default 'sleep_change'/);
  assert.match(freshSchema, /assistant_setup_version integer not null default 0/);
  assert.match(freshSchema, /planning_policy jsonb not null/);
  assert.match(freshSchema, /deadline_type text not null default 'none'/);
  assert.match(freshSchema, /allowed_windows jsonb not null default '\[\]'/);
  assert.match(freshSchema, /uncertainty_policy jsonb not null default '\{\}'/);
  assert.match(freshSchema, /commitment_level text not null default 'required'/);
  assert.match(freshSchema, /role text not null default 'work'/);
  assert.match(freshSchema, /sleepiness_level integer null/);
  assert.match(freshSchema, /activation_transition/);
});

test("planner store repairs additive schema changes before serving requests", () => {
  assert.match(store, /async function ensurePlannerSchema/);
  assert.match(store, /alter table if exists public\.planner_items/);
  assert.match(store, /add column if not exists allowed_windows/);
  assert.match(store, /planner_sleep_events_selection_reason_check/);
  assert.match(store, /activation_transition/);
  assert.match(store, /add column if not exists uncertainty_policy/);
  assert.match(store, /add column if not exists commitment_level/);
  assert.match(store, /add column if not exists role/);
  assert.match(store, /await ensurePlannerSchema\(getPostgresPool\(\)\)/);
});
