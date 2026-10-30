<script setup>
import { useI18n } from '../i18n.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

import { normalizeOutlineTree } from '../outline.js'
import { createReadingPositionTracker, resolveScrollAnchor } from '../scroll-position.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const { t, language } = useI18n()

const props = defineProps({
  src: {
    type: String,
    required: true,
  },
  fileName: {
    type: String,
    required: true,
  },
  fullscreenTarget: {
    type: Object,
    default: null,
  },
  active: {
    type: Boolean,
    default: true,
  },
  readingMode: {
    type: Boolean,
    default: false,
  },
  focusTabSwitchEnabled: {
    type: Boolean,
    default: false,
  },
  tabItems: {
    type: Array,
    default: () => [],
  },
  activeTabPath: {
    type: String,
    default: '',
  },
  focusMode: {
    type: Boolean,
    default: false,
  },
  suppressResizeRender: {
    type: Boolean,
    default: false,
  },
  initialScrollTop: {
    type: Number,
    default: 0,
  },
  initialScrollAnchor: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits([
  'outline-change',
  'scroll-change',
  'toggle-reading-mode',
  'switch-tab',
  'toggle-focus-mode',
])

const viewerElement = ref(null)
const viewportElement = ref(null)
const pages = ref([])
const loading = ref(true)
const errorMessage = ref('')
const currentPage = ref(1)
const zoom = ref(1)
const rotation = ref(0)
const viewportWidth = ref(1000)
const landscapeReading = ref(false)
const nativeFullscreen = ref(false)

const totalPages = computed(() => pages.value.length)
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
const readingModeActive = computed(() => props.readingMode || landscapeReading.value)

const pageElements = new Map()
const canvasElements = new Map()
const renderTasks = new Map()
const renderOperations = new Map()
const nearPages = new Set()

let loadingTask = null
let pdfDocument = null
let intersectionObserver = null
let resizeObserver = null
let documentGeneration = 0
let scrollFrame = 0
let restoreFrame = 0
let restoreTimer = 0
let resizeRenderTimer = 0
let scrollEmitTimer = 0
let pendingScrollTop = null
let lastEmittedScrollTop = null
const readingPosition = createReadingPositionTracker()
let restoringScroll = false
let componentMounted = false
let landscapeAttempt = 0
let landscapeEnterPromise = null
const preservedFullscreenAttempts = new Set()
let ownsLandscapeBodyClass = false
let documentClosing = false

function getInitialScrollTop() {
  const scrollTop = Number(props.initialScrollTop)
  return Number.isFinite(scrollTop) && scrollTop >= 0 ? scrollTop : 0
}

function getInitialScrollAnchor() {
  const pageNumber = Number(props.initialScrollAnchor?.pageNumber)
  const offsetRatio = Number(props.initialScrollAnchor?.offsetRatio)
  return Number.isInteger(pageNumber) && pageNumber > 0 && Number.isFinite(offsetRatio)
    ? { pageNumber, offsetRatio }
    : null
}

function getViewportSize() {
  const container = viewportElement.value
  return container ? { width: container.clientWidth, height: container.clientHeight } : null
}

function resolveScrollTop(scrollAnchor, fallbackScrollTop) {
  return resolveScrollAnchor(scrollAnchor, getPageMetrics(), fallbackScrollTop)
}

function getPageMetrics() {
  const container = viewportElement.value
  if (!container) return []

  const containerRect = container.getBoundingClientRect()
  const scrollTop = container.scrollTop
  return [...pageElements.entries()].map(([pageNumber, element]) => {
    const rect = element.getBoundingClientRect()
    return {
      pageNumber,
      // offsetTop/offsetHeight are integer values. Using the actual layout rect
      // avoids turning a fractional PDF page size into a cumulative scroll drift.
      top: rect.top - containerRect.top + scrollTop,
      height: Math.max(1, rect.height),
    }
  })
}

function getReadingPosition() {
  const container = viewportElement.value
  if (!container || restoringScroll) return readingPosition.get()
  return readingPosition.capture(container.scrollTop, getPageMetrics(), getViewportSize())
}

function restoreReadingPosition() {
  const container = viewportElement.value
  if (!props.active || !container) return

  const wasRestoring = restoringScroll
  restoringScroll = true
  container.scrollTop = readingPosition.resolve(getPageMetrics())
  readingPosition.commit(container.scrollTop, getPageMetrics(), getViewportSize())
  restoringScroll = wasRestoring
}

function getDisplayDimensions(page) {
  const rotated = rotation.value % 180 !== 0
  const sourceWidth = rotated ? page.height : page.width
  const sourceHeight = rotated ? page.width : page.height
  const availableWidth = Math.max(240, viewportWidth.value - 72)
  const width = Math.min(960, availableWidth) * zoom.value
  return {
    width,
    height: width * (sourceHeight / sourceWidth),
  }
}

function pageStyle(page) {
  const dimensions = getDisplayDimensions(page)
  return {
    width: `${dimensions.width}px`,
    // Keep the page's content box fixed while the canvas is rendered lazily.
    // The border is outside this size (see .pdf-page's content-box rule), so
    // replacing the placeholder canvas cannot change the document height.
    height: `${dimensions.height}px`,
  }
}

function cancelRender(pageNumber) {
  renderOperations.delete(pageNumber)
  const task = renderTasks.get(pageNumber)
  if (task) {
    task.cancel()
    renderTasks.delete(pageNumber)
  }
}

function clearPage(pageNumber) {
  cancelRender(pageNumber)
  const canvas = canvasElements.get(pageNumber)
  if (canvas) {
    canvas.width = 0
    canvas.height = 0
  }
  const page = pages.value[pageNumber - 1]
  if (page) {
    page.renderedKey = ''
    page.status = 'idle'
  }
}

async function renderPage(pageNumber) {
  const pageState = pages.value[pageNumber - 1]
  const canvas = canvasElements.get(pageNumber)
  const activeDocument = pdfDocument
  const generation = documentGeneration
  const operation = Symbol(`render-page-${pageNumber}`)
  let activeRenderTask = null
  if (!props.active || !pageState || !canvas || !activeDocument) return

  const dimensions = getDisplayDimensions(pageState)
  const renderKey = [Math.round(dimensions.width), rotation.value, window.devicePixelRatio].join(':')
  if (pageState.renderedKey === renderKey || renderOperations.has(pageNumber)) return

  cancelRender(pageNumber)
  renderOperations.set(pageNumber, operation)
  const hadRenderedCanvas = pageState.status === 'ready' && canvas.width > 0 && canvas.height > 0
  if (!hadRenderedCanvas) pageState.status = 'loading'
  pageState.error = ''

  try {
    const page = await activeDocument.getPage(pageNumber)
    if (
      renderOperations.get(pageNumber) !== operation
      || !props.active
      || generation !== documentGeneration
      || activeDocument !== pdfDocument
    ) return

    const currentDimensions = getDisplayDimensions(pageState)
    const currentRenderKey = [Math.round(currentDimensions.width), rotation.value, window.devicePixelRatio].join(':')
    if (currentRenderKey !== renderKey) return

    const baseViewport = page.getViewport({ scale: 1, rotation: rotation.value })
    const cssScale = dimensions.width / baseViewport.width
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const renderViewport = page.getViewport({ scale: cssScale * pixelRatio, rotation: rotation.value })

    const renderCanvas = document.createElement('canvas')
    renderCanvas.width = Math.floor(renderViewport.width)
    renderCanvas.height = Math.floor(renderViewport.height)

    const context = renderCanvas.getContext('2d', { alpha: false })
    activeRenderTask = page.render({ canvasContext: context, viewport: renderViewport })
    renderTasks.set(pageNumber, activeRenderTask)
    await activeRenderTask.promise

    if (
      renderOperations.get(pageNumber) === operation
      && props.active
      && generation === documentGeneration
      && activeDocument === pdfDocument
      && nearPages.has(pageNumber)
    ) {
      const visibleCanvas = canvasElements.get(pageNumber)
      if (!visibleCanvas) return

      visibleCanvas.width = renderCanvas.width
      visibleCanvas.height = renderCanvas.height
      visibleCanvas.style.width = `${dimensions.width}px`
      visibleCanvas.style.height = `${dimensions.height}px`
      visibleCanvas.getContext('2d', { alpha: false })?.drawImage(renderCanvas, 0, 0)
      pageState.renderedKey = renderKey
      pageState.status = 'ready'
    }
  } catch (error) {
    if (
      renderOperations.get(pageNumber) === operation
      && error?.name !== 'RenderingCancelledException'
      && props.active
      && generation === documentGeneration
    ) {
      pageState.status = hadRenderedCanvas ? 'ready' : 'error'
      pageState.error = t('Unable to render this page.')
    }
  } finally {
    if (renderTasks.get(pageNumber) === activeRenderTask) {
      renderTasks.delete(pageNumber)
    }
    if (renderOperations.get(pageNumber) === operation) {
      renderOperations.delete(pageNumber)
    }
  }
}

async function resolveOutlineDestination(document, destination) {
  const resolvedDestination = typeof destination === 'string'
    ? await document.getDestination(destination)
    : destination
  if (!Array.isArray(resolvedDestination) || !resolvedDestination[0]) return null

  try {
    const pageIndex = await document.getPageIndex(resolvedDestination[0])
    return { pageNumber: pageIndex + 1 }
  } catch {
    return null
  }
}

async function loadOutline(document, generation) {
  try {
    const rawOutline = await document.getOutline()
    if (generation !== documentGeneration || document !== pdfDocument) return

    const outline = await normalizeOutlineTree(
      rawOutline,
      (destination) => resolveOutlineDestination(document, destination),
      'outline',
      language.value,
    )
    if (generation !== documentGeneration || document !== pdfDocument) return
    emit('outline-change', { status: 'ready', items: outline })
  } catch {
    if (generation === documentGeneration && document === pdfDocument) {
      emit('outline-change', { status: 'error', items: [] })
    }
  }
}

function createIntersectionObserver({ preserveRenderedPages = false } = {}) {
  intersectionObserver?.disconnect()
  if (!viewportElement.value) return

  const initialObservedPages = preserveRenderedPages
    ? new Set(pageElements.keys())
    : new Set()

  intersectionObserver = new IntersectionObserver((entries) => {
    if (!props.active) return
    for (const entry of entries) {
      const pageNumber = Number(entry.target.dataset.pageNumber)
      const wasInitiallyObserved = initialObservedPages.delete(pageNumber)
      if (entry.isIntersecting) {
        nearPages.add(pageNumber)
        renderPage(pageNumber)
      } else {
        nearPages.delete(pageNumber)
        if (!wasInitiallyObserved) clearPage(pageNumber)
      }
    }
  }, {
    root: viewportElement.value,
    rootMargin: '1200px 0px',
    threshold: 0.01,
  })

  for (const element of pageElements.values()) {
    intersectionObserver.observe(element)
  }
}

function setPageElement(pageNumber, element) {
  const previous = pageElements.get(pageNumber)
  if (previous && previous !== element) {
    intersectionObserver?.unobserve(previous)
  }

  if (!element) {
    pageElements.delete(pageNumber)
    return
  }

  pageElements.set(pageNumber, element)
  intersectionObserver?.observe(element)
}

function setCanvasElement(pageNumber, element) {
  if (element) canvasElements.set(pageNumber, element)
  else canvasElements.delete(pageNumber)
}

function updateCurrentPage() {
  scrollFrame = 0
  const container = viewportElement.value
  if (!container || pages.value.length === 0) return

  const targetY = container.getBoundingClientRect().top + 92
  let nearestPage = 1
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const [pageNumber, element] of pageElements) {
    const rect = element.getBoundingClientRect()
    if (rect.top <= targetY && rect.bottom >= targetY) {
      nearestPage = pageNumber
      break
    }
    const distance = Math.min(Math.abs(rect.top - targetY), Math.abs(rect.bottom - targetY))
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestPage = pageNumber
    }
  }
  currentPage.value = nearestPage
  emitScrollPosition()
}

