# Agent reviewer
Status: paused
Task: Review `packages/coding-agent/src/core/agent-session-runtime.ts` and propose a behavior-preserving transactional refactor. Focus on edge cases in `switchSession`, `newSession`, `fork`, and `importFromJsonl`; identify exact lifecycle ordering that must remain unchanged and any hidden pitfalls if next runtime is created before current teardown. No code changes.
Blockers: 

Now I have a thorough picture of the code. Here is my analysis.

---

## Review: `AgentSessionRuntime` Transactional Refactor

### Current Lifecycle Ordering (Document the Invariants)

The class enforces one **implicit ordering guarantee** that any refactor must preserve verbatim:

```
1. createRuntime() completes (Promise resolves)
2. teardownCurrent() fires session_shutdown + disposes current session
3. apply() swaps _session, _services, _diagnostics, _modelFallbackMessage
4. [optional setup callback in newSession]
```

The critical property: **the current session runs until the next session is fully created**. This is already partially pipelined (the `Promise<...>` is created eagerly), but the `await` inside `transitionTo` forces sequential waiting. A true parallel-create-then-teardown refactor would invert steps 1 and 2, which is unsafe for several reasons.

---

### Edge Cases by Method

#### `switchSession`

1. **Validation before teardown**: `assertSessionCwdExists(sessionManager, this.cwd)` is called **before** `transitionTo`. This is correct—the new session file is verified before any teardown occurs. However, the cwd assertion reads `this.cwd` (current services' cwd), not the target cwd. This is intentional, but worth noting: switching to a session whose stored cwd differs from the runtime's cwd is allowed; the runtime adopts the target's cwd via `apply()` → `process.chdir()`.

2. **`previousSessionFile` captured before await**: The `previousSessionFile = this.session.sessionFile` reads from `this.session` **before** the `await transitionTo(...)`. On a cross-cwd switch, this is fine because the old session file path was absolute. On a same-cwd switch to a different session, this also holds.

3. **Cancellation window**: `emitBeforeSwitch("resume")` is called before any I/O. If cancelled, no teardown occurs—correct.

#### `newSession`

1. **`sessionDir` derived from `this.session.sessionManager`**: The directory is captured from the **current** manager before teardown. This is correct because the session manager is session-scoped, not runtime-scoped. The new session manager is created with the same directory.

2. **`parentSession` option**: If `options?.parentSession` is provided, `sessionManager.newSession({ parentSession })` is called on the **new** manager (before teardown). This is fine because the manager is local.

3. **Post-transition `setup` callback**: After `transitionTo`, `options.setup(this.session.sessionManager)` is called and then the runtime's agent state is overwritten:
   ```typescript
   this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
   ```
   This works because `this.session` now points to the new session. **Hidden pitfall**: if `setup` throws, the session is already swapped, and the agent state has been set to the new manager's messages (not the old ones). The runtime is left in a partially-initialized state. The test in `agent-session-runtime-events.test.ts` ("keeps the current runtime active when replacement runtime creation fails") covers `createRuntime` **throwing**, not `setup` throwing.

4. **`buildSessionContext()`**: Called on the new manager, returns messages for the new session. This is correct.

#### `fork`

1. **In-memory vs. persisted branching**: The method branches on `this.session.sessionManager.isPersisted()` before teardown. For persisted sessions, it creates a new `SessionManager` or opens a branched one. For in-memory sessions, it mutates the current manager in-place.

2. **Mutations before teardown**: For in-memory sessions, `sessionManager.newSession({ parentSession })` or `sessionManager.createBranchedSession()` is called **before** `transitionTo`. This is safe because the manager is local to `fork`.

3. **`selectedEntry.parentId` check**: The fork point's parent ID determines whether to create a new session or a branched one. This logic is sound.

4. **No `setup` callback**: Unlike `newSession`, `fork` has no post-transition callback. No hidden state mutation to worry about here.

#### `importFromJsonl`

1. **File existence check before teardown**: `if (!existsSync(resolvedPath))` throws before any teardown. Correct.

2. **Session directory creation**: `mkdirSync(sessionDir, { recursive: true })` is called before teardown. This is safe I/O that must happen before any session swap.

3. **File copy**: `copyFileSync` is called before teardown. Safe.

4. **`destinationPath` computation**: Uses `this.session.sessionManager.getSessionDir()`, captured from the **current** manager before teardown. This is correct—the import lands in the current session's directory, which is intentional.

5. **`cwdOverride` passthrough**: Passed to `SessionManager.open()`, which uses it to set the target session's cwd. The `assertSessionCwdExists` check uses `this.cwd` (runtime's cwd), not the override. This is consistent with `switchSession`.

