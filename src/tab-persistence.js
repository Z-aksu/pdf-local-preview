export const TABS_STORAGE_KEY = 'pdf-local-preview.tabs.v1'

function normalizeScrollTop(value) {
  const scrollTop = Number(value)
  return Number.isFinite(scrollTop) && scrollTop >= 0
    ? Math.round(scrollTop * 1000) / 1000
    : 0
}

function normalizeScrollAnchor(value) {
  const pageNumber = Number(value?.pageNumber)
  const offsetRatio = Number(value?.offsetRatio)
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isFinite(offsetRatio)) return null

  return {
    pageNumber,
    offsetRatio: Math.round(offsetRatio * 1000000) / 1000000,
  }
}

export function serializeDocumentTabs(
  tabs,
  activePath,
  scrollPositions = new Map(),
  scrollAnchors = new Map(),
) {
  return JSON.stringify({
    activePath,
    tabs: tabs
      .filter((tab) => typeof tab?.path === 'string' && tab.path)
      .map((tab) => ({
        path: tab.path,
        scrollTop: normalizeScrollTop(scrollPositions.get(tab.path)),
        scrollAnchor: normalizeScrollAnchor(scrollAnchors.get(tab.path)),
      })),
  })
}

export function parsePersistedTabs(serialized) {
  if (typeof serialized !== 'string' || !serialized) return null

  try {
    const saved = JSON.parse(serialized)
    if (!saved || !Array.isArray(saved.tabs)) return null

    const paths = []
    const seen = new Set()
    const scrollPositions = new Map()
    const scrollAnchors = new Map()
    for (const item of saved.tabs) {
      const path = typeof item === 'string' ? item : item?.path
      if (typeof path !== 'string' || !path || seen.has(path)) continue
      seen.add(path)
      paths.push(path)
      scrollPositions.set(path, normalizeScrollTop(typeof item === 'string' ? 0 : item?.scrollTop))
      const scrollAnchor = normalizeScrollAnchor(typeof item === 'string' ? null : item?.scrollAnchor)
      if (scrollAnchor) scrollAnchors.set(path, scrollAnchor)
    }

    return {
      paths,
      scrollPositions,
      scrollAnchors,
      activePath: typeof saved.activePath === 'string' && paths.includes(saved.activePath)
        ? saved.activePath
        : paths[0] || '',
    }
  } catch {
    return null
  }
}
