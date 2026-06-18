# =============================================================================
# Nim-WASM IDE — from-source orchestrator.
#
#   make toolchain   # build clang.wasm, lld.wasm, memfs.wasm, sysroot.tar,
#                    # nim.wasm, nim-bundle.js FROM SOURCE (via Docker)
#   make ide         # copy fresh artifacts into bindweb-nim-browser/static/
#   make serve       # serve the IDE locally
#   make framework   # build the native Bindweb framework + demo app.wasm
#   make clean
#
# The heavy targets (clang, nim) shell out to Docker so they get the disk/RAM
# they need. They will not build on a tiny machine directly — that is expected;
# use Docker or the GitHub Actions workflow.
# =============================================================================
SHELL := /bin/bash
OUT   := $(CURDIR)/out
CLANG_DST := bindweb-nim-browser/static/clang
NIM_DST   := bindweb-nim-browser/static/nim

.PHONY: toolchain memfs clang nim ide serve framework clean help
help:
	@grep -E '^#( |  )' Makefile | sed 's/^# //'

toolchain: memfs clang nim ## build every wasm artifact from source

memfs:
	docker build -t nimwasm/memfs --build-arg WASI_SDK_VERSION=12.0 \
		-f toolchain/memfs/Dockerfile toolchain
	mkdir -p $(OUT) && docker run --rm -v "$(OUT):/out" nimwasm/memfs

clang:
	docker build -t nimwasm/clang --build-arg WASI_SDK_VERSION=12.0 \
		-f toolchain/clang-wasm/Dockerfile toolchain
	mkdir -p $(OUT) && docker run --rm -v "$(OUT):/out" nimwasm/clang

nim:
	docker build -t nimwasm/nim --build-arg EMSDK_VERSION=3.1.69 \
		-f toolchain/nim-wasm/Dockerfile toolchain
	mkdir -p $(OUT) && docker run --rm -v "$(OUT):/out" nimwasm/nim

ide: ## install built artifacts into the IDE (run after `make toolchain`)
	@test -f $(OUT)/clang.wasm || { echo "no artifacts in $(OUT); run 'make toolchain' first"; exit 1; }
	cp $(OUT)/clang.wasm $(OUT)/lld.wasm $(OUT)/sysroot.tar $(OUT)/memfs.wasm $(CLANG_DST)/
	cp $(OUT)/nim.wasm $(OUT)/nim-bundle.js $(OUT)/nimbase.h $(NIM_DST)/
	# clang.js is bit-for-bit the same upstream artifact whether we built it
	# from source or vendored binji's pristine copy, but it MUST be patched
	# for the in-browser Nim->Bindweb pipeline to work end-to-end:
	#   1. -fno-common  — sidesteps LLVM 8 WasmObjectWriter llvm_unreachable
	#                    on Nim's `common`-linkage tentative-definition globals.
	#   2. worker try/catch — the worker's compile-each-link case used to die
	#                    silently when the linked app.wasm's bindweb `env`
	#                    imports couldn't be resolved by the worker's
	#                    hardcoded wasi_unstable import object.
	# Both patches are idempotent (re-running on an already-patched file is
	# a no-op). See toolchain/clang-wasm/{patch-clang-js,patch-worker-bindweb}.sh.
	bash toolchain/clang-wasm/patch-clang-js.sh        $(CLANG_DST)/clang.js
	bash toolchain/clang-wasm/patch-worker-bindweb.sh  $(CLANG_DST)/clang.js
	@echo "IDE populated from source-built artifacts and clang.js patches applied."

serve:
	cd bindweb-nim-browser && python3 -m http.server 8080

framework: ## native build of the Bindweb framework + demo app.wasm
	@command -v nim >/dev/null || { echo "Nim not on PATH (see toolchain/nim-wasm or choosenim)"; exit 1; }
	cd nim-bindweb && \
	  mkdir -p wasm-sysroot dist && tar xf toolchain/wasi-sysroot.tar -C wasm-sysroot && \
	  WASI_SYSROOT="$$PWD/wasm-sysroot" sh -c '\
	    nim c -r --hints:off src/nim/bindwebgenerator.nim --apis-only --apis:src/nim/apis && \
	    nim c -r --hints:off src/nim/bindwebjsgen.nim --js-only --out:dist && \
	    nim c -d:wasm -d:release --hints:off -o:dist/app.wasm examples/demo.nim && \
	    nim c -r --hints:off src/nim/bindwebbuild.nim --out:dist examples/demo.nim'
	@echo "framework built -> nim-bindweb/dist/ (serve it: cd nim-bindweb/dist && python3 -m http.server 8080)"

clean:
	rm -rf $(OUT) toolchain/*/out toolchain/*/work
