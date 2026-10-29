export const TREE_EXPANSION_STORAGE_KEY = 'pdf-local-preview.tree-collapsed.v1'

function normalizePathSet(paths) {
  if (!Array.isArray(paths) && !(paths instanceof Set)) return new Set()

  return new Set([...paths].filter((path) => typeof path === 'string' && path.length > 0))
}

export function parsePersistedCollapsedDirectoryPaths(serialized) {
  if (typeof serialized !== 'string' || !serialized) return new Set()

  try {
    const saved = JSON.parse(serialized)
    return normalizePathSet(saved?.paths)
  } catch {
    return new Set()
  }
}

export function serializeCollapsedDirectoryPaths(paths) {
  return JSON.stringify({ paths: [...normalizePathSet(paths)].sort() })
}

export function collectDirectoryPaths(nodes, paths = new Set()) {
  for (const node of nodes || []) {
    if (node?.type !== 'directory' || typeof node.path !== 'string' || !node.path) continue
    paths.add(node.path)
    collectDirectoryPaths(node.children, paths)
  }
  return paths
}

export function reconcileCollapsedDirectoryPaths(paths, tree) {
  const availablePaths = collectDirectoryPaths(tree)
  return new Set([...normalizePathSet(paths)].filter((path) => availablePaths.has(path)))
}

export function setDirectoryExpanded(paths, path, expanded) {
  const nextPaths = normalizePathSet(paths)
  if (typeof path !== 'string' || !path) return nextPaths

  if (expanded) nextPaths.delete(path)
  else nextPaths.add(path)
  return nextPaths
}
