import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { hasLockPassword, initializeWorkspaceConfig } from '../server/config.js'

async function fixture(t, contents) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdf-view-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configPath = path.join(root, '.pdf', 'config.json')
  if (contents !== undefined) {
    await mkdir(path.dirname(configPath))
    await writeFile(configPath, contents)
  }
  return { root, configPath }
}

test('initializes .pdf/config.json with disabled blur locking and an empty password', async (t) => {
  const { root, configPath } = await fixture(t)
  const config = initializeWorkspaceConfig(root)

  assert.equal(config.blurLockScreen, false)
  assert.equal(config.lockPassword, '')
  assert.equal(config.language, 'en')
  assert.equal(hasLockPassword(config), false)
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), config)
  assert.deepEqual(initializeWorkspaceConfig(root), config)
})

test('preserves complete configuration byte for byte including custom passwords and extra fields', async (t) => {
  for (const enabled of [false, true]) {
    const contents = `{ "blurLockScreen": ${enabled}, "lockPassword": "0042", "language": "zh", "custom": { "keep": true } }\n`
    const { root, configPath } = await fixture(t, contents)

    assert.deepEqual(initializeWorkspaceConfig(root), JSON.parse(contents))
    assert.deepEqual(initializeWorkspaceConfig(root), JSON.parse(contents))
    assert.equal(await readFile(configPath, 'utf8'), contents)
  }
})

test('only fills missing fields and preserves manually chosen numeric passwords', async (t) => {
  const { root, configPath } = await fixture(t, '{"lockPassword":9876,"custom":"keep"}')
  const config = initializeWorkspaceConfig(root)

  assert.equal(config.blurLockScreen, false)
  assert.equal(config.lockPassword, 9876)
  assert.equal(hasLockPassword(config), true)
  assert.equal(config.custom, 'keep')
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), config)
})

test('defaults a missing password to empty and preserves the explicit lock setting', async (t) => {
  for (const enabled of [false, true]) {
    const { root } = await fixture(t, JSON.stringify({ blurLockScreen: enabled }))
    const config = initializeWorkspaceConfig(root)

    assert.equal(config.blurLockScreen, enabled)
    assert.equal(config.lockPassword, '')
    assert.deepEqual(initializeWorkspaceConfig(root), config)
  }
})

test('rejects invalid configurations without replacing their contents', async (t) => {
  for (const contents of [
    '{broken', 'null', '[]',
    '{"blurLockScreen":"true","lockPassword":"1234"}',
    '{"blurLockScreen":true,"lockPassword":null}',
    '{"blurLockScreen":true,"lockPassword":{}}',
  ]) {
    const { root, configPath } = await fixture(t, contents)
    assert.throws(() => initializeWorkspaceConfig(root), (error) => error.message.includes(configPath))
    assert.equal(await readFile(configPath, 'utf8'), contents)
  }
})

test('preserves empty and whitespace-only passwords as unprotected configuration', async (t) => {
  for (const password of ['', '  ', '\t']) {
    const contents = JSON.stringify({ blurLockScreen: true, lockPassword: password, language: 'en' })
    const { root, configPath } = await fixture(t, contents)
    const config = initializeWorkspaceConfig(root)
    assert.equal(config.lockPassword, password)
    assert.equal(hasLockPassword(config), false)
    assert.equal(await readFile(configPath, 'utf8'), contents)
  }
})

test('recognizes zero and leading-zero strings as manually configured passwords', () => {
  assert.equal(hasLockPassword({ lockPassword: 0 }), true)
  assert.equal(hasLockPassword({ lockPassword: '0000' }), true)
})

test('migrates missing language to English while preserving all existing settings', async (t) => {
  const { root, configPath } = await fixture(t, '{"blurLockScreen":true,"lockPassword":"0042","custom":{"keep":true}}')
  const config = initializeWorkspaceConfig(root)
  assert.deepEqual(config, { blurLockScreen: true, lockPassword: '0042', custom: { keep: true }, language: 'en' })
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), config)
})

test('accepts only the two supported language codes and preserves complete files', async (t) => {
  for (const language of ['en', 'zh']) {
    const contents = JSON.stringify({ blurLockScreen: false, lockPassword: '', language })
    const { root, configPath } = await fixture(t, contents)
    assert.equal(initializeWorkspaceConfig(root).language, language)
    assert.equal(await readFile(configPath, 'utf8'), contents)
  }
})

test('rejects unsupported language codes and types without migrating or overwriting the file', async (t) => {
  for (const language of ['fr', 'EN', 'zh-CN', '', ' en ', null, false, 0, [], {}]) {
    const contents = JSON.stringify({ language, custom: 'keep' })
    const { root, configPath } = await fixture(t, contents)
    assert.throws(() => initializeWorkspaceConfig(root), (error) => {
      assert.ok(error.message.includes(configPath))
      assert.match(error.message, /language/)
      assert.match(error.message, /en.*zh/)
      return true
    })
    assert.equal(await readFile(configPath, 'utf8'), contents)
  }
})
