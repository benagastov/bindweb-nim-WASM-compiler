# Provenance — toolchain/vendor-src/clang.js

`clang.js` in this directory is the **JavaScript driver** for the in-browser
clang toolchain (the web worker that runs `clang.wasm` / `lld.wasm` against an
in-memory filesystem and exposes `init` / `compileEachLink` / `getFile`).

## Origin

Derived from the `clang.js` npm package, v0.1.1
(<https://github.com/luoxuhai/clang.js>, Apache-2.0), which itself packages
Ben Smith's (binji) wasm-clang worker from the CppCon 2019 demo. The upstream
file is NOT used verbatim: the base64-embedded worker blob has been patched
for the Nim pipeline. Keeping the patched file in the repo means a fresh
checkout needs no patch step — and the patches stay reviewable in git history.

## Patches applied inside the embedded worker blob

1. **`-fno-common` (cc1)** — clang < 11 defaults to `-fcommon`; Nim's generated
   C contains tentative definitions (`threadId`, allocator roots, …) which are
   then emitted as `common`-linkage globals, and LLVM 8.0.1's wasm object
   writer hits `llvm_unreachable` serializing them. `-fno-common` emits
   ordinary `.bss` definitions instead. (Root-caused by delta-debugging in the
   predecessor project; see git history of patch-clang-js.sh.)
2. **try/catch around the worker's built-in WASI runner** — after linking, the
   stock worker instantiates `app.wasm` with a hardcoded WASI-only import
   object. Bindweb apps have extra `env.bindweb_js_*` imports, so
   instantiation throws a `LinkError` that used to wedge the worker forever.
   The worker now catches it and still posts `compile-each-link-done`
   (`{ok:false, linked:true}`); the pipeline instantiates the module itself
   with the proper imports.
3. **`clock_time_get` shim** — the stock worker's WASI shim throws
   `wasi_unstable.clock_time_get not implemented`, which every
   `clang -cc1 -emit-obj` reaches via `createUniqueFile → GetRandomNumber →
   time()` fallback. Replaced with a shim that writes a u64 ns timestamp into
   module memory and returns 0 (same shape as the adjacent `random_get`).
4. **`-Oz → -O0` (cc1)** — the predecessor toolchain's clang.wasm trapped in
   the `-O0`-adjacent pass pipeline; `-O0` also compiles noticeably faster in
   the browser. With the current (binji release) clang.wasm this is a
   performance choice, not a workaround — flip back to `-Oz` for smaller
   output by editing the blob (see below).

The same patches can be re-applied to a pristine upstream clang.js with
`toolchain/patches/patch-clang-js.sh`, `toolchain/patches/patch-worker.sh`
and `toolchain/patches/patch-worker-blob.mjs` (all idempotent).

## The binary artifacts are fetched, not committed

`clang.wasm`, `lld.wasm`, `memfs.wasm`, `sysroot.tar` are downloaded from the
pinned `clang.js` npm release by `toolchain/fetch-clang.sh` and verified
against `toolchain/SHA256SUMS.clang`. They are the binaries binji published
with his LLVM fork's releases — the only ones known to work. (A from-source
LLVM rebuild of these is possible but produces a clang.wasm whose pass
registry is broken at runtime — see `toolchain/clang-sources/README.md`.)

## Editing the driver

The file is minified upstream JS plus a readable worker source embedded as a
base64 string literal. To change worker behavior (compile flags, link flags,
file handling), decode the blob, edit, and re-encode. The pattern is in
`toolchain/patches/patch-worker-blob.mjs` — a minimal decode looks like:

```bash
node -e 'const s=require("fs").readFileSync("toolchain/vendor-src/clang.js","utf8");
const m=s.match(/"([A-Za-z0-9+/=]{1000,})"/);
console.log(Buffer.from(m[1],"base64").toString("latin1"))' > worker.js
```

Edit `worker.js`, then re-embed it with the same base64 splice (see
`patch-worker-blob.mjs`, which does exactly this for its two patches).
After editing, copy the file to `web/vendor/clang/clang.js` (or re-run
`./build.sh clang`) and refresh the IDE.
