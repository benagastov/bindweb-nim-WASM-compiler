#!/usr/bin/env bash
# =============================================================================
# build.sh — ONE entrypoint: clean clone -> ready-to-serve dist/.
#
# WHAT: Orchestrates the whole toolchain:
#         clang      fetch + verify + patch binji's prebuilt clang toolchain
#         nim-fetch  download the prebuilt nim.wasm toolchain (SHA-256 pinned)
#         nim        build nim.wasm natively (requires a local emsdk)
#         nim-docker build nim.wasm in Docker (no local emsdk needed)
#         libs       (re)pack libpacks from libpacks/src/* via tools/pack-lib.sh
#         dist       assemble dist/ from web/ + libpacks/
#         serve      serve dist/ on http://localhost:8080
#         clean      remove generated outputs (dist/, vendor, nim work dirs)
#
# WHY:  One command from clone to a running in-browser Nim compiler, with
#       sub-targets so you only rebuild what you changed.
#
# HOW:  ./build.sh            # same as: all
#       ./build.sh all        # clang, nim, libs, dist
#       ./build.sh <target>   # run a single target
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
source "$HERE/versions.env"
# Pick up a previously provisioned native toolchain (EMSDK_DIR) if present.
# shellcheck disable=SC1091
[[ -f "$HERE/.build-env" ]] && source "$HERE/.build-env"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

cmd_setup() {
  say "setup: preparing a bare environment (base deps + pinned emsdk $EMSDK_VERSION)"
  bash toolchain/setup-env.sh
  # Re-source so the current invocation sees the freshly provisioned EMSDK_DIR.
  # shellcheck disable=SC1091
  [[ -f "$HERE/.build-env" ]] && source "$HERE/.build-env"
}

cmd_clang() {
  say "clang: fetching prebuilt wasm-clang toolchain into $VENDOR_CLANG_DIR"
  bash toolchain/fetch-clang.sh "$@"
}

cmd_nim() {
  say "nim: building nim.wasm from source (native emsdk path)"
  # Zero-env: if there is no usable emsdk, provision one automatically rather
  # than failing. Nim itself is bootstrapped from source inside build.sh.
  if [[ -z "${EMSDK_DIR:-}" || ! -f "${EMSDK_DIR:-}/emsdk_env.sh" ]]; then
    say "nim: no usable emsdk found — running setup first"
    cmd_setup
  fi
  [[ -n "${EMSDK_DIR:-}" && -f "$EMSDK_DIR/emsdk_env.sh" ]] \
    || die "emsdk still unavailable after setup (see messages above), or use: ./build.sh nim-docker"
  bash toolchain/nim/build.sh
}

cmd_nim_fetch() {
  say "nim-fetch: downloading prebuilt nim.wasm toolchain into $VENDOR_NIM_DIR"
  if ! command -v curl >/dev/null 2>&1; then
    say "nim-fetch: curl not found — cannot download (falling back to source build)"
    return 1
  fi
  bash toolchain/fetch-nim.sh
}

cmd_nim_docker() {
  say "nim-docker: building nim.wasm inside Docker"
  command -v docker >/dev/null 2>&1 \
    || die "docker not found; install Docker or use the native path (./build.sh nim)"
  docker build -t nimwasm/nim \
    --build-arg "EMSDK_VERSION=$EMSDK_VERSION" \
    -f toolchain/nim/Dockerfile .
  # Artifacts land in web/vendor/nim and libpacks/ via bind mounts; the host's
  # tools/ (pack-lib.sh) is mounted read-only over the image copy so the
  # container always runs the current version.
  mkdir -p "$VENDOR_NIM_DIR" libpacks
  docker run --rm \
    -v "$HERE/$VENDOR_NIM_DIR:/out" \
    -v "$HERE/libpacks:/build/libpacks" \
    -v "$HERE/tools:/build/tools:ro" \
    nimwasm/nim
}

