import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8')
const viewerSource = await readFile(new URL('../src/components/PdfViewer.vue', import.meta.url), 'utf8')

test('small-screen toolbar uses uncluttered landscape and focus icon controls', () => {
  const mobileStyles = styles.slice(
    styles.indexOf('@media (max-width: 760px)'),
    styles.indexOf('@media (prefers-reduced-motion: reduce)'),
  )

  assert.match(
    mobileStyles,
    /\.reader-mode-button\s+span,\s*\.focus-mode-button\s+span\s*\{[^}]*display:\s*none/,
  )
  assert.match(
    styles,
    /\.toolbar-button\s+span\s*\{[^}]*white-space:\s*nowrap/,
  )
  assert.match(
    mobileStyles,
    /\.toolbar-group--zoom \.toolbar-button\s*\{[^}]*flex:\s*0 0 auto;[^}]*width:\s*30px;[^}]*min-width:\s*30px;[^}]*padding:\s*0/,
  )
  assert.match(
    mobileStyles,
    /\.toolbar-group--zoom \.toolbar-button svg\s*\{[^}]*flex-shrink:\s*0/,
  )
  for (const className of ['reader-mode-button', 'focus-mode-button']) {
    const button = viewerSource.match(new RegExp(`<button\\s+class="toolbar-button ${className}"[^>]*>`))?.[0]
    assert.ok(button, `${className} exists`)
    assert.match(button, /:aria-label="[^"]+"/)
    assert.match(button, /:title="[^"]+"/)
  }
})

test('desktop reader toolbar compacts to the PDF viewer width when the sidebar is resized', () => {
  assert.match(styles, /\.pdf-viewer\s*\{[^}]*container-type:\s*inline-size/)
  assert.match(
    styles,
    /@container\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.reader-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+max-content/,
  )
  assert.match(
    styles,
    /@container\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.toolbar-group--zoom \.toolbar-button--labeled span,[\s\S]*?\.reader-mode-button span,[\s\S]*?\.focus-mode-button span\s*\{[^}]*display:\s*none/,
  )
  assert.match(
    styles,
    /@container\s*\(max-width:\s*420px\)\s*\{[\s\S]*?\.toolbar-group--zoom \.toolbar-button\s*\{[^}]*min-width:\s*24px/,
  )
})

test('sidebars retain compact, readable hierarchy controls at every width', () => {
  assert.match(styles, /\.sidebar\s*\{[^}]*container-name:\s*sidebar;[^}]*container-type:\s*inline-size/)
  assert.match(
    styles,
    /@container sidebar\s*\(max-width:\s*340px\)\s*\{\s*\.sidebar-expansion-label-prefix\s*\{[^}]*display:\s*none/,
  )
  const groupStyles = styles.match(/\.sidebar-expansion-actions > div\s*\{([^}]*)\}/)?.[1]
  assert.ok(groupStyles)
  assert.match(groupStyles, /margin-left:\s*auto/)
  assert.doesNotMatch(groupStyles, /padding:|background:|border:/)
  assert.match(styles, /\.sidebar-expansion-actions button\s*\{[^}]*height:\s*24px/)
  assert.match(styles, /\.sidebar-expansion-actions button:focus-visible\s*\{[^}]*outline:/)
  assert.doesNotMatch(styles, /\.sidebar-expansion-actions button span\s*\{[^}]*display:\s*none/)
  assert.match(appSource, /class="sidebar-expansion-actions" role="group" :aria-label=/)
  assert.match(viewerSource, /class="toolbar-group toolbar-group--pages"/)
  assert.doesNotMatch(styles, /\[aria-label=/)
})

test('mobile focus mode keeps a safe touch-sized exit control', () => {
  assert.match(
    styles,
    /\.focus-mode-exit-button\s*\{[^}]*min-height:\s*44px/,
  )
  assert.match(
    styles,
    /@media\s*\(max-width:\s*760px\),\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.app-shell--focus-mode\s+\.focus-mode-exit-button\s*\{[^}]*display:\s*inline-flex/,
  )
})
