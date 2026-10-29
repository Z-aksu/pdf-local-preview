import express from 'express'
import crypto from 'node:crypto'
import path from 'node:path'

import { buildPdfTree, countPdfFiles, resolvePdfPath } from './files.js'

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next)
  }
}

function createWorkspaceId(rootDir) {
  const normalizedRoot = process.platform === 'win32'
    ? rootDir.toLowerCase()
    : rootDir
  return crypto
    .createHash('sha256')
    .update(`pdf-local-preview:${normalizedRoot}`)
    .digest('hex')
    .slice(0, 24)
}

export function createPdfApp({ rootDir, staticDir }) {
  const app = express()
  const absoluteRoot = path.resolve(rootDir)
  const workspaceId = createWorkspaceId(absoluteRoot)

  app.disable('x-powered-by')
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    response.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
    ].join('; '))
    next()
  })

  app.get('/api/tree', asyncRoute(async (_request, response) => {
    const tree = await buildPdfTree(absoluteRoot)
    response.json({
      workspaceId,
      rootName: path.basename(absoluteRoot),
      count: countPdfFiles(tree),
      tree,
    })
  }))

  app.get('/api/pdf', asyncRoute(async (request, response, next) => {
    const pdfPath = await resolvePdfPath(absoluteRoot, request.query.path)
    const encodedName = encodeURIComponent(path.basename(pdfPath))

    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedName}`)
    response.setHeader('Cache-Control', 'no-store')
    response.sendFile(pdfPath, (error) => {
      if (error && !response.headersSent) {
        next(error)
      }
    })
  }))

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: '接口不存在' })
  })

  if (staticDir) {
    const absoluteStaticDir = path.resolve(staticDir)
    app.use(express.static(absoluteStaticDir, { index: false }))
    app.get(/.*/, (_request, response) => {
      response.sendFile(path.join(absoluteStaticDir, 'index.html'))
    })
  }

  app.use((_request, response) => {
    response.status(404).json({ error: '页面不存在' })
  })

  app.use((error, _request, response, next) => {
    if (response.headersSent) {
      next(error)
      return
    }

    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500
    const message = statusCode === 500 ? '本地服务发生错误' : error.message
    response.status(statusCode).json({ error: message })
  })

  return app
}
