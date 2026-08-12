#!/usr/bin/env bash
#
# install-server.sh — full server installation for Beatrice OSS
#
# Installs system dependencies and integrates the internal tool services
# (sandbox 5556, CLI 5557, browser 5558, computer 5559, coding agent 5560).
# The tool services are NOT separate processes to manage: server.ts starts
# all of them on boot; this script only provisions what they need to run.
#
# Usage:
#   sudo bash install-server.sh          # full install (Ubuntu/Debian; works as root too)
#   bash install-server.sh --skip-deps   # skip apt/playwright/opencode (e.g. re-run after code changes)
#   INSTALL_SYSTEMD=1 bash install-server.sh   # also create + enable a systemd unit
#
# Idempotent: safe to re-run.

set -euo pipefail

SKIP_DEPS="${1:-}"
if [ "$SKIP_DEPS" = "--skip-deps" ]; then SKIP_DEPS=1; else SKIP_DEPS=0; fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5555}"
APP_URL="${APP_URL:-https://oss.eburon.ai}"

log()  { printf '\033[1;32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m WARNING: %s\n' "$*"; }
die()  { printf '\033[1;31m[install]\033[0m ERROR: %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR"

# --- 0. Sanity checks -------------------------------------------------------
[ -f package.json ] || die "package.json not found in $APP_DIR — run this script from the repo root"

if ! command -v node >/dev/null 2>&1; then die "Node.js not found. Install Node 18+ first (e.g. https://nodejs.org)."; fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18+ required (found $(node --version))."

if [ "$SKIP_DEPS" = "0" ]; then
  # --- 1. System packages ---------------------------------------------------
  # build-essential, python3, libxtst-dev, libpng-dev: native builds for
  # node-pty (cliService) and robotjs (computerService) — npm install FAILS
  # without these on a fresh Ubuntu/Debian host.
  # ffmpeg: used by executeCodeSandbox/runCliCommand media workflows.
  log "Installing system packages (build tools, ffmpeg, X11 dev headers)..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y >/dev/null
    apt-get install -y --no-install-recommends \
      build-essential python3 ffmpeg curl ca-certificates \
      libxtst-dev libpng-dev >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    yum install -y gcc-c++ make python3 ffmpeg curl libXtst-devel libpng-devel >/dev/null
  else
    warn "No apt-get/yum found — install build-essential, python3, ffmpeg, libxtst-dev, libpng-dev manually"
  fi

  # --- 2. Browser service (browserService :5558, Playwright/Chromium) -------
  log "Installing headless Chromium for the browser service..."
  if npx --yes playwright install --with-deps chromium; then
    :
  else
    # --with-deps needs root; fall back to apt deps if running as non-root
    warn "--with-deps failed (may need sudo); retrying without system deps"
    npx --yes playwright install chromium
  fi

  # --- 3. Coding agent (codingAgentService :5560, OpenCode CLI) -------------
  # The service spawns OPENCODE_BIN (default /root/.opencode/bin/opencode).
  if [ -x /root/.opencode/bin/opencode ] || command -v opencode >/dev/null 2>&1; then
    log "OpenCode CLI already present."
  else
    log "Installing OpenCode CLI (official installer -> ~/.opencode/bin)..."
    curl -fsSL https://opencode.ai/install | bash
  fi
  # Optional: opencode Zen auth for the coding agent model
  #   /root/.opencode/bin/opencode auth login   (interactive, run once)

  # --- 4. Sandbox service deps (sandboxService :5556) -----------------------
  # JS/TS/HTML run in-process (vm); Python needs the interpreter:
  command -v python3 >/dev/null 2>&1 || warn "python3 not found — python sandbox executions will fail"
else
  log "Skipping system deps (--skip-deps)..."
fi

# --- 5. Environment ----------------------------------------------------------
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  log "Created .env.local from .env.example"
  warn "EDIT .env.local and set a real GEMINI_API_KEY (and DASHSCOPE_API_KEY). The placeholder 'MY_GEMINI_API_KEY' fails at runtime."
else
  log ".env.local already exists (kept as-is)"
fi

# Ensure PORT/APP_URL are reflected for this install
grep -q "^PORT=" .env.local || printf 'PORT=%s\n' "$PORT" >> .env.local
grep -q "^APP_URL=" .env.local || printf 'APP_URL=%s\n' "$APP_URL" >> .env.local

# --- 6. Runtime data directories (whatsapp auth, media, sandbox, agent logs) -
mkdir -p data/whatsapp-auth data/whatsapp-media data/sandbox-previews data/coding-agent-logs
chmod -R 700 data 2>/dev/null || true

# --- 7. npm install -----------------------------------------------------------
log "Installing npm dependencies (node-pty/robotjs compile from source; needs the build tools above)..."
npm install

# --- 8. Build -----------------------------------------------------------------
log "Building (vite build && esbuild server.ts -> dist/server.cjs)..."
npm run build

# --- 9. (Optional) systemd unit -----------------------------------------------
if [ "${INSTALL_SYSTEMD:-0}" = "1" ]; then
  log "Installing systemd unit beatrice.service..."
  cat >/etc/systemd/system/beatrice.service <<UNIT
[Unit]
Description=Beatrice OSS voice assistant
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env.local
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node $APP_DIR/dist/server.cjs
Restart=always
RestartSec=3
# Optional hardening (uncomment if issues with ffmpeg/robotjs):
# NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable beatrice.service
  systemctl start beatrice.service || warn "systemd failed to start; check 'journalctl -u beatrice -e'"
  log "beatrice.service enabled and started."
fi

# --- 10. Verification ----------------------------------------------------------
log "Verifying build artifacts..."
[ -f dist/server.cjs ] || die "dist/server.cjs missing — build failed"
[ -f dist/index.html ] || warn "dist/index.html missing (client assets not built?)"

log ""
log "Install complete."
log "Start the server:  cd $APP_DIR && NODE_ENV=production node dist/server.cjs"
log "Health check:  curl http://localhost:$PORT/api/health"
log "Services:      curl http://localhost:$PORT/api/services   (sandbox 5556 / cli 5557 / browser 5558 / computer 5559 / codingAgent 5560)"
log ""
log "Next steps:"
log "  1. Set real API keys in .env.local: GEMINI_API_KEY, DASHSCOPE_API_KEY"
log "  2. WhatsApp: open the app -> Settings -> WhatsApp -> pair via QR/pairing code"
log "  3. Google: Settings -> Google Services -> Connect (client-side Firebase OAuth)"
log "  4. Coding agent model: ~/.config/opencode/opencode.jsonc (Zen free default)"

exit 0