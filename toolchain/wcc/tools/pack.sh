#!/usr/bin/env bash
# Collect the in-browser compiler into prebuilt/: cc.wasm and sysroot.tar
# (usr/include + usr/lib for cc.wasm), with SHA-256 sums.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/prebuilt}"
mkdir -p "$OUT"
cp "$ROOT/xcc/cc.wasm" "$OUT/cc.wasm"
# USTAR, sorted, fixed owner/mtime: reproducible and readable by web/src/tar.js.
( cd "$ROOT/sysroot" && tar --format=ustar --sort=name --owner=0 --group=0 --numeric-owner \
    --mtime='2026-01-01 00:00:00Z' -cf "$OUT/sysroot.tar" usr )
( cd "$OUT" && sha256sum cc.wasm sysroot.tar > SHA256SUMS )
cat "$OUT/SHA256SUMS"
ls -la "$OUT"
