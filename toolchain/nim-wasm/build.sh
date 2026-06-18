#!/usr/bin/env bash
# =============================================================================
# Build nim.wasm + nim-bundle.js + nimbase.h FROM NIM SOURCE (via Emscripten).
#
# Replaces copying the prebuilt nim.wasm. The Nim compiler is bootstrapped from
# source and then cross-compiled to wasm with Emscripten, producing the same
# shape of artifact the IDE expects: an Emscripten module (`nim-bundle.js`)
# that loads `nim.wasm`, mounts Nim's stdlib (lib/) into MEMFS, and is driven
# via callMain(["c", ...]).
#
# Stages:
#   1. Bootstrap native Nim from csources_v2 (gcc) -> bin/nim, then koch boot.
#      (This stage is verified to work on a stock Ubuntu box.)
#   2. Have Nim emit C for the compiler itself (compiler/nim.nim).
#   3. emcc the generated C into nim.wasm + nim-bundle.js, preloading lib/.
#
# emsdk (Emscripten) is required for stage 3 and is pinned by versions.env.
# Run in Docker/CI; emsdk's installer pulls toolchains from the network.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/versions.env"

OUT="${OUT:-$HERE/out}"
WORK="${WORK:-$HERE/work}"
JOBS="${JOBS:-$(nproc)}"
mkdir -p "$OUT" "$WORK"

# --- Stage 1: bootstrap native Nim ------------------------------------------
SRC="$WORK/Nim"
if [[ ! -x "$SRC/bin/nim" ]]; then
  echo "[1/3] bootstrapping Nim $NIM_VERSION from source"
  git clone "$NIM_REPO" "$SRC"
  git -C "$SRC" checkout "$NIM_REF"
  git clone "$NIM_CSOURCES_REPO" "$SRC/csources_v2"
  ( cd "$SRC/csources_v2" && sh build.sh )           # -> ../bin/nim (stage 1)
  git clone "$NIM_CHECKSUMS_REPO" "$SRC/dist/checksums"
  # one-pass boot to the pinned 2.0 compiler
  ( cd "$SRC" && ./bin/nim c -d:release -d:nimcore --lib:lib --noNimblePath \
        --path:dist/checksums/src --hints:off -o:bin/nim compiler/nim.nim )
else
  echo "[1/3] native Nim present"
fi
export PATH="$SRC/bin:$PATH"
nim --version | head -1

# --- Stage 2: emit C for the Nim compiler -----------------------------------
echo "[2/3] generating C sources for the Nim compiler"
NIMCACHE="$WORK/nimcache"
rm -rf "$NIMCACHE"; mkdir -p "$NIMCACHE"
# --compileOnly + --genScript leaves all .c plus a compile script in nimcache.
( cd "$SRC" && nim c \
    --compileOnly:on --genScript:on \
    --nimcache:"$NIMCACHE" \
    -d:release -d:nimcore --lib:lib --noNimblePath \
    --path:dist/checksums/src \
    --os:linux --cpu:wasm32 --mm:orc -d:useMalloc \
    --hints:off -o:nim.js compiler/nim.nim )

# --- Stage 3: emcc -> nim.wasm + nim-bundle.js ------------------------------
echo "[3/3] linking with Emscripten -> nim.wasm + nim-bundle.js"
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh"

EM_EXPORTS='["callMain","FS","ENV","stringToNewUTF8","UTF8ToString"]'
emcc \
  "$NIMCACHE"/*.c \
  -I"$SRC/lib" \
  -O2 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INVOKE_RUN=0 \
  -s EXIT_RUNTIME=1 \
  -s MODULARIZE=1 -s EXPORT_NAME=Nim \
  -s FORCE_FILESYSTEM=1 \
  -s EXPORTED_RUNTIME_METHODS="$EM_EXPORTS" \
  --preload-file "$SRC/lib@/nim/lib" \
  --preload-file "$SRC/config@/nim/config" \
  -o "$OUT/nim-bundle.js"
# emcc emits nim-bundle.js + nim-bundle.wasm + nim-bundle.data; normalise names
mv "$OUT/nim-bundle.wasm" "$OUT/nim.wasm"
cp "$SRC/lib/nimbase.h" "$OUT/nimbase.h"

echo "============================================================"
echo " DONE"
ls -la "$OUT/nim.wasm" "$OUT/nim-bundle.js" "$OUT/nimbase.h" 2>/dev/null
echo " (nim-bundle.data holds the preloaded stdlib; ship it alongside)"
echo "============================================================"
