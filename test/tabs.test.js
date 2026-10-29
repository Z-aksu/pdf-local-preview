import assert from 'node:assert/strict'
import test from 'node:test'

import {
  closeDocumentTab,
  closeDocumentTabs,
  openDocumentTab,
  refreshDocumentTabs,
} from '../src/tabs.js'
import {
  parsePersistedTabs,
  serializeDocumentTabs,
} from '../src/tab-persistence.js'

const question = { type: 'file', name: '题目.pdf', path: '试卷/题目.pdf' }
const answer = { type: 'file', name: '答案.pdf', path: '试卷/答案.pdf' }
const notes = { type: 'file', name: '解析.pdf', path: '资料/解析.pdf' }

const tree = [
  { type: 'directory', name: '试卷', path: '试卷', children: [question, answer] },
  { type: 'directory', name: '资料', path: '资料', children: [notes] },
]

test('openDocumentTab opens once and refreshes an existing tab in place', () => {
  const opened = openDocumentTab([question], answer)
  assert.deepEqual(opened, [question, answer])

  const renamedAnswer = { ...answer, name: '参考答案.pdf' }
  assert.deepEqual(openDocumentTab(opened, renamedAnswer), [question, renamedAnswer])
})

test('closeDocumentTab selects the right neighbor before the left neighbor', () => {
  assert.deepEqual(closeDocumentTab([question, answer, notes], answer.path, answer.path), {
    tabs: [question, notes],
    activePath: notes.path,
  })
  assert.deepEqual(closeDocumentTab([question, answer], answer.path, answer.path), {
    tabs: [question],
    activePath: question.path,
  })
})

test('closeDocumentTab keeps the active tab when closing a background tab', () => {
  assert.deepEqual(closeDocumentTab([question, answer], question.path, answer.path), {
    tabs: [answer],
    activePath: answer.path,
  })

  assert.deepEqual(closeDocumentTab([question], question.path, question.path), {
    tabs: [],
    activePath: '',
  })
})

test('closeDocumentTabs closes tabs on the requested side of the context tab', () => {
  assert.deepEqual(closeDocumentTabs(
    [question, answer, notes],
    answer.path,
    notes.path,
    'left',
  ), {
    tabs: [answer, notes],
    activePath: notes.path,
  })
  assert.deepEqual(closeDocumentTabs(
    [question, answer, notes],
    answer.path,
    notes.path,
    'right',
  ), {
    tabs: [question, answer],
    activePath: answer.path,
  })
})

test('closeDocumentTabs closes other or all tabs and ignores invalid commands', () => {
  assert.deepEqual(closeDocumentTabs(
    [question, answer, notes],
    answer.path,
    question.path,
    'others',
  ), {
    tabs: [answer],
    activePath: answer.path,
  })
  assert.deepEqual(closeDocumentTabs(
    [question, answer, notes],
    answer.path,
    question.path,
    'all',
  ), {
    tabs: [],
    activePath: '',
  })

  const tabs = [question, answer]
  assert.deepEqual(closeDocumentTabs(tabs, question.path, answer.path, 'left'), {
    tabs,
    activePath: answer.path,
  })
  assert.deepEqual(closeDocumentTabs(tabs, 'missing.pdf', answer.path, 'all'), {
    tabs,
    activePath: answer.path,
  })
})

test('refreshDocumentTabs removes missing files and refreshes metadata', () => {
  const renamedQuestion = { ...question, name: '数学题目.pdf' }
  const refreshedTree = [
    { type: 'directory', name: '试卷', path: '试卷', children: [renamedQuestion] },
  ]

  assert.deepEqual(refreshDocumentTabs([question, answer], refreshedTree, answer.path), {
    tabs: [renamedQuestion],
    activePath: renamedQuestion.path,
  })
})

test('refreshDocumentTabs keeps an empty workspace empty', () => {
  assert.deepEqual(refreshDocumentTabs([], tree, ''), {
    tabs: [],
    activePath: '',
  })
})

test('tab persistence round-trips paths and the active tab', () => {
  const serialized = serializeDocumentTabs(
    [question, answer],
    answer.path,
    new Map([[answer.path, 432.6]]),
    new Map([[answer.path, { pageNumber: 3, offsetRatio: 0.12345678 }]]),
  )

  assert.deepEqual(parsePersistedTabs(serialized), {
    paths: [question.path, answer.path],
    activePath: answer.path,
    scrollPositions: new Map([
      [question.path, 0],
      [answer.path, 432.6],
    ]),
    scrollAnchors: new Map([
      [answer.path, { pageNumber: 3, offsetRatio: 0.123457 }],
    ]),
  })
})

test('tab persistence removes duplicates and falls back to the first tab', () => {
  assert.deepEqual(parsePersistedTabs(JSON.stringify({
    tabs: [{ path: question.path }, { path: question.path }, { path: answer.path }],
    activePath: 'missing.pdf',
  })), {
    paths: [question.path, answer.path],
    activePath: question.path,
    scrollPositions: new Map([
      [question.path, 0],
      [answer.path, 0],
    ]),
    scrollAnchors: new Map(),
  })
  assert.equal(parsePersistedTabs('{invalid json'), null)
})

test('tab persistence accepts legacy pixel-only positions and rejects malformed anchors', () => {
  const parsed = parsePersistedTabs(JSON.stringify({
    tabs: [
      { path: question.path, scrollTop: 120.375 },
      { path: answer.path, scrollTop: 80, scrollAnchor: { pageNumber: 0, offsetRatio: 'bad' } },
    ],
  }))

  assert.deepEqual(parsed.scrollPositions, new Map([
    [question.path, 120.375],
    [answer.path, 80],
  ]))
  assert.deepEqual(parsed.scrollAnchors, new Map())
})
