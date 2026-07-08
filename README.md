<div align="center">

# TERMINAL//NG

### Cyberpunk SSH cyberdeck for Linux operators

An advanced, gorgeous **web SSH terminal** that renders live visual parsers as you work, ships an
**AI copilot** (Claude / Gemini / OpenAI / local models), an **SFTP file browser**, a built-in
**code editor**, a **web browser** (proxy *or* over the SSH connection), a **health dashboard**,
destructive-command protection, themes, and a synth soundtrack — all in one screen.

Vite + React frontend · Node (Express + `ws` + `ssh2`) backend · JWT auth · zero external services required.

</div>

---

## ✨ Highlights

### Real SSH terminal
- xterm.js over a WebSocket to an `ssh2` PTY (resize, keepalive, reconnect). Password **or** SSH-key auth.
- Per-user **host vault** — Quick Connect for an instant session, or save hosts (label/color, optional stored password) for later.
- Multiple windows & tabs, drag-to-move tabs, grid/stack/cascade layouts.

### Live diagnostic parsers (the "Diag" panel)
Run a command and a visual panel appears automatically — no need to remember flags:

| Category | Commands |
|---|---|
| Network | `ss`/`netstat`, `ip addr`/`route`, `iptables`/`nft` |
| Performance | `ps`/`top`, `free`, **`vmstat`/`iostat`/`mpstat` → live sparklines** |
| Logs | `journalctl`, `dmesg`, web access/error logs, `auth.log`, `syslog` — with a **severity chart** (FATAL/ERROR/WARN/…) and highlighted lines; **`tail -f` parses live** |
| Disk & services | `df`/`lsblk`/`fdisk`/LVM, `du`, `smartctl`, `systemctl`, `systemd-analyze` |
| Files | `ls`/`ls -la` → table with **clickable `.conf`/`.yaml`/`.toml`… files that open the editor** |

Extras: **error hints** (permission denied, disk full, port in use, DNS…) that point at the exact
offending parameter you typed, **exit-code translation** (137 = OOM, 143 = SIGTERM…), and a
**config helper** that shows the default value + description of the directive under your cursor while
editing `sshd_config`, `nginx`, `fstab`, `sysctl`, `postgresql.conf`, `haproxy`, `netplan`,
`docker-compose`, `.env`, `crontab` (cron → plain language + next runs) and more.

### 🩺 One-click Health check
Runs a read-only battery (uptime/load vs cores, RAM/swap, disk, failed services, top processes, listening ports)
**in a background SSH channel** — the terminal stays free — and shows a consolidated status panel.

### 🛡️ Destructive-command protection
Type `rm -rf /etc`, `mkfs`, `dd of=/dev/sda`, a fork bomb, `chmod -R 777 /`… and a **confirmation modal**
appears **before** it runs. Routine `rm -rf node_modules` / `/tmp/...` is *not* blocked. Toggle in Settings.

### 🤖 AI copilot — bring your own model
- **Providers:** Anthropic **Claude**, Google **Gemini**, **OpenAI**, plus any OpenAI-compatible API
  (**Groq, OpenRouter, DeepSeek, Mistral, Ollama (local), Custom**). Or log in with **ChatGPT (Codex OAuth)**.
- Configure provider/key/model in **Settings → IA** (Save & test). The active provider is shown in the panel.
- **Chat** grounded in recent terminal output · **Auto-Pilot (⚡)** explains every command *only when enabled*
  · **Agent mode** runs read-only diagnostics toward a goal and reports findings + fixes, with safety block levels + audit trail.
- Works **offline** (heuristics) out of the box.

### 📂 SFTP file browser + editor
Over the same SSH session: browse, **drag-and-drop upload**, download, mkdir, rename, delete (recursive),
a **visual `chmod` editor**, and an inline **text editor** (line numbers, search, find/replace, copy/cut/paste,
Ctrl+S). Automatic **`sudo` fallback** for reading/writing root-owned files when the shell is elevated.

### 🌐 Web browser window
Browse inside the app via a backend proxy that strips iframe-blocking headers — **or over the SSH connection**
(`curl` from the remote host) to reach dashboards only the server can see. Address bar/search, back/forward,
history, quick links, and a **session picker** when multiple hosts are connected.

