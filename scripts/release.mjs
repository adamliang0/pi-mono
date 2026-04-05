#!/usr/bin/env node
/**
 * Release script for pi-mono
 *
 * Usage: node scripts/release.mjs <major|minor|patch>
 *
 * Environment:
 *   SKIP_NPM_PUBLISH=1  Skip npm publish (GitHub-binary-only releases).
 *   RELEASE_REMOTE      Remote name (default: origin).
 *   RELEASE_BRANCH      Branch to push (default: main).
 *
 * Steps:
 * 1. Check for uncommitted changes
 * 2. Bump version via bun run version:xxx
 * 3. Update CHANGELOG.md files: [Unreleased] -> [version] - date
 * 4. Commit and tag
 * 5. Publish to npm (unless SKIP_NPM_PUBLISH=1)
 * 6. Add new [Unreleased] section to changelogs
 * 7. Commit
 * 8. Push branch and tag
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { addUnreleasedSection, updateChangelogsForRelease } from "./changelog-release.mjs";

const BUMP_TYPE = process.argv[2];
const SKIP_NPM_PUBLISH = process.env.SKIP_NPM_PUBLISH === "1" || process.env.SKIP_NPM_PUBLISH === "true";
const RELEASE_REMOTE = process.env.RELEASE_REMOTE || "origin";
const RELEASE_BRANCH = process.env.RELEASE_BRANCH || "main";

if (!["major", "minor", "patch"].includes(BUMP_TYPE)) {
  console.error("Usage: node scripts/release.mjs <major|minor|patch>");
  process.exit(1);
}

function run(cmd, options = {}) {
  console.log(`$ ${cmd}`);
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: options.silent ? "pipe" : "inherit", ...options });
  } catch (e) {
    if (!options.ignoreError) {
      console.error(`Command failed: ${cmd}`);
      process.exit(1);
    }
    return null;
  }
}

function getVersion() {
  const pkg = JSON.parse(readFileSync("packages/ai/package.json", "utf-8"));
  return pkg.version;
}

// Main flow
console.log("\n=== Release Script ===\n");

// 1. Check for uncommitted changes
console.log("Checking for uncommitted changes...");
const status = run("git status --porcelain", { silent: true });
if (status && status.trim()) {
  console.error("Error: Uncommitted changes detected. Commit or stash first.");
  console.error(status);
  process.exit(1);
}
console.log("  Working directory clean\n");

// 2. Bump version
console.log(`Bumping version (${BUMP_TYPE})...`);
run(`bun run version:${BUMP_TYPE}`);
const version = getVersion();
console.log(`  New version: ${version}\n`);

// 3. Update changelogs
console.log("Updating CHANGELOG.md files...");
updateChangelogsForRelease(version);
console.log();

// 4. Commit and tag
console.log("Committing and tagging...");
run("git add .");
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);
console.log();

// 5. Publish
if (SKIP_NPM_PUBLISH) {
  console.log("Skipping npm publish (SKIP_NPM_PUBLISH set)\n");
} else {
  console.log("Publishing to npm...");
  run("bun run publish");
  console.log();
}

// 6. Add new [Unreleased] sections
console.log("Adding [Unreleased] sections for next cycle...");
addUnreleasedSection();
console.log();

// 7. Commit
console.log("Committing changelog updates...");
run("git add .");
run(`git commit -m "Add [Unreleased] section for next cycle"`);
console.log();

// 8. Push
console.log("Pushing to remote...");
run(`git push ${RELEASE_REMOTE} ${RELEASE_BRANCH}`);
run(`git push ${RELEASE_REMOTE} v${version}`);
console.log();

console.log(`=== Released v${version} ===`);
