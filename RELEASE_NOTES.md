# MuStash release notes

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
- If `MUSTASH_SECRET` is unset, a persistent secret is written to `DATA_DIR/.mustash-secret` instead of failing in production.
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
