#!/usr/bin/env bash
# =============================================================================
# serve.sh — serve dist/ over HTTP for local development.
#
# WHAT: Starts a static file server for dist/ on http://localhost:8080.
# WHY:  The app uses ES modules and fetch(), so it must be served over HTTP;
#       opening index.html from the filesystem will not work.
# HOW:  ./build.sh serve   (or: bash tools/serve.sh [port])
#       Prefers python3's built-in http.server; falls back to `npx serve`.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/versions.env"

PORT="${1:-8080}"
DIST="$ROOT/$DIST_DIR"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ -d "$DIST" ]] || die "$DIST_DIR/ not found; run './build.sh dist' first"

if command -v python3 >/dev/null 2>&1; then
  say "serve: http://localhost:$PORT (python3 http.server, Ctrl-C to stop)"
  cd "$DIST"
  exec python3 -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  say "serve: http://localhost:$PORT (npx serve, Ctrl-C to stop)"
  exec npx --yes serve -l "$PORT" "$DIST"
else
  die "neither python3 nor npx found; install one of them to serve dist/"
fi
