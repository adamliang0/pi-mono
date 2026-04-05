#!/usr/bin/env node
/**
 * Shared changelog steps for release.mjs and CI (finalize [Unreleased] -> [version], add next [Unreleased]).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function getChangelogs() {
  const packagesDir = "packages";
  const packages = readdirSync(packagesDir);
  return packages
    .map((pkg) => join(packagesDir, pkg, "CHANGELOG.md"))
    .filter((path) => existsSync(path));
}

export function updateChangelogsForRelease(version) {
  const date = new Date().toISOString().split("T")[0];
  const changelogs = getChangelogs();

  for (const changelog of changelogs) {
    const content = readFileSync(changelog, "utf-8");

    if (!content.includes("## [Unreleased]")) {
      console.log(`  Skipping ${changelog}: no [Unreleased] section`);
      continue;
    }

    const updated = content.replace("## [Unreleased]", `## [${version}] - ${date}`);
    writeFileSync(changelog, updated);
    console.log(`  Updated ${changelog}`);
  }
}

export function addUnreleasedSection() {
  const changelogs = getChangelogs();
  const unreleasedSection = "## [Unreleased]\n\n";

  for (const changelog of changelogs) {
    const content = readFileSync(changelog, "utf-8");
    const updated = content.replace(/^(# Changelog\n\n)/, `$1${unreleasedSection}`);
    writeFileSync(changelog, updated);
    console.log(`  Added [Unreleased] to ${changelog}`);
  }
}
