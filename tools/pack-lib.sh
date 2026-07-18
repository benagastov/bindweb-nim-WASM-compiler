#!/usr/bin/env bash
# =============================================================================
# tools/pack-lib.sh -- pack a directory into a deterministic ustar "libpack"
# =============================================================================
#
# What
#   Creates libpacks/<name>.tar (uncompressed POSIX ustar) from <src-dir> and
#   adds or updates the matching entry in libpacks/manifest.json.
#
# Why
#   Nim libraries ship as plain tar archives ("libpacks") that the browser IDE
#   mounts into the compiler's in-memory filesystem at runtime. Adding or
#   upgrading a library never requires rebuilding nim.wasm; repacking the tar
#   and refreshing the page is enough.
#
# How
#   1. <src-dir> is copied into a temporary staging area under a top-level
#      "<name>/" prefix (the manifest's strip:1 drops this prefix on mount).
#   2. The staging copy is normalized (directories 0755, files 0644) and
#      archived with sorted entry order, zeroed ownership and a fixed mtime,
#      so identical inputs produce byte-identical tars.
#   3. libpacks/manifest.json is edited in place (python3 preferred, node as
#      fallback); entries for other packs are preserved.
#
# Usage
#   tools/pack-lib.sh <name> <src-dir> <mount> [required]
#
#   <name>     Pack identifier; also the top-level directory inside the tar.
#              Letters, digits, '.', '_' and '-' only.
#   <src-dir>  Directory whose contents become <name>/... inside the tar.
#   <mount>    Absolute mount point in the in-browser filesystem, e.g. /bindweb.
#   [required] "true" or "false" (default "false"). When true, the IDE aborts
#              loading if this pack is missing.
#
# Environment
#   SOURCE_DATE_EPOCH   Overrides the fixed mtime recorded in the tar
#                       (default: 0, i.e. 1970-01-01T00:00:00Z).
#
# Portability
#   The deterministic flags (--sort=name, --owner/--group/--numeric-owner,
#   --mtime, --format=ustar) require GNU tar >= 1.28. Support is probed at
#   runtime; on other tar implementations the script falls back to a portable
#   sorted per-file append. The result is still a valid ustar archive, but
#   ownership/mtime normalization is then unavailable and a warning is printed.
# =============================================================================
set -euo pipefail

# --- locate the repository root (this script lives in <root>/tools) ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
LIBPACKS_DIR="$ROOT_DIR/libpacks"
MANIFEST="$LIBPACKS_DIR/manifest.json"

log() { printf 'pack-lib: %s\n' "$*"; }
die() { printf 'pack-lib: error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
usage: tools/pack-lib.sh <name> <src-dir> <mount> [required]
  <name>     pack identifier (letters, digits, '.', '_', '-')
  <src-dir>  directory whose contents become <name>/... inside the tar
  <mount>    absolute in-browser mount point, e.g. /bindweb
  [required] "true" or "false" (default "false")
EOF
  exit 2
}

# --- arguments ---------------------------------------------------------------
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || usage
NAME="$1"
SRC_DIR="$2"
MOUNT="$3"
REQUIRED="${4:-false}"

[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] \
  || die "invalid pack name '$NAME' (allowed: letters, digits, '.', '_', '-')"
