<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'

import PdfViewer from './components/PdfViewer.vue'
import DocumentTabPicker from './components/DocumentTabPicker.vue'
import OutlineNode from './components/OutlineNode.vue'
import TreeNode from './components/TreeNode.vue'
import LockScreen from './components/LockScreen.vue'
import { createBlurLock } from './blur-lock.js'
import {
  closeDocumentTab,
  closeDocumentTabs,
  openDocumentTab,
  refreshDocumentTabs,
} from './tabs.js'
import { countOutlineItems } from './outline.js'
import {
  FAVORITES_STORAGE_KEY,
  parsePersistedFavorites,
  resolveFavoriteFiles,
  serializeFavorites,
  toggleFavoritePath,
} from './favorites.js'
import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './sidebar.js'
import {
  parsePersistedTabs,
  serializeDocumentTabs,
  TABS_STORAGE_KEY,
} from './tab-persistence.js'
import {
  collectDirectoryPaths,
  parsePersistedCollapsedDirectoryPaths,
  reconcileCollapsedDirectoryPaths,
  serializeCollapsedDirectoryPaths,
  setDirectoryExpanded,
  TREE_EXPANSION_STORAGE_KEY,
} from './tree-expansion.js'
import {
  clampTabContextMenuPosition,
  getNextMenuItemIndex,
  getTabCloseAvailability,
} from './tab-context-menu.js'
import { isFocusModeShortcut, resolveDocumentTitle } from './focus-mode.js'
import { createWorkspaceStorageKey } from './workspace-storage.js'
import { I18N_KEY, useI18n } from './i18n.js'
import { DEFAULT_LANGUAGE, isSupportedLanguage } from '../shared/localization.js'

const i18n = useI18n()
provide(I18N_KEY, i18n)
const { t, language } = i18n

const tree = ref([])
const rootName = ref('')
const displayRootName = computed(() => rootName.value || t('Local PDFs'))
const totalCount = ref(0)
const workspaceId = ref('')
const openTabs = ref([])
const activeTabPath = ref('')
const tabScrollPositions = ref(new Map())
const tabScrollAnchors = ref(new Map())
const favoritePaths = ref([])
const loading = ref(true)
const errorMessage = ref('')
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(false)
const sidebarWidth = ref(SIDEBAR_DEFAULT_WIDTH)
const resizingSidebar = ref(false)
const viewportWidth = ref(0)
const treeInitialized = ref(false)
const emptyReaderElement = ref(null)
const readerPanelsElement = ref(null)
const tabContextMenuElement = ref(null)
const tabContextMenu = ref(null)
const tabButtonElements = new Map()
const viewerElements = new Map()
const outlineByPath = ref(new Map())
const sidebarMode = ref('files')
const collapsedDirectoryPaths = ref(new Set())
const outlineExpansionCommand = ref(null)
const readingMode = ref(false)
const focusTabSwitchEnabled = ref(false)
const focusMode = ref(false)
const settingsOpen = ref(false)
const configReady = ref(false)
const configLoading = ref(true)
const configError = ref('')
const screenLocked = ref(false)
const passwordRequired = ref(true)
const unlockPending = ref(false)
const unlockError = ref('')
const screenBlocked = computed(() => !configReady.value || screenLocked.value)
let blurLock = null

let treeRequestGeneration = 0
let resizePointerMoveHandler = null
let resizePointerUpHandler = null
let restoredTabs = null
let persistTimer = null
let workspaceStateRestored = false

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'pdf-local-preview.sidebar-collapsed'
const SIDEBAR_WIDTH_STORAGE_KEY = 'pdf-local-preview.sidebar-width'
const READING_MODE_STORAGE_KEY = 'pdf-local-preview.reading-mode'
const FOCUS_TAB_SWITCH_STORAGE_KEY = 'pdf-local-preview.focus-tab-switch'
const FOCUS_MODE_STORAGE_KEY = 'pdf-local-preview.focus-mode'

async function loadLockConfig() {
  configLoading.value = true
  configError.value = ''
  try {
    const response = await fetch('/api/config', { cache: 'no-store' })
    const config = await response.json()
    if (!response.ok) throw new Error(t('Unable to load local settings. Make sure the server is running and try again.'))
    const configuredLanguage = Object.hasOwn(config, 'language') ? config.language : DEFAULT_LANGUAGE
    if (typeof config.blurLockScreen !== 'boolean' || typeof config.hasLockPassword !== 'boolean' || !config.workspaceId || !isSupportedLanguage(configuredLanguage)) {
      throw new Error(t('Local settings are invalid. Restart the server and try again.'))
    }
    if (!blurLock) return
    language.value = configuredLanguage
    passwordRequired.value = config.hasLockPassword
    blurLock.configure({ enabled: config.blurLockScreen, workspaceId: config.workspaceId })
    configReady.value = true
    if (!treeInitialized.value) await loadTree()
  } catch (error) {
    configError.value = error.message || t('Unable to connect to the local server. Make sure it is running and try again.')
  } finally {
    configLoading.value = false
  }
}

async function unlockScreen(password) {
  if (unlockPending.value || !blurLock) return
  unlockPending.value = true
  unlockError.value = ''
  try {
    const unlocked = await blurLock.unlock(async () => {
      const response = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(response.status === 401 ? t('Unable to continue. Please try again.') : t('Unable to connect to the local server. Please try again later.'))
      return result.unlocked === true
    })
    if (!unlocked) unlockError.value = t('The operation was interrupted. Please try again.')
  } catch (error) {
    unlockError.value = error.message || t('Unable to connect to the local server. Please try again later.')
  } finally {
    unlockPending.value = false
  }
}

