# Demo2b — Nim → WebAssembly in-browser IDE

A one-command rebuild of the in-browser Nim → WebAssembly IDE. `start.sh` (or
`start.bat` on Windows) takes a fresh clone to a running IDE on
http://localhost:8080; the `dist/` it produces is the static site published
on the `gh-pages` branch of this repo and served at:

> **https://benagastov.github.io/bindweb-nim-WASM-compiler/**

## Repository layout

| Path        | Branch    | What                                              |
|-------------|-----------|---------------------------------------------------|
| `start.sh`, `build.sh`, `web/`, `libpacks/`, `toolchain/`, ... | `main` | Source code: the rebuild pipeline |
| `index.html`, `static/`, `bindweb-*.js`           | `gh-pages` | Built IDE, served by GitHub Pages |

The two branches share no source. `gh-pages` is the **output** of running
`./start.sh` on the `main` checkout; it's overwritten whenever the build is
refreshed.

## Build the IDE locally

```bash
./start.sh          # Linux / macOS
start.bat           # Windows (needs Docker Desktop)
```

The script:
1. Downloads the prebuilt clang toolchain (npm `clang.js@0.1.1`).
2. Downloads (or builds from source, as fallback) the prebuilt `nim.wasm`.
3. Packs `libpacks/` and assembles `dist/`.
4. Serves `dist/` on http://localhost:8080.

Power-user targets (`./build.sh setup | clang | nim | nim-docker | libs | dist | serve`)
are documented in this repo's `README.md` and the `Makefile`.

## How to refresh the live demo (`gh-pages`)

```bash
# in this checkout
./start.sh
# then publish dist/ to gh-pages:
git switch gh-pages
rsync -a --delete dist/ .
git add -A
git commit -m "rebuild IDE"
git push origin gh-pages
```

## Toolchain notes

Both compilers ship as prebuilt WebAssembly modules, pinned and SHA-256
verified. Building `nim.wasm` from source is supported as a fallback (Docker
preferred, then a local emsdk) but never required for a first run. See
`SETUP-zero-env.md` and the `FIXES-*.md` notes for the few C/WASM patches
the in-browser pipeline needs.

## License

See `LICENSE`.
