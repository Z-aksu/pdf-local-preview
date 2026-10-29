import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCliOptions } from '../server/options.js'

test('parseCliOptions enables LAN access by default', () => {
  assert.deepEqual(parseCliOptions([]), {
    directory: '.',
    port: 41221,
    portSpecified: false,
    host: '0.0.0.0',
    open: true,
    help: false,
    version: false,
  })
})

test('parseCliOptions accepts custom host, port, and no-open mode', () => {
  assert.deepEqual(parseCliOptions(['--host', '0.0.0.0', '--port=4300', '--no-open']), {
    directory: '.',
    port: 4300,
    portSpecified: true,
    host: '0.0.0.0',
    open: false,
    help: false,
    version: false,
  })
})

test('parseCliOptions enables LAN listening with --lan', () => {
  assert.equal(parseCliOptions(['--lan']).host, '0.0.0.0')
})

test('parseCliOptions recognizes help and version aliases', () => {
  assert.equal(parseCliOptions(['-h']).help, true)
  assert.equal(parseCliOptions(['-v']).version, true)
})

test('parseCliOptions accepts directory flags and preserves paths containing spaces', () => {
  for (const args of [
    ['--dir', 'D:\\PDF 资料'],
    ['-d', 'D:\\PDF 资料'],
    ['--dir=D:\\PDF 资料'],
  ]) {
    const options = parseCliOptions(args)
    assert.equal(options.directory, 'D:\\PDF 资料')
    assert.equal(options.port, 41221)
    assert.equal(options.portSpecified, false)
  }
})

test('parseCliOptions accepts directory and port options in either order', () => {
  for (const args of [
    ['--dir', './documents', '--port', '4300'],
    ['-p', '4300', '-d', './documents'],
    ['--port=4300', '--dir=./documents'],
  ]) {
    const options = parseCliOptions(args)
    assert.equal(options.directory, './documents')
    assert.equal(options.port, 4300)
    assert.equal(options.portSpecified, true)
  }
})

test('parseCliOptions recognizes explicitly selected default and boundary ports', () => {
  for (const port of [0, 41221, 65535]) {
    const options = parseCliOptions(['--port', String(port)])
    assert.equal(options.port, port)
    assert.equal(options.portSpecified, true)
  }
})

test('parseCliOptions rejects missing directory values', () => {
  for (const args of [['--dir'], ['-d'], ['--dir='], ['--dir', ''], ['--dir', '--no-open']]) {
    assert.throws(() => parseCliOptions(args), /缺少目录参数值/)
  }
})

test('parseCliOptions rejects invalid ports and unknown arguments', () => {
  for (const port of ['70000', '65536', '1.5', 'abc', '0x10', '1e3', ' ', '']) {
    assert.throws(() => parseCliOptions([`--port=${port}`]), /端口必须是/)
  }
  assert.throws(() => parseCliOptions(['--port=-1']), /端口必须是/)
  assert.throws(() => parseCliOptions(['--port']), /缺少端口/)
  assert.throws(() => parseCliOptions(['--unknown']), /未知参数/)
  assert.throws(() => parseCliOptions(['documents']), /未知参数/)
})
