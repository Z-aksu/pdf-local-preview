import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeFavoritePaths,
  parsePersistedFavorites,
  resolveFavoriteFiles,
  serializeFavorites,
  toggleFavoritePath,
} from '../src/favorites.js'

const question = { type: 'file', name: '题目.pdf', path: '试卷/题目.pdf' }
const answer = { type: 'file', name: '答案.pdf', path: '试卷/答案.pdf' }
const tree = [{ type: 'directory', name: '试卷', path: '试卷', children: [question, answer] }]

test('favorite paths are normalized and persisted in collection order', () => {
  const paths = [answer.path, '', answer.path, question.path, null]
  assert.deepEqual(normalizeFavoritePaths(paths), [answer.path, question.path])
  assert.deepEqual(parsePersistedFavorites(serializeFavorites(paths)), [answer.path, question.path])
  assert.deepEqual(parsePersistedFavorites('{invalid json'), [])
})

test('favorite path can be added and removed without changing the file tree', () => {
  const added = toggleFavoritePath([], answer.path)
  assert.deepEqual(added, [answer.path])
  assert.deepEqual(toggleFavoritePath(added, answer.path), [])
  assert.deepEqual(tree[0].children, [question, answer])
})

test('favorite shortcuts resolve existing files and skip temporarily missing paths', () => {
  assert.deepEqual(resolveFavoriteFiles(['missing.pdf', answer.path, question.path], tree), [answer, question])
})
