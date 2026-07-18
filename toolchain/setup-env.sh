#!/usr/bin/env bash
# =============================================================================
# setup-env.sh — ZERO-ENV preparation for the NATIVE build path.
#
# The native build (./build.sh nim) needs a toolchain that a bare machine does
# not have: base build tools (git, gcc/make, python3, curl, xz) and a pinned
# Emscripten SDK (emsdk). The Docker path provisions all of this *inside* the
# image (toolchain/nim/Dockerfile); this script does the equivalent on the host
# so the native path works from nothing.
#
# It does NOT install Nim: toolchain/nim/build.sh bootstraps Nim from source
# (csources_v2 -> pinned 2.0 compiler) using the base tools installed here.
#
# What it does:
#   1. Install base OS packages (best effort: apt/dnf/apk/brew; sudo if needed).
#   2. git clone + ./emsdk install + ./emsdk activate the pinned EMSDK_VERSION.
#   3. Persist EMSDK_DIR to <repo>/.build-env so build.sh picks it up.
#
# Idempotent: re-runs skip anything already done. Safe to run repeatedly.
#
# Usage:  bash toolchain/setup-env.sh          # provision, then:
#         ./build.sh nim                        # ... build (auto-sources .build-env)
#   or simply:  ./build.sh setup
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/versions.env"

say()  { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

EMSDK_DIR_DEFAULT="$ROOT/toolchain/emsdk"
EMSDK_DIR="${EMSDK_DIR:-$EMSDK_DIR_DEFAULT}"
BUILD_ENV="$ROOT/.build-env"

# ---------------------------------------------------------------------------
# 1. Base OS packages (best effort — never fatal if tools are already present)
# ---------------------------------------------------------------------------
# Runs a command as root when we are not already root: prefer sudo, else fail
# softly (we continue and let the have-checks below report what is missing).
as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then "$@"; return $?; fi
  if command -v sudo >/dev/null 2>&1; then sudo "$@"; return $?; fi
  warn "not root and no sudo; cannot run: $*"
  return 1
}

have() { command -v "$1" >/dev/null 2>&1; }

install_base_deps() {
  say "[1/3] base build tools (git, gcc/make, python3, curl, xz, node)"
  # Mirrors toolchain/nim/Dockerfile's apt line; adds libarchive-tools (bsdtar),
  # a robust extractor that avoids the deep-path rename() failures some older
  # GNU tar builds hit while unpacking emscripten's node_modules.
  if have apt-get; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq || warn "apt-get update failed; continuing"
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates curl git xz-utils build-essential python3 nodejs libarchive-tools \
        || warn "apt-get install failed; will proceed with whatever is present"
  elif have dnf; then
    as_root dnf install -y ca-certificates curl git xz gcc gcc-c++ make python3 nodejs bsdtar || warn "dnf install failed; continuing"
  elif have apk; then
    as_root apk add --no-cache ca-certificates curl git xz build-base python3 nodejs libarchive-tools || warn "apk add failed; continuing"
  elif have brew; then
    brew install git python3 curl xz node || warn "brew install failed; continuing"
  else
    warn "no known package manager (apt/dnf/apk/brew); ensure these exist: git gcc make python3 curl xz node"
  fi

  # emsdk's driver invokes 'python3'; some distros only ship 'python'.
  if ! have python3 && have python; then
    as_root ln -sf "$(command -v python)" /usr/local/bin/python3 || warn "could not alias python -> python3"
  fi

  # Hard requirements for the rest of this script and for Nim bootstrap.
  local missing=()
  for t in git python3 curl; do have "$t" || missing+=("$t"); done
  have cc || have gcc || missing+=("gcc")
  have make || missing+=("make")
  if [[ "${#missing[@]}" -gt 0 ]]; then
    die "required tools still missing: ${missing[*]}
     Install them and re-run. On Debian/Ubuntu:
       sudo apt-get install -y git build-essential python3 curl xz-utils nodejs"
  fi
}

