# Nim WASM Compiler

Write Nim in your browser, compile it to WebAssembly **entirely client-side**, and
run it immediately — no server, no installation for the end user. The page runs a
real Nim compiler (`nim.wasm`) and a real clang/lld (`clang.wasm`, `lld.wasm`)
as WebAssembly modules.

This is a clean-room rebuild of the `bindweb-nim-WASM-compiler` project with three
goals:

1. **One command to build.** `./start.sh` (or `start.bat` on Windows) takes a fresh
   clone to a running IDE. Anything already done is skipped on re-runs.
2. **No heavy compilation by default.** Both toolchains are fetched prebuilt,
   pinned and SHA-256-verified: the clang/lld toolchain (the hours-long,
   multi-GB-RAM LLVM build is never performed) and `nim.wasm` (the 20-40
   minute Nim build happens only as an offline fallback, or on explicit
   request when hacking on the compiler).
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
| 2/4 | Downloads the prebuilt `nim.wasm` toolchain (SHA-256-pinned; falls back to building from source — Docker preferred, otherwise a local emsdk — when the mirrors are unreachable) | `web/vendor/nim/nim.wasm` exists |
| 3/4 | Packs libpacks and assembles `dist/` | packs are newer than their sources |
| 4/4 | Serves `dist/` on http://localhost:8080 and opens your browser | already serving |

Power users get finer control:

