#!/usr/bin/env bash
# =============================================================================
# fetch-nim.sh — download the prebuilt SPEC §8d Nim WASM toolchain into
# web/vendor/nim/ (the fast path: seconds instead of a 20-40 minute build).
#
# WHAT: fetches nim.wasm, nim-bundle.js, nim-bundle.data and nimbase.h from
#       the mirrored public repo (two mirrors: jsDelivr CDN, then raw
#       GitHub), verifying every file against the SHA-256 pins in
#       toolchain/SHA256SUMS.nim. Idempotent: files that already verify are
#       skipped, so re-running resumes an interrupted download.
#
# WHY:  the playground's flags/libpacks are matched to this exact compiler
#       build; building nim.wasm from source (./build.sh nim / nim-docker)
#       is the fallback when neither mirror is reachable.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"
source "$ROOT/versions.env"

SUMS="$HERE/SHA256SUMS.nim"
DEST="$VENDOR_NIM_DIR"
FILES="nim.wasm nim-bundle.js nim-bundle.data nimbase.h"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

mkdir -p "$DEST"

expected_hash() {
  awk -v f="$1" '$1 == f { print $2 }' "$SUMS"
}

# verify <name>: true if $DEST/<name> exists and matches its pin.
verify() {
  local name="$1" want actual
  want="$(expected_hash "$name")"
  [[ -n "$want" ]] || die "no SHA-256 pin for $name in $SUMS"
  [[ -f "$DEST/$name" ]] || return 1
  actual="$(sha256sum "$DEST/$name" | awk '{print $1}')"
  [[ "$actual" == "$want" ]]
}

# fetch_one <name>: download from the first mirror that yields a valid file.
fetch_one() {
  local name="$1" url
  for base in "$NIM_PREBUILT_CDN_URL" "$NIM_PREBUILT_REPO_URL"; do
    url="$base/$name"
    say "nim-fetch: $name <- $url"
    # -C - resumes a partial file from an earlier interrupted attempt.
    if curl -fL --retry 3 --retry-delay 2 -C - -o "$DEST/$name" "$url"; then
      if verify "$name"; then
        return 0
      fi
      say "nim-fetch: $name failed SHA-256 verification after download — trying next mirror"
      rm -f "$DEST/$name"
    else
      say "nim-fetch: download of $name failed from this mirror — trying next"
    fi
  done
  return 1
}

for name in $FILES; do
  if verify "$name"; then
    say "nim-fetch: $name already present and verified — skipping"
  else
    fetch_one "$name" || die "could not fetch a verified $name (both mirrors failed). Fallback: ./build.sh nim (build from source)."
  fi
done

say "nim-fetch: all $(echo $FILES | wc -w) files verified against SHA256SUMS.nim"
