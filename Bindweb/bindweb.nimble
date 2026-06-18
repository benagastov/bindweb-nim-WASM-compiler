# Nim Bindweb — Lightweight Nim + C WASM framework for the browser.
# Write Nim that compiles to WebAssembly and calls HTML5 APIs via a
# command-buffer bridge to a small C runtime.

version     = "0.1.0"
author      = "Bindweb Contributors"
description = "Nim + C WASM framework for building browser apps (DOM, Canvas, WebGL, WebGPU, Audio, WebSocket, Fetch)"
license     = "MIT"
srcDir      = "src/nim"
binDir      = "bin"
bin         = @["bindwebbuild"]

requires "nim >= 2.0.0"

# ------------------------------------------------------------------------------
# Tasks
# ------------------------------------------------------------------------------

task gen, "Generate Nim API modules from schema.def":
  exec "nim c -r src/nim/bindwebgenerator.nim --apis-only --apis:src/nim/apis"

task js, "Generate the JS runtime (dist/app.js) from schema.def":
  exec "nim c -r src/nim/bindwebjsgen.nim --js-only --out:dist"

task wasm, "Cross-compile the Canvas demo to dist/app.wasm (needs clang+wasm-ld+WASI_SYSROOT)":
  exec "nim c -d:wasm -d:release -o:dist/app.wasm examples/demo.nim"

task demo, "Full demo build: APIs -> JS runtime -> app.wasm -> dist/index.html":
  exec "nim c -r src/nim/bindwebgenerator.nim --apis-only --apis:src/nim/apis"
  exec "nim c -r src/nim/bindwebjsgen.nim --js-only --out:dist"
  exec "nim c -d:wasm -d:release -o:dist/app.wasm examples/demo.nim"
  exec "nim c -r src/nim/bindwebbuild.nim --out:dist examples/demo.nim"

task tests, "Run the generator/parser smoke tests":
  exec "nim c -r src/nim/bindwebschema.nim"
  exec "nim c -r src/nim/bindwebgenerator.nim --apis-only --apis:src/nim/apis"
  exec "nim c -r src/nim/bindwebjsgen.nim --js-only --out:dist"
  echo "All smoke tests passed"

task clean, "Remove generated files":
  rmDir "src/nim/apis"
  rmDir "dist"
  rmDir "bin"
  echo "Cleaned"
