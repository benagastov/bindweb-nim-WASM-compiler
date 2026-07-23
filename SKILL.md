---
name: bindweb-ide-driver
description: >-
  Use when you need to build a Nim WebAssembly web app through the bindweb
  in-browser IDE without a GUI — write project files, run the Build
  pipeline, read compiler logs, and export the deployed site as a base64
  zip by driving the window.NimIDE API via the DevTools console, CDP
  Runtime.evaluate, or Playwright.
---

# bindweb-ide-driver

Drive the Nim → WASM in-browser IDE (`web/index.html`, served from the
dist root — e.g. http://localhost:8080 or the gh-pages deployment) from
another agent session. The IDE installs `window.NimIDE` (implemented in
`web/src/ai-api.js`, wired up in `web/src/main.js`) — a promise-based,
JSON-only API that can do everything the UI can.

## Prerequisites

- The IDE URL is open in a browser you can evaluate JavaScript in:
  Chrome DevTools console, CDP (`Runtime.evaluate` with
  `awaitPromise: true, returnByValue: true`), or Playwright
  (`page.evaluate`).
- First load downloads ~75 MB of toolchain (clang + Nim as wasm). Wait
  for readiness before building:

```js
await window.NimIDE.ready(); // resolves true once Run/Build would be enabled
window.NimIDE.status();      // e.g. "Ready — press Run"
```

## API reference (`window.NimIDE`)

All methods are async (return Promises) and return plain JSON-serializable
objects. `area` is `'project'` (the Nim working folder) or `'site'` (the
deployed static webpage folder); it defaults to `'project'` everywhere.

| Method | Returns | Notes |
|---|---|---|
| `version` | string | API version (property, not a method). |
| `ready()` | `Promise<boolean>` | true once toolchains loaded. |
| `status()` | string | current status-pill text. |
| `listFiles(area?)` | `[{path, isDir, size, updatedAt}]` | folders and files, path order. |
| `readFile(path, area?)` | `null \| {path, binary, size, text?}` or `{…, base64?}` | text in `.text`; binary base64 in `.base64`. |
| `writeFile(path, textOrBase64, {binary?, area?}?)` | `{path, bytes}` | creates parent folders; base64 when `binary: true`. |
| `makeDir(path, area?)` | `{path}` | idempotent. |
| `deletePath(path, area?)` | `{deleted}` | folders delete recursively. |
| `build()` | `{ok, summary, logs, deployed, skipped, siteFiles}` | the EXACT Build-button flow. |
| `exportZip(area?)` | `{name, base64, files, bytes}` | zip as base64 — no download dialog. |

`build()` runs the same pipeline as the Build button: it saves the open
editor file first, compiles every `.nim` in the project (entry `main.nim`
or the open file), writes one `.wasm` per module into the site folder,
regenerates `index.html` (obfuscated runtime payload), and returns:

- `ok` — false when the entry file failed to compile (or nothing to build);
- `summary` — the one-line result (same as the last console line);
- `logs` — every log line emitted during the build, prefixed with its
  kind (`[step]`, `[warn]`, `[error]`, `[stdout]`, `[stderr]`, …);
- `deployed` — site-relative wasm paths, entry first;
- `skipped` — non-entry `.nim` files that failed to compile (warnings);
- `siteFiles` — every file in the Site folder after the build.

## Copy-paste driving session

```js
// 1. Wait for the toolchain (first load: ~75 MB download, then init).
if (!(await window.NimIDE.ready())) throw new Error('toolchain failed to load');

// 2. Write the app.
await window.NimIDE.writeFile('main.nim', `
import bindweb, bindwebtypes
import apis/handles, apis/dom, apis/system

proc main() =
  let body = getBody()
  let h = createElement("h1")
  setInnerText(h, "Hello from Nim WASM")
  appendChild(body, h)
  flush()

main()
`);

// 3. Build (this takes seconds to a minute, scaling with file count).
const r = await window.NimIDE.build();
console.log(r.ok, r.summary);
if (!r.ok) console.log(r.logs.join('\n'));   // compiler errors are in here

// 4. Export the deployed site and save it (Node side shown).
const z = await window.NimIDE.exportZip('site');
// CDP: the returned object arrives by value; then in Node:
//   require('fs').writeFileSync(z.name, Buffer.from(z.base64, 'base64'));
```

CDP one-liner shape (everything is awaitable + JSON):

```js
Runtime.evaluate({
  expression: `window.NimIDE.build()`,
  awaitPromise: true,
  returnByValue: true,
});
```

## Error handling

- `build()` resolves (never rejects) with `ok: false` on compile errors —
  read `summary` and search `logs` for `[error]` lines; Nim errors look
  like `/workspace/main.nim(4, 10) Error: undeclared identifier: 'foo'`.
- `exportZip()` throws when the folder is empty ("nothing to export").
- File ops reject on invalid paths (e.g. absolute paths, `..` escapes)
  and on unknown `area` values — wrap in try/catch or check arguments.
- `readFile()` returns `null` for missing paths and folders.

## Pitfalls

- **One build at a time.** A second `build()` while one is in flight (from
  either the API or the Build button) is refused with
  `ok: false, summary: "a build is already running…"`. The Run/Build
  buttons are disabled for the duration.
- **First load is ~75 MB** — always `await window.NimIDE.ready()` first;
  it resolves `false` if the toolchain failed to load (bad network).
- **Build time scales with file count** — every `.nim` in the project is
  compiled into its own wasm, sequentially. Keep helper files you don't
  want built out of the project tree, or accept the extra seconds.
- **`writeFile` on the open file updates the editor too** — this is
  deliberate (otherwise the IDE's auto-save would clobber your write), but
  it means a human watching the tab sees the edit live.
- **`readFile` binary heuristic** — files that look binary come back
  base64'd in `.base64` (check the `binary` flag), everything else is
  UTF-8 text in `.text`.
- The site folder's generated `index.html` carries an obfuscated runtime
  payload and (when the app uses `bindDomain`) a domain gate — that's
  normal output, not corruption.
