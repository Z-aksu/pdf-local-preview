export const FAVORITES_STORAGE_KEY = 'pdf-local-preview.favorites.v1'

export function normalizeFavoritePaths(paths) {
  if (!Array.isArray(paths)) return []

  const seen = new Set()
  return paths.filter((path) => {
    if (typeof path !== 'string' || !path || seen.has(path)) return false
    seen.add(path)
    return true
  })
}

export function parsePersistedFavorites(serialized) {
  if (typeof serialized !== 'string' || !serialized) return []

  try {
    const saved = JSON.parse(serialized)
    return normalizeFavoritePaths(Array.isArray(saved) ? saved : saved?.paths)
  } catch {
    return []
  }
}

export function serializeFavorites(paths) {
  return JSON.stringify({ paths: normalizeFavoritePaths(paths) })
}

export function toggleFavoritePath(paths, path) {
  const normalized = normalizeFavoritePaths(paths)
  if (typeof path !== 'string' || !path) return normalized
  return normalized.includes(path)
    ? normalized.filter((favoritePath) => favoritePath !== path)
    : [...normalized, path]
}

function collectFiles(nodes, files = new Map()) {
  for (const node of nodes || []) {
    if (node.type === 'file') files.set(node.path, node)
    else if (node.type === 'directory') collectFiles(node.children, files)
  }
  return files
}

export function resolveFavoriteFiles(paths, tree) {
  const files = collectFiles(tree)
  return normalizeFavoritePaths(paths).map((path) => files.get(path)).filter(Boolean)
}
