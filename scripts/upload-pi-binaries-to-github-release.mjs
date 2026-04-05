#!/usr/bin/env node
/**
 * Create or update a GitHub Release and upload pi binary archives (no Actions).
 *
 * Prerequisites: `gh auth login`, full repo clone at repo root, and archives from:
 *   ./scripts/build-binaries.sh
 *
 * Usage:
 *   node scripts/upload-pi-binaries-to-github-release.mjs [vX.Y.Z]
 * If the tag is omitted, uses packages/ai/package.json version with a v prefix.
 */
import { spawnSync } from "node:child_process";
import { execFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ASSETS = [
  "pi-darwin-arm64.tar.gz",
  "pi-darwin-x64.tar.gz",
  "pi-linux-x64.tar.gz",
  "pi-linux-arm64.tar.gz",
  "pi-windows-x64.zip",
];

function resolveTag() {
  const arg = process.argv[2];
  if (arg) {
    if (arg.startsWith("v")) {
      return arg;
    }
    return `v${arg}`;
  }
  const raw = readFileSync(join("packages", "ai", "package.json"), "utf-8");
  const version = JSON.parse(raw).version;
  return `v${version}`;
}

function extractReleaseNotes(versionWithoutV, changelogPath) {
  let out = "";
  try {
    out = execFileSync(
      "awk",
      [`/^## \\[${versionWithoutV}\\]/{flag=1; next} /^## \\[/{flag=0} flag`, changelogPath],
      { encoding: "utf-8" },
    ).trim();
  } catch {
    out = "";
  }
  if (!out) {
    return `Release ${versionWithoutV}\n`;
  }
  return `${out}\n`;
}

const tag = resolveTag();
let versionWithoutV = tag;
if (tag.startsWith("v")) {
  versionWithoutV = tag.slice(1);
}
const repoRoot = process.cwd();
const binariesDir = join(repoRoot, "packages", "coding-agent", "binaries");
const changelogPath = join(repoRoot, "packages", "coding-agent", "CHANGELOG.md");

for (const name of ASSETS) {
  const p = join(binariesDir, name);
  if (!existsSync(p)) {
    console.error(`Missing ${p}\nRun from repo root: ./scripts/build-binaries.sh`);
    process.exit(1);
  }
}

const notesPath = join(tmpdir(), `pi-release-notes-${versionWithoutV}.md`);
writeFileSync(notesPath, extractReleaseNotes(versionWithoutV, changelogPath));

const assetPaths = ASSETS.map((name) => join(binariesDir, name));

console.log(`Uploading ${ASSETS.length} assets for ${tag}…`);

const createArgs = ["release", "create", tag, "--title", tag, "--notes-file", notesPath, ...assetPaths];
const createResult = spawnSync("gh", createArgs, { stdio: "inherit", cwd: repoRoot });

if (createResult.status === 0) {
  console.log(`Created release ${tag}.`);
  process.exit(0);
}

const uploadArgs = ["release", "upload", tag, ...assetPaths, "--clobber"];
const uploadResult = spawnSync("gh", uploadArgs, { stdio: "inherit", cwd: repoRoot });
if (uploadResult.status !== 0) {
  const code = uploadResult.status;
  if (code === null) {
    process.exit(1);
  }
  process.exit(code);
}
console.log(`Uploaded assets to existing release ${tag}.`);
