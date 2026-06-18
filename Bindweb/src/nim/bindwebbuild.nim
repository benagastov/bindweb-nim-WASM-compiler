## WebCC Build Tool
## Orchestrates: schema parsing → Nim API generation → JS runtime generation

import std/[os, strformat, strutils, parseopt]
import bindwebschema, bindwebgenerator, bindwebjsgen

# ------------------------------------------------------------------------------
# CLI help
# ------------------------------------------------------------------------------
proc writeHelp() =
  echo """bindwebbuild - WebCC Nim WASM Build Tool

Usage:
  bindwebbuild [options] <nim_source_files...>

Options:
  --out:DIR          Output directory (default: dist/)
  --schema:FILE      Schema file (default: src/schema.def)
  --apis:DIR         Generated APIs output dir (default: src/nim/apis/)
  --template:FILE    HTML template file
  --js-only          Only generate JS runtime (skip Nim API gen)
  --apis-only        Only generate Nim APIs (skip JS gen)
  --help             Show this help

Examples:
  bindwebbuild examples/demo.nim
  bindwebbuild --out:public examples/demo.nim
  bindwebbuild --schema:my_schema.def --out:dist src/app.nim
"""

# ------------------------------------------------------------------------------
# Generate HTML file
# ------------------------------------------------------------------------------
proc generateHtml(outPath: string; templatePath: string = "") =
  var html: string

  # The runtime (app.js) is an ES module exporting createBindwebRunner. The page
  # must import it, instantiate app.wasm with the runner's imports, connect, and
  # start the event loop.
  const bootScript = """<script type="module">
  import createBindwebRunner from './app.js';
  const runner = createBindwebRunner(document.body);
  const res = await fetch('./app.wasm');
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), runner.imports);
  runner.connect(instance);
  if (instance.exports._start) instance.exports._start();
  else if (instance.exports.main) instance.exports.main();
  runner.startEventLoop();
</script>"""

  if templatePath != "" and fileExists(templatePath):
    html = readFile(templatePath)
    if "{{script}}" in html:
      html = html.replace("{{script}}", bootScript)
    elif "</body>" in html:
      html = html.replace("</body>", bootScript & "\n</body>")
  else:
    html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bindweb App</title>
    <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
        canvas { display: block; }
    </style>
