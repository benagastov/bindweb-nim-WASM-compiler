## Core Bindweb bindings -- provides the bridge between Nim and the C runtime.
## All API modules import this file for flush(), pushCommand(), pushData(), pollEvent().

{.compile: "../bindweb_runtime.c".}
import bindwebtypes

# ------------------------------------------------------------------------------
# C imports -- core runtime functions
# ------------------------------------------------------------------------------

when defined(wasm):
  proc bindweb_push_u32(v: uint32) {.importc.}
  proc bindweb_push_i32(v: int32) {.importc.}
  proc bindweb_push_float(v: float32) {.importc.}
  proc bindweb_push_double(v: float64) {.importc.}
  proc bindweb_push_string(str: cstring, len: csize_t) {.importc.}
  proc bindweb_flush() {.importc.}
  proc bindweb_next_event(opcode: ptr uint8, data: ptr ptr uint8, len: ptr uint32): bool {.importc.}
  proc c_bindweb_scratch_buffer_data(): ptr uint8 {.importc: "bindweb_scratch_buffer_data".}

  proc bindwebScratchBufferData*(): ptr uint8 {.inline.} =
    c_bindweb_scratch_buffer_data()

  # JS-side imports
  proc bindweb_js_flush(p: uint, size: csize_t) {.importc.}

  # C runtime functions re-exported to JS
  proc c_bindweb_event_buffer_ptr(): ptr uint8 {.importc: "bindweb_event_buffer_ptr".}
  proc c_bindweb_event_offset_ptr(): ptr uint32 {.importc: "bindweb_event_offset_ptr".}
  proc c_bindweb_event_buffer_capacity(): uint32 {.importc: "bindweb_event_buffer_capacity".}
  proc c_bindweb_scratch_buffer_ptr(): ptr uint8 {.importc: "bindweb_scratch_buffer_ptr".}
  proc c_bindweb_scratch_buffer_capacity(): uint32 {.importc: "bindweb_scratch_buffer_capacity".}
else:
  # Native stub implementations for testing
  var g_scratch: array[4096, uint8]
  proc bindwebScratchBufferData*(): ptr uint8 {.inline.} = addr g_scratch[0]
  proc bindweb_push_u32(v: uint32) = discard
  proc bindweb_push_i32(v: int32) = discard
  proc bindweb_push_float(v: float32) = discard
  proc bindweb_push_double(v: float64) = discard
  proc bindweb_push_string(str: cstring, len: csize_t) = discard
  proc bindweb_flush() = discard
  proc bindweb_next_event(opcode: ptr uint8, data: ptr ptr uint8, len: ptr uint32): bool = false

# ------------------------------------------------------------------------------
# Nim API
# ------------------------------------------------------------------------------

proc flush*() {.inline.} =
  ## Send all queued commands to JavaScript for execution.
  ## Call this after building a frame's worth of commands.
  bindweb_flush()

proc pushCommand*(opcode: uint32) {.inline.} =
  ## Push a command opcode to the buffer.
  bindweb_push_u32(opcode)

proc pushData*[T](value: T) =
  ## Push typed data to the command buffer.
  ## Supported types: uint32, int32, uint8, float32, float64, Handle (and distinct handle types).
  when T is uint32:
    bindweb_push_u32(value)
  elif T is int32:
    bindweb_push_i32(value)
  elif T is uint8:
    bindweb_push_u32(uint32(value))
  elif T is float32:
    bindweb_push_float(value)
  elif T is float64:
    bindweb_push_double(value)
  elif T is Handle:
    bindweb_push_i32(int32(value))
  else:
    # For distinct handle types (all distinct int32), cast through int32
    bindweb_push_i32(int32(value))

proc pushString*(s: string) {.inline.} =
  ## Push a Nim string to the command buffer.
  bindweb_push_string(s.cstring, s.len.csize_t)

proc pushStringView*(sv: StringView) {.inline.} =
  ## Push a StringView to the command buffer.
  bindweb_push_string(cast[cstring](sv.data), sv.len.csize_t)

# ------------------------------------------------------------------------------
# Event polling
# ------------------------------------------------------------------------------

proc pollEvent*(event: var PollEvent): bool =
  ## Poll for the next event from JavaScript.
  ## Returns true if an event was available.
  ## Check event.opcode against event type constants, then parse.
  bindweb_next_event(addr event.opcode, addr event.data, addr event.len)

