# toolchain/ — building the compilers from source

Four independent, pinned, reproducible builds. Each has a `build.sh` (the
recipe) and a `Dockerfile` (the recipe + an environment that satisfies its
prerequisites). All upstream commits live in [`versions.env`](versions.env).

| component        | upstream source                                                | cross-toolchain   | output (lands in `static/...`)             |
|------------------|----------------------------------------------------------------|-------------------|--------------------------------------------|
| `memfs/`         | `binji/wasm-clang` — `binji/memfs.c`, `stb_sprintf.h` (vendored as source) | wasi-sdk clang | `memfs.wasm`                               |
| `clang-wasm/`    | `binji/llvm-project` (LLVM 8.0.1 fork)                         | native + wasi-sdk | `clang.wasm`, `lld.wasm`, `sysroot.tar`    |
| `nim-wasm/`      | `nim-lang/Nim` v2.0.14                                         | gcc → nim, emsdk  | `nim.wasm`, `nim-bundle.js`, `nimbase.h`   |
| (patch)          | `benagastov/Nim-WASM-Compiler`'s `patch-clang-wasm.sh`         | python3           | `-fno-common` injection in `clang.js`      |
| (patch)          | this repo's `patch-worker-bindweb.sh`                          | python3           | try/catch wrap in `clang.js` worker        |

## How clang ends up running in a browser

`clang.wasm` and `lld.wasm` are LLVM's `clang`/`wasm-ld` compiled to
`wasm32-wasi`. A wasm module can't touch a real disk, so file I/O is serviced by
**memfs** — a small WASI implementation of an in-memory filesystem. At runtime
the IDE's JS (`clang.js`/`shared.js`) wires `memfs.wasm`'s exports into the
`wasi_unstable` imports that `clang.wasm` expects. The headers and libraries
clang compiles against come from `sysroot.tar`, untarred into memfs at startup.

So the four files are one system:
`clang.wasm` (the compiler) + `lld.wasm` (the linker) + `memfs.wasm` (its
filesystem) + `sysroot.tar` (its headers/libs).

## What "build from source" actually means here

The repo uses the **binji fork** of LLVM 8.0.1 as the source for the C/C++
compiler (`binji/llvm-project`, commit pinned in `versions.env`). This fork
already carries the wasm/memfs patches that the upstream LLVM tree does not.
Building from it produces a clang.wasm that has the **same shape** as binji's
demo (same exports, same supported wasi APIs) — but **not necessarily the same
bytes**, because the wasi-libc layout embedded by the cross-wasi-sdk determines
the module's static-data layout.

### Reproducibility reality check (measured in this repo)

| artifact     | pristine MD5 (binji/wasm-clang) | source identical to binji? | rebuild MD5 matches?         | what does match              |
|--------------|--------------------------------|----------------------------|------------------------------|------------------------------|
| memfs.wasm   | `9a155eb19e9010d0eeb4dce7d45e7054` (345,442 B) | YES — `memfs.c`+`stb_sprintf.h` byte-for-byte | NO — different wasi-libc version embeds different static data; we get `da3efa59111389385bae4b0fbe5582ef` (41,826 B) with wasi-sdk 11 | exports (30) + imports (5) identical — names, counts, types |
| clang.wasm   | `fd63fc9e39f1c08200518e6b59da5d81` (31,214,472 B) | source = binji/llvm-project @ pinned commit | NO — different clang host version produces different object code | inputs accepted, `-fno-common` patch applied via `clang.js`, same resource dir (`8.0.1`) |
| lld.wasm     | `4264aa35d1bc5fd10ba91d61d0048033` (19,490,094 B) | same | NO | same wasm-ld flags, same defaults |
| sysroot.tar  | `60410a2bff1b8578c9a929a457cb5d6b` (9,297,920 B) | yes — assembled from wasi-sdk + libcxx + clang builtin headers | YES-ish if wasi-sdk ref unchanged | layout `/include`, `/lib/clang/8.0.1/include`, `/lib/wasm32-wasi/*.a` |

