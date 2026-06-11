# MCP Catalog

A WordPress plugin by **AI Singapore — Platform Engineering** that publishes a
public, read-only catalog of MCP (Model Context Protocol) servers via a REST
endpoint, plus an admin UI to manage the catalog entries.

The catalog is consumed by the **MCP Manager** desktop app, which lets users
browse and add MCP servers to Claude Desktop.

- **Version:** 1.2.0
- **Author:** Halim, Platform Engineering — AI Singapore
- **License:** GPL-2.0-or-later
- **Text Domain:** `mcp-catalog`

---

## Installation

1. Zip the `mcp-catalog-plugin` folder (the folder that contains
   `mcp-catalog.php`). See [Packaging](#packaging) below.
2. In wp-admin, go to **Plugins → Add New → Upload Plugin**, choose the ZIP, and
   click **Install Now**.
3. Click **Activate**.
4. Activation flushes rewrite rules automatically so the REST route resolves
   immediately. (If you ever copy the folder in manually rather than via the
   uploader, just visit **Settings → Permalinks** once and click **Save** to
   flush rewrite rules.)

> Requires WordPress 5.6+ and PHP 7.4+.

---

## Adding catalog items in wp-admin

1. In the admin sidebar, open **MCP Catalog → Add New**.
2. Fill in the fields:

   | Field | Maps to JSON key | Notes |
   |-------|------------------|-------|
   | **Title** (post title) | `title` | Human display name, e.g. "AI Singapore Shortener". |
   | **Editor content** | `description` | Plain description text. |
   | **Name / slug** | `name` | Lowercase, hyphenated server key. Unique across entries. Auto-suggested from the title if left blank. |
   | **Author** | `author` | e.g. "Halim, Platform Engineering". |
   | **Icon URL** | `icon` | Use the media uploader **Select / Upload** button, or paste an absolute image URL. Leave blank for `""`. |
   | **Command** | `command` | Defaults to `npx` if blank. |
   | **Args (one per line)** | `args` | One argument per line. Use the literal placeholder `{token}` where the user's token goes. |
   | **Requires token** | `requiresToken` | Checkbox → JSON boolean. |
   | **Token hint** | `tokenHint` | Short hint, e.g. "Your aisg.sg API key". |

3. Click **Publish**. Only **published** entries appear in the endpoint — drafts
   are skipped.

**Do not paste real tokens.** Use the `{token}` placeholder in `args`; the
desktop app substitutes the user's token at runtime.

---

## REST endpoint

```
GET https://<site>/wp-json/mcp-catalog/v1/catalog
```

- Public, read-only (`permission_callback` returns `true`).
- Returns a JSON **array** (not an object) of catalog entries.
- `Content-Type: application/json`.

### Sample curl

```bash
curl -s https://aisingapore.org/wp-json/mcp-catalog/v1/catalog
```

### Sample JSON response

```json
[
  {
    "name": "ai-singapore-shortener",
    "title": "AI Singapore Shortener",
    "description": "Shorten and manage links via the AI Singapore URL shortener API.",
    "author": "Halim, Platform Engineering",
    "icon": "https://example.org/wp-content/uploads/icon.png",
    "command": "npx",
    "args": ["mcp-remote", "https://aisg.sg/api/v1/mcp", "--header", "Authorization: Bearer {token}"],
    "requiresToken": true,
    "tokenHint": "Your aisg.sg API key"
  }
]
```

Field guarantees:

- `args` always serializes as a JSON array of strings (empty `[]` if none).
- `requiresToken` is always a real JSON boolean.
- `command` is never empty (`"npx"` fallback).
- `name` is unique across the array; duplicates after the first are dropped.

---

## Managed access (allowlist + OTP login)

As of 1.2.0 the catalog can also be **managed remotely** by trusted people
(e.g. from the MCP Manager desktop app) without giving them wp-admin accounts.
Access is governed by an email **allowlist** and a passwordless **one-time-code
(OTP)** login that mints a short-lived session token.

WordPress administrators continue to manage the catalog directly in wp-admin
regardless of the allowlist.

### Manage Access admin page

**MCP Catalog → Manage Access** (capability: `manage_options`).

- A textarea, one email per line, edited and saved via a nonce-protected
  `admin-post` form.
- On save each line is run through `sanitize_email()` + `is_email()`; invalid
  entries are dropped, duplicates merged, addresses lowercased.
- Stored in the option `aisg_mcp_catalog_allowlist` (array of lowercased emails).
- Helper: `AISG_MCP_Catalog_Auth::is_allowed( $email )`.

### OTP login flow

```
POST /wp-json/mcp-catalog/v1/auth/request-otp     { "email": "alice@aisingapore.org" }
POST /wp-json/mcp-catalog/v1/auth/verify-otp      { "email": "...", "otp": "123456" }
POST /wp-json/mcp-catalog/v1/auth/logout          (Authorization: Bearer <token>)
```

1. **request-otp** (public). If the email is on the allowlist, a 6-digit code is
   generated, stored **hashed** in a 10-minute transient
   (`mcpcat_otp_<md5(email)>`) with an attempt counter, and emailed via
   `wp_mail()` (subject *"Your MCP Catalog verification code"*). Responds
   `200 { "allowed": true, "sent": true }`. If the email is **not** allowlisted,
   responds `200 { "allowed": false, "sent": false }` (no email sent).
   Rate-limited to **5 requests per email per 15 minutes**; over the limit
   returns `429 { "error": "rate_limited" }`.
2. **verify-otp** (public). Validates the code against the stored hash, enforcing
   ≤ 5 attempts and the 10-minute expiry; the code is **single-use** (deleted on
   success). On success creates a 64-char session token stored in
   `mcpcat_sess_<token>` ⇒ email with a **2-hour** TTL and responds
   `200 { "ok": true, "token": "<token>", "email": "...", "expiresIn": 7200 }`.
   On failure responds `401 { "ok": false, "error": "invalid_or_expired" }`.
3. **logout** (Bearer token). Deletes the session transient; responds
   `200 { "ok": true }`.

`AISG_MCP_Catalog_Auth::current_email_for_request()` resolves a request's
`Authorization: Bearer <token>` to an email only if the session is valid **and**
the email is *still* on the allowlist — this is the basis for every management
endpoint's `permission_callback` (returns `WP_Error` 401 when null).

---

## Management REST endpoints (CRUD)

All require a valid Bearer session token (see above). Namespace `mcp-catalog/v1`.
Entry shape matches the public schema **plus an `id`**:
`{ id, name, title, description, author, icon, command, args (string[]), requiresToken (bool), tokenHint }`.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/manage/catalog` | `{ "ok": true, "items": [ … ] }` — **all** entries incl. drafts, each with its post `id`. |
| `POST` | `/manage/catalog` | Body = entry fields (no `id`). Creates a **published** entry. Returns `201 { "ok": true, "item": {…} }`. |
| `PUT` | `/manage/catalog/<id>` | Updates title/description/meta from the body. Returns `200 { "ok": true, "item": {…} }`. |
| `DELETE` | `/manage/catalog/<id>` | Permanently deletes the entry (`wp_delete_post($id, true)`). Returns `200 { "ok": true }`. |

- `args` is sent/received as a JSON array of strings; internally stored in the
  same one-per-line meta format the public endpoint reads.
- Inputs sanitized: `sanitize_text_field` (name/title/author/command/tokenHint),
  `esc_url_raw` (icon), `sanitize_textarea_field` (description), bool cast
  (requiresToken), each `args` element as text.
- `<id>` is validated as an `mcp_catalog` post; otherwise `404 { "ok": false,
  "error": "not_found" }`.

### Sample curl (management)

```bash
# 1. Request a code
curl -s -X POST https://<site>/wp-json/mcp-catalog/v1/auth/request-otp \
  -H 'Content-Type: application/json' -d '{"email":"alice@aisingapore.org"}'

# 2. Verify and capture the token
curl -s -X POST https://<site>/wp-json/mcp-catalog/v1/auth/verify-otp \
  -H 'Content-Type: application/json' -d '{"email":"alice@aisingapore.org","otp":"123456"}'

# 3. Create an entry
curl -s -X POST https://<site>/wp-json/mcp-catalog/v1/manage/catalog \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Example","description":"…","name":"example","command":"npx","args":["mcp-remote","https://aisg.sg/api/v1/mcp"],"requiresToken":true,"tokenHint":"Your aisg.sg API key"}'
```

---

## History & Rollback admin page

**MCP Catalog → History & Rollback** (capability: `manage_options`).

- **Change log** — a table of the most recent create/update/delete/restore
  actions: time (UTC), actor email, action, entry. Stored newest-first in option
  `aisg_mcp_catalog_log` (capped at 200 entries).
- **Snapshots** — every successful mutation also saves a full snapshot of the
  entire catalog into option `aisg_mcp_catalog_snapshots` (newest-first, only the
  latest **15** kept). Each snapshot lists time, actor, triggering action, and
  entry count, with a nonce-protected **Restore** button.
- **Restore** replaces ALL current `mcp_catalog` entries with the snapshot's
  entries (delete current → recreate from snapshot) and logs a `restore` action.
  The pre-restore state is captured as a fresh snapshot first, so a restore is
  itself reversible.

---

## Extensibility (hooks)

| Hook | Type | Description |
|------|------|-------------|
| `aisg_mcp_catalog_cpt_args` | filter | Adjust `register_post_type` args. |
| `aisg_mcp_catalog_entry` | filter | Modify a single entry array (`$entry`, `$post`). |
| `aisg_mcp_catalog_entries` | filter | Modify the full entries array before output. |

---

## Packaging

From the parent directory of the plugin folder:

```bash
zip -r mcp-catalog.zip mcp-catalog-plugin \
  -x "*.DS_Store" -x "*/.git/*" -x "*/__MACOSX/*"
```

The ZIP must contain the `mcp-catalog-plugin/` folder at its root so WordPress
installs it correctly.

---

## Uninstall

Deleting the plugin from wp-admin runs `uninstall.php`, which removes all
`mcp_catalog` posts and their `_aisg_mcp_*` meta, plus the options
`aisg_mcp_catalog_api_key`, `aisg_mcp_catalog_require_key`,
`aisg_mcp_catalog_allowlist`, `aisg_mcp_catalog_log`,
`aisg_mcp_catalog_snapshots`, and (best-effort) any leftover `mcpcat_otp_*` /
`mcpcat_sess_*` transients.

---

## Security notes

- Everything is prefixed (`aisg_mcp_catalog_` / meta keys `_aisg_mcp_*`) to avoid
  collisions.
- Inputs sanitized on save (`sanitize_text_field`, `esc_url_raw`,
  `sanitize_textarea_field`, `sanitize_title`); checkbox cast to bool.
- Outputs escaped in admin (`esc_attr`, `esc_html`, `esc_textarea`).
- Nonce-protected, capability-checked (`edit_post`) meta saves; admin pages
  (Manage Access, History & Rollback) are `manage_options`-gated with
  nonce-protected `admin-post` forms.
- Management REST endpoints require a valid Bearer session whose email is on the
  allowlist; OTPs are stored hashed, single-use, attempt-capped, and expiring,
  and OTP requests are rate-limited.
- REST inputs sanitized with the same functions as the meta saves above.
- The only outbound action is `wp_mail()` to deliver OTP codes.
