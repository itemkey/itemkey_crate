import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const workspaceRoot = process.cwd();
const manifestPath = join(
  workspaceRoot,
  ".next",
  "server",
  "app",
  "planner",
  "page_client-reference-manifest.js"
);
const source = readFileSync(manifestPath, "utf8");
const marker = 'globalThis.__RSC_MANIFEST["/planner/page"] = ';
const markerIndex = source.indexOf(marker);
if (markerIndex < 0) {
  throw new Error("The /planner client reference manifest was not found. Run a production build first.");
}
const jsonStart = markerIndex + marker.length;
const jsonEnd = source.indexOf(";", jsonStart);
const manifest = JSON.parse(source.slice(jsonStart, jsonEnd));
const entries = manifest.entryJSFiles ?? {};
const plannerEntry = Object.entries(entries).find(([key]) => key.endsWith("/app/planner/page"));
const layoutEntry = Object.entries(entries).find(([key]) => key.endsWith("/app/layout"));
if (!plannerEntry) throw new Error("The /planner eager JS entry is missing from the build manifest.");

const plannerFiles = [...new Set(plannerEntry[1])];
const sharedFiles = new Set(layoutEntry?.[1] ?? []);
const ownFiles = plannerFiles.filter((file) => !sharedFiles.has(file));

function gzipBytes(file) {
  const buffer = readFileSync(join(workspaceRoot, ".next", file));
  return gzipSync(buffer, { level: 9 }).byteLength;
}

const ownBytes = ownFiles.reduce((total, file) => total + gzipBytes(file), 0);
const totalBytes = plannerFiles.reduce((total, file) => total + gzipBytes(file), 0);
const ownBudget = 65 * 1024;
const totalBudget = 230 * 1024;
const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB gzip`;

console.log(`planner own eager JS: ${formatKb(ownBytes)} / ${formatKb(ownBudget)}`);
console.log(`planner full eager JS: ${formatKb(totalBytes)} / ${formatKb(totalBudget)}`);
for (const file of plannerFiles) {
  console.log(`  ${file}: ${formatKb(gzipBytes(file))} (${statSync(join(workspaceRoot, ".next", file)).size} bytes raw)`);
}

if (ownBytes > ownBudget || totalBytes > totalBudget) {
  process.exitCode = 1;
}