If your goal is **bit-for-bit** MD5 match, you must use the exact upstream
wasi-sdk binji used (wasi-sdk-5). If your goal is a working in-browser Nim→wasm
toolchain that the IDE accepts, the binji-fork rebuild is correct: the IDE
only checks that memfs exports the right names and that clang.js carries the
`-fno-common` patch.

## The one decision you should make: which LLVM

**Faithful (default): binji's LLVM fork, pinned (`LLVM_REF` in versions.env).**
This is LLVM 8.0.1-era and carries the wasm/memfs patches already. Choosing it
means "recreate the *same* compiler, from source" — the artifacts match the
shape of what the IDE was built around, and the memfs.c here (which includes the
old `<wasi/core.h>`) lines up with it. Downside: LLVM 8 is ancient; modern C++
support is limited and you're building old code with a newer host compiler.

**Modern: upstream LLVM (e.g. 18) with the memfs VFS shim re-applied.**
More maintainable and a much better C/C++ compiler, but it's real work: binji's
file-I/O patch has to be ported to current LLVM, and `memfs.c` updated to the
modern `<wasi/api.h>` (`MEMFS_WASI_API=modern` + `WASI_SDK_REF_MODERN`). Choose
this if your users actually need modern C++ in the browser. Budget porting time;
it cannot be a drop-in pin bump.

The build scripts default to faithful. Switching to modern is a documented set
of edits, not a rewrite — but it is not free.

## Running a build

Each builds in isolation. Each has two execution modes:

### Mode A — Docker (recommended, what CI does)

```bash
docker build -t nimwasm/memfs toolchain/memfs   && docker run --rm -v "$PWD/out:/out" nimwasm/memfs
docker build -t nimwasm/clang toolchain/clang-wasm && docker run --rm -v "$PWD/out:/out" nimwasm/clang
docker build -t nimwasm/nim   toolchain/nim-wasm   && docker run --rm -v "$PWD/out:/out" nimwasm/nim
```

Or all of them + install into the IDE: `make toolchain && make ide` from the
repo root. Or none of them locally: push and use the `build-toolchain` workflow.

### Mode B — direct invocation on this sandbox (no Docker)

This sandbox has cmake 3.25.1, ninja 1.11.1, gcc/g++, and wasi-sdk 11.0.0 at
`/workspace/wasi-sdk/`. memfs builds in a couple of seconds; clang-wasm is the
heavy LLVM cross-build (30–90 min, ≥16 GB RAM).

```bash
# memfs: produces a 42 KB module with identical exports/imports to the pristine 345 KB
cd toolchain/memfs
WASI_SDK=/workspace/wasi-sdk ./build.sh /workspace/nim-bindweb/toolchain/memfs/out

# clang + lld: a faithful-LLVM-8 two-stage cross-build
cd toolchain/clang-wasm
WASI_SDK=/workspace/wasi-sdk ./build.sh
```

### After all four pieces are built

```bash
# Copy fresh artifacts into the IDE's static/ tree AND apply both clang.js patches
make ide
# (Both patches are now invoked by `make ide` itself — see "Running both patches
#  from the source tree" below. No manual patching step is needed.)
```

If you prefer to run the patches by hand (e.g. against a vendored clang.js
that didn't come from this repo's `make toolchain`), they are both
idempotent and accept explicit paths:

```bash
./toolchain/clang-wasm/patch-clang-js.sh        bindweb-nim-browser/static/clang/clang.js
./toolchain/clang-wasm/patch-worker-bindweb.sh  bindweb-nim-browser/static/clang/clang.js
```

## The clang.js patch (`-fno-common`)

