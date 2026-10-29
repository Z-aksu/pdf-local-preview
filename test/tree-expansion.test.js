import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createServer } from 'vite'

let vite

test.before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  })
})

test.after(async () => {
  await vite?.close()
})

async function renderComponent(modulePath, props) {
  const { default: component } = await vite.ssrLoadModule(modulePath)
  return renderToString(createSSRApp(component, props))
}

test('document tab picker exposes its count and an accessible collapsed trigger', async () => {
  const tabs = Array.from({ length: 16 }, (_, index) => ({
    path: `资料/文档${index + 1}.pdf`,
    name: `文档${index + 1}.pdf`,
  }))
  const html = await renderComponent('/src/components/DocumentTabPicker.vue', {
    tabs,
    activePath: tabs[8].path,
  })

  assert.match(html, /aria-label="查看 16 个已打开文档"/)
  assert.match(html, /aria-haspopup="dialog"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-controls="document-tab-picker-panel"/)
  assert.doesNotMatch(html, /role="dialog"/)
})

test('document tab picker can be disabled while the tab bar is hidden', async () => {
  const html = await renderComponent('/src/components/DocumentTabPicker.vue', {
    tabs: [{ path: '文档.pdf', name: '文档.pdf' }],
    activePath: '文档.pdf',
    disabled: true,
  })

  const trigger = html.match(/<button[^>]*>/)?.[0]
  assert.ok(trigger)
  assert.match(trigger, /disabled/)
  assert.match(trigger, /aria-expanded="false"/)
})

test('file tree mounts nested folders from controlled collapsed paths', async () => {
  const node = {
    type: 'directory',
    name: '一级目录',
    path: '一级目录',
    children: [{
      type: 'directory',
      name: '二级目录',
      path: '一级目录/二级目录',
      children: [{ type: 'file', name: '文档.pdf', path: '一级目录/二级目录/文档.pdf' }],
    }],
  }

  const expandedHtml = await renderComponent('/src/components/TreeNode.vue', { node })
  assert.match(expandedHtml, /二级目录/)

  const collapsedHtml = await renderComponent('/src/components/TreeNode.vue', {
    node,
    collapsedPaths: new Set(['一级目录']),
  })
  assert.match(collapsedHtml, /一级目录/)
  assert.doesNotMatch(collapsedHtml, /二级目录/)
})

test('file tree renders persisted collapsed paths without collapsing sibling branches', async () => {
  const node = {
    type: 'directory',
    name: '资料',
    path: '资料',
    children: [{
      type: 'directory',
      name: '真题',
      path: '资料/真题',
      children: [{ type: 'file', name: '试卷.pdf', path: '资料/真题/试卷.pdf' }],
    }, {
      type: 'directory',
      name: '答案',
      path: '资料/答案',
      children: [{ type: 'file', name: '答案.pdf', path: '资料/答案/答案.pdf' }],
    }],
  }

  const html = await renderComponent('/src/components/TreeNode.vue', {
    node,
    collapsedPaths: new Set(['资料/真题']),
  })

  assert.match(html, /真题/)
  assert.doesNotMatch(html, /试卷\.pdf/)
  assert.match(html, /答案\.pdf/)
})

test('outline tree mounts nested bookmarks with the current collapse command', async () => {
  const node = {
    id: 'chapter-1',
    title: '第一章',
    pageNumber: 1,
    items: [{ id: 'section-1', title: '第一节', pageNumber: 2, items: [] }],
  }

  const expandedHtml = await renderComponent('/src/components/OutlineNode.vue', { node })
  assert.match(expandedHtml, /第一节/)

  const collapsedHtml = await renderComponent('/src/components/OutlineNode.vue', {
    node,
    expansionCommand: { expanded: false, sequence: 1 },
  })
  assert.match(collapsedHtml, /第一章/)
  assert.doesNotMatch(collapsedHtml, /第一节/)
})

test('app renders the sidebar collapse and resize controls', async () => {
  const html = await renderComponent('/src/App.vue', {})

  assert.match(html, /收起文件目录/)
  assert.match(html, /调整侧栏宽度/)
  assert.match(html, /aria-valuemin="220"/)
})

