import assert from 'node:assert/strict'
import test from 'node:test'

import { CHINESE_MESSAGES, DEFAULT_LANGUAGE, isSupportedLanguage, translate } from '../shared/localization.js'
import { createI18n } from '../src/i18n.js'

test('language definitions default to English and reject unrecognized values', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en')
  assert.equal(isSupportedLanguage('en'), true)
  assert.equal(isSupportedLanguage('zh'), true)
  for (const value of ['en-US', 'zh-CN', 'EN', 'fr', '', null, undefined, 1, {}, []]) {
    assert.equal(isSupportedLanguage(value), false)
  }
})

test('translations interpolate document names literally without losing Unicode or dollar signs', () => {
  const name = '中文 $& ${name}.pdf'
  assert.equal(translate('en', 'Close {name}', { name }), `Close ${name}`)
  assert.equal(translate('zh', 'Close {name}', { name }), `关闭 ${name}`)
  assert.equal(translate('zh', '{count} pages', { count: 2 }), '2 页')
  assert.equal(translate('en', 'Unknown text'), 'Unknown text')
})

test('Chinese messages preserve every interpolation parameter', () => {
  const parameters = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  for (const [english, chinese] of Object.entries(CHINESE_MESSAGES)) {
    assert.equal(typeof chinese, 'string')
    assert.ok(chinese.trim())
    assert.deepEqual(parameters(chinese), parameters(english), english)
  }
})

test('Vue language state is reactive and isolated between reader instances', () => {
  const english = createI18n()
  const chinese = createI18n('zh')
  assert.equal(english.t('Reader settings'), 'Reader settings')
  assert.equal(chinese.t('Reader settings'), '阅读设置')
  assert.equal(chinese.locale.value, 'zh-CN')
  english.language.value = 'zh'
  chinese.language.value = 'en'
  assert.equal(english.t('Reader settings'), '阅读设置')
  assert.equal(chinese.t('Reader settings'), 'Reader settings')
  assert.equal(chinese.locale.value, 'en-US')
  assert.throws(() => createI18n('fr'), /Supported languages.*en.*zh/)
})
