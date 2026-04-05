#!/usr/bin/env node
/**
 * Compile packages/coding-agent to a Bun standalone binary and ship runtime assets
 * next to it (same layout as scripts/build-binaries.sh).
 *
 * Usage:
 *   node scripts/compile-pi-to-bin.mjs              # outfile: <repo>/bin/pi
 *   node scripts/compile-pi-to-bin.mjs --out-dir dist   # cwd-relative (e.g. from packages/coding-agent)
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const caDir = join(repoRoot, "packages", "coding-agent");
const entry = join(caDir, "dist", "bun", "cli.js");

function parseOutDir() {
  const argv = process.argv.slice(2);
  let outDir = join(repoRoot, "bin");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir" && argv[i + 1]) {
      outDir = resolve(process.cwd(), argv[i + 1]);
      i++;
    }
  }
  return outDir;
}

function syncAssets(outDir) {
  const themeSrc = join(caDir, "dist", "modes", "interactive", "theme");
  const exportSrc = join(caDir, "dist", "core", "export-html");
  const requireFromCa = createRequire(join(caDir, "package.json"));
  let wasmSrc;
  try {
    const photonPkg = requireFromCa.resolve("@silvia-odwyer/photon-node/package.json");
    wasmSrc = join(dirname(photonPkg), "photon_rs_bg.wasm");
  } catch {
    wasmSrc = join(
      repoRoot,
      "node_modules",
      "@silvia-odwyer",
      "photon-node",
      "photon_rs_bg.wasm",
    );
  }

  if (!existsSync(exportSrc)) {
    console.error(
      "compile-pi-to-bin: missing packages/coding-agent/dist/core/export-html (run coding-agent build / copy-assets first).",
    );
    process.exit(1);
  }
  if (!existsSync(themeSrc)) {
    console.error(
      "compile-pi-to-bin: missing packages/coding-agent/dist/modes/interactive/theme.",
    );
    process.exit(1);
  }
  if (!existsSync(wasmSrc)) {
    console.error("compile-pi-to-bin: missing photon wasm at node_modules.");
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  for (const name of ["theme", "export-html", "docs", "examples"]) {
    const p = join(outDir, name);
    if (existsSync(p)) {
      rmSync(p, { recursive: true });
    }
  }

  copyFileSync(join(caDir, "package.json"), join(outDir, "package.json"));
  copyFileSync(join(caDir, "README.md"), join(outDir, "README.md"));
  copyFileSync(join(caDir, "CHANGELOG.md"), join(outDir, "CHANGELOG.md"));
  copyFileSync(wasmSrc, join(outDir, "photon_rs_bg.wasm"));

  const themeDest = join(outDir, "theme");
  mkdirSync(themeDest, { recursive: true });
  for (const name of readdirSync(themeSrc)) {
    if (name.endsWith(".json")) {
      copyFileSync(join(themeSrc, name), join(themeDest, name));
    }
  }

  const exportDest = join(outDir, "export-html");
  cpSync(exportSrc, exportDest, { recursive: true });

  cpSync(join(caDir, "docs"), join(outDir, "docs"), { recursive: true });
  cpSync(join(caDir, "examples"), join(outDir, "examples"), { recursive: true });

  if (process.platform === "win32") {
    const koffiRoot = join(repoRoot, "node_modules", "koffi");
    const koffiNode = join(
      koffiRoot,
      "build",
      "koffi",
      "win32_x64",
      "koffi.node",
    );
    if (existsSync(koffiNode)) {
      const destBase = join(outDir, "node_modules", "koffi");
      mkdirSync(join(destBase, "build", "koffi", "win32_x64"), {
        recursive: true,
      });
      copyFileSync(join(koffiRoot, "index.js"), join(destBase, "index.js"));
      copyFileSync(
        join(koffiRoot, "package.json"),
        join(destBase, "package.json"),
      );
      copyFileSync(koffiNode, join(destBase, "build", "koffi", "win32_x64", "koffi.node"));
    }
  }
}

function main() {
  if (!existsSync(entry)) {
    console.error(
      "compile-pi-to-bin: missing",
      entry,
      "\nBuild @mariozechner/pi-coding-agent first (e.g. bun run build from repo root).",
    );
    process.exit(1);
  }

  const outDir = parseOutDir();
  const exeName = process.platform === "win32" ? "pi.exe" : "pi";
  const outFile = join(outDir, exeName);

  mkdirSync(outDir, { recursive: true });

  const compile = spawnSync(
    "bun",
    [
      "build",
      "--compile",
      "--external",
      "koffi",
      entry,
      "--outfile",
      outFile,
    ],
    { stdio: "inherit", cwd: caDir, env: process.env },
  );

  if (compile.status !== 0) {
    process.exit(compile.status ?? 1);
  }

  if (process.platform !== "win32") {
    chmodSync(outFile, 0o755);
  }

  syncAssets(outDir);
  console.log("compile-pi-to-bin:", outFile, "+ assets ->", outDir);
}

main();
