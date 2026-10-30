import { computed, inject, ref } from 'vue'

import { DEFAULT_LANGUAGE, isSupportedLanguage, LANGUAGE_HELP, LANGUAGE_LOCALES, translate } from '../shared/localization.js'

export const I18N_KEY = Symbol('pdf-local-preview.i18n')

export function createI18n(initialLanguage = DEFAULT_LANGUAGE) {
  if (!isSupportedLanguage(initialLanguage)) {
    throw new Error(`Unsupported language: ${String(initialLanguage)}. Supported languages: ${LANGUAGE_HELP}.`)
  }
  const language = ref(initialLanguage)
  const locale = computed(() => LANGUAGE_LOCALES[language.value])
  const t = (message, parameters) => translate(language.value, message, parameters)
  return { language, locale, t }
}

export function useI18n() {
  return inject(I18N_KEY, null) || createI18n()
}
