#!/usr/bin/env bash
# start.sh — launch both the FastAPI backend and the Vite frontend dev server

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# ── colours ─────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ  $*${NC}"; }
ok()    { echo -e "${GREEN}✔  $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠  $*${NC}"; }
die()   { echo -e "${RED}✖  $*${NC}"; exit 1; }

# ── locate Python ────────────────────────────────────────────────────────────
VENV_PYTHON="$ROOT/../venv/bin/python3"
if [ -x "$VENV_PYTHON" ]; then
    PYTHON="$VENV_PYTHON"
    ok "Using venv Python: $PYTHON"
else
    PYTHON="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
    [ -z "$PYTHON" ] && die "Python 3 not found. Activate the venv or install Python."
    warn "venv not found — using system Python: $PYTHON"
fi

# ── install backend deps ─────────────────────────────────────────────────────
info "Checking backend Python dependencies..."
"$PYTHON" -m pip install -q -r "$BACKEND/requirements.txt"
ok "Backend deps ready."

# ── install frontend deps ────────────────────────────────────────────────────
if [ ! -d "$FRONTEND/node_modules" ]; then
    info "Installing frontend npm packages..."
    (cd "$FRONTEND" && npm install)
    ok "Frontend deps installed."
else
    ok "Frontend node_modules present."
fi

# ── cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
    echo ""
    info "Shutting down servers..."
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    ok "Done. Goodbye!"
}
trap cleanup EXIT INT TERM

# ── start backend ────────────────────────────────────────────────────────────
info "Starting FastAPI backend on http://localhost:8000 ..."
(cd "$BACKEND" && "$PYTHON" -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload) \
    2>&1 | sed 's/^/[backend] /' &
BACKEND_PID=$!
ok "Backend PID: $BACKEND_PID"

# give the backend a moment to bind
sleep 1

# ── start frontend ────────────────────────────────────────────────────────────
info "Starting Vite frontend on http://localhost:5173 ..."
(cd "$FRONTEND" && npm run dev) 2>&1 | sed 's/^/[frontend] /' &
FRONTEND_PID=$!
ok "Frontend PID: $FRONTEND_PID"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         DrumLess UI is running           ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║   Frontend  →  http://localhost:5173     ║${NC}"
echo -e "${GREEN}║   Backend   →  http://localhost:8000     ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║   Press Ctrl+C to stop both servers.     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

# Wait for either process to exit
wait -n "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || wait
