# Contributing to Nim Bindweb

Bindweb is meant to be maintained by the community. Everything is built from
source — Nim for the bindings and generators, C for the runtime. This guide
covers the layout, the build, and how to extend it.

## Project layout

```
.
├── src/
│   ├── schema.def              SINGLE SOURCE OF TRUTH for the API surface.
│   ├── bindweb_runtime.c       C core: command/event/scratch buffers,
│   │                           allocator, flush, the wasm entry shim.
│   ├── bindweb_runtime.h       tunable buffer sizes.
│   └── nim/
│       ├── bindweb.nim         core bridge (pushCommand, flush, pollEvent);
│       │                       {.compile.}s the C runtime.
│       ├── bindwebtypes.nim    handles + event types.
│       ├── bindwebevents.nim   high-level typed event system (WebApp).
│       ├── bindwebschema.nim   schema.def parser.
│       ├── bindwebgenerator.nim  schema -> Nim API modules.
│       ├── bindwebjsgen.nim    schema -> JS runtime (dist/app.js).
│       ├── bindwebbuild.nim    build orchestrator + HTML generator (the `bin`).
│       ├── panicoverride.nim   smaller panics for wasm.
│       └── apis/               GENERATED — do not edit by hand.
├── examples/demo.nim
├── toolchain/wasi-sysroot.tar  wasi-libc sysroot for the wasm link step.
├── config.nims                 wasm cross-compile wiring (see BUILDING.md).
├── bindweb.nimble              package + tasks.
└── BUILDING.md                 full build-from-source guide.
```

## Setup & build

See **BUILDING.md**. In short: Nim ≥ 2.0, clang + wasm-ld, extract the sysroot,
then `nimble demo`.

## The golden rule: edit the schema, not the generated files

The entire API surface — every DOM/Canvas/WebGL/WebGPU/Audio/… command, every
event, every handle type — is declared in `src/schema.def`. The Nim API modules
(`src/nim/apis/*.nim`) and the JS runtime (`dist/app.js`) are **generated** from
it. Never hand-edit generated files; they are overwritten on every build.

### To add or change an API

1. Edit `src/schema.def` (add the command/event, its namespace, args, return).
2. Regenerate: `nimble gen && nimble js`.
3. If the command needs custom JS behaviour (most map mechanically), update the
   emitter in `bindwebjsgen.nim`.
4. Rebuild the demo and confirm it runs: `nimble demo`.

See `SPEC.md` and `NAMES.md` for the schema format and naming conventions, and
`DOCS.md` for the public API reference.

### To change the C runtime

Edit `src/bindweb_runtime.c` / `.h` (buffer sizes, allocator, the wasm entry
shim). It is compiled into every app via the `{.compile.}` pragma in
`bindweb.nim`, so a plain `nimble wasm` picks up changes. Keep it freestanding:
only `<stdint.h>`, `<stddef.h>`, `<stdbool.h>`, and compile under
`-nostdlib`-style constraints.

## Conventions

- Public Nim symbols use the `bindweb` prefix; C exports use `bindweb_`.
- Buffer/event opcodes are assigned by the schema; never hard-code numeric
  opcodes in Nim or C — let the generator emit them.
- Keep the wasm build flags in `config.nims`, not scattered across call sites.
- Run `nimble tests` (schema parse + both generators) before opening a PR.

## What's intentionally out of scope here

The in-browser IDE bundles a wasm-compiled clang and Nim so the toolchain runs
in the browser. Those binaries are upstream artifacts, not built from this
repo, and are not needed to build or maintain the framework. Treat them as a
separate deliverable.