# ------------------------------------------------------------------------------
# Deferred handle allocation
# ------------------------------------------------------------------------------

var deferredCounter: int32 = DEFERRED_HANDLE_START

proc nextDeferredHandle*(): int32 {.inline.} =
  ## Get a handle ID for deferred DOM element creation.
  ## These IDs start at 0x100000 to avoid collision with JS-assigned handles.
  result = deferredCounter
  inc deferredCounter

# ------------------------------------------------------------------------------
# Convenience: event parsing helpers
# ------------------------------------------------------------------------------

template ptrAt(data: ptr uint8, offset: uint32): untyped =
  ## Helper for safe pointer arithmetic: compute data + offset as a pointer.
  cast[pointer](cast[uint](data) + uint(offset))

proc readInt32*(data: ptr uint8, offset: var uint32): int32 {.inline.} =
  ## Read an int32 from event data and advance offset.
  result = cast[ptr int32](ptrAt(data, offset))[]
  offset += 4

proc readUint32*(data: ptr uint8, offset: var uint32): uint32 {.inline.} =
  ## Read a uint32 from event data and advance offset.
  result = cast[ptr uint32](ptrAt(data, offset))[]
  offset += 4

proc readUint8*(data: ptr uint8, offset: var uint32): uint8 {.inline.} =
  ## Read a uint8 from event data and advance offset.
  result = cast[ptr uint8](ptrAt(data, offset))[]
  offset += 4  # padded to 4 bytes

proc readFloat32*(data: ptr uint8, offset: var uint32): float32 {.inline.} =
  ## Read a float32 from event data and advance offset.
  result = cast[ptr float32](ptrAt(data, offset))[]
  offset += 4

proc readFloat64*(data: ptr uint8, offset: var uint32): float64 {.inline.} =
  ## Read a float64 from event data and advance offset (aligned to 8).
  let addr64 = cast[uint](ptrAt(data, offset))
  offset = uint32((addr64 + 7) and (not 7'u) - cast[uint](data))
  result = cast[ptr float64](ptrAt(data, offset))[]
  offset += 8

proc readString*(data: ptr uint8, offset: var uint32): string {.inline.} =
  ## Read a string from event data and advance offset.
  let len = cast[ptr uint32](ptrAt(data, offset))[]
  offset += 4
  result = newString(len)
  if len > 0:
    copyMem(addr result[0], ptrAt(data, offset), len)
  offset += (len + 3) and (not 3'u32)  # pad to 4

# ------------------------------------------------------------------------------
# Compile-time opcode usage registry (for JS tree-shaking)
# ------------------------------------------------------------------------------

import std/[macros, sets, algorithm]

var gUsedOpcodes {.compileTime.}: HashSet[int]

template markUsed*(op: int) =
  ## Register an opcode as used at compile time.
  ## The JS generator can read the emitted set to tree-shake unused cases.
  static: gUsedOpcodes.incl(op)

proc emitUsedOpcodes*(): seq[int] {.compileTime.} =
  ## Return the set of opcodes marked as used during compilation.
  ## Call from a static block to write an app.used file for the JS generator.
  for op in gUsedOpcodes:
    result.add(op)
  sort(result)

# ------------------------------------------------------------------------------
# OwnedElement - GC-aware handle wrapper
# ------------------------------------------------------------------------------
# When an OwnedElement goes out of scope, ARC runs =destroy, which emits
# RELEASE_HANDLE into the command buffer. This lets JS recycle the slot.
# The symmetric inverse of GC_ref (which keeps the app alive across the
# WASM/JS boundary).

type OwnedHandle* = object
  handle*: Handle

proc `=destroy`*(e: OwnedHandle) =
  if e.handle.int32 != 0:
    # Queue RELEASE_HANDLE into the command buffer; flushed normally
    pushCommand(0x1Eu32)
    pushData(e.handle.int32)

proc own*(h: Handle): OwnedHandle =
  ## Wrap a handle for automatic release when the Nim value dies.
  OwnedHandle(handle: h)

converter toHandle*(e: OwnedHandle): Handle = e.handle
  ## Allow passing OwnedHandle anywhere a Handle is expected.
