#!/usr/bin/env bash
# =============================================================================
# Build clang.wasm + lld.wasm + sysroot.tar FROM LLVM SOURCE.
#
# This replaces the practice of copying binji's prebuilt clang.wasm/lld.wasm.
# The compiler is built from the pinned LLVM *source* (versions.env), so users
# can patch LLVM/Clang and rebuild — which is the entire point.
#
# Two-stage build (standard for cross-compiling LLVM to a target that can't run
# the build tools):
#
#   Stage 1 (native): build llvm-tblgen + clang-tblgen for the build host.
#   Stage 2 (wasm)   : using the wasi-sdk clang as the cross compiler, build
#                      `clang` and `lld` as wasm32-wasi modules, pointing the
#                      tablegen executables at the stage-1 native build.
#
# Then assemble sysroot.tar — the header/lib tree the *in-browser* clang
# targets — from the wasi-sdk sysroot + libc++ + the clang resource headers,
# laid out exactly how the IDE launches clang:
#     -isysroot / -internal-isystem /include/c++/v1
#     -internal-isystem /include -internal-isystem /lib/clang/$LLVM_RESOURCE_VER/include
#
# RESOURCES: this is a full LLVM build. Budget ~25-40 GB disk and >=16 GB RAM
# for the link step, and expect 30-90 min on a many-core machine. It will NOT
# complete on a tiny box; run it in Docker/CI (see Dockerfile and
# .github/workflows/build-toolchain.yml).
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
source "$ROOT/versions.env"

OUT="${OUT:-$HERE/out}"
WORK="${WORK:-$HERE/work}"
JOBS="${JOBS:-$(nproc)}"
mkdir -p "$OUT" "$WORK"

: "${WASI_SDK:=/opt/wasi-sdk}"
WASI_SYSROOT="$WASI_SDK/share/wasi-sysroot"

echo "============================================================"
echo " clang.wasm / lld.wasm / sysroot.tar — from-source build"
echo "   LLVM      : $LLVM_REPO @ $LLVM_REF"
echo "   wasi-sdk  : $WASI_SDK (sysroot: $WASI_SYSROOT)"
echo "   jobs      : $JOBS"
echo "   out       : $OUT"
echo "============================================================"

# --- Fetch LLVM source (pinned) ----------------------------------------------
SRC="$WORK/llvm-project"
if [[ ! -d "$SRC/.git" ]]; then
  echo "[1/5] cloning LLVM source (pinned)"
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$LLVM_REPO"
  git -C "$SRC" fetch -q --depth 1 origin "$LLVM_REF"
  git -C "$SRC" checkout -q FETCH_HEAD
else
  echo "[1/5] LLVM source present"
fi

# --- Stage 1: native tablegen ------------------------------------------------
NATIVE="$WORK/build-native"
if [[ ! -x "$NATIVE/bin/llvm-tblgen" ]]; then
  echo "[2/5] stage 1: native llvm-tblgen + clang-tblgen"
  cmake -G Ninja -S "$SRC/llvm" -B "$NATIVE" \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLVM_ENABLE_PROJECTS="clang" \
    -DLLVM_TARGETS_TO_BUILD="WebAssembly;X86" \
    -DLLVM_INCLUDE_TESTS=OFF
  ninja -C "$NATIVE" -j"$JOBS" llvm-tblgen clang-tblgen
else
  echo "[2/5] stage 1 tablegen present"
fi

