import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cliPath = fileURLToPath(new URL('../bin/pdf-view.js', import.meta.url))

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdf-view-cli-'))
  const directory = path.join(root, 'PDF 资料')
  const processes = []

  t.after(async () => {
    for (const { child, completion } of processes) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
      }
      await completion
    }
    await rm(root, { recursive: true, force: true })
  })

  await mkdir(directory)
  await writeFile(path.join(directory, 'chosen.pdf'), '%PDF-1.4 chosen fixture')
  await writeFile(path.join(root, 'current.pdf'), '%PDF-1.4 current fixture')
  await writeFile(path.join(root, 'not-a-directory.txt'), 'fixture')

  return {
    root,
    directory,
    launch(args, cwd = root) {
      const child = spawn(process.execPath, [cliPath, ...args, '--no-open', '--host', '127.0.0.1'], {
        cwd,
        windowsHide: true,
        timeout: 15000,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })

      const completion = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
      })
      processes.push({ child, completion })

      return {
        completion,
        waitForUrl() {
          return new Promise((resolve, reject) => {
            const checkOutput = () => {
              const match = stdout.match(/地址：(http:\/\/[^\r\n]+)/)
              if (match) {
                child.stdout.off('data', checkOutput)
                resolve(match[1])
              }
            }
            child.stdout.on('data', checkOutput)
            checkOutput()
            completion.then((result) => {
              child.stdout.off('data', checkOutput)
              reject(new Error(`CLI exited before startup: ${JSON.stringify(result)}`))
            }, reject)
          })
        },
      }
    },
  }
}

test('CLI uses the command working directory when --dir is omitted', async (t) => {
  const fixture = await createFixture(t)
  const cli = fixture.launch(['--port', '0'])
  const url = await cli.waitForUrl()
  const result = await fetch(`${url}/api/tree`).then((response) => response.json())

  assert.equal(result.rootName, path.basename(fixture.root))
  assert.equal(result.count, 2)
  assert.ok(result.tree.some((entry) => entry.name === 'current.pdf'))
})

test('CLI serves an absolute --dir containing spaces and Chinese characters', async (t) => {
  const fixture = await createFixture(t)
  const cli = fixture.launch(['--dir', fixture.directory, '--port=0'])
  const url = await cli.waitForUrl()
  const result = await fetch(`${url}/api/tree`).then((response) => response.json())

  assert.equal(result.rootName, path.basename(fixture.directory))
  assert.equal(result.count, 1)
  assert.equal(result.tree[0].path, 'chosen.pdf')
  assert.equal(
    await fetch(`${url}/api/pdf?path=chosen.pdf`).then((response) => response.text()),
    '%PDF-1.4 chosen fixture',
  )
  assert.equal((await fetch(`${url}/api/pdf?path=../current.pdf`)).status, 403)
})

test('CLI resolves relative -d and --dir= paths against the command working directory', async (t) => {
  const fixture = await createFixture(t)

  for (const args of [
    ['-p', '0', '-d', path.relative(fixture.root, fixture.directory)],
    ['--dir=./PDF 资料/../PDF 资料', '--port', '0'],
  ]) {
    const url = await fixture.launch(args).waitForUrl()
    const result = await fetch(`${url}/api/tree`).then((response) => response.json())
    assert.equal(result.rootName, path.basename(fixture.directory))
    assert.equal(result.count, 1)
  }
})

test('CLI binds an explicitly selected available port', async (t) => {
  const fixture = await createFixture(t)
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()))

  const url = await fixture.launch(['-d', fixture.directory, '-p', String(port)]).waitForUrl()
  assert.equal(new URL(url).port, String(port))
  assert.equal((await fetch(`${url}/api/tree`)).status, 200)
})

test('CLI reports nonexistent directories and file paths before starting a server', async (t) => {
  const fixture = await createFixture(t)

  for (const [directory, message] of [
    [path.join(fixture.root, 'missing'), '目录不存在'],
    [path.join(fixture.root, 'not-a-directory.txt'), '路径不是文件夹'],
    [path.join(fixture.root, 'not-a-directory.txt', 'child'), '目录不存在'],
  ]) {
    const result = await fixture.launch(['--dir', directory, '--port', '0']).completion
    assert.equal(result.code, 1)
    assert.ok(result.stderr.includes(message), result.stderr)
    assert.ok(result.stderr.includes(directory), result.stderr)
    assert.doesNotMatch(result.stdout, /已启动|地址：/)
  }
})

test('CLI prints the occupied explicit port and exits instead of switching ports', async (t) => {
  const fixture = await createFixture(t)
  const blocker = createServer()
  blocker.listen(0, '127.0.0.1')
  await once(blocker, 'listening')
  t.after(() => new Promise((resolve, reject) => {
    blocker.close((error) => error ? reject(error) : resolve())
  }))
  const port = blocker.address().port

  const result = await fixture.launch(['--dir', fixture.directory, '--port', String(port)]).completion

  assert.equal(result.code, 1)
  assert.match(result.stderr, new RegExp(`端口 ${port} 已被占用`))
  assert.match(result.stderr, /--port/)
  assert.doesNotMatch(result.stdout + result.stderr, /正在尝试|已启动|地址：/)
  assert.equal(blocker.listening, true)
})

test('CLI prints argument errors for missing directory values and invalid ports', async (t) => {
  const fixture = await createFixture(t)

  for (const [args, message] of [
    [['--dir'], '缺少目录参数值'],
    [['--dir='], '缺少目录参数值'],
    [['--port=65536'], '端口必须是'],
    [['--port='], '端口必须是'],
  ]) {
    const result = await fixture.launch(args).completion
    assert.equal(result.code, 1)
    assert.ok(result.stderr.includes(message), result.stderr)
    assert.doesNotMatch(result.stdout, /已启动|地址：/)
  }
})

test('CLI help and version exit without checking the selected directory', async (t) => {
  const fixture = await createFixture(t)
  const args = ['--dir', path.join(fixture.root, 'missing')]
  const help = await fixture.launch([...args, '--help']).completion
  const version = await fixture.launch([...args, '--version']).completion

  assert.equal(help.code, 0)
  assert.match(help.stdout, /-d, --dir <目录>/)
  assert.match(help.stdout, /-p, --port <端口>/)
  assert.equal(help.stderr, '')
  assert.equal(version.code, 0)
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/)
  assert.equal(version.stderr, '')
})
