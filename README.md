# MuStash

**MuStash** is a tiny, self-hosted temporary media share: upload a file, choose how long it should live, optionally protect it with a password, then send the generated link.

The name is both a nod to a **mustache** and to **µ (micro) + stash** — a small place to put something for a little while.

## Features

- Temporary server-side storage with a 24-hour default expiration.
- Custom expiration from 15 minutes up to 7 days by default.
- Image, video, and audio previews on desktop and mobile.
- Native Web Share API support (iOS share sheet / Android share sheet), with clipboard fallback.
- Optional password-derived share links.
- Light, dark, and system-aware presentation.
- Hamburger app menu with a single persistent dark-mode toggle and a reserved Settings slot for future configurables.
- Responsive, touch-friendly UI.
- Native file picker on mobile; drag-and-drop upload is enabled only for desktop-style fine-pointer/hover devices.
- Favicon and 180×180 Apple touch icon.
- Automatic expiry cleanup plus expiry enforcement on every access.
- Playwright E2E coverage for desktop and mobile Chromium, run in GitHub Actions.

## Security model

MuStash intentionally does **not** trust filenames or browser-provided MIME types.

- Actual file type is detected from file contents with `file-type`.
- Only an allowlist of common image/audio/video formats is accepted. HTML and SVG are rejected.
- Uploaded files receive server-generated UUID filenames; the original filename is display metadata only.
- Upload size and TTL are server-side bounded.
- Helmet sets CSP and other security headers, including `nosniff` behavior.
- Upload and unlock endpoints are rate-limited and reject cross-site browser POSTs.
- Metadata files are written atomically.
- Protected content requires a short-lived, HttpOnly, SameSite authorization cookie before media can be fetched.

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

For production, set a stable secret of at least 32 characters:

```bash
MUSTASH_SECRET='replace-with-a-long-random-secret' NODE_ENV=production npm start
```

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP listen port |
| `DATA_DIR` | `./data` | Persistent metadata + upload directory |
| `MAX_FILE_MB` | `100` | Per-file upload limit |
| `MAX_TTL_HOURS` | `168` | Maximum share lifetime (7 days) |
| `MUSTASH_SECRET` | ephemeral in dev | HMAC secret for short-lived unlock cookies; required in production |
| `TRUST_PROXY` | unset | Set to `1` behind a single trusted reverse proxy |

## Docker

```bash
docker build -t mustash .
docker run --rm -p 3000:3000 \
  -e MUSTASH_SECRET='replace-with-a-long-random-secret' \
  -v mustash-data:/app/data \
  mustash
```

Use HTTPS in production. Put MuStash behind a reverse proxy that enforces TLS and sensible request/body limits.

## Tests

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

CI runs the same suite against desktop Chromium and a Pixel 7 mobile profile. The suite covers uploads/previews, password-protected shares, server-side unsupported-file rejection, desktop-only drag/drop behavior, menu behavior, the future Settings placeholder, and persisted appearance preferences.

## Storage lifecycle

Each share has one metadata JSON record and one opaque media file under `DATA_DIR`. Expired files are removed by a 15-minute cleanup job, and every metadata/content request also checks expiration so an expired share becomes inaccessible immediately even before cleanup runs.

## Release notes

See [`RELEASE_NOTES.md`](RELEASE_NOTES.md).