`clang.js` is the JS driver binji ships in `binji/wasm-clang`. It embeds a
base64 web worker. The Nim→wasm pipeline traps in LLVM 8.0.1's
WebAssembly object writer (`WasmObjectWriter`) when Nim-emitted C
contains tentative definitions (`int x;` at file scope) because clang 8
defaults to `-fcommon`, which marks them `common`-linkage globals, and the
writer hits `llvm_unreachable` on those. The fix: inject `-fno-common`
into the embedded `clang -cc1` invocation.

The injector is `patch-clang-wasm.sh` (vendored from
`benagastov/Nim-WASM-Compiler`). It:
1. Extracts the base64 worker blob from `clang.js`.
2. Substitutes `"-Oz","-fno-common","-o",i,"-x","c"` for the original
   `"-Oz","-o",i,"-x","c"` (exactly one site).
3. Re-encodes the base64 and writes the file back.

Idempotent: re-running on an already-patched file is a no-op.

## The clang.js patch (worker try/catch) — **required for Nim + Bindweb**

The first patch above (`-fno-common`) is enough to make `clang.js` compile and
link a Nim-emitted C program into `app.wasm`. It is **not enough** to make the
worker report success to the host page when the linked program is a Nim
**Bindweb** app.

The reason is structural. `binji/wasm-clang`'s worker embeds a
`compile-each-link` case that does the full compile + link + run cycle inside
the web worker:

```
1. clang -cc1 -emit-obj  (each .c)
2. wasm-ld --allow-undefined ... -o app.wasm
3. WebAssembly.compile(app.wasm) and then s.run(inst, out)
   which WebAssembly.instantiate(app.wasm, {wasi_unstable: ...}) and calls _start
```

For a **plain wasi-libc hello-world** app, step 3 succeeds: the only imports
the linked module needs are the `wasi_unstable` functions the worker already
provides, so `instantiate` resolves cleanly and `_start` runs.

For a **Nim Bindweb** app, the linked `app.wasm` also imports a `env`
namespace — `env.bindweb_js_flush`, `env.bindweb_js_create`,
`env.bindweb_js_set_attr`, and friends — that the Nim runtime uses to push
DOM commands into JavaScript. These imports are unresolved at link time
(`wasi-ld --allow-undefined` lets linking succeed anyway). The worker's
hardcoded import object, however, only contains `wasi_unstable`. So
`WebAssembly.instantiate` throws a `LinkError`.

The upstream worker code does **not** wrap step 3 in `try`/`catch`:

```js
const finalResult = await s.run(inst, h.out);
i.postMessage({id: "compile-each-link-done", data: finalResult ? {ok:true} : {ok:false}});
```

The `LinkError` escapes the case block before `postMessage` is reached. The
host page's `compileEachLink` Promise therefore hangs forever. The only thing
keeping the IDE alive was a 25 s `Promise.race` safety timeout in the host
page — and even then, the page had to do all the recovery work itself.

The fix is `toolchain/clang-wasm/patch-worker-bindweb.sh`. It:

1. Extracts the base64 worker blob from `clang.js`.
2. Locates the exact un-patched substring
   `const finalResult=await s.run(inst,h.out);i.postMessage({id:"compile-each-link-done",data:finalResult?{ok:true}:{ok:false}});break;}`
   (exactly one site, by construction).
3. Replaces it with a try/catch variant that:
   - Always posts `compile-each-link-done` (so the host page's
     `compileEachLink` Promise resolves).
   - On LinkError, logs a warning naming the expected cause (missing `env`
     imports) and posts `{ok:false, linked:true}` so the host page knows
     the wasm was linked but not run.
4. Re-encodes the base64 and writes the file back.

Idempotent: detects `let finalResult=null;try{finalResult=await s.run(inst,h.out);}catch(e){console.log("WARN: app.wasm instantiation failed in worker`
in the decoded worker and aborts with "already patched" if found.

The linked `app.wasm` is left in the worker's memfs regardless. The host
page's STEP 3 then re-instantiates it with the proper Nim Bindweb `env` +
a minimal `wasi_snapshot_preview1` shim, and runs `_start` itself.

