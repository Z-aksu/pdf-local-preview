import assert from 'node:assert/strict'
import test from 'node:test'

import { countOutlineItems, normalizeOutlineTree } from '../src/outline.js'

test('unnamed outline entries use the configured language at every depth', async () => {
  const items = await normalizeOutlineTree([{ title: '', items: [{ title: '' }] }], async () => null, 'outline', 'zh')
  assert.equal(items[0].title, '未命名章节')
  assert.equal(items[0].items[0].title, '未命名章节')
})

test('normalizeOutlineTree resolves nested destinations and keeps unavailable entries', async () => {
  const destinations = new Map([
    ['intro', { pageNumber: 2 }],
    ['details', { pageNumber: 5 }],
  ])
  const items = await normalizeOutlineTree([
    { title: '  第一章  ', dest: 'intro', items: [
      { title: '细节', dest: 'details' },
    ] },
    { title: '', dest: 'missing' },
  ], async (destination) => destinations.get(destination) || null)

  assert.deepEqual(items, [
    {
      id: 'outline-0',
      title: '第一章',
      pageNumber: 2,
      items: [{ id: 'outline-0-0', title: '细节', pageNumber: 5, items: [] }],
    },
    { id: 'outline-1', title: 'Untitled section', pageNumber: null, items: [] },
  ])
  assert.equal(countOutlineItems(items), 3)
})

test('normalizeOutlineTree tolerates missing or failing destination resolvers', async () => {
  const items = await normalizeOutlineTree([
    { title: '可用', dest: ['page-ref'] },
    { title: '损坏', dest: 'broken' },
    { title: '无目标', dest: null },
  ], async (destination) => {
    if (destination === 'broken') throw new Error('bad destination')
    return { pageNumber: 1 }
  })

  assert.deepEqual(items.map(({ title, pageNumber }) => ({ title, pageNumber })), [
    { title: '可用', pageNumber: 1 },
    { title: '损坏', pageNumber: null },
    { title: '无目标', pageNumber: null },
  ])
})