function emitScrollPosition(immediate = false) {
  const position = getReadingPosition()
  position.scrollTop = Math.max(0, position.scrollTop)
  pendingScrollTop = position
  const positionKey = JSON.stringify(position)
  if (immediate) {
    if (scrollEmitTimer) clearTimeout(scrollEmitTimer)
    scrollEmitTimer = 0
    if (positionKey !== lastEmittedScrollTop) {
      lastEmittedScrollTop = positionKey
      emit('scroll-change', pendingScrollTop)
    }
    pendingScrollTop = null
    return
  }

  if (scrollEmitTimer) return
  scrollEmitTimer = window.setTimeout(() => {
    scrollEmitTimer = 0
    if (pendingScrollTop === null) {
      pendingScrollTop = null
      return
    }
    const pendingKey = JSON.stringify(pendingScrollTop)
    if (pendingKey === lastEmittedScrollTop) {
      pendingScrollTop = null
      return
    }
    lastEmittedScrollTop = pendingKey
    emit('scroll-change', pendingScrollTop)
    pendingScrollTop = null
  }, 100)
}

function handleScroll() {
  if (restoringScroll) return
  getReadingPosition()
  if (!scrollFrame) {
    scrollFrame = requestAnimationFrame(updateCurrentPage)
  }
}

