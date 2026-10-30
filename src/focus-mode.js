import { DEFAULT_LANGUAGE, translate } from '../shared/localization.js'

export function isFocusModeShortcut(event) {
  if (!event || event.repeat || event.altKey || !event.shiftKey) return false
  if (!(event.ctrlKey || event.metaKey)) return false
  return String(event.key || '').toLowerCase() === 'f'
}

export function resolveDocumentTitle(fileName, focusMode, language = DEFAULT_LANGUAGE) {
  if (focusMode) return translate(language, 'Offline document reader')
  return fileName ? `${fileName} · PDF Local Preview` : 'PDF Local Preview'
}
