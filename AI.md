# AI.md — driving this IDE from another agent (human- and agent-readable)

This repo ships an in-browser IDE that compiles Nim to WebAssembly and
deploys it as a static website — entirely client-side. Everything the UI
can do is also exposed as `window.NimIDE`, a promise-based JavaScript API
(`web/src/ai-api.js`), so an AI or CLI agent driving the page (DevTools
console, CDP `Runtime.evaluate`, Playwright) can write code, build, read
the logs and pull the result out — no clicking required. The terse,
copy-paste-oriented version of this document is `SKILL.md`.

## Architecture recap

- **Two virtual folders in IndexedDB** (`web/src/vfs.js`): the *Project*
  folder is the Nim working folder the editor edits and the compiler
  mounts at `/workspace`; the *Site* folder is the deployed static webpage
  — Build output. The IDE's app pane renders the Site folder's
  `index.html` through blob: URLs.
- **Toolchain in wasm**: the Nim compiler and a C compiler run as
  WebAssembly modules in the page. The C compiler is wcc by default (fast,
  about 1 MB, and it hands off to clang when it can't build a program) or
  clang/lld (60 MB, loaded on first use). The download is about 12 MB with
  wcc and about 75 MB with clang. Choose per build with
  `build({compiler: 'wcc' | 'clang'})`. **Run**
  compiles the open file and executes it in the app pane; **Build**
  (`performBuild()` in `web/src/main.js`) compiles *every* `.nim` file in
  the project into its own self-contained `.wasm` in the Site folder.
- **Generated site**: `index.html` + one `.wasm` per module. The whole JS
  runtime (WASI shim, bindweb runtime, loader, boot script) is inlined
  into `index.html` (`web/src/site-template.js`), alongside a small
  config script (`window.__APP_WASM_URL__` + gate globals).
- **Domain binding**: a Nim app that calls `bindDomain("example.com")`
  gets its bound hostnames embedded into `index.html`; on any other
  domain the boot aborts before fetching a single byte and renders a fake
  Flask-style server 404 ("Not Found / The requested URL was not found on
  the server…"), and the runtime re-checks through an import guard. In
  the IDE preview the gate is disarmed — development is never blocked.

## The driving workflow, end to end

1. Open the IDE URL in a driveable browser and wait for readiness —
   `await window.NimIDE.ready()` (resolves `true` once both toolchains
   are loaded; `false` if initialization failed). `NimIDE.status()` shows
   the status-pill text at any time.
2. Write files with `NimIDE.writeFile(path, text)` (or
   `{binary: true}` + base64 for binary assets). Parent folders are
   created implicitly; `makeDir`/`deletePath`/`listFiles`/`readFile`
   round out the file ops. `area` selects the folder: `'project'`
   (default) or `'site'`.
   To upload a whole source tree use `NimIDE.syncFiles([[path, text], …])`:
   one transaction, unchanged files skipped, files not listed removed
   (56 files: ~2 s with `writeFile`, ~0.2 s with `syncFiles`).
3. Build with `const r = await NimIDE.build()`. This is *the exact
   Build-button flow* (same code path, same UI side effects, buttons
   disabled while it runs, unsaved editor changes saved first, one build
   at a time). The result is plain JSON:
   `{ok, summary, logs, deployed, skipped, siteFiles}` — `logs` holds
   every console line with its kind prefix, so compiler errors are
   greppable (`[error]`, `[warn]`, `[stderr]`).
4. Iterate: fix the source with more `writeFile` calls, rebuild, re-read
   `r.logs`. A failed entry compile gives `ok: false` and a friendly
   `summary`; non-entry failures are warnings listed in `skipped`.
5. Export with `const z = await NimIDE.exportZip('site')` →
   `{name: "site.zip", base64, files, bytes}`. Decode the base64
   agent-side and write it to disk (or ship it). `'project'` exports the
   source tree the same way. Unlike the toolbar buttons, this returns the
   archive instead of triggering a download dialog.

## Example session (DevTools console / page.evaluate)

```js
await window.NimIDE.ready();                                  // ~12 MB first load (wcc)
await window.NimIDE.writeFile('main.nim', 'echo "hi"\n');     // minimal program
const r = await window.NimIDE.build();
r.ok;          // true
r.deployed;    // ["main.wasm"]
r.siteFiles;   // ["index.html", "main.wasm"]
const z = await window.NimIDE.exportZip('site');
z.bytes;       // size of the zip in bytes
```

Then, agent-side (Node): `fs.writeFileSync(z.name, Buffer.from(z.base64, 'base64'))`.

## Rules of the road

- Wait for `ready()`; build time grows with the number of `.nim` files
  (each becomes its own wasm, compiled sequentially).
- Never start a second build while one is in flight — it is refused
  (`ok: false`). Await each `build()` before issuing the next.
- All return values are JSON-safe; use CDP `Runtime.evaluate` with
  `awaitPromise: true, returnByValue: true` and the objects arrive intact.
- The domain gate is a client-side check: it deters casual re-hosting,
  it is not cryptographic security.
