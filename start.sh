#!/usr/bin/env bash
# =============================================================================
# start.sh — THE one-click start for beginners. This is the only file you
#            need to touch: double-click it, or run "sh start.sh".
#
# WHAT: Takes you from a fresh download of this project to a running
#       in-browser Nim compiler at http://localhost:8080, in four steps:
#
#         [1/4] Download the C compiler (prebuilt — no hours-long build)
#         [2/4] Build the Nim compiler (skipped entirely if already built)
#         [3/4] Pack the libraries and assemble the app (dist/)
#         [4/4] Start a local server and open your web browser
#
# WHY:  Everything here is idempotent: anything that is already done is
#       detected and skipped, so you can run this script as often as you
#       like — including after a failure, it simply picks up where it left
#       off. Power users get finer control from ./build.sh (see README.md).
#
# HOW:  Every step checks its own preconditions and, when something is
#       missing, prints a plain-language message telling you exactly what
#       to install or click next. Nothing is built from source except the
#       Nim compiler itself, and that prefers Docker so you need no local
#       toolchain at all.
# =============================================================================

# If we were launched as "sh start.sh" with a non-bash shell (e.g. dash on
# Ubuntu), re-exec under bash: this script uses bash features such as
# pipefail and /dev/tcp.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

# Always run from the folder this script lives in, even when double-clicked.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
# Pins and shared paths (VENDOR_CLANG_DIR, VENDOR_NIM_DIR, DIST_DIR, ...).
source "$HERE/versions.env"

PORT="${PORT:-8080}"
URL="http://localhost:$PORT"

# ---- friendly output helpers -------------------------------------------------
step() { printf '\n[%s] %s\n' "$1" "$2"; }
ok()   { printf '      %s\n' "$*"; }

# fail <message...>: print a plain-language explanation and stop. Every call
# site tells a non-programmer exactly what to do next.
fail() {
  printf '\n' >&2
  printf '*** %s\n' "$1" >&2
  shift || true
  for line in "$@"; do printf '    %s\n' "$line" >&2; done
  printf '\n' >&2
  exit 1
}

# Last-resort error handler: if anything fails that we did not anticipate,
# still leave the user with something actionable instead of a bare exit code.
on_unexpected_error() {
  local rc=$?
  printf '\n*** Something unexpected went wrong (line %s, exit code %s).\n' "$1" "$rc" >&2
  printf '    Try simply running this script again. If it keeps failing, copy\n' >&2
  printf '    everything printed above and ask someone technical for help.\n\n' >&2
  exit "$rc"
}
trap 'on_unexpected_error $LINENO' ERR

have() { command -v "$1" >/dev/null 2>&1; }

# docker_ready: docker is installed AND its daemon is running AND we may use it.
docker_ready() {
  have docker || return 1
  docker info >/dev/null 2>&1 || return 1
  return 0
}

# native_nim_ready: a local Emscripten SDK is activated (power-user path).
native_nim_ready() {
  [[ -n "${EMSDK_DIR:-}" && -f "${EMSDK_DIR:-}/emsdk_env.sh" ]]
}

printf '============================================================\n'
printf '  nim-wasm-compiler - one-click start\n'
printf '  Sit back: anything already done is skipped automatically.\n'
printf '  When everything is ready your web browser will open at\n'
printf '  %s\n' "$URL"
printf '============================================================\n'

# =============================================================================
# Step [1/4]: the prebuilt C compiler (clang.js npm binaries). Never an LLVM build.
# =============================================================================
clang_complete=1
# shellcheck disable=SC2086 # WASM_CLANG_FILES is a space-separated list, on purpose.
for f in $WASM_CLANG_FILES clang.js; do
  [[ -f "$VENDOR_CLANG_DIR/$f" ]] || clang_complete=0
done

if [[ "$clang_complete" -eq 1 ]]; then
  step "1/4" "Getting the C compiler (prebuilt, no long build)..."
  ok "Already downloaded earlier - skipping."
else
  step "1/4" "Getting the C compiler (prebuilt, no long build)..."
  have curl || fail \
    "We need a small tool called 'curl' to download the compiler, and it is missing." \
    "Install it and run this script again. On Ubuntu/Debian that is:" \
    "sudo apt install curl"
  if ! bash toolchain/fetch-clang.sh; then
    fail \
      "The compiler download did not finish." \
      "Check your internet connection, then run this script again - it will" \
      "resume where it stopped. (If your connection is fine, the download" \
      "server may be having a bad moment; try again in a few minutes.)"
  fi
  ok "Done."
fi

# =============================================================================
# Step [2/4]: nim.wasm — the only thing ever compiled. Prefer Docker (zero
# local dependencies); fall back to a native emsdk; skip if already built.
# =============================================================================
if [[ -f "$VENDOR_NIM_DIR/nim.wasm" ]]; then
  step "2/4" "Building the Nim compiler (first time only)..."
  ok "Already built earlier - skipping."
