# PDF Local Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create an npm-linkable `pdf-view` command that recursively browses local PDFs and previews them in a Vue 3 application using bundled PDF.js.

**Architecture:** An ESM Node CLI starts an Express application rooted at the invocation directory. The Express API provides a filtered directory tree and protected PDF streams; a Vite-built Vue application consumes those APIs and uses `pdfjs-dist` for lazy continuous-page rendering.

**Tech Stack:** Node.js 18+, Express, Vue 3, Vite, PDF.js (`pdfjs-dist`), Node test runner

---

### Task 1: Package and server foundation

**Files:**
- Modify: `package.json`
- Create: `server/files.js`
- Create: `server/app.js`
- Create: `test/files.test.js`
- Create: `test/app.test.js`

**Steps:**
1. Add failing tests for recursive PDF filtering, directory ordering, traversal rejection, tree responses, and inline PDF responses.
2. Run `npm test` and verify the tests fail because the server modules do not exist.
3. Implement the smallest file-tree, safe-path, and Express application modules that satisfy the tests.
4. Run `npm test` and verify all server tests pass.

### Task 2: Global CLI

**Files:**
- Create: `server/options.js`
- Create: `bin/pdf-view.js`
- Create: `test/options.test.js`

**Steps:**
1. Add failing tests for default options, custom port/host, no-open mode, help, and invalid arguments.
2. Run the focused option test and verify it fails.
3. Implement argument parsing and the executable entry point using `process.cwd()` as the server root.
4. Add friendly startup, help, shutdown, missing-build, and port-conflict messages.
5. Run `npm test` and verify all tests pass.

### Task 3: Vue shell and recursive navigator

**Files:**
- Create: `index.html`
- Create: `vite.config.js`
- Create: `src/main.js`
- Create: `src/App.vue`
- Create: `src/components/TreeNode.vue`
- Create: `src/style.css`

**Steps:**
1. Configure Vite and Vue, then create the application shell.
2. Fetch `/api/tree`, render recursive directories and files, and select the first PDF automatically.
3. Add empty, loading, refresh, and error states.
4. Run `npm run build` and verify a production bundle is emitted.

### Task 4: PDF.js continuous reader

**Files:**
- Create: `src/components/PdfViewer.vue`
- Modify: `src/App.vue`
- Modify: `src/style.css`

**Steps:**
1. Configure the bundled PDF.js worker through Vite.
2. Load the selected document and create page placeholders using real page dimensions.
3. Render pages near the viewport and cancel stale loading/render tasks during file changes.
4. Implement page navigation, zoom, fit width, rotation, download, scroll tracking, and resize handling.
5. Run `npm run build` and verify the worker and reader bundle successfully.

### Task 5: Package and end-to-end verification

**Files:**
- Create: `.npmignore`
- Create: `README.md`
- Modify: `package.json`

**Steps:**
1. Document install, `npm link`, command options, behavior, and limitations.
2. Run `npm test` and require a clean pass.
3. Run `npm run build` and require a clean production build.
4. Run `npm pack --dry-run` and verify the CLI, server, and built client are included without source-only clutter.
5. Link the package, launch it inside a temporary nested-PDF fixture, and verify the tree and PDF endpoints.
6. Inspect the application in a real browser at desktop and narrow widths, then correct any visible or console issues.
