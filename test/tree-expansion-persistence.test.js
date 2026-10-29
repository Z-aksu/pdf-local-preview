import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectDirectoryPaths,
  parsePersistedCollapsedDirectoryPaths,
  reconcileCollapsedDirectoryPaths,
  serializeCollapsedDirectoryPaths,
  setDirectoryExpanded,
  TREE_EXPANSION_STORAGE_KEY,
} from '../src/tree-expansion.js'

const tree = [{
  type: 'directory',
  name: '资料',
  path: '资料',
  children: [{
    type: 'directory',
    name: '真题',
    path: '资料/真题',
    children: [{ type: 'file', name: '试卷.pdf', path: '资料/真题/试卷.pdf' }],
  }],
}, {
  type: 'directory',
  name: '答案',
  path: '答案',
  children: [{ type: 'file', name: '答案.pdf', path: '答案/答案.pdf' }],
}]

test('collapsed directory paths serialize deterministically and parse safely', () => {
  assert.equal(TREE_EXPANSION_STORAGE_KEY, 'pdf-local-preview.tree-collapsed.v1')
  assert.equal(
    serializeCollapsedDirectoryPaths(new Set(['资料/真题', '资料', '资料/真题', ''])),
    JSON.stringify({ paths: ['资料', '资料/真题'] }),
  )
  assert.deepEqual(
    parsePersistedCollapsedDirectoryPaths('{"paths":["资料","资料","",5]}'),
    new Set(['资料']),
  )
  assert.deepEqual(parsePersistedCollapsedDirectoryPaths('{broken'), new Set())
  assert.deepEqual(parsePersistedCollapsedDirectoryPaths('[]'), new Set())
  assert.deepEqual(parsePersistedCollapsedDirectoryPaths(null), new Set())
})

test('directory paths are collected recursively without file paths', () => {
  assert.deepEqual(
    collectDirectoryPaths(tree),
    new Set(['资料', '资料/真题', '答案']),
  )
})

test('collapsed paths are reconciled after a directory rescan', () => {
  assert.deepEqual(
    reconcileCollapsedDirectoryPaths(
      new Set(['资料', '资料/已删除', '答案/答案.pdf']),
      tree,
    ),
    new Set(['资料']),
  )
})

test('renamed, moved, and newly added directories use the new tree safely', () => {
  const changedTree = [{
    type: 'directory',
    name: '归档',
    path: '归档',
    children: [{
      type: 'directory',
      name: '真题',
      path: '归档/真题',
      children: [{ type: 'file', name: '试卷.pdf', path: '归档/真题/试卷.pdf' }],
    }, {
      type: 'directory',
      name: '新增资料',
      path: '归档/新增资料',
      children: [{ type: 'file', name: '新文件.pdf', path: '归档/新增资料/新文件.pdf' }],
    }],
  }]

  const reconciled = reconcileCollapsedDirectoryPaths(
    new Set(['资料', '资料/真题', '已删除']),
    changedTree,
  )

  assert.deepEqual(reconciled, new Set())
  assert.equal(reconciled.has('归档/真题'), false)
  assert.equal(reconciled.has('归档/新增资料'), false)
})

test('one directory can be collapsed or expanded without mutating prior state', () => {
  const initial = new Set(['资料/真题'])
  const collapsed = setDirectoryExpanded(initial, '资料', false)
  const expanded = setDirectoryExpanded(collapsed, '资料/真题', true)

  assert.deepEqual(initial, new Set(['资料/真题']))
  assert.deepEqual(collapsed, new Set(['资料/真题', '资料']))
  assert.deepEqual(expanded, new Set(['资料']))
  assert.notEqual(collapsed, initial)
  assert.notEqual(expanded, collapsed)
})