```bash
./build.sh setup      # prepare a bare machine: base deps + pinned emsdk
./build.sh clang      # only fetch/verify the clang toolchain
./build.sh nim-fetch  # only fetch/verify the prebuilt nim.wasm toolchain
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

## Two working folders: Project and Site tabs

Think VS Code, but with two working directories, both persisted in your
browser (IndexedDB, `web/src/vfs.js`):

- **Project** — the *Nim working folder*: your codebase. Create/rename/delete
  files and folders, upload files, click a file to edit it in the Code tab
  (edits auto-save). Examples from the dropdown land here as real files under
  `examples/`. Before every compile the whole tree is mounted at
  `/workspace` in the compiler's in-memory filesystem, so multi-file
  projects work exactly like a local checkout: `import sibling`,
  `import sub/mod`.
- **Site** — the *deployed static webpage folder*: a real little static
  website. **Build** (next to Run) compiles the project entry (`main.nim`)
  and writes `app.wasm`, a generated `index.html`, and the runtime
  (`nim-runtime/*.js`) here. The app pane renders **this folder's
  `index.html`** — it is the site's working directory. "Open site in new
  tab" gives you the deployed page full-screen; you can also upload your
  own assets (CSS, images) — Build only refreshes `app.wasm`,
  `nim-runtime/*`, and an `index.html` that still carries the generated
  marker, so hand edits survive.

The two buttons, side by side:

| Button | Compiles | Result goes to |
|--------|----------|----------------|
| **Run** | the file open in the editor | the app pane directly (quick try-out) |
| **Build** | `main.nim` (the project entry) | the Site folder — the deployed page shown in the app pane |

The deployed page runs the *same* runtime the IDE uses: `run-wasm.js` and
`wasi-shim.js` are shared source files (`web/src/runtime/`), copied into
the site byte-for-byte (only their `export` prefixes are stripped).
Programs that `echo` render into the site's console card; bindweb DOM and
canvas apps render into the page body.

## Adding Nim libraries (libpacks)

```bash
tools/pack-lib.sh mylib path/to/mylib/src /mylib
```

This writes `libpacks/mylib.tar` and registers it in `libpacks/manifest.json`.
Re-run `./build.sh dist` (or `./start.sh`) and the IDE mounts it at `/mylib`
before every compile. **The compiler is not rebuilt.**

Mounting only puts the files in the in-browser filesystem — it does **not** put
them on Nim's module search path. For a new mount point, add it to `NIM_FLAGS`
in `web/src/nim-compiler.js`:

```js
'--path:/bindweb', '--path:/bindweb/nim', '--path:/nim/lib', '--path:/mylib',
```

Without that, `import mylib` fails with `Error: cannot open file: mylib`. (The
shipped packs already have their paths registered, which is why `import bindweb`
works out of the box.) See `libpacks/README.md` for details and conventions.

Shipped packs:

| Pack | Mount | Contents |
|------|-------|----------|
| `bindweb` | `/bindweb` | Bindweb browser-API bindings (`bindweb`, `bindwebevents`, `apis/*`) + the C runtime under `c/` |
| `nim-config` | `/nim/config` | optional `nim.cfg` defaults |
| `nim-stdlib` | `/nim/lib` | created automatically when `nim.wasm` is built |

## Adding libraries at runtime (Libraries tab)

End users can also install Nim libraries **from the IDE itself** — no
`pack-lib.sh`, no rebuild: open the **Libraries** tab next to the code editor
and either paste a GitHub link (e.g. `https://github.com/nim-lang/checksums`)
or upload a `.zip` of the library sources.

- The sources are fetched in the browser (GitHub API + `raw.githubusercontent.com`,
  with a CORS-proxy zip fallback), trimmed to compile-relevant files (`.nim`/`.c`/`.h`,
  `src/` layout detected, tests/docs/examples skipped) and stored in **IndexedDB**.
- Before every compile, each installed library is mounted at `/libs/<name>` and a
  matching `--path:/libs/<name>` flag is added — so `import checksums/sha2` just works.
- Adds/removes apply on the next Run; nothing is re-downloaded for the compiler
  itself.
- **Dependencies are handled for you**: after adding a library, its `.nimble`
  requirements are resolved against the official nimble registry
  (nim-lang/packages) and a dialog offers to install the missing ones.
  **Nothing installs without your confirmation** — if an installed package
  pulls in further dependencies of its own, the dialog lists them and asks
  again ("Install N more / Decline"), so every package is reviewed before it
  is fetched. Auto-installed packages appear in the list with a
  "via \<parent\>" note so you can tell them apart and remove them like any
  other. A per-library "Deps…" button re-checks at any time; packages that
  are not on github.com (or not in the registry) are reported so you can add
  them by hand.

This complements (not replaces) libpacks: packs are for libraries shipped *with*
the IDE, the Libraries tab is for libraries the *user* brings.

Known limitation of the preview compiler artifacts (`web/vendor/nim`, the
SPEC §8d prebuilt nim.wasm): libraries whose macros *generate new macro
definitions* — e.g. `protobuf-nim`'s `parseProto` — fail during macro
expansion on that specific build (`incorrect result proc symbol`). The same
code compiles fine with a stock Nim v2.0.14 and with a nim.wasm built fresh
from `./build.sh nim`. Libraries that only generate procs/types (most of
them, e.g. nim-lang/checksums, nimSHA2, combparser) work with either.

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
node tests/zip.test.mjs            # zip reader + GitHub URL parsing
node tests/tar.test.mjs            # tar writer/reader round-trips
node tests/manifest.test.mjs       # libpack manifest + tar validation
node tests/vfs.test.mjs            # working-folder path rules
node tests/site-template.test.mjs  # Build's site template + script stripping
bash -n start.sh build.sh          # script syntax
```

## Layout

```
start.sh / start.bat   one-click beginner entry
build.sh / Makefile    power-user targets
versions.env           every upstream pin
toolchain/             clang + prebuilt-nim fetch (SHA-256 pinned), nim.wasm build, patches
libpacks/              library packs + manifest + "add a library" guide
tools/                 pack-lib, make-dist, serve
web/                   the IDE (plain ES modules, no build step)
  src/vfs.js             Project + Site working folders (IndexedDB)
  src/site-template.js   Build's deployed-page template + URL rewriter
  src/runtime/           bindweb runtime, WASI shim, wasm runner (shared with the site)
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
