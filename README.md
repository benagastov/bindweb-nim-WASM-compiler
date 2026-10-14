# Nim → WebAssembly in-browser IDE

A one-command rebuild of the in-browser Nim → WebAssembly IDE. `start.sh` (or
`start.bat` on Windows) takes a fresh clone to a running IDE on
http://localhost:8080; the `dist/` it produces is the static site published
on the `gh-pages` branch of this repo and served at:

> **https://benagastov.github.io/bindweb-nim-WASM-compiler/**

## Repository layout

| Path        | Branch    | What                                              |
|-------------|-----------|---------------------------------------------------|
| `start.sh`, `build.sh`, `web/`, `libpacks/`, `toolchain/`, ... | `main` | Source code: the rebuild pipeline |
| `index.html`, `static/`, `bindweb-*.js`           | `gh-pages` | Built IDE, served by GitHub Pages |

The two branches share no source. `gh-pages` is the **output** of running
`./start.sh` on the `main` checkout; it's overwritten whenever the build is
refreshed.

## Build the IDE locally

```bash
./start.sh          # Linux / macOS
start.bat           # Windows (needs Docker Desktop)
```

The script:
1. Installs the fast C compiler, wcc (prebuilt in `toolchain/wcc/`), and
   downloads the prebuilt clang toolchain (npm `clang.js@0.1.1`).
2. Downloads (or builds from source, as fallback) the prebuilt `nim.wasm`.
3. Packs `libpacks/` and assembles `dist/`.
4. Serves `dist/` on http://localhost:8080.

Power-user targets (`./build.sh setup | wcc | clang | nim | nim-docker | libs | dist | serve`)
are documented in this repo's `README.md` and the `Makefile`.

## How to refresh the live demo (`gh-pages`)

```bash
# in this checkout
./start.sh
# then publish dist/ to gh-pages:
git switch gh-pages
rsync -a --delete dist/ .
git add -A
git commit -m "rebuild IDE"
git push origin gh-pages
```

## Using the IDE: Build and Export ZIP

**Run** compiles only the file open in the editor and runs it in the app
pane. **Build** compiles *every* `.nim` file in the Project tree into its
own self-contained `.wasm` in the Site folder, mirroring the project
paths (`adios.nim` → `adios.wasm`, `sub/mod.nim` → `sub/mod.wasm`); each
module statically includes the Nim runtime, wasi-libc and the bindweb C
runtime. The generated `index.html` boots the **build entry** (see below)
and carries the whole
JS runtime (WASI shim, bindweb runtime, loader, boot script) inlined into
it — so a generated site is just `index.html`
plus one `.wasm` per module, with no `nim-runtime/` folder. If a
non-entry file fails to compile it is skipped with a warning; if the
entry fails, the Build fails. Build keeps a hand-edited `index.html` —
only then does it write/refresh `nim-runtime/*` (legacy mode), so pages
referencing `nim-runtime/*.js` keep working — and it removes stale
`.wasm` files that no longer match a project `.nim` source (including a
legacy `app.wasm`) — an uploaded `.wasm` file sharing no name with a
project module is removed on Build; non-wasm uploads are never touched.

### The build entry: which module the site boots

Every `.nim` file becomes its own `.wasm`, but the site's `index.html`
starts exactly one of them — the **build entry**. The Project tab marks it
with a `build entry` badge.

- By default the entry is `main.nim` → `main.wasm`.
- **Picking an example** from the Examples menu saves it as
  `examples/<name>.nim`, opens it, and makes it the build entry, so both
  **Run** and **Build** show that example. Your `main.nim` is not touched.
- To choose another entry, press the **entry** button on any `.nim` row
  in the Project tab (e.g. on `main.nim` to switch back).
- The choice is remembered in this browser and follows the file through
  renames and moves. If the entry file is deleted, Build falls back to
  `main.nim` (then to the open `.nim` file) and says so in Messages.

The Build log names the module it boots, for example
`build: index.html generated (boots examples/rotate.wasm; …)`.

Scripted builds don't use the entry picked in the page:
`NimIDE.build()` / `NimIDE.buildEntry()` boot `main.nim` unless you pass
`{entry: 'path/to/file.nim'}`. That keeps CLI and agent builds
deterministic whatever a person last clicked in the GUI.

### The C compiler: Fast (wcc) or Compatible (clang)

Nim compiles to C, and a C compiler turns that into WebAssembly. The
**C compiler** menu in the header picks it:

