import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_LANGUAGE, translate } from '../shared/localization.js'

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git'])
const collator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
})

function createHttpError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function toClientPath(parts) {
  return parts.join('/')
}

function isInsideRoot(rootDir, candidate) {
  const relative = path.relative(rootDir, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function sortNodes(left, right) {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1
  }
  return collator.compare(left.name, right.name)
}

async function scanDirectory(absoluteDir, relativeParts = []) {
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  const nodes = []

  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) {
      continue
    }

    const nextParts = [...relativeParts, entry.name]
    const clientPath = toClientPath(nextParts)
    const absolutePath = path.join(absoluteDir, entry.name)

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue
      }

      let children
      try {
        children = await scanDirectory(absolutePath, nextParts)
      } catch (error) {
        if (error.code === 'EACCES' || error.code === 'EPERM') {
          continue
        }
        throw error
      }

      if (children.length > 0) {
        nodes.push({
          type: 'directory',
          name: entry.name,
          path: clientPath,
          children,
        })
      }
      continue
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.pdf') {
      nodes.push({
        type: 'file',
        name: entry.name,
        path: clientPath,
      })
    }
  }

  return nodes.sort(sortNodes)
}

export async function buildPdfTree(rootDir) {
  return scanDirectory(path.resolve(rootDir))
}

export function countPdfFiles(nodes) {
  return nodes.reduce((count, node) => {
    return count + (node.type === 'file' ? 1 : countPdfFiles(node.children))
  }, 0)
}

export async function resolvePdfPath(rootDir, requestedPath, language = DEFAULT_LANGUAGE) {
  const t = (message) => translate(language, message)
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw createHttpError(t('A PDF file path is required.'), 400)
  }

  if (path.extname(requestedPath).toLowerCase() !== '.pdf') {
    throw createHttpError(t('Only PDF files can be accessed.'), 400)
  }

  const absoluteRoot = await realpath(path.resolve(rootDir))
  const unresolvedCandidate = path.resolve(absoluteRoot, requestedPath)
  if (!isInsideRoot(absoluteRoot, unresolvedCandidate)) {
    throw createHttpError(t('Access to files outside the current directory is not allowed.'), 403)
  }

  let candidate
  try {
    candidate = await realpath(unresolvedCandidate)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw createHttpError(t('PDF file not found.'), 404)
    }
    throw error
  }

  if (!isInsideRoot(absoluteRoot, candidate)) {
    throw createHttpError(t('Access to files outside the current directory is not allowed.'), 403)
  }

  const fileStat = await stat(candidate)
  if (!fileStat.isFile()) {
    throw createHttpError(t('The requested path is not a file.'), 400)
  }

  return candidate
}
