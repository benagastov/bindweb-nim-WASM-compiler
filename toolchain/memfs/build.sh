#!/usr/bin/env bash
# =============================================================================
# Build memfs.wasm FROM SOURCE.
#
# memfs is the WASI in-memory filesystem that clang.wasm / lld.wasm run on top
# of. It is NOT a magic blob: it is ~1k lines of C (src/memfs.c) plus
# stb_sprintf. This script reproduces it exactly, mirroring binji's original
# Makefile:
#
#     memfs.o      : clang --sysroot=$WASI_SYSROOT -O2 -c memfs.c
#     stb_sprintf.o: clang --sysroot=$WASI_SYSROOT -DSTB_SPRINTF_IMPLEMENTATION -x c -c stb_sprintf.h
#     memfs.wasm   : wasm-ld -L$WASI_SYSROOT/lib/wasm32-wasi --no-entry \
#                            --export-dynamic --allow-undefined -o memfs.wasm *.o -lc
#
# The only input that is not local source is the wasi-sdk (sysroot + clang),
# which provides libc headers/libs for the wasm target. It is fetched/pinned
# by versions.env.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/versions.env"

OUT="${1:-$HERE/out}"
mkdir -p "$OUT"

# WASI_SDK must point at an extracted wasi-sdk (bin/clang, share/wasi-sysroot).
# In Docker/CI it is installed at /opt/wasi-sdk (see Dockerfile). Locally you
# can export WASI_SDK=/path/to/wasi-sdk before running.
: "${WASI_SDK:=/opt/wasi-sdk}"
CLANG="$WASI_SDK/bin/clang"
WASMLD="$WASI_SDK/bin/wasm-ld"
SYSROOT="$WASI_SDK/share/wasi-sysroot"

if [[ ! -x "$CLANG" ]]; then
  echo "ERROR: wasi-sdk clang not found at $CLANG" >&2
  echo "       Set WASI_SDK to an extracted wasi-sdk, or build inside Docker." >&2
  exit 1
fi

echo "[memfs] clang     = $CLANG"
echo "[memfs] sysroot   = $SYSROOT"
echo "[memfs] out       = $OUT"

cd "$HERE/src"

echo "[memfs] compiling stb_sprintf.o"
"$CLANG" --sysroot="$SYSROOT" -DSTB_SPRINTF_IMPLEMENTATION -x c -O2 \
         -c -o "$OUT/stb_sprintf.o" stb_sprintf.h

echo "[memfs] compiling memfs.o"
"$CLANG" --sysroot="$SYSROOT" -O2 -Wall -Wextra -Wno-unused-parameter \
         -c -o "$OUT/memfs.o" memfs.c

echo "[memfs] linking memfs.wasm"
"$WASMLD" -L"$SYSROOT/lib/wasm32-wasi" \
          --no-entry --export-dynamic --allow-undefined \
          -o "$OUT/memfs.wasm" "$OUT/memfs.o" "$OUT/stb_sprintf.o" -lc

echo "[memfs] DONE -> $OUT/memfs.wasm"
ls -la "$OUT/memfs.wasm"

# Quick structural sanity: memfs must EXPORT the host-side wasi shims that
# shared.js wires into clang/lld's wasi_unstable imports.
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs=require("fs");
    WebAssembly.compile(fs.readFileSync(process.argv[1])).then(m=>{
      const e=WebAssembly.Module.exports(m).map(x=>x.name);
      const need=["fd_read","fd_write","fd_close","path_open","copy_in","copy_out"];
      const have=need.filter(n=>e.includes(n));
      console.log("[memfs] exports present:", have.join(", ") || "(none — check wasi api version)");
    });
  ' "$OUT/memfs.wasm" || true
fi
