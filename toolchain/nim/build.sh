#!/usr/bin/env bash
# =============================================================================
# Build nim.wasm + nim-bundle.js + nimbase.h FROM NIM SOURCE (via Emscripten).
#
# The Nim compiler is bootstrapped from source and then cross-compiled to wasm
# with Emscripten, producing the artifact shape the web app expects: an
# Emscripten module (`nim-bundle.js`) that loads `nim.wasm` and is driven via
# callMain(["c", ...]).
#
# Stages:
#   1. Bootstrap native Nim from csources_v2 (gcc) -> bin/nim, then a one-pass
#      boot to the pinned 2.0 compiler.
#   2. Have Nim emit C for the compiler itself (compiler/nim.nim).
#   3. emcc the generated C into nim.wasm + nim-bundle.js.
#   4. Pack the stdlib and config as libpacks (tools/pack-lib.sh).
#
# DESIGN NOTE (SPEC section 3): the stdlib is NOT baked into the wasm module.
# The old design passed `--preload-file lib@/nim/lib` and
# `--preload-file config@/nim/config` to emcc, embedding the stdlib in a
# nim-bundle.data blob. Here the compiler binary ships alone and the stdlib /
# config arrive as separate libpacks (libpacks/nim-stdlib.tar,
# libpacks/nim-config.tar) that the browser mounts into MEMFS at runtime.
# Adding or upgrading a library therefore never requires rebuilding nim.wasm.
# No empty /nim preload is needed: the web runtime creates /nim/lib and
# /nim/config via FS.mkdirTree while mounting the libpacks, before callMain.
#
# emsdk (Emscripten) is required for stage 3 and is pinned by versions.env.
# Run directly (native, EMSDK_DIR must be set) or via ./build.sh nim-docker.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$ROOT/versions.env"

OUT="${OUT:-$ROOT/$VENDOR_NIM_DIR}"
WORK="${WORK:-$HERE/work}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
PACK_LIB="${PACK_LIB:-$ROOT/tools/pack-lib.sh}"
mkdir -p "$OUT" "$WORK"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# tools/pack-lib.sh drives stage 4 (it is owned by the libpacks branch).
# Warn early if it is missing; stage 4 then skips instead of failing.
if [[ ! -f "$PACK_LIB" ]]; then
  say "WARNING: $PACK_LIB not found; stage 4 (libpacks) will be skipped."
  say "         Merge the libpacks branch or set PACK_LIB to its path."
fi

# --- Stage 1: bootstrap native Nim ------------------------------------------
SRC="$WORK/Nim"
if [[ ! -x "$SRC/bin/nim" ]]; then
  say "[1/4] bootstrapping Nim $NIM_VERSION from source"
  git clone "$NIM_REPO" "$SRC"
  git -C "$SRC" checkout "$NIM_REF"
  git clone "$NIM_CSOURCES_REPO" "$SRC/csources_v2"
  ( cd "$SRC/csources_v2" && sh build.sh )           # -> ../bin/nim (stage 1)
  git clone "$NIM_CHECKSUMS_REPO" "$SRC/dist/checksums"
  # one-pass boot to the pinned 2.0 compiler
  ( cd "$SRC" && ./bin/nim c -d:release -d:nimcore --lib:lib --noNimblePath \
        --path:dist/checksums/src --hints:off -o:bin/nim compiler/nim.nim )
else
  say "[1/4] native Nim present"
fi
export PATH="$SRC/bin:$PATH"
nim --version | head -1

# --- Stage 1b: harden stdlib getAppFilename() for wasi ----------------------
# nim.wasm is emitted with --os:linux (Stage 2), so getAppFilename() resolves
# the executable via readlink("/proc/self/exe"). Under Emscripten/wasi that
# path does not exist and readlink returns -1; Nim's os.getApplAux then does
# `setLen(result, -1)`, raising "value out of range: -1 notin 0 .. 2147483647"
# [RangeDefect] at compiler boot (fires on any input, e.g. `echo hi`).
#
# Add the missing `len < 0` guard so a failed readlink degrades to "" instead
# of crashing. This is applied to the checked-out source BEFORE Stage 2 (so the
# compiler binary is hardened) and BEFORE Stage 4 (so the packed nim-stdlib
# gets the same fix for user programs). Idempotent: re-runs are a no-op.
#
# NOTE: this guard only prevents the hard crash. Making the compiler's prefix
# resolve to /nim (=> /nim/lib, /nim/config) is done at runtime by the web
# loader (web/src/nim-compiler.js), which symlinks /proc/self/exe -> /nim/bin/nim
# so readlink succeeds and getPrefixDir() lands on /nim.
say "[1b/4] patching lib/pure/os.nim getApplAux (wasi readlink -1 guard)"
python3 - "$SRC/lib/pure/os.nim" <<'PY'
import sys
path = sys.argv[1]
src = open(path, encoding="utf-8").read()
marker = "wasi: readlink returned -1"
if marker in src:
    print("      already patched; skipping")
    sys.exit(0)
