<!-- OSS_WEEKEND_START -->
# 🏖️ OSS Weekend

**Issue tracker reopens Monday, March 30, 2026.**

OSS weekend runs Sunday, March 22, 2026 through Monday, March 30, 2026. New issues are auto-closed during this time. For support, join [Discord](https://discord.com/invite/3cU7Bz4UPx).
<!-- OSS_WEEKEND_END -->

---

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

> **Fork of [pi-mono](https://github.com/badlogic/pi-mono)** with opinionated workspace changes (turborepo, bun, automated releases).

## Pi Monorepo

> **Looking for the pi coding agent?** See **[packages/coding-agent](packages/coding-agent)** for installation and usage.

Tools for building AI agents and managing LLM deployments.

## Packages

| Package | Description |
|---------|-------------|
| **[@mariozechner/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@mariozechner/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@mariozechner/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@mariozechner/pi-mom](packages/mom)** | Slack bot that delegates messages to the pi coding agent |
| **[@mariozechner/pi-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@mariozechner/pi-web-ui](packages/web-ui)** | Web components for AI chat interfaces |
| **[@mariozechner/pi-pods](packages/pods)** | CLI for managing vLLM deployments on GPU pods |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run pi from sources (can be run from any directory)
```

> **Note:** `npm run check` requires `npm run build` to be run first. The web-ui package uses `tsc` which needs compiled `.d.ts` files from dependencies.

## Using with mise

For managing pi via [mise](https://mise.jdx.dev):

```bash
# Install mise if you haven't already
curl https://mise.run | sh

# Build the binary and create a bin/ symlink
mise run link-bin

# Use pi directly (from the repo directory)
./bin/pi "Hello, world!"

# Or run via mise exec (works from any directory with this mise.toml)
mise exec -- ./bin/pi -- "Hello, world!"
```

For CI/CD that publishes to GitHub releases, the workflow in `.github/workflows/build-binaries.yml` handles building and releasing. After publishing, users can install via:

```bash
mise use -g pi@x.x.x  # from GitHub releases
```

This repo's `mise.toml` uses a local path for development. Update it to point to the GitHub backend if you want mise to fetch releases automatically.

## Releasing

Releases are automated via GitHub Actions. To release a new version:

```bash
# Bump version (updates package.json files, adds [Unreleased] section)
bun run release:patch  # or release:minor, release:major

# This will:
# 1. Update all package versions
# 2. Commit and create a version tag (e.g., v0.63.0)
# 3. Push to origin
```

The `release.yml` workflow then automatically:
1. Publishes all packages to npm
2. Builds binaries for all platforms (macOS, Linux, Windows)
3. Creates a GitHub release with binaries and changelog

### Manual Release (if needed)

```bash
# 1. Update CHANGELOG.md files with [Unreleased] changes
# 2. Manually trigger release.yml from GitHub Actions UI
# 3. Or run locally:
git tag v0.x.x
git push origin v0.x.x
```

## License

MIT
