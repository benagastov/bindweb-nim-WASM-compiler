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
1. Downloads the prebuilt clang toolchain (npm `clang.js@0.1.1`).
2. Downloads (or builds from source, as fallback) the prebuilt `nim.wasm`.
3. Packs `libpacks/` and assembles `dist/`.
4. Serves `dist/` on http://localhost:8080.

Power-user targets (`./build.sh setup | clang | nim | nim-docker | libs | dist | serve`)
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
runtime. The generated `index.html` boots the entry module (`main.nim` →
`main.wasm`, falling back to the open `.nim` file) and carries the whole
JS runtime (WASI shim, bindweb runtime, loader, boot script) inlined as
ONE obfuscated payload script — so a generated site is just `index.html`
plus one `.wasm` per module, with no `nim-runtime/` folder. If a
non-entry file fails to compile it is skipped with a warning; if the
entry fails, the Build fails. Build keeps a hand-edited `index.html` —
only then does it write/refresh `nim-runtime/*` (legacy mode), so pages
referencing `nim-runtime/*.js` keep working — and it removes stale
`.wasm` files that no longer match a project `.nim` source (including a
legacy `app.wasm`) — an uploaded `.wasm` file sharing no name with a
project module is removed on Build; non-wasm uploads are never touched.

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
const z = await NimIDE.exportZip('site'); // {name, base64, files, bytes}
```

See **`SKILL.md`** (agent skill file with the full API reference and
copy-paste snippets) and **`AI.md`** (architecture recap + end-to-end
driving workflow) at the repo root.

## Protecting your app (obfuscation + domain binding)

Every wasm the IDE produces — via **Run** or **Build** — is obfuscated on
the way out (`web/src/wasm-obfuscate.js`): the `name` custom section (what
makes Chrome DevTools show readable Nim symbols) and the `producers`
section (which leaks "language: Nim" and the toolchain versions) are
stripped, and a decoy `.comment` section carrying a classic
`GCC: (GNU) 12.2.0` signature is injected, so casual analysis tools report
a GCC-built C binary. Everything that affects execution passes through
byte-identical — the module runs exactly the same.

The generated site's JavaScript runtime is obfuscated too: the minified
runtime scripts + boot code are concatenated into one payload, XOR+base64
encoded, and decoded at page load via `(new Function(decode("…")))()`
(`web/src/site-template.js`), so view-source and the site file tree show
only gibberish. The tiny config script (`window.__APP_WASM_URL__` and the
domain-gate globals) stays plaintext. The wasm import keys
(`bindweb_js_flush`, `bindweb_wgpu_*`, …) remain visible after decoding —
they are dictated by the wasm binary's import section.

For domain binding, call `bindDomain("example.com")` (the snake_case
spelling `bind_domain` works too) early in your Nim program. It adds three
layers of enforcement:

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

## Toolchain notes

Both compilers ship as prebuilt WebAssembly modules, pinned and SHA-256
verified. Building `nim.wasm` from source is supported as a fallback (Docker
preferred, then a local emsdk) but never required for a first run. See
`SETUP-zero-env.md` and the `FIXES-*.md` notes for the few C/WASM patches
the in-browser pipeline needs.

## License

See `LICENSE`.
