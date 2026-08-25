# MuStash release notes

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
