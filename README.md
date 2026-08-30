# MuStash

**MuStash** is a tiny, self-hosted temporary file share: upload one or more files, optionally name the stash, choose how long it should live, optionally protect it with a password, then send the generated link.

The name is both a nod to a **mustache** and to **µ (micro) + stash** — a small place to put something for a little while.

## Features

- Temporary server-side storage with a 24-hour default expiration.
- Custom expiration from 15 minutes up to 7 days by default, with on-page TTL steppers.
- One or more files per stash, with a configurable file-count cap and aggregate stash-size limit.
- Optional human-readable stash names; a single unnamed file falls back to its filename, while unnamed multi-file stashes fall back to a file-count label.
- Image, video, and audio previews on desktop and mobile.
- PDF and UTF-8 text-document previews in the browser.
- Common document uploads including DOCX, XLSX, PPTX, ODT, ODS, and ODP; formats without a browser-native preview remain downloadable.
- Selected files can be removed individually from the pre-upload list before they are stashed.
- Recipient previews show the stash name in the top-left eyebrow, keep status tags in the top-right, and show aggregate size/file count plus expiration below the preview.
- Multi-file stashes provide a recipient file selector so each item can be previewed independently.
- The Download action lets recipients select one or more files. One selected file downloads directly; multiple selections are streamed as a compressed `mustash-YYYYMMDDHHMM.zip` without writing a temporary ZIP to server storage.
- On mobile/coarse-pointer secure contexts, successfully generated ZIP responses may be cached opportunistically in CacheStorage for up to 30 minutes (never beyond the stash expiry) and reused for the same exact selection. Cache eviction or quota failure simply falls back to regenerating the ZIP.
- Native Web Share API support (iOS share sheet / Android share sheet), with clipboard fallback.
- Optional password-derived share links (lock icon in the password field).
- Per-share **Allow Download** control, enabled by default; preview-only shares hide the download action and reject explicit attachment/ZIP requests server-side.
- Light, dark, and system-aware presentation.
- Hamburger app menu with a single persistent dark-mode toggle and a reserved Settings slot for future configurables.
- Responsive, touch-friendly UI.
- Native file picker on mobile; drag-and-drop upload is enabled only for desktop-style fine-pointer/hover devices.
- Favicon and 180×180 Apple touch icon.
- Automatic expiry cleanup plus expiry enforcement on every access.
- Can run standalone or mount under another Express app (e.g. main-server at `/mustash`).
- Playwright E2E coverage for desktop and mobile Chromium, run in GitHub Actions.

## Supported file types

MuStash currently accepts:

- Images: JPEG, PNG, GIF, WebP, AVIF
- Video: MP4, WebM
- Audio: MP3, WAV, OGG, M4A/MP4 audio, AAC, FLAC
- Documents: PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP
- UTF-8 text: TXT, CSV, Markdown (`.md` / `.markdown`), JSON

HTML and SVG are intentionally not accepted as upload formats.

## Security model

MuStash intentionally does **not** trust filenames or browser-provided MIME types for binary files.

- Binary file type is detected from file contents with `file-type` independently for every uploaded file.
- Only an allowlist of image/audio/video/document formats is accepted.
- Plain-text formats use a small extension allowlist **plus** streaming UTF-8 validation and rejection of binary control characters.
- Uploaded text is always served using an explicit non-executable text/JSON MIME type together with `X-Content-Type-Options: nosniff`; text content is never inserted into MuStash's page as HTML.
- Uploaded files receive server-generated UUID filenames; original filenames and stash names are display metadata only.
- Per-file size, aggregate stash size, file count, and TTL are server-side bounded. A `Content-Length` pre-check rejects clearly oversized multipart requests early, and the authoritative aggregate size is checked again from the uploaded file records before the stash is committed.
- A stash is committed only after every file passes validation. Failed uploads remove temporary/partially moved files rather than creating a partial stash.
- Multi-file ZIPs are generated with streaming DEFLATE directly from existing stash files to the response. MuStash does not persist derived ZIP archives on the server.
- Mobile CacheStorage ZIP reuse is a client-side performance optimization only. Cached ZIPs are origin-scoped, capped at 30 minutes or the stash expiry (whichever comes first), and may be evicted by the browser at any time.
- Helmet sets CSP and other security headers (`nosniff`, etc.). When served over plain HTTP (LAN / reverse proxy), HSTS and `upgrade-insecure-requests` are disabled so CSS/JS load correctly.
- Upload and unlock endpoints are rate-limited and reject cross-site browser POSTs. ZIP creation also rejects cross-site browser POSTs.
- Metadata files are written atomically.
- Protected content requires a short-lived, HttpOnly, SameSite authorization cookie before file content or ZIP downloads can be fetched. There are no user accounts or server-side sessions.

### Preview-only shares

When **Allow Download** is unchecked, MuStash stores `allowDownload: false` with the share and treats all files in the stash as preview-only:

