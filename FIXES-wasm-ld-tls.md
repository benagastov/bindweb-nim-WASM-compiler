# Fix: `wasm-ld: w30.o: invalid data symbol index` (TLS symbols)

## Symptom
Nim → C now succeeds (44 C files, rc=0), clang compiles all 46 TUs, then the
in-browser link fails:

```
wasm-ld: error: w30.o: invalid data symbol index
clang: getFile(app.wasm) failed: unreachable
```

`w30.c` is `std/typedthreads.nim.c`.

## Root cause
**Nim 2.0 changed the default to `--threads:on`.** Nothing in `NIM_FLAGS` turned
it off, so every build compiled thread support: `std/typedthreads`,
`std/private/syslocks`, `std/private/threadtypes`, `std/sysatomics`
(the `w26`/`w27`/`w29`/`w30` objects in the log).

Thread support emits **thread-local variables** (`__thread` / `NIM_THREADVAR`).
The in-browser linker is `wasm-ld` from binji's **LLVM 8.0.1** fork, which
predates WebAssembly TLS relocation support, so it cannot resolve those data
symbols and aborts with `invalid data symbol index`.

Verified against native Nim 2.0.14 with the packed stdlib and the same flags:

| build | TUs | thread TUs | files containing TLS |
|---|---|---|---|
| current flags (threads on, the default) | 45 | typedthreads, syslocks, threadtypes, sysatomics | **3** (incl. `typedthreads` = `w30.o`) |
| with `--threads:off` | 42 | sysatomics only (no TLS) | **0** |

The target is single-threaded wasm, so thread support was never needed.

## Changes

### 1. `web/src/nim-compiler.js` — `NIM_FLAGS` (the fix)
Added `'--threads:off'`. This removes the thread translation units and takes TLS
symbols from 3 files to 0, so the LLVM 8 `wasm-ld` can link. All three bundled
examples were verified to compile with it (mouse 42 TUs, rotate 38, buttons 41 —
all rc=0, all TLS=0).

### 2. `web/src/clang-compiler.js` — scaled safety timeout
The log also showed `compile-link safety timeout after 120000 ms (worker
wedged?)` firing on a healthy build: 46 TUs compiled serially in-browser at -O0
can exceed a fixed 2 minutes on slower machines, turning a working build into a
misleading error. The default is now proportional to the workload —
`max(120000, 60000 + 10000 * TUs)` (≈9 min for 46 TUs) — and remains a pure
safety net. An explicit `timeoutMs` still overrides it.

## Note
Both changes are **runtime JS only** — no `nim.wasm` rebuild is required for
this fix (unlike the earlier `STACK_SIZE` change, which does need one).
