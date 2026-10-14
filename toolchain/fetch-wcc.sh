#!/usr/bin/env bash
# =============================================================================
# fetch-wcc.sh — install the prebuilt wcc toolchain into web/vendor/wcc/.
#
# WHAT: Copies toolchain/wcc/prebuilt/{cc.wasm,sysroot.tar} (about 0.8 MB,
#       committed to this repo) into web/vendor/wcc/ after checking them
#       against toolchain/SHA256SUMS.wcc. No download, no build.
#
# WHY:  wcc is the IDE's default C compiler: it compiles Nim's C output to
#       wasm in seconds (clang.wasm stays available as "Compatible").
#
# HOW:  Rebuild the prebuilt files from the pinned sources in versions.env
#       with toolchain/wcc/tools/fetch-sources.sh, build.sh and pack.sh
#       (see toolchain/wcc/README.md), then update SHA256SUMS.wcc.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/versions.env"

SRC="$HERE/wcc/prebuilt"
DEST="$ROOT/$VENDOR_WCC_DIR"
SUMS="$HERE/SHA256SUMS.wcc"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | awk '{print $1}'; }
else
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
fi

mkdir -p "$DEST"
while read -r sum name; do
  [[ -z "$sum" || "$sum" == \#* ]] && continue
  [[ -f "$SRC/$name" ]] || die "missing $SRC/$name"
  [[ "$(sha256 "$SRC/$name")" == "$sum" ]] || die "$name does not match SHA256SUMS.wcc"
  cp -f "$SRC/$name" "$DEST/$name"
  [[ "$(sha256 "$DEST/$name")" == "$sum" ]] || die "copy of $name is corrupt"
done < "$SUMS"
say "wcc: installed $(ls "$DEST" | tr '\n' ' ')into $VENDOR_WCC_DIR"
