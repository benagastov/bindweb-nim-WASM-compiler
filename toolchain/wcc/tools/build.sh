#!/usr/bin/env bash
# Build everything from xcc/ on Windows (Git Bash + MinGW gcc + Node):
#   1. native wcc.exe (host compiler, with POSIX shims from host-shims/)
#   2. xcc's wasm libc with that wcc, plus musl's libm (tools/build-libm.sh),
#      packed by tools/wasm-ar.mjs
#   3. cc.wasm = wcc compiled by itself (the in-browser compiler)
#   4. sysroot/usr/{include,lib} for cc.wasm
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
X="$ROOT/xcc"
JOBS="${JOBS:-8}"
export WCC_ROOT=.   # wcc finds include/ and lib/ relative to the cwd (see src/wcc/wcc.c)

echo "== 1. native wcc (host compiler)"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    # MinGW lacks a few POSIX functions and declarations wcc uses.
    gcc -O2 -c "$ROOT/host-shims/posix.c" -o "$ROOT/host-shims/posix.o"
    make -C "$X" -j"$JOBS" CC=gcc wcc \
      CFLAGS="-std=gnu11 -O2 -D_DEFAULT_SOURCE -include ../host-shims/posixdecl.h -I../host-shims -Isrc/util -Isrc/cpp -Isrc/cc/frontend" \
      LDFLAGS="../host-shims/posix.o -Wl,--wrap=fclose -Wl,--wrap=getcwd -Wl,--wrap=_getcwd -Wl,--wrap=tmpfile -Wl,--stack,268435456" \
      2>&1 | grep -E "error|Error" || true ;;
  *)
    make -C "$X" -j"$JOBS" wcc 2>&1 | grep -E "error|Error" || true ;;
esac
test -x "$X/wcc" || test -x "$X/wcc.exe"

echo "== 2. musl libm + headers (replaces xcc's math; the libc below compiles against them)"
bash "$ROOT/tools/build-libm.sh"

echo "== 3. libc (serial: parallel wcc runs race on temp names)"
# musl printf core + strtod replace xcc's simplified ones (exact float I/O).
python "$ROOT/tools/port-musl-stdio.py"
# -k: xcc's own math/*.c no longer compile against musl's math.h; they are
# replaced by musl's libm below, so their failures are expected.
( cd "$X/libsrc" && WCC_ROOT=.. make -k CC=../wcc AR=true wcc-libs >/dev/null 2>&1 || true )
# musl's strtod trips a harmless "unreachable" warning; libsrc builds with -Werror.
( cd "$X/libsrc" && WCC_ROOT=.. ../wcc -c -o obj/wcc/strtod.o stdlib/strtod.c 2>/dev/null )


# Object lists (relative: the paths contain spaces). xcc's own math objects
# are left out; musl's libm provides the full C99 set.
XCC_MATH_LIST="$(mktemp)"
( cd "$X/libsrc/math" && ls *.c | sed 's/\.c$/.o/' ) > "$XCC_MATH_LIST"
LIBC_OBJS=$(cd "$X/libsrc/obj/wcc" && ls *.o | grep -vE '^(__main_void|_start|_start0)\.o$' | grep -vxF -f "$XCC_MATH_LIST")
LIBM_OBJS=$(cd "$ROOT/libm-musl/obj" && ls *.o)
rm -f "$XCC_MATH_LIST"

mkdir -p "$ROOT/sysroot/usr/lib"
( cd "$X/libsrc/obj/wcc" &&
  node "$ROOT/tools/wasm-ar.mjs" "$ROOT/sysroot/usr/lib/wcrt0.a" __main_void.o _start.o _start0.o &&
  node "$ROOT/tools/wasm-ar.mjs" "$ROOT/sysroot/usr/lib/wlibc.a" $LIBC_OBJS \
    $(for o in $LIBM_OBJS; do echo "../../../../libm-musl/obj/$o"; done) )

echo "== 4. cc.wasm (self-hosted)"
make -C "$X" HOST_TARGET=wcc HOST_WCC=./wcc CC=./wcc WCC_TARGET= wcc-self-hosting 2>&1 | grep -vE "^(\./wcc|make)" || true
( cd "$X" && ./wcc -nostdlib -o cc.wasm obj/gen2wcc/*.o \
    $(for o in __main_void.o _start.o _start0.o $LIBC_OBJS; do echo "libsrc/obj/wcc/$o"; done) \
    $(for o in $LIBM_OBJS; do echo "../libm-musl/obj/$o"; done) )
ls -la "$X/cc.wasm"

echo "== 5. sysroot headers"
rm -rf "$ROOT/sysroot/usr/include" && cp -r "$X/include" "$ROOT/sysroot/usr/include"
echo done