- The recipient-facing Download button is removed.
- Requests using `?download=1` are rejected with HTTP `403`.
- Multi-file ZIP requests are rejected with HTTP `403`.
- Content endpoints use `Content-Disposition: inline` and `Cache-Control: no-store`.
- The viewer disables media dragging and suppresses the media context menu.
- Audio/video elements request browser controls that omit download and remote-playback actions, and disable Picture-in-Picture / remote playback where the browser exposes those controls.
- Mobile touch-callout and image dragging are suppressed where supported.
- PDF/text previews use the browser's native document rendering; Office/OpenDocument formats that lack a native browser preview show a document placeholder when downloads are disabled.

These controls are **deterrents, not DRM**. A browser must receive file bytes in order to preview them, so a determined recipient can still recover those bytes using developer tools, network inspection, browser internals, or a custom client. Web pages also cannot reliably prevent operating-system screenshots or screen recording. Browser-native PDF/document viewers may expose capabilities that MuStash cannot fully suppress.

### Password-protected links

The raw password never leaves the browser.

1. The browser generates a random per-share salt.
2. PBKDF2-SHA-256 derives a 256-bit access key from the password.
3. Only that derived key is sent during upload; the server stores a salted `scrypt` verifier of it.
4. The generated share URL carries the derived key in the URL **fragment** (`#k=...`). URL fragments are not sent to the server in HTTP requests.
5. The share page uses the fragment key to unlock the stash and receive a short-lived HttpOnly cookie.
6. If the fragment is removed, a recipient can enter the original password and derive the same key locally.

**Important:** a full protected URL is a bearer link. Anyone who obtains the entire URL, including its fragment key, can unlock that share without knowing the password. If you want the password to function as a separate factor, send a fragment-free URL and communicate the password separately.

## Run locally

Requirements: Node.js 22+.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

For production, prefer an explicit secret of at least 32 characters:

```bash
MUSTASH_SECRET='replace-with-a-long-random-secret' NODE_ENV=production npm start
```

If `MUSTASH_SECRET` is unset, MuStash persists a generated secret under `DATA_DIR/.mustash-secret` so unlock cookies stay valid across restarts.

## Mount under main-server

MuStash can be mounted as an Express sub-app (same pattern as other sibling apps):

1. Ensure `server.cjs` is present (CommonJS bridge that loads `createApp()` from `server.mjs`).
2. In main-server: `app.use('/mustash', mountedAppEnabledGate('/mustash'), require('../mustash/server.cjs'))`.
3. Run `npm install` in the mustash directory.
4. Frontend assets and API calls use relative paths so they resolve under `/mustash/`. Visiting `/mustash` redirects to `/mustash/`.

Standalone `npm start` / Docker still work unchanged.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP listen port (standalone only) |
| `DATA_DIR` | `./data` | Persistent metadata + upload directory |
| `MAX_FILE_MB` | `100` | Maximum size of any individual file |
| `MAX_STASH_MB` | value of `MAX_FILE_MB` | Maximum combined file bytes in one stash |
| `MAX_FILES_PER_STASH` | `25` | Maximum number of files in one stash |
| `MAX_TTL_HOURS` | `168` | Maximum share lifetime (7 days) |
| `MUSTASH_SECRET` | file under `DATA_DIR` if unset | HMAC secret for short-lived unlock cookies |
| `TRUST_PROXY` | unset (`1` when loaded via `server.cjs`) | Set to `1` behind a single trusted reverse proxy |

A reverse proxy or hosting platform can impose a lower request-body limit than MuStash. Configure that limit slightly above `MAX_STASH_MB` so multipart framing has room while MuStash remains the authoritative file-byte cap.

## Docker

```bash
docker build -t mustash .
docker run --rm -p 3000:3000 \
  -e MUSTASH_SECRET='replace-with-a-long-random-secret' \
  -v mustash-data:/app/data \
  mustash
```

Use HTTPS in production when exposed publicly. Put MuStash behind a reverse proxy that enforces TLS and sensible request/body limits.

## Tests

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

CI runs the same suite against desktop Chromium and a Pixel 7 mobile profile. The suite covers single- and multi-file uploads/previews, named stashes, removable pre-upload selections, recipient share layout, selective downloads and streamed ZIP responses, mobile ZIP CacheStorage reuse, password-protected shares, supported text/PDF/DOCX documents, server-side active-content rejection, Allow Download defaults, preview-only server enforcement and browser deterrents, desktop-only drag/drop behavior, menu behavior, the future Settings placeholder, TTL steppers, TTL select-on-focus, settings-grid layout, password-field lock icon, and persisted appearance preferences.

## Storage lifecycle

Each stash has one metadata JSON record and one or more opaque files under `DATA_DIR`. Expired files are removed by a 15-minute cleanup job, and every metadata/content/download request also checks expiration so an expired stash becomes inaccessible immediately even before cleanup runs. Derived ZIP archives are streamed and never persisted server-side.

## Release notes

See [`RELEASE_NOTES.md`](RELEASE_NOTES.md).