function getWorkspaceStorageKey(baseKey) {
  return createWorkspaceStorageKey(baseKey, workspaceId.value)
}

function readWorkspaceStorage(baseKey) {
  const storageKey = getWorkspaceStorageKey(baseKey)
  if (!storageKey) return null

  try {
    return localStorage.getItem(storageKey)
  } catch {
    // Storage may be disabled by the browser or privacy settings.
    return null
  }
}

function writeWorkspaceStorage(baseKey, value) {
  const storageKey = getWorkspaceStorageKey(baseKey)
  if (!storageKey) return

  try {
    localStorage.setItem(storageKey, value)
  } catch {
    // Storage may be disabled by the browser or privacy settings.
  }
}

const activeFile = computed(() => openTabs.value.find((tab) => tab.path === activeTabPath.value) || null)
const favoriteFiles = computed(() => resolveFavoriteFiles(favoritePaths.value, tree.value))
const activeOutlineState = computed(() => outlineByPath.value.get(activeTabPath.value) || {
  status: 'idle',
  items: [],
})
const activeOutlineCount = computed(() => countOutlineItems(activeOutlineState.value.items))
const sidebarMaxWidth = computed(() => (
  !viewportWidth.value
    ? SIDEBAR_DEFAULT_WIDTH
    : Math.max(SIDEBAR_MIN_WIDTH, Math.floor(viewportWidth.value * 0.5))
))
const canControlExpansion = computed(() => {
  if (sidebarMode.value === 'files') {
    return !loading.value && tree.value.some((node) => node.type === 'directory')
  }
  return activeOutlineState.value.items.some((item) => item.items?.length)
})

function pdfUrl(file) {
  return `/api/pdf?path=${encodeURIComponent(file.path)}`
}

function toggleSettings() {
  settingsOpen.value = !settingsOpen.value
}

function clearDocumentModesWhenEmpty() {
  if (openTabs.value.length > 0) return

  const clearReadingMode = readingMode.value
  const clearFocusMode = focusMode.value
  readingMode.value = false
  focusMode.value = false

  // During initial restoration Vue may batch true -> false back to the initial
  // value and skip the watchers, so clear stale persisted flags explicitly.
  if (clearReadingMode) persistReadingMode()
  if (clearFocusMode) persistFocusMode()
}

async function loadTree() {
  const generation = ++treeRequestGeneration
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/tree', { cache: 'no-store' })
    const result = await response.json()
    if (generation !== treeRequestGeneration) return
    if (!response.ok) {
      throw new Error(result.error || t('Unable to load the PDF directory.'))
    }

    if (!workspaceStateRestored && result.workspaceId) {
      workspaceId.value = String(result.workspaceId)
      workspaceStateRestored = true
      restoreSidebarState()
      restoreReadingMode()
      restoreFocusTabSwitchPreference()
      restoreFocusMode()
      restoreFavorites()
      restoreTreeExpansionState()
      restoreTabs()
    }

    tree.value = result.tree
    collapsedDirectoryPaths.value = reconcileCollapsedDirectoryPaths(
      collapsedDirectoryPaths.value,
      result.tree,
    )
    rootName.value = result.rootName
    totalCount.value = result.count

    const initialTabs = !treeInitialized.value && restoredTabs
      ? restoredTabs.tabs
      : openTabs.value
    const initialActivePath = !treeInitialized.value && restoredTabs
      ? restoredTabs.activePath
      : activeTabPath.value
    const initialScrollPositions = !treeInitialized.value && restoredTabs
      ? restoredTabs.scrollPositions
      : tabScrollPositions.value
    const initialScrollAnchors = !treeInitialized.value && restoredTabs
      ? restoredTabs.scrollAnchors
      : tabScrollAnchors.value
    const refreshed = refreshDocumentTabs(initialTabs, result.tree, initialActivePath)
    openTabs.value = refreshed.tabs
    activeTabPath.value = refreshed.activePath
    clearDocumentModesWhenEmpty()
    const refreshedPaths = new Set(refreshed.tabs.map((tab) => tab.path))
    tabScrollPositions.value = new Map(
      [...initialScrollPositions].filter(([path]) => refreshedPaths.has(path)),
    )
    tabScrollAnchors.value = new Map(
      [...initialScrollAnchors].filter(([path]) => refreshedPaths.has(path)),
    )
    const remainingPaths = new Set(refreshed.tabs.map((tab) => tab.path))
    outlineByPath.value = new Map(
      [...outlineByPath.value].filter(([path]) => remainingPaths.has(path)),
    )

    if (!treeInitialized.value) {
      treeInitialized.value = true
      restoredTabs = null
    }
  } catch (error) {
    if (generation === treeRequestGeneration) {
      errorMessage.value = error.message
    }
  } finally {
    if (generation === treeRequestGeneration) {
      loading.value = false
    }
  }
}

function setTabButton(path, element) {
  if (element) tabButtonElements.set(path, element)
  else tabButtonElements.delete(path)
}

function setViewer(path, instance) {
  if (instance) viewerElements.set(path, instance)
  else viewerElements.delete(path)
}

function setOutlineState(path, state) {
  const next = new Map(outlineByPath.value)
  next.set(path, state)
  outlineByPath.value = next
}

async function activateTab(path, focus = false) {
  captureActiveScrollPosition()
  activeTabPath.value = path
  await nextTick()
  const button = tabButtonElements.get(path)
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (focus) button?.focus()
}