cmd_libs() {
  say "libs: packing libpacks from libpacks/src/*"
  if [[ ! -f tools/pack-lib.sh ]]; then
    say "libs: tools/pack-lib.sh not present; skipping (nothing to repack)"
    return 0
  fi
  if [[ ! -d libpacks/src ]]; then
    say "libs: libpacks/src/ not present; skipping (nothing to repack)"
    return 0
  fi
  local found=0 src name mount
  for src in libpacks/src/*/; do
    [[ -d "$src" ]] || continue
    found=1
    name="$(basename "$src")"
    # Mount point convention (SPEC section 3): the pack's own name under /,
    # except the two Nim packs which mount at their standard locations.
    case "$name" in
      nim-stdlib) mount="/nim/lib" ;;
      nim-config) mount="/nim/config" ;;
      *)          mount="/$name" ;;
    esac
    say "libs: pack $name -> libpacks/$name.tar (mount $mount)"
    bash tools/pack-lib.sh "$name" "$src" "$mount"
  done
  [[ "$found" -eq 1 ]] || say "libs: no sources in libpacks/src/; nothing to do"
}

cmd_dist() {
  say "dist: assembling $DIST_DIR/"
  bash tools/make-dist.sh
}

cmd_serve() {
  say "serve: http://localhost:8080 from $DIST_DIR/"
  bash tools/serve.sh
}

cmd_clean() {
  say "clean: removing generated outputs"
  rm -rf "$DIST_DIR" web/vendor toolchain/nim/work toolchain/nim/out work out
  say "clean: done (libpacks/*.tar are committed and left untouched)"
}

cmd_all() {
  cmd_clang
  # Fast path: fetch the pinned prebuilt nim.wasm; fall back to a source
  # build only if the download is unavailable (offline, mirror down).
  if [[ -f "$VENDOR_NIM_DIR/nim.wasm" ]]; then
    say "all: nim.wasm already present — skipping nim toolchain step"
  else
    cmd_nim_fetch || cmd_nim
  fi
  cmd_libs
  cmd_dist
  say "all: build complete — run './build.sh serve' and open http://localhost:8080"
}

usage() {
  cat <<'EOF'
usage: ./build.sh [target ...] [--force]

targets (run in the order given):
  all         clang + nim + libs + dist (default)
  setup       prepare a bare machine: base deps + pinned emsdk (native path)
  clang       fetch + verify the prebuilt clang toolchain (--force re-downloads)
  nim-fetch   download the prebuilt nim.wasm toolchain (SHA-256 pinned, fast)
  nim         build nim.wasm natively (requires emsdk; EMSDK_DIR must be set)
  nim-docker  build nim.wasm in Docker (no local emsdk needed)
  libs        (re)pack libpacks from libpacks/src/*
  dist        assemble dist/ from web/ + libpacks/
  serve       serve dist/ on http://localhost:8080
  clean       remove generated outputs

examples:
  ./build.sh                 # everything
  ./build.sh nim dist serve  # rebuild just nim.wasm, re-assemble, serve
EOF
}

main() {
  local targets=() force=""
  local arg
  for arg in "$@"; do
    case "$arg" in
      --force) force="--force" ;;
      *) targets+=("$arg") ;;
    esac
  done
  [[ "${#targets[@]}" -eq 0 ]] && targets=(all)
  local target
  for target in "${targets[@]}"; do
    case "$target" in
      all)        cmd_all ;;
      setup|env)  cmd_setup ;;
      clang)      cmd_clang $force ;;
      nim-fetch)  cmd_nim_fetch ;;
      nim)        cmd_nim ;;
      nim-docker) cmd_nim_docker ;;
      libs)       cmd_libs ;;
      dist)       cmd_dist ;;
      serve)      cmd_serve ;;
      clean)      cmd_clean ;;
      -h|--help|help) usage ;;
      *) usage >&2; die "unknown target: $target" ;;
    esac
  done
}

main "$@"
