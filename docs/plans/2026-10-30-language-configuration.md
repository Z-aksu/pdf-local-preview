# Language Configuration Implementation Plan

> Implementation follows the Code workflow in this session, with configuration, API, rendering, and CLI verification.

**Goal:** Support English and Chinese through `.pdf/config.json`, with English as the default and no language setting in the interface.

**Architecture:** Validate and persist `language` alongside existing workspace settings, expose only its validated value through `/api/config`, and provide a scoped Vue translator to all reader components. Share language definitions and messages with API error handling. Use stable CSS classes for layout instead of translated accessibility labels.

**Tech Stack:** Node.js, Express, Vue 3, Vite, Node test runner, agent-browser.

---

### 1. Configuration and startup

- Extend `server/config.js` to migrate missing `language` to `en`, accept exactly `en` and `zh`, and preserve all existing settings.
- Invalid values must produce a console diagnostic listing both supported values; default behavior is to stop startup without overwriting the file.
- Print selected and supported languages at startup in `bin/pdf-view.js`.
- Verify default creation, migration, both supported values, invalid types and codes, unchanged complete configuration, and CLI diagnostics.

### 2. Shared localization and API

- Add `shared/localization.js` with supported languages, locale identifiers, Chinese translations, and parameter interpolation.
- Publish `language` through `/api/config` without exposing passwords.
- Localize API errors and file errors using the configured language while retaining status codes and path validation.
- Verify that the packaged application includes the shared module.

### 3. Reader interface

- Add `src/i18n.js` for per-app reactive localization with English defaults and Vue injection.
- Localize all interface text, titles, accessible labels, counts, document titles, outline fallbacks, lock-screen dates and calendar labels.
- Load language from the server before restoring documents. Keep language out of browser settings and local storage.
- Replace layout rules tied to translated labels with a page-navigation CSS class.
- Verify English and Chinese component rendering, isolation between apps, accessibility labels and unchanged document names.

### 4. Delivery checks

- Document exact configuration examples and restart requirements in `README.md`.
- Run the full test suite, production build, package dry run, and diff review.
- Check English and Chinese desktop, mobile, reader, settings, context menu and lock-screen pages in a browser.