else
  step "2/4" "Building the Nim compiler (first time only; this can take 20-40 minutes)..."
  if docker_ready; then
    ok "Using Docker - nothing else to install."
    if ! ./build.sh nim-docker; then
      fail \
        "The Nim compiler build did not finish inside Docker." \
        "The most common cause is Docker running low on memory: open Docker" \
        "Desktop, go to Settings -> Resources, give it at least 4 GB of memory," \
        "then run this script again. It will pick up where it stopped."
    fi
  elif native_nim_ready; then
    ok "Using your local Emscripten installation."
    if ! ./build.sh nim; then
      fail \
        "The Nim compiler build did not finish (native Emscripten path)." \
        "Read the technical message above; if it does not ring a bell, the" \
        "easiest route is Docker instead: https://www.docker.com/products/docker-desktop/"
    fi
  else
    # No usable Docker and no local emsdk: provision the native toolchain from
    # zero (base build deps + pinned emsdk) and build without Docker. This is
    # the path for bare agent/CI sandboxes that have neither Docker nor emsdk.
    if have docker; then
      ok "Docker is installed but not running; falling back to a native build."
    fi
    ok "No usable Docker and no local Emscripten — preparing the native toolchain from scratch."
    ok "(Installs base build tools + a pinned emsdk $EMSDK_VERSION; the first run can take a while.)"
    if ! ./build.sh setup; then
      fail \
        "Automatic native setup failed (base build tools + emsdk)." \
        "Most often this is a missing 'sudo'/package permission, or no network" \
        "access to fetch emsdk. Read the messages above. If you have Docker," \
        "start it and run this script again instead."
    fi
    if ! ./build.sh nim; then
      fail \
        "The Nim compiler build did not finish (native path, after setup)." \
        "Read the technical message above. Docker is an alternative:" \
        "https://www.docker.com/products/docker-desktop/"
    fi
  fi
  ok "Done."
fi

# =============================================================================
# Step [3/4]: library packs + assemble dist/.
# =============================================================================
step "3/4" "Packing libraries and putting the app together..."
# Repack when the manifest is missing, or when any staged source under
# libpacks/src/ is newer than the packs (so edits to libraries take effect).
needs_pack=0
if [[ ! -f libpacks/manifest.json ]]; then
  needs_pack=1
elif [[ -d libpacks/src ]]; then
  newest_tar="$(ls -t libpacks/*.tar 2>/dev/null | head -1 || true)"
  if [[ -z "$newest_tar" ]] || [[ -n "$(find libpacks/src -type f -newer "$newest_tar" -print -quit 2>/dev/null)" ]]; then
    needs_pack=1
  fi
fi
if [[ "$needs_pack" -eq 1 && -f tools/pack-lib.sh && -d libpacks/src ]]; then
  if ! ./build.sh libs; then
    fail \
      "Packing the libraries failed." \
      "Run this script again; if it keeps failing, run './build.sh libs' and" \
      "read the technical message it prints."
  fi
elif [[ "$needs_pack" -eq 1 ]]; then
  # Defensive: the packs are committed to the repo, so this should never
  # happen; if it does, keep going — the app loads, just without libraries.
  ok "WARNING: libpacks/manifest.json is missing and no pack sources were found."
  ok "The app will open but no Nim libraries will be available."
else
  ok "Library packs are ready - skipping."
fi
if ! ./build.sh dist; then
  fail \
    "Putting the app together (dist/) failed." \
    "Make sure this folder contains the complete project (including the web/" \
    "folder), then run this script again."
fi
ok "Done."

# =============================================================================
# Step [4/4]: serve dist/ and open the browser.
# =============================================================================
step "4/4" "Starting your local server and opening the app..."

# open_browser <url>: best-effort; never fails the script.
open_browser() {
  local url="$1"
  if have xdg-open; then xdg-open "$url" >/dev/null 2>&1 &        # Linux
  elif have open;    then open "$url" >/dev/null 2>&1 &           # macOS
  elif have powershell.exe; then                                  # git-bash/WSL
    powershell.exe -c "start '$url'" >/dev/null 2>&1 &
  elif have cmd.exe; then
    cmd.exe /c start "" "$url" >/dev/null 2>&1 &
  fi
  return 0
}

# Idempotency: if a previous run is still serving, just (re)open the browser.
if (echo >"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  ok "A server from an earlier run is already live at $URL"
  ok "Opening your browser again. (Close that other window to stop the server.)"
  open_browser "$URL" || true
  exit 0
fi

printf '\n'
printf '============================================================\n'
printf '  All done! The app lives at:\n'
printf '      %s\n' "$URL"
printf '  Your browser should open in a moment. Keep THIS window open\n'
printf '  while you use the app; press Ctrl-C here to stop the server.\n'
printf '============================================================\n\n'

# Open the browser shortly after the server starts (background, best-effort).
( sleep 2; open_browser "$URL" ) >/dev/null 2>&1 &

# Hand over to the serving script (python3 http.server, or npx serve). This
# blocks in the foreground until the user presses Ctrl-C.
if ! bash tools/serve.sh "$PORT"; then
  fail \
    "Could not start the local server." \
    "Install Python 3 (https://www.python.org/downloads/) and run this script" \
    "again - everything else is already done, so it will jump straight here."
fi
