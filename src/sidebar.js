export const SIDEBAR_MIN_WIDTH = 220
export const SIDEBAR_DEFAULT_WIDTH = 320

export function sidebarMaxWidth(viewportWidth) {
  const width = Number(viewportWidth)
  if (!Number.isFinite(width) || width <= 0) return SIDEBAR_MIN_WIDTH
  return Math.max(SIDEBAR_MIN_WIDTH, Math.floor(width * 0.5))
}

export function clampSidebarWidth(width, viewportWidth) {
  const normalizedWidth = Number(width)
  const safeWidth = Number.isFinite(normalizedWidth) ? normalizedWidth : SIDEBAR_DEFAULT_WIDTH
  return Math.min(
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(safeWidth)),
    sidebarMaxWidth(viewportWidth),
  )
}
