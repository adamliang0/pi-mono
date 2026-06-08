# Research Findings

## Sources
| Source | Key Takeaway | Reliability |
|--------|-------------|-------------|
| `packages/coding-agent/src/core/session-manager.ts` | Sessions are persisted as append-only JSONL trees, support custom entries/messages, and already persist compaction/branch summaries. | High |
| `packages/coding-agent/src/core/compaction/compaction.ts` | Compaction summaries are durable checkpoint memory for long sessions, but still session-scoped and transcript-derived. | High |
| `packages/coding-agent/src/core/compaction/branch-summarization.ts` | Branch summaries preserve abandoned branch context and append file-operation metadata. | High |
| `packages/coding-agent/package.json` | `packages/coding-agent` currently has no SQLite dependency; any DB choice will be a new runtime dependency. | High |
| `packages/coding-agent/src/core/settings-manager.ts` | The harness already has global + project settings infrastructure, so memory settings can fit existing config patterns. | High |
| `packages/coding-agent/src/core/index.ts` | New memory APIs will likely need explicit exports from the core entrypoint for SDK/runtime consumption. | High |
| `packages/coding-agent/src/core/agent-session-services.ts` | Cwd-bound services are created in one place, making it a natural integration point for constructing a shared memory store service. | High |
| `packages/coding-agent/src/core/extensions/types.ts` | Extension APIs already expose session/tool/model actions; memory can be added as another first-class extension capability instead of piggybacking on `appendEntry()`. | High |
| `https://alexgarcia.xyz/sqlite-vec/js.html` | `sqlite-vec` loads into an existing SQLite connection and supports JS bindings with `better-sqlite3`, `node:sqlite`, and `bun:sqlite`. | Medium-High |
| `https://alexgarcia.xyz/sqlite-vec/features/vec0.html` and `features/knn.html` | `vec0` supports primary keys, partition keys, metadata columns, auxiliary columns, and KNN queries using `where embedding match :query and k = N`. | Medium-High |

## Key Insights
- The harness already has persistent session continuity, but not a dedicated cross-session memory subsystem.
- Session persistence and durable memory should remain separate concerns.
- `sqlite-vec` fits best as a vector index inside a broader SQLite schema, not as the sole store for all memory metadata.
- A resilient design should persist canonical memory rows independently of embedding/indexing success.
- Memory configuration can follow the existing `SettingsManager` global/project model instead of inventing a new config mechanism.
- If the memory API should be available to SDK consumers or extensions, it likely needs new exports from `src/core/index.ts` and new extension context surface.
- `createAgentSessionServices()` is the cleanest place to bootstrap a cwd-aware/shared memory subsystem alongside auth/settings/model services.
- Extension authors should get a deliberate memory API rather than using session `custom` entries as an ad hoc memory mechanism.

## Patterns & Approaches
| Approach | Pros | Cons |
|----------|------|------|
| JSONL-only memory derived from sessions | Reuses existing storage model; simple exportability | Poor retrieval/query semantics; hard to dedupe and rank; no vector search |
| SQLite canonical tables + `sqlite-vec` index | Strong durability, migrations, metadata support, vector search, local file-based | Adds dependency/runtime complexity and migration surface |
| SQLite canonical tables + app-side vector math only | Avoids vector extension complexity | Misses user-requested `sqlite-vec`; weaker query ergonomics |

## Rejected Approaches
| Approach | Why Rejected |
|----------|-------------|
| Replace session JSONL with SQLite | Breaks current append-only session model and conflates transcript persistence with durable memory. |
| Store all memory only inside `vec0` table | Harder to support provenance, audit, archival, jobs, and richer metadata safely. |

## Open Questions
- Which SQLite binding should the package standardize on for `sqlite-vec`: `better-sqlite3` or `node:sqlite`?
- Should the first shipped version support only explicit memory writes, or also automatic extraction from compaction/branch summaries?
- How should embeddings be generated and retried when provider auth is missing or offline?
