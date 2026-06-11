<div align="center">

<img src="build/icon.png" alt="MCP Manager" width="120" />

# MCP Manager

### The safe, effortless way to manage your Claude Desktop MCP servers.

Add, edit, and remove MCP endpoints through a clean native app —
no more hand-editing fragile JSON and hoping you didn't break anything.

**macOS · Windows · Linux**

[**⬇ Download the latest release**](https://github.com/noorhalimaisg/mcpui/releases)

</div>

---

## Why you'll want it

Claude Desktop stores its MCP servers in a `claude_desktop_config.json` file. Editing
it by hand is genuinely risky: one stray comma, a missing brace, or an accidentally
deleted setting and Claude Desktop silently stops loading your tools. Worse, the file
also holds *other* settings that have nothing to do with MCP — and a careless edit can
wipe them out.

**MCP Manager makes that whole problem disappear.** It gives you a focused, friendly
interface for exactly one job — managing your MCP endpoints — while guaranteeing it
never touches anything else.

## What makes it good

- **🛡️ It will not break your config.** The app reads and writes *only* the
  `mcpServers` section. Every other setting in your file is preserved exactly,
  down to the byte. Don't take our word for it — it's verified against real-world
  configs with dozens of servers.

- **💾 Every save is protected.** Before writing, it saves atomically
  (write-then-rename) so a crash mid-save can never leave you with a corrupted
  file. If your existing config isn't valid JSON, it refuses to overwrite rather
  than risk losing data.

- **⏪ One-click rollback.** The app keeps the **10 most recent versions** of your
  servers automatically. Made a change that broke a tool? Open the **Backups** tab
  and restore an earlier version in a single click — no manual file juggling.

- **🔍 It finds your config automatically.** No hunting through hidden folders. It
  detects the right file on every platform — including the tricky **Microsoft Store**
  build of Claude Desktop on Windows, which hides its config deep inside a sandboxed
  package folder.

- **🔒 Your tokens never leave your machine.** Everything happens locally. Your API
  keys and endpoints stay in your own config file — nothing is uploaded, tracked, or
  phoned home.

- **✨ It's genuinely pleasant to use.** A clean, modern interface: see all your
  servers at a glance, click to edit, and save with one button. Built-in FAQ and
  support tabs mean help is always a click away.

- **🆓 Free, open, and lightweight.** No account, no subscription, no telemetry.

## How it works

1. **Open the app** — it instantly finds and loads your Claude Desktop config.
2. **Manage your servers** — add a new endpoint, click any server to edit it, or
   remove ones you don't need. You see exactly what's there, including the endpoint
   URL and arguments.
3. **Save** — click **Save to Claude Desktop**. A backup is made automatically.
4. **Restart Claude Desktop** and your changes are live.

That's it. What used to be a nerve-wracking text-editing session is now three clicks.

## Get it

Download the installer for your platform from the
[**Releases page**](https://github.com/noorhalimaisg/mcpui/releases):

| Platform | File |
|----------|------|
| macOS    | `.dmg` (universal — Intel & Apple Silicon) |
| Windows  | `.exe` installer |
| Linux    | `.AppImage` |

> Builds are currently unsigned, so on first launch you may see an
> "unidentified developer" (macOS) or SmartScreen (Windows) prompt — choose to
> open/run anyway.

## Where your config lives

MCP Manager checks the right place automatically, but for reference:

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows (installer) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Windows (Microsoft Store) | `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Installed somewhere unusual? Use **Choose file…** in the app to point it at the exact file.

---

<div align="center">

Made by **AI Singapore**

</div>
