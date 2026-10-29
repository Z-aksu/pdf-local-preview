export function getTabCloseAvailability(tabs, path) {
  const index = tabs.findIndex((tab) => tab.path === path)
  if (index === -1) {
    return { left: false, right: false, others: false, all: false }
  }

  return {
    left: index > 0,
    right: index < tabs.length - 1,
    others: tabs.length > 1,
    all: tabs.length > 0,
  }
}

export function clampTabContextMenuPosition(
  position,
  menuSize,
  viewportSize,
  padding = 8,
) {
  return {
    x: Math.max(padding, Math.min(position.x, viewportSize.width - menuSize.width - padding)),
    y: Math.max(padding, Math.min(position.y, viewportSize.height - menuSize.height - padding)),
  }
}

export function getNextMenuItemIndex(currentIndex, itemCount, key) {
  if (itemCount <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount
  if (key === 'ArrowUp') return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1
  return null
}
