# nim-bindweb-bundle

> **An in-browser IDE that compiles Nim → WebAssembly, plus the Bindweb framework
> for talking to the browser from Nim — fully rebuildable from source in one
> folder.**

This bundle packages the complete Nim-WASM IDE so you can:

1. **Use it as-is** — open the IDE in a browser and click **Build & Run** (Nim →
   C → wasm → DOM). The 31 MB `clang.wasm`, 19 MB `lld.wasm`, 4.6 MB
   `nim.wasm`, and the patched `clang.js` driver are already in
   [`IDE/static/`](IDE/static/).
2. **Rebuild the C/C++ compiler from source** — `make toolchain` compiles
   `clang`, `lld`, `memfs`, and `nim` from the pinned LLVM/Nim source via
   Docker, then `make ide` installs them and applies the two patches that the
   in-browser Nim→Bindweb pipeline needs.
3. **Rebuild the Bindweb framework** — `make framework` produces
   `Bindweb/dist/app.wasm` natively (no Docker needed).

> **TL;DR for the impatient:**
> ```bash
> cd IDE && python3 -m http.server 8080
> # then open http://localhost:8080
> ```

---

## Table of contents

- [What this is](#what-this-is)
- [Quick start (no build)](#quick-start-no-build)
- [Quick start (rebuild from source)](#quick-start-rebuild-from-source)
- [Folder layout](#folder-layout)
- [What's pinned](#whats-pinned)
- [The two clang.js patches](#the-two-clangjs-patches)
- [Bundled compiler artifacts](#bundled-compiler-artifacts)
- [Verifying the bundle](#verifying-the-bundle)
- [How compilation flows](#how-compilation-flows)
- [Tearing it down](#tearing-it-down)
- [License](#license)

---

## What this is

A complete, self-contained Nim-WASM toolchain. Three things are inside the box:

| piece            | what it does                                                                         | where it lives                                  |
|------------------|--------------------------------------------------------------------------------------|-------------------------------------------------|
| **IDE**          | The in-browser code editor + the JS that drives Nim → C → wasm → DOM                | [`IDE/`](IDE)                                   |
| **Bindweb**      | The Nim framework that lets a Nim program push DOM updates into JavaScript           | [`Bindweb/`](Bindweb)                           |
| **toolchain/**   | Docker recipes + patch scripts that rebuild every compiler artifact from source     | [`toolchain/`](toolchain)                       |

The compilers that the IDE loads in the browser — `clang.wasm`, `lld.wasm`,
`memfs.wasm`, `sysroot.tar`, `nim.wasm`, `nim-bundle.js`, `nimbase.h` — are
all built from the **pinned upstream source** referenced in
[`toolchain/versions.env`](toolchain/versions.env). The patches that make the
in-browser pipeline work (the `-fno-common` injection and the worker
`try`/`catch` wrap) live next to the build recipes so a fresh checkout
reproduces them automatically via `make ide`.

> See [`MIGRATION.md`](MIGRATION.md) for the design rationale (why we moved
> away from vendored prebuilt blobs to a from-source build) and
> [`toolchain/README.md`](toolchain/README.md) for the full reproducibility
> table.

---

## Quick start (no build)

You only need a static file server. The IDE is pure HTML+JS+wasm — no Node, no
Python, no Docker.

```bash
# Python (every Linux/macOS box has it)
cd IDE
python3 -m http.server 8080
# → open http://localhost:8080

# or, Node
npx --yes serve IDE -l 8080

# or just open IDE/index.html in a browser via file://
#   (works for a quick smoke test, but the IDE will warn about
#   SharedArrayBuffer / cross-origin isolation — use a server for full speed)
```

Click **Build & Run** in the editor. You should see a Nim "Hello, Bindweb!"
demo render into the preview pane.

> **Production deploy:** the `IDE/` folder is a static site. Drop it on
> GitHub Pages, Netlify, S3+CloudFront, or any static host. The
> `IDE/standalone-template.html` is a template the IDE uses for the
> *Export Standalone HTML* feature (embeds the wasm + runtime into a single
> self-contained HTML file).

---

## Quick start (rebuild from source)

Need ~25-40 GB free disk and ≥16 GB RAM. The clang build is the heavy one.

### One-shot

```bash
git clone <this repo> nim-bindweb-bundle
cd nim-bindweb-bundle

# 1. Build every compiler artifact from pinned source (clang, lld, nim, memfs).
#    Internally this runs three Docker containers.
make toolchain

# 2. Copy the fresh artifacts into IDE/static/ AND apply both clang.js patches.
make ide

# 3. Serve the IDE.
make serve
# → http://localhost:8080
```

The three Docker images correspond exactly to the three subdirs in
`toolchain/`:

| target           | docker image           | what it does                                  |
|------------------|------------------------|-----------------------------------------------|
| `make memfs`     | `nimwasm/memfs`        | build `memfs.wasm` from `binji/wasm-clang` source |
| `make clang`     | `nimwasm/clang`        | build `clang.wasm`, `lld.wasm`, `sysroot.tar` from LLVM source |
| `make nim`       | `nimwasm/nim`          | build `nim.wasm`, `nim-bundle.js` from Nim source (via Emscripten) |

You can also run them individually:

```bash
docker build -t nimwasm/clang -f toolchain/clang-wasm/Dockerfile toolchain
docker run --rm -v "$PWD/out:/out" nimwasm/clang
```

### Native framework build (no Docker)

The Bindweb framework itself builds natively. You just need a Nim compiler
(install via [choosenim](https://github.com/dom96/choosenim)) and the bundled
`wasi-sysroot.tar`:

```bash
cd Bindweb
tar xf toolchain/wasi-sysroot.tar -C wasm-sysroot
WASYSROOT=$PWD/wasm-sysroot nim c -d:wasm -d:release -o:dist/app.wasm examples/demo.nim
# → serve Bindweb/dist/ on a static server
```

Or use the wrapper: `make framework` (from the bundle root).

### CI

The same pipeline runs on GitHub Actions:
[`.github/workflows/build-toolchain.yml`](.github/workflows/build-toolchain.yml).

---

## Folder layout

```
nim-bindweb-bundle/
├── README.md                   ← you are here
├── Makefile                    ← the build orchestrator (make toolchain/ide/serve/framework)
├── MIGRATION.md                ← design rationale: blobs vs from-source
│
├── IDE/                        ← the in-browser Nim IDE
│   ├── index.html              ← editor + JS glue (source, committed)
│   ├── bindweb-browser-runtime.js, bindweb-nim-bundle.js
│   ├── html-template.js        ← template used by "Export Standalone HTML"
│   ├── fetch-toolchain.sh      ← fetch a toolchain from local build or CI artifacts
│   └── static/
│       ├── clang/              ← compiler artifacts (build OUTPUTS)
│       │   ├── clang.wasm      ← 31 MB
│       │   ├── lld.wasm        ← 19 MB
│       │   ├── memfs.wasm      ← 345 KB
│       │   ├── sysroot.tar     ← 8.9 MB (wasi-libc + libc++ + clang headers)
│       │   └── clang.js        ← 19 KB (PATCHED, see below)
│       └── nim/                ← nim compiler artifacts (build OUTPUTS)
│           ├── nim.wasm        ← 4.6 MB
│           ├── nim-bundle.js   ← 6.3 MB
│           ├── nim-bundle.data ← 4.6 MB (Emscripten MEMFS image)
│           └── nimbase.h       ← 20 KB
│
├── Bindweb/                    ← the Bindweb framework
│   ├── README.md, DOCS.md, SPEC.md, NAMES.md, BUILDING.md, CONTRIBUTING.md
│   ├── bindweb.nimble
│   ├── config.nims             ← wasi cross-compile wiring (auto-detects clang resource dir)
│   ├── src/                    ← framework source
│   ├── examples/               ← demo.nim and friends
│   ├── tests/
│   ├── toolchain/
│   │   └── wasi-sysroot.tar    ← wasi-libc headers + libc.a (for the native framework build)
│   ├── wasm-sysroot/           ← extracted wasi-sysroot (build output)
│   └── dist/                   ← built framework + demo app.wasm (build output)
│
├── toolchain/                  ← the from-source build system (the heart)
│   ├── README.md               ← full reproducibility table
│   ├── versions.env            ← every upstream commit, pinned in one place
│   ├── memfs/
│   │   ├── Dockerfile
│   │   ├── build.sh
│   │   └── src/                ← memfs.c + stb_sprintf.h, vendored as source
│   ├── nim-wasm/
│   │   ├── Dockerfile
│   │   └── build.sh
│   └── clang-wasm/
│       ├── Dockerfile
│       ├── build.sh
│       ├── patch-clang-js.sh        ← -fno-common injection (idempotent)
│       ├── patch-worker-bindweb.sh  ← worker try/catch (idempotent)
│       ├── wasi-toolchain.cmake
│       ├── wasi-project-before.cmake
│       ├── wasi-project-after.cmake
│       └── cmake-shim/              ← helpers used by the cross-wasi-sdk build
│
└── .github/
    └── workflows/
        └── build-toolchain.yml ← CI: builds every artifact from source
```

---

## What's pinned

Every upstream commit is pinned in [`toolchain/versions.env`](toolchain/versions.env):

| component     | upstream                                                | pin (commit)                                | notes |
|---------------|---------------------------------------------------------|---------------------------------------------|-------|
| LLVM/Clang/LLD | [`binji/llvm-project`](https://github.com/binji/llvm-project) (LLVM 8.0.1 fork) | `5dc09c94393510bc8d042a9f07382b53e845c0f2` | binji's fork already carries the wasm/memfs patches |
| wasi-sdk      | [`WebAssembly/wasi-sdk`](https://github.com/WebAssembly/wasi-sdk) | `db1b572d4b55e8d8cbc5cc7f950246efa6f55ed2` (v12) | last series whose wasi-libc exposes `<wasi/core.h>` (used by `memfs.c`) |
| memfs         | `binji/wasm-clang` `binji/memfs.c` + `stb_sprintf.h`    | vendored as source under `toolchain/memfs/src/` | |
| Nim           | [`nim-lang/Nim`](https://github.com/nim-lang/Nim) v2.0.14 | `cdaaef08b0ad189e21cdd09a4c861306ec22d4e4` | cross-compiled via Emscripten |
| Emscripten    | [`emscripten-core/emsdk`](https://github.com/emscripten-core/emsdk) 3.1.69 | `a36df02dc438e8b02f91122a4c62eeecb6784272` | produces `nim-bundle.js` (Emscripten module) |

Bump a pin → rerun `make toolchain && make ide`. The output is reproducible
from the pin + the patches.

---

## The two clang.js patches

`clang.js` is the JS driver that ships in `binji/wasm-clang`. It embeds a
base64 web worker. Two patches are required for the in-browser Nim + Bindweb
pipeline to work end-to-end. Both live in
[`toolchain/clang-wasm/`](toolchain/clang-wasm/) and are applied automatically
by `make ide`:

| script                                       | what it does                                                                                  | why                                                                                  |
|----------------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| [`patch-clang-js.sh`](toolchain/clang-wasm/patch-clang-js.sh) | Injects `-fno-common` into the embedded clang invocation                                    | Works around LLVM 8's `WasmObjectWriter` `llvm_unreachable` on Nim's tentative-definition globals. |
| [`patch-worker-bindweb.sh`](toolchain/clang-wasm/patch-worker-bindweb.sh) | Wraps the worker's `compile-each-link` instantiate-and-run in `try`/`catch`                 | Without it, the worker hangs the host page on `LinkError` when the linked `app.wasm` has unresolved `env.bindweb_*` imports. |

Both are **idempotent** — re-running on an already-patched file is a no-op.
The `make ide` target invokes both in order after copying the freshly-built
artifacts into `IDE/static/`. No manual patching step is needed.

> **Diagnose missing patches:** if you see "STEP 2: Compile C → wasm + link
> with bindweb runtime" hang for >10 s, the worker try/catch patch is
> missing. If you see a `wasm-ld` `llvm_unreachable` mid-link, the
> `-fno-common` patch is missing. Re-run `make ide` (or invoke the patch
> scripts by hand against `IDE/static/clang/clang.js`).

### Bumping the cache-bust

The IDE imports `clang.js` with a `?v=<bump>` query string. Bump it (in
`IDE/index.html`) whenever you change the worker source, otherwise browsers
may cache the un-patched copy.

---

## Bundled compiler artifacts

The bundle ships with a pre-built toolchain so `make ide && make serve` (or
just `python3 -m http.server 8080` inside `IDE/`) works without rebuilding
anything. MD5s of the bundled binaries:

| file                                | MD5                                 | built from                                                    |
|-------------------------------------|-------------------------------------|---------------------------------------------------------------|
| `IDE/static/clang/clang.wasm` (31 MB) | `fd63fc9e39f1c08200518e6b59da5d81`  | `binji/llvm-project` cross-compiled to wasm32-wasi            |
| `IDE/static/clang/lld.wasm` (19 MB)   | `4264aa35d1bc5fd10ba91d61d0048033`  | same                                                          |
| `IDE/static/clang/memfs.wasm` (345 KB)| `9a155eb19e9010d0eeb4dce7d45e7054`  | `binji/wasm-clang` `binji/memfs.c` + `stb_sprintf.h` (as source) |
| `IDE/static/clang/sysroot.tar` (8.9 MB)| `60410a2bff1b8578c9a929a457cb5d6b`  | wasi-sdk + libc++ + clang builtin headers                    |
| `IDE/static/clang/clang.js` (19 KB)   | ETag `5D9174630A587789A1E92B79AE1EC1C6` | `binji/wasm-clang` `clang.js` + both patches in this repo    |
| `IDE/static/nim/nim.wasm` (4.6 MB)    | —                                   | `nim-lang/Nim` v2.0.14 cross-compiled via Emscripten 3.1.69   |
| `IDE/static/nim/nim-bundle.js` (6.3 MB)| —                                  | same                                                          |
| `IDE/static/nim/nimbase.h` (20 KB)    | —                                   | Nim stdlib header                                             |

---

## Verifying the bundle

After extracting, run a quick sanity check:

```bash
# 1. wasm binaries are well-formed WebAssembly modules
for f in IDE/static/clang/*.wasm IDE/static/nim/nim.wasm; do
  node -e "WebAssembly.compile(require('fs').readFileSync(process.argv[1])).then(()=>console.log('OK',process.argv[1]))" "$f"
done

# 2. memfs exports the names clang.wasm's wasi_unstable imports expect
node -e '
  const fs=require("fs");
  WebAssembly.compile(fs.readFileSync("IDE/static/clang/memfs.wasm")).then(m=>{
    const e=WebAssembly.Module.exports(m).map(x=>x.name);
    const need=["fd_read","fd_write","fd_close","path_open","fd_seek","fd_prestat_get","fd_prestat_dir_name","fd_filestat_get"];
    const miss=need.filter(n=>!e.includes(n));
    if(miss.length) throw new Error("memfs missing exports: "+miss.join(","));
    console.log("memfs exports: OK ("+e.length+" total)");
  });'

# 3. clang.js carries BOTH patches (decoded from the base64 worker blob)
python3 -c "
import re, base64
s=open('IDE/static/clang/clang.js').read()
m=re.search(r'\(a=\"([A-Za-z0-9+/=]+)\",G=null', s)
w=base64.b64decode(m.group(1)).decode('utf8','replace')
assert '\"-fno-common\"' in w, 'clang.js is NOT patched (-fno-common missing)'
assert 'let finalResult=null;try{finalResult=await s.run(inst,h.out);}catch(e)' in w, 'clang.js is NOT patched (worker try/catch missing)'
print('clang.js patches: OK (-fno-common + worker try/catch)')
"

# 4. serve and click Build & Run in the browser
cd IDE && python3 -m http.server 8080
# → http://localhost:8080
```

---

## How compilation flows

```
                ┌──────────────────────────┐
                │  IDE/static/clang/       │
   user clicks  │   clang.wasm  lld.wasm   │
   Build & Run  │   memfs.wasm  sysroot.tar│
        │       │   clang.js  (PATCHED)    │
        ▼       └──────────────────────────┘
   ┌────────────────────────────────────────────────────────────┐
   │ STEP 1: Nim source → C (nim.wasm + nim-bundle.js)          │
   │ STEP 2: C → wasm objects (clang.wasm) → link (lld.wasm)    │
   │   ↳  worker try/catch patch keeps the worker from hanging  │
   │   ↳  -fno-common patch keeps wasm-ld from llvm_unreachable│
   │ STEP 3: re-instantiate app.wasm with bindweb env + wasi shim│
   │ STEP 4: call _start → Bindweb flushes DOM updates to host  │
   └────────────────────────────────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────┐
                │  IDE/static/nim/         │
                │   nim.wasm  nim-bundle.js│
                │   nimbase.h              │
                └──────────────────────────┘
```

`Bindweb/src/bindweb.nim` (the framework) is the Nim side of the picture: it
emits the `env.bindweb_*` imports that the linker leaves unresolved, plus the
DOM-construction calls the IDE's host JS handles. See
[`Bindweb/SPEC.md`](Bindweb/SPEC.md) for the protocol.

---

## Tearing it down

```bash
make clean        # removes out/, toolchain/*/out, toolchain/*/work
```

This does **not** delete `IDE/static/`. To also clear the IDE's static
artifacts (so you can verify a fresh `make ide` works):

```bash
rm -rf IDE/static/clang/* IDE/static/nim/*
make toolchain && make ide
```

---

## License

- **IDE + JS glue + this bundle's README/Makefile:** MIT.
- **Bindweb framework:** MIT — see [`Bindweb/`](Bindweb).
- **`clang.wasm`, `lld.wasm`, `memfs.wasm`, `sysroot.tar`:** © Andy Wingo,
  vendored from [`binji/wasm-clang`](https://github.com/binji/wasm-clang) and
  [`binji/llvm-project`](https://github.com/binji/llvm-project) — see the LLVM
  and wasi-libc licenses in those projects.
- **`nim.wasm`, `nim-bundle.js`, `nimbase.h`:** Nim 2.0.14, MIT.

---

## Credits

This project is a from-source rebuild of
[`benagastov/bindweb-nim-WASM-compiler`](https://github.com/benagastov/bindweb-nim-WASM-compiler),
which itself builds on Andy Wingo's CppCon 2019 demo
([`binji/wasm-clang`](https://github.com/binji/wasm-clang)) and the
[`nim-lang/Nim`](https://github.com/nim-lang/Nim) compiler. See
[`MIGRATION.md`](MIGRATION.md) for the full lineage.
