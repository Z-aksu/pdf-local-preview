import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createPdfApp } from '../server/app.js'

async function startFixtureServer(t, config) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdf-view-api-'))
  const nested = path.join(root, '资料')
  await mkdir(nested)
  await writeFile(path.join(nested, 'sample.pdf'), '%PDF-1.4 fixture')
  await writeFile(path.join(root, 'notes.txt'), 'not public')
  if (config) {
    await mkdir(path.join(root, '.pdf'))
    await writeFile(path.join(root, '.pdf', 'config.json'), JSON.stringify(config))
  }

  const app = createPdfApp({ rootDir: root, staticDir: null })
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  const address = server.address()
  return { root, baseUrl: `http://127.0.0.1:${address.port}` }
}

test('GET /api/tree returns the root metadata and filtered tree', async (t) => {
  const { root, baseUrl } = await startFixtureServer(t)

  const response = await fetch(`${baseUrl}/api/tree`)
  const result = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.match(response.headers.get('content-security-policy'), /worker-src 'self' blob:/)
  assert.match(result.workspaceId, /^[a-f0-9]{24}$/)
  assert.equal(result.rootName, path.basename(root))
  assert.equal(result.count, 1)
  assert.equal(result.tree[0].children[0].path, '资料/sample.pdf')
})

test('workspace ids are stable per root and differ across roots', async (t) => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'pdf-view-workspace-a-'))
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'pdf-view-workspace-b-'))
  t.after(async () => {
    await rm(firstRoot, { recursive: true, force: true })
    await rm(secondRoot, { recursive: true, force: true })
  })

  const firstApp = createPdfApp({ rootDir: firstRoot, staticDir: null })
  const secondApp = createPdfApp({ rootDir: secondRoot, staticDir: null })
  const firstServer = await new Promise((resolve) => {
    const instance = firstApp.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const secondServer = await new Promise((resolve) => {
    const instance = secondApp.listen(0, '127.0.0.1', () => resolve(instance))
  })
  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => firstServer.close(resolve)),
      new Promise((resolve) => secondServer.close(resolve)),
    ])
  })

  const firstAddress = firstServer.address()
  const secondAddress = secondServer.address()
  const firstResponse = await fetch(`http://127.0.0.1:${firstAddress.port}/api/tree`)
  const repeatResponse = await fetch(`http://127.0.0.1:${firstAddress.port}/api/tree`)
  const secondResponse = await fetch(`http://127.0.0.1:${secondAddress.port}/api/tree`)
  const firstResult = await firstResponse.json()
  const repeatResult = await repeatResponse.json()
  const secondResult = await secondResponse.json()

  assert.equal(firstResult.workspaceId, repeatResult.workspaceId)
  assert.notEqual(firstResult.workspaceId, secondResult.workspaceId)
})

test('GET /api/pdf streams an inline PDF and rejects traversal', async (t) => {
  const { baseUrl } = await startFixtureServer(t)

  const pdfResponse = await fetch(`${baseUrl}/api/pdf?path=${encodeURIComponent('资料/sample.pdf')}`)
  assert.equal(pdfResponse.status, 200)
  assert.match(pdfResponse.headers.get('content-type'), /^application\/pdf/)
  assert.match(pdfResponse.headers.get('content-disposition'), /^inline;/)
  assert.equal(await pdfResponse.text(), '%PDF-1.4 fixture')

  const traversalResponse = await fetch(`${baseUrl}/api/pdf?path=${encodeURIComponent('../outside.pdf')}`)
  assert.equal(traversalResponse.status, 403)
})

test('unknown API routes return JSON instead of the application shell', async (t) => {
  const { baseUrl } = await startFixtureServer(t)

  const response = await fetch(`${baseUrl}/api/missing`)

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: '接口不存在' })
})

test('configuration is initialized before requests and only public settings reach the browser', async (t) => {
  const { root, baseUrl } = await startFixtureServer(t)
  const config = JSON.parse(await readFile(path.join(root, '.pdf', 'config.json'), 'utf8'))
  const response = await fetch(`${baseUrl}/api/config`)
  const result = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(result.blurLockScreen, false)
  assert.equal(result.hasLockPassword, false)
  assert.match(result.workspaceId, /^[a-f0-9]{24}$/)
  assert.deepEqual(Object.keys(result).sort(), ['blurLockScreen', 'hasLockPassword', 'workspaceId'])
  assert.equal(config.lockPassword, '')
  const tree = await fetch(`${baseUrl}/api/tree`).then((response) => response.json())
  assert.equal(tree.workspaceId, result.workspaceId)
  assert.ok(tree.tree.every((entry) => entry.name !== '.pdf'))
  assert.equal((await fetch(`${baseUrl}/.pdf/config.json`)).status, 404)
  assert.equal((await fetch(`${baseUrl}/api/pdf?path=.pdf/config.json`)).status, 400)
})

test('unlock validates custom passwords on the server and does not disclose them', async (t) => {
  const { baseUrl } = await startFixtureServer(t, { blurLockScreen: true, lockPassword: '0042' })
  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json())
  assert.equal(config.hasLockPassword, true)
  assert.equal(Object.hasOwn(config, 'lockPassword'), false)
  const unlock = (body) => fetch(`${baseUrl}/api/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const wrong = await unlock({ password: '9999' })
  assert.equal(wrong.status, 401)
  assert.equal(wrong.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await wrong.json(), { error: '密码错误，请重试' })
  const invalid = await unlock({ password: 42 })
  assert.equal(invalid.status, 400)
  const correct = await unlock({ password: '0042' })
  assert.equal(correct.status, 200)
  assert.deepEqual(await correct.json(), { unlocked: true })
  assert.equal((await fetch(`${baseUrl}/api/unlock?password=0042`)).status, 404)
})

test('respects disabled locking and numeric custom passwords', async (t) => {
  const { baseUrl } = await startFixtureServer(t, { blurLockScreen: false, lockPassword: 1234 })
  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json())
  assert.equal(config.blurLockScreen, false)
  assert.equal(config.hasLockPassword, true)
  const response = await fetch(`${baseUrl}/api/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: '1234' }),
  })
  assert.equal(response.status, 200)
})

test('empty passwords allow resuming without a password while blur protection remains enabled', async (t) => {
  const { baseUrl } = await startFixtureServer(t, { blurLockScreen: true, lockPassword: '' })
  const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json())
  assert.equal(config.blurLockScreen, true)
  assert.equal(config.hasLockPassword, false)
  const response = await fetch(`${baseUrl}/api/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: '' }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { unlocked: true })
})