- **Fast (wcc)** (the default) is [xcc](https://github.com/tyfkda/xcc)'s wcc,
  built as WebAssembly with musl's math and float formatting. The download is
  about 1 MB instead of 60 MB, and it compiles about 7× faster than clang.
  If wcc can't build a program, the IDE builds it with clang instead, without
  you doing anything. The output is not optimized, so heavy apps run somewhat
  slower than an optimized clang build.
- **Compatible (clang)** is the original toolchain, binji's clang 8. It is
  downloaded on first use.

The choice is remembered in this browser. Scripted builds pass
`{compiler: 'wcc' | 'clang'}` (see below). `toolchain/wcc/README.md`
describes the toolchain.

**Export ZIP** (in both the Project and Site toolbars) downloads the whole
folder — files and empty folders — from the browser's IndexedDB store as
`project.zip` / `site.zip`. The archives are written by the
dependency-free ZIP writer in `web/src/zip.js` (stored entries, correct
CRC-32, UTF-8 names), the same module that reads library zips.

## Driving the IDE without a GUI (AI / CLI agents)

The IDE installs **`window.NimIDE`** (`web/src/ai-api.js`): a promise-based,
JSON-only API that can do everything the UI can — write project/site files,
run the exact Build-button flow with captured logs, and export either
folder as a base64 zip. It's meant for AI or CLI agents driving the page
via the DevTools console, CDP `Runtime.evaluate`, or Playwright:

```js
await NimIDE.ready();
await NimIDE.writeFile('main.nim', 'echo "hi"\n');
const r = await NimIDE.build();          // {ok, summary, logs, deployed, …}
await NimIDE.build({entry: 'examples/rotate.nim'}); // boot another module
await NimIDE.build({compiler: 'clang'});  // pick the C compiler ('wcc' | 'clang')
const z = await NimIDE.exportZip('site'); // {name, base64, files, bytes}
```

See **`SKILL.md`** (agent skill file with the full API reference and
copy-paste snippets) and **`AI.md`** (architecture recap + end-to-end
driving workflow) at the repo root.

## Domain binding

Call `bindDomain("example.com")` (the snake_case spelling `bind_domain`
works too) early in your Nim program. It adds three layers of enforcement:

- **Build-time boot gate** — Build scans your sources for `bindDomain`
  calls and embeds the bound hostnames into the generated `index.html`.
  On any other domain the page wipes itself, renders a fake Flask-style
  server 404 ("Not Found — The requested URL was not found on the
  server…") and aborts *before fetching a single byte* — the network tab
  stays clean, so there is nothing to steal, and a thief sees a boring
  server error rather than a protection mechanism. When the domain
  matches, the wasm manifest is fetched strictly one-by-one in manifest
  order.
- **Runtime guard** — the app re-checks the hostname through the new
  `env.bindweb_js_domain_guard` import; a mismatch locks the page and
  quits. Inside the IDE (Run / dev preview) the guard only warns once and
  always passes, so development is never blocked.
- **Nim API** — `bindDomain` is part of the bindweb libpack
  (`libpacks/src/bindweb`), documented in `bindweb.nim`.

**Honest caveat:** these are client-side checks. They deter casual theft,
re-hosting and drive-by debugging; they are *not* cryptographic security —
a determined attacker with time can patch any check that runs in their own
browser.

## Build performance

Builds are cached and parallel. An unchanged project skips Nim→C, and
unchanged C files come from an object cache. With clang, oversized C files
are split into codegen units and compiled on a pool of clang workers
(QGraph: 133 s → 41 s cold, 3.5 s rebuild). With wcc, the default, the C
step itself is about 7× faster. A cold QGraph build takes 16.6 s in total,
and its C part 4.3 s instead of about 30 s. Details, numbers and profiling
switches are in **`PERFORMANCE.md`**.

## Toolchain notes

All compilers ship as prebuilt WebAssembly modules, pinned and SHA-256
verified. wcc is committed in `toolchain/wcc/prebuilt/` and rebuilds from
pinned sources (see `toolchain/wcc/README.md`). Building `nim.wasm` from source is supported as a fallback (Docker
preferred, then a local emsdk) but never required for a first run. See
`SETUP-zero-env.md` and the `FIXES-*.md` notes for the few C/WASM patches
the in-browser pipeline needs.

## License

See `LICENSE`.
