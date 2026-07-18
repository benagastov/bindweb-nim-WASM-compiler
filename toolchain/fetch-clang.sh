#!/usr/bin/env bash
# =============================================================================
# fetch-clang.sh — fetch and verify the prebuilt in-browser clang toolchain.
#
# WHAT: Installs clang.wasm, lld.wasm, memfs.wasm and sysroot.tar into
#       web/vendor/clang/, plus the patched JS driver from
#       toolchain/vendor-src/clang.js. LLVM is NEVER built from source;
#       the whole point is to skip the hours-long, RAM-hungry LLVM build.
#
# WHY these binaries: they come from the clang.js npm package (v0.1.1), which
#       republishes the official prebuilt binaries of binji's LLVM fork —
#       the only clang.wasm known to work in the browser. (The from-source
#       LLVM build in toolchain/clang-sources/ produces a clang.wasm whose
#       pass registry is broken at runtime; do not use it.)
#
# HOW:  Mirror 1: the npm tarball from registry.npmjs.org (sha256-verified,
#                 then each extracted artifact is verified again).
#       Mirror 2: per-file download from cdn.jsdelivr.net (npm mirror).
#       Every artifact is checked against toolchain/SHA256SUMS.clang; a
#       mismatch aborts the install. Idempotent: existing files are kept
#       unless --force is given.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/versions.env"

DEST="$ROOT/$VENDOR_CLANG_DIR"
SUMS="$HERE/SHA256SUMS.clang"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v tar >/dev/null 2>&1 || die "tar is required"
# sha256sum on Linux (coreutils), shasum on macOS.
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "need sha256sum (Linux coreutils) or shasum (macOS) to verify downloads"
fi
mkdir -p "$DEST"

# The JS driver ships in the repo (patched); simply copy it into place.
say "clang: installing patched JS driver from toolchain/vendor-src/clang.js"
cp -f "$HERE/vendor-src/clang.js" "$DEST/clang.js"

# lookup_hash <file> -> recorded sha256 or empty.
lookup_hash() {
  local f="$1" name hash
  while read -r name hash _; do
    [[ -z "${name:-}" || "$name" == \#* ]] && continue
    [[ "$name" == "$f" ]] && { printf '%s\n' "$hash"; return 0; }
  done < "$SUMS"
  return 0
}

verify_file() { # verify_file <path> <name>
  local path="$1" name="$2" want got
  want="$(lookup_hash "$name")"
  [[ -n "$want" ]] || die "no sha256 recorded for $name in SHA256SUMS.clang"
  got="$(sha256sum "$path" | awk '{print $1}')"
  [[ "$got" == "$want" ]] || die "sha256 mismatch for $name
  expected: $want
  got:      $got
  (hashes in toolchain/SHA256SUMS.clang; refusing to install)"
}

ARTIFACTS="clang.wasm lld.wasm memfs.wasm sysroot.tar"

need_any=0
for f in $ARTIFACTS; do [[ -f "$DEST/$f" && "$FORCE" -eq 0 ]] || need_any=1; done
if [[ "$need_any" -eq 0 ]]; then
  say "clang: all artifacts present (skip; use --force to re-download)"
  say "clang: toolchain ready in $VENDOR_CLANG_DIR"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- Mirror 1: npm tarball ---------------------------------------------------
say "clang: downloading clang.js $CLANGJS_NPM_VERSION toolchain tarball (npm registry)"
TARBALL_OK=0
if curl -fL --retry 2 --connect-timeout 20 -o "$TMP/clangjs.tgz" "$CLANGJS_TARBALL_URL"; then
  if verify_file "$TMP/clangjs.tgz" "clang.js-$CLANGJS_NPM_VERSION.tgz"; then
    say "clang: tarball sha256 OK"
    tar -xzf "$TMP/clangjs.tgz" -C "$TMP"
    TARBALL_OK=1
  fi
else
  say "clang: registry download failed, will try per-file CDN mirror"
fi

install_one() { # install_one <file>
  local f="$1"
  if [[ -f "$DEST/$f" && "$FORCE" -eq 0 ]]; then
    say "clang: $f present (skip)"
    return 0
  fi
  if [[ "$TARBALL_OK" -eq 1 && -f "$TMP/package/dist/$f" ]]; then
    verify_file "$TMP/package/dist/$f" "$f"
    cp -f "$TMP/package/dist/$f" "$DEST/$f"
  else
    say "clang: downloading $f from CDN mirror"
    curl -fL --retry 2 --connect-timeout 20 -o "$TMP/$f" "$CLANGJS_CDN_URL/$f" \
      || die "could not fetch $f from any mirror"
    verify_file "$TMP/$f" "$f"
    cp -f "$TMP/$f" "$DEST/$f"
  fi
  say "clang: $f sha256 OK"
}

for f in $ARTIFACTS; do install_one "$f"; done

say "clang: toolchain ready in $VENDOR_CLANG_DIR"
