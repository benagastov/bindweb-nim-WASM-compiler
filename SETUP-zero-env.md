# Zero-env build (no Docker, no emsdk, no Nim preinstalled)

Previously the **native** build path (`./build.sh nim`) required `EMSDK_DIR` to
already point at an installed Emscripten SDK and just died otherwise. Only the
**Docker** path self-provisioned its toolchain. On a bare agent/CI box with no
Docker and no emsdk there was nothing to bootstrap the environment.

## What was added

- **`toolchain/setup-env.sh`** (new) — prepares a bare machine for the native
  path:
  1. installs base build tools (git, gcc/make, python3, curl, xz, node) via
     apt/dnf/apk/brew, using `sudo` when not root (best effort; warns instead of
     failing if a package is already present);
  2. clones + `./emsdk install` + `./emsdk activate` the **pinned**
     `EMSDK_VERSION` from `versions.env` into `toolchain/emsdk/`;
  3. persists `EMSDK_DIR` to `.build-env`, which the build scripts source.
  It is idempotent and includes a fallback (bsdtar / Python `tarfile`) for the
  deep-`node_modules` extraction failure some older GNU tar builds hit, plus a
  `node`→`nodejs` alias for environments where only `node` exists.

  > Note: Nim is **not** installed by this script — `toolchain/nim/build.sh`
  > bootstraps Nim from source (csources_v2 → pinned 2.0.14) using the base
  > tools above.

- **`build.sh`** — new `setup` (alias `env`) target; sources `.build-env` on
  start; and `cmd_nim` now auto-runs setup when no usable emsdk is found instead
  of dying.

- **`toolchain/nim/build.sh`** — Stage 3 now resolves `EMSDK_DIR` from
  `.build-env` or the default `toolchain/emsdk/` before failing, and its error
  message points at `./build.sh setup`.

- **`start.sh`** — when neither Docker nor a local emsdk is usable, it now runs
  the native setup and builds, instead of dead-ending on "install Docker".

## Usage on a bare box

```sh
./build.sh setup     # base deps + pinned emsdk 3.1.69  (needs network + sudo/root)
./build.sh           # clang + nim + libs + dist  (Nim is bootstrapped for you)
./build.sh serve     # http://localhost:8080
```

or just `./start.sh`, which now takes the native route automatically when Docker
is absent.

## Caveats (honest)

- `./emsdk install` downloads the Emscripten toolchain from Google storage; the
  box needs outbound network to those hosts. The emsdk **git** pin was verified
  reachable, but the toolchain download itself could not be exercised in the
  authoring sandbox (restricted egress), so run `./build.sh setup` once on the
  target box and check `emcc --version` before the full build.
- Installing base packages needs root or `sudo`. If the box has neither and is
  missing a required tool, setup reports exactly which tool to install.