</head>
<body>
""" & bootScript & """
</body>
</html>
"""

  writeFile(outPath, html)
  echo "Generated: ", outPath

# ------------------------------------------------------------------------------
# Main build procedure
# ------------------------------------------------------------------------------
proc runBuild*(nimFiles: seq[string]; schemaPath, outDir, apisDir, templatePath: string;
               genApis, genJs: bool) =
  ## Run the full WebCC build pipeline.

  # 1. Load schema
  echo "=== Loading Schema ==="
  echo "Schema: ", schemaPath
  if not fileExists(schemaPath):
    stderr.writeLine("ERROR: Schema file not found: ", schemaPath)
    quit(1)
  let defs = loadSchema(schemaPath)
  echo "Commands: ", defs.commands.len
  echo "Events: ", defs.events.len
  echo "Namespaces: ", defs.getNamespaces().join(", ")

  # Configure buffer sizes (tunable via environment variables)
  let cmdBufferSize  = getEnv("BINDWEB_CMD_BUFFER_SIZE", "262144")   # 256 KB default (was 1 MB)
  let evtBufferSize  = getEnv("BINDWEB_EVT_BUFFER_SIZE", "262144")   # 256 KB default
  let scratchSize    = getEnv("BINDWEB_SCRATCH_SIZE", "4096")        # 4 KB unchanged
  echo "Buffer sizes: cmd=" & cmdBufferSize & " evt=" & evtBufferSize & " scratch=" & scratchSize

  # 2. Generate Nim APIs
  if genApis:
    echo "\n=== Generating Nim APIs ==="
    createDir(apisDir)
    generateAllApis(defs, schemaPath, apisDir)

  # 3. Generate JS runtime
  if genJs:
    echo "\n=== Generating JS Runtime ==="
    createDir(outDir)
    let jsPath = outDir / "app.js"
    generateJsRuntime(defs, jsPath)

    # 4. Generate HTML
    echo "\n=== Generating HTML ==="
    let htmlPath = outDir / "index.html"
    generateHtml(htmlPath, templatePath)

  # 5. Show next steps for Nim compilation
  if nimFiles.len > 0:
    echo "\n=== Nim Compilation ==="
    echo "Compile your Nim files to WASM with:"
    echo ""
    for f in nimFiles:
      echo "  nim c -d:release -d:wasm --os:linux --cpu:wasm32 \\"
      echo "    --gc:orc --threads:off -d:noSignalHandler \\"
      echo "    --passC:\"-fno-builtin\" \\"
      echo "    --passC:\"-DWEBCC_COMMAND_BUFFER_SIZE=" & cmdBufferSize & "\" \\"
      echo "    --passC:\"-DWEBCC_EVENT_BUFFER_SIZE=" & evtBufferSize & "\" \\"
      echo "    --passC:\"-DWEBCC_SCRATCH_BUFFER_SIZE=" & scratchSize & "\" \\"
      echo "    --passL:\"--no-entry --export-dynamic\" \\"
      echo "    -o:", outDir / "app.wasm", " ", f
    echo ""
    echo "Then serve the output directory:"
    echo "  cd ", outDir
    echo "  python3 -m http.server"
    echo "  # Open http://localhost:8000"

  # 6. Post-process: minify JS, optimize WASM
  if genJs:
    echo "\n=== Post-processing ==="
    let jsOut = outDir / "app.js"
    # Try terser for minification
    let terserCmd = "npx terser " & jsOut & " -c -m -o " & jsOut & " 2>/dev/null"
    let terserRc = execShellCmd(terserCmd)
    if terserRc == 0:
      let minSize = getFileSize(jsOut)
      echo "Minified JS: " & $minSize & " bytes"
    else:
      echo "[terser not found, skipping minification — install with: npm install -g terser]"
    # Try wasm-opt
    let wasmOut = outDir / "app.wasm"
    if fileExists(wasmOut):
      let optCmd = "wasm-opt -Oz --strip-debug --strip-producers " & wasmOut & " -o " & wasmOut & " 2>/dev/null"
      let optRc = execShellCmd(optCmd)
      if optRc == 0:
        let optSize = getFileSize(wasmOut)
        echo "Optimized WASM: " & $optSize & " bytes"
      else:
        echo "[wasm-opt not found, skipping — install Binaryen]"

  echo "\n=== Build Complete ==="

# ------------------------------------------------------------------------------
# CLI entry point
# ------------------------------------------------------------------------------
when isMainModule:
  var
    nimFiles: seq[string]
    schemaPath = "src/schema.def"
    outDir = "dist"
    apisDir = "src/nim/apis"
    templatePath = ""
    genApis = true
    genJs = true

  var optParser = initOptParser(commandLineParams())
  for kind, key, val in optParser.getopt():
    case kind
    of cmdArgument:
      nimFiles.add(key)
    of cmdLongOption, cmdShortOption:
      case key
      of "out", "o": outDir = val
      of "schema": schemaPath = val
      of "apis": apisDir = val
      of "template", "t": templatePath = val
      of "js-only": genApis = false
      of "apis-only": genJs = false
      of "help", "h":
        writeHelp()
        quit(0)
      else:
        stderr.writeLine("Unknown option: --", key)
        quit(1)
    of cmdEnd: discard

  if nimFiles.len == 0 and not genApis and not genJs:
    writeHelp()
    quit(1)

  runBuild(nimFiles, schemaPath, outDir, apisDir, templatePath, genApis, genJs)
