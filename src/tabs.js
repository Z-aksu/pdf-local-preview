function collectPdfFiles(nodes, files = new Map()) {
  for (const node of nodes) {
    if (node.type === 'file') {
      files.set(node.path, node)
    } else {
      collectPdfFiles(node.children, files)
    }
  }
  return files
}

export function openDocumentTab(tabs, file) {
  const existingIndex = tabs.findIndex((tab) => tab.path === file.path)
  if (existingIndex === -1) return [...tabs, file]

  const refreshedTabs = [...tabs]
  refreshedTabs[existingIndex] = file
  return refreshedTabs
}

export function closeDocumentTab(tabs, path, activePath) {
  const closingIndex = tabs.findIndex((tab) => tab.path === path)
  if (closingIndex === -1) return { tabs, activePath }

  const remainingTabs = tabs.filter((tab) => tab.path !== path)
  if (path !== activePath) {
    return { tabs: remainingTabs, activePath }
  }

  const adjacentTab = remainingTabs[closingIndex] || remainingTabs[closingIndex - 1]
  return {
    tabs: remainingTabs,
    activePath: adjacentTab?.path || '',
  }
}

export function closeDocumentTabs(tabs, path, activePath, scope) {
  const contextIndex = tabs.findIndex((tab) => tab.path === path)
  if (contextIndex === -1) return { tabs, activePath }

  let remainingTabs
  if (scope === 'left') {
    remainingTabs = tabs.slice(contextIndex)
  } else if (scope === 'right') {
    remainingTabs = tabs.slice(0, contextIndex + 1)
  } else if (scope === 'others') {
    remainingTabs = [tabs[contextIndex]]
  } else if (scope === 'all') {
    remainingTabs = []
  } else {
    return { tabs, activePath }
  }

  if (remainingTabs.length === tabs.length) return { tabs, activePath }

  const activeTabExists = remainingTabs.some((tab) => tab.path === activePath)
  const contextTabExists = remainingTabs.some((tab) => tab.path === path)
  return {
    tabs: remainingTabs,
    activePath: activeTabExists
      ? activePath
      : contextTabExists
        ? path
        : remainingTabs[0]?.path || '',
  }
}

export function refreshDocumentTabs(tabs, tree, activePath) {
  const availableFiles = collectPdfFiles(tree)
  const refreshedTabs = tabs
    .map((tab) => availableFiles.get(tab.path))
    .filter(Boolean)
  const activeTabExists = refreshedTabs.some((tab) => tab.path === activePath)

  return {
    tabs: refreshedTabs,
    activePath: activeTabExists ? activePath : refreshedTabs[0]?.path || '',
  }
}
