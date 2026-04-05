<p align="center">
  <a href="https://shittycodingagent.ai">
    <img src="https://shittycodingagent.ai/logo.svg" alt="pi logo" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://github.com/badlogic/pi-mono/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/badlogic/pi-mono/ci.yml?style=flat-square&branch=main" /></a>
</p>
<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>

## Pi Monorepo

> **Looking for the pi coding agent?** See **[packages/coding-agent](packages/coding-agent)** for installation and usage.

Tools for building AI agents and managing LLM deployments.

## Packages

| Package | Description |
|---------|-------------|
| **[@adamliang0/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@adamliang0/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@adamliang0/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@adamliang0/pi-mom](packages/mom)** | Slack bot that delegates messages to the pi coding agent |
| **[@adamliang0/pi-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@adamliang0/pi-web-ui](packages/web-ui)** | Web components for AI chat interfaces |
| **[@adamliang0/pi-pods](packages/pods)** | CLI for managing vLLM deployments on GPU pods |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Prerequisites

- **Bun** — version pinned in root `package.json` as `packageManager` (install via [oven-sh/bun](https://github.com/oven-sh/bun)).
- **Node.js** `>= 20` (required by root `engines`; CI also uses Node for cross-platform native installs during binary builds).

## Development

This repo uses **Bun** as the package manager and script runner.

```bash
bun install          # Install all workspace dependencies
bun run build        # Build all packages (Turbo + pi CLI compile step)
bun run check        # Lint, format, typecheck, browser smoke, web-ui checks
bun run test         # Run tests across packages (turbo; some suites need API keys)
./pi-test.sh         # Run the coding agent from source (any cwd)
```

Other useful scripts:

```bash
bun run build:ts     # TypeScript project references only (no full Turbo graph)
bun run clean        # Clean outputs across workspaces
```

## Build

1. **`bun install`** — installs workspaces under `packages/*` and `packages/web-ui/example`.
2. **`bun run build`** — runs `turbo build` for the monorepo, then `scripts/compile-pi-to-bin.mjs` to produce the `pi` CLI artifact used by local runs and packaging.

**Pre-publish gate** (also what `bun run publish` runs via `prepublishOnly`): `bun run clean && bun run build && bun run check`.

**Cross-platform `pi` archives** (macOS/Linux/Windows) for GitHub Releases:

```bash
./scripts/build-binaries.sh              # all platforms (needs Node for optional deps)
./scripts/build-binaries.sh --platform darwin-arm64   # single platform
./scripts/build-binaries.sh --skip-deps               # skip cross-platform npm installs
```

Artifacts land in `packages/coding-agent/binaries/` (`pi-*.tar.gz` / `pi-*.zip`). CI mirrors this in [.github/workflows/build-binaries.yml](.github/workflows/build-binaries.yml).

## Release

All publishable packages stay on **one lockstep semver** (same version in every `packages/*/package.json`). Bump type follows [AGENTS.md](AGENTS.md): `patch` for fixes and additions, `minor` for API-breaking changes (this repo does not ship separate “major” product lines—still use `major` when you need that semver jump).

### Changelogs

Before cutting a release, ensure each affected package has entries under `## [Unreleased]` in `packages/*/CHANGELOG.md` (format and attribution rules in [AGENTS.md](AGENTS.md)). The release automation **finalizes** those sections into a dated `## [x.y.z]` block; it does not write feature text for you.

### Full release (version bump, tag, npm publish)

Requires a **clean** git working tree.

```bash
bun run release:patch    # or :minor / :major → runs scripts/release.mjs
```

That script: bumps versions (`bun run version:*` + `scripts/sync-versions.js`), rewrites `[Unreleased]` changelogs to the new version, commits and tags `vX.Y.Z`, runs `bun run publish` (unless skipped), adds fresh `[Unreleased]` sections, commits again, and pushes branch + tag.

**Binaries-only** (no npm): set `SKIP_NPM_PUBLISH=1` when invoking the same flow, e.g. `SKIP_NPM_PUBLISH=1 bun run release:patch`. You still need a plan for **uploading** `packages/coding-agent/binaries/*` if you are not using the GitHub workflow below.

Optional env overrides: `RELEASE_REMOTE`, `RELEASE_BRANCH` (see header comment in `scripts/release.mjs`).

### GitHub Release with prebuilt binaries (CI)

Use the **Release (GitHub binaries)** workflow: [.github/workflows/release-github.yml](.github/workflows/release-github.yml) (`workflow_dispatch`, choose patch/minor/major). It bumps versions, finalizes changelogs, commits, tags, runs `./scripts/build-binaries.sh`, creates or updates a **GitHub Release** with the archive assets, adds the next `[Unreleased]` block, and pushes. **No npm publish.**

Pushes performed with `GITHUB_TOKEN` do not trigger other workflows; this workflow uploads assets itself. **Tags pushed manually** from your machine still trigger **Build Binaries** ([.github/workflows/build-binaries.yml](.github/workflows/build-binaries.yml)) on `v*` tags.

### GitHub Release binaries without Actions

Use your machine plus [GitHub CLI](https://cli.github.com/) (`gh`). Ensure the release **tag already exists** on GitHub (for example you already ran `SKIP_NPM_PUBLISH=1 bun run release:patch` and pushed `vX.Y.Z`).

```bash
gh auth login
./scripts/build-binaries.sh
bun run upload-github-binaries v0.65.1
```

Omit the tag argument to use the version from `packages/ai/package.json`. The script creates the GitHub Release if missing, or **`gh release upload --clobber`** if it already exists. Release notes are taken from `packages/coding-agent/CHANGELOG.md` for that version (falls back to a one-line message). Requires `awk` in `PATH` (macOS/Linux).

### npm packages (no GitHub binaries)

To publish **scoped packages** to the registry only: `bun run publish` (runs `prepublishOnly` first). Use npm/bun login for your scope beforehand.

## Maintaining the repo

| Task | What to run / where |
|------|----------------------|
| Day-to-day quality gate | `bun run check` (required before commits that touch code; see [AGENTS.md](AGENTS.md)) |
| Full test sweep | `bun run test`; contributors also use `./test.sh` per [CONTRIBUTING.md](CONTRIBUTING.md) |
| Lockstep versions after manual edits | `node scripts/sync-versions.js` if you ever set versions by hand (normally `bun run version:*` handles it) |
| Changelog discipline | Only edit `## [Unreleased]`; never rewrite released version sections ([AGENTS.md](AGENTS.md)) |
| CI | [ci.yml](.github/workflows/ci.yml) on pushes/PRs; binary builds on `v*` tags or manual dispatch; if Actions fail, `bun run upload-github-binaries` after `./scripts/build-binaries.sh` |
| Per-package docs | `packages/*/README.md` (e.g. coding agent install and provider setup) |

For detailed automation rules (fork vs upstream, OSS weekend, issue labels, hooks), use [AGENTS.md](AGENTS.md).

## License

MIT
