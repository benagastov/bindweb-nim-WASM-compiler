"""Port musl's printf core and strtod into xcc's libc (run from the repo root).

  xcc/libsrc/stdio/vfprintf.c  <- musl src/stdio/vfprintf.c
      exact %e %f %g %a (fmt_fp), all flags (# 0 - + space), * width and
      precision, positional %n$ arguments. Output goes through xcc's fwrite;
      musl's FILE locking/buffer juggling is dropped.
  xcc/libsrc/stdlib/strtod.c   <- musl src/stdlib/strtod.c + src/internal/floatscan.c
      correctly rounded decimal/hex parsing (subnormals, inf, nan), on a
      string-only pseudo-FILE instead of musl's stdio internals.
musl is MIT licensed (musl-src/COPYRIGHT)."""
import re, sys
from pathlib import Path

def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

root = Path(__file__).resolve().parent.parent
musl = root / 'musl-src' / 'src'
xcc = root / 'xcc' / 'libsrc'

# ---- vfprintf ---------------------------------------------------------------
s = (musl / 'stdio' / 'vfprintf.c').read_text()
s = s.replace('#include "stdio_impl.h"\n', '''/* Ported from musl src/stdio/vfprintf.c by tools/port-musl-stdio.py (MIT). */
#include <stdio.h>
#include <stdint.h>
''', 1)
s = s.replace('#include <wchar.h>\n', '', 1)
# long double is double under wcc.
s = s.replace('#include <float.h>\n', '''#include <float.h>
#define frexpl frexp
typedef unsigned int wint_t_;
static int __wcc_wctomb(char *s, unsigned wc) {  /* UTF-8 */
\tif (wc < 0x80) { *s = wc; return 1; }
\tif (wc < 0x800) { s[0] = 0xc0 | wc >> 6; s[1] = 0x80 | (wc & 0x3f); return 2; }
\tif (wc < 0x10000) { s[0] = 0xe0 | wc >> 12; s[1] = 0x80 | (wc >> 6 & 0x3f); s[2] = 0x80 | (wc & 0x3f); return 3; }
\ts[0] = 0xf0 | wc >> 18; s[1] = 0x80 | (wc >> 12 & 0x3f); s[2] = 0x80 | (wc >> 6 & 0x3f); s[3] = 0x80 | (wc & 0x3f); return 4;
}
#define wctomb(s, wc) __wcc_wctomb((s), (wc))
#define wchar_t int
#define wint_t wint_t_
#ifndef NL_ARGMAX
#define NL_ARGMAX 9
#endif
#ifndef EOVERFLOW
#define EOVERFLOW 75
#endif
''', 1)
s = s.replace('if (!ferror(f)) __fwritex((void *)s, l, f);', 'fwrite((void *)s, 1, l, f);', 1)
# wcc: no `case` inside an if/else, no backward goto. Same behaviour, spelled out.
old_m = '''		case 'm':
			if (1) a = strerror(errno); else
		case 's':
			a = arg.p ? arg.p : "(null)";
'''
new_m = '''		case 'm':
			a = strerror(errno);
			z = a + strnlen(a, p<0 ? INT_MAX : p);
			if (p<0 && *z) goto overflow;
			p = z-a;
			fl &= ~ZERO_PAD;
			break;
		case 's':
			a = arg.p ? arg.p : "(null)";
'''
assert s.count(old_m) == 1; s = s.replace(old_m, new_m)
old_c = '''		case 'C':
			if (!arg.i) goto narrow_c;
'''
new_c = '''		case 'C':
			if (!arg.i) {
				*(a=z-(p=1))=arg.i;
				fl &= ~ZERO_PAD;
				break;
			}
'''
assert s.count(old_c) == 1; s = s.replace(old_c, new_c)
s = s.replace('\t\tnarrow_c:\n', '', 1)
# `goto ifmt_tail` (sideways jump inside the switch) -> the tail inlined.
tail = '''			if (xp && p<0) goto overflow;
			if (xp) fl &= ~ZERO_PAD;
			if (!arg.i && !p) {
				a=z;
				break;
			}
			p = MAX(p, z-a + !arg.i);
			break;
'''
assert s.count('\t\tifmt_tail:\n' + tail) == 1 and s.count('\t\t\tgoto ifmt_tail;\n') == 2
s = s.replace('\t\t\tgoto ifmt_tail;\n', tail)
s = s.replace('\t\tifmt_tail:\n', '', 1)
s = s.replace('if (ferror(f)) return -1;', '', 1)
i = s.index('int vfprintf(FILE *restrict f, const char *restrict fmt, va_list ap)')
s = s[:i] + '''int vfprintf(FILE *restrict f, const char *restrict fmt, va_list ap)
{
\tva_list ap2;
\tint nl_type[NL_ARGMAX+1] = {0};
\tunion arg nl_arg[NL_ARGMAX+1];
\tint ret;

\t/* the copy allows passing va_list* even if va_list is an array */
\tva_copy(ap2, ap);
\tif (printf_core(0, fmt, &ap2, nl_arg, nl_type) < 0) {
\t\tva_end(ap2);
\t\treturn -1;
\t}
\tva_end(ap2);
\tva_copy(ap2, ap);
\tret = printf_core(f, fmt, &ap2, nl_arg, nl_type);
\tva_end(ap2);
\treturn ret;
}
'''
write(xcc / 'stdio' / 'vfprintf.c', s)

