#!/usr/bin/env node
/**
 * Bump the same semver in every publishable package under packages/ (lockstep).
 * Root workspace no longer uses `bun run version:patch -ws` (that recurses on the root script).
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const bumpType = process.argv[2];
if (!["patch", "minor", "major"].includes(bumpType)) {
	console.error("Usage: node scripts/bump-lockstep-version.mjs <patch|minor|major>");
	process.exit(1);
}

function bumpSemver(version, type) {
	const parts = version.split(".").map(Number);
	if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
		throw new Error(`Invalid semver: ${version}`);
	}
	let major = parts[0];
	let minor = parts[1];
	let patch = parts[2];
	if (type === "patch") {
		patch += 1;
		return `${major}.${minor}.${patch}`;
	}
	if (type === "minor") {
		minor += 1;
		patch = 0;
		return `${major}.${minor}.${patch}`;
	}
	major += 1;
	minor = 0;
	patch = 0;
	return `${major}.${minor}.${patch}`;
}

const packagesDir = join(process.cwd(), "packages");
const dirNames = readdirSync(packagesDir, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name);

const aiPath = join(packagesDir, "ai", "package.json");
const aiPkg = JSON.parse(readFileSync(aiPath, "utf-8"));
const nextVersion = bumpSemver(aiPkg.version, bumpType);

console.log(`Lockstep bump ${aiPkg.version} → ${nextVersion} (${bumpType})`);

for (const dir of dirNames) {
	const pkgPath = join(packagesDir, dir, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
	if (typeof pkg.version !== "string") {
		continue;
	}
	pkg.version = nextVersion;
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
	console.log(`  ${pkg.name}: ${nextVersion}`);
}
