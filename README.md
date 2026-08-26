# MuStash

**MuStash** is a tiny, self-hosted temporary media share: upload a file, choose how long it should live, optionally protect it with a password, then send the generated link.

The name is both a nod to a **mustache** and to **µ (micro) + stash** — a small place to put something for a little while.

## Features

- Temporary server-side storage with a 24-hour default expiration.
- Custom expiration from 15 minutes up to 7 days by default, with on-page TTL steppers.
- Image, video, and audio previews on desktop and mobile.
- Native Web Share API support (iOS share sheet / Android share sheet), with clipboard fallback.
- Optional password-derived share links (lock icon in the password field).
- Per-share **Allow Download** control, enabled by default; preview-only shares hide the download action and reject explicit attachment requests server-side.
- Light, dark, and system-aware presentation.
- Hamburger app menu with a single persistent dark-mode toggle and a reserved Settings slot for future configurables.
- Responsive, touch-friendly UI.
- Native file picker on mobile; drag-and-drop upload is enabled only for desktop-style fine-pointer/hover devices.
- Favicon and 180×180 Apple touch icon.
- Automatic expiry cleanup plus expiry enforcement on every access.
- Can run standalone or mount under another Express app (e.g. main-server at `/mustash`).
- Playwright E2E coverage for desktop and mobile Chromium, run in GitHub Actions.

## Security model

MuStash intentionally does **not** trust filenames or browser-provided MIME types.

- Actual file type is detected from file contents with `file-type`.
- Only an allowlist of common image/audio/video formats is accepted. HTML and SVG are rejected.
- Uploaded files receive server-generated UUID filenames; the original filename is display metadata only.
- Upload size and TTL are server-side bounded.
- Helmet sets CSP and other security headers (`nosniff`, etc.). When served over plain HTTP (LAN / reverse proxy), HSTS and `upgrade-insecure-requests` are disabled so CSS/JS load correctly.
- Upload and unlock endpoints are rate-limited and reject cross-site browser POSTs.
- Metadata files are written atomically.
- Protected content requires a short-lived, HttpOnly, SameSite authorization cookie before media can be fetched. There are no user accounts or server-side sessions.

### Preview-only shares

When **Allow Download** is unchecked, MuStash stores `allowDownload: false` with the share and treats the media as preview-only:

- The recipient-facing Download button is removed.
- Requests using `?download=1` are rejected with HTTP `403`.
- The content endpoint uses `Content-Disposition: inline` and `Cache-Control: no-store`.
- The viewer disables media dragging and suppresses the media context menu.
- Audio/video elements request browser controls that omit download and remote-playback actions, and disable Picture-in-Picture / remote playback where the browser exposes those controls.
- Mobile touch-callout and image dragging are suppressed where supported.

These controls are **deterrents, not DRM**. A browser must receive media bytes in order to preview them, so a determined recipient can still recover those bytes using developer tools, network inspection, browser internals, or a custom client. Web pages also cannot reliably prevent operating-system screenshots or screen recording.

### Guard Lab

An experimental sensor test page is available at `/testlab/` when MuStash runs standalone, or `/mustash/testlab/` when mounted under main-server.

The Guard Lab is intentionally isolated from normal share behavior. It is used to test whether physical volume-button presses can be inferred quickly enough from browser-visible side channels to trigger a black capture guard. It currently measures:

- high-frequency carrier-amplitude changes through the speaker-to-microphone path,
- sudden broadband microphone-energy transients,
- device-motion impulses,
- any `AudioVolumeUp` / `AudioVolumeDown` style key event a browser happens to expose,
- timing from detector trigger to guard class application and the next animation frame.

Starting the sensor test may require microphone permission and, on iOS, motion permission. Microphone samples are processed locally with an `AudioWorklet`; MuStash does not upload or store them. The lab also includes a permission-free manual black-guard button so compositor behavior can be tested separately from sensor detection.

Results are expected to vary by phone, browser, hardware volume level, microphone processing, and environment. The Guard Lab is experimental instrumentation, not production screenshot protection.

### Password-protected links

The raw password never leaves the browser.

1. The browser generates a random per-share salt.
2. PBKDF2-SHA-256 derives a 256-bit access key from the password.
3. Only that derived key is sent during upload; the server stores a salted `scrypt` verifier of it.
4. The generated share URL carries the derived key in the URL **fragment** (`#k=...`). URL fragments are not sent to the server in HTTP requests.
5. The share page uses the fragment key to unlock the file and receive a short-lived HttpOnly cookie.
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
| `MAX_FILE_MB` | `100` | Per-file upload limit |
| `MAX_TTL_HOURS` | `168` | Maximum share lifetime (7 days) |
| `MUSTASH_SECRET` | file under `DATA_DIR` if unset | HMAC secret for short-lived unlock cookies |
| `TRUST_PROXY` | unset (`1` when loaded via `server.cjs`) | Set to `1` behind a single trusted reverse proxy |

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

CI runs the same suite against desktop Chromium and a Pixel 7 mobile profile. The suite covers uploads/previews, password-protected shares, server-side unsupported-file rejection, Allow Download defaults, preview-only server enforcement and browser deterrents, desktop-only drag/drop behavior, menu behavior, the future Settings placeholder, TTL steppers, password-field lock icon, persisted appearance preferences, and Guard Lab route/manual-overlay behavior.

## Storage lifecycle

Each share has one metadata JSON record and one opaque media file under `DATA_DIR`. Expired files are removed by a 15-minute cleanup job, and every metadata/content request also checks expiration so an expired share becomes inaccessible immediately even before cleanup runs.

## Release notes

See [`RELEASE_NOTES.md`](RELEASE_NOTES.md).
