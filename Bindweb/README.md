# Nim Bindweb

A lightweight Nim + C WASM framework for building browser applications. Write Nim code that compiles to WebAssembly and calls HTML5 APIs (DOM, Canvas 2D, WebGL, WebGPU, Audio, WebSockets, Fetch, and more) through a command-buffer architecture.


> **Building from source:** see **[BUILDING.md](BUILDING.md)** (toolchain + the 4-step build) and **[CONTRIBUTING.md](CONTRIBUTING.md)** (layout + how to extend the schema). The framework builds entirely from C + Nim — no prebuilt blobs.

> **Note:** This project was forked from [WebCC](https://github.com/io-eric/webcc) and rebranded as **Nim Bindweb**.

## Architecture

```
Nim Source Code
      |
      v
+------------------+     +------------------+     +------------------+
|  Nim Compiler    | --> |   WASM Module    | --> |  Browser (JS)    |
|  (--cpu:wasm32)  |     |  (app.wasm)      |     |  (app.js)        |
+------------------+     +------------------+     +------------------+
      |                        |                         |
      v                        v                         v
+-------------+          +------------------+     +------------------+
| bindweb.nim |          | bindweb_runtime.c|     | HTML5 APIs       |
| (bindings)  |          | (C core runtime) |     | (DOM/Canvas/...) |
+-------------+          +------------------+     +------------------+
```

**How it works:** Your Nim code pushes commands (opcodes) into a shared WASM memory buffer. JavaScript reads and executes them against the browser's DOM/Canvas APIs. Events flow back through a separate event buffer.

## Features

- **155 browser API commands** across 11 namespaces (DOM, Canvas, WebGL, WebGPU, Audio, Input, System, Storage, WebSocket, Fetch, Image)
- **21 event types** for handling user input and async callbacks
- **High-level event system** (`bindwebevents`) with typed callbacks — no manual opcode matching
- **GC-aware handle management** — free-list allocator prevents unbounded JS heap growth
- **Type-safe handles** — distinct types prevent mixing up DOM elements, canvas contexts, etc.
- **Command batching** — API calls are buffered and flushed in batches for performance
- **Schema-driven code generation** — all API bindings generated from a single `schema.def`
- **In-browser IDE** — write Nim code in the browser, compile to WASM entirely client-side
- **Standalone HTML export** — embed your app as a self-contained `.html` file

## Project Structure

```
.
├── src/
│   ├── bindweb_runtime.c         # Core C runtime (command/event/scratch buffers, allocator)
│   ├── bindweb_runtime.h         # C runtime header (tunable buffer sizes)
│   ├── schema.def                # Schema definition (all browser API bindings)
│   ├── panicoverride.nim         # Strip panic bloat for smaller WASM
│   └── nim/
│       ├── bindweb.nim           # Core bindings (flush, pushCommand, pollEvent)
│       ├── bindwebtypes.nim      # Core types (handles, events)
│       ├── bindwebevents.nim     # High-level event system (WebApp, callbacks)
│       ├── bindwebschema.nim     # Schema parser
│       ├── bindwebgenerator.nim  # Nim API code generator
│       ├── bindwebjsgen.nim      # JS runtime generator
│       ├── bindwebbuild.nim      # Build tool (terser, wasm-opt hooks)
│       └── apis/                 # Generated API modules
│           ├── handles.nim       # Typed handle definitions
│           ├── dom.nim           # DOM manipulation
│           ├── canvas.nim        # Canvas 2D API
│           ├── webgl.nim         # WebGL API
│           ├── wgpu.nim          # WebGPU API
│           ├── audio.nim         # Audio API
│           ├── input.nim         # Mouse/keyboard input (+ MouseWheel, Resize)
│           ├── system.nim        # System utilities (main loop, time, URL)
│           ├── storage.nim       # LocalStorage API
│           ├── websocket.nim     # WebSocket API
│           ├── fetch.nim         # HTTP fetch API
│           └── image.nim         # Image loading API
├── examples/
│   └── demo.nim                  # Canvas 2D demo with mouse tracking
├── bindweb-nim-browser/          # In-browser IDE (static web app)
│   ├── index.html                # Main IDE page
│   ├── bindweb-browser-runtime.js # JS runtime (ES module)
│   ├── bindweb-nim-bundle.js     # Bundled Nim source files for MEMFS
│   └── static/                   # Nim-WASM-Compiler static assets
├── dist/                         # Build output (generated)
│   ├── app.js                    # Generated JS runtime
│   ├── app.wasm                  # Generated WASM binary
│   └── index.html                # Generated HTML
└── bindweb.nimble                # Package configuration
```

## Quick Start

### Prerequisites

- [Nim](https://nim-lang.org/install.html) 2.0+ with `choosenim`
- A C compiler (`clang` recommended for WASM)
- Optional: [Binaryen](https://github.com/WebAssembly/binaryen) (`wasm-opt` for smaller WASM)
- Optional: [terser](https://terser.org/) (for JS minification)

### 1. Generate API Modules

```bash
nimble gen    # Generates src/nim/apis/*.nim from schema.def
```

Or manually:
```bash
nim c -r src/nim/bindwebgenerator.nim --apis-only --apis:src/nim/apis
```

### 2. Generate JS Runtime

```bash
nimble js     # Generates dist/app.js
```

Or manually:
```bash
nim c -r src/nim/bindwebjsgen.nim --js-only --out:dist
```

### 3. Write Your App

```nim
# hello.nim
import bindweb, bindwebtypes
import apis/handles, apis/dom, apis/system

proc main() =
  let body = getBody()
  let div = createElement("div")
  setAttribute(div, "style", "padding: 20px; color: #2196F3; font-family: sans-serif;")
  setInnerText(div, "Hello from Nim Bindweb!")
  appendChild(body, div)
  setTitle("My First App")
  flush()

main()
```

### 4. Build to WASM

```bash
nim c -d:release -d:wasm --os:linux --cpu:wasm32 \
  --mm:arc --threads:off -d:noSignalHandler \
  --panics:on \
  --passC:"-fno-builtin -fno-common -Oz" \
  --passL:"--no-entry --export-dynamic --export-table" \
  -o:dist/app.wasm hello.nim
```

For smallest binaries (after confirming correctness):
```bash
nim c -d:danger --opt:size -d:wasm --os:linux --cpu:wasm32 \
  --mm:arc --threads:off -d:noSignalHandler --panics:on \
  --passC:"-fno-builtin -fno-common -Oz -flto" \
  --passL:"--no-entry --export-dynamic --export-table --gc-sections --strip-all --lto-O3" \
  -o:dist/app.wasm hello.nim
wasm-opt -Oz --strip-debug --strip-producers dist/app.wasm -o dist/app.wasm
```

### 5. Build the HTML Page

```bash
nim c -r src/nim/bindwebbuild.nim --out:dist hello.nim
```

This generates `dist/index.html` with the JS runtime embedded.

### 6. Serve and View

```bash
cd dist && python3 -m http.server 8080
# Open http://localhost:8080
```

## Browser IDE (In-Browser Nim Compiler)

Nim Bindweb includes a full in-browser IDE. Users write Nim code, click **Build & Run**, and the entire pipeline runs client-side: **Nim -> C -> WASM -> execution**. No server, no install.

> **Important:** The IDE is provided as a working directory (`bindweb-nim-browser/`). It is **not** designed to be rebuilt from scratch. The `index.html` is a ~700-line bespoke integration with custom patched filesystem setup, FD-based stdout capture, `__libFiles` injection, and modified `clang.js`. Start from the provided directory and modify it.

### IDE File Structure

```
bindweb-nim-browser/
├── index.html                    # Main IDE page (editor + examples + build UI)
│                                 #   ~700 lines: patched FS init, stdout capture,
│                                 #   __libFiles injection, build pipeline, runner
├── bindweb-browser-runtime.js    # JS runtime (createBindwebRunner export)
├── bindweb-nim-bundle.js         # Bundled Nim API files for MEMFS
├── build-bundle.mjs              # Script to rebuild bundle from source
├── static/
│   ├── nim/
│   │   ├── nim.wasm              # Nim compiler (WASM) — ~37 MB
│   │   ├── nim-bundle.js         # Patched Nim compiler JS wrapper
│   │   └── nimbase.h             # Nim runtime header
│   ├── clang/
│   │   ├── clang.js              # Clang driver (WASM wrapper) — MODIFIED
│   │   ├── clang.wasm            # Clang compiler (WASM) — ~31 MB
│   │   ├── lld.wasm              # WASM linker
│   │   ├── memfs.wasm            # MEMFS (in-memory filesystem)
│   │   └── sysroot.tar           # C sysroot headers/libs
│   └── standalone-template.html  # Template for "Export HTML" feature
```

### How to Use the Provided IDE

**Don't rebuild from scratch.** Start with the working `bindweb-nim-browser/` directory:

```bash
# 1. The IDE is already set up in bindweb-nim-browser/
#    Just serve it:
cd bindweb-nim-browser
python3 -m http.server 8080
# Open http://localhost:8080
```

### Modifying the Source Code

When you change Nim source files (e.g., `bindweb.nim`, `apis/dom.nim`), rebuild the bundle:

```bash
# From the project root
node build-bundle.mjs
# This regenerates bindweb-nim-browser/bindweb-nim-bundle.js
# from project/src/nim/ source files
```

Then refresh the browser page (hard-refresh: Ctrl+Shift+R to clear cache).

### Where the Compiler Assets Come From

The compiler assets (`nim.wasm`, `clang.wasm`, etc.) come from [Nim-WASM-Compiler](https://github.com/benagastov/Nim-WASM-Compiler). They are included in the tar file. If you need to obtain them separately:

```bash
git clone https://github.com/benagastov/Nim-WASM-Compiler.git /tmp/nim-wasm-compiler
# Copy into bindweb-nim-browser/static/ (same structure as above)
```

**Note:** The `clang.js` in this project has been modified to add `--export-table` (required for `setMainLoop` function pointers). The original Nim-WASM-Compiler's `clang.js` will not work without this change.

### How the IDE Build Pipeline Works (Internals)

When the user clicks **Build & Run**, this happens in the browser:

1. **Write** `/tmp/user.nim` to MEMFS via the Nim compiler's patched filesystem
2. **Inject** all files from `bindweb-nim-bundle.js` into `/lib/pure/bindweb/` via `__libFiles` (the compiler's internal file table)
3. **Compile** with `nim.wasm`: `nim c --cpu:wasm32 --os:linux -o:/tmp/user.js /tmp/user.nim`
   - Nim reads source from MEMFS, outputs C files to cache
   - Stdout/stderr captured via FD redirect to MEMFS files (patched FS blocks normal output)
4. **Collect** generated `.c` files from Nim's cache directory
5. **Compile** with `clang.wasm`: `clang -target wasm32 ... -c [c_files]`
6. **Link** with `lld.wasm`: `wasm-ld --no-entry --export-dynamic --export-table -o app.wasm [objects]`
   - `--export-table` is required for function pointers (`setMainLoop`)
7. **Load** `app.wasm` into a WebAssembly instance with `createBindwebRunner`
8. **Connect** the runner to the instance and start the event loop

### Standalone Export

Click **Export HTML** in the IDE to generate a self-contained `.html` file with:
- WASM binary embedded as base64
- JS runtime inlined
- WASI shim included
- No external dependencies — works offline

### Deploying the IDE

The entire `bindweb-nim-browser/` folder is a static site:

```bash
cd bindweb-nim-browser
netlify deploy --prod --dir=.       # Netlify
vercel --prod                       # Vercel
surge .                             # Surge.sh
python3 -m http.server 8080         # Local only
```

**Note:** `nim.wasm` (~37 MB) and `clang.wasm` (~31 MB) are large. Ensure your host supports files this size and that gzip/brotli compression is enabled (they compress to ~1/3 size).

## Build Options

### Tunable Buffer Sizes

Set at compile time via environment variables:

```bash
export BINDWEB_CMD_BUFFER_SIZE=262144   # 256 KB (default, was 1 MB)
export BINDWEB_EVT_BUFFER_SIZE=262144   # 256 KB (default, was 1 MB)
nim c -r src/nim/bindwebbuild.nim --out:dist app.nim
```

Or directly as C defines:
```bash
nim c --passC:"-DWEBCC_COMMAND_BUFFER_SIZE=131072" --passC:"-DWEBCC_EVENT_BUFFER_SIZE=131072" ...
```

### JS Tree-Shaking and Minification

The build tool automatically tries to minify JS and optimize WASM:

```bash
# Requires terser and wasm-opt on PATH
npm install -g terser          # JS minification
# Install Binaryen for wasm-opt # WASM optimization

nim c -r src/nim/bindwebbuild.nim --out:dist app.nim
# Output: "Minified JS: 12345 bytes" / "Optimized WASM: 6789 bytes"
```

### Memory Management

| Mode | Flag | When to Use |
|------|------|-------------|
| ARC | `--mm:arc` | Default. Deterministic destructors, smaller than ORC |
| ORC | `--gc:orc` | If you need cycle collection |
| None | `--mm:none` | Smallest binary, manual memory only |

## Deploying

### Option A: Static Hosting (Recommended)

The `dist/` folder contains static files — host anywhere:

```bash
# Netlify
cd dist && netlify deploy --prod --dir=.

# GitHub Pages
git subtree push --prefix dist origin gh-pages

# Vercel
cd dist && vercel --prod

# Any static server
python3 -m http.server 8080 --directory dist
```

### Option B: Self-Contained HTML (Standalone Export)

From the browser IDE, click **"Export HTML"** to generate a single `.html` file with:
- WASM binary embedded as base64
- JS runtime inlined
- WASI shim included
- No external dependencies

### Option C: CDN + Fetch

For fastest loads, serve `app.wasm` and `app.js` separately with CDN caching:

```html
<script type="module">
import { createBindwebRunner } from './app.js';
const runner = createBindwebRunner(document.body);
const wasm = await fetch('./app.wasm');
const { instance } = await WebAssembly.instantiate(
  await wasm.arrayBuffer(),
  runner.imports
);
runner.connect(instance);
runner.startEventLoop();
</script>
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Command Buffer** | Nim pushes opcodes into WASM memory; JS reads and executes them |
| **Event Buffer** | JS pushes events into WASM memory; Nim polls them via `pollEvent()` |
| **Flush** | `flush()` sends all queued commands to JS. Call once per frame. |
| **Handles** | Opaque `int32` IDs referencing DOM/Canvas/WebGL objects in JS |
| **WebApp** | High-level event manager with typed callbacks (`onClick`, `onMouseMove`, ...) |
| **OwnedHandle** | Handle wrapper with ARC destructor — auto-releases on GC |
| **Schema** | Single `schema.def` file generates both Nim APIs and JS runtime |

## API Documentation

See [DOCS.md](DOCS.md) for the complete API reference with examples.

## Optimization Roadmap

From the [optimization plan](plan-bindweb-optimization.md):

- [x] JS free-list handle allocator (prevents unbounded heap growth)
- [x] `RELEASE_HANDLE` / `INJECT_SCRIPT` commands
- [x] `OwnedHandle` with ARC destructor
- [x] `markUsed` compile-time opcode registry
- [x] Tunable buffer sizes
- [x] `panicoverride.nim` for smaller WASM
- [x] Terser/wasm-opt build hooks
- [ ] Per-proc JS tree-shaking (namespace-level done)
- [ ] `--mm:arc` migration (works, not default yet)
- [ ] `DecompressionStream` for standalone HTML

## License

MIT
