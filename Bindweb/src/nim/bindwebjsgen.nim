## JavaScript runtime generator for WebCC.
## Generates bindweb-browser-runtime.js as an ES module with createBindwebRunner export.

import std/[strutils, sets, os]
import bindwebschema

# ------------------------------------------------------------------------------
# JS-safe parameter name (no Nim keyword renaming)
# ------------------------------------------------------------------------------
proc jsParamName(name: string; index: int): string =
  ## JS parameter name - uses original name, falls back to argN.
  ## Unlike jsParamName, does NOT rename 'func'→'fn' etc. (JS has different keywords).
  result = if name.len > 0: name else: "arg" & $index
  # Only avoid JS reserved words that would cause syntax errors
  case result:
    of "var": result = "vr"
    of "let": result = "lt"
    of "const": result = "cst"
    of "function": result = "fn"
    of "class": result = "cls"
    of "default": result = "dflt"
    else: discard

# ------------------------------------------------------------------------------
# JS_HEAD: ES module factory function start + env imports container
# ------------------------------------------------------------------------------
const JS_HEAD = """/**
 * Bindweb Browser Runtime -- ES Module
 * Generated from schema.def -- DO NOT EDIT
 */

export function createBindwebRunner(outputContainer) {
    const decoder = new TextDecoder();
    const text_encoder = new TextEncoder();

    let memory = null, exports = null, table = null, connected = false;
    let u8, i32, f32, f64;
    let event_buffer_ptr_val, event_offset_ptr_val, scratch_buffer_ptr_val;
    let event_u8, event_i32, event_offset_view, EVENT_BUFFER_SIZE;
    let _updateFn = null, _updatePending = false, _eventAttached = false;

    const elements = []; elements[0] = document.body;
    const freeHandles = [];
    let nextHandle = 1;
    const handleRegistry = new FinalizationRegistry((h) => {
        if (elements[h] === undefined && !freeHandles.includes(h)) freeHandles.push(h);
    });
    function allocHandle(el) {
        const h = freeHandles.length ? freeHandles.pop() : nextHandle++;
        elements[h] = el;
        handleRegistry.register(el, h);
        return h;
    }
    function releaseHandle(h) {
        if (h <= 0) return;
        elements[h] = undefined;
        freeHandles.push(h);
    }
    const contexts = [];
    const audios = [], websockets = [], images = [];
    const webgl_shaders = [], webgl_programs = [], webgl_buffers = [], webgl_uniforms = [];
    const webgpu_adapters = [], webgpu_devices = [], webgpu_queues = [];
    const webgpu_shaders = [], webgpu_encoders = [], webgpu_views = [];
    const webgpu_passes = [], webgpu_buffers = [], webgpu_pipelines = [];

    function refreshViews() {
        if (!memory) return;
        u8 = new Uint8Array(memory.buffer); i32 = new Int32Array(memory.buffer);
        f32 = new Float32Array(memory.buffer); f64 = new Float64Array(memory.buffer);
        event_u8 = new Uint8Array(memory.buffer, event_buffer_ptr_val);
        event_i32 = new Int32Array(memory.buffer, event_buffer_ptr_val);
        event_offset_view = new Uint32Array(memory.buffer, event_offset_ptr_val, 1);
    }
    function _triggerUpdate() {
        if (_updateFn && !_updatePending) { _updatePending = true; queueMicrotask(() => { _updatePending = false; _updateFn(performance.now()); }); }
    }

    // -- Import functions (env.*) called from WASM --
    const envImports = {
        bindweb_js_flush: (ptr, size) => { flush(ptr, size); },
        __cxa_atexit: () => 0, __cxa_thread_atexit: () => 0, __cxa_finalize: () => {},
"""

# ------------------------------------------------------------------------------
# Between imports and events
# ------------------------------------------------------------------------------
const JS_MID = """
    };

"""

# ------------------------------------------------------------------------------
# FLUSH function start
# ------------------------------------------------------------------------------
const JS_FLUSH_HEAD = """
    // -- Flush: processes commands from WASM memory --
    function flush(ptr, size) {
        if (size === 0) return;
        if (!memory) { console.error('[bindweb] flush before connect'); return; }
        if (u8.buffer !== memory.buffer) refreshViews();
        let pos = ptr, end = ptr + size;
        while (pos < end) {
            if (pos + 4 > end) break;
            const opcode = i32[pos >> 2]; pos += 4;
            switch (opcode) {
"""

