import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'

import { listenOnAvailablePort } from '../server/listen.js'

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function occupyPort() {
  while (true) {
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')

    if (server.address().port < 65535) {
      return server
    }

    await closeServer(server)
  }
}

test('listenOnAvailablePort increments until it finds a free port', async (context) => {
  const blocker = await occupyPort()
  const requestedPort = blocker.address().port
  const attemptedPorts = []
  const app = {
    listen(port, host) {
      return createServer((_request, response) => response.end('ok')).listen(port, host)
    },
  }

  context.after(() => closeServer(blocker))

  const result = await listenOnAvailablePort(app, {
    host: '127.0.0.1',
    port: requestedPort,
    onPortInUse: (occupiedPort, nextPort) => attemptedPorts.push([occupiedPort, nextPort]),
  })
  context.after(() => closeServer(result.server))

  assert.ok(result.port > requestedPort)
  assert.deepEqual(attemptedPorts[0], [requestedPort, requestedPort + 1])
  assert.equal(await fetch(`http://127.0.0.1:${result.port}`).then((response) => response.text()), 'ok')
})

test('listenOnAvailablePort retries consecutive occupied ports in order', async () => {
  const requestedPort = 41221
  const availablePort = requestedPort + 2
  const attemptedPorts = []
  const retries = []
  const app = {
    listen(port) {
      attemptedPorts.push(port)
      const server = new EventEmitter()
      server.address = () => ({ port })
      queueMicrotask(() => {
        if (port < availablePort) {
          server.emit('error', Object.assign(new Error('address in use'), { code: 'EADDRINUSE' }))
        } else {
          server.emit('listening')
        }
      })
      return server
    },
  }

  const result = await listenOnAvailablePort(app, {
    host: '127.0.0.1',
    port: requestedPort,
    onPortInUse: (occupiedPort, nextPort) => retries.push([occupiedPort, nextPort]),
  })

  assert.equal(result.port, availablePort)
  assert.deepEqual(attemptedPorts, [requestedPort, requestedPort + 1, availablePort])
  assert.deepEqual(retries, [[requestedPort, requestedPort + 1], [requestedPort + 1, availablePort]])
})

test('listenOnAvailablePort rejects an occupied explicit port without retrying', async (context) => {
  const blocker = await occupyPort()
  const requestedPort = blocker.address().port
  const attemptedPorts = []
  const retries = []
  const app = {
    listen(port, host) {
      attemptedPorts.push(port)
      return createServer().listen(port, host)
    },
  }
  context.after(() => closeServer(blocker))

  await assert.rejects(
    listenOnAvailablePort(app, {
      host: '127.0.0.1',
      port: requestedPort,
      retryOnConflict: false,
      onPortInUse: (...ports) => retries.push(ports),
    }),
    (error) => error.code === 'EADDRINUSE' && error.port === requestedPort,
  )
  assert.deepEqual(attemptedPorts, [requestedPort])
  assert.deepEqual(retries, [])
})

test('listenOnAvailablePort accepts a system-assigned port', async (context) => {
  const app = {
    listen(port, host) {
      return createServer().listen(port, host)
    },
  }
  const result = await listenOnAvailablePort(app, {
    host: '127.0.0.1',
    port: 0,
    retryOnConflict: false,
  })
  context.after(() => closeServer(result.server))

  assert.ok(result.port > 0 && result.port <= 65535)
  assert.equal(result.server.address().port, result.port)
})

test('listenOnAvailablePort does not hide non-conflict errors', async () => {
  const expectedError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  const app = {
    listen() {
      const server = new EventEmitter()
      queueMicrotask(() => server.emit('error', expectedError))
      return server
    },
  }

  await assert.rejects(
    listenOnAvailablePort(app, { host: '127.0.0.1', port: 41221 }),
    (error) => error === expectedError,
  )
})

test('listenOnAvailablePort reports exhaustion at the maximum port', async () => {
  const conflictError = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' })
  const app = {
    listen() {
      const server = new EventEmitter()
      queueMicrotask(() => server.emit('error', conflictError))
      return server
    },
  }

  await assert.rejects(
    listenOnAvailablePort(app, { host: '127.0.0.1', port: 65535 }),
    (error) => error.code === 'NO_AVAILABLE_PORT' && error.cause === conflictError,
  )
})
