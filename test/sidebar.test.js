import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarMaxWidth,
} from '../src/sidebar.js'

test('sidebar width keeps the configured minimum and viewport maximum', () => {
  assert.equal(SIDEBAR_DEFAULT_WIDTH, 320)
  assert.equal(SIDEBAR_MIN_WIDTH, 220)
  assert.equal(sidebarMaxWidth(1200), 600)
  assert.equal(clampSidebarWidth(100, 1200), SIDEBAR_MIN_WIDTH)
  assert.equal(clampSidebarWidth(900, 1200), 600)
  assert.equal(clampSidebarWidth(351.6, 1200), 352)
})

test('sidebar width falls back safely for invalid values', () => {
  assert.equal(clampSidebarWidth('not-a-width', 1200), SIDEBAR_DEFAULT_WIDTH)
  assert.equal(sidebarMaxWidth(0), SIDEBAR_MIN_WIDTH)
})