[ -d "$SRC_DIR" ] || die "source directory '$SRC_DIR' does not exist"
[[ "$MOUNT" == /* ]] || die "mount point '$MOUNT' must be absolute (start with '/')"
[ "$REQUIRED" = "true" ] || [ "$REQUIRED" = "false" ] \
  || die "required must be 'true' or 'false', got '$REQUIRED'"
command -v tar >/dev/null 2>&1 || die "tar not found in PATH"

SRC_DIR="$(cd "$SRC_DIR" && pwd)"
EPOCH="${SOURCE_DATE_EPOCH:-0}"
[[ "$EPOCH" =~ ^[0-9]+$ ]] || die "SOURCE_DATE_EPOCH must be a non-negative integer"

mkdir -p "$LIBPACKS_DIR"
OUT_TAR="$LIBPACKS_DIR/$NAME.tar"

# --- staging: copy <src-dir> under a top-level <name>/ prefix ----------------
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

STAGE="$TMP_DIR/stage"
mkdir -p "$STAGE/$NAME"
cp -R "$SRC_DIR/." "$STAGE/$NAME/"

# Drop VCS/OS noise that must never ship inside a libpack.
find "$STAGE" \( -name .git -o -name .DS_Store \) -prune -exec rm -rf {} +

# Normalize permissions so the archive does not depend on the caller's umask.
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +

# --- archive -----------------------------------------------------------------
# Probe tar capabilities against a scratch directory. Archiving "." with -cf
# /dev/null exercises flag parsing without producing output.
PROBE_DIR="$TMP_DIR/probe"
mkdir -p "$PROBE_DIR"
tar_supports() { ( cd "$PROBE_DIR" && tar "$@" -cf /dev/null . ) >/dev/null 2>&1; }

if tar_supports --sort=name --owner=0 --group=0 --numeric-owner \
                --format=ustar --mtime="@$EPOCH"; then
  # Fast path: GNU tar >= 1.28, fully deterministic in one pass.
  ( cd "$STAGE" && tar --sort=name --owner=0 --group=0 --numeric-owner \
      --format=ustar --mtime="@$EPOCH" -cf "$OUT_TAR" "$NAME" )
else
  # Portable fallback: sorted file list, one append per file. Any POSIX tar
  # supports -c/-r; ustar output is the POSIX default (requested explicitly
  # when the implementation understands --format). Empty directories are not
  # representable in this mode and ownership/mtimes are not normalized.
  log "warning: tar lacks GNU determinism flags; using portable fallback" >&2
  FMT_ARGS=()
  if tar_supports --format=ustar; then
    FMT_ARGS=(--format=ustar)
  fi
  LIST="$TMP_DIR/files.txt"
  ( cd "$STAGE" && find "$NAME" -type f -print | LC_ALL=C sort > "$LIST" )
  [ -s "$LIST" ] || die "nothing to pack: '$SRC_DIR' contains no files"
  first=1
  while IFS= read -r entry; do
    if [ "$first" -eq 1 ]; then
      ( cd "$STAGE" && tar "${FMT_ARGS[@]}" -cf "$OUT_TAR" "$entry" )
      first=0
    else
      ( cd "$STAGE" && tar "${FMT_ARGS[@]}" -rf "$OUT_TAR" "$entry" )
    fi
  done < "$LIST"
fi

# The archive must at least be readable by tar before we touch the manifest.
tar -tf "$OUT_TAR" >/dev/null 2>&1 || die "produced archive '$OUT_TAR' is unreadable"
log "wrote $OUT_TAR ($(wc -c < "$OUT_TAR" | tr -d ' ') bytes)"

# --- manifest ----------------------------------------------------------------
# Insert or replace this pack's entry, preserving every other entry. python3
# is preferred; node is the fallback; either must be present.
PY_EDIT="$TMP_DIR/edit_manifest.py"
cat > "$PY_EDIT" <<'PY'
import json
import sys

path, name, file, mount, required = sys.argv[1:6]
entry = {
    "name": name,
    "file": file,
    "mount": mount,
    "strip": 1,
    "required": required == "true",
}
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
except (FileNotFoundError, json.JSONDecodeError):
    data = {"version": 1, "packs": []}
data["version"] = 1
packs = data.setdefault("packs", [])
for i, pack in enumerate(packs):
    if isinstance(pack, dict) and pack.get("name") == name:
        packs[i] = entry
        break
else:
    packs.append(entry)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY

JS_EDIT="$TMP_DIR/edit_manifest.js"
cat > "$JS_EDIT" <<'JS'
'use strict';
const fs = require('fs');
const [path, name, file, mount, required] = process.argv.slice(2);
const entry = { name, file, mount, strip: 1, required: required === 'true' };
let data;
try {
  data = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch {
  data = { version: 1, packs: [] };
}
data.version = 1;
if (!Array.isArray(data.packs)) data.packs = [];
const i = data.packs.findIndex((p) => p && p.name === name);
if (i >= 0) data.packs[i] = entry; else data.packs.push(entry);
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
JS

TAR_BASENAME="$NAME.tar"
if command -v python3 >/dev/null 2>&1; then
  python3 "$PY_EDIT" "$MANIFEST" "$NAME" "$TAR_BASENAME" "$MOUNT" "$REQUIRED"
elif command -v node >/dev/null 2>&1; then
  node "$JS_EDIT" "$MANIFEST" "$NAME" "$TAR_BASENAME" "$MOUNT" "$REQUIRED"
else
  die "neither python3 nor node found; cannot edit manifest.json"
fi
log "manifest updated: $MANIFEST (pack '$NAME', mount '$MOUNT', required=$REQUIRED)"
