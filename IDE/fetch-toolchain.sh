#!/usr/bin/env bash
# =============================================================================
# fetch-toolchain.sh — put the compiler artifacts into static/ the RIGHT way.
#
# This REPLACES the old reproduce.sh, which cloned a third-party repo and copied
# prebuilt clang.wasm/lld.wasm/etc. (originally binji's). Those blobs can't be
# modified. This script instead gets artifacts that were built FROM SOURCE:
#
#   ./fetch-toolchain.sh build   # build everything from source via Docker (default)
#   ./fetch-toolchain.sh ci      # download the latest from-source CI artifacts (gh CLI)
#
# Either way, what lands in static/ is reproducible from the pinned sources in
# ../toolchain (see ../toolchain/versions.env).
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
MODE="${1:-build}"

CLANG_DST="$HERE/static/clang"
NIM_DST="$HERE/static/nim"
mkdir -p "$CLANG_DST" "$NIM_DST"

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' required for mode '$MODE'." >&2; exit 1; }; }

case "$MODE" in
  build)
    echo ">> Building the toolchain FROM SOURCE (Docker)."
    need docker
    ( cd "$REPO_ROOT" && make toolchain && make ide )
    ;;

  ci)
    echo ">> Downloading the latest from-source CI artifacts."
    need gh
    TMP="$(mktemp -d)"
    gh run download --repo "${GH_REPO:-OWNER/REPO}" \
       --name clang --name memfs --name nim --dir "$TMP"
    cp "$TMP"/clang.wasm "$TMP"/lld.wasm "$TMP"/sysroot.tar "$TMP"/memfs.wasm "$CLANG_DST/"
    cp "$TMP"/nim.wasm "$TMP"/nim-bundle.js "$TMP"/nimbase.h "$NIM_DST/"
    rm -rf "$TMP"
    echo "   (set GH_REPO=owner/repo to point at your fork)"
    ;;

  *)
    echo "usage: $0 [build|ci]" >&2; exit 2 ;;
esac

echo ""
echo ">> Verifying artifacts are present and structurally valid..."
ERR=0
for f in "$CLANG_DST/clang.wasm" "$CLANG_DST/lld.wasm" "$CLANG_DST/memfs.wasm" \
         "$CLANG_DST/sysroot.tar" "$CLANG_DST/clang.js" \
         "$NIM_DST/nim.wasm" "$NIM_DST/nim-bundle.js" "$NIM_DST/nimbase.h"; do
  if [[ -f "$f" ]]; then echo "  OK  $f ($(stat -c%s "$f" 2>/dev/null || echo '?') bytes)"
  else echo "  MISSING  $f"; ERR=1; fi
done

if command -v node >/dev/null 2>&1 && [[ -f "$CLANG_DST/clang.wasm" ]]; then
  node -e '
    const fs=require("fs");
    WebAssembly.compile(fs.readFileSync(process.argv[1])).then(m=>{
      const imp=[...new Set(WebAssembly.Module.imports(m).map(i=>i.module))];
      console.log("  clang.wasm import modules:", imp.join(", "));
    }).catch(e=>{console.error("  clang.wasm INVALID:",e.message);process.exit(1)});
  ' "$CLANG_DST/clang.wasm" || ERR=1
fi

[[ $ERR -eq 0 ]] && echo ">> Ready. Serve with:  python3 -m http.server 8080" || { echo ">> Incomplete."; exit 1; }
