# MuStash release notes

## Unreleased — 2026-08-27

### Changed

- Upload settings grid is now three columns on desktop (TTL / password / Allow Download at roughly 20% / 60% / 20%).
- On mobile, TTL and Allow Download share the first row; the password field spans the row below.
- Allow Download copy is a single label, vertically centered to the TTL input control.
- Focusing or tapping the TTL hours field selects its current value for quick replacement.
- MuStash now presents itself as temporary **file** sharing rather than media-only sharing.
- Removed the redundant dedicated **Take photo** action; mobile users can use the camera option already exposed by the native **Choose a file** picker.
- Share preview status tags stay in the top-right; the filename now replaces the former **Temporary share** eyebrow at top-left, while size and expiration remain beneath the preview on one compact line.
- Expanded Playwright coverage for the settings-grid layout (desktop and mobile), TTL select-on-focus behavior, document/text uploads, removable pre-upload selections, and recipient share layout.

### Added

- Added an **Allow Download** upload option, enabled by default for backward-compatible sharing behavior.
- Preview-only shares now expose a **Preview only** indicator instead of a Download action.
- Added common document support: PDF, DOCX, XLSX, PPTX, ODT, ODS, and ODP.
- Added UTF-8 text-document support for TXT, CSV, Markdown, and JSON.
- PDF and text documents use browser-native inline previews; Office/OpenDocument files fall back to a download-oriented document view when the browser cannot preview them natively.
- Added an **X** control in the top-right of the selected-file preview so a file can be removed before it is stashed.

### Security / behavior

- Binary formats continue to be validated from file contents instead of trusting browser MIME types or filenames.
- Plain-text formats are accepted only for a small extension allowlist and only after streaming UTF-8/control-character validation; they are served with an explicit non-executable MIME type and `X-Content-Type-Options: nosniff`.
- HTML and SVG remain unsupported as upload formats.
- Shares created with **Allow Download** disabled reject explicit `?download=1` attachment requests with HTTP `403`.
- Preview-only content is served inline with no-store caching and browser-level deterrents for dragging, context-menu saving, remote playback, Picture-in-Picture, and mobile touch callout where supported.
- Existing metadata that predates the `allowDownload` field continues to allow downloads by default.
- Screenshot and screen-recording prevention is intentionally not claimed: ordinary web pages cannot reliably block operating-system capture, and previewed file bytes can still be recovered by a determined recipient.
- Expanded Playwright desktop/mobile E2E coverage for Allow Download defaults, unrestricted downloads, preview-only rendering, server-side download rejection, client-side preview deterrents, document/text acceptance, removable pre-upload selections, share layout, settings-grid layout, and TTL select-on-focus.

## 0.1.2 — 2026-08-25

### Added

- CommonJS mount entry (`server.cjs`) and exportable `createApp()` so MuStash can be served under main-server at `/mustash`.
- Relative frontend asset/API paths and a `/mustash` → `/mustash/` redirect so CSS/JS resolve correctly when mounted.
- Custom TTL up/down steppers beside the hours field; native number spinners are hidden.
- Right-aligned lock icon inside the optional password field.
- Settings grid column ratio of 1/3 (TTL) and 2/3 (password).

### Changed

- Helmet no longer forces HTTPS upgrades or HSTS, so the UI works over plain HTTP (LAN / reverse proxy).
- Unlock cookie paths and `contentUrl` values respect Express `req.baseUrl` when mounted under a prefix.
- If `MUSTASH_SECRET` is unset, a persistent secret is written under `DATA_DIR/.mustash-secret` instead of failing in production.
- Expanded Playwright coverage for TTL steppers and the password lock icon.

## 0.1.1 — 2026-08-24

### Changed

- Replaced the standalone theme button with a hamburger app menu on both the landing and share pages.
- Moved appearance control into the menu as a single persistent dark-mode toggle.
- Added a disabled **Settings** menu item marked **Soon** as a placeholder for future configurables.
- Added menu accessibility behavior for expanded/pressed state, Escape dismissal, and outside-click dismissal.
- Mobile now uses only the native file picker; drag-and-drop upload is shown and enabled only for desktop-style fine-pointer/hover devices.
- Expanded Playwright desktop/mobile E2E coverage for the hamburger menu, settings placeholder, theme toggle, persisted appearance preference, and desktop-only drag/drop behavior.

## 0.1.0 — 2026-08-24

Initial MVP.

### Added

- Temporary image/audio/video uploads with configurable expiration (24 hours by default).
- Content-based media type validation, UUID storage names, upload limits, security headers, same-origin POST checks, and rate limiting.
- Optional browser-derived password protection with PBKDF2, URL-fragment access keys, server-side `scrypt` verification, and short-lived HttpOnly unlock cookies.
- Responsive upload flow, local preview, shared-media preview, download action, native share-sheet support, and copy fallback.
- Minimal mustache/µ-inspired visual identity with favicon and Apple touch icon.
- Light/dark theme toggle with system preference support.
- Automatic expired-file cleanup.
- Dockerfile for deployment.
- Playwright desktop/mobile E2E suite and GitHub Actions CI workflow.
