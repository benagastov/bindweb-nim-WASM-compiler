# inc-cache — pre-generated TableGen outputs (THE 1-STAGE REVELATION)

## What this is

This directory contains the **pre-generated TableGen `.inc` files** for LLVM
8.0.1 / Clang 8 / LLD 8 (`binji/llvm-project` @ `5dc09c9`). They let you build
`clang.wasm` + `lld.wasm` for `wasm32-wasi` in **a single cross-compile stage**
— no native TableGen build required.

## Why it matters

A standard LLVM cross-build to a target that can't run the build tools is a
two-stage dance:

```
Stage 1 (native):   build llvm-tblgen + clang-tblgen for the build host
Stage 2 (wasm):     cross-compile clang + lld with TableGen pointing at stage-1
```

Stage 1 needs ~5-10 min and produces nothing the IDE ships. It exists only
because the build needs `*.inc` files generated from `*.td` files.

The **crazy idea** behind this cache: TableGen output is a deterministic
function of (input `.td` files + TableGen binary version + `-gen-*` flags).
Since we've already run TableGen once with the canonical LLVM 8.0.1 sources,
we can ship the `.inc` files themselves and **skip the entire native stage**.

## Layout (mirrors what `build-wasm/` would generate)

```
inc-cache/
├── include/llvm/IR/                       Attributes.inc, IntrinsicEnums.inc,
│   └── AttributesCompatFunc.inc...       IntrinsicImpl.inc, ...
├── lib/IR/                               AttributesCompatFunc.inc, ...
├── lib/Target/WebAssembly/               WebAssemblyGenAsmMatcher.inc, ...,
│                                          WebAssemblyGenDisassemblerTables.inc
├── lib/Target/X86/                       X86GenAsmMatcher.inc, ...,
│                                          X86GenRegisterInfo.inc, ...
├── lib/ToolDrivers/                      llvm-dwp/, llvm-lib/, ...
├── lib/Transforms/                       ...
└── tools/
    ├── clang/include/clang/AST/          DeclNodes.inc, StmtNodes.inc, ...
    ├── clang/include/clang/Basic/        AttrSubMatchRulesParserString.inc, ...
    ├── clang/include/clang/Driver/       ClangVirtualBackgroundEnums.inc,
    │                                      ClangSACheckers.inc,
    │                                      ClangTCExtensions.inc, ...
    ├── clang/include/clang/Parse/       AttrParserString.inc,
    │                                      AttrParserLookup.inc, ...
    ├── clang/include/clang/Sema/        AttrSpellingList.inc, ...
    ├── clang/include/clang/Serialization/ ...
    └── (tools/clang/lib/StaticAnalyzer/Checkers/Checkers.inc,
         tools/clang/lib/CodeGen/CGStmtOpenMP.inc, ...)
```

## How to use it (manual 1-stage build)

After CMake configures `build-wasm/` but **before** running `ninja`, copy the
cached `.inc` files into the build tree. Then ninja will treat the TableGen
custom commands as already-satisfied and skip the native stage entirely.

```bash
# 1. Configure (same as build.sh stage 2 — but you can drop -DLLVM_TABLEGEN / -DCLANG_TABLEGEN)
cmake -G Ninja -S "$SRC/llvm" -B "$WASMBUILD" \
  -DCMAKE_TOOLCHAIN_FILE=toolchain/clang-wasm/wasi-toolchain.cmake \
  -DWASI_SDK="$WASI_SDK" -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_ENABLE_PROJECTS="clang;lld" \
  -DLLVM_TARGETS_TO_BUILD="WebAssembly;X86" \
  -DLLVM_DEFAULT_TARGET_TRIPLE="wasm32-wasi" \
  -DLLVM_HOST_TRIPLE="wasm32-wasi" \
  -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_TERMINFO=OFF \
  -DLLVM_ENABLE_LIBPFM=OFF -DLLVM_ENABLE_BACKTRACES=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF \
  -DLLVM_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_BUILD_TOOLS=OFF \
  -DCMAKE_EXE_LINKER_FLAGS="-Wl,--export-dynamic -Wl,--allow-undefined -Wl,--export-table"

# 2. Pre-populate build-wasm with the cached .inc files
cp -rn toolchain/clang-wasm/inc-cache/. "$WASMBUILD/"

# 3. ninja will skip every TableGen step that already has its output
ninja -C "$WASMBUILD" clang lld
```

## What still needs to be in the source tree (kept in sync with this cache)

- The LLVM source under `toolchain/clang-wasm/work/llvm-project/` must be at
  the same commit the cache was generated from
  (`5dc09c94393510bc8d042a9f07382b53e845c0f2`, LLVM 8.0.1 / binji's fork).
- A single `.td` change in the source → regenerate the affected `.inc` and
  re-run TableGen on the host. Until then, this cache stays valid.

## How it was generated (the receipts)

On the build host (Linux), with the LLVM 8.0.1 source at the pinned commit:

```bash
# Stage 1: native TableGen tools (one-time, fast)
cmake -G Ninja -S $SRC/llvm -B $NATIVE \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_ENABLE_PROJECTS="clang" \
  -DLLVM_TARGETS_TO_BUILD="WebAssembly;X86" \
  -DLLVM_INCLUDE_TESTS=OFF
ninja -C $NATIVE llvm-tblgen clang-tblgen

# Stage 2: cross-compile clang + lld to wasm32-wasi
cmake -G Ninja -S $SRC/llvm -B $WASMBUILD \
  -DCMAKE_TOOLCHAIN_FILE=toolchain/clang-wasm/wasi-toolchain.cmake \
  -DWASI_SDK=$WASI_SDK ...   # same flags as build.sh
ninja -C $WASMBUILD clang lld

# Capture every .inc that the build produced:
mkdir -p toolchain/clang-wasm/inc-cache
cp -rn $WASMBUILD/include/. toolchain/clang-wasm/inc-cache/include/
cp -rn $WASMBUILD/lib/.      toolchain/clang-wasm/inc-cache/lib/
cp -rn $WASMBUILD/tools/.    toolchain/clang-wasm/inc-cache/tools/
```

The cache is a 1:1 snapshot of what the build produced. From then on, the
**only** thing needed for a rebuild is `ninja -C $WASMBUILD clang lld` — and
even the build-wasm configure can be skipped if you `cp -rn` the cache in
before invoking ninja.

## Size

~85 MB, 79 files. The cache replaces 5-10 min of native TableGen work, ~1 GB
of native build artifacts, and the entire `bin/` directory of stage-1 outputs.

## Why the .wasm artifacts in `IDE/static/clang/` matter

The `clang.wasm` and `lld.wasm` checked into `IDE/static/clang/` were built
from this same LLVM source using this exact same `inc-cache/` for the
`build-wasm` stage. The IDE's compile-each-link pipeline boots them in the
browser — no download, no prebuilt upstream artifact.