function releaseRenderedPages() {
  for (const pageNumber of [...renderTasks.keys()]) cancelRender(pageNumber)
  nearPages.clear()
  for (const page of pages.value) clearPage(page.number)
}

function pauseViewer() {
  emitScrollPosition(true)
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
  }
  if (restoreFrame) {
    cancelAnimationFrame(restoreFrame)
    restoreFrame = 0
  }
  if (restoreTimer) {
    clearTimeout(restoreTimer)
    restoreTimer = 0
  }
  if (resizeRenderTimer) {
    clearTimeout(resizeRenderTimer)
    resizeRenderTimer = 0
  }
  restoringScroll = false
  intersectionObserver?.disconnect()
  resizeObserver?.disconnect()
  for (const pageNumber of [...renderTasks.keys()]) cancelRender(pageNumber)
  nearPages.clear()
}

async function resumeViewer() {
  await nextTick()
  const container = viewportElement.value
  if (!props.active || !container) return

  const { scrollAnchor: restoreAnchor, scrollTop: fallbackScrollTop } = readingPosition.get()
  const applyRestoredPosition = () => {
    if (!props.active || !viewportElement.value) return
    viewportElement.value.scrollTop = resolveScrollTop(restoreAnchor, fallbackScrollTop)
    readingPosition.commit(viewportElement.value.scrollTop, getPageMetrics(), getViewportSize())
  }

  restoringScroll = true
  const width = container.clientWidth
  if (width && width !== viewportWidth.value) {
    viewportWidth.value = width
    if (!props.suppressResizeRender) invalidateVisiblePages(false)
  }

  applyRestoredPosition()
  resizeObserver?.observe(container)
  createIntersectionObserver({ preserveRenderedPages: true })
  if (restoreFrame) cancelAnimationFrame(restoreFrame)
  restoreFrame = requestAnimationFrame(() => {
    restoreFrame = 0
    applyRestoredPosition()
    restoreTimer = window.setTimeout(() => {
      restoreTimer = 0
      if (!props.active || !viewportElement.value) return
      applyRestoredPosition()
      restoringScroll = false
      updateCurrentPage()
    }, 240)
  })
}