# ---- strtod -----------------------------------------------------------------
fs = (musl / 'internal' / 'floatscan.c').read_text()
fs = re.sub(r'#include "shgetc.h"\n#include "floatscan.h"\n', '', fs)
st = (musl / 'stdlib' / 'strtod.c').read_text()
st = re.sub(r'#include "shgetc.h"\n#include "floatscan.h"\n#include "stdio_impl.h"\n', '', st)
out = '''/* Ported from musl src/internal/floatscan.c + src/stdlib/strtod.c by
 * tools/port-musl-stdio.py (MIT). Correctly rounded; works on strings only:
 * the scanner reads a pseudo-FILE whose buffer is the input string. */
#include <stdint.h>
#include <stdlib.h>
#include <errno.h>
#include <ctype.h>
#include <limits.h>
#include <float.h>
#include <math.h>

#include <sys/types.h>  /* off_t */
#define hidden
typedef struct { unsigned char *rpos, *rend, *buf, *shend; long long shlim, shcnt; } SCANFILE;
#define FILE SCANFILE
#define EOF (-1)
static void __shlim(FILE *f, long long lim) {
\tf->shlim = lim;
\tf->shcnt = f->buf - f->rpos;
\tf->shend = (lim && f->rend - f->rpos > lim) ? f->rpos + lim : f->rend;
}
static int __shgetc(FILE *f) { (void)f; return EOF; }  /* strings end at NUL */
#define shcnt(f) ((f)->shcnt + ((f)->rpos - (f)->buf))
#define shlim(f, lim) __shlim((f), (lim))
#define shgetc(f) (((f)->rpos != (f)->shend) ? *(f)->rpos++ : __shgetc(f))
#define shunget(f) ((f)->shlim>=0 ? (void)(f)->rpos-- : (void)0)
#define sh_fromstring(f, s) ((f)->buf = (f)->rpos = (void *)(s), (f)->rend = (void*)-1)
#define strtod_l(...) /* unused */
'''
fs = fs.replace('#include <stdio.h>\n', '')
out += fs.split('\n', 0)[0] + '\n' + st.replace('#include <stdlib.h>\n', '')
# musl exports strtof/strtod/strtold via weak_alias for *_l: not needed here.
out = re.sub(r'weak_alias\([^)]*\);\n', '', out)
write(xcc / 'stdlib' / 'strtod.c', out)
# strtold.c in xcc just forwards to strtod; musl's strtod.c defines strtold.
write(xcc / 'stdlib' / 'strtold.c', '/* strtold is defined in strtod.c (musl port). */\n')
print('ported vfprintf.c, strtod.c')
