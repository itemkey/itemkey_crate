import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const workspaceRoot = process.cwd();
const manifestPath = join(
  workspaceRoot,
  ".next",
  "server",
  "app",
  "crate",
  "page_client-reference-manifest.js"
);
const source = readFileSync(manifestPath, "utf8");
const marker = 'globalThis.__RSC_MANIFEST["/crate/page"] = ';
const markerIndex = source.indexOf(marker);
if (markerIndex < 0) {
  throw new Error("The /crate client reference manifest was not found. Run a production build first.");
}
const jsonStart = markerIndex + marker.length;
const jsonEnd = source.indexOf(";", jsonStart);
const manifest = JSON.parse(source.slice(jsonStart, jsonEnd));
const entries = manifest.entryJSFiles ?? {};
const crateEntry = Object.entries(entries).find(([key]) => key.endsWith("/app/crate/page"));
const layoutEntry = Object.entries(entries).find(([key]) => key.endsWith("/app/layout"));
if (!crateEntry) throw new Error("The /crate eager JS entry is missing from the build manifest.");

const crateFiles = [...new Set(crateEntry[1])];
const sharedFiles = new Set(layoutEntry?.[1] ?? []);
const ownFiles = crateFiles.filter((file) => !sharedFiles.has(file));

function gzipBytes(file) {
  const buffer = readFileSync(join(workspaceRoot, ".next", file));
  return gzipSync(buffer, { level: 9 }).byteLength;
}

const ownBytes = ownFiles.reduce((total, file) => total + gzipBytes(file), 0);
const totalBytes = crateFiles.reduce((total, file) => total + gzipBytes(file), 0);
const ownBudget = 70 * 1024;
const totalBudget = 230 * 1024;
const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB gzip`;

console.log(`crate own eager JS: ${formatKb(ownBytes)} / ${formatKb(ownBudget)}`);
console.log(`crate full eager JS: ${formatKb(totalBytes)} / ${formatKb(totalBudget)}`);
for (const file of crateFiles) {
  console.log(`  ${file}: ${formatKb(gzipBytes(file))} (${statSync(join(workspaceRoot, ".next", file)).size} bytes raw)`);
}

if (ownBytes > ownBudget || totalBytes > totalBudget) {
  process.exitCode = 1;
}