function scrollToPage(pageNumber, smooth = true) {
  const numericPage = Number(pageNumber)
  const integerPage = Number.isFinite(numericPage) ? Math.trunc(numericPage) : 1
  const safePage = Math.min(Math.max(integerPage || 1, 1), totalPages.value || 1)
  currentPage.value = safePage
  pageElements.get(safePage)?.scrollIntoView({
    behavior: smooth ? 'smooth' : 'auto',
    block: 'start',
  })
  const container = viewportElement.value
  if (container) {
    readingPosition.capture(container.scrollTop, getPageMetrics(), getViewportSize(), true)
  }
}

function handlePageInput(event) {
  scrollToPage(event.target.value)
  event.target.value = currentPage.value
}

function invalidateVisiblePages(alignCurrentPage = true) {
  for (const pageNumber of nearPages) {
    cancelRender(pageNumber)
    const page = pages.value[pageNumber - 1]
    if (page) page.renderedKey = ''
  }
  nextTick(() => {
    for (const pageNumber of nearPages) renderPage(pageNumber)
    if (alignCurrentPage) scrollToPage(currentPage.value, false)
  })
}

function syncViewportWidthPreservingPosition() {
  const container = viewportElement.value
  if (!container) return

  const width = container.clientWidth
  getReadingPosition()
  if (width && width !== viewportWidth.value) {
    viewportWidth.value = width
    invalidateVisiblePages(false)
  }
  nextTick(restoreReadingPosition)
}

function scheduleResizeRender() {
  if (!props.active || props.suppressResizeRender) return
  if (resizeRenderTimer) clearTimeout(resizeRenderTimer)
  resizeRenderTimer = window.setTimeout(() => {
    resizeRenderTimer = 0
    if (!props.active || props.suppressResizeRender) return
    syncViewportWidthPreservingPosition()
  }, 120)
}

function changeZoom(amount) {
  const nextZoom = Math.min(2.5, Math.max(0.5, Number((zoom.value + amount).toFixed(2))))
  if (nextZoom === zoom.value) return
  zoom.value = nextZoom
  invalidateVisiblePages()
}

function fitWidth({ preservePosition = false } = {}) {
  if (zoom.value === 1) return
  if (preservePosition) getReadingPosition()
  zoom.value = 1
  invalidateVisiblePages(!preservePosition)
  if (preservePosition) nextTick(restoreReadingPosition)
}

