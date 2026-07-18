#!/usr/bin/env bash
# =============================================================================
# make-dist.sh — assemble the ready-to-serve dist/ directory.
#
# WHAT: Copies the static web app (web/, including web/vendor/ when populated
#       by ./build.sh clang and ./build.sh nim) and the compiled libpacks
#       (libpacks/*.tar + manifest.json) into dist/. Nothing is excluded:
#       vendor artifacts are copied if present, with a warning when they are
#       missing so a half-built dist is never silently produced.
#
# WHY:  dist/ is the single artifact the web server (and CI's Pages upload)
#       consumes; assembling it is one deterministic copy step.
#
# HOW:  ./build.sh dist   (or: bash tools/make-dist.sh)
#       Prints a tree summary of the result. Re-running replaces dist/
#       wholesale, so the output always matches the inputs exactly.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/versions.env"

SRC_WEB="$ROOT/web"
SRC_PACKS="$ROOT/libpacks"
DIST="$ROOT/$DIST_DIR"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ -d "$SRC_WEB" ]] || die "web/ not found at $SRC_WEB (is the web branch merged?)"

# Start from a clean slate so removed files never linger in dist/.
rm -rf "$DIST"
mkdir -p "$DIST/libpacks"

# --- web/ -> dist/ -----------------------------------------------------------
say "dist: copying web/ -> $DIST_DIR/"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$SRC_WEB/" "$DIST/"
else
  cp -a "$SRC_WEB/." "$DIST/"
fi

# Vendor sanity check: dist is still useful without vendor (the page loads),
# but compilation will fail, so make the gap loud.
if [[ ! -f "$DIST/vendor/clang/clang.js" ]]; then
  say "dist: WARNING: vendor/clang/ not populated; run './build.sh clang' first"
fi
if [[ ! -f "$DIST/vendor/nim/nim.wasm" ]]; then
  say "dist: WARNING: vendor/nim/nim.wasm missing; run './build.sh nim' (or nim-docker) first"
fi

# --- libpacks -> dist/libpacks/ ----------------------------------------------
say "dist: copying libpacks -> $DIST_DIR/libpacks/"
shopt -s nullglob
packs=("$SRC_PACKS"/*.tar)
shopt -u nullglob
# NOTE: plain `cp`, not `cp -a` — these are data files, and `cp -a` can fail
# outright (taking the whole script down via set -e) on filesystems that do
# not support permission/xattr preservation (some overlay/network mounts).
# Every copy is verified byte-for-byte and retried once, because a half-copied
# libpack breaks the IDE in non-obvious ways.
copy_verified() {
  local src="$1" dst="$2"
  cp -f "$src" "$dst" 2>/dev/null || cp -f "$src" "$dst"
  if ! cmp -s "$src" "$dst"; then
    rm -f "$dst"; cp -f "$src" "$dst"
    cmp -s "$src" "$dst" || die "copy failed: $src -> $dst"
  fi
}
if [[ "${#packs[@]}" -gt 0 ]]; then
  for p in "${packs[@]}"; do copy_verified "$p" "$DIST/libpacks/$(basename "$p")"; done
else
  say "dist: WARNING: no libpacks/*.tar found; run './build.sh libs' first"
fi
if [[ -f "$SRC_PACKS/manifest.json" ]]; then
  copy_verified "$SRC_PACKS/manifest.json" "$DIST/libpacks/manifest.json"
else
  say "dist: WARNING: libpacks/manifest.json missing; the app cannot mount any library packs"
fi

# --- verify the whole tree copied cleanly (guards against flaky filesystems) -
say "dist: verifying copied files..."
MISMATCH=0
while IFS= read -r -d '' f; do
  rel="${f#"$SRC_WEB"/}"
  dst="$DIST/$rel"
  if [[ ! -f "$dst" ]] || ! cmp -s "$f" "$dst"; then
    say "dist: re-copying mismatched file: $rel"
    mkdir -p "$(dirname "$dst")"
    cp -f "$f" "$dst" 2>/dev/null || cp -f "$f" "$dst"
    cmp -s "$f" "$dst" || { say "dist: ERROR: cannot copy $rel"; MISMATCH=1; }
  fi
done < <(find "$SRC_WEB" -type f -print0)
[[ "$MISMATCH" -eq 0 ]] || die "dist: verification failed"

# --- summary -----------------------------------------------------------------
say "dist: contents of $DIST_DIR/"
if command -v tree >/dev/null 2>&1; then
  tree -L 3 --dirsfirst "$DIST"
else
  ( cd "$DIST" && find . -maxdepth 3 -print | sort | sed 's|^\./||' )
fi
say "dist: total size: $(du -sh "$DIST" | awk '{print $1}')"
say "dist: done — serve with './build.sh serve'"
