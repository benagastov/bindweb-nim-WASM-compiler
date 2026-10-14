#pragma once
#include <stdio.h>
#include <stddef.h>
char *strndup(const char *s, size_t n);
long getline(char **lp, size_t *np, FILE *f);
int mkstemps(char *tmpl, int suffixlen);
FILE *fmemopen(void *buf, size_t size, const char *mode);
FILE *open_memstream(char **bp, size_t *sp);
