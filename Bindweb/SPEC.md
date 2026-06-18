# SPEC.md — Nim Bindweb Nim + C WASM Library

## Overview
Convert the Nim Bindweb C++ toolchain/framework into a Nim + C WASM library. The C++ code becomes portable C. The C++ header generator becomes a Nim code generator. The JS runtime generator becomes Nim. The result: Nim code compiles to WASM and calls browser APIs via the Nim Bindweb bridge.

## Project Structure

```
bindweb/                          # Root
├── src/
│   ├── bindweb_runtime.c         # Core C runtime (ALL core functionality)
│   ├── bindweb_runtime.h         # C header for runtime
│   ├── schema.def              # Schema definition (copied from original)
│   └── nim/
│       ├── bindwebtypes.nim      # Core types (handles, string_view, events)
│       ├── bindweb.nim           # Core bindings (flush, poll_event, push_command)
│       ├── bindwebschema.nim     # Schema parser (reads schema.def)
│       ├── bindwebgenerator.nim  # Nim API code generator
│       ├── bindwebjsgen.nim      # JS runtime generator
│       └── bindwebbuild.nim      # Build tool
├── examples/
│   └── demo.nim                # Canvas demo (ported from C++)
├── bindweb.nimble                # Package config
└── tests/
    └── test_basic.nim          # Basic tests
```

## Module Dependencies

```
bindweb_runtime.c/h          (no deps, pure C)
  ↑
bindwebtypes.nim             (imports bindweb_runtime types via {.importc.})
  ↑
bindweb.nim                  (imports bindwebtypes, calls into runtime)
  ↑
bindwebschema.nim            (pure Nim, parses schema.def)
  ↑
bindwebgenerator.nim         (imports bindwebschema, generates Nim API files)
  ↑
bindwebjsgen.nim             (imports bindwebschema, generates JS runtime)
  ↑
bindwebbuild.nim             (imports all above, build orchestration)
```

---

## Module 1: C Runtime (bindweb_runtime.c / bindweb_runtime.h)

### Purpose
The C runtime provides the core bridge between WASM and JavaScript. It manages the command buffer (C++ → JS), event buffer (JS → C++), scratch buffer (JS string returns), memory allocation, and libc stubs.

### Build Requirements
- Compiles with any C compiler targeting WASM (clang, emcc)
- No standard library dependencies except `<stdint.h>`, `<stddef.h>`
- No C++ features — pure C99/C11

### Exports (WASM-visible functions)

The following functions MUST be exported with `__attribute__((used, visibility("default")))`:

```c
// === Command Buffer ===
void bindweb_command_buffer_ptr(void);      // Returns pointer to command buffer (used by JS)
const uint8_t* bindweb_command_buffer_data(void);
size_t bindweb_command_buffer_size(void);
void bindweb_command_buffer_reset(void);
void bindweb_push_u32(uint32_t v);
void bindweb_push_i32(int32_t v);
void bindweb_push_float(float v);
void bindweb_push_double(double v);
void bindweb_push_string(const char* str, size_t len);

// === Event Buffer ===
uint8_t*  bindweb_event_buffer_ptr(void);
uint32_t* bindweb_event_offset_ptr(void);
uint32_t  bindweb_event_buffer_capacity(void);
void      bindweb_reset_event_buffer(void);
const uint8_t* bindweb_event_buffer_data(void);
uint32_t bindweb_event_buffer_size(void);
bool     bindweb_next_event(uint8_t* opcode, const uint8_t** data_ptr, uint32_t* data_len);

// === Scratch Buffer ===
uint8_t* bindweb_scratch_buffer_ptr(void);
uint32_t bindweb_scratch_buffer_capacity(void);
const uint8_t* bindweb_scratch_buffer_data(void);

// === Flush ===
// This calls the JS import bindweb_js_flush(ptr, size)
void bindweb_flush(void);

// === Allocator ===
void* bindweb_malloc(size_t size);
void  bindweb_free(void* ptr);

// === Libc Stubs ===
size_t strlen(const char *s);
void* memcpy(void *dest, const void *src, size_t n);
void* memset(void *dest, int c, size_t n);
void* memmove(void *dest, const void *src, size_t n);
```