# ---------------------------------------------------------------------------
# 2. Emscripten SDK (pinned)
# ---------------------------------------------------------------------------
provision_emsdk() {
  say "[2/3] emsdk $EMSDK_VERSION -> $EMSDK_DIR"

  # Already good? (emcc runs after activate + env.)
  if [[ -f "$EMSDK_DIR/emsdk_env.sh" ]] \
     && ( source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1 && command -v emcc >/dev/null 2>&1 ); then
    say "      emsdk already provisioned (emcc found); skipping"
    return 0
  fi

  if [[ ! -d "$EMSDK_DIR/.git" ]]; then
    say "      cloning emsdk (pinned $EMSDK_REF)"
    git clone "$EMSDK_REPO" "$EMSDK_DIR"
    git -C "$EMSDK_DIR" checkout "$EMSDK_REF" 2>/dev/null || warn "could not checkout $EMSDK_REF; using default branch"
  fi

  # emsdk's own driver downloads + unpacks the toolchain from the network.
  say "      ./emsdk install $EMSDK_VERSION  (downloads ~exp. hundreds of MB)"
  if ! ( cd "$EMSDK_DIR" && ./emsdk install "$EMSDK_VERSION" ); then
    warn "emsdk install reported an error — attempting extraction repair"
    repair_emsdk_extract || die "emsdk install failed. Common cause on some sandboxes:
     an old GNU tar cannot unpack emscripten's deeply-nested node_modules.
     Install a robust extractor and retry:  sudo apt-get install -y libarchive-tools
     (bsdtar), then re-run: ./build.sh setup"
  fi

  ( cd "$EMSDK_DIR" && ./emsdk activate "$EMSDK_VERSION" ) || die "emsdk activate failed"

  # Some environments expose node only as 'node', while emsdk config or callers
  # look for 'nodejs' (the failure mode reported on the minimax agent box). Make
  # both names resolvable so 'shutil.which(\"nodejs\")' and friends succeed.
  if have node && ! have nodejs; then
    as_root ln -sf "$(command -v node)" /usr/local/bin/nodejs \
      || warn "could not create 'nodejs' alias for node"
  fi

  # Verify.
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1 || die "emsdk_env.sh did not source cleanly"
  command -v emcc >/dev/null 2>&1 || die "emcc not on PATH after activate; emsdk provisioning incomplete"
  say "      emcc: $(emcc --version 2>/dev/null | head -1)"
}

# Best-effort recovery for the "deep node_modules path won't extract" failure:
# re-unpack any archives emsdk already downloaded, using bsdtar or Python's
# tarfile (both tolerate deep paths), tolerating per-file errors. The optimizer
# node_modules (e.g. babel-plugin-polyfill-corejs2) are not needed for this
# build's emcc -O2 link, so a partial extraction is still usable.
repair_emsdk_extract() {
  local dl="$EMSDK_DIR/downloads"
  [[ -d "$dl" ]] || { warn "no emsdk downloads/ dir to repair"; return 1; }
  local archive fixed=0
  while IFS= read -r archive; do
    say "      repairing extraction of $(basename "$archive")"
    if have bsdtar; then
      bsdtar -xf "$archive" -C "$EMSDK_DIR" 2>/dev/null && fixed=1 && continue
    fi
    python3 - "$archive" "$EMSDK_DIR" <<'PY' && fixed=1
import sys, tarfile, zipfile, os
arc, dest = sys.argv[1], sys.argv[2]
try:
    if arc.endswith((".tar", ".tar.gz", ".tgz", ".tar.xz", ".tar.bz2")):
        t = tarfile.open(arc)
        for m in t:
            try: t.extract(m, dest)
            except Exception as e: print("  skip", m.name, e)
        t.close()
    elif arc.endswith(".zip"):
        z = zipfile.ZipFile(arc)
        for n in z.namelist():
            try: z.extract(n, dest)
            except Exception as e: print("  skip", n, e)
        z.close()
    else:
        print("  unknown archive type:", arc); sys.exit(1)
except Exception as e:
    print("  extract failed:", e); sys.exit(1)
PY
  done < <(find "$dl" -maxdepth 1 -type f \( -name '*.tar*' -o -name '*.tgz' -o -name '*.zip' \) 2>/dev/null)
  [[ "$fixed" -eq 1 ]]
}

# ---------------------------------------------------------------------------
# 3. Persist EMSDK_DIR for build.sh / toolchain/nim/build.sh
# ---------------------------------------------------------------------------
persist_env() {
  say "[3/3] writing $BUILD_ENV (EMSDK_DIR)"
  {
    echo "# Generated by toolchain/setup-env.sh — sourced by build.sh."
    echo "export EMSDK_DIR=\"$EMSDK_DIR\""
  } > "$BUILD_ENV"
  say "      done. EMSDK_DIR=$EMSDK_DIR"
}

install_base_deps
provision_emsdk
persist_env

cat <<EOF

Environment ready.
  EMSDK_DIR=$EMSDK_DIR  (persisted to .build-env)
Next:
  ./build.sh nim     # build nim.wasm (Nim is bootstrapped automatically)
  ./build.sh         # or the full pipeline: clang + nim + libs + dist
EOF
