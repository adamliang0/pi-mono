# Fork Release Pipeline

## Goal
Create a release pipeline for @arcdev-llc/pi-mono fork that handles uncommitted work and publishes to fork's npm registry and GitHub releases.

## Current State
- 57 commits rebased from upstream
- Uncommitted changes: config.ts, CHANGELOG, package.json, memory feature files
- Build passes with bun
- Release script fails due to uncommitted changes

## Fork-Specific Requirements

### Must Have
1. **Handle uncommitted changes** - Stash, release, pop stash
2. **Version bump** - All packages share lockstep version
3. **CHANGELOG** - Fork-specific entries under [Unreleased]
4. **GitHub release** - Upload binaries to fork releases
5. **npm publish** - Publish to @arcdev-llc registry

### Nice to Have
- CI/CD integration with GitHub Actions
- Semantic version compliance with upstream

## Phases

### Phase 1: Create Fork Release Script
- [ ] Create `scripts/release-fork.mjs`
- [ ] Handle uncommitted changes (stash/unstash)
- [ ] Version bump all packages
- [ ] Update CHANGELOGs
- [ ] Commit and tag
- [ ] Push to origin

### Phase 2: Create GitHub Actions Workflow
- [ ] Create `.github/workflows/release.yml`
- [ ] Trigger on tag push
- [ ] Build binaries
- [ ] Upload to GitHub Release
- [ ] Publish to npm

### Phase 3: Test Release Pipeline
- [ ] Dry-run with current changes
- [ ] Verify version bump
- [ ] Verify CHANGELOG entries
- [ ] Verify GitHub Release creation

## Decisions Made

### Stash Strategy
- Before release: `git stash push -m "pre-release"` with known files
- After release: `git stash pop`

### Version Strategy
- Follow upstream's version scheme (currently 0.66.3)
- Fork releases: 0.67.0+ to avoid confusion
- OR: Keep same version with fork suffix (0.66.3-arcdev.1)

## Risks
- npm publish auth for @arcdev-llc registry
- GitHub token permissions for releases
- Version conflict with upstream releases

## Files to Create/Modify
1. `scripts/release-fork.mjs` (new)
2. `.github/workflows/release.yml` (new)
3. `AGENTS.md` (update release docs)
