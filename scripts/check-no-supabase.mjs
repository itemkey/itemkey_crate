import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPT_RELATIVE_PATH = path.join("scripts", "check-no-supabase.mjs");

const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "out",
  "build",
  "coverage",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".mp3",
]);

const SUPABASE_PATTERN = /(@supabase\/|SUPABASE_[A-Z_]*|supabase\.co)/;

const matches = [];

function walk(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    const relativePath = path.relative(ROOT, absolutePath);
    const normalizedRelativePath = relativePath.split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      walk(absolutePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (normalizedRelativePath === SCRIPT_RELATIVE_PATH.split(path.sep).join("/")) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (BINARY_EXTENSIONS.has(extension)) {
      continue;
    }

    const stat = statSync(absolutePath);
    if (stat.size > 2 * 1024 * 1024) {
      continue;
    }

    let content;
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }

    const found = SUPABASE_PATTERN.exec(content);
    if (!found) {
      continue;
    }

    const prefix = content.slice(0, found.index);
    const line = prefix.split("\n").length;
    matches.push(`${normalizedRelativePath}:${line}`);
  }
}

walk(ROOT);

if (matches.length > 0) {
  console.error("Supabase references detected:");
  for (const match of matches) {
    console.error(`- ${match}`);
  }
  process.exit(1);
}

console.log("OK: no Supabase references in source tree.");
