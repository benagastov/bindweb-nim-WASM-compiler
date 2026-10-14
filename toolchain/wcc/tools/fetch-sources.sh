#!/usr/bin/env bash
# Clone the pinned xcc and musl sources next to this script's parent and apply
# our xcc patch (patches/xcc.patch). Idempotent: existing checkouts are kept.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

XCC_REPO="https://github.com/tyfkda/xcc.git"
XCC_REF="9eea241c1331d54730b9173cfb11c4dea7c893a4"     # 2026-10-02
MUSL_REPO="https://git.musl-libc.org/git/musl"
MUSL_MIRROR="https://github.com/kraj/musl.git"
MUSL_REF="b1efda5b91735e33635376ca11c9b497a1c66e39"    # 2026-10-05

fetch() {  # repo ref dir [mirror]
  local repo="$1" ref="$2" dir="$3" mirror="${4:-}"
  if [[ -d "$dir/.git" ]]; then
    echo "$dir: already present"
    return
  fi
  git init -q "$dir"
  git -C "$dir" config core.autocrlf false   # byte-identical sources on Windows too
  git -C "$dir" remote add origin "$repo"
  git -C "$dir" -c protocol.version=2 fetch -q --depth 1 origin "$ref" \
    || { [[ -n "$mirror" ]] && git -C "$dir" remote set-url origin "$mirror" \
         && git -C "$dir" -c protocol.version=2 fetch -q --depth 1 origin "$ref"; }
  git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
  echo "$dir: $(git -C "$dir" rev-parse HEAD)"
}

fetch "$XCC_REPO" "$XCC_REF" "$ROOT/xcc"
fetch "$MUSL_REPO" "$MUSL_REF" "$ROOT/musl-src" "$MUSL_MIRROR"

if git -C "$ROOT/xcc" apply --check "$ROOT/patches/xcc.patch" 2>/dev/null; then
  git -C "$ROOT/xcc" apply "$ROOT/patches/xcc.patch"
  echo "xcc: patch applied"
else
  git -C "$ROOT/xcc" apply --reverse --check "$ROOT/patches/xcc.patch" 2>/dev/null \
    && echo "xcc: patch already applied" \
    || { echo "xcc: patches/xcc.patch does not apply" >&2; exit 1; }
fi
