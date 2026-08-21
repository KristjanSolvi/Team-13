import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = git(["rev-parse", "--show-toplevel"], appRoot).trim();
const manifestPath = join(appRoot, "lovable-sync.json");
const lockPath = join(appRoot, "lovable-sync.lock.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const lock = existsSync(lockPath)
  ? JSON.parse(readFileSync(lockPath, "utf8"))
  : { lastReviewedCommit: null, lastSafeAppliedCommit: null, reviewedAt: null };
const upstreamRef = `${manifest.remote}/${manifest.branch}`;
const upstreamCommit = git(["rev-parse", upstreamRef], repoRoot).trim();
const args = new Set(process.argv.slice(2));

const changed = changedPaths(lock.lastReviewedCommit, upstreamRef);
const groups = { safe: [], review: [], protected: [] };
for (const entry of changed) groups[classify(entry.path)].push(entry);

console.log(`Lovable source: ${upstreamRef} (${upstreamCommit.slice(0, 8)})`);
console.log(
  `Last reviewed: ${lock.lastReviewedCommit?.slice(0, 8) ?? "none"} · ${changed.length} changed path(s)`,
);
printGroup("SAFE TO COPY", groups.safe);
printGroup("MANUAL UI REVIEW", groups.review);
printGroup("TEAM-13 PROTECTED", groups.protected);

if (args.has("--apply-safe")) {
  for (const entry of groups.safe) {
    if (entry.status.startsWith("D")) {
      console.log(`SKIP DELETE ${entry.path} (deletions always require review)`);
      continue;
    }
    const content = gitBuffer(["show", `${upstreamRef}:${entry.path}`], repoRoot);
    const target = join(appRoot, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(`COPIED ${entry.path}`);
  }
  writeLock({ ...lock, lastSafeAppliedCommit: upstreamCommit });
}

if (args.has("--mark-reviewed")) {
  writeLock({
    ...lock,
    lastReviewedCommit: upstreamCommit,
    lastSafeAppliedCommit: args.has("--apply-safe") ? upstreamCommit : lock.lastSafeAppliedCommit,
    reviewedAt: new Date().toISOString(),
  });
  console.log(`MARKED REVIEWED ${upstreamCommit}`);
}

function changedPaths(base, head) {
  const output = base
    ? git(["diff", "--name-status", `${base}..${head}`], repoRoot)
    : git(["show", "--pretty=format:", "--name-status", head], repoRoot);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split("\t");
      const status = fields[0] ?? "?";
      const path = fields.at(-1) ?? "";
      return { status, path };
    })
    .filter((entry) => entry.path.length > 0);
}

function classify(path) {
  if (manifest.protectedPaths.some((prefix) => matches(path, prefix))) return "protected";
  if (manifest.safePaths.some((prefix) => matches(path, prefix))) return "safe";
  return "review";
}

function matches(path, configured) {
  return configured.endsWith("/") ? path.startsWith(configured) : path === configured;
}

function printGroup(label, entries) {
  console.log(`\n${label} (${entries.length})`);
  for (const entry of entries) console.log(`  ${entry.status.padEnd(4)} ${entry.path}`);
}

function writeLock(value) {
  writeFileSync(lockPath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function gitBuffer(args, cwd) {
  return execFileSync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
}
