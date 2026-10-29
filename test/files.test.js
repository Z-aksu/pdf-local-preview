import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildPdfTree, resolvePdfPath } from '../server/files.js'

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdf-view-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await mkdir(path.join(root, '课程', '第二章'), { recursive: true })
  await mkdir(path.join(root, '空目录'), { recursive: true })
  await mkdir(path.join(root, '.private'), { recursive: true })
  await mkdir(path.join(root, 'node_modules', 'manual'), { recursive: true })
  await writeFile(path.join(root, '课程', '第二章', '讲义 02.PDF'), '%PDF-nested')
  await writeFile(path.join(root, '根目录.pdf'), '%PDF-root')
  await writeFile(path.join(root, 'readme.txt'), 'ignore me')
  await writeFile(path.join(root, '.private', 'secret.pdf'), '%PDF-secret')
  await writeFile(path.join(root, 'node_modules', 'manual', 'dependency.pdf'), '%PDF-dependency')
  return root
}

test('buildPdfTree keeps only visible PDF branches and sorts directories first', async (t) => {
  const root = await createFixture(t)

  const tree = await buildPdfTree(root)

  assert.deepEqual(tree, [
    {
      type: 'directory',
      name: '课程',
      path: '课程',
      children: [
        {
          type: 'directory',
          name: '第二章',
          path: '课程/第二章',
          children: [
            {
              type: 'file',
              name: '讲义 02.PDF',
              path: '课程/第二章/讲义 02.PDF',
            },
          ],
        },
      ],
    },
    {
      type: 'file',
      name: '根目录.pdf',
      path: '根目录.pdf',
    },
  ])
})

test('resolvePdfPath accepts a nested PDF below the root', async (t) => {
  const root = await createFixture(t)

  const result = await resolvePdfPath(root, '课程/第二章/讲义 02.PDF')

  assert.equal(result, path.join(root, '课程', '第二章', '讲义 02.PDF'))
})

test('resolvePdfPath rejects traversal and non-PDF files', async (t) => {
  const root = await createFixture(t)

  await assert.rejects(() => resolvePdfPath(root, '../outside.pdf'), { statusCode: 403 })
  await assert.rejects(() => resolvePdfPath(root, 'readme.txt'), { statusCode: 400 })
})

test('resolvePdfPath rejects a symbolic link that escapes the root', async (t) => {
  const root = await createFixture(t)
  const outside = await mkdtemp(path.join(os.tmpdir(), 'pdf-view-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  const outsidePdf = path.join(outside, 'outside.pdf')
  await writeFile(outsidePdf, '%PDF-outside')

  try {
    await symlink(outsidePdf, path.join(root, 'escape.pdf'), 'file')
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('当前 Windows 配置不允许创建符号链接')
      return
    }
    throw error
  }

  await assert.rejects(() => resolvePdfPath(root, 'escape.pdf'), { statusCode: 403 })
})
