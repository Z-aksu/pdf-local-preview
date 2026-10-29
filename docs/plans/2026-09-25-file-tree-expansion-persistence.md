# File Tree Expansion Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist every manually collapsed file-directory node per startup workspace so refreshes and normal service restarts restore the exact file-tree view without leaking state across directories.

**Architecture:** Store only collapsed directory paths because expanded is the default and newly discovered directories should remain visible. `App.vue` owns one reactive `Set`, `TreeNode.vue` becomes a controlled component, and a small pure module handles validation, serialization, directory collection, and reconciliation after rescans. The existing workspace-scoped localStorage key mechanism provides directory isolation.

**Tech Stack:** Vue 3 Composition API, browser localStorage, Node.js test runner, Vite SSR tests.

---

### Task 1: Add the pure tree-expansion state model

**Files:**
- Create: `src/tree-expansion.js`
- Create: `test/tree-expansion-persistence.test.js`

**Steps:**

1. Write failing tests for parsing malformed storage, deduplicating paths, deterministic serialization, collecting nested directory paths, reconciling deleted paths, and toggling one directory.
2. Run `node --test test/tree-expansion-persistence.test.js` and verify the missing module causes failure.
3. Implement the minimal pure helpers and the versioned storage key.
4. Re-run the focused test and verify all cases pass.

### Task 2: Make the file tree controlled by App state

**Files:**
- Modify: `src/components/TreeNode.vue`
- Modify: `src/App.vue`
- Modify: `test/tree-expansion.test.js`

**Steps:**

1. Add an SSR regression test proving a path in `collapsedPaths` hides its descendants while unrelated branches stay expanded.
2. Replace `TreeNode`'s private `expanded` ref with a computed lookup against the shared `Set`; emit a directory-toggle event on click and forward it recursively.
3. In `App.vue`, restore the workspace-scoped set before tree initialization, reconcile it against every successful scan, and persist only when the set changes.
4. Route manual clicks and file-tree “全部展开/全部收起” through that same set; retain the existing command behavior for PDF outline bookmarks.
5. Run the focused tree and persistence tests.

### Task 3: Document behavior and validate all persisted interactions

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-09-25-file-tree-expansion-persistence.md`

**Steps:**

1. Document file-tree expansion restoration and workspace isolation.
2. Run `npm test`, `npm run build`, `npm pack --dry-run`, and `git diff --check`.
3. Start the built app against a nested PDF fixture and verify manual parent/child collapse, expand-all/collapse-all, refresh restoration, and service restart restoration.
4. Start the same origin against a different directory and verify the first workspace's tree state does not apply.
5. Re-run representative checks for sidebar collapse/width, reading mode, focus mode, tabs/reading position, and favorites; inspect browser console errors and ensure no per-scroll or per-render storage writes were introduced.

### Task 4: Preserve an intentionally empty tab workspace

**Files:**
- Modify: `src/App.vue`
- Modify: `src/tabs.js`
- Modify: `test/tabs.test.js`
- Modify: `README.md`

**Steps:**

1. Add a regression assertion that refreshing an empty tab collection remains empty even when the tree contains PDF files.
2. Remove the first-PDF auto-open branch from initial tree loading and delete the now-unused finder helper.
3. Verify a fresh workspace and a workspace where all tabs were explicitly closed both render the empty-reader prompt after refresh and service restart.
4. Verify persisted reading and focus modes safely reset when no document is open.

## Acceptance Criteria

- Manually collapsing a parent or child directory survives page refresh and a normal service restart.
- Expanding a previously collapsed directory removes only that directory from storage; descendant choices remain intact.
- “全部收起” stores every current directory once, while “全部展开” clears the stored set.
- A successful rescan removes stale paths and leaves newly discovered directories expanded by default.
- Directory renames or moves are treated as old-path removal plus new-path discovery; no fuzzy name matching is attempted.
- A failed scan leaves the last stored set untouched so transient filesystem errors cannot erase user choices.
- Starting the app from another directory on the same browser origin does not reuse the first directory's tree state.
- Tree persistence performs one small localStorage write per user expansion change or successful rescan and performs no work in PDF scrolling or rendering paths.
- A workspace with no saved tabs stays empty on startup and waits for an explicit file click.

## Verification Results

- `npm test`: 59/59 tests passed.
- `npm run build`: production build passed.
- `npm pack --dry-run`: package lifecycle and contents check passed.
- `git diff --check`: passed; only the repository's existing Windows line-ending notices were reported.
- Browser acceptance passed for nested manual collapse, parent/child independence, expand-all, collapse-all, refresh, normal service restart, and same-origin workspace isolation.
- Filesystem-change acceptance passed after moving one collapsed subtree, removing one branch, and adding one new branch: stale paths were removed, unchanged paths were preserved, and moved/new paths opened by default.
- Existing sidebar width/collapse, reading mode, focus mode, tabs, reading position, and favorites persisted and restored without console or page errors.
- Closing all tabs stayed empty across refresh and service restart; stale reading/focus flags were reset to `false`.
- A manual directory toggle produced exactly one tree-state localStorage write. A 10,000-directory collection and serialization benchmark completed in about 8.7 ms with a 138,901-byte payload on the test machine.