async function switchFocusTab(path) {
  if (!path || path === activeTabPath.value) return

  const shouldRestoreLandscape = readingMode.value
  if (shouldRestoreLandscape) {
    const activeViewer = viewerElements.get(activeTabPath.value)
    await activeViewer?.prepareForTabSwitch?.()
  }
  await activateTab(path)

  if (shouldRestoreLandscape) {
    const nextViewer = viewerElements.get(path)
    await nextViewer?.restoreLandscapeReading?.()
  }
}

async function selectFile(file) {
  openTabs.value = openDocumentTab(openTabs.value, file)
  sidebarOpen.value = false
  await activateTab(file.path)
}

function isFavorite(path) {
  return favoritePaths.value.includes(path)
}

function toggleFavorite(file) {
  if (!file?.path) return
  favoritePaths.value = toggleFavoritePath(favoritePaths.value, file.path)
}

function toggleContextTabFavorite() {
  const path = tabContextMenu.value?.path
  const file = openTabs.value.find((tab) => tab.path === path)
  if (!file) return
  toggleFavorite(file)
  closeTabContextMenu(true)
}

function favoriteParentPath(file) {
  const separatorIndex = file.path.lastIndexOf('/')
  return separatorIndex > 0 ? file.path.slice(0, separatorIndex) : displayRootName.value
}

async function applyTabState(nextState, restoreFocus = false) {
  const remainingPaths = new Set(nextState.tabs.map((tab) => tab.path))
  const closedPaths = openTabs.value
    .map((tab) => tab.path)
    .filter((path) => !remainingPaths.has(path))

  openTabs.value = nextState.tabs
  activeTabPath.value = nextState.activePath
  clearDocumentModesWhenEmpty()
  const nextScrollPositions = new Map(tabScrollPositions.value)
  const nextScrollAnchors = new Map(tabScrollAnchors.value)
  const nextOutlines = new Map(outlineByPath.value)
  for (const path of closedPaths) {
    nextScrollPositions.delete(path)
    nextScrollAnchors.delete(path)
    nextOutlines.delete(path)
    viewerElements.delete(path)
  }
  tabScrollPositions.value = nextScrollPositions
  tabScrollAnchors.value = nextScrollAnchors
  outlineByPath.value = nextOutlines
  await nextTick()

  const activeButton = tabButtonElements.get(activeTabPath.value)
  activeButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (restoreFocus) {
    if (activeButton) activeButton.focus()
    else emptyReaderElement.value?.focus()
  }
}

async function closeTab(path, restoreFocus = false) {
  captureActiveScrollPosition()
  await applyTabState(
    closeDocumentTab(openTabs.value, path, activeTabPath.value),
    restoreFocus,
  )
}

function canCloseTabs(scope) {
  if (!tabContextMenu.value) return false
  return getTabCloseAvailability(openTabs.value, tabContextMenu.value.path)[scope] === true
}

function closeTabContextMenu(restoreFocus = false) {
  const path = tabContextMenu.value?.path
  tabContextMenu.value = null
  if (restoreFocus === true && path) {
    nextTick(() => tabButtonElements.get(path)?.focus())
  }
}

async function openTabContextMenu(event, path) {
  event.preventDefault()
  const button = tabButtonElements.get(path)
  const buttonRect = button?.getBoundingClientRect()
  const openedFromKeyboard = event.clientX === 0 && event.clientY === 0
  tabContextMenu.value = {
    path,
    x: openedFromKeyboard ? buttonRect?.left || 8 : event.clientX,
    y: openedFromKeyboard ? buttonRect?.bottom || 8 : event.clientY,
  }
  await nextTick()

  const menu = tabContextMenuElement.value
  if (!menu || tabContextMenu.value?.path !== path) return
  const position = clampTabContextMenuPosition(
    tabContextMenu.value,
    { width: menu.offsetWidth, height: menu.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  )
  tabContextMenu.value = {
    path,
    ...position,
  }
  menu.querySelector('button:not(:disabled)')?.focus()
}

async function closeTabsFromContext(scope) {
  if (!tabContextMenu.value || !canCloseTabs(scope)) return
  captureActiveScrollPosition()
  const nextState = closeDocumentTabs(
    openTabs.value,
    tabContextMenu.value.path,
    activeTabPath.value,
    scope,
  )
  closeTabContextMenu()
  await applyTabState(nextState, true)
}

function handleContextMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeTabContextMenu(true)
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

  event.preventDefault()
  const items = [...tabContextMenuElement.value.querySelectorAll('button:not(:disabled)')]
  if (!items.length) return
  const currentIndex = items.indexOf(document.activeElement)
  const nextIndex = getNextMenuItemIndex(currentIndex, items.length, event.key)
  items[nextIndex].focus()
}

function handleGlobalPointerDown(event) {
  if (tabContextMenu.value && !tabContextMenuElement.value?.contains(event.target)) {
    closeTabContextMenu()
  }
  if (settingsOpen.value && !event.target?.closest?.('.app-settings')) {
    settingsOpen.value = false
  }
}

function selectOutline(item) {
  if (!activeFile.value || !item.pageNumber) return
  viewerElements.get(activeFile.value.path)?.navigateToOutline(item)
  sidebarOpen.value = false
}

function setAllExpanded(expanded) {
  if (!canControlExpansion.value) return

  if (sidebarMode.value === 'files') {
    collapsedDirectoryPaths.value = expanded ? new Set() : collectDirectoryPaths(tree.value)
    return
  }

  outlineExpansionCommand.value = {
    expanded,
    sequence: (outlineExpansionCommand.value?.sequence || 0) + 1,
  }
}

