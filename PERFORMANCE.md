# Build performance

How the in-browser toolchain (nim.wasm → clang.wasm → wasm-ld) was made
fast, what each layer does, and how to measure it. The approach follows
Nicholas Nethercote's Rust compiler work: profile first, fix the biggest
cost, re-measure, repeat.

## Results

Measured on a 12-thread Windows laptop with headless Chrome, driven over CDP.
Two real apps were used: QGraph (56 Nim modules, 72 C translation units)
and QNote (78 modules, one 6.6 MB `main.nim.c`).

| Build | Before | After |
|---|---|---|
| QGraph, cold (no caches) | 133 s | **41 s** |
| QGraph, nothing changed | 15 s | **3.5 s** |
| QNote `main`, cold | ~58 s | **37 s** |
| QNote `main`, one-line edit | ~57 s | **20 s** |
| QNote `main`, nothing changed | ~16 s | **3.6 s** |
| QNote layout / auxiliary entries, edit | 14–15 s | **7–8 s** |

The first profile showed serial clang at 89% of build time (117 of
133 s). Everything below follows from that.

## The layers (fastest path first)

### 1. Nim output cache (`web/src/nim-compiler.js`)

nim.wasm is a pure function of (compiler bytes, argv, every visible file).
Before running it, the compiler hashes with SHA-256:

- the `nim.wasm` binary,
- the full argv,
- every file under `/workspace`, `/libs`, `/nim`, `/bindweb`, `/project`.

On a hit, the C files of the earlier compile are reused and the ~5 s Nim
step is skipped. Warnings are replayed from the cached stderr. Entries are
stored in IndexedDB (`bindweb-nim-cache`), newest 8 only.

To disable it: `localStorage['bindweb.nimCache'] = 'off'`.

### 2. Object cache (`web/src/clang-compiler.js`)

Each compiled C file (`.o`) is stored in IndexedDB (`bindweb-object-cache`).
The key is SHA-256 over the patched clang worker source plus the TU text,
so changing compiler flags invalidates every entry. Up to 3000 objects are
kept, least-recently-used pruned. An unchanged C file is never compiled
twice.

### 3. Codegen units (`web/src/tu-split.js`)

clang.wasm compiles one TU on one thread. A Nim module that `include`s a
whole app becomes one huge C file: QNote's 6.6 MB `main.nim.c` took
45.7 s on a single worker while the others sat idle. Like rustc's
`codegen-units`, any TU of 640 KB or more is split into
`ceil(size / 512 KB)` parts, capped at the worker count:

- Every part keeps the prologue + `nimbase.h` verbatim, plus all types,
  prototypes and preprocessor lines.
- Non-static function bodies are dealt to parts largest-first. The cost
  model is superlinear (`n * (1 + n/64K)`), because optimizer time grows
  faster than function size.
- Other parts see only each body's prototype.
- Non-static globals are defined in part 0 and `extern` elsewhere.
- `static` literals and inline functions are copied only into parts that
  reach them; reachability is computed transitively over identifiers.
- The split is deterministic, so an edit recompiles only the parts it
  touches. A one-line change to QNote rebuilt 1 of 6.

Safety:

- `splitTU()` returns `null` for anything that doesn't look like plain
  Nim codegen output: unbalanced braces, a mutable `static` global, or a
  brace block that isn't a function.
- If a split part fails to compile or link, the build retries that file
  unsplit.
- Split binaries are not byte-identical to unsplit ones (QNote +0.4%).
  Exports and imports match, browser checks match, and runtime timings
  showed no regression beyond noise.

To disable it: `localStorage['bindweb.splitTU'] = 'off'`.

Results: `main.nim.c` 45.7 s → ~10 s, `legacy_xml.nim.c` 10.9 → 4.6 s,
`worker.nim.c` 8.9 → 4.2 s.

The floor is the single largest function. QGraph's `blockBody` is 239 KB
and takes ~11 s on its own; splitting such a proc in Nim is the next lever.

### 4. Parallel clang pool (`web/src/clang-compiler.js`)

Cache misses compile on a pool of clang worker instances:

- Workers share one precompiled `WebAssembly.Module` each for `clang.wasm`
  and `lld.wasm`, posted to the workers.
- Work is scheduled largest TU first.
- Pool size is `max(2, min(8, threads/2))`. More workers than physical
  cores gave almost nothing (7 vs 6: −0.5 s).
- Override the size with `localStorage['bindweb.clangWorkers']`.
- If the pool can't start, the build falls back to the original serial
  compile-and-link.

### 5. Bulk source upload (`NimIDE.syncFiles`)

`writeFile` opens IndexedDB, commits and re-renders the file tree once per
file, so 56 files cost ~2 s. `syncFiles([[path, text], …])` mirrors a whole
tree in one transaction: unchanged files are skipped, files not listed are
removed, and the tree re-renders once. That takes ~0.2 s.

## Measuring

The QNote build driver (`scripts/wasm-build/build-wasm.mjs`) has profiling
switches:

| Switch | Effect |
|---|---|
| `--profile` | phase timestamps (browser up, toolchain ready, upload, build, write) and a `+NNNms` prefix on every IDE log line |
| `BINDWEB_CPUPROFILE=<file>` | records the page main thread during the build; open the file in Chrome DevTools |
| `BINDWEB_REPEAT=<n>` | builds n times in one browser (warm-JIT timing) |
| `--no-cache` | throw-away browser profile (true cold build) |
| `--no-split` | compile oversized TUs whole |
| `--clang-workers <n>` | pool size |

Each build logs the slowest TUs and a cache summary, for example:

```
clang: slowest TUs: @mmain.nim.c#cgu6of6 8977 ms (1906 KB)
clang: 104 TUs (split @mmain.nim.c → 6 codegen units) — 103 from cache, 1 compiled on 6 workers (9101 ms) + link (137 ms)
nim: 95 C files from the Nim output cache (sources unchanged, compile skipped)
```

### Driver-side notes

- Keep the browser profile persistent, and serve from a **fixed port**.
  IndexedDB and the HTTP cache are per-origin, so a random port means an
  empty cache every build.
- Serve the toolchain with `cache-control: no-cache` + `ETag` (not
  `no-store`), and launch Chrome with `--disk-cache-size=536870912`. Chrome
  caches compiled wasm code only for responses in the HTTP cache, and an
  entry may use at most 1/8 of the cache (`clang.wasm` is 31 MB).

## What remains

- **Nim→C, ~5 s on any source change.** All of it is inside nim.wasm, as a
  flat profile of compiler functions. Improving it needs a rebuilt or
  incremental nim.wasm.
- **Single huge functions.** Codegen units can't split a function body.
- **Startup, ~1.2 s.** Page boot plus pool init. A long-lived build daemon
  would remove it.
