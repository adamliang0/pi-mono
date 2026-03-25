# CI/CD Pipeline Analysis & Improvement Plan

## Goal
Analyze current CI/CD pipeline and design improvements for faster builds, better caching, and automated releases.

## Current State Analysis

### Workflows
| Workflow | Trigger | Purpose | Issues |
|----------|---------|---------|--------|
| `ci.yml` | push/PR | Build, check, test | No caching, sequential |
| `build-binaries.yml` | push to main | Cross-platform builds | Runs every push, not just releases |
| (manual) | tag | Publish npm | Manual process |

### Package Build Pipeline
```
build: cd tui && bun run build
       cd ai && bun run build
       cd agent && bun run build
       cd coding-agent && bun run build
       cd mom && bun run build
       cd web-ui && bun run build
       cd pods && bun run build
```
**Issues:** Sequential, no parallelization, no incremental builds.

### Release Pipeline
```
1. bun run release:patch  (local)
2. scripts/release.mjs:
   - Checks git status
   - Bumps versions (bun run version:patch -ws)
   - Updates CHANGELOGs
   - Git add/commit/tag
   - bun publish -ws
3. Push tags → triggers build-binaries.yml
4. Create GitHub release manually
```

**Issues:** Release tied to local machine, no automated release notes, manual GitHub release creation.

---

## Success Criteria
- [ ] Reduce CI build time by 50% (cache + parallel)
- [ ] Binary builds only on version tags (not every push)
- [ ] Automated release workflow with changelog generation
- [ ] Dependency caching in all workflows
- [ ] Optional: turborepo integration for local dev speed

---

## Phases

### Phase 1: Quick Wins (Low Effort, High Impact)
- **Objective:** Fix obvious inefficiencies
- **Tasks:**
  - [ ] Add bun cache to CI (`cache: bun` in setup-bun)
  - [ ] Add `paths` filter to build-binaries.yml (only on version tags)
  - [ ] Parallelize test execution in CI
  - [ ] Cache individual package `dist/` outputs
- **Checkpoint:** CI runs < 5 min (from ~8-10 min)

### Phase 2: turborepo Integration (Medium Effort)
- **Objective:** Parallel, cached builds for local + CI
- **Tasks:**
  - [ ] Add turborepo as dev dependency
  - [ ] Create turbo.json pipeline config
  - [ ] Replace sequential build with `turbo build`
  - [ ] Update CI to use turbo (caching + parallel)
  - [ ] Update dev script to use `turbo dev`
- **Checkpoint:** `turbo build` completes faster than sequential

### Phase 3: Automated Releases (Medium Effort)
- **Objective:** GitHub Actions releases, no local script needed
- **Tasks:**
  - [x] Create `release.yml` workflow (on tag v*)
  - [x] Move changelog logic to action
  - [x] Auto-generate release notes (from changelog)
  - [x] Auto-create GitHub release with binaries
  - [ ] Update README with release instructions
- **Checkpoint:** Push tag → fully released in < 10 min

### Phase 4: Advanced CI (Optional)
- **Objective:** Matrix caching, smoke tests
- **Tasks:**
  - [ ] Cache each package's node_modules separately
  - [ ] Add binary smoke test after cross-compile
  - [ ] Add diff-based build (only rebuild changed packages)
  - [ ] Scheduled nightly builds for early bug detection

---

## Decisions Log
| Decision | Rationale | Date |
|----------|-----------|------|
| turborepo vs Nx | turborepo simpler, bun-compatible | 2026-03-25 |
| Keep release script | Migration to pure action later | 2026-03-25 |
| bun caching | Project uses bun.lock, native support | 2026-03-25 |

---

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| biome schema mismatch | Fixed by updating config | 2026-03-25 |
| esbuild missing for check:browser-smoke | Added as dev dep | 2026-03-25 |