function setFileDirectoryExpansion({ path, expanded }) {
  collapsedDirectoryPaths.value = setDirectoryExpanded(
    collapsedDirectoryPaths.value,
    path,
    expanded,
  )
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 760px)').matches
}

function persistSidebarState() {
  writeWorkspaceStorage(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed.value))
  writeWorkspaceStorage(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth.value))
}

function setSidebarWidth(width) {
  sidebarWidth.value = clampSidebarWidth(width, window.innerWidth)
}

function stopSidebarResize() {
  if (!resizingSidebar.value) return
  resizingSidebar.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  if (resizePointerMoveHandler) window.removeEventListener('pointermove', resizePointerMoveHandler)
  if (resizePointerUpHandler) window.removeEventListener('pointerup', resizePointerUpHandler)
  resizePointerMoveHandler = null
  resizePointerUpHandler = null
  persistSidebarState()
}

function startSidebarResize(event) {
  if (isMobileViewport() || sidebarCollapsed.value || event.button !== 0) return

  event.preventDefault()
  resizingSidebar.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  resizePointerMoveHandler = (moveEvent) => {
    moveEvent.preventDefault()
    setSidebarWidth(moveEvent.clientX)
  }
  resizePointerUpHandler = stopSidebarResize
  window.addEventListener('pointermove', resizePointerMoveHandler)
  window.addEventListener('pointerup', resizePointerUpHandler, { once: true })
}

function handleSidebarResizeKeydown(event) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    setSidebarWidth(sidebarWidth.value - 16)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    setSidebarWidth(sidebarWidth.value + 16)
  } else if (event.key === 'Home') {
    event.preventDefault()
    setSidebarWidth(SIDEBAR_MIN_WIDTH)
  } else if (event.key === 'End') {
    event.preventDefault()
    setSidebarWidth(window.innerWidth)
  } else {
    return
  }

  persistSidebarState()
}

function toggleSidebarCollapsed() {
  stopSidebarResize()
  sidebarCollapsed.value = !sidebarCollapsed.value
  persistSidebarState()
}

function toggleReadingMode() {
  readingMode.value = !readingMode.value
  if (readingMode.value) {
    sidebarOpen.value = false
    stopSidebarResize()
  }
}

async function setFocusMode(enabled) {
  if (enabled && !activeTabPath.value) return

  captureActiveScrollPosition()
  focusMode.value = enabled
  if (enabled) {
    closeTabContextMenu()
    sidebarOpen.value = false
    stopSidebarResize()
  }

  await nextTick()
  const activeViewer = viewerElements.get(activeTabPath.value)
  activeViewer?.restoreReadingPosition?.()
  captureActiveScrollPosition()
}

function toggleFocusMode() {
  void setFocusMode(!focusMode.value)
}

function restoreReadingMode() {
  readingMode.value = readWorkspaceStorage(READING_MODE_STORAGE_KEY) === 'true'
}

function persistReadingMode() {
  writeWorkspaceStorage(READING_MODE_STORAGE_KEY, String(readingMode.value))
}

function restoreFocusTabSwitchPreference() {
  focusTabSwitchEnabled.value = readWorkspaceStorage(FOCUS_TAB_SWITCH_STORAGE_KEY) === 'true'
}

function persistFocusTabSwitchPreference() {
  writeWorkspaceStorage(
    FOCUS_TAB_SWITCH_STORAGE_KEY,
    String(focusTabSwitchEnabled.value),
  )
}

function restoreFocusMode() {
  focusMode.value = readWorkspaceStorage(FOCUS_MODE_STORAGE_KEY) === 'true'
}

function persistFocusMode() {
  writeWorkspaceStorage(FOCUS_MODE_STORAGE_KEY, String(focusMode.value))
}

function handleGlobalKeydown(event) {
  if (screenBlocked.value) return
  if (event.key === 'Escape' && tabContextMenu.value) {
    event.preventDefault()
    closeTabContextMenu(true)
    return
  }
  if (event.key === 'Escape' && settingsOpen.value) {
    event.preventDefault()
    settingsOpen.value = false
    return
  }
  const targetTagName = String(event.target?.tagName || '').toUpperCase()
  const isEditing = event.target?.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTagName)
  if (!isEditing && isFocusModeShortcut(event)) {
    event.preventDefault()
    toggleFocusMode()
    return
  }
  if (event.key === 'Escape' && focusMode.value) {
    event.preventDefault()
    void setFocusMode(false)
    return
  }
  if (event.key === 'Escape' && readingMode.value) {
    readingMode.value = false
  }
}