test('file rows render an accessible favorite toggle without removing the file action', async () => {
  const file = { type: 'file', name: '文档.pdf', path: '资料/文档.pdf' }
  const html = await renderComponent('/src/components/TreeNode.vue', {
    node: file,
    favoritePaths: [file.path],
  })

  assert.match(html, /取消收藏 文档\.pdf/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, />文档\.pdf</)
})

test('pdf viewer exposes the mobile landscape reading control', async () => {
  const html = await renderComponent('/src/components/PdfViewer.vue', {
    src: '/api/pdf?path=文档.pdf',
    fileName: '文档.pdf',
  })

  assert.match(html, /进入横屏阅读/)
  assert.match(html, /aria-pressed="false"/)

  const activeHtml = await renderComponent('/src/components/PdfViewer.vue', {
    src: '/api/pdf?path=文档.pdf',
    fileName: '文档.pdf',
    readingMode: true,
  })

  assert.match(activeHtml, /退出横屏阅读/)
  assert.match(activeHtml, /aria-pressed="true"/)
})

test('focus tab switching restores the landscape viewer after changing documents', async () => {
  const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
  const viewerSource = await readFile(new URL('../src/components/PdfViewer.vue', import.meta.url), 'utf8')

  assert.match(appSource, /const shouldRestoreLandscape = readingMode\.value/)
  assert.match(appSource, /nextViewer\?\.restoreLandscapeReading\?\./)
  assert.match(viewerSource, /restoreLandscapeReading: \(\) => enterLandscapeReading\(\{ fit: false \}\)/)
  assert.match(viewerSource, /if \(props\.readingMode\) void enterLandscapeReading\(\{ fit: false \}\)/)
  assert.match(appSource, /ref="readerPanelsElement" class="reader-panels"/)
  assert.match(appSource, /:fullscreen-target="readerPanelsElement"/)
  assert.match(viewerSource, /prepareForTabSwitch: \(\) => leaveLandscapeReading\(\{ preserveFullscreen: true \}\)/)
  assert.match(viewerSource, /if \(document\.fullscreenElement !== fullscreenElement\)/)
})

test('landscape entry reuses one transition when the click and reading-mode watcher overlap', async () => {
  const viewerSource = await readFile(new URL('../src/components/PdfViewer.vue', import.meta.url), 'utf8')

  assert.match(viewerSource, /let landscapeEnterPromise = null/)
  assert.match(viewerSource, /if \(landscapeEnterPromise\) return landscapeEnterPromise/)
  assert.match(viewerSource, /const transition = enterLandscapeReadingInternal\(options\)/)
  assert.match(viewerSource, /landscapeEnterPromise = null\n  landscapeAttempt \+= 1/)
})

test('tab-switch fullscreen preservation only tracks a pending landscape transition', async () => {
  const viewerSource = await readFile(new URL('../src/components/PdfViewer.vue', import.meta.url), 'utf8')

  assert.match(viewerSource, /const hadPendingLandscapeRequest = Boolean\(landscapeEnterPromise\)/)
  assert.match(viewerSource, /if \(preserveFullscreen && hadPendingLandscapeRequest\) \{\n    preservedFullscreenAttempts\.add\(cancelledAttempt\)/)
})

test('pdf viewer exposes the non-destructive focus mode control', async () => {
  const html = await renderComponent('/src/components/PdfViewer.vue', {
    src: '/api/pdf?path=文档.pdf',
    fileName: '文档.pdf',
  })

  assert.match(html, /进入专注模式/)
  assert.match(html, /Ctrl\+Shift\+F/)

  const focusHtml = await renderComponent('/src/components/PdfViewer.vue', {
    src: '/api/pdf?path=文档.pdf',
    fileName: '文档.pdf',
    focusMode: true,
  })

  assert.match(focusHtml, /class="focus-mode-exit-button"/)
  assert.match(focusHtml, /aria-label="退出专注模式"/)
  const focusExitOpeningTag = focusHtml.match(/<button class="focus-mode-exit-button"[^>]*>/)?.[0]
  assert.ok(focusExitOpeningTag)
  assert.doesNotMatch(focusExitOpeningTag, /aria-hidden="true"/)
  assert.doesNotMatch(focusExitOpeningTag, /tabindex="-1"/)
})
