#!/usr/bin/env node

import { access, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import open from 'open'

import { createPdfApp } from '../server/app.js'
import { hasLockPassword, initializeWorkspaceConfig } from '../server/config.js'
import { listenOnAvailablePort } from '../server/listen.js'
import { parseCliOptions } from '../server/options.js'

const require = createRequire(import.meta.url)
const packageInfo = require('../package.json')
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const staticDir = path.join(packageRoot, 'dist')

const HELP_TEXT = `
PDF Local Preview

用法：
  pdf-view [选项]

选项：
  -d, --dir <目录>   指定 PDF 所在目录，默认使用执行命令时的当前目录
  -p, --port <端口>  指定监听端口，占用时提示并退出；不指定时默认 41221，占用时自动递增
      --host <地址>  指定监听地址，默认 0.0.0.0（支持局域网访问）
      --lan          监听所有网卡，允许局域网设备访问（默认行为）
      --no-open      启动后不自动打开浏览器
  -h, --help         显示帮助
  -v, --version      显示版本号

命令会递归读取指定目录及其子目录中的 PDF 文件，支持相对路径和绝对路径。
路径包含空格时请使用引号。端口范围为 0 到 65535，0 表示由系统分配可用端口。

示例：
  pdf-view
  pdf-view --dir "D:\\PDF 资料" --port 4300
  pdf-view -d ./documents -p 4300 --no-open
`.trim()

function browserHost(host) {
  if (host === '0.0.0.0' || host === '::') {
    return '127.0.0.1'
  }
  return host.includes(':') ? `[${host}]` : host
}

function lanHosts() {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .filter((address) => !address.internal && (address.family === 'IPv4' || address.family === 4))
    .map((address) => address.address)

  return [...new Set(addresses)]
}

async function ensureClientBuild() {
  try {
    await access(path.join(staticDir, 'index.html'))
  } catch {
    const error = new Error('未找到前端构建文件，请先在项目目录执行 npm run build')
    error.code = 'CLIENT_BUILD_MISSING'
    throw error
  }
}

async function resolveRootDirectory(directory) {
  const rootDir = path.resolve(directory)
  let stats

  try {
    stats = await stat(rootDir)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new Error(`目录不存在：${rootDir}`)
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new Error(`无法访问目录（权限不足）：${rootDir}`)
    }
    throw error
  }

  if (!stats.isDirectory()) {
    throw new Error(`路径不是文件夹：${rootDir}`)
  }

  return rootDir
}

export async function main(args = process.argv.slice(2)) {
  const options = parseCliOptions(args)

  if (options.help) {
    console.log(HELP_TEXT)
    return null
  }

  if (options.version) {
    console.log(packageInfo.version)
    return null
  }

  const rootDir = await resolveRootDirectory(options.directory)
  await ensureClientBuild()

  const config = initializeWorkspaceConfig(rootDir)
  const app = createPdfApp({ rootDir, staticDir, config })
  const { server, port } = await listenOnAvailablePort(app, {
    host: options.host,
    port: options.port,
    retryOnConflict: !options.portSpecified,
    onPortInUse: (occupiedPort, nextPort) => {
      console.warn(`端口 ${occupiedPort} 已被占用，正在尝试 ${nextPort}`)
    },
  })
  const url = `http://${browserHost(options.host)}:${port}`

  console.log('PDF Local Preview 已启动')
  console.log(`目录：${rootDir}`)
  console.log(`配置：${path.join(rootDir, '.pdf', 'config.json')}`)
  if (hasLockPassword(config)) console.log(`解锁密码：${config.lockPassword}`)
  console.log(`地址：${url}`)
  if (options.host === '0.0.0.0' || options.host === '::') {
    for (const host of lanHosts()) {
      console.log(`LAN access: http://${host}:${port}`)
    }
  }
  console.log('按 Ctrl+C 停止服务')

  if (options.open) {
    open(url).catch((error) => {
      console.warn(`无法自动打开浏览器：${error.message}`)
    })
  }

  const shutdown = () => {
    server.close(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  return { server, url, rootDir }
}

main().catch((error) => {
  if (error.code === 'EADDRINUSE') {
    const port = error.port === undefined ? '' : ` ${error.port}`
    console.error(`启动失败：端口${port} 已被占用，请使用 --port 指定其他端口`)
  } else {
    console.error(`启动失败：${error.message}`)
  }
  process.exitCode = 1
})