function restoreSidebarState() {
  if (isMobileViewport()) return

  sidebarCollapsed.value = readWorkspaceStorage(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  const storedWidth = readWorkspaceStorage(SIDEBAR_WIDTH_STORAGE_KEY)
  if (storedWidth) setSidebarWidth(storedWidth)
}

function handleViewportResize() {
  closeTabContextMenu()
  viewportWidth.value = window.innerWidth
  if (!isMobileViewport()) setSidebarWidth(sidebarWidth.value)
}

function handleTabKeydown(event, index, path) {
  const lastIndex = openTabs.value.length - 1
  let nextIndex = null

  if (event.key === 'ArrowRight') nextIndex = index === lastIndex ? 0 : index + 1
  else if (event.key === 'ArrowLeft') nextIndex = index === 0 ? lastIndex : index - 1
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = lastIndex
  else if (event.key === 'Delete') {
    event.preventDefault()
    closeTab(path, true)
    return
  } else {
    return
  }

  event.preventDefault()
  activateTab(openTabs.value[nextIndex].path, true)
}

function createRestoredTab(path) {
  return {
    type: 'file',
    name: path.split('/').pop() || path,
    path,
  }
}

function handleTabScroll(path, position) {
  const numericScrollTop = Number(position?.scrollTop ?? position)
  if (!Number.isFinite(numericScrollTop) || numericScrollTop < 0) return
  const normalizedScrollTop = Math.round(numericScrollTop * 1000) / 1000
  const pageNumber = Number(position?.scrollAnchor?.pageNumber)
  const offsetRatio = Number(position?.scrollAnchor?.offsetRatio)
  const scrollAnchor = Number.isInteger(pageNumber) && pageNumber > 0 && Number.isFinite(offsetRatio)
    ? { pageNumber, offsetRatio }
    : null
  const previousAnchor = tabScrollAnchors.value.get(path)
  const anchorUnchanged = (!scrollAnchor && !previousAnchor) || (
    scrollAnchor
    && previousAnchor?.pageNumber === scrollAnchor.pageNumber
    && previousAnchor?.offsetRatio === scrollAnchor.offsetRatio
  )
  if (tabScrollPositions.value.get(path) === normalizedScrollTop && anchorUnchanged) return

  const nextScrollPositions = new Map(tabScrollPositions.value)
  nextScrollPositions.set(path, normalizedScrollTop)
  tabScrollPositions.value = nextScrollPositions
  const nextScrollAnchors = new Map(tabScrollAnchors.value)
  if (scrollAnchor) nextScrollAnchors.set(path, scrollAnchor)
  else nextScrollAnchors.delete(path)
  tabScrollAnchors.value = nextScrollAnchors
  schedulePersistTabs()
}

function captureActiveScrollPosition() {
  if (!activeTabPath.value) return
  const viewer = viewerElements.get(activeTabPath.value)
  const position = viewer?.getReadingPosition?.() ?? viewer?.getScrollTop?.()
  if (position !== undefined) handleTabScroll(activeTabPath.value, position)
}

function persistTabs() {
  if (!workspaceId.value) return

  captureActiveScrollPosition()
  writeWorkspaceStorage(
    TABS_STORAGE_KEY,
    serializeDocumentTabs(
      openTabs.value,
      activeTabPath.value,
      tabScrollPositions.value,
      tabScrollAnchors.value,
    ),
  )
}

function schedulePersistTabs() {
  if (persistTimer !== null) return
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    persistTabs()
  }, 150)
}

function restoreTabs() {
  const parsed = parsePersistedTabs(readWorkspaceStorage(TABS_STORAGE_KEY))
  if (!parsed) return

  restoredTabs = {
    tabs: parsed.paths.map(createRestoredTab),
    activePath: parsed.activePath,
    scrollPositions: parsed.scrollPositions,
    scrollAnchors: parsed.scrollAnchors,
  }
}

function restoreFavorites() {
  favoritePaths.value = parsePersistedFavorites(readWorkspaceStorage(FAVORITES_STORAGE_KEY))
}

function persistFavorites() {
  writeWorkspaceStorage(FAVORITES_STORAGE_KEY, serializeFavorites(favoritePaths.value))
}

function restoreTreeExpansionState() {
  collapsedDirectoryPaths.value = parsePersistedCollapsedDirectoryPaths(
    readWorkspaceStorage(TREE_EXPANSION_STORAGE_KEY),
  )
}

function persistTreeExpansionState() {
  writeWorkspaceStorage(
    TREE_EXPANSION_STORAGE_KEY,
    serializeCollapsedDirectoryPaths(collapsedDirectoryPaths.value),
  )
}

watch([activeFile, focusMode, screenBlocked, language], ([file, focused, blocked]) => {
  if (typeof document === 'undefined') return
  document.title = blocked ? '—' : resolveDocumentTitle(file?.name, focused, language.value)
}, { immediate: true })
watch(language, (value) => {
  if (typeof document === 'undefined') return
  document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en'
  const description = document.querySelector('meta[name="description"]')
  if (description) description.content = t('Read PDFs from the current directory in your browser.')
}, { immediate: true })
watch(screenBlocked, (blocked) => {
  if (!blocked) return
  closeTabContextMenu()
  settingsOpen.value = false
  sidebarOpen.value = false
  stopSidebarResize()
  unlockError.value = ''
})
watch(readingMode, persistReadingMode)
watch(focusTabSwitchEnabled, persistFocusTabSwitchPreference)
watch(focusMode, persistFocusMode)
watch(favoritePaths, persistFavorites, { deep: true })
watch(collapsedDirectoryPaths, persistTreeExpansionState)
watch([openTabs, activeTabPath, tabScrollPositions, tabScrollAnchors], schedulePersistTabs, { deep: true })

onMounted(() => {
  blurLock = createBlurLock({
    windowObject: window,
    documentObject: document,
    onChange: (locked) => { screenLocked.value = locked },
  })
  viewportWidth.value = window.innerWidth
  window.addEventListener('resize', handleViewportResize)
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('pointerdown', handleGlobalPointerDown)
  window.addEventListener('blur', closeTabContextMenu)
  window.addEventListener('beforeunload', persistTabs)
  loadLockConfig()
})

