import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
const viewerSource = await readFile(new URL('../src/components/PdfViewer.vue', import.meta.url), 'utf8')

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('pointer dragging suppresses PDF resize rendering until the sidebar is released', () => {
  assert.match(
    appSource,
    /:suppress-resize-render="resizingSidebar \|\| focusMode"/,
  )

  const resizeObserverSource = sourceBetween(
    viewerSource,
    'resizeObserver = new ResizeObserver',
    'if (props.active && viewportElement.value)',
  )
  assert.match(
    resizeObserverSource,
    /if \(!props\.active \|\| props\.suppressResizeRender\) \{[\s\S]*?return\n    \}/,
  )
})

test('focus mode restores responsive spacing without resizing or invalidating canvases', () => {
  const suppressedResizeSource = sourceBetween(
    viewerSource,
    'if (!props.active || props.suppressResizeRender) {',
    'if (entries[0].contentRect.width)',
  )

  assert.match(suppressedResizeSource, /if \(props\.active && props\.focusMode\) restoreReadingPosition\(\)/)
  assert.doesNotMatch(suppressedResizeSource, /invalidateVisiblePages|scheduleResizeRender|viewportWidth\.value =/)
})

test('continuous viewport changes debounce to one position-preserving resize commit', () => {
  const scheduleSource = sourceBetween(
    viewerSource,
    'function scheduleResizeRender()',
    'function changeZoom',
  )

  assert.match(scheduleSource, /if \(resizeRenderTimer\) clearTimeout\(resizeRenderTimer\)/)
  assert.match(scheduleSource, /resizeRenderTimer = window\.setTimeout/)
  assert.match(scheduleSource, /syncViewportWidthPreservingPosition\(\)/)
})

test('resize commits capture the old anchor and restore it after updating page dimensions', () => {
  const syncSource = sourceBetween(
    viewerSource,
    'function syncViewportWidthPreservingPosition()',
    'function scheduleResizeRender',
  )

  const captureIndex = syncSource.indexOf('getReadingPosition()')
  const widthIndex = syncSource.indexOf('viewportWidth.value = width')
  assert.ok(captureIndex >= 0, 'resize commit must capture a page-relative anchor')
  assert.ok(widthIndex > captureIndex, 'the anchor must be captured before page dimensions change')
  assert.match(syncSource, /invalidateVisiblePages\(false\)/)
  assert.match(syncSource, /nextTick\(restoreReadingPosition\)/)

  const suppressionWatcherSource = sourceBetween(
    viewerSource,
    'watch(() => props.suppressResizeRender',
    '</script>',
  )
  assert.match(
    suppressionWatcherSource,
    /nextTick\(syncViewportWidthPreservingPosition\)/,
  )
})
