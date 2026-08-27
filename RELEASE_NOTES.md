# MuStash release notes

## Unreleased — 2026-08-27

### Changed

- Upload settings grid is now three columns on desktop (TTL / password / Allow Download at roughly 20% / 60% / 20%).
- On mobile, TTL and Allow Download share the first row; the password field spans the row below.
- Allow Download copy is a single label, vertically centered to the TTL input control.
- Focusing or tapping the TTL hours field selects its current value for quick replacement.
- Guard Lab mobile pinning now starts when **Start sensors** is pressed and remains active until **Stop**. The actual protected test window is temporarily moved to the document body while pinned so `position: fixed` is relative to the viewport instead of the composited card container.
- Expanded Playwright coverage for the settings-grid layout (desktop and mobile), TTL select-on-focus behavior, and Guard Lab viewport-fixed sensor pinning.

### Added

- Added an **Allow Download** upload option, enabled by default for backward-compatible sharing behavior.
- Preview-only shares now expose a **Preview only** indicator instead of a Download action.
- Added an experimental **Guard Lab** at `/testlab/` standalone and `/mustash/testlab/` when mounted under main-server.
- Guard Lab can test high-frequency carrier-amplitude changes, microphone transients, device-motion impulses, browser-exposed volume-key events, and manual black-overlay activation.
- Guard Lab logs detector timing, guard-class application timing, and the next animation-frame timing for real-device testing.
- Guard Lab now exports self-contained JSON diagnostics for offline review and tuning. Exports include browser/device context, capabilities and permissions, detector settings and changes, audio-context and microphone-track characteristics, calibration baselines, high-rate audio/motion telemetry, trigger decisions, rendering timing, and counters.
- Added five-second **Volume Up** and **Volume Down** labeled trial windows so exported sensor data can be correlated with known physical button presses, plus a control to mark the most recent trigger as a false positive.

### Security / behavior

- Shares created with **Allow Download** disabled reject explicit `?download=1` attachment requests with HTTP `403`.
- Preview-only media is served inline with no-store caching and browser-level deterrents for dragging, context-menu saving, remote playback, Picture-in-Picture, and mobile touch callout where supported.
- Existing metadata that predates the `allowDownload` field continues to allow downloads by default.
- Screenshot and screen-recording prevention is intentionally not claimed: ordinary web pages cannot reliably block operating-system capture, and previewed media bytes can still be recovered by a determined recipient.
- Guard Lab sensor processing and diagnostic capture remain local to the browser. Export occurs only when the user explicitly downloads the diagnostic JSON.
- Guard Lab is experimental instrumentation only and does not change normal share-page behavior.
- Expanded Playwright desktop/mobile E2E coverage for Allow Download defaults, unrestricted downloads, preview-only rendering, server-side download rejection, client-side preview deterrents, Guard Lab route/manual-overlay behavior, diagnostic export structure, viewport-fixed sensor pinning, settings-grid layout, and TTL select-on-focus.

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