onBeforeUnmount(() => {
  blurLock?.dispose()
  blurLock = null
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = null
  stopSidebarResize()
  window.removeEventListener('resize', handleViewportResize)
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('pointerdown', handleGlobalPointerDown)
  window.removeEventListener('blur', closeTabContextMenu)
  window.removeEventListener('beforeunload', persistTabs)
})
</script>

<template>
  <div
    class="app-shell"
    :inert="screenBlocked"
    :aria-hidden="screenBlocked ? 'true' : undefined"
    :class="{
      'app-shell--locked': screenBlocked,
      'app-shell--reading-mode': readingMode,
      'app-shell--focus-mode': focusMode,
    }"
  >
    <header class="app-header">
      <button
        class="icon-button mobile-menu-button"
        type="button"
        :aria-label="t('Open file browser')"
        @click="sidebarOpen = true"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
      </button>

      <div class="brand-mark" aria-hidden="true">P</div>
      <div class="brand-copy">
        <span class="brand-name">PDF LOCAL</span>
        <span class="brand-subtitle">{{ t("Offline document reader") }}</span>
      </div>

      <div class="header-directory" :title="displayRootName">
        <span class="header-directory-label">{{ t("Current directory") }}</span>
        <strong>{{ displayRootName }}</strong>
      </div>

      <div class="app-settings">
        <button
          class="icon-button app-settings-button"
          type="button"
          :aria-expanded="settingsOpen"
          aria-controls="pdf-reader-settings"
          :title="t('Reader settings')"
          :aria-label="t('Open reader settings')"
          @click="toggleSettings"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 7.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6ZM10 3v1.4M10 15.6V17M17 10h-1.4M4.4 10H3M14.95 5.05l-.98.98M6.03 13.97l-.98.98M14.95 14.95l-.98-.98M6.03 6.03l-.98-.98" /></svg>
        </button>
        <div v-if="settingsOpen" id="pdf-reader-settings" class="app-settings-panel" role="dialog" :aria-label="t('Reader settings')">
          <div class="app-settings-heading">
            <strong>{{ t("Reader settings") }}</strong>
            <span>{{ t("Saved in this browser") }}</span>
          </div>
          <label class="settings-switch-row">
            <span>
              <strong>{{ t("Quick tab switching in focus mode") }}</strong>
              <small>{{ t("Show numbered tab buttons on the left in focus mode.") }}</small>
            </span>
            <input v-model="focusTabSwitchEnabled" type="checkbox" />
            <span class="settings-switch" aria-hidden="true" />
          </label>
        </div>
      </div>
    </header>

    <div
      class="workspace"
      :class="{
        'workspace--sidebar-collapsed': sidebarCollapsed,
        'workspace--sidebar-resizing': resizingSidebar,
      }"
      :style="{ '--sidebar-width': `${sidebarWidth}px` }"
    >
      <button
        v-if="sidebarOpen"
        class="sidebar-scrim"
        type="button"
        :aria-label="t('Close file browser')"
        @click="sidebarOpen = false"
      />

      <aside
        id="pdf-sidebar"
        class="sidebar"
        :class="{ 'sidebar--open': sidebarOpen, 'sidebar--collapsed': sidebarCollapsed }"
      >
        <div class="sidebar-heading">
          <div>
            <span class="section-kicker">{{ t("LIBRARY") }}</span>
            <h1>{{ t("File browser") }}</h1>
          </div>
          <div class="sidebar-heading-actions">
            <button
              class="icon-button sidebar-collapse-button"
              type="button"
              :title="t('Collapse file browser')"
              :aria-label="t('Collapse file browser')"
              :aria-expanded="!sidebarCollapsed"
              aria-controls="pdf-sidebar"
              @click="toggleSidebarCollapsed"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4-6 6 6 6" /></svg>
            </button>
            <button class="icon-button" type="button" :title="t('Rescan')" :aria-label="t('Rescan directory')" @click="loadTree">
              <svg :class="{ spinning: loading }" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M16 7a6.5 6.5 0 1 0 .2 5.5M16 3v4h-4" />
              </svg>
            </button>
          </div>
        </div>

        <div class="library-meta">
          <span>{{ t(totalCount === 1 ? '{count} PDF' : '{count} PDFs', { count: totalCount }) }}</span>
          <span>{{ t("Includes subfolders") }}</span>
        </div>

        <div class="sidebar-mode-switcher" role="tablist" :aria-label="t('Sidebar navigation')">
          <button
            class="sidebar-mode-button"
            :class="{ 'sidebar-mode-button--active': sidebarMode === 'files' }"
            type="button"
            role="tab"
            :aria-selected="sidebarMode === 'files'"
            @click="sidebarMode = 'files'"
          >
            <span>{{ t("Files") }}</span>
            <span>{{ totalCount }}</span>
          </button>
          <button
            class="sidebar-mode-button"
            :class="{ 'sidebar-mode-button--active': sidebarMode === 'outline' }"
            type="button"
            role="tab"
            :aria-selected="sidebarMode === 'outline'"
            :disabled="!activeFile"
            @click="sidebarMode = 'outline'"
          >
            <span>{{ t("Outline") }}</span>
            <span v-if="activeOutlineCount">{{ activeOutlineCount }}</span>
          </button>
        </div>

        <div class="sidebar-expansion-actions" role="group" :aria-label="t('Expand or collapse navigation')">
          <span>{{ t(sidebarMode === 'files' ? 'Folders' : 'Bookmarks') }}</span>
          <div>
            <button
              type="button"
              :disabled="!canControlExpansion"
              :title="t('Collapse all')"
              :aria-label="t('Collapse all')"
              @click="setAllExpanded(false)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 6 4-4 4 4M4 11l4-4 4 4M4 14h8" />
              </svg>
              <span>{{ t('Collapse') }}<span class="sidebar-expansion-label-prefix">{{ t(' all') }}</span></span>
            </button>
            <button
              type="button"
              :disabled="!canControlExpansion"
              :title="t('Expand all')"
              :aria-label="t('Expand all')"
              @click="setAllExpanded(true)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 2h8M4 5l4 4 4-4M4 10l4 4 4-4" />
              </svg>
              <span>{{ t('Expand') }}<span class="sidebar-expansion-label-prefix">{{ t(' all') }}</span></span>
            </button>
          </div>
        </div>

        <div class="tree-panel">
          <template v-if="sidebarMode === 'files'">
          <div v-if="loading" class="nav-state" aria-live="polite">
            <span class="state-spinner" />
            <span>{{ t("Scanning directory…") }}</span>
          </div>

          <div v-else-if="errorMessage" class="nav-state nav-state--error">
            <strong>{{ t("Unable to load directory") }}</strong>
            <span>{{ errorMessage }}</span>
            <button class="text-button" type="button" @click="loadTree">{{ t("Try again") }}</button>
          </div>

          <div v-else-if="tree.length === 0" class="nav-state">
            <svg class="empty-folder-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <strong>{{ t("No PDFs found") }}</strong>
            <span>{{ t("Add PDFs to this directory or its subfolders, then rescan.") }}</span>
          </div>

          <template v-else>
            <section v-if="favoriteFiles.length" class="favorites-section" :aria-label="t('Favorite shortcuts')">
              <div class="favorites-heading">
                <span>
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m10 2.7 2.2 4.45 4.9.71-3.55 3.46.84 4.88L10 13.9 5.61 16.2l.84-4.88L2.9 7.86l4.9-.71z" />
                  </svg>
                  {{ t('Favorites') }}
                </span>
                <span>{{ favoriteFiles.length }}</span>
              </div>
              <ul class="favorites-list">
                <li v-for="file in favoriteFiles" :key="file.path" class="favorite-entry">
                  <button
                    class="favorite-open-button"
                    :class="{ 'favorite-open-button--selected': file.path === activeTabPath }"
                    type="button"
                    :title="file.path"
                    @click="selectFile(file)"
                  >
                    <span class="favorite-name">{{ file.name }}</span>
                    <span class="favorite-location">{{ favoriteParentPath(file) }}</span>
                  </button>
                  <button
                    class="favorite-remove-button"
                    type="button"
                    :title="t('Remove {name} from favorites', { name: file.name })"
                    :aria-label="t('Remove {name} from favorites', { name: file.name })"
                    @click="toggleFavorite(file)"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="m10 2.7 2.2 4.45 4.9.71-3.55 3.46.84 4.88L10 13.9 5.61 16.2l.84-4.88L2.9 7.86l4.9-.71z" />
                    </svg>
                  </button>
                </li>
              </ul>
            </section>

            <ul class="tree-root" :aria-label="t('PDF file browser')">
              <TreeNode
                v-for="node in tree"
                :key="node.path"
                :node="node"
                :selected-path="activeTabPath"
                :collapsed-paths="collapsedDirectoryPaths"
                :favorite-paths="favoritePaths"
                @select="selectFile"
                @toggle-directory="setFileDirectoryExpansion"
                @toggle-favorite="toggleFavorite"
              />
            </ul>
          </template>
          </template>

          <template v-else>
            <div v-if="!activeFile" class="nav-state">
              <strong>{{ t("No PDF open") }}</strong>
              <span>{{ t("Open a PDF from the file browser first.") }}</span>
            </div>
            <div v-else-if="activeOutlineState.status === 'loading' || activeOutlineState.status === 'idle'" class="nav-state" aria-live="polite">
              <span class="state-spinner" />
              <strong>{{ t("Loading outline") }}</strong>
              <span>{{ t('Reading embedded PDF bookmarks…') }}</span>
            </div>
            <div v-else-if="activeOutlineState.status === 'error'" class="nav-state nav-state--error">
              <strong>{{ t("Unable to load outline") }}</strong>
              <span>{{ t("The bookmarks in this PDF could not be read.") }}</span>
            </div>
            <div v-else-if="activeOutlineState.items.length === 0" class="nav-state">
              <svg class="empty-folder-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5.5h16v13H4zM7 9h10M7 12h7M7 15h5" />
              </svg>
              <strong>{{ t("No outline available") }}</strong>
              <span>{{ t("This PDF has no embedded bookmarks or chapter navigation.") }}</span>
            </div>
            <ul v-else class="outline-root" :aria-label="t('PDF document outline')">
              <OutlineNode
                v-for="item in activeOutlineState.items"
                :key="item.id"
                :node="item"
                :expansion-command="outlineExpansionCommand"
                @select="selectOutline"
              />
            </ul>
          </template>
        </div>

        <div class="sidebar-footer">
          <span class="status-dot" />
          <span>{{ t("Server running") }}</span>
        </div>
      </aside>

      <div
        v-if="!sidebarCollapsed"
        class="sidebar-resizer"
        :class="{ 'sidebar-resizer--active': resizingSidebar }"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('Resize sidebar')"
        :aria-valuemin="SIDEBAR_MIN_WIDTH"
        :aria-valuenow="sidebarWidth"
        :aria-valuemax="sidebarMaxWidth"
        tabindex="0"
        @pointerdown="startSidebarResize"
        @keydown="handleSidebarResizeKeydown"
      />

      <main class="reader-stage">
        <button
          v-if="sidebarCollapsed"
          class="icon-button sidebar-expand-button"
          type="button"
          :title="t('Expand file browser')"
          :aria-label="t('Expand file browser')"
          :aria-expanded="!sidebarCollapsed"
          aria-controls="pdf-sidebar"
          @click="toggleSidebarCollapsed"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6" /></svg>
        </button>
        <section v-if="openTabs.length" class="reader-workspace" :aria-label="t('Open PDF documents')">
          <nav class="document-tabs" :aria-label="t('Document tabs')">
            <div class="document-tab-list" role="tablist" :aria-label="t('Open PDFs')">
              <div
                v-for="(tab, index) in openTabs"
                :key="tab.path"
                class="document-tab"
                :class="{ 'document-tab--active': tab.path === activeTabPath }"
                @contextmenu="openTabContextMenu($event, tab.path)"
              >
                <button
                  :id="`document-tab-${index}`"
                  class="document-tab-main"
                  type="button"
                  role="tab"
                  aria-haspopup="menu"
                  :aria-selected="tab.path === activeTabPath"
                  :aria-controls="`document-panel-${index}`"
                  :tabindex="tab.path === activeTabPath ? 0 : -1"
                  :title="tab.path"
                  :ref="(element) => setTabButton(tab.path, element)"
                  @click="activateTab(tab.path)"
                  @keydown="handleTabKeydown($event, index, tab.path)"
                >
                  <span class="document-tab-badge" aria-hidden="true">PDF</span>
                  <span class="document-tab-name">{{ tab.name }}</span>
                </button>
                <button
                  class="document-tab-close"
                  type="button"
                  :aria-label="t('Close {name}', { name: tab.name })"
                  :title="t('Close {name}', { name: tab.name })"
                  @click="closeTab(tab.path, true)"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
                </button>
              </div>
            </div>
            <DocumentTabPicker
              :tabs="openTabs"
              :active-path="activeTabPath"
              :disabled="readingMode || focusMode"
              @open="closeTabContextMenu"
              @select="activateTab($event, true)"
              @close="closeTab($event, openTabs.length === 1)"
            />
          </nav>

          <Teleport to="body">
            <div
              v-if="tabContextMenu"
              ref="tabContextMenuElement"
              class="tab-context-menu"
              role="menu"
              :aria-label="t('Tab actions')"
              :style="{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }"
              @contextmenu.prevent
              @keydown="handleContextMenuKeydown"
            >
              <button role="menuitem" type="button" @click="toggleContextTabFavorite">
                {{ t(isFavorite(tabContextMenu.path) ? 'Remove from favorites' : 'Add to favorites') }}
              </button>
              <span class="tab-context-menu-separator" role="separator" />
              <button role="menuitem" type="button" :disabled="!canCloseTabs('left')" @click="closeTabsFromContext('left')">
                {{ t('Close tabs to the left') }}
              </button>
              <button role="menuitem" type="button" :disabled="!canCloseTabs('right')" @click="closeTabsFromContext('right')">
                {{ t('Close tabs to the right') }}
              </button>
              <button role="menuitem" type="button" :disabled="!canCloseTabs('others')" @click="closeTabsFromContext('others')">
                {{ t('Close other tabs') }}
              </button>
              <span class="tab-context-menu-separator" role="separator" />
              <button role="menuitem" type="button" @click="closeTabsFromContext('all')">
                {{ t('Close all tabs') }}
              </button>
            </div>
          </Teleport>

          <div ref="readerPanelsElement" class="reader-panels">
            <div
              v-for="(tab, index) in openTabs"
              v-show="tab.path === activeTabPath"
              :id="`document-panel-${index}`"
              :key="tab.path"
              class="reader-panel"
              role="tabpanel"
              :aria-labelledby="`document-tab-${index}`"
            >
              <PdfViewer
                :ref="(instance) => setViewer(tab.path, instance)"
                :src="pdfUrl(tab)"
                :file-name="tab.name"
                :fullscreen-target="readerPanelsElement"
                :active="tab.path === activeTabPath"
                :reading-mode="readingMode"
                :focus-tab-switch-enabled="focusTabSwitchEnabled"
                :tab-items="openTabs"
                :active-tab-path="activeTabPath"
                :focus-mode="focusMode"
                :suppress-resize-render="resizingSidebar"
                :initial-scroll-top="tabScrollPositions.get(tab.path) || 0"
                :initial-scroll-anchor="tabScrollAnchors.get(tab.path) || null"
                @toggle-reading-mode="toggleReadingMode"
                @switch-tab="switchFocusTab"
                @toggle-focus-mode="toggleFocusMode"
                @scroll-change="handleTabScroll(tab.path, $event)"
                @outline-change="setOutlineState(tab.path, $event)"
              />
            </div>
          </div>
        </section>

        <div v-else ref="emptyReaderElement" class="reader-empty" tabindex="-1">
          <div class="empty-monogram" aria-hidden="true">PDF</div>
          <span class="section-kicker">{{ t("LOCAL READER") }}</span>
          <h2>{{ t("Ready for a document") }}</h2>
          <p>{{ t("Select a PDF from the sidebar to start reading.") }}</p>
        </div>
      </main>
    </div>
  </div>
  <LockScreen
    v-if="screenBlocked"
    :ready="configReady"
    :loading="configLoading"
    :config-error="configError"
    :error="unlockError"
    :busy="unlockPending"
    :password-required="passwordRequired"
    @unlock="unlockScreen"
    @retry="loadLockConfig"
  />
</template>
