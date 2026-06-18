# =============================================================================
# config.nims -- build configuration for Nim Bindweb
# =============================================================================
# Native builds (running the generators) need nothing special.
# Pass -d:wasm to cross-compile a Bindweb app to WebAssembly.
#
#   nim c -d:wasm -d:release -o:dist/app.wasm examples/demo.nim
#
# This requires:
#   * clang + wasm-ld (LLVM) on PATH
#   * a wasi sysroot (the project's static/clang/sysroot.tar, extracted)
# Point WASI_SYSROOT at the extracted sysroot, or edit the default below.
# =============================================================================

--path:"src/nim"

when defined(wasm):
  --cpu:wasm32
  --os:linux
  --mm:arc
  --threads:off
  --panics:on
  --define:noSignalHandler
  --define:useMalloc          # route allocation through wasi-libc dlmalloc
  --noMain:on

  --cc:clang
  # Drive both compile and link through clang targeting wasm32. clang invokes
  # wasm-ld for the link step, so we never call wasm-ld directly here.
  let sysroot = getEnv("WASI_SYSROOT", "wasm-sysroot")

  # The wasm32 compiler-rt builtins (__multi3, __udivti3, ...) live in the
  # sysroot under lib/clang/<ver>/lib/wasi. Auto-detect <ver> instead of
  # hardcoding it, so this works with ANY clang/sysroot (binji's 8.0.1, a
  # from-source sysroot, or a modern wasi-sdk). Override with CLANG_RESOURCE_DIR.
  proc detectResourceDir(root: string): string =
    let explicit = getEnv("CLANG_RESOURCE_DIR", "")
    if explicit.len > 0: return explicit
    let base = root & "/lib/clang"
    if dirExists(base):
      for path in listDirs(base):   # listDirs is available in NimScript
        if fileExists(path & "/lib/wasi/libclang_rt.builtins-wasm32.a"):
          return path
    return ""   # let clang use its own resource dir

  let resDir = detectResourceDir(sysroot)
  let resArg = if resDir.len > 0: " -resource-dir=" & resDir else: ""

  switch("clang.exe", "clang")
  switch("clang.linkerexe", "clang")
  switch("passC", "--target=wasm32-wasi --sysroot=" & sysroot &
                  " -fno-builtin -fno-common -Oz")
  # --export-dynamic / --export-table: reactor-style module whose exports
  # (NimMain, setMainLoop callbacks, ...) are called from JS.
  switch("passL", "--target=wasm32-wasi --sysroot=" & sysroot & resArg &
                  " -Wl,--export-dynamic -Wl,--export-table" &
                  " -Wl,--allow-undefined -lcanvas")
