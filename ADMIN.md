# MuStash admin portal

The admin portal is disabled unless `MUSTASH_ADMIN_PASSWORD` is configured with at least 12 characters.

When MuStash is mounted at `/mustash`, open:

```text
/mustash/admin/
```

For standalone `npm start`, open:

```text
/admin/
```

Example:

```bash
MUSTASH_ADMIN_PASSWORD='replace-with-a-long-unique-password' npm start
```

The portal lists currently active stashes and their files, aggregate size, creation and expiry times, protection state, and download policy. An authenticated administrator can rename a stash, change its expiry within `MAX_TTL_HOURS`, toggle Allow Download, open its recipient preview, or delete the stash and all stored files immediately.

Multiple stashes can also be selected for batch management. The **Select visible** control selects the current filtered result set, while individual stash checkboxes can build a custom selection. Batch actions can enable downloads, switch selected stashes to preview-only, set one expiry across the selection, or delete the selected stashes and their stored files.

Security behavior:

- Admin access is disabled entirely when `MUSTASH_ADMIN_PASSWORD` is unset or shorter than 12 characters.
- Login attempts are rate-limited.
- The configured password is compared using constant-time SHA-256 digests and is never written to disk.
- Successful login creates an HttpOnly, SameSite=Strict admin cookie scoped to the MuStash mount path and valid for up to 8 hours. Production cookies are also marked Secure.
- Admin mutation endpoints require the authenticated cookie and reject cross-site browser requests.
- Admin responses are sent with no-store caching.
- Stash access passwords/derived keys are never exposed in the portal. Opening a protected recipient preview still requires that stash's password or bearer fragment key.
