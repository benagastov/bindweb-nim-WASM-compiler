# Nim WASM Compiler

Write Nim in your browser, compile it to WebAssembly **entirely client-side**, and
run it immediately — no server, no installation for the end user. The page runs a
real Nim compiler (`nim.wasm`) and a real clang/lld (`clang.wasm`, `lld.wasm`)
as WebAssembly modules.

This is a clean-room rebuild of the `bindweb-nim-WASM-compiler` project with three
goals:

1. **One command to build.** `./start.sh` (or `start.bat` on Windows) takes a fresh
   clone to a running IDE. Anything already done is skipped on re-runs.
2. **No heavy compilation by default.** The clang/lld toolchain is fetched
   prebuilt, pinned and SHA-256-verified — the hours-long, multi-GB-RAM LLVM build
   is never performed. The only thing ever compiled is `nim.wasm`, and even that
   is skipped when a prebuilt copy is present.
3. **Libraries are separate files.** Nim libraries ship as *libpacks* — plain tar
   archives mounted into the compiler's in-memory filesystem at runtime. Adding a
   library never requires recompiling the compiler.

## Quickstart

```bash
./start.sh        # Linux/macOS — fetch, build (only what's needed), serve, open browser
start.bat         # Windows (uses Docker Desktop)
```

Then press **Run** in the page. First visit downloads ~75 MB of compiler
artifacts; everything is static and caches well.

What `start.sh` does, in plain terms:

| Step | Action | Skipped when |
|------|--------|--------------|
| 1/4 | Downloads the prebuilt clang toolchain (npm `clang.js@0.1.1`, hash-verified) | already in `web/vendor/clang/` |
| 2/4 | Builds `nim.wasm` from Nim source (Docker preferred, native emsdk fallback) | `web/vendor/nim/nim.wasm` exists |
| 3/4 | Packs libpacks and assembles `dist/` | packs are newer than their sources |
| 4/4 | Serves `dist/` on http://localhost:8080 and opens your browser | already serving |

Power users get finer control:

```bash
./build.sh clang      # only fetch/verify the clang toolchain
./build.sh nim        # only build nim.wasm (the "edit Nim compiler features" target)
./build.sh nim-docker # same, inside Docker (zero local deps beyond Docker)
./build.sh libs       # only repack libpacks
./build.sh dist       # only assemble dist/
./build.sh serve      # serve dist/ on :8080
make all              # Makefile wrappers for all of the above
```

## How it works

```
 your Nim code ──▶ nim.wasm (Nim → C) ──▶ C fixups ──▶ clang.wasm (-cc1 → .o)
                                                              │
                       libpacks (tar) mounted into MEMFS       ▼
                       /bindweb, /nim/lib, /nim/config   lld.wasm (wasm-ld)
                                                              │
                          browser DOM/Canvas ◀── bindweb runtime JS ◀── app.wasm
```

- `nim.wasm` runs `nim c --compileOnly` against an in-memory filesystem and emits C.
- The pipeline applies three documented C fixups (2-arg `main` rewrite for wasi's
  crt1, a weak `raise()` stub, and inlining of `bindweb_runtime.c` from the
  bindweb libpack).
- `clang.wasm` compiles each translation unit (`-cc1 -emit-obj -O0 -fno-common`),
  `lld.wasm` links with `--allow-undefined --export-table`.
- The resulting `app.wasm` is instantiated with the Bindweb `env` imports; the app
  pushes DOM/Canvas commands into a shared buffer that the JS runtime executes.

## Adding Nim libraries (libpacks)

```bash
tools/pack-lib.sh mylib path/to/mylib/src /mylib
```

This writes `libpacks/mylib.tar` and registers it in `libpacks/manifest.json`.
Re-run `./build.sh dist` (or `./start.sh`) and the IDE mounts it at `/mylib`
before every compile — `import mylib` just works. **The compiler is not
rebuilt.** See `libpacks/README.md` for details and conventions.

Shipped packs:

| Pack | Mount | Contents |
|------|-------|----------|
| `bindweb` | `/bindweb` | Bindweb browser-API bindings (`bindweb`, `bindwebevents`, `apis/*`) + the C runtime under `c/` |
| `nim-config` | `/nim/config` | optional `nim.cfg` defaults |
| `nim-stdlib` | `/nim/lib` | created automatically when `nim.wasm` is built |

## Hacking the Nim compiler's wasm build

Edit anything under `toolchain/nim/` (build flags, Nim version pin in
`versions.env`, the Emscripten link step), then:

```bash
./build.sh nim        # one compile; bootstrap is cached in toolchain/nim/work/
./build.sh dist serve # or just ./start.sh again
```

That is the *only* compile step. The clang side never rebuilds.

To change the clang driver's behavior (compile/link flags, worker quirks), edit
the embedded worker in `toolchain/vendor-src/clang.js` — see
`toolchain/vendor-src/PROVENANCE.md` for how the file is structured and which
four patches it carries (`-fno-common`, worker try/catch, `clock_time_get` shim,
`-Oz → -O0`).

## Reproducibility

- Every upstream pin lives in `versions.env` (Nim `v2.0.14`, emsdk `3.1.69`,
  clang.js npm `0.1.1`).
- Fetched binaries are verified against `toolchain/SHA256SUMS.clang`; the install
  aborts on mismatch.
- Libpacks are deterministic tars (sorted, owner-less, ustar, epoch mtimes).
- No wasm blobs are committed to git; `web/vendor/` and `dist/` are build outputs.

**A note on the clang binaries:** they come from the `clang.js` npm release, which
republishes the official binaries of binji's LLVM fork — currently the only
`clang.wasm` known to work in the browser. Building the same LLVM from source
(`toolchain/clang-sources/`) produces a `clang.wasm` whose pass registry traps at
runtime (`PMTopLevelManager::schedulePass: null function`), in both the browser
and standalone WASI runtimes. Until that upstream issue is fixed, the prebuilt
binaries are the supported path; the from-source path is documented for
experimenters only.

## Testing

```bash
node tests/tar.test.mjs        # tar writer/reader round-trips
node tests/manifest.test.mjs   # libpack manifest + tar validation
bash -n start.sh build.sh      # script syntax
```

## Layout

```
start.sh / start.bat   one-click beginner entry
build.sh / Makefile    power-user targets
versions.env           every upstream pin
toolchain/             clang fetch (+vendor-src driver), nim.wasm build, patches
libpacks/              library packs + manifest + "add a library" guide
tools/                 pack-lib, make-dist, serve
web/                   the IDE (plain ES modules, no build step)
tests/                 zero-dependency node tests
.github/workflows/     CI: build nim.wasm, pack libs, assemble site
```

## Credits

- Ben Smith (binji) — wasm-clang demo and the LLVM fork binaries are built from.
- luoxuhai — `clang.js` npm packaging (Apache-2.0).
- io-eric — WebCC, which the Bindweb framework was forked from.
- Nim — https://nim-lang.org.

## License

MIT (see LICENSE). Upstream components retain their own licenses.
