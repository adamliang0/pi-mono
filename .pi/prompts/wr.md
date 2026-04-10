---
description: Finish the current task end-to-end with changelog, commit, and push
argument-hint: "[instructions]"
---
Wrap it.

Additional instructions: $ARGUMENTS

Determine context from the conversation history first.

Rules for context detection:
- If the conversation already mentions a GitHub issue or PR, use that existing context.
- If the work came from `/is` or `/pr`, assume the issue or PR context is already known from the conversation and from the analysis work already done.
- If there is no GitHub issue or PR in the conversation history, treat this as non-GitHub work.

Unless I explicitly override something in this request, do the following in order:

1. Add or update the relevant package changelog entry under `## [Unreleased]` using the repo changelog rules.
2. Determine the semver bump needed for the affected packages.
3. If this task is tied to a GitHub issue or PR and a final issue or PR comment has not already been posted in this session, draft it in my tone, preview it, and post exactly one final comment.
4. Commit only files you changed in this session.
5. If this task is tied to exactly one GitHub issue, include `closes #<issue>` in the commit message. If it is tied to multiple issues, stop and ask which one to use. If it is not tied to any issue, do not include `closes #` or `fixes #` in the commit message.
6. Apply the version bump to affected packages and commit it.
7. Check the current git branch. If it is not `main`, stop and ask what to do. Do not push from another branch unless I explicitly say so.
8. Push the current branch.

Version bump rules:
- **patch**: Bug fixes, performance improvements, new features, or refactoring with no API changes.
- **minor**: Any API change—adding/changing/removing parameters, deprecations, message format changes, event type changes, or feature removals.
- **major**: Ask the user before bumping. Major bumps are for fundamental rewrites or large breaking changes that require significant migration work.

Analyze the commits in this session critically:
- Look at what actually changed in the source files, not just the changelog entries.
- If a function signature changed, that's `minor` even if the changelog says "fixed".
- If a new optional parameter was added with a sane default, that's still `minor`—document it.
- If behavior changed but the API stayed the same, that's typically `patch`.
- When in doubt, bump the conservative level (higher semver) or ask.


Execute the bump:
- All packages use lockstep versioning. If any affected package needs a bump, apply the same bump to all packages.
- Use `bun run version:patch` or `bun run version:minor` from the workspace root.
- After running the bump script, stage and commit the version commits in the same commit as the feature commits. Do not create a separate "bump version" commit unless the user explicitly asks.
- If the user has not asked for a bump but the code changes warrant one, apply it anyway—version bumps are part of good commit hygiene.

Constraints:
- Never stage unrelated files.
- Never use `git add .` or `git add -A`.
- Run required checks before committing if code changed.
- Do not open a PR unless I explicitly ask.
- If this is not GitHub issue or PR work, do not post a GitHub comment.
- If a final issue or PR comment was already posted in this session, do not post another one unless I explicitly ask.
