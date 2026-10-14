/* wcc-prologue.h -- prepended to every Nim-generated TU compiled with wcc.
 * The wcc counterpart of the clang prologue in pipeline.js: it supplies what
 * Nim's C expects from GCC/clang and wasi-libc, so Nim's output (and the Nim
 * output cache) stays the same for both C compilers. */
#define __TINYC__ 1          /* nimbase.h: take the portable TCC paths */
#define NIM_INTBITS 32
/* NIM_EmulateOverflowChecks stays undefined: nimbase.h then maps nimAddInt & co.
 * to the __builtin_*_overflow macros below. */

#include <stddef.h>
#include <string.h>

/* WASI has no signals; Nim's system module installs handlers anyway. */
typedef void (*__sighandler_t)(int);
#ifndef SIGINT
#define SIGINT  2
#define SIGILL  4
#define SIGABRT 6
#define SIGBUS  7
#define SIGFPE  8
#define SIGSEGV 11
#define SIGPIPE 13
#define SIGTERM 15
#endif
#define SIG_IGN ((__sighandler_t)1)
#define SIG_DFL ((__sighandler_t)0)
#define SIG_ERR ((__sighandler_t)-1)
static __sighandler_t signal(int sig, __sighandler_t handler) { (void)sig; (void)handler; return SIG_DFL; }
int raise(int sig);

/* GCC builtins Nim's codegen calls directly. */
/* i32.div_s by zero is a wasm trap, like clang's `unreachable`. */
static volatile int __wcc_zero;
static void __wcc_trap(void) { __wcc_zero = 1 / __wcc_zero; }
#define __builtin_unreachable() __wcc_trap()
#define __builtin_trap() __wcc_trap()

#define __builtin_bswap16(x) ((unsigned short)((((x) & 0xff) << 8) | (((x) >> 8) & 0xff)))
static unsigned int __wcc_bswap32(unsigned int x) {
  return (x >> 24) | ((x >> 8) & 0xff00) | ((x << 8) & 0xff0000) | (x << 24);
}
static unsigned long long __wcc_bswap64(unsigned long long x) {
  return ((unsigned long long)__wcc_bswap32((unsigned int)x) << 32) | __wcc_bswap32((unsigned int)(x >> 32));
}
#define __builtin_bswap32(x) __wcc_bswap32(x)
#define __builtin_bswap64(x) __wcc_bswap64(x)

/* __builtin_{s}{add,sub,mul}{,l,ll}_overflow: type-generic in GCC; Nim uses
 * them on NI (int32 here) and NI64. Dispatch on the result's size. */
static int __wcc_add32(int a, int b, int *r) { long long s = (long long)a + b; *r = (int)s; return s != (int)s; }
static int __wcc_sub32(int a, int b, int *r) { long long s = (long long)a - b; *r = (int)s; return s != (int)s; }
static int __wcc_mul32(int a, int b, int *r) { long long s = (long long)a * b; *r = (int)s; return s != (int)s; }
static int __wcc_add64(long long a, long long b, long long *r) {
  unsigned long long s = (unsigned long long)a + (unsigned long long)b;
  *r = (long long)s;
  return ((a ^ (long long)s) & (b ^ (long long)s)) < 0;
}
static int __wcc_sub64(long long a, long long b, long long *r) {
  unsigned long long s = (unsigned long long)a - (unsigned long long)b;
  *r = (long long)s;
  return ((a ^ b) & (a ^ (long long)s)) < 0;
}
static int __wcc_mul64(long long a, long long b, long long *r) {
  unsigned long long p = (unsigned long long)a * (unsigned long long)b;
  *r = (long long)p;
  if (a == 0 || b == 0) return 0;
  if ((a == -1 && b == (long long)(1ULL << 63)) || (b == -1 && a == (long long)(1ULL << 63))) return 1;
  return (long long)p / b != a;
}
#define __WCC_OVF(op, a, b, r) (sizeof(*(r)) == 8 \
  ? __wcc_##op##64((long long)(a), (long long)(b), (long long *)(r)) \
  : __wcc_##op##32((int)(a), (int)(b), (int *)(r)))
#define __builtin_add_overflow(a, b, r)    __WCC_OVF(add, a, b, r)
#define __builtin_sub_overflow(a, b, r)    __WCC_OVF(sub, a, b, r)
#define __builtin_mul_overflow(a, b, r)    __WCC_OVF(mul, a, b, r)
#define __builtin_sadd_overflow(a, b, r)   __WCC_OVF(add, a, b, r)
#define __builtin_ssub_overflow(a, b, r)   __WCC_OVF(sub, a, b, r)
#define __builtin_smul_overflow(a, b, r)   __WCC_OVF(mul, a, b, r)
#define __builtin_saddl_overflow(a, b, r)  __WCC_OVF(add, a, b, r)
#define __builtin_ssubl_overflow(a, b, r)  __WCC_OVF(sub, a, b, r)
#define __builtin_smull_overflow(a, b, r)  __WCC_OVF(mul, a, b, r)
#define __builtin_saddll_overflow(a, b, r) __WCC_OVF(add, a, b, r)
#define __builtin_ssubll_overflow(a, b, r) __WCC_OVF(sub, a, b, r)
#define __builtin_smulll_overflow(a, b, r) __WCC_OVF(mul, a, b, r)
