import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createReadingPositionTracker,
  createScrollAnchor,
  resolveScrollAnchor,
} from '../src/scroll-position.js'

test('page-relative anchors preserve the same reading point after layout dimensions change', () => {
  const initialPages = [
    { pageNumber: 1, top: 30, height: 900 },
    { pageNumber: 2, top: 958, height: 1200 },
  ]
  const anchor = createScrollAnchor(1558, initialPages)
  assert.deepEqual(anchor, { pageNumber: 2, offsetRatio: 0.5 })

  const resizedPages = [
    { pageNumber: 1, top: 30, height: 750 },
    { pageNumber: 2, top: 808, height: 1000 },
  ]
  const restoredScrollTop = resolveScrollAnchor(anchor, resizedPages, 1558)
  assert.equal(restoredScrollTop, 1308)
  assert.deepEqual(createScrollAnchor(restoredScrollTop, resizedPages), anchor)
})

test('scroll anchors use safe fallbacks for missing or malformed page metrics', () => {
  assert.equal(resolveScrollAnchor({ pageNumber: 4, offsetRatio: 0.2 }, [], 345.5), 345.5)
  assert.equal(resolveScrollAnchor(null, [], -10), 0)
  assert.equal(createScrollAnchor(100, []), null)
})

test('scroll anchors keep deterministic sub-pixel precision across repeated restores', () => {
  const pages = [
    { pageNumber: 1, top: 30.25, height: 900.375 },
    { pageNumber: 2, top: 958.875, height: 1200.625 },
  ]
  const initialScrollTop = 1558.375
  const anchor = createScrollAnchor(initialScrollTop, pages)

  assert.deepEqual(anchor, { pageNumber: 2, offsetRatio: 0.499323 })

  let restoredScrollTop = initialScrollTop
  for (let index = 0; index < 20; index += 1) {
    const currentAnchor = createScrollAnchor(restoredScrollTop, pages)
    restoredScrollTop = resolveScrollAnchor(currentAnchor, pages, restoredScrollTop)
  }

  assert.equal(restoredScrollTop, 1558.374676875)
  assert.deepEqual(createScrollAnchor(restoredScrollTop, pages), anchor)
})

const portraitPages = Array.from({ length: 16 }, (_, index) => ({
  pageNumber: index + 1,
  top: 22 + index * (494.46875 + 18),
  height: 494.46875,
}))
const landscapePages = Array.from({ length: 16 }, (_, index) => ({
  pageNumber: index + 1,
  top: 30 + index * (1204.859375 + 28),
  height: 1204.859375,
}))
const portraitViewport = { width: 420, height: 694 }
const landscapeViewport = { width: 922, height: 376 }

test('layout changes retain the old reading anchor before the resize observer runs', () => {
  const tracker = createReadingPositionTracker()
  tracker.commit(0, portraitPages, portraitViewport)
  const before = tracker.capture(3301, portraitPages, portraitViewport)

  // Responsive CSS has already changed the padding and gaps, but Vue has not
  // yet updated the page dimensions. This must not become the new anchor.
  const intermediatePages = portraitPages.map((page, index) => ({
    ...page,
    top: page.top + 8 + index * 10,
  }))
  assert.deepEqual(tracker.capture(3301, intermediatePages, landscapeViewport), before)
  const restored = tracker.resolve(landscapePages)
  assert.equal(restored, resolveScrollAnchor(before.scrollAnchor, landscapePages))
})

test('repeated layout restores retain the original anchor despite browser scroll rounding', () => {
  const tracker = createReadingPositionTracker()
  tracker.commit(0, portraitPages, portraitViewport)
  const before = tracker.capture(3301, portraitPages, portraitViewport)

  for (let cycle = 0; cycle < 100; cycle += 1) {
    for (const [pages, viewport] of [
      [landscapePages, landscapeViewport],
      [portraitPages, portraitViewport],
    ]) {
      const actualScrollTop = Math.round(tracker.resolve(pages))
      tracker.commit(actualScrollTop, pages, viewport)
      // Browsers dispatch a scroll event asynchronously after scrollTop is set.
      assert.deepEqual(
        tracker.capture(actualScrollTop, pages, viewport).scrollAnchor,
        before.scrollAnchor,
      )
    }
    assert.equal(tracker.get().scrollTop, before.scrollTop)
  }
})

test('a viewport height change cannot replace the anchor with an automatically clamped position', () => {
  const tracker = createReadingPositionTracker()
  tracker.commit(0, portraitPages, portraitViewport)
  const before = tracker.capture(7600, portraitPages, portraitViewport)

  assert.deepEqual(
    tracker.capture(7300, portraitPages, { ...portraitViewport, height: 1000 }),
    before,
  )
  tracker.commit(7300, portraitPages, { ...portraitViewport, height: 1000 })
  assert.deepEqual(tracker.get().scrollAnchor, before.scrollAnchor)
  assert.ok(Math.abs(tracker.resolve(portraitPages) - 7600) < 0.001)
})

test('actual user scrolling updates the anchor after a layout restore', () => {
  const tracker = createReadingPositionTracker()
  tracker.commit(0, portraitPages, portraitViewport)
  tracker.capture(3301, portraitPages, portraitViewport)
  const restored = Math.round(tracker.resolve(landscapePages))
  tracker.commit(restored, landscapePages, landscapeViewport)

  const afterScroll = tracker.capture(restored + 137, landscapePages, landscapeViewport)
  assert.deepEqual(afterScroll.scrollAnchor, createScrollAnchor(restored + 137, landscapePages))
  assert.equal(afterScroll.scrollTop, restored + 137)
})

test('explicit page navigation can establish a new anchor after zoom or rotation', () => {
  const tracker = createReadingPositionTracker()
  tracker.commit(0, portraitPages, portraitViewport)
  tracker.capture(3301, portraitPages, portraitViewport)

  const position = tracker.capture(landscapePages[3].top, landscapePages, landscapeViewport, true)
  assert.deepEqual(position.scrollAnchor, { pageNumber: 4, offsetRatio: 0 })
  assert.deepEqual(tracker.get(), position)
})

test('restored document anchors survive the first layout and reset independently', () => {
  const tracker = createReadingPositionTracker()
  const anchor = { pageNumber: 7, offsetRatio: 0.413146 }
  tracker.reset({ scrollTop: 3301, scrollAnchor: anchor })

  assert.deepEqual(tracker.capture(0, landscapePages, landscapeViewport), {
    scrollTop: 3301,
    scrollAnchor: anchor,
  })
  tracker.commit(Math.round(tracker.resolve(landscapePages)), landscapePages, landscapeViewport)
  assert.deepEqual(tracker.get().scrollAnchor, anchor)

  tracker.reset({ scrollTop: 0, scrollAnchor: null })
  tracker.commit(0, portraitPages, portraitViewport)
  assert.equal(tracker.get().scrollTop, 0)
  assert.deepEqual(tracker.get().scrollAnchor, createScrollAnchor(0, portraitPages))
})
