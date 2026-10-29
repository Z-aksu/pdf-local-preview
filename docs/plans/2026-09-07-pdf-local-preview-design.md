# PDF Local Preview Design

## Goal

Build a globally linkable `pdf-view` command that serves the PDF files below the current working directory and opens a Vue-based local reader in the browser.

## Architecture

The npm package contains three layers. A small Node.js CLI parses command-line options, captures `process.cwd()`, starts an Express server, and optionally opens the default browser. Express exposes a JSON directory-tree API and a guarded PDF streaming endpoint, then serves the prebuilt Vue application. Vue renders a recursive navigation tree on the left and an embedded PDF.js reader on the right.

The package publishes its built `dist` directory. `npm link` creates the `pdf-view` executable from the package `bin` entry, so running the command from any directory uses that directory as the browsing root rather than the package installation directory.

## File discovery and safety

Directory discovery is recursive. It keeps PDF files and directories containing at least one PDF, sorts directories before files, and skips symbolic links, hidden folders, and common dependency folders such as `node_modules`. The API returns relative paths only.

Every PDF request is resolved against the captured root. Files outside that root, non-PDF extensions, missing paths, and directories are rejected. This prevents `..` path traversal and avoids exposing arbitrary local files. The service listens on `0.0.0.0` by default so the printed network address can be opened from another device on the same LAN; pass `--host 127.0.0.1` when local-only access is required.

## Reader experience

The interface uses a restrained document-workbench aesthetic with a compact, collapsible folder tree and a large paper-like reading surface. Selecting a file updates the URL-backed PDF source without reloading the application. PDF.js renders pages continuously into canvases, renders only pages near the viewport, and rerenders visible pages for zoom or container-width changes.

A sticky toolbar provides previous/next page, current-page status, zoom, fit-width, rotation, and download. Scrolling updates the current page. Loading, empty-folder, missing-file, render-error, and refresh states have explicit feedback.

## Verification

Node tests cover recursive discovery, sorting and filtering, path containment, API responses, and PDF streaming. The Vue production build verifies dependency and worker bundling. Final verification links the package, launches `pdf-view` in a temporary nested PDF fixture, calls the APIs, and opens the built UI in a real browser for visual and interaction checks.
