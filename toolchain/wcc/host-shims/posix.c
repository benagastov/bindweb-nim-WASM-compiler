// POSIX bits MinGW lacks, enough to host wcc on Windows for experiments.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <io.h>
#include <errno.h>
#include <sys/stat.h>
// MinGW's tmpfile() writes to C:\ (often denied); use %TEMP%, deleted on close.
static FILE *temp_file(void) {
  char *name = _tempnam(getenv("TEMP"), "wcc");
  FILE *f = name ? fopen(name, "w+bTD") : NULL;
  free(name); return f;
}
char *strndup(const char *s, size_t n) {
  size_t l = strnlen(s, n); char *p = malloc(l + 1);
  memcpy(p, s, l); p[l] = 0; return p;
}
long getline(char **lp, size_t *np, FILE *f) {
  size_t len = 0; int c;
  if (!*lp || !*np) { *np = 128; *lp = realloc(*lp, *np); }
  while ((c = fgetc(f)) != EOF) {
    if (len + 2 > *np) { *np *= 2; *lp = realloc(*lp, *np); }
    (*lp)[len++] = (char)c; if (c == '\n') break;
  }
  if (len == 0) return -1;
  (*lp)[len] = 0; return (long)len;
}
int mkstemps(char *tmpl, int suffixlen) {
  size_t L = strlen(tmpl); char *x = tmpl + L - suffixlen - 6;
  for (int t = 0; t < 1000; t++) {
    for (int i = 0; i < 6; i++) x[i] = "abcdefghijklmnopqrstuvwxyz0123456789"[rand() % 36];
    int fd = _open(tmpl, _O_CREAT | _O_EXCL | _O_RDWR | _O_BINARY, _S_IREAD | _S_IWRITE);
    if (fd >= 0) return fd;
  }
  return -1;
}
FILE *fmemopen(void *buf, size_t size, const char *mode) {
  (void)mode; FILE *f = temp_file(); if (!f) return NULL;
  fwrite(buf, 1, size, f); rewind(f); return f;
}
// open_memstream: buffer is filled when the stream is flushed/closed via the hook below.
struct ms { FILE *f; char **bp; size_t *sp; };
static struct ms ms_tab[64]; static int ms_n;
FILE *open_memstream(char **bp, size_t *sp) {
  FILE *f = temp_file(); if (!f) fprintf(stderr, "memstream: temp_file failed (%s)\n", strerror(errno)); ms_tab[ms_n++] = (struct ms){f, bp, sp};
  *bp = NULL; *sp = 0; return f;
}
int __real_fclose(FILE *);
int __wrap_fclose(FILE *f) {
  for (int i = 0; i < ms_n; i++) if (ms_tab[i].f == f) {
    fflush(f); long n = ftell(f); rewind(f);
    char *b = malloc(n + 1); fread(b, 1, n, f); b[n] = 0;
    *ms_tab[i].bp = b; *ms_tab[i].sp = n; ms_tab[i] = ms_tab[--ms_n];
    break;
  }
  return __real_fclose(f);
}
// xcc's path code only understands '/'-rooted paths; keep everything cwd-relative.
char *__wrap_getcwd(char *buf, size_t size) {
  if (!buf) return strdup(".");
  if (size < 2) return NULL;
  strcpy(buf, "."); return buf;
}
char *__wrap__getcwd(char *buf, int size) { return __wrap_getcwd(buf, (size_t)size); }
FILE *__wrap_tmpfile(void) { return temp_file(); }
