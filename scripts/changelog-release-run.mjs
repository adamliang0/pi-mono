#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { addUnreleasedSection, updateChangelogsForRelease } from "./changelog-release.mjs";

const cmd = process.argv[2];
if (cmd === "finalize") {
  const version = JSON.parse(readFileSync("packages/ai/package.json", "utf-8")).version;
  console.log(`Finalizing changelogs for v${version}...`);
  updateChangelogsForRelease(version);
  process.exit(0);
}

if (cmd === "add-unreleased") {
  console.log("Adding [Unreleased] sections...");
  addUnreleasedSection();
  process.exit(0);
}

console.error("Usage: node scripts/changelog-release-run.mjs <finalize|add-unreleased>");
process.exit(1);
