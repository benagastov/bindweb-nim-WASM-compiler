# Fix: `RangeDefect: -1 notin 0 .. 2147483647` at compiler boot

## Symptom
`nim.wasm` crashed on **every** compile (even `echo hi`), before touching the
project file:

```
fatal.nim(53)  sysFatal
Error: unhandled exception: value out of range: -1 notin 0 .. 2147483647 [RangeDefect]
```

## Root cause
`nim.wasm` is emitted with `--os:linux`, so `getAppFilename()` resolves the
executable path via `readlink("/proc/self/exe")`. Under Emscripten/wasi that
path does not exist, so `readlink` returns **-1**, and Nim 2.0.14's
`os.getApplAux` (`lib/pure/os.nim`) runs `setLen(result, -1)` with no guard —
raising the `RangeDefect`. The compiler calls this at boot
(`getPrefixDir -> getAppDir -> getAppFilename`) to locate its own lib/config,
so nothing compiled. It was independent of emsdk version and of `time_t`
because it is a Nim-stdlib bug, not a toolchain bug; native builds never hit it
because `/proc/self/exe` resolves there.

## Changes

### 1. `web/src/nim-compiler.js` (primary, runtime — the actual fix)
Before `callMain`, the loader now creates a MEMFS symlink
`/proc/self/exe -> /nim/bin/nim`. This makes `readlink` succeed (no more `-1`)
**and** makes prefix resolution land on `/nim`, because
`getPrefixDir = dirname(dirname(getAppFilename()))`. Result:
`libpath = /nim/lib`, config = `/nim/config` — exactly where the libpacks mount.
Works with the currently shipped binary; no rebuild required. A shell script
cannot carry this piece because it is a browser-runtime filesystem operation.

### 2. `toolchain/nim/build.sh` (hardening, build-time)
New **Stage 1b** patches the checked-out `lib/pure/os.nim` to add the missing
`len < 0` guard in `getApplAux`, so any rebuilt `nim.wasm` (and the packed
`nim-stdlib`) degrade to `""` on a failed `readlink` instead of crashing. The
patch is idempotent and runs before Stage 2 (compiler emit) and Stage 4 (stdlib
pack). This covers both the native (`./build.sh nim`) and Docker
(`./build.sh nim-docker`) paths, since `toolchain/nim/Dockerfile` runs the same
`build.sh`.

The other `.sh`/`.bat` files (`build.sh`, `build.bat`, `start.sh`, `start.bat`,
`tools/*.sh`) are orchestration only and never touch Nim source, so the guard
does not belong in them.
