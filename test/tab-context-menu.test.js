import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampTabContextMenuPosition,
  getNextMenuItemIndex,
  getTabCloseAvailability,
} from '../src/tab-context-menu.js'

const tabs = [
  { path: 'first.pdf' },
  { path: 'middle.pdf' },
  { path: 'last.pdf' },
]

test('tab context menu enables actions for first, middle, last, and single tabs', () => {
  assert.deepEqual(getTabCloseAvailability(tabs, 'first.pdf'), {
    left: false,
    right: true,
    others: true,
    all: true,
  })
  assert.deepEqual(getTabCloseAvailability(tabs, 'middle.pdf'), {
    left: true,
    right: true,
    others: true,
    all: true,
  })
  assert.deepEqual(getTabCloseAvailability(tabs, 'last.pdf'), {
    left: true,
    right: false,
    others: true,
    all: true,
  })
  assert.deepEqual(getTabCloseAvailability([tabs[0]], 'first.pdf'), {
    left: false,
    right: false,
    others: false,
    all: true,
  })
  assert.deepEqual(getTabCloseAvailability(tabs, 'missing.pdf'), {
    left: false,
    right: false,
    others: false,
    all: false,
  })
})

test('tab context menu position stays inside the viewport', () => {
  assert.deepEqual(clampTabContextMenuPosition(
    { x: 980, y: 740 },
    { width: 168, height: 160 },
    { width: 1000, height: 800 },
  ), { x: 824, y: 632 })
  assert.deepEqual(clampTabContextMenuPosition(
    { x: -20, y: 2 },
    { width: 168, height: 160 },
    { width: 1000, height: 800 },
  ), { x: 8, y: 8 })
})

test('tab context menu keyboard navigation skips boundaries and wraps', () => {
  assert.equal(getNextMenuItemIndex(-1, 3, 'ArrowDown'), 0)
  assert.equal(getNextMenuItemIndex(-1, 3, 'ArrowUp'), 2)
  assert.equal(getNextMenuItemIndex(2, 3, 'ArrowDown'), 0)
  assert.equal(getNextMenuItemIndex(0, 3, 'ArrowUp'), 2)
  assert.equal(getNextMenuItemIndex(1, 3, 'Home'), 0)
  assert.equal(getNextMenuItemIndex(1, 3, 'End'), 2)
  assert.equal(getNextMenuItemIndex(1, 3, 'Escape'), null)
  assert.equal(getNextMenuItemIndex(0, 0, 'ArrowDown'), null)
})
