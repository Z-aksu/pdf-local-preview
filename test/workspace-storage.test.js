import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkspaceStorageKey } from '../src/workspace-storage.js'

test('workspace storage keys isolate otherwise identical settings', () => {
  const baseKey = 'pdf-local-preview.reading-mode'
  const firstKey = createWorkspaceStorageKey(baseKey, 'folder-a')
  const secondKey = createWorkspaceStorageKey(baseKey, 'folder-b')

  assert.equal(firstKey, 'pdf-local-preview.reading-mode.folder-a')
  assert.equal(secondKey, 'pdf-local-preview.reading-mode.folder-b')
  assert.notEqual(firstKey, secondKey)
})

test('workspace storage keys encode arbitrary workspace ids and reject missing values', () => {
  assert.equal(
    createWorkspaceStorageKey('settings', 'folder/a?b'),
    'settings.folder%2Fa%3Fb',
  )
  assert.equal(createWorkspaceStorageKey('', 'folder'), null)
  assert.equal(createWorkspaceStorageKey('settings', ''), null)
})