function unlockOrientation() {
  try {
    window.screen.orientation?.unlock?.()
  } catch {
    // Orientation locking is not available in every browser.
  }
}

async function lockOrientationForAttempt(attempt, element) {
  try {
    await window.screen.orientation?.lock?.('landscape')
  } catch {
    return
  }

  const stillValid = componentMounted
    && props.active
    && landscapeReading.value
    && landscapeAttempt === attempt
    && viewerElement.value === element

  if (stillValid) return

  if (componentMounted && props.active && landscapeReading.value && viewerElement.value) {
    await lockOrientationForAttempt(landscapeAttempt, viewerElement.value)
  } else {
    unlockOrientation()
  }
}

function usesCssLandscapeMode() {
  const platform = navigator.platform || ''
  const userAgent = navigator.userAgent || ''
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function setLandscapeReading(enabled) {
  const layoutChanged = landscapeReading.value !== enabled
  if (layoutChanged) getReadingPosition()
  landscapeReading.value = enabled
  if (enabled && !ownsLandscapeBodyClass) {
    document.body.classList.add('pdf-landscape-open')
    ownsLandscapeBodyClass = true
  } else if (!enabled && ownsLandscapeBodyClass) {
    document.body.classList.remove('pdf-landscape-open')
    ownsLandscapeBodyClass = false
  }
  if (layoutChanged && componentMounted && props.active) {
    nextTick(syncViewportWidthPreservingPosition)
  }
}

async function leaveLandscapeReading({ preserveFullscreen = false } = {}) {
  // A pending fullscreen request belongs to the old landscape transition.
  // Do not let a later click reuse it after this transition has been cancelled.
  const hadPendingLandscapeRequest = Boolean(landscapeEnterPromise)
  landscapeEnterPromise = null
  const cancelledAttempt = landscapeAttempt
  landscapeAttempt += 1
  if (preserveFullscreen && hadPendingLandscapeRequest) {
    preservedFullscreenAttempts.add(cancelledAttempt)
  }
  const fullscreenElement = props.fullscreenTarget || viewerElement.value
  unlockOrientation()
  const shouldExitFullscreen = !preserveFullscreen
    && nativeFullscreen.value
    && document.fullscreenElement === fullscreenElement
  nativeFullscreen.value = false
  setLandscapeReading(false)

  if (shouldExitFullscreen) {
    try {
      await document.exitFullscreen()
    } catch {
      // The browser may already have left fullscreen.
    }
  }
}

async function enterLandscapeReadingInternal({ fit = true } = {}) {
  const element = viewerElement.value
  const fullscreenElement = props.fullscreenTarget || element
  if (!element || !props.active) {
    setLandscapeReading(true)
    return
  }

  const attempt = ++landscapeAttempt
  if (fit) fitWidth({ preservePosition: true })

  // Keep the in-page landscape layer active even when the browser rejects a
  // renewed Fullscreen request after a tab switch.
  setLandscapeReading(true)

  if (usesCssLandscapeMode()) {
    await lockOrientationForAttempt(attempt, element)
    return
  }

  if (document.fullscreenElement !== fullscreenElement) {
    try {
      await fullscreenElement.requestFullscreen?.({ navigationUI: 'hide' })
    } catch {
      // Embedded browsers may reject fullscreen; CSS mode remains available.
    }
  }

  if (!componentMounted || !props.active || viewerElement.value !== element || attempt !== landscapeAttempt) {
    const transitionWasCancelled = attempt !== landscapeAttempt && !landscapeReading.value
    const componentIsInactive = !componentMounted || !props.active || viewerElement.value !== element
    const preserveFullscreen = preservedFullscreenAttempts.delete(attempt)
    if (transitionWasCancelled && !preserveFullscreen && !componentIsInactive && document.fullscreenElement === fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        // Fullscreen may already have been closed.
      }
    }
    return
  }

  if (document.fullscreenElement === fullscreenElement) {
    nativeFullscreen.value = true
  }
  await lockOrientationForAttempt(attempt, element)
}

async function enterLandscapeReading(options = {}) {
  if (landscapeEnterPromise) return landscapeEnterPromise

  const transition = enterLandscapeReadingInternal(options)
  landscapeEnterPromise = transition
  try {
    return await transition
  } finally {
    if (landscapeEnterPromise === transition) landscapeEnterPromise = null
  }
}

async function toggleReadingExperience() {
  if (landscapeReading.value) {
    await leaveLandscapeReading()
    if (props.readingMode) emit('toggle-reading-mode')
    return
  }

  if (!props.readingMode) emit('toggle-reading-mode')
  await enterLandscapeReading()
}

