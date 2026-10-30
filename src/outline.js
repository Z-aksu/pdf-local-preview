import { DEFAULT_LANGUAGE, translate } from '../shared/localization.js'

export async function normalizeOutlineTree(items, resolveDestination, parentId = 'outline', language = DEFAULT_LANGUAGE) {
  if (!Array.isArray(items)) return []

  const normalized = []
  for (const [index, item] of items.entries()) {
    let target = null
    if (item?.dest != null) {
      try {
        target = await resolveDestination(item.dest)
      } catch {
        // A broken destination should not hide the rest of the document outline.
      }
    }

    normalized.push({
      id: `${parentId}-${index}`,
      title: typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : translate(language, 'Untitled section'),
      pageNumber: Number.isInteger(target?.pageNumber) ? target.pageNumber : null,
      items: await normalizeOutlineTree(item?.items, resolveDestination, `${parentId}-${index}`, language),
    })
  }

  return normalized
}

export function countOutlineItems(items) {
  if (!Array.isArray(items)) return 0
  return items.reduce((count, item) => count + 1 + countOutlineItems(item.items), 0)
}