old = (
    "    if len > maxSymlinkLen:\n"
    "      result = newString(len+1)\n"
    "      len = readlink(procPath, result.cstring, len)\n"
    "    setLen(result, len)\n"
)
new = (
    "    if len > maxSymlinkLen:\n"
    "      result = newString(len+1)\n"
    "      len = readlink(procPath, result.cstring, len)\n"
    "    if len < 0: len = 0  # wasi: readlink returned -1 (/proc/self/exe absent); avoid setLen(-1) RangeDefect\n"
    "    setLen(result, len)\n"
)
if old not in src:
    print("      WARNING: getApplAux block not found (Nim layout changed?); leaving os.nim untouched", file=sys.stderr)
    sys.exit(0)
open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
print("      patched getApplAux")
PY

# --- Stage 2: emit C for the Nim compiler -----------------------------------
say "[2/4] generating C sources for the Nim compiler"
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
say "[3/4] linking with Emscripten -> nim.wasm + nim-bundle.js"
# Resolve a native emsdk even when this script is run directly: prefer an
# already-set EMSDK_DIR, else a toolchain provisioned by toolchain/setup-env.sh
# (persisted in .build-env), else the default clone location it uses.
# shellcheck disable=SC1091
[[ -z "${EMSDK_DIR:-}" && -f "$ROOT/.build-env" ]] && source "$ROOT/.build-env"
[[ -z "${EMSDK_DIR:-}" && -f "$ROOT/toolchain/emsdk/emsdk_env.sh" ]] && EMSDK_DIR="$ROOT/toolchain/emsdk"
[[ -n "${EMSDK_DIR:-}" && -f "${EMSDK_DIR:-}/emsdk_env.sh" ]] \
  || die "no usable emsdk (EMSDK_DIR unset or missing emsdk_env.sh).
     Prepare a bare environment automatically with:
       ./build.sh setup        # installs base deps + pinned emsdk $EMSDK_VERSION
     then re-run this build, or use the Docker path: ./build.sh nim-docker"
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh"

EM_EXPORTS='["callMain","FS","ENV","stringToNewUTF8","UTF8ToString"]'
# NOTE: no --preload-file. The stdlib and config ship as libpacks (stage 4),
# so no nim-bundle.data blob is produced.
#
# STACK_SIZE / INITIAL_MEMORY: Emscripten's default stack dropped from 5MB to
# 64KB in 3.1.27. The Nim compiler recurses deeply (parser, sem, and especially
# std/macros expansion), so a 64KB stack overflows and traps with
# "memory access out of bounds" during compilation (heap growth alone does NOT
# help — the stack is a separate, fixed region). 32MB stack matches Nim's own
# generous native default; INITIAL_MEMORY is raised to comfortably hold that
# stack + statics (the heap still grows on demand via ALLOW_MEMORY_GROWTH).
emcc \
  "$NIMCACHE"/*.c \
  -I"$SRC/lib" \
  -O2 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s STACK_SIZE=33554432 \
  -s INITIAL_MEMORY=134217728 \
  -s INVOKE_RUN=0 \
  -s EXIT_RUNTIME=1 \
  -s MODULARIZE=1 -s EXPORT_NAME=Nim \
  -s FORCE_FILESYSTEM=1 \
  -s EXPORTED_RUNTIME_METHODS="$EM_EXPORTS" \
  -o "$OUT/nim-bundle.js"
# emcc emits nim-bundle.js + nim-bundle.wasm; normalise the wasm name.
mv "$OUT/nim-bundle.wasm" "$OUT/nim.wasm"
cp "$SRC/lib/nimbase.h" "$OUT/nimbase.h"

# --- Stage 4: pack stdlib + config as libpacks ------------------------------
# Pack only when tools/pack-lib.sh is available AND the source dirs exist;
# nim.wasm itself is already built at this point, so a missing packer is a
# warning, not a failure (the packs can be produced later via ./build.sh libs).
if [[ -f "$PACK_LIB" && -d "$SRC/lib" && -d "$SRC/config" ]]; then
  say "[4/4] packing nim-stdlib and nim-config libpacks"
  bash "$PACK_LIB" nim-stdlib "$SRC/lib" /nim/lib
  bash "$PACK_LIB" nim-config "$SRC/config" /nim/config
else
  say "[4/4] skipping libpacks (pack-lib.sh or Nim source dirs missing)"
  say "      nim.wasm built fine; produce the packs later with './build.sh libs'"
fi

say "DONE"
ls -la "$OUT/nim.wasm" "$OUT/nim-bundle.js" "$OUT/nimbase.h" 2>/dev/null
if [[ -f "$PACK_LIB" && -d "$SRC/lib" && -d "$SRC/config" ]]; then
  say "stdlib/config shipped as libpacks (libpacks/nim-stdlib.tar, libpacks/nim-config.tar)"
fi