---

### Hidden Pitfalls of "Create Before Teardown" Inversion

If a refactor attempts to create the next runtime **before** tearing down the current one (e.g., to minimize downtime), the following break:

1. **Extension runner state**: The current `this.session.extensionRunner` holds the `ExtensionRunner` instance bound to the current session's tools, commands, shortcuts, and handlers. If a new runtime is created first, its `ExtensionRunner` loads extensions for the new cwd/services. The old runner is still active with its own set of loaded extensions. Teardown must happen first to ensure:
   - `session_shutdown` fires on the **old** runner (extensions expect cleanup from their own runner).
   - Old extensions are unloaded before new ones load (extension state is not shared, but event listeners are per-runner).

2. **`_unsubscribeAgent` from concurrent events**: During `createRuntime`, if the agent is running (e.g., streaming a response), the current session's `_unsubscribeAgent` subscription still fires events. The event handler `_handleAgentEvent` in `AgentSession` may write to `_eventListeners` or the agent state. If `apply()` swaps the session mid-event, those writes target the wrong session.

3. **`process.chdir()` in `apply()`**: The current code calls `process.chdir()` in `apply()`, not during creation. If the new runtime is created first, `process.cwd()` changes to the new directory during creation (inside `createRuntime` → `createAgentSessionServices` → `DefaultResourceLoader`). Then if teardown of the **current** runtime reads any path-relative resources using `process.cwd()`, those resolve to the new cwd. This is unlikely but possible if any teardown code reads relative paths.

4. **Async teardown timing**: `emitSessionShutdownEvent` is async and may have async handlers. If the new session starts running before the old one's shutdown handlers complete, there is a window where both sessions have active agents. Event handlers from the old session could fire and attempt to write to state that is about to be swapped.

---

### Lifecycle Ordering That Must Not Change

| Step | Reason |
|------|--------|
| `emitBeforeSwitch` / `emitBeforeFork` before any I/O | Allows extensions to cancel without side effects |
| `assertSessionCwdExists` before `transitionTo` | Validates target session integrity before committing to teardown |
| `await createRuntime()` before `teardownCurrent()` | The current invariant; inverting breaks extension runner isolation and agent event targeting |
| `emitSessionShutdownEvent` then `session.dispose()` in `teardownCurrent()` | Must fire shutdown event on the correct runner before disconnecting |
| `process.chdir()` inside `apply()`, not during creation | Prevents cwd contamination of teardown |
| Post-transition `setup` callback after `apply()` for `newSession` | The setup may depend on the new session being active |

---

### Proposed Refactor Direction (No Code Changes)

A behavior-preserving transactional refactor should focus on:

1. **Extract the transaction body into a dedicated method** (`atomicTransition`) that centralizes the try/finally logic, making it easier to reason about rollbacks.

2. **Do not invert create/teardown order**. The current partially-pipelined approach (eager Promise creation) is the right tradeoff between performance and safety. Full parallelization would require:
   - Making `AgentSession.dispose()` idempotent and safe to call during concurrent agent events.
   - Adding a "draining" phase where pending agent events are flushed before teardown.

3. **Cover the `setup` callback failure path** in tests (currently only `createRuntime` failure is tested; `setup` throwing after a successful transition leaves the runtime in a mixed state).

4. **Consider adding a `_transitioning` guard** if concurrent calls to `switchSession`/`newSession`/`fork`/`importFromJsonl` need to be prevented. The current code has no such guard—if two calls race, they will both read/modify `this.session` and `this._services` concurrently.

5. **Document the "current session runs until next is created" invariant** in a doc comment on `transitionTo`, so future maintainers understand why the await is placed where it is.
NextAction: Await user intervention