### Internal Constants
- `COMMAND_BUFFER_SIZE = 1024 * 1024` (1MB)
- `EVENT_BUFFER_SIZE = 1024 * 1024` (1MB)
- `SCRATCH_BUFFER_SIZE = 4096` (4KB)

### Wire Format

#### Command Buffer Layout
Commands are appended as:
1. Opcode: uint32 (4 bytes, little-endian)
2. Parameters per schema type encoding

Type encodings:
- `int32`, `uint32`, `uint8`, `handle`, `func_ptr`: 4 bytes (little-endian)
- `float32`: 4 bytes (IEEE 754, memcpy'd)
- `float64`: 8 bytes aligned to 8-byte boundary (IEEE 754, memcpy'd)
- `string`: 4-byte length + string bytes + padding to 4-byte boundary

#### Event Buffer Layout
Events from JS to C++:
- `[Opcode:1][Pad:1][TotalSize:2][Data...]` where TotalSize includes the 4-byte header

#### Scratch Buffer
JS writes string data here, returns length. C++ reads from scratch buffer. Ephemeral — valid until next JS call.

### Allocator Design
Simple free-list allocator:
1. Uses `__heap_base` symbol as heap start
2. `malloc`: check free list for fitting block, else bump-allocate from heap
3. `free`: add block to front of free list
4. Auto-grow WASM memory via `__builtin_wasm_memory_size` / `__builtin_wasm_memory_grow`
5. All allocations 8-byte aligned

### C++ new/delete Replacement
Since this is pure C, we do NOT provide new/delete. The Nim GC handles Nim allocations. The C allocator is only for the runtime's internal use and for `malloc`/`free` that the C code calls directly.

---

## Module 2: Nim Core Types (bindwebtypes.nim)

### Purpose
Define all types used by the Nim Bindweb Nim API: handles, string views, events.

### Types

```nim
# Handle types — distinct int32 for type safety
type
  Handle* = distinct int32          # Untyped handle
  
  # Typed handle base — each API module defines its own via:
  # TypeNameHandle* = distinct int32
  
  InvalidHandle* = distinct int32   # Sentinel = -1

const
  INVALID_HANDLE* = Handle(-1)

# String view — lightweight borrowed string
type
  StringView* = object
    data*: ptr char
    len*: uint32

  # Nim-friendly dynamic string for return values
  WccString* = object
    data*: ptr char
    len*: uint32

# Event base type
type
  Event* = object
    opcode*: uint8
    data*: ptr uint8
    len*: uint32

# Event parsing result — used by poll_event
  EventResult*[T] = object
    has*: bool
    value*: T
```

### Handle Operations
```nim
proc isValid*(h: Handle): bool {.inline.} = int32(h) != -1
proc `==`*(a, b: Handle): bool {.inline.} = int32(a) == int32(b)
proc `!=`*(a, b: Handle): bool {.inline.} = int32(a) != int32(b)
proc toInt32*(h: Handle): int32 {.inline.} = int32(h)
proc handle*(v: int32): Handle {.inline.} = Handle(v)
```

---

## Module 3: Nim Core (bindweb.nim)

### Purpose
Core Nim bindings to the C runtime. Provides flush, command pushing, event polling.

### C Imports
```nim
{.compile: "../bindweb_runtime.c".}

# Import C functions from runtime
proc bindweb_push_u32(v: uint32) {.importc.}
proc bindweb_push_i32(v: int32) {.importc.}
proc bindweb_push_float(v: float32) {.importc.}
proc bindweb_push_double(v: float64) {.importc.}
proc bindweb_push_string(str: cstring, len: csize_t) {.importc.}
proc bindweb_flush() {.importc.}
proc bindweb_command_buffer_reset() {.importc.}
proc bindweb_next_event(opcode: ptr uint8, data: ptr ptr uint8, len: ptr uint32): bool {.importc.}
proc bindweb_scratch_buffer_data(): ptr uint8 {.importc.}
```

### Nim API

```nim
proc flush*() =
  ## Flush all queued commands to JavaScript
  bindweb_flush()

proc pushCommand*(opcode: uint32) {.inline.} =
  ## Push a command opcode to the buffer
  bindweb_push_u32(opcode)

proc pushData*[T](value: T) =
  ## Push typed data to the command buffer
  when T is uint32: bindweb_push_u32(value)
  elif T is int32: bindweb_push_i32(value)
  elif T is uint8: bindweb_push_u32(uint32(value))
  elif T is float32: bindweb_push_float(value)
  elif T is float64: bindweb_push_double(value)
  elif T is Handle: bindweb_push_i32(int32(value))
  else: {.error: "Unsupported pushData type".}

proc pushString*(s: string) {.inline.} =
  ## Push a string to the command buffer
  bindweb_push_string(s.cstring, s.len.csize_t)

proc pushStringView*(sv: StringView) {.inline.} =
  bindweb_push_string(cast[cstring](sv.data), sv.len.csize_t)

type
  PollEvent* = object
    opcode*: uint8
    data*: ptr uint8
    len*: uint32

proc pollEvent*(event: var PollEvent): bool =
  ## Poll for the next event from JavaScript
  bindweb_next_event(addr event.opcode, addr event.data, addr event.len)

proc nextDeferredHandle*(): int32 =
  ## Get next deferred handle (for batched DOM creation)
  var counter {.global.}: int32 = 0x100000
  result = counter
  inc counter
```

### WASM Exports (for JS runtime)
```nim
proc bindweb_event_buffer_ptr(): ptr uint8 {.exportc.}
proc bindweb_event_offset_ptr(): ptr uint32 {.exportc.}
proc bindweb_event_buffer_capacity(): uint32 {.exportc.}
proc bindweb_scratch_buffer_ptr(): ptr uint8 {.exportc.}
proc bindweb_scratch_buffer_capacity(): uint32 {.exportc.}
```

---

## Module 4: Schema Parser (bindwebschema.nim)

### Purpose
Parse the `schema.def` file into Nim data structures.

### Data Types

```nim
type
  ParamType* = enum
    ptInt32, ptUint32, ptUint8, ptFloat32, ptFloat64,
    ptString, ptHandle, ptFuncPtr

  SchemaParam* = object
    name*: string
    paramType*: ParamType
    handleType*: string     # e.g. "DOMElement", "" if not a handle

  SchemaCommand* = object
    ns*: string
    name*: string           # e.g. "GET_BODY"
    funcName*: string       # e.g. "get_body"
    opcode*: uint8
    params*: seq[SchemaParam]
    returnType*: string     # "", "int32", "uint32", "float64", "string", "handle"
    returnHandleType*: string
    action*: string         # JavaScript code

  SchemaEvent* = object
    ns*: string
    name*: string
    opcode*: uint8
    params*: seq[SchemaParam]

  SchemaMeta* = object
    kind*: string           # e.g. "inherit"
    derived*: string
    base*: string

  SchemaDefs* = object
    commands*: seq[SchemaCommand]
    events*: seq[SchemaEvent]
    handleInheritance*: Table[string, string]  # derived -> base
```

### Parser
```nim
proc loadSchema*(path: string): SchemaDefs
```
- Reads `schema.def` line by line
- Skips comments (lines starting with `#`)
- Parses pipe-separated format: `NAMESPACE|TYPE|NAME|FUNC_NAME|TYPES|JS_ACTION`
- For meta lines: `meta|inherit|Derived|Base`
- Auto-assigns opcodes sequentially per namespace

### Type String Parsing
Input examples for TYPES field:
- `RET:handle(DOMElement)` — return typed handle
- `RET:string` — return string
- `RET:int32` — return int32
- `handle(DOMElement):handle` — parameter: typed handle named "handle"
- `string:id` — parameter: string named "id"
- `float64:width` — parameter: float64 named "width"
- `uint8:r` — parameter: uint8 named "r"
- `func_ptr:func` — parameter: function pointer

---

## Module 5: Nim Code Generator (bindwebgenerator.nim)

### Purpose
Generate per-namespace Nim API modules from parsed schema.

### Generated File: handles.nim
```nim
# Type-safe handle types
type
  DOMElementHandle* = distinct int32
  CanvasHandle* = distinct int32
  CanvasContext2DHandle* = distinct int32
  WebGLContextHandle* = distinct int32
  WebGLShaderHandle* = distinct int32
  WebGLProgramHandle* = distinct int32
  WebGLBufferHandle* = distinct int32
  WebGLUniformHandle* = distinct int32
  WGPUContextHandle* = distinct int32
  WGPUAdapterHandle* = distinct int32
  WGPUDeviceHandle* = distinct int32
  WGPUQueueHandle* = distinct int32
  WGPUShaderModuleHandle* = distinct int32
  WGPUCommandEncoderHandle* = distinct int32
  WGPUTextureViewHandle* = distinct int32
  WGPURenderPassHandle* = distinct int32
  WGPUCommandBufferHandle* = distinct int32
  WGPURenderPipelineHandle* = distinct int32
  ImageHandle* = distinct int32
  AudioHandle* = distinct int32
  WebSocketHandle* = distinct int32
  FetchRequestHandle* = distinct int32
```

### Generated File: dom.nim (example pattern)
```nim
# Generated from schema — DO NOT EDIT
import ../bindweb, ../bindwebtypes, ../handles

# Opcode enum
type
  DomOpCode* = enum
    opGET_BODY = 0x00
    opGET_ELEMENT_BY_ID = 0x01
    ...

# Event type enum
type
  DomEventType* = enum
    domEventCLICK = 0x2A
    domEventINPUT = 0x2C
    ...

# Event structs
struct ClickEvent = object
  opcode* {.const.}: uint8 = domEventCLICK.ord
  handle*: DOMElementHandle

proc parseClickEvent*(data: ptr uint8, len: uint32): ClickEvent = ...

# Commands — void commands (push to command buffer)
proc getBody*(): DOMElementHandle =
  ## DOM: Get document.body
  flush()
  return DOMElementHandle(bindweb_dom_get_body())

# Import for return-value command
proc bindweb_dom_get_body(): int32 {.importc.}

proc getElementById*(id: string): DOMElementHandle =
  flush()
  return DOMElementHandle(bindweb_dom_get_element_by_id(id.cstring, id.len.uint32))

proc bindweb_dom_get_element_by_id(id: cstring, idLen: uint32): int32 {.importc.}

# Void command example
proc createElement*(tag: string): DOMElementHandle =
  pushCommand(opCREATE_ELEMENT.ord.uint32)
  pushString(tag)
  # ... this command returns a handle via import
  flush()
  return ...

proc setAttribute*(handle: DOMElementHandle, name: string, value: string) =
  pushCommand(opSET_ATTRIBUTE.ord.uint32)
  pushData(handle)
  pushString(name)
  pushString(value)
```

### Generation Rules

1. **Return-value commands**: Generate `{.importc.}` proc + Nim wrapper that calls `flush()` then the import
2. **Void commands**: Generate proc that pushes opcode + params to command buffer (NO flush — caller flushes)
3. **Events**: Generate struct with parse proc + opcode constant
4. **Handles**: Use typed handles from handles.nim, cast to/from int32 at boundaries
5. **Strings**: Nim `string` at API, converted to `cstring + len` at boundary
6. **Func ptr**: Use `pointer` type in Nim

### Command Serialization in Generated Code

For each void command with params, generate push calls in order:
```nim
proc setFillStyle*(ctx: CanvasContext2DHandle, r: uint8, g: uint8, b: uint8) =
  pushCommand(opSET_FILL_STYLE.ord.uint32)
  pushData(ctx)
  pushData(r)
  pushData(g)
  pushData(b)
```

For return-value commands, generate import wrapper:
```nim
proc getContext2d*(canvas: CanvasHandle): CanvasContext2DHandle =
  flush()
  return CanvasContext2DHandle(bindweb_canvas_get_context_2d(int32(canvas)))

proc bindweb_canvas_get_context_2d(canvasHandle: int32): int32 {.importc.}
```

---

## Module 6: JS Runtime Generator (bindwebjsgen.nim)

### Purpose
Generate the JavaScript runtime (`app.js`) that bridges between WASM and browser APIs.

### JS Template Parts

#### JS_HEAD
```javascript
const supportsStreaming = () => {
    try {
        if (typeof WebAssembly === 'undefined') return false;
        if (typeof WebAssembly.instantiateStreaming !== 'function') return false;
        return !/^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
               parseInt(navigator.userAgent.match(/version\/(\d+)/i)?.[1] || 0) >= 15;
    } catch { return false; }
};

const run = async () => {
    const scriptSrc = document.currentScript && document.currentScript.src;
    const assetBase = new URL('.', scriptSrc || window.location.href);
    const wasmUrl = new URL('app.wasm', assetBase);

    const imports = {
        env: {
            bindweb_js_flush: (ptr, size) => flush(ptr, size),
            __cxa_atexit: () => 0,
            __cxa_thread_atexit: () => 0,
            __cxa_finalize: () => {},
```

#### Per-Import Generators

For each USED return-value command, generate a JS import function:
```javascript
bindweb_dom_get_body: () => {
    if(!elements[0]) elements[0] = document.body;
    return 0;
},
bindweb_dom_get_element_by_id: (id_ptr, id_len) => {
    const id = decoder.decode(new Uint8Array(memory.buffer, id_ptr, id_len));
    const el = document.getElementById(id);
    if(!el) { console.warn('get_element_by_id: element not found', id); return -1; }
    const handle = (window.bindweb_next_id = (window.bindweb_next_id || 0) + 1);
    elements[handle] = el;
    return handle;
},
```

#### JS_MID (between imports and flush)
```javascript
        }
    };

    let mod;
    if (supportsStreaming()) {
        mod = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports);
    } else {
        const response = await fetch(wasmUrl);
        const bytes = await response.arrayBuffer();
        mod = await WebAssembly.instantiate(bytes, imports);
    }

    const { memory, main, __indirect_function_table: table,
            bindweb_event_buffer_ptr, bindweb_event_offset_ptr, bindweb_event_buffer_capacity,
            bindweb_scratch_buffer_ptr } = mod.instance.exports;

    const event_buffer_ptr_val = bindweb_event_buffer_ptr();
    const event_offset_ptr_val = bindweb_event_offset_ptr();
    const scratch_buffer_ptr_val = bindweb_scratch_buffer_ptr();
    let event_offset_view = new Uint32Array(memory.buffer, event_offset_ptr_val, 1);
    let event_u8 = new Uint8Array(memory.buffer, event_buffer_ptr_val);
    let event_i32 = new Int32Array(memory.buffer, event_buffer_ptr_val);
    let event_f32 = new Float32Array(memory.buffer, event_buffer_ptr_val);
    let event_f64 = new Float64Array(memory.buffer, event_buffer_ptr_val);
    const text_encoder = new TextEncoder();
    const EVENT_BUFFER_SIZE = bindweb_event_buffer_capacity();
    let _updateFn = null;
    let _updatePending = false;
    function _triggerDiscreteUpdate() {
        if (_updateFn && !_updatePending) {
            _updatePending = true;
            queueMicrotask(() => { _updatePending = false; _updateFn(performance.now()); });
        }
    }
```

#### Resource Maps (generated based on used commands)
```javascript
    const elements = {};
    const contexts = {};
    const audios = {};
    const images = {};
    const websockets = {};
    // ... (only include maps that are actually used)
```

#### Event Push Helpers (generated based on used events)
```javascript
    function push_event_dom_CLICK(handle) {
        if (event_u8.buffer !== memory.buffer) refreshEventViews();
        if (event_offset_view[0] + 4096 > EVENT_BUFFER_SIZE) return;
        let pos = event_offset_view[0];
        event_u8[pos] = OPCODE;
        pos += 4;
        event_i32[pos >> 2] = handle; pos += 4;
        event_u8[start_pos + 2] = (pos - start_pos) & 0xFF;
        event_u8[start_pos + 3] = ((pos - start_pos) >> 8) & 0xFF;
        event_offset_view[0] = pos;
    }
```

#### Flush Function (generated cases)
```javascript
    const decoder = new TextDecoder();
    let u8 = new Uint8Array(memory.buffer);
    let i32 = new Int32Array(memory.buffer);
    let f32 = new Float32Array(memory.buffer);
    let f64 = new Float64Array(memory.buffer);

    function flush(ptr, size) {
        if (size === 0) return;
        if (u8.buffer !== memory.buffer) { u8 = new Uint8Array(memory.buffer); i32 = new Int32Array(memory.buffer); f32 = new Float32Array(memory.buffer); f64 = new Float64Array(memory.buffer); }
        let pos = ptr;
        const end = ptr + size;
        while (pos < end) {
            if (pos + 4 > end) break;
            const opcode = i32[pos >> 2];
            pos += 4;
            switch (opcode) {
                // Generated cases here...
                case 0x00: {
                    // GET_BODY
                    if(!elements[0]) elements[0] = document.body;
                    break;
                }
                case 0x01: {
                    // GET_ELEMENT_BY_ID
                    if (pos + 4 > end) break;
                    const id_len = i32[pos >> 2]; pos += 4;
                    const id_padded = (id_len + 3) & ~3;
                    if (pos + id_padded > end) break;
                    const id = decoder.decode(u8.subarray(pos, pos + id_len)); pos += id_padded;
                    const el = document.getElementById(id);
                    // ...
                    break;
                }
                // ... more cases
                default:
                    console.error("Unknown opcode:", opcode);
                    return;
            }
        }
    }
```

#### JS_TAIL
```javascript
    if (main) main();
};
run();
```

### Generation Algorithm
1. Parse schema, determine which commands/events are used
2. Generate JS_HEAD
3. For each used return-value command: generate JS import function
4. Generate JS_MID
5. Determine required resource maps from used command actions
6. Generate resource map declarations
7. For each used event: generate push_event helper
8. Generate flush function with case blocks for used void commands
9. Generate JS_TAIL

### Usage Detection
- The generator can work in two modes:
  1. **Full mode**: Include all commands/events (simple, larger JS)
  2. **Tree-shaking mode**: Parse Nim source to detect which functions are called (advanced)
- Default: Full mode for simplicity

---

## Module 7: Build Tool (bindwebbuild.nim)

### Purpose
Orchestrate the build: generate APIs, compile Nim to WASM, generate JS + HTML.

### CLI Interface
```bash
bindwebbuild [options] <nim_source_files...>
  --out:DIR          Output directory (default: dist/)
  --schema:FILE      Schema file (default: src/schema.def)
  --full-js          Include all JS commands (default: tree-shake)
  --template:FILE    HTML template file
  --help             Show help
```

### Build Steps
1. Generate Nim API modules from schema (call generator)
2. Generate JS runtime (call jsgen)  
3. Compile Nim sources to WASM:
   ```bash
   nim c -d:release -d:wasm --os:linux --cpu:wasm32 \
         --gc:orc --threads:off -d:noSignalHandler \
         --passC:"-fno-builtin --target-features=+mutable-globals,+nontrapping-fptoint,+sign-ext,+bulk-memory,+simd128,+multivalue,+reference-types,+tail-call" \
         --passL:"--no-entry --export-dynamic" \
         -o:app.wasm <sources>
   ```
4. Write HTML file
5. Copy JS runtime to output dir

---

## Module 8: Demo (examples/demo.nim)

### Purpose
Port the Canvas 2D demo from C++ to Nim. Demonstrates:
- Canvas creation
- Mouse input handling
- Drawing with Canvas 2D API
- Main loop

### Structure
```nim
import bindweb, bindweb/apis/canvas, bindweb/apis/dom, bindweb/apis/system, bindweb/apis/input

var
  canvas: CanvasHandle
  ctx: CanvasContext2DHandle
  mouseX = 400
  mouseY = 300

proc update(timeMs: float64) =
  # Poll events
  var ev: PollEvent
  while pollEvent(ev):
    # Check event type and handle
    if ev.opcode == input.MOUSE_MOVE_EVENT_OPCODE:
      let event = parseMouseMoveEvent(ev.data, ev.len)
      mouseX = event.x
      mouseY = event.y

  # Draw background
  setFillStyle(ctx, 52, 152, 219)
  fillRect(ctx, 0, 0, 800, 600)

  # Draw circle at mouse
  beginPath(ctx)
  arc(ctx, float64(mouseX), float64(mouseY), 50.0, 0.0, 6.28318)
  setFillStyle(ctx, 241, 196, 15)
  fill(ctx)

  # Draw text
  setFont(ctx, "30px Arial")
  setFillStyle(ctx, 255, 255, 255)
  fillText(ctx, "Move your mouse!", 280, 500)

  # Flush commands
  flush()

proc main() =
  let body = getBody()
  canvas = createCanvas("game-canvas", 800, 600)
  appendChild(body, canvas)
  ctx = getContext2d(canvas)
  initMouse(cast[DOMElementHandle](canvas))
  setMainLoop(update)
  flush()

main()
```

---

## File: bindweb.nimble

```nim
# Package
version       = "0.1.0"
author        = "Nim Bindweb Contributors"
description   = "Lightweight Nim + C WASM framework for building WebAssembly applications"
license       = "MIT"
srcDir        = "src"
bin           = @["nim/bindwebbuild"]

# Dependencies
requires "nim >= 2.0.0"

# Tasks
task gen, "Generate API modules from schema":
  exec "nim c -r src/nim/bindwebgenerator.nim"

task demo, "Build demo":
  exec "nim c -r src/nim/bindwebbuild.nim examples/demo.nim"
```

---

## Build Flags for WASM

### Nim Compilation Flags
```bash
nim c -d:release -d:wasm \
  --os:linux --cpu:wasm32 \
  --gc:orc --threads:off \
  -d:noSignalHandler \
  -d:danger \
  --opt:size \
  --mm:orc \
  -d:useMalloc \
  --panics:on \
  --passC:"-fno-builtin -Wno-builtin-declaration-mismatch" \
  --passL:"--no-entry --export-dynamic -sALLOW_MEMORY_GROWTH" \
  -o:app.wasm \
  main.nim
```

### Important Notes
1. `-d:useMalloc`: Makes Nim use malloc/free which our allocator provides
2. `--gc:orc`: Nim's ORC GC works in WASM
3. `--threads:off`: No threading in WASM
4. `-d:noSignalHandler`: Signal handlers don't work in WASM
5. `--passL:"--export-dynamic"`: Export all symbols for JS to call
6. `--passL:"--no-entry"`: No WASI _start function needed
7. `--passC:"-fno-builtin"`: Prevents clang from using builtins we don't have

---

## Integration Notes

### Handle Type Conversions
In generated Nim code, handles are `distinct int32`. They must be cast to `int32` when passing to `{.importc.}` functions and cast back when receiving:
```nim
proc bindweb_dom_get_body(): int32 {.importc.}
proc getBody*(): DOMElementHandle =
  flush()
  DOMElementHandle(bindweb_dom_get_body())
```

### String Handling
Nim strings are passed as `(cstring, len)` pairs to C imports:
```nim
proc bindweb_dom_get_element_by_id(id: cstring, idLen: uint32): int32 {.importc.}
proc getElementById*(id: string): DOMElementHandle =
  flush()
  DOMElementHandle(bindweb_dom_get_element_by_id(id.cstring, id.len.uint32))
```

### Event Parsing
Events are parsed by reading from a byte buffer. The generated parse procs use `cast` to read typed values:
```nim
proc parseClickEvent*(data: ptr uint8, len: uint32): ClickEvent =
  var offset = 0'u32
  result.handle = DOMElementHandle(cast[ptr int32](data + offset)[])
  offset += 4
```

### Memory Coordination
- Nim's GC manages Nim objects
- The C allocator manages runtime buffers and serves Nim's malloc/free
- The JS runtime accesses WASM memory directly via TypedArrays
- Memory growth: C allocator auto-grows WASM memory; JS must refresh views after growth
