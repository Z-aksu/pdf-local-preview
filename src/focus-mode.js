export function isFocusModeShortcut(event) {
  if (!event || event.repeat || event.altKey || !event.shiftKey) return false
  if (!(event.ctrlKey || event.metaKey)) return false
  return String(event.key || '').toLowerCase() === 'f'
}

export function resolveDocumentTitle(fileName, focusMode) {
  if (focusMode) return '离线文档阅读台'
  return fileName ? `${fileName} · PDF Local Preview` : 'PDF Local Preview'
}
