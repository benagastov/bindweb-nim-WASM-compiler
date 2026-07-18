# Building clang.wasm from source (advanced, unsupported)

**You almost certainly do not need this.** The default build
(`./build.sh clang`) downloads the prebuilt `clang.wasm`, `lld.wasm`,
`memfs.wasm` and `sysroot.tar` (from the pinned `clang.js` npm release, which
republishes binji's official LLVM-fork binaries), verifies them against
`toolchain/SHA256SUMS.clang`, and installs the already-patched JS driver from
`toolchain/vendor-src/`. That is the supported path.

> **Warning — the from-source build is currently broken.** A from-source
> build of binji's LLVM fork produces a `clang.wasm` that starts, parses, and
> then traps in the pass registry
> (`PMTopLevelManager::schedulePass: null function` / "Pass is not
> initialized") the moment it tries to emit an object file — reproducibly in
> the browser and under standalone WASI runtimes. Only the prebuilt binaries
> from the LLVM fork's releases work. Keep this in mind before spending an
> hour on the build below.

This document describes the alternative — compiling LLVM/Clang/LLD to
`wasm32-wasi` yourself — for the rare case where you need to patch LLVM
itself. It is **unsupported**: expect to debug the build on your own.

## What you would be building

binji's wasm-clang artifacts are produced from his LLVM fork:

- repo: `https://github.com/binji/llvm-project` (branch `master`)
- pinned ref: see `LLVM_REF` in `versions.env` (LLVM 8.0.1-era; the fork
  carries the patches that let clang/lld run as wasm32-wasi modules and talk
  to an in-memory filesystem, `memfs`)

The build is a standard two-stage cross-compile:

1. **Stage 1 (native):** build `llvm-tblgen` and `clang-tblgen` for the build
   host with the system toolchain.
2. **Stage 2 (wasm):** cross-compile `clang` and `lld` to `wasm32-wasi` using
   the wasi-sdk clang, pointing CMake at the stage-1 tablegen binaries.
   `memfs.c` (binji's in-memory FS) is compiled the same way.
3. **Assemble `sysroot.tar`** from the wasi-sdk sysroot + libc++ + the clang
   resource headers, laid out exactly how the in-browser clang is launched:
   `-isysroot / -internal-isystem /include -internal-isystem /include/c++/v1
   -internal-isystem /lib/clang/8.0.1/include`.

The cross toolchain is **wasi-sdk 12** (`WASI_SDK_REF_LEGACY` in
`versions.env`) — the last series whose wasi-libc still ships `<wasi/core.h>`,
which binji's `memfs.c` includes. Porting `memfs.c` to the modern
`<wasi/api.h>` lets you move to wasi-sdk 24.

## Resource requirements

This is a full LLVM build:

- **Disk:** ~25–40 GB
- **RAM:** >= 16 GB for the link step
- **Time:** ~30–90 minutes on a many-core machine

It will not complete on a small VM or a typical laptop without swap tuning.

## Pointer to the previous implementation

A complete, working from-source build (build script, CMake shims, wasi
toolchain file, Dockerfile) exists in the predecessor repository under
`toolchain/clang-wasm/` and `toolchain/memfs/`. Port that machinery into this
directory if you need it; the pins in `versions.env` (`LLVM_REPO`/`LLVM_REF`,
`WASI_SDK_*`) already match what it expects.

## Why prebuilt is the default

- **Reproducibility with less fragility:** a pinned URL + SHA-256 hash is a
  smaller trust surface than a multi-hour build that depends on wasi-sdk
  release tarballs, CMake, and host RAM.
- **Speed:** the fetch takes seconds; the from-source build takes up to 1.5
  hours and 40 GB.
- **CI cost:** building LLVM in CI is slow and flaky on hosted runners; the
  workflow in `.github/workflows/build.yml` therefore only fetches, verifies,
  and patches the prebuilt artifacts. LLVM is **never** built in CI.
