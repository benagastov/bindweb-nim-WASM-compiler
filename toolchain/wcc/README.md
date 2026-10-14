# wcc — the IDE's fast C compiler

`prebuilt/cc.wasm` (about 0.5 MB) is the whole C compiler and linker, and
`prebuilt/sysroot.tar` (about 0.3 MB) holds its headers and C library. The IDE
runs them in a pool of workers (`web/src/wcc-compiler.js`) on an in-memory
WASI file system (`web/src/wcc/memwasi.js`). `toolchain/fetch-wcc.sh` installs
them into `web/vendor/wcc/` after checking `toolchain/SHA256SUMS.wcc`.

| Part | Source | License |
|---|---|---|
| compiler, linker, base libc | [tyfkda/xcc](https://github.com/tyfkda/xcc) `wcc`, pinned in `versions.env`, plus `patches/xcc.patch` | MIT (`LICENSES/xcc-LICENSE`) |
| libm, printf core, strtod, `math.h`, `fenv.h`, `memmem` | [musl](https://musl.libc.org/), pinned in `versions.env` | MIT (`LICENSES/musl-COPYRIGHT`) |

## What we changed

`patches/xcc.patch`:

- **Exports like wasm-ld:** `__attribute__((export_name))` exports a function,
  `visibility("hidden")` hides it, and the new linker option
  `--export-dynamic` exports every other global function of the input objects.
- **GNU C that Nim emits:** `case LO ... HI:` ranges and the `__alignof__`
  keyword.
- **Speed:** a segregated-fit `malloc`. The original K&R allocator took 89% of
  compile time on large files.
- **Small fixes:** `memmem` is declared, `float.h` gains `LDBL_*` (long double
  is double here), stdout/stderr get a 4 KB buffer so one line is one write,
  and `WCC_ROOT` sets the sysroot of a native host build.

Generated at build time from musl (see `tools/port-musl-stdio.py` and
`tools/build-libm.sh`):

- **printf** (`vfprintf.c`): musl's printf core. It gives exact `%e %f %g %a`,
  every flag, and `*` precision.
- **strtod** (`strtod.c`): musl's correctly rounded `floatscan`. wcc uses the
  same libc to read float literals, so constants are exact too.
- **libm**: musl's double, float and long double functions, about 230 objects.
  Two files are patched because wcc only allows forward jumps to labels in the
  same or an enclosing block.

Nim-specific glue lives in the IDE:

- `web/src/wcc/wcc-prologue.h` supplies the GCC builtins Nim calls, plus
  signal stubs.
- `web/src/wcc/wcc-backend.js` rewrites Nim's `goto L; ... { L:; }` exception
  jumps into the forms wcc supports, and holds the link flags.

## Rebuild

Needs Git Bash, plus MinGW gcc on Windows (any cc elsewhere), Python 3 and Node.

```bash
bash toolchain/wcc/tools/fetch-sources.sh   # pinned xcc + musl, applies the patch
bash toolchain/wcc/tools/build.sh           # native wcc, libm, libc, cc.wasm, sysroot
bash toolchain/wcc/tools/pack.sh toolchain/wcc/prebuilt
( cd toolchain/wcc/prebuilt && sha256sum cc.wasm sysroot.tar | sed 's/ \*/  /' ) > toolchain/SHA256SUMS.wcc
```

The build is reproducible: a clean checkout gives a byte-identical `cc.wasm`.
The sources and build output stay in `toolchain/wcc/{xcc,musl-src,libm-musl,sysroot}`,
which are gitignored.

## Tests

`node tests/wcc.test.mjs` compiles and runs a C program with the committed
toolchain under Node. It checks printf and strtod against the values glibc
prints, libm, case ranges, the overflow builtins, the exports, and the label
rewrites.
