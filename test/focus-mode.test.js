import assert from 'node:assert/strict'
import test from 'node:test'

import { isFocusModeShortcut, resolveDocumentTitle } from '../src/focus-mode.js'

test('focus mode shortcut accepts Ctrl or Command plus Shift plus F', () => {
  assert.equal(isFocusModeShortcut({ key: 'F', ctrlKey: true, shiftKey: true }), true)
  assert.equal(isFocusModeShortcut({ key: 'f', metaKey: true, shiftKey: true }), true)
})

test('focus mode shortcut rejects incomplete or conflicting key combinations', () => {
  assert.equal(isFocusModeShortcut({ key: 'f', ctrlKey: true }), false)
  assert.equal(isFocusModeShortcut({ key: 'f', shiftKey: true }), false)
  assert.equal(isFocusModeShortcut({ key: 'f', ctrlKey: true, shiftKey: true, altKey: true }), false)
  assert.equal(isFocusModeShortcut({ key: 'f', ctrlKey: true, shiftKey: true, repeat: true }), false)
  assert.equal(isFocusModeShortcut({ key: 'g', ctrlKey: true, shiftKey: true }), false)
})

test('focus mode hides the active file name in the browser title', () => {
  assert.equal(resolveDocumentTitle('英语真题.pdf', true), 'Offline document reader')
  assert.equal(resolveDocumentTitle('英语真题.pdf', false), '英语真题.pdf · PDF Local Preview')
  assert.equal(resolveDocumentTitle('', false), 'PDF Local Preview')
})

test('focus title follows the configured language while preserving document names', () => {
  assert.equal(resolveDocumentTitle('文档.pdf', true, 'zh'), '离线文档阅读台')
  assert.equal(resolveDocumentTitle('文档.pdf', false, 'zh'), '文档.pdf · PDF Local Preview')
})
