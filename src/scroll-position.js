function normalizePageMetrics(pages) {
  if (!Array.isArray(pages)) return []
  return pages
    .filter((page) => (
      Number.isInteger(page?.pageNumber)
      && page.pageNumber > 0
      && Number.isFinite(page.top)
      && Number.isFinite(page.height)
      && page.height > 0
    ))
    .sort((left, right) => left.pageNumber - right.pageNumber)
}

function normalizeOffsetRatio(value) {
  const offsetRatio = Number(value)
  if (!Number.isFinite(offsetRatio)) return null

  // Keep the persisted anchor deterministic while retaining sub-pixel accuracy.
  // At a 2,000px-tall page this is still better than 0.002px of layout error.
  return Math.round(offsetRatio * 1000000) / 1000000
}

export function createScrollAnchor(scrollTop, pages) {
  const normalizedScrollTop = Number(scrollTop)
  const orderedPages = normalizePageMetrics(pages)
  if (!Number.isFinite(normalizedScrollTop) || !orderedPages.length) return null

  let anchorPage = orderedPages[0]
  for (const page of orderedPages) {
    if (page.top > normalizedScrollTop) break
    anchorPage = page
  }

  const offsetRatio = normalizeOffsetRatio(
    (normalizedScrollTop - anchorPage.top) / anchorPage.height,
  )
  if (offsetRatio === null) return null

  return {
    pageNumber: anchorPage.pageNumber,
    offsetRatio,
  }
}

export function resolveScrollAnchor(scrollAnchor, pages, fallbackScrollTop = 0) {
  const fallback = Number(fallbackScrollTop)
  const pageNumber = Number(scrollAnchor?.pageNumber)
  const offsetRatio = Number(scrollAnchor?.offsetRatio)
  const page = normalizePageMetrics(pages).find((entry) => entry.pageNumber === pageNumber)

  if (!page || !Number.isFinite(offsetRatio)) {
    return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0
  }
  return Math.max(0, page.top + offsetRatio * page.height)
}

export function createReadingPositionTracker() {
  let position = { scrollTop: 0, scrollAnchor: null }
  let committedPages = []
  let committedViewport = null

  function get() {
    return {
      scrollTop: position.scrollTop,
      scrollAnchor: position.scrollAnchor ? { ...position.scrollAnchor } : null,
    }
  }

  function sameLayout(pages, viewport) {
    return committedPages.length > 0
      && pages.length === committedPages.length
      && viewport?.width === committedViewport?.width
      && viewport?.height === committedViewport?.height
      && pages.every((page, index) => {
        const previous = committedPages[index]
        return page.pageNumber === previous.pageNumber
          && Math.abs(page.top - previous.top) < 0.01
          && Math.abs(page.height - previous.height) < 0.01
      })
  }

  function rememberLayout(pages, viewport) {
    committedPages = pages.map((page) => ({ ...page }))
    committedViewport = viewport ? { ...viewport } : null
  }

  function capture(scrollTop, pages, viewport, acceptLayoutChange = false) {
    const nextScrollTop = Number(scrollTop)
    const metrics = normalizePageMetrics(pages)
    if (!Number.isFinite(nextScrollTop) || !metrics.length) return get()

    // Responsive CSS can change gaps, padding, or clamp scrollTop before the
    // resize observer runs. Those intermediate coordinates are not user input.
    if (!acceptLayoutChange && !sameLayout(metrics, viewport)) return get()
    if (acceptLayoutChange || nextScrollTop !== position.scrollTop || !position.scrollAnchor) {
      position = {
        scrollTop: Math.max(0, nextScrollTop),
        scrollAnchor: createScrollAnchor(nextScrollTop, metrics),
      }
      rememberLayout(metrics, viewport)
    }
    return get()
  }

  function resolve(pages) {
    return resolveScrollAnchor(position.scrollAnchor, pages, position.scrollTop)
  }

  function commit(scrollTop, pages, viewport) {
    const metrics = normalizePageMetrics(pages)
    position.scrollTop = Math.max(0, Number(scrollTop) || 0)
    // Keep the logical anchor: browsers may round or clamp the applied scroll
    // offset. Recapturing it here compounds that error on every mode switch.
    if (!position.scrollAnchor) {
      position.scrollAnchor = createScrollAnchor(position.scrollTop, metrics)
    }
    rememberLayout(metrics, viewport)
  }

  function reset({ scrollTop = 0, scrollAnchor = null } = {}) {
    position = {
      scrollTop: Math.max(0, Number(scrollTop) || 0),
      scrollAnchor: scrollAnchor ? { ...scrollAnchor } : null,
    }
    committedPages = []
    committedViewport = null
  }

  return { get, capture, resolve, commit, reset }
}