# ------------------------------------------------------------------------------
# FLUSH function end + public API return
# ------------------------------------------------------------------------------
const JS_TAIL = """                default: console.error("[bindweb] Unknown opcode:", opcode); return;
            }
        }
    }

    // -- Public API --
    return {
        imports: { env: envImports },
        connect(instance) {
            exports = instance.exports; memory = exports.memory; table = exports.__indirect_function_table;
            event_buffer_ptr_val = exports.bindweb_event_buffer_ptr();
            event_offset_ptr_val = exports.bindweb_event_offset_ptr();
            scratch_buffer_ptr_val = exports.bindweb_scratch_buffer_ptr();
            EVENT_BUFFER_SIZE = exports.bindweb_event_buffer_capacity();
            refreshViews(); connected = true;
            if (!_eventAttached) {
                document.body.addEventListener('click', (e) => { let el = e.target, p = false; while (el && el !== document.body) { if (el.dataset.c) { push_event_dom_CLICK(parseInt(el.dataset.c)); p = true; } el = el.parentElement; } if (p) _triggerUpdate(); });
                document.body.addEventListener('input', (e) => { let el = e.target, p = false; while (el && el !== document.body) { if (el.dataset.i) { push_event_dom_INPUT(parseInt(el.dataset.i), e.target.value || ''); p = true; } el = el.parentElement; } if (p) _triggerUpdate(); });
                document.body.addEventListener('change', (e) => { let el = e.target, p = false; while (el && el !== document.body) { if (el.dataset.g) { const v = e.target.type === 'checkbox' ? (e.target.checked ? 'true' : 'false') : (e.target.value || ''); push_event_dom_CHANGE(parseInt(el.dataset.g), v); p = true; } el = el.parentElement; } if (p) _triggerUpdate(); });
                _eventAttached = true;
            }
            return this;
        },
        startEventLoop() {
            window.addEventListener('resize', () => { push_event_input_RESIZE(window.innerWidth, window.innerHeight); _triggerUpdate(); });
            push_event_input_RESIZE(window.innerWidth, window.innerHeight);
        },
        disconnect() { connected = false; memory = null; exports = null; table = null; },
        get isConnected() { return connected; }
    };
}
export default createBindwebRunner;
"""

# ------------------------------------------------------------------------------
# Generate JS import function for a return-value command
# ------------------------------------------------------------------------------
proc genJsImport(c: SchemaCommand): string =
  let importName = "bindweb_" & c.ns & "_" & c.funcName
  var lines: seq[string]
  var sig = "        " & importName & ": ("
  var params: seq[string]
  for i, p in c.params:
    let pname = jsParamName(p.name, i)
    if p.paramType == ptString: params.add(pname & "_ptr, " & pname & "_len")
    else: params.add(pname)
  sig.add(params.join(", ")); sig.add(") => {")
  lines.add(sig)
  for i, p in c.params:
    let pname = jsParamName(p.name, i)
    if p.paramType == ptString:
      lines.add("            const " & pname & " = decoder.decode(new Uint8Array(memory.buffer, " & pname & "_ptr, " & pname & "_len));")
  var actionBody = c.action
  if actionBody.len > 0 and actionBody[0] == '{':
    let lastBrace = actionBody.rfind('}')
    if lastBrace > 0: actionBody = actionBody[1 ..< lastBrace].strip()
  for al in actionBody.splitLines(): lines.add("            " & al)
  if c.returnType == "string":
    lines.add("            const encoded = text_encoder.encode(ret);")
    lines.add("            const len = encoded.length;")
    lines.add("            new Uint8Array(memory.buffer, scratch_buffer_ptr_val).set(encoded);")
    lines.add("            return len;")
  lines.add("        }")
  result = lines.join("\n")

