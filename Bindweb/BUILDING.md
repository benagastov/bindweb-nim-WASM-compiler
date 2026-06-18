# Building Nim Bindweb from source

Bindweb is a Nim + C framework. Building it means two things, both from source:

1. **Generators** (native Nim) turn `src/schema.def` into the Nim API modules
   (`src/nim/apis/*.nim`) and the JS runtime (`dist/app.js`).
2. **Cross-compile** a Bindweb app: Nim emits C, then `clang`/`wasm-ld` compile
   that C **plus the C runtime** (`src/bindweb_runtime.c`) into `dist/app.wasm`.

No prebuilt blobs are required for the framework itself. (The optional
in-browser IDE bundles a wasm clang/Nim toolchain; that is a separate artifact
and not needed to build apps natively.)

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Nim | ≥ 2.0 (2.2.4 used) | `requires "nim >= 2.0.0"`. Distro packages are often 1.6 — too old. Build from source or use `choosenim`. |
| clang + wasm-ld | LLVM with the `wasm32` target (14–18 all work) | Ships with the LLVM target by default. `apt install clang lld`. |
| wasi sysroot | bundled | `toolchain/wasi-sysroot.tar` — wasi-libc headers/libs + crt1.o + compiler-rt builtins. |
| terser (optional) | any | JS minification during the HTML build. `npm i -g terser`. |
| wasm-opt (optional) | Binaryen | shrinks `app.wasm`. |

## One-time toolchain setup

```bash
# Extract the bundled wasi sysroot (config.nims defaults to ./wasm-sysroot)
mkdir -p wasm-sysroot
tar xf toolchain/wasi-sysroot.tar -C wasm-sysroot

# Tell the build where it is (or rely on the ./wasm-sysroot default)
export WASI_SYSROOT="$PWD/wasm-sysroot"
```

You can point `WASI_SYSROOT` at a wasi-sdk sysroot instead; if you do, drop the
`-resource-dir=.../clang/8.0.1` switch in `config.nims` (wasi-sdk supplies the
builtins automatically).

## Build

Using the nimble tasks:

```bash
nimble gen      # schema.def -> src/nim/apis/*.nim
nimble js       # schema.def -> dist/app.js  (the JS runtime)
nimble wasm     # examples/demo.nim + C runtime -> dist/app.wasm
nimble demo     # all of the above + dist/index.html
```

Or directly without nimble:

```bash
nim c -r src/nim/bindwebgenerator.nim --apis-only --apis:src/nim/apis
nim c -r src/nim/bindwebjsgen.nim --js-only --out:dist
nim c -d:wasm -d:release -o:dist/app.wasm examples/demo.nim
nim c -r src/nim/bindwebbuild.nim --out:dist examples/demo.nim
```

## Run

```bash
cd dist && python3 -m http.server 8080   # open http://localhost:8080
```

`dist/index.html` is an ES module that imports the runtime, instantiates
`app.wasm`, connects the runner, calls `_start`, and starts the event loop.

## How the wasm build is wired (config.nims)

`config.nims` applies only under `-d:wasm`:

- `--cpu:wasm32 --os:linux --mm:arc --panics:on -d:useMalloc` — Nim codegen for
  wasm; `-d:useMalloc` routes allocation through wasi-libc.
- `--noMain:on` — Nim does **not** emit its 3-arg `main`; the C runtime provides
  a 2-arg `main` (asm-labelled so wasm-ld matches crt1's `main`). This is the
  native form of the Nim-WASM-Compiler "2-arg main" fix.
- compile: `clang --target=wasm32-wasi --sysroot=$WASI_SYSROOT -fno-builtin
  -fno-common -Oz`. `-fno-common` avoids the LLVM-8 object-writer trap on
  `common`-linkage globals.
- link: `-Wl,--export-dynamic -Wl,--export-table -Wl,--allow-undefined -lcanvas`
  — `--export-table` makes Nim function pointers (`setMainLoop` callbacks)
  callable from JS; `--allow-undefined` turns the JS-side host opcodes into
  imports the runtime supplies.

The C runtime is linked automatically: `bindweb.nim` carries
`{.compile: "../bindweb_runtime.c".}`, so any app that imports `bindweb` pulls
in the runtime.

## Verifying a build

```bash
# structural check (Node)
node -e 'const fs=require("fs");WebAssembly.compile(fs.readFileSync("dist/app.wasm")).then(m=>{const e=WebAssembly.Module.exports(m).map(x=>x.name);console.log("_start:",e.includes("_start"),"memory:",e.includes("memory"),"table:",e.includes("__indirect_function_table"))})'
```

A correct `app.wasm` exports `_start`, `memory`, `__indirect_function_table`,
and the `bindweb_*` runtime functions, and imports `wasi_unstable.*` plus the
`env.bindweb_*` host bridge.