function handleFullscreenChange() {
  const fullscreenElement = props.fullscreenTarget || viewerElement.value
  const isReaderFullscreen = document.fullscreenElement === fullscreenElement
  if (isReaderFullscreen) {
    if (componentMounted && props.active) {
      nativeFullscreen.value = true
      setLandscapeReading(true)
    }
    return
  }

  if (nativeFullscreen.value && componentMounted && props.active) {
    nativeFullscreen.value = false
    unlockOrientation()
    setLandscapeReading(false)
    if (props.readingMode && !documentClosing) emit('toggle-reading-mode')
  }
}

function handlePageLifecycleEnd() {
  documentClosing = true
}

function handlePageLifecycleResume() {
  documentClosing = false
}

function handleVisibilityChange() {
  documentClosing = document.visibilityState === 'hidden'
}

function handleLandscapeKeydown(event) {
  if (event.key === 'Escape' && landscapeReading.value && !nativeFullscreen.value && !props.readingMode) {
    void leaveLandscapeReading()
  }
}

function rotateClockwise() {
  rotation.value = (rotation.value + 90) % 360
  invalidateVisiblePages()
}

function navigateToOutline(item) {
  if (!props.active || !Number.isInteger(item?.pageNumber)) return
  scrollToPage(item.pageNumber)
}

defineExpose({
  navigateToOutline,
  getReadingPosition,
  restoreReadingPosition,
  getScrollTop: () => getReadingPosition().scrollTop,
  prepareForTabSwitch: () => leaveLandscapeReading({ preserveFullscreen: true }),
  restoreLandscapeReading: () => enterLandscapeReading({ fit: false }),
})

async function destroyCurrentDocument() {
  const activePageNumbers = new Set([...renderOperations.keys(), ...renderTasks.keys()])
  for (const pageNumber of activePageNumbers) cancelRender(pageNumber)
  nearPages.clear()
  intersectionObserver?.disconnect()

  if (loadingTask) {
    try {
      await loadingTask.destroy()
    } catch {
      // A superseded loading task may already be closed.
    }
    loadingTask = null
  }

  if (pdfDocument) {
    try {
      await pdfDocument.destroy()
    } catch {
      // PDF.js can reject destruction while its worker is already closing.
    }
    pdfDocument = null
  }
}

async function loadDocument() {
  const generation = ++documentGeneration
  emit('outline-change', { status: 'loading', items: [] })
  loading.value = true
  errorMessage.value = ''
  pages.value = []
  currentPage.value = 1
  zoom.value = 1
  rotation.value = 0
  readingPosition.reset({
    scrollTop: getInitialScrollTop(),
    scrollAnchor: getInitialScrollAnchor(),
  })
  await destroyCurrentDocument()

  if (!props.src || generation !== documentGeneration) return

  try {
    const task = pdfjsLib.getDocument({ url: props.src })
    loadingTask = task
    const document = await task.promise
    if (generation !== documentGeneration) {
      await document.destroy()
      return
    }

    pdfDocument = document
    void loadOutline(document, generation)
    const pageMetadata = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      if (generation !== documentGeneration) return
      const viewport = page.getViewport({ scale: 1 })
      pageMetadata.push({
        number: pageNumber,
        width: viewport.width,
        height: viewport.height,
        status: 'idle',
        error: '',
        renderedKey: '',
      })
    }

    pages.value = pageMetadata
    loading.value = false
    await nextTick()
    if (props.active) await resumeViewer()
  } catch (error) {
    if (generation === documentGeneration) {
      loading.value = false
      errorMessage.value = error?.name === 'PasswordException'
        ? t('This PDF is password protected and cannot be opened.')
        : t('Unable to open this PDF: {message}', { message: error.message || t('The file may be damaged.') })
    }
  }
}

onMounted(() => {
  componentMounted = true
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  window.addEventListener('beforeunload', handlePageLifecycleEnd)
  window.addEventListener('pagehide', handlePageLifecycleEnd)
  window.addEventListener('pageshow', handlePageLifecycleResume)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('keydown', handleLandscapeKeydown)
  viewportWidth.value = viewportElement.value?.clientWidth || 1000
  if (props.readingMode && props.active) setLandscapeReading(true)
  if (props.active) createIntersectionObserver()
  resizeObserver = new ResizeObserver((entries) => {
    if (!props.active || props.suppressResizeRender) {
      return
    }
    if (entries[0].contentRect.width) {
      scheduleResizeRender()
    }
  })
  if (props.active && viewportElement.value) resizeObserver.observe(viewportElement.value)
})