# ------------------------------------------------------------------------------
# Generate push_event helper for an event
# ------------------------------------------------------------------------------
proc genPushEvent(evt: SchemaEvent): string =
  var lines: seq[string]
  var sig = "    function push_event_" & evt.ns & "_" & evt.name & "("
  var params: seq[string]
  for i, p in evt.params: params.add(jsParamName(p.name, i))
  sig.add(params.join(", ")); sig.add(") {")
  lines.add(sig)
  lines.add("        if (event_u8.buffer !== memory.buffer) refreshViews();")
  lines.add("        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) { console.warn('Event buffer full'); return; }")
  lines.add("        let pos = event_offset_view[0]; const start_pos = pos;")
  lines.add("        event_u8[pos] = " & $evt.opcode.int & "; pos += 4;")
  for i, p in evt.params:
    let pname = jsParamName(p.name, i)
    case p.paramType:
      of ptInt32, ptUint32, ptUint8, ptHandle:
        lines.add("        event_i32[pos >> 2] = " & pname & "; pos += 4;")
      of ptFloat64:
        lines.add("        pos = (pos + 7) & ~7; event_f64[pos >> 3] = " & pname & "; pos += 8;")
      of ptString:
        lines.add("        const enc" & $i & " = text_encoder.encode(" & pname & ");")
        lines.add("        event_i32[pos >> 2] = enc" & $i & ".length; pos += 4;")
        lines.add("        new Uint8Array(memory.buffer, event_buffer_ptr_val + pos).set(enc" & $i & "); pos += (enc" & $i & ".length + 3) & ~3;")
      else: discard
  lines.add("        const len = pos - start_pos;")
  lines.add("        event_u8[start_pos + 2] = len & 0xFF; event_u8[start_pos + 3] = (len >> 8) & 0xFF;")
  lines.add("        event_offset_view[0] = pos;")
  lines.add("    }")
  result = lines.join("\n")

# ------------------------------------------------------------------------------
# Generate JS case block for a void command
# ------------------------------------------------------------------------------
proc genJsCase(c: SchemaCommand): string =
  var lines: seq[string]
  lines.add("                case " & $c.opcode.int & ": {")
  for i, p in c.params:
    let vname = jsParamName(p.name, i)
    case p.paramType:
      of ptUint8, ptUint32, ptInt32, ptHandle, ptFuncPtr:
        lines.add("                    if (pos + 4 > end) break;")
        lines.add("                    const " & vname & " = i32[pos >> 2]; pos += 4;")
      of ptFloat32:
        lines.add("                    if (pos + 4 > end) break;")
        lines.add("                    const " & vname & " = f32[pos >> 2]; pos += 4;")
      of ptFloat64:
        lines.add("                    if (pos % 8 !== 0) pos += (8 - (pos % 8));")
        lines.add("                    if (pos + 8 > end) break;")
        lines.add("                    const " & vname & " = f64[pos >> 3]; pos += 8;")
      of ptString:
        lines.add("                    if (pos + 4 > end) break;")
        lines.add("                    const " & vname & "_len = i32[pos >> 2]; pos += 4;")
        lines.add("                    const " & vname & "_pad = (" & vname & "_len + 3) & ~3;")
        lines.add("                    if (pos + " & vname & "_pad > end) break;")
        lines.add("                    const " & vname & " = decoder.decode(u8.subarray(pos, pos + " & vname & "_len)); pos += " & vname & "_pad;")
  var actionBody = c.action
  if actionBody.len > 0 and actionBody[0] == '{':
    let lastBrace = actionBody.rfind('}')
    if lastBrace > 0: actionBody = actionBody[1 ..< lastBrace].strip()
  for al in actionBody.splitLines(): lines.add("                    " & al)
  lines.add("                    break;")
  lines.add("                }")
  result = lines.join("\n")

# ------------------------------------------------------------------------------
# Main: Generate the complete JS runtime file
# ------------------------------------------------------------------------------
proc generateJsRuntime*(defs: SchemaDefs; outPath: string) =
  var parts: seq[string]
  var voidCmds, retCmds: seq[SchemaCommand]
  for c in defs.commands:
    if c.returnType == "": voidCmds.add(c) else: retCmds.add(c)

  parts.add(JS_HEAD)
  var first = true
  for c in retCmds:
    if not first: parts.add(",")
    first = false
    parts.add(genJsImport(c))
  parts.add(JS_MID)
  for evt in defs.events:
    parts.add("    " & genPushEvent(evt)); parts.add("")
  parts.add(JS_FLUSH_HEAD)
  for c in voidCmds:
    parts.add(genJsCase(c)); parts.add("")
  parts.add(JS_TAIL)

  writeFile(outPath, parts.join("\n"))
  echo "Generated: ", outPath

# ------------------------------------------------------------------------------
# Standalone
# ------------------------------------------------------------------------------
when isMainModule:
  let defs = loadSchema("src/schema.def")
  generateJsRuntime(defs, "src/nim/apis/app.js")