### How the host page uses the linked flag

After the patch, `compileEachLink` resolves with one of:

- `{ok:true}`              — `app.wasm` compiled, linked, and `_start` ran (plain wasi app).
- `{ok:false, linked:true}` — `app.wasm` compiled and linked, but `_start`
                              failed (Bindweb env imports unresolved in the worker).
                              The wasm is still in memfs; STEP 3 picks it up.
- `{ok:false}`             — compile or link itself failed.

The host page only treats `{ok:true}` as full success. `{ok:false, linked:true}`
is the **expected** path for Nim Bindweb apps and proceeds to STEP 3 (re-instantiate
with the proper env).

### Bumping the cache-bust

If you rebuild and re-install `clang.js`, the host page imports it as
`./static/clang/clang.js?v=<bump>`. Bump the query string whenever the worker
source changes, otherwise browsers may cache the old, un-patched worker.

## Running both patches from the source tree

`make ide` (run after `make toolchain`) copies the freshly-built artifacts
into `bindweb-nim-browser/static/...` and then runs **both** patch scripts in
order:

```bash
make toolchain    # build clang.wasm, lld.wasm, memfs.wasm, nim.wasm from source
make ide          # copy into static/ + apply both clang.js patches (idempotent)
make serve        # serve the IDE locally on :8080
```

A fresh source clone, plus Docker, plus `make toolchain && make ide && make serve`,
produces an IDE that compiles and runs Nim Bindweb apps end-to-end. No manual
patching step is required — the patches live in `toolchain/clang-wasm/`
alongside the build recipes and are part of the reproducible build.

## Network notes

- `clang-wasm` and `memfs` Dockerfiles fetch a **wasi-sdk** release tarball. If
  your network blocks GitHub *release assets* (some do, while still allowing
  `git`), either build wasi-sdk from source or vendor the tarball and `COPY` it
  in instead of the `curl` line. The pins are in `versions.env`.
- `nim-wasm` runs `emsdk install`, which downloads Emscripten's toolchain on
  first use; build with connectivity or prime the emsdk cache.
- The Nim *bootstrap* (csources → koch) needs only `git` + a C compiler and is
  verified to work on a stock Ubuntu box.

## Verification

After the artifacts are in `static/clang/` and `static/nim/`, sanity-check
the bundle end-to-end:

```bash
# 1. wasm binaries are well-formed WebAssembly modules
for f in bindweb-nim-browser/static/clang/*.wasm \
         bindweb-nim-browser/static/nim/nim.wasm; do
  node -e "WebAssembly.compile(require('fs').readFileSync(process.argv[1])).then(()=>console.log('OK',process.argv[1]))" "$f"
done

# 2. memfs exports the names clang.wasm's wasi_unstable imports expect
node -e '
  const fs=require("fs");
  WebAssembly.compile(fs.readFileSync("bindweb-nim-browser/static/clang/memfs.wasm")).then(m=>{
    const e=WebAssembly.Module.exports(m).map(x=>x.name);
    const need=["fd_read","fd_write","fd_close","path_open","fd_seek","fd_prestat_get","fd_prestat_dir_name","fd_filestat_get"];
    const miss=need.filter(n=>!e.includes(n));
    if(miss.length) throw new Error("memfs missing exports: "+miss.join(","));
    console.log("memfs exports: OK");
  });'

# 3. clang.js carries the -fno-common patch
python3 -c "
import re, base64, sys
s=open('bindweb-nim-browser/static/clang/clang.js').read()
m=re.search(r'\(a=\"([A-Za-z0-9+/=]+)\",G=null', s)
w=base64.b64decode(m.group(1)).decode('utf8','replace')
assert '\"-fno-common\"' in w, 'clang.js is NOT patched (-fno-common missing)'
print('clang.js patch: OK')
"

# 4. serve and click Build & Run in the browser
```