# --- Stage 2: cross-build clang + lld to wasm32-wasi -------------------------
echo "[3/5] stage 2: cross-compile clang + lld -> wasm32-wasi"
WASMBUILD="$WORK/build-wasm"
cmake -G Ninja -S "$SRC/llvm" -B "$WASMBUILD" \
  -DCMAKE_TOOLCHAIN_FILE="$HERE/wasi-toolchain.cmake" \
  -DWASI_SDK="$WASI_SDK" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_ENABLE_PROJECTS="clang;lld" \
  -DLLVM_TARGETS_TO_BUILD="WebAssembly;X86" \
  -DLLVM_DEFAULT_TARGET_TRIPLE="wasm32-wasi" \
  -DLLVM_HOST_TRIPLE="wasm32-wasi" \
  -DLLVM_TABLEGEN="$NATIVE/bin/llvm-tblgen" \
  -DCLANG_TABLEGEN="$NATIVE/bin/clang-tblgen" \
  -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_TERMINFO=OFF \
  -DLLVM_ENABLE_LIBPFM=OFF -DLLVM_ENABLE_BACKTRACES=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF \
  -DLLVM_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_BUILD_TOOLS=OFF \
  -DLLVM_TABLEGEN_FLAGS="" \
  -DCMAKE_EXE_LINKER_FLAGS="-Wl,--export-dynamic -Wl,--allow-undefined -Wl,--export-table"

# Build only the two binaries the IDE actually runs.
ninja -C "$WASMBUILD" -j"$JOBS" clang lld

# --- Collect clang.wasm / lld.wasm ------------------------------------------
echo "[4/5] collecting clang.wasm + lld.wasm"
# In a wasm32-wasi build, the produced executables ARE wasm modules.
cp "$WASMBUILD/bin/clang" "$OUT/clang.wasm"
# lld builds several driver flavors; wasm-ld is the WebAssembly driver.
if   [[ -f "$WASMBUILD/bin/wasm-ld" ]]; then cp "$WASMBUILD/bin/wasm-ld" "$OUT/lld.wasm"
elif [[ -f "$WASMBUILD/bin/lld"     ]]; then cp "$WASMBUILD/bin/lld"     "$OUT/lld.wasm"
else echo "ERROR: no lld/wasm-ld produced" >&2; exit 1; fi

# --- Assemble sysroot.tar ----------------------------------------------------
# Layout matches the IDE's clang launch args (see shared.js clangCommonArgs):
#   /include/c++/v1                          libc++ headers
#   /include                                 wasi-libc headers
#   /lib/clang/$LLVM_RESOURCE_VER/include    clang builtin headers
#   /lib/wasm32-wasi/*.a, crt1.o             libc/libc++ static libs + startup
echo "[5/5] assembling sysroot.tar (resource ver $LLVM_RESOURCE_VER)"
SR="$WORK/sysroot"
rm -rf "$SR"; mkdir -p "$SR/include" "$SR/lib/clang/$LLVM_RESOURCE_VER/include" "$SR/lib/wasm32-wasi"
# headers + libs from wasi-sdk sysroot
cp -a "$WASI_SYSROOT/include/."          "$SR/include/"
cp -a "$WASI_SYSROOT/lib/wasm32-wasi/."  "$SR/lib/wasm32-wasi/"
# clang builtin headers from the build we just produced
CLANG_HDRS="$(find "$WASMBUILD/lib/clang" -maxdepth 2 -name include -type d | head -1 || true)"
[[ -n "$CLANG_HDRS" ]] && cp -a "$CLANG_HDRS/." "$SR/lib/clang/$LLVM_RESOURCE_VER/include/"
# clang builtins archive (so the in-browser link finds __multi3 etc.)
find "$WASI_SDK" -name 'libclang_rt.builtins-wasm32.a' -exec \
     cp {} "$SR/lib/clang/$LLVM_RESOURCE_VER/lib/wasi/libclang_rt.builtins-wasm32.a" \; 2>/dev/null || \
  { mkdir -p "$SR/lib/clang/$LLVM_RESOURCE_VER/lib/wasi"; \
    find "$WASI_SDK" -name 'libclang_rt.builtins-wasm32.a' -exec cp {} "$SR/lib/clang/$LLVM_RESOURCE_VER/lib/wasi/" \; ; }
( cd "$SR" && tar cf "$OUT/sysroot.tar" . )

echo "============================================================"
echo " DONE"
ls -la "$OUT/clang.wasm" "$OUT/lld.wasm" "$OUT/sysroot.tar"
echo "============================================================"
