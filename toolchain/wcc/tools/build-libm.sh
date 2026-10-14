#!/usr/bin/env bash
# Compile musl's libm (double + float; long double == double under wcc) and a
# few musl string/fenv functions with the native wcc into libm-musl/obj/.
# tools/build.sh packs them into wlibc.a in place of xcc's own math code.
#
# Two musl files use gotos wcc cannot express (it only allows forward jumps to
# labels in the same or an enclosing block); patched copies are written to
# libm-musl/patched/ (musl-src/ stays pristine):
#   __rem_pio2.c        `goto medium` into an if-block  -> label hoisted out
#   __rem_pio2_large.c  backward `goto recompute`       -> for(;;) + continue
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="$ROOT/musl-src"
L="$ROOT/libm-musl"
mkdir -p "$L/obj" "$L/patched" "$L/shim"
export WCC_ROOT="$ROOT/xcc"

mkdir -p "$ROOT/xcc/include/bits"
# math.h: musl's full C99 header (double/float/long double declarations,
# type-generic isnan/signbit/fpclassify...) replaces xcc's partial one.
cp "$M/include/math.h" "$ROOT/xcc/include/math.h"
cp "$M/include/features.h" "$ROOT/xcc/include/features.h"
cat > "$ROOT/xcc/include/bits/alltypes.h" <<'EOF'
/* Minimal musl-style bits/alltypes.h for wcc (wasm32): only what the musl
 * headers used here ask for. long double is double under wcc. */
#if defined(__NEED_float_t) && !defined(__DEFINED_float_t)
typedef float float_t;
#define __DEFINED_float_t
#endif
#if defined(__NEED_double_t) && !defined(__DEFINED_double_t)
typedef double double_t;
#define __DEFINED_double_t
#endif
EOF
# fenv.h: musl's generic (soft-float) variant.
cp "$M/include/fenv.h" "$ROOT/xcc/include/fenv.h"
cp "$M/arch/generic/bits/fenv.h" "$ROOT/xcc/include/bits/fenv.h"

# Headers musl's internal libm.h expects from its own build environment.
cat > "$L/shim/endian.h" <<'EOF'
#pragma once
#define __LITTLE_ENDIAN 1234
#define __BIG_ENDIAN 4321
#define __BYTE_ORDER __LITTLE_ENDIAN
EOF
cat > "$L/shim/features.h" <<'EOF'
#pragma once
#define _GNU_SOURCE 1
#define __inline inline
#define weak __attribute__((__weak__))
#define hidden __attribute__((__visibility__("hidden")))
#define weak_alias(old, new) /* aliases unsupported in wcc; not needed for libm */
EOF
echo '/* generic: no arch-specific fp helpers */' > "$L/shim/fp_arch.h"
rm -rf "$L/shim/bits"   # bits/alltypes.h comes from xcc/include (written above)

# atomic.h: fma.c only needs a_clz_64.
cat > "$L/shim/atomic.h" <<'EOF'
#pragma once
#include <stdint.h>
static inline int a_clz_64(uint64_t x) { return __builtin_clzll(x); }
EOF

python - "$M/src/math" "$L/patched" <<'EOF'
import sys, re
src, out = sys.argv[1], sys.argv[2]

def match_brace(s, i):
    d = 0
    for j in range(i, len(s)):
        if s[j] == '{': d += 1
        elif s[j] == '}':
            d -= 1
            if d == 0: return j
    raise SystemExit('unbalanced')

s = open(f'{src}/__rem_pio2.c').read()
head = 'if (ix < 0x413921fb) {  /* |x| ~< 2^20*(pi/2), medium size */\nmedium:'
i = s.index(head)
close = match_brace(s, s.index('{', i))
body = s[s.index('medium:', i) + len('medium:'):close]
s = s[:i] + 'if (!(ix < 0x413921fb)) goto not_medium;\nmedium: ;\n\t{' + body + '}\nnot_medium: ;' + s[close + 1:]
open(f'{out}/__rem_pio2.c', 'w').write(s)

s = open(f'{src}/__rem_pio2_large.c').read()
assert s.count('recompute:') == 1 and s.count('goto recompute;') == 1
s = s.replace('recompute:', 'for (;;) {  /* was: recompute: */', 1)
s = s.replace('goto recompute;', 'continue;  /* was: goto recompute */', 1)
s = s.replace('\t/* chop off zero terms */', '\tbreak;\n\t}\n\n\t/* chop off zero terms */', 1)
open(f'{out}/__rem_pio2_large.c', 'w').write(s)
EOF

srcs=()
for f in "$M"/src/math/*.c; do
  b=$(basename "$f" .c)
  # long double == double under wcc: musl's *l.c forward to the double versions.
  [[ -f "$L/patched/$b.c" ]] && f="$L/patched/$b.c"
  srcs+=("$f")
done
srcs+=("$M/src/fenv/fenv.c" "$M/src/string/memmem.c")

ok=0; fail=0
for f in "${srcs[@]}"; do
  b=$(basename "$f" .c)
  if (cd "$L" && "$ROOT/xcc/wcc" -c -Ishim -I"$M/src/internal" -o "obj/$b.o" "$f" >"obj/$b.log" 2>&1); then
    ok=$((ok+1)); rm -f "$L/obj/$b.log"
  else
    fail=$((fail+1)); echo "FAIL $b: $(grep -v warning "$L/obj/$b.log" | head -2 | tr '\n' ' ')"
  fi
done
echo "libm: $ok compiled, $fail failed"