### 🎨 Polish
- **20 themes** incl. a **light** one (Dracula, Nord, Gruvbox, Tokyo Night, Monokai, Daylight…).
- Fully **synthesized** SFX + a **looping soundtrack** (Synthwave on the login screen → Lo-Fi Chill in the background after login, with a crossfade). 5 selectable tracks.
- **Sounds / Animations** toggles, multilingual UI (EN / PT-BR / ES / 中文), mobile layout with voice input.

---

## 🚀 Quick start (recommended — single origin, bulletproof WebSocket)
```bash
cp .env.example .env        # generate strong secrets (see below) and edit
npm install
npm start                   # builds the UI and serves everything on ONE port (:3001)
```
Open **http://localhost:3001** and log in with the seeded admin. UI, REST API and the SSH
WebSocket share one port, so there's no dev-proxy / IPv4-IPv6 mismatch to break the terminal.

Generate strong secrets for `.env`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 🔧 Dev mode (hot reload)
```bash
npm run dev                 # backend (:3001) + Vite dev server (:5173)
```
Open http://localhost:5173. Vite proxies `/api` and `/ws` to the backend, so the app runs
single-origin and the session cookie works the same as in production.

### Scripts
- `npm start` / `npm run serve` — build UI + serve single-origin on :3001 (recommended)
- `npm run dev` — backend + Vite dev server with hot reload
- `npm run server` — backend only (serves an existing `dist/` build)
- `npm run build` / `npm run preview` — Vite production build + preview

## ⚙️ Configuration (`.env`)
In **production** (`NODE_ENV=production`) the backend **refuses to start** unless the three
secrets below are present and strong — this prevents shipping with `admin`/`admin` or a
forgeable token secret by accident.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` (default) or `production` (enforces the checks below). |
| `JWT_SECRET` | **Required (≥32 chars) in prod.** Signs the session JWT. |
| `TNG_ENC_KEY` | **Required (≥32 chars) in prod.** Encrypts secrets at rest (SSH passwords, OAuth tokens, API keys). Changing it makes already-saved secrets unreadable. |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Seed admin on first boot. In prod the password must be ≥12 chars and not `admin`. |
| `TNG_ALLOWED_ORIGINS` | CORS allow-list for prod (comma-separated). Empty = localhost only. |
| `PORT` | Backend/app port (default `3001`). |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` | Optional env fallback for the AI provider. |

AI is best configured **per-user in the UI** (Settings → IA); keys are stored (encrypted) in the
user profile and never re-displayed. The remote host needs `curl` for SSH-mode browsing and
standard tools (`uptime`, `free`, `df`, `ps`) for the health check.

## 🔒 Security
This project handles SSH credentials, so it ships hardened by default. See
[`SECURITY-REVIEW.md`](./SECURITY-REVIEW.md) for the full review.

- **Sessions in an HttpOnly cookie** — the JWT is never kept in `localStorage`, so an XSS can't steal it.
- **Secrets encrypted at rest** — saved SSH passwords, ChatGPT OAuth tokens and AI API keys are AES-256-GCM encrypted (`TNG_ENC_KEY`). Storing an SSH password is still **off by default**.
- **SSH host-key verification (TOFU)** — trusts the server key on first connect and refuses if it later changes (MITM defense).
- **Anti-SSRF** — the web proxy and SSH-fetch block internal targets (loopback, private ranges, cloud metadata `169.254.169.254`).
- **Hardened HTTP** — Content-Security-Policy on, CORS restricted, login rate-limited (10 / 15 min per IP), minimum 12-char passwords.
- The AI Auto-Pilot only sends command output to your configured model **when you turn it on**.

> **Before publishing / deploying:** never commit `server/data/` or `.env` (both are git-ignored),
> and don't ship `build.zip` / the `.exe` in the source repo.

## 🧱 Tech stack
Frontend: **React 18 + Vite + Tailwind-style CSS + framer-motion + xterm.js + lucide-react**.
Backend: **Node + Express + ws + ssh2 + jsonwebtoken**. No database — small JSON tables under `server/data/`.

## 📁 Layout
```
server/    Express API, SSH WebSocket service, SFTP, web proxy, AI, auth
src/       React app: terminal, parsers/overlays, file browser, editor, browser, AI panel, settings
src/utils/ command parsers, danger check, config helper, cron, SFTP helpers
```

## 📄 License

Released under the [MIT License](./LICENSE) — free to use, modify and distribute, with no warranty.

---

<div align="center">
Built for people who live in the terminal. PRs welcome.
</div>