onBeforeUnmount(async () => {
  componentMounted = false
  landscapeEnterPromise = null
  landscapeAttempt += 1
  const fullscreenElement = props.fullscreenTarget || viewerElement.value
  const shouldExitFullscreen = nativeFullscreen.value
    && !props.readingMode
    && document.fullscreenElement === fullscreenElement
  documentGeneration += 1
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  if (restoreFrame) cancelAnimationFrame(restoreFrame)
  if (restoreTimer) clearTimeout(restoreTimer)
  if (resizeRenderTimer) clearTimeout(resizeRenderTimer)
  resizeRenderTimer = 0
  if (scrollEmitTimer) clearTimeout(scrollEmitTimer)
  scrollEmitTimer = 0
  pendingScrollTop = null
  intersectionObserver?.disconnect()
  resizeObserver?.disconnect()
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  window.removeEventListener('beforeunload', handlePageLifecycleEnd)
  window.removeEventListener('pagehide', handlePageLifecycleEnd)
  window.removeEventListener('pageshow', handlePageLifecycleResume)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('keydown', handleLandscapeKeydown)
  unlockOrientation()
  nativeFullscreen.value = false
  if (landscapeReading.value || ownsLandscapeBodyClass) setLandscapeReading(false)
  if (shouldExitFullscreen) {
    try {
      await document.exitFullscreen()
    } catch {
      // Fullscreen may already have been closed.
    }
  }
  await destroyCurrentDocument()
})

watch(() => props.src, loadDocument, { immediate: true })
watch(() => props.active, (active) => {
  if (active) {
    if (props.readingMode) void enterLandscapeReading({ fit: false })
    resumeViewer()
  } else {
    if (landscapeReading.value) void leaveLandscapeReading({ preserveFullscreen: props.readingMode })
    pauseViewer()
  }
})
watch(() => props.readingMode, (enabled, wasEnabled) => {
  if (!componentMounted) return
  if (enabled && props.active) {
    void enterLandscapeReading()
  } else if (!enabled && wasEnabled && landscapeReading.value) {
    void leaveLandscapeReading()
  }
})
watch(() => props.suppressResizeRender, (suppress, wasSuppressed) => {
  if (!suppress && wasSuppressed && props.active) {
    nextTick(syncViewportWidthPreservingPosition)
  }
})
</script>

