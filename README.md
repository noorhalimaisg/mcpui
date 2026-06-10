# MCP Manager for Claude Desktop

A cross-platform desktop tool (macOS + Windows + Linux) to **add, edit, and delete
MCP server endpoints** in Claude Desktop's configuration — safely.

Built with **Electron** and packaged with **electron-builder**.

> Replace `<github_username>` and `<repo_name>` below with your real values.

---

## What it does

- **Auto-locates** `claude_desktop_config.json` on any OS, including both Windows
  install types. It checks a list of candidate paths and uses the first that
  exists (or the most likely creation target):
  - macOS — `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Linux — `~/.config/Claude/claude_desktop_config.json`
  - Windows (`.exe` installer) — `%APPDATA%\Claude\claude_desktop_config.json`
  - Windows (**Microsoft Store / MSIX**) — `%LOCALAPPDATA%\Packages\Claude_<hash>\LocalCache\Roaming\Claude\claude_desktop_config.json`
    (the Store build sandboxes `%APPDATA%`; the `Claude_*` package hash is matched automatically)
- If your install lives somewhere unusual, use **Choose file…** to point the tool
  at the exact `claude_desktop_config.json`.
- Lists your existing `mcpServers` as editable cards (the on-disk object is
  converted to an array internally for stable ordering).
- Add / edit / delete servers with editors for **command**, **args** (one per
  line), and **env** (`KEY=VALUE` per line).

## Safety guarantees (by design)

This tool **only ever reads and writes the `mcpServers` key**. Everything else is protected:

1. **Other top-level keys are preserved.** Your `coworkUserFilesPath`,
   `preferences`, and any other settings are never modified. On save the tool
   re-reads the current file, swaps in only `mcpServers`, and writes everything
   else back exactly as it was.
2. **Unknown per-server fields are preserved.** If a server entry has fields the
   editor doesn't expose (e.g. `type`, `url`, `cwd`, `disabled`), they're kept in
   an `extra` bucket and re-attached on save.
3. **Automatic backup.** Before every save, a timestamped
   `claude_desktop_config.json.backup-<time>` is written next to the original.
4. **Atomic writes.** Saves go to a temp file and are then renamed over the
   original, so a crash mid-write can't corrupt your config.
5. **Refuses to clobber.** If the existing file isn't valid JSON, the tool
   errors instead of overwriting it.

> After saving, **restart Claude Desktop** for changes to take effect.

---

## Develop locally

Requires [Node.js](https://nodejs.org/) (LTS).

```bash
npm install      # first time only
npm start        # launches the app
```

## Build installers locally

```bash
npm run dist     # builds for your current OS into dist/
```

- On **macOS** this produces a `.dmg` (universal: Intel + Apple Silicon).
- On **Windows** this produces an `.exe` installer (NSIS).

> You can only build a macOS `.dmg` on macOS, and the `.exe` is easiest on
> Windows. That's why we use CI (below) to build both automatically.

---

## Automated builds (GitHub Actions)

The workflow at `.github/workflows/build.yml` builds **both** installers using
GitHub's cloud runners — you don't need a second computer.

- Push to `main` → builds `.dmg` (on a `macos-latest` runner) and `.exe` (on a
  `windows-latest` runner). Download them from the **Actions** run → *Artifacts*.
- Push a tag like `v1.0.0` → also publishes the installers to a **GitHub Release**.

```bash
git init
git add .
git commit -m "MCP Manager for Claude Desktop"
git branch -M main
git remote add origin https://github.com/<github_username>/<repo_name>.git
git push -u origin main

# later, to cut a release:
git tag v1.0.0
git push origin v1.0.0
```

Builds are currently **unsigned** (auto-signing is disabled in CI). Users will
see an "unidentified developer" (macOS) or SmartScreen (Windows) warning until
code signing certificates are added — see below.

---

## Roadmap: code signing

For distribution without warnings:

- **macOS** — Apple Developer account; sign + notarize. Add the certificate and
  notarization credentials as GitHub encrypted secrets and re-enable signing.
- **Windows** — a code-signing certificate from a CA.

---

## Project structure

```
<repo_name>/
├── .github/workflows/build.yml   # CI: builds .dmg + .exe (+ AppImage)
├── src/
│   ├── main.js                   # Main process: locate, read, save (safe merge)
│   ├── preload.js                # Secure contextBridge API
│   ├── index.html                # UI markup
│   ├── styles.css                # UI styling
│   └── renderer.js               # UI logic (list/add/edit/delete)
├── package.json                  # scripts + electron-builder config
└── .gitignore
```

## Security model

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true`. It has **no direct filesystem access** — it can only call the
small set of vetted IPC channels exposed in `preload.js`.
