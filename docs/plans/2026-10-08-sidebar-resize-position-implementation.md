# Sidebar Resize Position Preservation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the same page-relative reading point while resizing, expanding, or collapsing the sidebar, with no repeated PDF canvas rendering during pointer drag.

**Architecture:** Keep the existing pointer-drag suppression and `ResizeObserver` trailing debounce. Replace the resize commit's page-top alignment with one shared operation that captures the old page-relative anchor, updates the viewport width once, invalidates only near pages, and restores the anchor after Vue applies the new page dimensions.

**Tech Stack:** Vue 3 Composition API, PDF.js, Node.js test runner, Vite.

---

### Task 1: Add resize behavior regression coverage

**Files:**
- Create: `test/pdf-resize.test.js`
- Inspect: `src/App.vue`
- Inspect: `src/components/PdfViewer.vue`

**Step 1: Write the failing test**

Read both Vue sources and assert that pointer drag passes `resizingSidebar` into `suppressResizeRender`, the observer exits while suppression is active, the debounce clears an existing timer, and both resize completion paths call a shared `syncViewportWidthPreservingPosition` operation.

**Step 2: Run test to verify it fails**

Run: `node --test test/pdf-resize.test.js`

Expected: FAIL because `syncViewportWidthPreservingPosition` does not exist and the debounced resize path still calls `syncViewportWidth()` with page-top alignment.

### Task 2: Preserve the reading anchor on width commits

**Files:**
- Modify: `src/components/PdfViewer.vue:869-900`
- Modify: `src/components/PdfViewer.vue:1269-1275`

**Step 1: Implement the shared resize commit**

Add `syncViewportWidthPreservingPosition()` which reads the current `scrollTop`, captures a page-relative anchor before changing `viewportWidth`, calls `invalidateVisiblePages(false)`, and schedules `restoreReadingPosition` for the next Vue tick.

**Step 2: Reuse it from both completion paths**

The 120ms trailing debounce and the transition from `suppressResizeRender=true` to `false` must both call the shared operation. Retain suppression checks before scheduling and before committing.

**Step 3: Run focused tests**

Run: `node --test test/pdf-resize.test.js test/scroll-position.test.js test/sidebar.test.js`

Expected: PASS.

### Task 3: Verify the complete application

**Files:**
- Verify only

**Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass.

**Step 2: Build production assets**

Run: `npm run build`

Expected: Vite build succeeds without errors.

**Step 3: Browser verification**

Open a multi-page PDF, scroll to the middle of a page, drag the sidebar repeatedly, then expand and collapse it. Confirm that the canvas does not visibly rerender during pointer movement, exactly one final resize occurs after release or debounce, and the same page-relative text remains at the top of the viewport.