<template>
  <section
    ref="viewerElement"
    class="pdf-viewer"
    :class="{
      'pdf-viewer--landscape': landscapeReading,
    }"
    :aria-label="t('Reading {name}', { name: fileName })"
  >
    <header class="reader-toolbar">
      <div class="document-identity">
        <span class="document-badge">PDF</span>
        <div>
          <strong :title="fileName">{{ fileName }}</strong>
          <span v-if="totalPages">{{ t(totalPages === 1 ? '{count} page' : '{count} pages', { count: totalPages }) }}</span>
          <span v-else>{{ t("Loading document") }}</span>
        </div>
      </div>

      <div class="toolbar-group toolbar-group--pages" :aria-label="t('Page navigation')">
        <button class="toolbar-button" type="button" :title="t('Previous page')" :disabled="currentPage <= 1" @click="scrollToPage(currentPage - 1)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg>
        </button>
        <label class="page-control">
          <span class="sr-only">{{ t("Current page") }}</span>
          <input :value="currentPage" type="number" min="1" step="1" :max="totalPages || 1" @change="handlePageInput" />
          <span>/ {{ totalPages || '—' }}</span>
        </label>
        <button class="toolbar-button" type="button" :title="t('Next page')" :disabled="currentPage >= totalPages" @click="scrollToPage(currentPage + 1)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
        </button>
      </div>

      <div class="toolbar-group toolbar-group--zoom" :aria-label="t('Zoom controls')">
        <button class="toolbar-button" type="button" :title="t('Zoom out')" :disabled="zoom <= 0.5" @click="changeZoom(-0.15)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" /></svg>
        </button>
        <button class="zoom-indicator" type="button" :title="t('Reset to fit width')" @click="fitWidth">{{ zoomLabel }}</button>
        <button class="toolbar-button" type="button" :title="t('Zoom in')" :disabled="zoom >= 2.5" @click="changeZoom(0.15)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg>
        </button>
        <button class="toolbar-button toolbar-button--labeled" type="button" :title="t('Fit to width')" @click="fitWidth">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6V3h3M14 3h3v3M17 14v3h-3M6 17H3v-3M6 10h8" /></svg>
          <span>{{ t("Fit width") }}</span>
        </button>
        <button class="toolbar-button" type="button" :title="t('Rotate clockwise')" @click="rotateClockwise">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7A6 6 0 1 0 16 12M15.5 3v4h-4" /></svg>
        </button>
        <a class="toolbar-button" :href="src" :download="fileName" :title="t('Download PDF')">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 16h12" /></svg>
        </a>
        <button
          class="toolbar-button reader-mode-button"
          :class="{ 'reader-mode-button--active': readingModeActive }"
          type="button"
          :title="t(readingModeActive ? 'Exit landscape reading (Esc)' : 'Enter landscape reading')"
          :aria-label="t(readingModeActive ? 'Exit landscape reading' : 'Enter landscape reading')"
          :aria-pressed="readingModeActive"
          @click="toggleReadingExperience"
        >
          <svg v-if="readingModeActive" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" />
          </svg>
          <svg v-else viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 3H3v5M12 3h5v5M8 17H3v-5M12 17h5v-5" />
          </svg>
          <span>{{ t(readingModeActive ? 'Exit landscape' : 'Landscape') }}</span>
        </button>
        <button
          class="toolbar-button focus-mode-button"
          :class="{ 'focus-mode-button--active': focusMode }"
          type="button"
          :title="t(focusMode ? 'Exit focus mode (Esc / Ctrl+Shift+F)' : 'Focus mode (Ctrl+Shift+F)')"
          :aria-label="t(focusMode ? 'Exit focus mode' : 'Enter focus mode')"
          :aria-pressed="focusMode"
          @click="emit('toggle-focus-mode')"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
          </svg>
          <span>{{ t(focusMode ? 'Exit focus' : 'Focus') }}</span>
        </button>
      </div>
    </header>

    <nav
      v-if="focusTabSwitchEnabled && focusMode && active && tabItems.length"
      class="focus-tab-switcher"
      :aria-label="t('Quick tab switching in focus mode')"
    >
      <button
        v-for="(tab, index) in tabItems"
        :key="tab.path"
        class="focus-tab-switcher-button"
        :class="{ 'focus-tab-switcher-button--active': tab.path === activeTabPath }"
        type="button"
        :aria-label="t('Switch to tab {number}: {name}', { number: index + 1, name: tab.name })"
        :aria-current="tab.path === activeTabPath ? 'page' : undefined"
        :title="tab.name"
        @click="emit('switch-tab', tab.path)"
      >
        {{ index + 1 }}
      </button>
    </nav>

    <div
      ref="viewportElement"
      class="pdf-viewport"
      @scroll.passive="handleScroll"
    >
      <div v-if="loading" class="reader-status" aria-live="polite">
        <span class="document-loader"><i /><i /><i /></span>
        <strong>{{ t("Opening document") }}</strong>
        <span>{{ t("PDF.js is analyzing the page structure…") }}</span>
      </div>

      <div v-else-if="errorMessage" class="reader-status reader-status--error" role="alert">
        <span class="error-seal">!</span>
        <strong>{{ t("Unable to open document") }}</strong>
        <span>{{ errorMessage }}</span>
        <button class="text-button" type="button" @click="loadDocument">{{ t("Reload") }}</button>
      </div>

      <div v-else class="pdf-pages">
        <article
          v-for="page in pages"
          :key="page.number"
          :ref="(element) => setPageElement(page.number, element)"
          class="pdf-page"
          :class="{ 'pdf-page--active': page.number === currentPage }"
          :data-page-number="page.number"
          :style="pageStyle(page)"
          :aria-label="t('Page {number}', { number: page.number })"
        >
          <canvas :ref="(element) => setCanvasElement(page.number, element)" />
          <div v-if="page.status === 'loading' || page.status === 'idle'" class="page-loading">
            <span class="page-loading-number">{{ page.number }}</span>
            <span class="state-spinner" />
          </div>
          <div v-else-if="page.status === 'error'" class="page-error">{{ page.error }}</div>
          <span class="page-number">{{ page.number }}</span>
        </article>
      </div>
    </div>

    <button
      v-if="focusMode"
      class="focus-mode-exit-button"
      type="button"
      :title="t('Exit focus mode')"
      :aria-label="t('Exit focus mode')"
      @click="emit('toggle-focus-mode')"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M8 4H4v12h4M11 7l3 3-3 3M14 10H7" />
      </svg>
      <span>{{ t("Exit") }}</span>
    </button>
  </section>
</template>
