#!/usr/bin/env bash
# Windows host adapter for the existing POSIX build pipeline.
# It deliberately never calls Docker. The normal `all` target downloads the
# SHA-256-pinned prebuilt Nim/Clang WebAssembly toolchains.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export PATH="$HERE/windows-bin:$PATH"
cd "$ROOT"
source "$ROOT/versions.env"

# Prefer the exact host Nim installed by Qnote Nim. This avoids the POSIX
# bootstrap's in-place executable replacement, which Windows does not permit
# while nim.exe is running.
if [[ -n "${LOCALAPPDATA:-}" ]] && command -v cygpath >/dev/null 2>&1; then
  LOCAL_APP_DATA_UNIX="$(cygpath -u "$LOCALAPPDATA")"
  HOST_NIM_BIN="$LOCAL_APP_DATA_UNIX/Programs/Nim/nim-$NIM_VERSION/bin"
  [[ -x "$HOST_NIM_BIN/nim.exe" ]] && export PATH="$HOST_NIM_BIN:$PATH"
fi

if ! python3 --version >/dev/null 2>&1; then
  printf 'error: a working Python 3 installation is required\n' >&2
  exit 1
fi

for target in "$@"; do
  if [[ "$target" == "nim-docker" ]]; then
    printf 'error: nim-docker is disabled by the Docker-free Windows wrapper\n' >&2
    exit 2
  fi
done

exec bash ./build.sh "$@"
