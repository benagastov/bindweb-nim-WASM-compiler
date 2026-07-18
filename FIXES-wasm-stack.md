# Fix: `memory access out of bounds` during compilation (wasm stack overflow)

## Symptom
After the `getAppFilename` boot crash was fixed, `nim.wasm` boots and mounts the
libpacks, then traps mid-compile:

```
nim: 0 C files from /project/cache (rc=-1)
[nim] callMain threw: memory access out of bounds
```

## Root cause
Emscripten reduced the **default stack size from 5 MB to 64 KB** in release
3.1.27. This build pins emsdk 3.1.69 (post-change) and the emcc link set
`ALLOW_MEMORY_GROWTH=1` (heap can grow) but **never set `STACK_SIZE`**, so the
compiler ran with a 64 KB stack. The Nim compiler is deeply recursive — parser,
semantic analysis, and especially `std/macros` expansion (which the bindweb
examples use) — and overflows a 64 KB stack, which manifests as a wasm
`memory access out of bounds` trap. Heap growth does not help: the stack is a
separate, fixed region sized only by `STACK_SIZE`.

This is why the failure moved from boot (the old `RangeDefect`) to the compile
phase: boot now succeeds, and the trap fires once real recursion starts.

## Change — `toolchain/nim/build.sh`, Stage 3 emcc link
Added:

```
  -s STACK_SIZE=33554432 \      # 32 MB — matches Nim's generous native stack
  -s INITIAL_MEMORY=134217728 \ # 128 MB — must hold the 32 MB stack + statics
```

`ALLOW_MEMORY_GROWTH=1` remains, so the heap still grows on demand; these two
settings only ensure a large enough stack region and an initial memory big
enough to contain it. Rebuild `nim.wasm` (`./build.sh nim`) for this to take
effect — it changes the linked binary, not runtime JS.

If you ever want a clearer diagnostic than "out of bounds", do a one-off debug
link with `-s ASSERTIONS=2 -s STACK_OVERFLOW_CHECK=2`; it prints an explicit
"stack overflow" message instead of a bare trap.

## Also cleaned up
`web/src/main.js` no longer prefetches `nim/nim-bundle.data`. This build emits no
`.data` blob (stdlib/config ship as libpacks, and emcc runs without
`--preload-file`), so that entry only produced a harmless `404`.
