export const bindwebFiles = {
  '/bindweb/bindweb.nim': `
## Core BindWeb bindings -- provides the bridge between Nim and the C runtime.
## All API modules import this file for flush(), pushCommand(), pushData(), pollEvent().

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

proc \x60=destroy\x60*(e: OwnedHandle) =
  if e.handle.int32 != 0:
    # Queue RELEASE_HANDLE into the command buffer; flushed normally
    pushCommand(0x1Eu32)
    pushData(e.handle.int32)

proc own*(h: Handle): OwnedHandle =
  ## Wrap a handle for automatic release when the Nim value dies.
  OwnedHandle(handle: h)

converter toHandle*(e: OwnedHandle): Handle = e.handle
  ## Allow passing OwnedHandle anywhere a Handle is expected.
`,
  '/bindweb/bindwebtypes.nim': `
## Core types for the BindWeb WASM framework.
## Handle types, string views, and event primitives.

type
  ## Handle type -- distinct int32 for type safety.
  ## Each API module defines its own handle types (e.g., DOMElementHandle = distinct int32).
  Handle* = distinct int32

  ## StringView -- lightweight borrowed string referencing external memory.
  ## Used for reading strings from the event buffer without copying.
  StringView* = object
    data*: ptr char
    len*: uint32

  ## PollEvent -- raw event read from the event buffer.
  ## Use pollEvent() to get one. Check opcode, then parse with the appropriate parse function.
  PollEvent* = object
    opcode*: uint8
    data*: ptr uint8
    len*: uint32

const
  ## Invalid handle sentinel value.
  INVALID_HANDLE* = Handle(-1)

  ## Deferred handle starting value (avoids collision with JS-assigned handles).
  DEFERRED_HANDLE_START* = 0x100000'i32

# ------------------------------------------------------------------------------
# Handle operations
# ------------------------------------------------------------------------------

proc isValid*(h: Handle): bool {.inline.} =
  int32(h) != -1

proc \x60==\x60*(a, b: Handle): bool {.inline.} =
  int32(a) == int32(b)

proc \x60!=\x60*(a, b: Handle): bool {.inline.} =
  int32(a) != int32(b)

proc toInt32*(h: Handle): int32 {.inline.} =
  int32(h)

proc handle*(v: int32): Handle {.inline.} =
  Handle(v)

# ------------------------------------------------------------------------------
# Typed handle helpers (generic-ish via template)
# ------------------------------------------------------------------------------

# Distinct int32 types don't support generic converters easily,
# so each module defines its own inline constructors.
# This template helps:
template makeHandleType*(Name: untyped) =
  type Name* = distinct int32
  proc \x60==\x60*(a, b: Name): bool {.inline.} = int32(a) == int32(b)
  proc \x60!=\x60*(a, b: Name): bool {.inline.} = int32(a) != int32(b)
  proc toInt32*(h: Name): int32 {.inline.} = int32(h)
  proc isValid*(h: Name): bool {.inline.} = int32(h) != -1

# ------------------------------------------------------------------------------
# StringView helpers
# ------------------------------------------------------------------------------

proc toString*(sv: StringView): string {.inline.} =
  if sv.data == nil or sv.len == 0:
    return ""
  result = newString(sv.len)
  copyMem(addr result[0], sv.data, sv.len)

proc len*(sv: StringView): int {.inline.} =
  int(sv.len)
`,
  '/bindweb/bindwebevents.nim': `
## BindWebEvents - High-level event system for BindWeb-Nim
##
## Replaces the low-level pollEvent + opcode matching with a clean callback API.
##
## Quick Start: import bindweb, bindwebtypes, bindwebevents, apis/dom, apis/input, apis/system
## Create a WebApp with newWebApp(), set callbacks like app.onClick, then call app.run().

import bindweb, bindwebtypes
import apis/dom, apis/input, apis/system, apis/websocket, apis/fetch

# ------------------------------------------------------------------------------
# WebEventKind - human-friendly event type identifiers
# ------------------------------------------------------------------------------

type
  WebEventKind* = enum
    ## All event types across all BindWeb namespaces.
    wekClick, wekInput, wekChange
    wekKeyDown, wekKeyUp
    wekMouseDown, wekMouseUp, wekMouseMove, wekMouseWheel
    wekResize
    wekPopstate, wekVisibilityChange
    wekMessage, wekOpen, wekClose, wekWSError
    wekFetchSuccess, wekFetchError
    wekUnknown

# ------------------------------------------------------------------------------
# Event kind detection from raw PollEvent
# ------------------------------------------------------------------------------

proc eventKind*(ev: PollEvent): WebEventKind {.inline.} =
  ## Determine the event kind from a raw PollEvent.
  ## Replaces manual opcode comparison like ev.opcode == 0x01'u8.
  case ev.opcode
  of dom.CLICK_EVENT_OPCODE: wekClick
  of dom.INPUT_EVENT_OPCODE: wekInput
  of dom.CHANGE_EVENT_OPCODE: wekChange
  of input.KEY_DOWN_EVENT_OPCODE: wekKeyDown
  of input.KEY_UP_EVENT_OPCODE: wekKeyUp
  of input.MOUSE_DOWN_EVENT_OPCODE: wekMouseDown
  of input.MOUSE_UP_EVENT_OPCODE: wekMouseUp
  of input.MOUSE_MOVE_EVENT_OPCODE: wekMouseMove
  of input.MOUSE_WHEEL_EVENT_OPCODE: wekMouseWheel
  of input.RESIZE_EVENT_OPCODE: wekResize
  of system.POPSTATE_EVENT_OPCODE: wekPopstate
  of system.VISIBILITY_CHANGE_EVENT_OPCODE: wekVisibilityChange
  of websocket.MESSAGE_EVENT_OPCODE: wekMessage
  of websocket.OPEN_EVENT_OPCODE: wekOpen
  of websocket.CLOSE_EVENT_OPCODE: wekClose
  of websocket.ERROR_EVENT_OPCODE: wekWSError
  of fetch.SUCCESS_EVENT_OPCODE: wekFetchSuccess
  of fetch.ERROR_EVENT_OPCODE: wekFetchError
  else: wekUnknown

# ------------------------------------------------------------------------------
# Boolean helpers - check event type without comparing opcodes
# ------------------------------------------------------------------------------

proc isClick*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekClick
proc isInput*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekInput
proc isChange*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekChange
proc isKeyDown*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekKeyDown
proc isKeyUp*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekKeyUp
proc isMouseDown*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekMouseDown
proc isMouseUp*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekMouseUp
proc isMouseMove*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekMouseMove
proc isMouseWheel*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekMouseWheel
proc isResize*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekResize
proc isPopstate*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekPopstate
proc isVisibilityChange*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekVisibilityChange
proc isMessage*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekMessage
proc isOpen*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekOpen
proc isClose*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekClose
proc isWSError*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekWSError
proc isFetchSuccess*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekFetchSuccess
proc isFetchError*(ev: PollEvent): bool {.inline.} = eventKind(ev) == wekFetchError

# ------------------------------------------------------------------------------
# Typed handler type aliases
# ------------------------------------------------------------------------------

type
  ClickHandler* = proc(ev: dom.ClickEvent)
  InputHandler* = proc(ev: dom.InputEvent)
  ChangeHandler* = proc(ev: dom.ChangeEvent)
  KeyDownHandler* = proc(ev: input.KeyDownEvent)
  KeyUpHandler* = proc(ev: input.KeyUpEvent)
  MouseDownHandler* = proc(ev: input.MouseDownEvent)
  MouseUpHandler* = proc(ev: input.MouseUpEvent)
  MouseMoveHandler* = proc(ev: input.MouseMoveEvent)
  MouseWheelHandler* = proc(ev: input.MouseWheelEvent)
  ResizeHandler* = proc(ev: input.ResizeEvent)
  PopstateHandler* = proc(ev: system.PopstateEvent)
  VisibilityChangeHandler* = proc(ev: system.VisibilityChangeEvent)
  MessageHandler* = proc(ev: websocket.MessageEvent)
  OpenHandler* = proc(ev: websocket.OpenEvent)
  CloseHandler* = proc(ev: websocket.CloseEvent)
  WSErrorHandler* = proc(ev: websocket.ErrorEvent)
  FetchSuccessHandler* = proc(ev: fetch.SuccessEvent)
  FetchErrorHandler* = proc(ev: fetch.ErrorEvent)

# ------------------------------------------------------------------------------
# WebApp - the main event manager
# ------------------------------------------------------------------------------

type
  WebApp* = ref object
    ## High-level event manager.
    ## Register callbacks for event types you care about, then call run().
    onClick*: ClickHandler
    onInput*: InputHandler
    onChange*: ChangeHandler
    onKeyDown*: KeyDownHandler
    onKeyUp*: KeyUpHandler
    onMouseDown*: MouseDownHandler
    onMouseUp*: MouseUpHandler
    onMouseMove*: MouseMoveHandler
    onMouseWheel*: MouseWheelHandler
    onResize*: ResizeHandler
    onPopstate*: PopstateHandler
    onVisibilityChange*: VisibilityChangeHandler
    onMessage*: MessageHandler
    onOpen*: OpenHandler
    onClose*: CloseHandler
    onWSError*: WSErrorHandler
    onFetchSuccess*: FetchSuccessHandler
    onFetchError*: FetchErrorHandler
    frameCallback*: proc(timeMs: float64)
      ## Called every frame after all events are processed.
      ## Put your draw code here.

proc newWebApp*(): WebApp =
  ## Create a new WebApp event manager.
  WebApp()

# ------------------------------------------------------------------------------
# Closure call helper
# ------------------------------------------------------------------------------
#
# Handlers are closures. We call them directly and let the compiler emit the
# closure dispatch; it knows the exact ABI (env passed as the hidden last arg)
# the WASM call_indirect requires. Hand-rolling this with rawProc/rawEnv + cast
# corrupted captures on the WASM backend, so it was removed.

template callIfSet1[T, Arg](handler: T, arg: Arg) =
  ## Call a single-argument handler if it is set. Call the closure directly and
  ## let the Nim compiler emit the closure dispatch (it passes the environment as
  ## the hidden last argument with the exact types the WASM call_indirect expects).
  ##
  ## This previously hand-rolled the call via rawProc/rawEnv + cast. That worked on
  ## the C backend but was subtly wrong on the WASM backend: with several captured
  ## variables one would read correctly while another came back corrupted (e.g. the
  ## click handler's counter incremented but its captured element handle resolved to
  ## the wrong node, wiping the page), because the reconstructed call_indirect
  ## signature didn't exactly match Nim's closure ABI. All handlers are real
  ## capturing closures, so a direct call is correct and lets the compiler get the
  ## ABI right.
  if handler != nil:
    handler(arg)

# ------------------------------------------------------------------------------
# Dispatch - internal event routing
# ------------------------------------------------------------------------------

proc dispatch*(app: WebApp; ev: PollEvent) =
  ## Dispatch a single event to the appropriate handler.
  ## Called automatically by the event loop.
  case eventKind(ev)
  of wekClick:
    callIfSet1(app.onClick, dom.parseClickEvent(ev.data, ev.len))
  of wekInput:
    callIfSet1(app.onInput, dom.parseInputEvent(ev.data, ev.len))
  of wekChange:
    callIfSet1(app.onChange, dom.parseChangeEvent(ev.data, ev.len))
  of wekKeyDown:
    callIfSet1(app.onKeyDown, input.parseKeyDownEvent(ev.data, ev.len))
  of wekKeyUp:
    callIfSet1(app.onKeyUp, input.parseKeyUpEvent(ev.data, ev.len))
  of wekMouseDown:
    callIfSet1(app.onMouseDown, input.parseMouseDownEvent(ev.data, ev.len))
  of wekMouseUp:
    callIfSet1(app.onMouseUp, input.parseMouseUpEvent(ev.data, ev.len))
  of wekMouseMove:
    callIfSet1(app.onMouseMove, input.parseMouseMoveEvent(ev.data, ev.len))
  of wekMouseWheel:
    callIfSet1(app.onMouseWheel, input.parseMouseWheelEvent(ev.data, ev.len))
  of wekResize:
    callIfSet1(app.onResize, input.parseResizeEvent(ev.data, ev.len))
  of wekPopstate:
    callIfSet1(app.onPopstate, system.parsePopstateEvent(ev.data, ev.len))
  of wekVisibilityChange:
    callIfSet1(app.onVisibilityChange, system.parseVisibilityChangeEvent(ev.data, ev.len))
  of wekMessage:
    callIfSet1(app.onMessage, websocket.parseMessageEvent(ev.data, ev.len))
  of wekOpen:
    callIfSet1(app.onOpen, websocket.parseOpenEvent(ev.data, ev.len))
  of wekClose:
    callIfSet1(app.onClose, websocket.parseCloseEvent(ev.data, ev.len))
  of wekWSError:
    callIfSet1(app.onWSError, websocket.parseErrorEvent(ev.data, ev.len))
  of wekFetchSuccess:
    callIfSet1(app.onFetchSuccess, fetch.parseSuccessEvent(ev.data, ev.len))
  of wekFetchError:
    callIfSet1(app.onFetchError, fetch.parseErrorEvent(ev.data, ev.len))
  of wekUnknown:
    discard

# ------------------------------------------------------------------------------
# Update + Run - the main loop
# ------------------------------------------------------------------------------

proc update*(app: WebApp; timeMs: float64) =
  ## Internal update. Polls all events and dispatches them, then calls frameCallback.
  var ev: PollEvent
  while pollEvent(ev):
    app.dispatch(ev)
  if app.frameCallback != nil:
    app.frameCallback(timeMs)

# The active app for the main loop. setMainLoop requires a plain (non-closure)
# proc whose address can be placed in the WASM function table; a closure that
# captured app can't be cast to a raw pointer. We stash the app here and use
# a top-level trampoline as the callback instead.
var gActiveApp {.global.}: WebApp

proc bindwebMainLoopTrampoline(timeMs: float64) {.exportc.} =
  ## Top-level main-loop callback. Forwards to the active WebApp.
  if gActiveApp != nil:
    gActiveApp.update(timeMs)

proc run*(app: WebApp) =
  ## Start the main loop. Events are automatically polled and dispatched.
  ## This replaces the manual setMainLoop + pollEvent boilerplate.
  gActiveApp = app
  GC_ref(app)  # keep alive after main() returns — ARC doesn't see gActiveApp as a root
  setMainLoop(cast[pointer](bindwebMainLoopTrampoline))
  flush()

# ------------------------------------------------------------------------------
# webloop template - simplest possible API
# ------------------------------------------------------------------------------

template webloop*(app: WebApp; body: untyped) =
  ## Convenience template: set frameCallback and start the loop in one call.
  ## Usage: let app = newWebApp(); app.onClick = proc(ev) = echo "click"; app.webloop: drawEverything(); flush()
  app.frameCallback = proc(timeMs: float64) = body
  app.run()

# ------------------------------------------------------------------------------
# eventName - human-readable event name for debugging
# ------------------------------------------------------------------------------

proc eventName*(kind: WebEventKind): string {.inline.} =
  ## Get a human-readable name for an event kind.
  case kind
  of wekClick: "Click"
  of wekInput: "Input"
  of wekChange: "Change"
  of wekKeyDown: "KeyDown"
  of wekKeyUp: "KeyUp"
  of wekMouseDown: "MouseDown"
  of wekMouseUp: "MouseUp"
  of wekMouseMove: "MouseMove"
  of wekMouseWheel: "MouseWheel"
  of wekResize: "Resize"
  of wekPopstate: "Popstate"
  of wekVisibilityChange: "VisibilityChange"
  of wekMessage: "Message"
  of wekOpen: "Open"
  of wekClose: "Close"
  of wekWSError: "WSError"
  of wekFetchSuccess: "FetchSuccess"
  of wekFetchError: "FetchError"
  of wekUnknown: "Unknown"

proc eventName*(ev: PollEvent): string {.inline.} = eventName(eventKind(ev))
`,
  '/bindweb/bindweb_runtime.c': `
/* ============================================================================
 * Nim Bindweb Core Runtime - C Implementation
 * ============================================================================
 * Single-file C implementation of the Nim Bindweb WASM runtime.
 *
 * Subsystems:
 *   1. Command Buffer   - 1MB buffer for C-to-JS command encoding
 *   2. Event Buffer     - 1MB buffer for JS-to-C event delivery
 *   3. Scratch Buffer   - 4KB buffer for temporary JS-to-C data
 *   4. Flush            - Command buffer flush to JS via imported function
 *   5. Allocator        - Free-list allocator with bump allocation fallback
 *   6. Libc Stubs       - Minimal libc for -nostdlib builds
 *
 * All exported functions use __attribute__((used, visibility("default"))) so
 * they are preserved by the linker and visible to JavaScript.
 * ============================================================================ */

#include "bindweb_runtime.h"

/* ============================================================================
 * SECTION 1: Command Buffer
 * ============================================================================
 * A single static 1MB buffer used to accumulate commands sent from C to JS.
 * All integer values are written little-endian.  The buffer is reset after
 * each flush.
 *
 * Wire format:
 *   - uint32 / int32: 4 bytes little-endian
 *   - float32:        4 bytes (memcpy to uint32, then little-endian)
 *   - float64:        align to 8, then 8 bytes (2x little-endian uint32)
 *   - string:         4-byte len + string data + padding to 4-byte alignment
 * ============================================================================ */

/** g_cmd_buffer: static 1MB buffer, aligned to 8 bytes for double writes. */
static __attribute__((aligned(8))) uint8_t g_cmd_buffer[BINDWEB_COMMAND_BUFFER_SIZE];

/** g_cmd_offset: current write position in the command buffer. */
static size_t g_cmd_offset = 0;

/* ------------------------------------------------------------------------ */

__attribute__((used, visibility("default")))
void bindweb_push_u32(uint32_t v) {
    if (g_cmd_offset + 4 <= BINDWEB_COMMAND_BUFFER_SIZE) {
        g_cmd_buffer[g_cmd_offset++] = v & 0xFF;
        g_cmd_buffer[g_cmd_offset++] = (v >> 8) & 0xFF;
        g_cmd_buffer[g_cmd_offset++] = (v >> 16) & 0xFF;
        g_cmd_buffer[g_cmd_offset++] = (v >> 24) & 0xFF;
    }
}

__attribute__((used, visibility("default")))
void bindweb_push_i32(int32_t v) {
    bindweb_push_u32((uint32_t)v);
}

__attribute__((used, visibility("default")))
void bindweb_push_float(float v) {
    uint32_t u;
    memcpy(&u, &v, 4);
    bindweb_push_u32(u);
}

__attribute__((used, visibility("default")))
void bindweb_push_double(double v) {
    /* Align to 8 bytes before writing the 64-bit value. */
    if (g_cmd_offset % 8 != 0) {
        size_t pad = 8 - (g_cmd_offset % 8);
        for (size_t k = 0; k < pad; ++k) {
            if (g_cmd_offset < BINDWEB_COMMAND_BUFFER_SIZE)
                g_cmd_buffer[g_cmd_offset++] = 0;
        }
    }

    uint64_t u;
    memcpy(&u, &v, 8);

    /* Push as two 32-bit values (little-endian). */
    bindweb_push_u32((uint32_t)(u & 0xFFFFFFFF));
    bindweb_push_u32((uint32_t)(u >> 32));
}

__attribute__((used, visibility("default")))
void bindweb_push_string(const char* str, size_t len) {
    bindweb_push_u32((uint32_t)len);

    if (str && g_cmd_offset + len <= BINDWEB_COMMAND_BUFFER_SIZE) {
        for (size_t k = 0; k < len; ++k)
            g_cmd_buffer[g_cmd_offset++] = str[k];
    }

    /* Pad to 4-byte alignment. */
    size_t pad = (4 - (len % 4)) % 4;
    for (size_t k = 0; k < pad; ++k) {
        if (g_cmd_offset < BINDWEB_COMMAND_BUFFER_SIZE)
            g_cmd_buffer[g_cmd_offset++] = 0;
    }
}

__attribute__((used, visibility("default")))
const uint8_t* bindweb_command_buffer_data(void) {
    return g_cmd_buffer;
}

__attribute__((used, visibility("default")))
size_t bindweb_command_buffer_size(void) {
    return g_cmd_offset;
}

__attribute__((used, visibility("default")))
void bindweb_command_buffer_reset(void) {
    g_cmd_offset = 0;
}

/* ============================================================================
 * SECTION 2: Event Buffer
 * ============================================================================
 * A single static 1MB buffer written by JavaScript and read by C.
 *
 * JS writes events in the following format:
 *   [Opcode:1][Pad:1][TotalSize:2][Data...]
 *
 *   - Opcode:    1 byte event type identifier
 *   - Pad:       1 byte padding (ignored)
 *   - TotalSize: 2 bytes little-endian, total size of the event in bytes
 *   - Data:      payload bytes (TotalSize - 4 bytes)
 *
 * The C side reads events sequentially via bindweb_next_event().  After all
 * events have been consumed the buffer is reset.
 * ============================================================================ */

/** g_event_buffer: static 1MB buffer, aligned to 8 bytes. */
static __attribute__((aligned(8))) uint8_t g_event_buffer[BINDWEB_EVENT_BUFFER_SIZE];

/** g_event_offset: number of valid bytes written by JS. */
static uint32_t g_event_offset = 0;

/** g_event_read_offset: current read position used by next_event(). */
static uint32_t g_event_read_offset = 0;

/* ------------------------------------------------------------------------ */

__attribute__((used, visibility("default")))
uint8_t* bindweb_event_buffer_ptr(void) {
    return g_event_buffer;
}

__attribute__((used, visibility("default")))
uint32_t* bindweb_event_offset_ptr(void) {
    return &g_event_offset;
}

__attribute__((used, visibility("default")))
uint32_t bindweb_event_buffer_capacity(void) {
    return BINDWEB_EVENT_BUFFER_SIZE;
}

__attribute__((used, visibility("default")))
void bindweb_reset_event_buffer(void) {
    g_event_offset = 0;
    g_event_read_offset = 0;
}

__attribute__((used, visibility("default")))
const uint8_t* bindweb_event_buffer_data(void) {
    return g_event_buffer;
}

__attribute__((used, visibility("default")))
uint32_t bindweb_event_buffer_size(void) {
    return g_event_offset;
}

__attribute__((used, visibility("default")))
bool bindweb_next_event(uint8_t* opcode, const uint8_t** data_ptr, uint32_t* data_len) {
    uint32_t size = g_event_offset;

    /* All events consumed?  Reset and return false. */
    if (g_event_read_offset >= size) {
        bindweb_reset_event_buffer();
        return false;
    }

    /* Need at least 4 bytes for the header. */
    if (g_event_read_offset + 4 > size) {
        bindweb_reset_event_buffer();
        return false;
    }

    /* Parse header: [Opcode:1][Pad:1][TotalSize:2] */
    *opcode = g_event_buffer[g_event_read_offset];

    uint16_t total_event_size =
        (uint16_t)g_event_buffer[g_event_read_offset + 2] |
        ((uint16_t)g_event_buffer[g_event_read_offset + 3] << 8);

    /* Sanity check: total size must not exceed buffer. */
    if (g_event_read_offset + total_event_size > size) {
        bindweb_reset_event_buffer();
        return false;
    }

    /* Data starts after the 4-byte header. */
    *data_ptr = g_event_buffer + g_event_read_offset + 4;
    *data_len = (uint32_t)total_event_size - 4;

    g_event_read_offset += total_event_size;
    return true;
}

/* ============================================================================
 * SECTION 3: Scratch Buffer
 * ============================================================================
 * A small (4KB) static buffer used for temporary JS-to-C data transfers.
 *
 * Use case: When C calls a JS function that returns a string (e.g.
 * get_attribute), JS cannot return the string directly because WASM only
 * supports numeric return values.  Instead:
 *   1. JS writes the string data into this scratch buffer.
 *   2. JS returns the length of the string.
 *   3. C immediately reads the data from the scratch buffer and copies it.
 *
 * This avoids dynamic memory allocation for transient return values.
 * WARNING: Data is ephemeral — valid only until the next JS call that uses
 * the scratch buffer.
 * ============================================================================ */

/** g_scratch_buffer: static 4KB buffer, aligned to 8 bytes. */
static __attribute__((aligned(8))) uint8_t g_scratch_buffer[BINDWEB_SCRATCH_BUFFER_SIZE];

/* ------------------------------------------------------------------------ */

__attribute__((used, visibility("default")))
uint8_t* bindweb_scratch_buffer_ptr(void) {
    return g_scratch_buffer;
}

__attribute__((used, visibility("default")))
uint32_t bindweb_scratch_buffer_capacity(void) {
    return BINDWEB_SCRATCH_BUFFER_SIZE;
}

__attribute__((used, visibility("default")))
const uint8_t* bindweb_scratch_buffer_data(void) {
    return g_scratch_buffer;
}

/* ============================================================================
 * SECTION 4: Flush
 * ============================================================================
 * Sends the accumulated command buffer to JavaScript and then resets it.
 * If the buffer is empty, nothing is sent.
 * ============================================================================ */

__attribute__((used, visibility("default")))
void bindweb_flush(void) {
    size_t s = bindweb_command_buffer_size();
    if (s == 0)
        return;
    bindweb_js_flush((uintptr_t)bindweb_command_buffer_data(), s);
    bindweb_command_buffer_reset();
}

/* ============================================================================
 * SECTION 5: Allocator
 * ============================================================================
 * A simple free-list allocator with bump-allocation fallback.
 *
 *   - Uses __heap_base (provided by the WASM linker) as the start of heap.
 *   - All allocations are 8-byte aligned.
 *   - Free blocks are kept in a singly-linked LIFO list.
 *   - When the free list cannot satisfy a request, memory is bumped from the
 *     heap.  If the heap exceeds current WASM memory, the memory is grown.
 *
 * This allocator ONLY serves the runtime.  Nim's GC handles its own memory.
 * ============================================================================ */

/** BlockHeader: metadata stored before each allocated block. */
typedef struct BlockHeader {
    size_t            size;   /**< User-visible size (without header). */
    struct BlockHeader* next; /**< Next block in the free list.        */
} BlockHeader;

/** __heap_base: linker-provided symbol marking the start of free RAM. */
extern uint8_t __heap_base;

/** g_heap_ptr: current bump pointer.  Initialised to &__heap_base. */
static uintptr_t g_heap_ptr = 0;

/** g_free_list: head of the free block list (LIFO). */
static BlockHeader* g_free_list = NULL;

/** g_allocator_ready: set to 1 once g_heap_ptr has been initialised. */
static int g_allocator_ready = 0;

/** Ensure the heap pointer has been initialised from __heap_base. */
static inline void allocator_ensure_init(void) {
    if (!g_allocator_ready) {
        g_heap_ptr = (uintptr_t)&__heap_base;
        g_allocator_ready = 1;
    }
}

/* ------------------------------------------------------------------------ */

__attribute__((used, visibility("default")))
void* bindweb_malloc(size_t size) {
    if (size == 0)
        return NULL;

    allocator_ensure_init();

    /* Align requested size to 8 bytes. */
    size = (size + 7) & ~(size_t)7;

    /* Total size including the BlockHeader. */
    size_t total_size = size + sizeof(BlockHeader);

    /* 1. Search the free list for a block large enough. */
    BlockHeader* prev = NULL;
    BlockHeader* curr = g_free_list;

    while (curr) {
        if (curr->size >= size) {
            /* Unlink from free list. */
            if (prev)
                prev->next = curr->next;
            else
                g_free_list = curr->next;

            /* Return pointer to the user-data area (past the header). */
            return (void*)((uint8_t*)curr + sizeof(BlockHeader));
        }
        prev = curr;
        curr = curr->next;
    }

    /* 2. No suitable free block — bump allocate from the heap. */
    uintptr_t current = g_heap_ptr;
    g_heap_ptr += total_size;

    /* Check whether we have exceeded current WASM memory. */
    size_t current_pages = __builtin_wasm_memory_size(0);
    uintptr_t max_mem = current_pages * 64 * 1024;

    if (g_heap_ptr > max_mem) {
        size_t bytes_needed = g_heap_ptr - max_mem;
        size_t pages_to_add = (bytes_needed + 65535) / 65536;

        if (__builtin_wasm_memory_grow(0, pages_to_add) == (size_t)-1) {
            /* Grow failed — roll back and return NULL. */
            g_heap_ptr = current;
            return NULL;
        }
    }

    BlockHeader* header = (BlockHeader*)current;
    header->size = size;
    header->next = NULL;

    return (void*)((uint8_t*)header + sizeof(BlockHeader));
}

__attribute__((used, visibility("default")))
void bindweb_free(void* ptr) {
    if (!ptr)
        return;

    /* Walk back to the BlockHeader. */
    BlockHeader* header = (BlockHeader*)((uint8_t*)ptr - sizeof(BlockHeader));

    /* Push onto the front of the free list (LIFO). */
    header->next = g_free_list;
    g_free_list = header;
}

/* ============================================================================
 * SECTION 6: Libc Stubs
 * ============================================================================
 * Minimal implementations of standard C library functions.
 *
 * Since we compile with -nostdlib, these symbols are not available by default.
 * Compilers may implicitly generate calls to them (e.g. for struct copying or
 * initialisation).  Providing them here makes the WASM module self-contained
 * and avoids link errors.
 * ============================================================================ */

__attribute__((used, visibility("default")))
size_t strlen(const char* s) {
    const char* p = s;
    while (*p)
        ++p;
    return (size_t)(p - s);
}

__attribute__((used, visibility("default")))
void* memcpy(void* dest, const void* src, size_t n) {
    uint8_t*       d = (uint8_t*)dest;
    const uint8_t* s = (const uint8_t*)src;
    while (n--)
        *d++ = *s++;
    return dest;
}

__attribute__((used, visibility("default")))
void* memset(void* dest, int c, size_t n) {
    uint8_t* d = (uint8_t*)dest;
    while (n--)
        *d++ = (uint8_t)c;
    return dest;
}

__attribute__((used, visibility("default")))
void* memmove(void* dest, const void* src, size_t n) {
    uint8_t*       d = (uint8_t*)dest;
    const uint8_t* s = (const uint8_t*)src;

    if (d < s) {
        /* Non-overlapping or forward copy. */
        while (n--)
            *d++ = *s++;
    } else {
        /* Overlapping — copy backwards. */
        d += n;
        s += n;
        while (n--)
            *--d = *--s;
    }
    return dest;
}
`,
  '/bindweb/bindweb_runtime.h': `
/* ============================================================================
 * Nim Bindweb Core Runtime - C Header
 * ============================================================================
 * This is the C port of the Nim Bindweb core runtime. It manages the command buffer,
 * event buffer, scratch buffer, memory allocator, and minimal libc stubs.
 *
 * Compiled to WebAssembly with -nostdlib. All exported functions use the
 * bindweb_ prefix and are marked with visibility attributes for WASM linking.
 * ============================================================================ */

#ifndef BINDWEB_RUNTIME_H
#define BINDWEB_RUNTIME_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ----------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------------- */

#ifndef BINDWEB_COMMAND_BUFFER_SIZE
#define BINDWEB_COMMAND_BUFFER_SIZE (1024 * 1024)
#endif
#ifndef BINDWEB_EVENT_BUFFER_SIZE
#define BINDWEB_EVENT_BUFFER_SIZE   (1024 * 1024)
#endif
#ifndef BINDWEB_SCRATCH_BUFFER_SIZE
#define BINDWEB_SCRATCH_BUFFER_SIZE 4096
#endif

/* ----------------------------------------------------------------------------
 * JS Import
 * ---------------------------------------------------------------------------- */

__attribute__((import_module("env"), import_name("bindweb_js_flush")))
extern void bindweb_js_flush(uintptr_t ptr, size_t size);

/* ----------------------------------------------------------------------------
 * Command Buffer
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
void bindweb_push_u32(uint32_t v);

__attribute__((used, visibility("default")))
void bindweb_push_i32(int32_t v);

__attribute__((used, visibility("default")))
void bindweb_push_float(float v);

__attribute__((used, visibility("default")))
void bindweb_push_double(double v);

__attribute__((used, visibility("default")))
void bindweb_push_string(const char* str, size_t len);

__attribute__((used, visibility("default")))
const uint8_t* bindweb_command_buffer_data(void);

__attribute__((used, visibility("default")))
size_t bindweb_command_buffer_size(void);

__attribute__((used, visibility("default")))
void bindweb_command_buffer_reset(void);

/* ----------------------------------------------------------------------------
 * Event Buffer
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
uint8_t* bindweb_event_buffer_ptr(void);

__attribute__((used, visibility("default")))
uint32_t* bindweb_event_offset_ptr(void);

__attribute__((used, visibility("default")))
uint32_t bindweb_event_buffer_capacity(void);

__attribute__((used, visibility("default")))
void bindweb_reset_event_buffer(void);

__attribute__((used, visibility("default")))
const uint8_t* bindweb_event_buffer_data(void);

__attribute__((used, visibility("default")))
uint32_t bindweb_event_buffer_size(void);

__attribute__((used, visibility("default")))
bool bindweb_next_event(uint8_t* opcode, const uint8_t** data_ptr, uint32_t* data_len);

/* ----------------------------------------------------------------------------
 * Scratch Buffer
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
uint8_t* bindweb_scratch_buffer_ptr(void);

__attribute__((used, visibility("default")))
uint32_t bindweb_scratch_buffer_capacity(void);

__attribute__((used, visibility("default")))
const uint8_t* bindweb_scratch_buffer_data(void);

/* ----------------------------------------------------------------------------
 * Flush
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
void bindweb_flush(void);

/* ----------------------------------------------------------------------------
 * Allocator
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
void* bindweb_malloc(size_t size);

__attribute__((used, visibility("default")))
void bindweb_free(void* ptr);

/* ----------------------------------------------------------------------------
 * Libc Stubs (provided because we compile with -nostdlib)
 * ---------------------------------------------------------------------------- */

__attribute__((used, visibility("default")))
size_t strlen(const char* s);

__attribute__((used, visibility("default")))
void* memcpy(void* dest, const void* src, size_t n);

__attribute__((used, visibility("default")))
void* memset(void* dest, int c, size_t n);

__attribute__((used, visibility("default")))
void* memmove(void* dest, const void* src, size_t n);

#ifdef __cplusplus
}
#endif

#endif /* BINDWEB_RUNTIME_H */
`,
  '/bindweb/apis/audio.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## AUDIO namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc play*(handle: AudioHandle) =
  ## audio.PLAY (opcode 0x6B)
  pushCommand(0x6Bu32)
  pushData(handle.int32)

proc pause*(handle: AudioHandle) =
  ## audio.PAUSE (opcode 0x6C)
  pushCommand(0x6Cu32)
  pushData(handle.int32)

proc set_volume*(handle: AudioHandle, vol: float64) =
  ## audio.SET_VOLUME (opcode 0x6D)
  pushCommand(0x6Du32)
  pushData(handle.int32)
  pushData(vol.float64)

proc set_loop*(handle: AudioHandle, loop: uint8) =
  ## audio.SET_LOOP (opcode 0x6E)
  pushCommand(0x6Eu32)
  pushData(handle.int32)
  pushData(loop.uint32)

# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_audio_create_audio(src: cstring; srcLen: uint32): int32 {.importc.}
proc bindweb_audio_get_current_time(handle: int32): float64 {.importc.}
proc bindweb_audio_get_duration(handle: int32): float64 {.importc.}

proc create_audio*(src: string): AudioHandle =
  ## audio.CREATE_AUDIO
  flush()
  return AudioHandle(bindweb_audio_create_audio(src.cstring, src.len.uint32))

proc get_current_time*(handle: AudioHandle): float64 =
  ## audio.GET_CURRENT_TIME
  flush()
  return bindweb_audio_get_current_time(int32(handle))

proc get_duration*(handle: AudioHandle): float64 =
  ## audio.GET_DURATION
  flush()
  return bindweb_audio_get_duration(int32(handle))

`,
  '/bindweb/apis/canvas.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## CANVAS namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc set_size*(handle: CanvasHandle, width: float64, height: float64) =
  ## canvas.SET_SIZE (opcode 0x22)
  pushCommand(0x22u32)
  pushData(handle.int32)
  pushData(width.float64)
  pushData(height.float64)

proc set_fill_style*(handle: CanvasContext2DHandle, r: uint8, g: uint8, b: uint8) =
  ## canvas.SET_FILL_STYLE (opcode 0x23)
  pushCommand(0x23u32)
  pushData(handle.int32)
  pushData(r.uint32)
  pushData(g.uint32)
  pushData(b.uint32)

proc set_fill_style_str*(handle: CanvasContext2DHandle, color: string) =
  ## canvas.SET_FILL_STYLE_STR (opcode 0x24)
  pushCommand(0x24u32)
  pushData(handle.int32)
  pushString(color)

proc fill_rect*(handle: CanvasContext2DHandle, x: float64, y: float64, w: float64, h: float64) =
  ## canvas.FILL_RECT (opcode 0x25)
  pushCommand(0x25u32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)
  pushData(w.float64)
  pushData(h.float64)

proc clear_rect*(handle: CanvasContext2DHandle, x: float64, y: float64, w: float64, h: float64) =
  ## canvas.CLEAR_RECT (opcode 0x26)
  pushCommand(0x26u32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)
  pushData(w.float64)
  pushData(h.float64)

proc stroke_rect*(handle: CanvasContext2DHandle, x: float64, y: float64, w: float64, h: float64) =
  ## canvas.STROKE_RECT (opcode 0x27)
  pushCommand(0x27u32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)
  pushData(w.float64)
  pushData(h.float64)

proc set_stroke_style*(handle: CanvasContext2DHandle, r: uint8, g: uint8, b: uint8) =
  ## canvas.SET_STROKE_STYLE (opcode 0x28)
  pushCommand(0x28u32)
  pushData(handle.int32)
  pushData(r.uint32)
  pushData(g.uint32)
  pushData(b.uint32)

proc set_stroke_style_str*(handle: CanvasContext2DHandle, color: string) =
  ## canvas.SET_STROKE_STYLE_STR (opcode 0x29)
  pushCommand(0x29u32)
  pushData(handle.int32)
  pushString(color)

proc set_line_width*(handle: CanvasContext2DHandle, width: float64) =
  ## canvas.SET_LINE_WIDTH (opcode 0x2A)
  pushCommand(0x2Au32)
  pushData(handle.int32)
  pushData(width.float64)

proc begin_path*(handle: CanvasContext2DHandle) =
  ## canvas.BEGIN_PATH (opcode 0x2B)
  pushCommand(0x2Bu32)
  pushData(handle.int32)

proc close_path*(handle: CanvasContext2DHandle) =
  ## canvas.CLOSE_PATH (opcode 0x2C)
  pushCommand(0x2Cu32)
  pushData(handle.int32)

proc move_to*(handle: CanvasContext2DHandle, x: float64, y: float64) =
  ## canvas.MOVE_TO (opcode 0x2D)
  pushCommand(0x2Du32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)

proc line_to*(handle: CanvasContext2DHandle, x: float64, y: float64) =
  ## canvas.LINE_TO (opcode 0x2E)
  pushCommand(0x2Eu32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)

proc stroke*(handle: CanvasContext2DHandle) =
  ## canvas.STROKE (opcode 0x2F)
  pushCommand(0x2Fu32)
  pushData(handle.int32)

proc fill*(handle: CanvasContext2DHandle) =
  ## canvas.FILL (opcode 0x30)
  pushCommand(0x30u32)
  pushData(handle.int32)

proc arc*(handle: CanvasContext2DHandle, x: float64, y: float64, radius: float64, start_angle: float64, end_angle: float64) =
  ## canvas.ARC (opcode 0x31)
  pushCommand(0x31u32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)
  pushData(radius.float64)
  pushData(start_angle.float64)
  pushData(end_angle.float64)

proc fill_text*(handle: CanvasContext2DHandle, text: string, x: float64, y: float64) =
  ## canvas.FILL_TEXT (opcode 0x32)
  pushCommand(0x32u32)
  pushData(handle.int32)
  pushString(text)
  pushData(x.float64)
  pushData(y.float64)

proc fill_text_f*(handle: CanvasContext2DHandle, fmt: string, val: float64, x: float64, y: float64) =
  ## canvas.FILL_TEXT_F (opcode 0x33)
  pushCommand(0x33u32)
  pushData(handle.int32)
  pushString(fmt)
  pushData(val.float64)
  pushData(x.float64)
  pushData(y.float64)

proc fill_text_i*(handle: CanvasContext2DHandle, fmt: string, val: int32, x: float64, y: float64) =
  ## canvas.FILL_TEXT_I (opcode 0x34)
  pushCommand(0x34u32)
  pushData(handle.int32)
  pushString(fmt)
  pushData(val.int32)
  pushData(x.float64)
  pushData(y.float64)

proc set_font*(handle: CanvasContext2DHandle, font: string) =
  ## canvas.SET_FONT (opcode 0x35)
  pushCommand(0x35u32)
  pushData(handle.int32)
  pushString(font)

proc set_text_align*(handle: CanvasContext2DHandle, align: string) =
  ## canvas.SET_TEXT_ALIGN (opcode 0x36)
  pushCommand(0x36u32)
  pushData(handle.int32)
  pushString(align)

proc draw_image*(handle: CanvasContext2DHandle, img_handle: ImageHandle, x: float64, y: float64) =
  ## canvas.DRAW_IMAGE (opcode 0x37)
  pushCommand(0x37u32)
  pushData(handle.int32)
  pushData(img_handle.int32)
  pushData(x.float64)
  pushData(y.float64)

proc translate*(handle: CanvasContext2DHandle, x: float64, y: float64) =
  ## canvas.TRANSLATE (opcode 0x38)
  pushCommand(0x38u32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)

proc rotate*(handle: CanvasContext2DHandle, angle: float64) =
  ## canvas.ROTATE (opcode 0x39)
  pushCommand(0x39u32)
  pushData(handle.int32)
  pushData(angle.float64)

proc scale*(handle: CanvasContext2DHandle, x: float64, y: float64) =
  ## canvas.SCALE (opcode 0x3A)
  pushCommand(0x3Au32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)

proc save*(handle: CanvasContext2DHandle) =
  ## canvas.SAVE (opcode 0x3B)
  pushCommand(0x3Bu32)
  pushData(handle.int32)

proc restore*(handle: CanvasContext2DHandle) =
  ## canvas.RESTORE (opcode 0x3C)
  pushCommand(0x3Cu32)
  pushData(handle.int32)

proc log_canvas_info*(handle: CanvasHandle) =
  ## canvas.LOG_CANVAS_INFO (opcode 0x3D)
  pushCommand(0x3Du32)
  pushData(handle.int32)

proc set_global_alpha*(handle: CanvasContext2DHandle, alpha: float64) =
  ## canvas.SET_GLOBAL_ALPHA (opcode 0x3E)
  pushCommand(0x3Eu32)
  pushData(handle.int32)
  pushData(alpha.float64)

proc set_line_cap*(handle: CanvasContext2DHandle, cap: string) =
  ## canvas.SET_LINE_CAP (opcode 0x3F)
  pushCommand(0x3Fu32)
  pushData(handle.int32)
  pushString(cap)

proc set_line_join*(handle: CanvasContext2DHandle, join: string) =
  ## canvas.SET_LINE_JOIN (opcode 0x40)
  pushCommand(0x40u32)
  pushData(handle.int32)
  pushString(join)

proc set_shadow*(handle: CanvasContext2DHandle, blur: float64, off_x: float64, off_y: float64, color: string) =
  ## canvas.SET_SHADOW (opcode 0x41)
  pushCommand(0x41u32)
  pushData(handle.int32)
  pushData(blur.float64)
  pushData(off_x.float64)
  pushData(off_y.float64)
  pushString(color)

proc bezier_curve_to*(handle: CanvasContext2DHandle, cp1x: float64, cp1y: float64, cp2x: float64, cp2y: float64, x: float64, y: float64) =
  ## canvas.BEZIER_CURVE_TO (opcode 0x42)
  pushCommand(0x42u32)
  pushData(handle.int32)
  pushData(cp1x.float64)
  pushData(cp1y.float64)
  pushData(cp2x.float64)
  pushData(cp2y.float64)
  pushData(x.float64)
  pushData(y.float64)

proc quadratic_curve_to*(handle: CanvasContext2DHandle, cpx: float64, cpy: float64, x: float64, y: float64) =
  ## canvas.QUADRATIC_CURVE_TO (opcode 0x43)
  pushCommand(0x43u32)
  pushData(handle.int32)
  pushData(cpx.float64)
  pushData(cpy.float64)
  pushData(x.float64)
  pushData(y.float64)

proc rect*(handle: CanvasContext2DHandle, x: float64, y: float64, w: float64, h: float64) =
  ## canvas.RECT (opcode 0x44)
  pushCommand(0x44u32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)
  pushData(w.float64)
  pushData(h.float64)

proc clip*(handle: CanvasContext2DHandle) =
  ## canvas.CLIP (opcode 0x45)
  pushCommand(0x45u32)
  pushData(handle.int32)

proc stroke_text*(handle: CanvasContext2DHandle, text: string, x: float64, y: float64) =
  ## canvas.STROKE_TEXT (opcode 0x46)
  pushCommand(0x46u32)
  pushData(handle.int32)
  pushString(text)
  pushData(x.float64)
  pushData(y.float64)

proc set_text_baseline*(handle: CanvasContext2DHandle, baseline: string) =
  ## canvas.SET_TEXT_BASELINE (opcode 0x47)
  pushCommand(0x47u32)
  pushData(handle.int32)
  pushString(baseline)

proc set_global_composite_operation*(handle: CanvasContext2DHandle, op: string) =
  ## canvas.SET_GLOBAL_COMPOSITE_OPERATION (opcode 0x48)
  pushCommand(0x48u32)
  pushData(handle.int32)
  pushString(op)

proc draw_image_scaled*(handle: CanvasContext2DHandle, img_handle: ImageHandle, x: float64, y: float64, w: float64, h: float64) =
  ## canvas.DRAW_IMAGE_SCALED (opcode 0x49)
  pushCommand(0x49u32)
  pushData(handle.int32)
  pushData(img_handle.int32)
  pushData(x.float64)
  pushData(y.float64)
  pushData(w.float64)
  pushData(h.float64)

proc draw_image_full*(handle: CanvasContext2DHandle, img_handle: ImageHandle, sx: float64, sy: float64, sw: float64, sh: float64, dx: float64, dy: float64, dw: float64, dh: float64) =
  ## canvas.DRAW_IMAGE_FULL (opcode 0x4A)
  pushCommand(0x4Au32)
  pushData(handle.int32)
  pushData(img_handle.int32)
  pushData(sx.float64)
  pushData(sy.float64)
  pushData(sw.float64)
  pushData(sh.float64)
  pushData(dx.float64)
  pushData(dy.float64)
  pushData(dw.float64)
  pushData(dh.float64)

proc reset_transform*(handle: CanvasContext2DHandle) =
  ## canvas.RESET_TRANSFORM (opcode 0x4B)
  pushCommand(0x4Bu32)
  pushData(handle.int32)

proc ellipse*(handle: CanvasContext2DHandle, x: float64, y: float64, radius_x: float64, radius_y: float64, rotation: float64, start_angle: float64, end_angle: float64, counter_clockwise: uint8) =
  ## canvas.ELLIPSE (opcode 0x4C)
  pushCommand(0x4Cu32)
  pushData(handle.int32)
  pushData(x.float64)
  pushData(y.float64)
  pushData(radius_x.float64)
  pushData(radius_y.float64)
  pushData(rotation.float64)
  pushData(start_angle.float64)
  pushData(end_angle.float64)
  pushData(counter_clockwise.uint32)

proc arc_to*(handle: CanvasContext2DHandle, x1: float64, y1: float64, x2: float64, y2: float64, radius: float64) =
  ## canvas.ARC_TO (opcode 0x4D)
  pushCommand(0x4Du32)
  pushData(handle.int32)
  pushData(x1.float64)
  pushData(y1.float64)
  pushData(x2.float64)
  pushData(y2.float64)
  pushData(radius.float64)

proc set_transform*(handle: CanvasContext2DHandle, a: float64, b: float64, c: float64, d: float64, e: float64, f: float64) =
  ## canvas.SET_TRANSFORM (opcode 0x4E)
  pushCommand(0x4Eu32)
  pushData(handle.int32)
  pushData(a.float64)
  pushData(b.float64)
  pushData(c.float64)
  pushData(d.float64)
  pushData(e.float64)
  pushData(f.float64)

proc transform*(handle: CanvasContext2DHandle, a: float64, b: float64, c: float64, d: float64, e: float64, f: float64) =
  ## canvas.TRANSFORM (opcode 0x4F)
  pushCommand(0x4Fu32)
  pushData(handle.int32)
  pushData(a.float64)
  pushData(b.float64)
  pushData(c.float64)
  pushData(d.float64)
  pushData(e.float64)
  pushData(f.float64)

proc set_miter_limit*(handle: CanvasContext2DHandle, limit: float64) =
  ## canvas.SET_MITER_LIMIT (opcode 0x50)
  pushCommand(0x50u32)
  pushData(handle.int32)
  pushData(limit.float64)

proc set_image_smoothing_enabled*(handle: CanvasContext2DHandle, enabled: uint8) =
  ## canvas.SET_IMAGE_SMOOTHING_ENABLED (opcode 0x51)
  pushCommand(0x51u32)
  pushData(handle.int32)
  pushData(enabled.uint32)

# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_canvas_create_canvas(dom_id: cstring; dom_idLen: uint32; width: float64; height: float64): int32 {.importc.}
proc bindweb_canvas_get_context_2d(canvas_handle: int32): int32 {.importc.}
proc bindweb_canvas_get_context_webgl(canvas_handle: int32): int32 {.importc.}
proc bindweb_canvas_get_context_webgpu(canvas_handle: int32): int32 {.importc.}
proc bindweb_canvas_measure_text_width(handle: int32; text: cstring; textLen: uint32): float64 {.importc.}

proc create_canvas*(dom_id: string; width: float64; height: float64): CanvasHandle =
  ## canvas.CREATE_CANVAS
  flush()
  return CanvasHandle(bindweb_canvas_create_canvas(dom_id.cstring, dom_id.len.uint32, width, height))

proc get_context_2d*(canvas_handle: CanvasHandle): CanvasContext2DHandle =
  ## canvas.GET_CONTEXT_2D
  flush()
  return CanvasContext2DHandle(bindweb_canvas_get_context_2d(int32(canvas_handle)))

proc get_context_webgl*(canvas_handle: CanvasHandle): WebGLContextHandle =
  ## canvas.GET_CONTEXT_WEBGL
  flush()
  return WebGLContextHandle(bindweb_canvas_get_context_webgl(int32(canvas_handle)))

proc get_context_webgpu*(canvas_handle: CanvasHandle): WGPUContextHandle =
  ## canvas.GET_CONTEXT_WEBGPU
  flush()
  return WGPUContextHandle(bindweb_canvas_get_context_webgpu(int32(canvas_handle)))

proc measure_text_width*(handle: CanvasContext2DHandle; text: string): float64 =
  ## canvas.MEASURE_TEXT_WIDTH
  flush()
  return bindweb_canvas_measure_text_width(int32(handle), text.cstring, text.len.uint32)

`,
  '/bindweb/apis/dom.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## DOM namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Event opcode constants
# ------------------------------------------------------------------------------

const
  CLICK_EVENT_OPCODE* = 0x01'u8
  INPUT_EVENT_OPCODE* = 0x02'u8
  CHANGE_EVENT_OPCODE* = 0x03'u8
  KEYDOWN_EVENT_OPCODE* = 0x04'u8

# ------------------------------------------------------------------------------
# Event types
# ------------------------------------------------------------------------------

type
  ClickEvent* = object
    ## Event: CLICK (opcode 0x01)
    handle*: DOMElementHandle

  InputEvent* = object
    ## Event: INPUT (opcode 0x02)
    handle*: DOMElementHandle
    value*: string

  ChangeEvent* = object
    ## Event: CHANGE (opcode 0x03)
    handle*: DOMElementHandle
    value*: string

  KeydownEvent* = object
    ## Event: KEYDOWN (opcode 0x04)
    handle*: DOMElementHandle
    keycode*: int32

# ------------------------------------------------------------------------------
# Event parsing
# ------------------------------------------------------------------------------

proc parseClickEvent*(data: ptr uint8; len: uint32): ClickEvent =
  ## Parse CLICK event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[DOMElementHandle](readInt32(data, offset))

proc parseInputEvent*(data: ptr uint8; len: uint32): InputEvent =
  ## Parse INPUT event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[DOMElementHandle](readInt32(data, offset))
  result.value = readString(data, offset)

proc parseChangeEvent*(data: ptr uint8; len: uint32): ChangeEvent =
  ## Parse CHANGE event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[DOMElementHandle](readInt32(data, offset))
  result.value = readString(data, offset)

proc parseKeydownEvent*(data: ptr uint8; len: uint32): KeydownEvent =
  ## Parse KEYDOWN event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[DOMElementHandle](readInt32(data, offset))
  result.keycode = cast[int32](readInt32(data, offset))


# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc create_element_deferred*(handle: int32, tag: string) =
  ## dom.CREATE_ELEMENT_DEFERRED (opcode 0x05)
  pushCommand(0x05u32)
  pushData(handle.int32)
  pushString(tag)

proc create_element_deferred_scoped*(handle: int32, tag: string, scope: string) =
  ## dom.CREATE_ELEMENT_DEFERRED_SCOPED (opcode 0x06)
  pushCommand(0x06u32)
  pushData(handle.int32)
  pushString(tag)
  pushString(scope)

proc create_comment_deferred*(handle: int32, text: string) =
  ## dom.CREATE_COMMENT_DEFERRED (opcode 0x08)
  pushCommand(0x08u32)
  pushData(handle.int32)
  pushString(text)

proc create_text_node_deferred*(handle: int32, text: string) =
  ## dom.CREATE_TEXT_NODE_DEFERRED (opcode 0x0A)
  pushCommand(0x0Au32)
  pushData(handle.int32)
  pushString(text)

proc set_node_value*(handle: DOMElementHandle, text: string) =
  ## dom.SET_NODE_VALUE (opcode 0x0B)
  pushCommand(0x0Bu32)
  pushData(handle.int32)
  pushString(text)

proc set_attribute*(handle: DOMElementHandle, name: string, value: string) =
  ## dom.SET_ATTRIBUTE (opcode 0x0C)
  pushCommand(0x0Cu32)
  pushData(handle.int32)
  pushString(name)
  pushString(value)

proc set_property*(handle: DOMElementHandle, name: string, value: string) =
  ## dom.SET_PROPERTY (opcode 0x0D)
  pushCommand(0x0Du32)
  pushData(handle.int32)
  pushString(name)
  pushString(value)

proc append_child*(parent_handle: DOMElementHandle, child_handle: DOMElementHandle) =
  ## dom.APPEND_CHILD (opcode 0x0F)
  pushCommand(0x0Fu32)
  pushData(parent_handle.int32)
  pushData(child_handle.int32)

proc insert_before*(parent_handle: DOMElementHandle, child_handle: DOMElementHandle, ref_handle: DOMElementHandle) =
  ## dom.INSERT_BEFORE (opcode 0x10)
  pushCommand(0x10u32)
  pushData(parent_handle.int32)
  pushData(child_handle.int32)
  pushData(ref_handle.int32)

proc remove_element*(handle: DOMElementHandle) =
  ## dom.REMOVE_ELEMENT (opcode 0x11)
  pushCommand(0x11u32)
  pushData(handle.int32)

proc release_handle*(handle: DOMElementHandle) =
  ## dom.RELEASE_HANDLE (opcode 0x1E)
  ## Release a handle slot for GC recycling. Does NOT remove the DOM element.
  pushCommand(0x1Eu32)
  pushData(handle.int32)

proc inject_script*(code: string) =
  ## dom.INJECT_SCRIPT (opcode 0x1F)
  ## Inject a real <script> element into document.head. Unlike innerHTML, this executes.
  pushCommand(0x1Fu32)
  pushString(code)

proc move_before*(parent_handle: DOMElementHandle, node_handle: DOMElementHandle, ref_handle: DOMElementHandle) =
  ## dom.MOVE_BEFORE (opcode 0x12)
  pushCommand(0x12u32)
  pushData(parent_handle.int32)
  pushData(node_handle.int32)
  pushData(ref_handle.int32)

proc set_inner_html*(handle: DOMElementHandle, html: string) =
  ## dom.SET_INNER_HTML (opcode 0x13)
  pushCommand(0x13u32)
  pushData(handle.int32)
  pushString(html)

proc set_inner_text*(handle: DOMElementHandle, text: string) =
  ## dom.SET_INNER_TEXT (opcode 0x14)
  pushCommand(0x14u32)
  pushData(handle.int32)
  pushString(text)

proc add_class*(handle: DOMElementHandle, cls: string) =
  ## dom.ADD_CLASS (opcode 0x15)
  pushCommand(0x15u32)
  pushData(handle.int32)
  pushString(cls)

proc remove_class*(handle: DOMElementHandle, cls: string) =
  ## dom.REMOVE_CLASS (opcode 0x16)
  pushCommand(0x16u32)
  pushData(handle.int32)
  pushString(cls)

proc add_click_listener*(handle: DOMElementHandle) =
  ## dom.ADD_CLICK_LISTENER (opcode 0x17)
  pushCommand(0x17u32)
  pushData(handle.int32)

proc add_input_listener*(handle: DOMElementHandle) =
  ## dom.ADD_INPUT_LISTENER (opcode 0x18)
  pushCommand(0x18u32)
  pushData(handle.int32)

proc add_change_listener*(handle: DOMElementHandle) =
  ## dom.ADD_CHANGE_LISTENER (opcode 0x19)
  pushCommand(0x19u32)
  pushData(handle.int32)

proc add_keydown_listener*(handle: DOMElementHandle) =
  ## dom.ADD_KEYDOWN_LISTENER (opcode 0x1A)
  pushCommand(0x1Au32)
  pushData(handle.int32)

proc request_fullscreen*(handle: DOMElementHandle) =
  ## dom.REQUEST_FULLSCREEN (opcode 0x1B)
  pushCommand(0x1Bu32)
  pushData(handle.int32)

proc request_pointer_lock*(handle: DOMElementHandle) =
  ## dom.REQUEST_POINTER_LOCK (opcode 0x1C)
  pushCommand(0x1Cu32)
  pushData(handle.int32)

proc scroll_to_top*() =
  ## dom.SCROLL_TO_TOP (opcode 0x1D)
  pushCommand(0x1Du32)

# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_dom_get_body(): int32 {.importc.}
proc bindweb_dom_get_element_by_id(id: cstring; idLen: uint32): int32 {.importc.}
proc bindweb_dom_create_element(tag: cstring; tagLen: uint32): int32 {.importc.}
proc bindweb_dom_create_element_scoped(tag: cstring; tagLen: uint32; scope: cstring; scopeLen: uint32): int32 {.importc.}
proc bindweb_dom_create_comment(text: cstring; textLen: uint32): int32 {.importc.}
proc bindweb_dom_create_text_node(text: cstring; textLen: uint32): int32 {.importc.}
proc bindweb_dom_get_attribute(handle: int32; name: cstring; nameLen: uint32): uint32 {.importc.}

proc get_body*(): DOMElementHandle =
  ## dom.GET_BODY
  flush()
  return DOMElementHandle(bindweb_dom_get_body())

proc get_element_by_id*(id: string): DOMElementHandle =
  ## dom.GET_ELEMENT_BY_ID
  flush()
  return DOMElementHandle(bindweb_dom_get_element_by_id(id.cstring, id.len.uint32))

proc create_element*(tag: string): DOMElementHandle =
  ## dom.CREATE_ELEMENT
  flush()
  return DOMElementHandle(bindweb_dom_create_element(tag.cstring, tag.len.uint32))

proc create_element_scoped*(tag: string; scope: string): DOMElementHandle =
  ## dom.CREATE_ELEMENT_SCOPED
  flush()
  return DOMElementHandle(bindweb_dom_create_element_scoped(tag.cstring, tag.len.uint32, scope.cstring, scope.len.uint32))

proc create_comment*(text: string): DOMElementHandle =
  ## dom.CREATE_COMMENT
  flush()
  return DOMElementHandle(bindweb_dom_create_comment(text.cstring, text.len.uint32))

proc create_text_node*(text: string): DOMElementHandle =
  ## dom.CREATE_TEXT_NODE
  flush()
  return DOMElementHandle(bindweb_dom_create_text_node(text.cstring, text.len.uint32))

proc get_attribute*(handle: DOMElementHandle; name: string): string =
  ## dom.GET_ATTRIBUTE
  flush()
  let strLen = bindweb_dom_get_attribute(int32(handle), name.cstring, name.len.uint32)
  let data = cast[cstring](bindwebScratchBufferData())
  result = newString(strLen.int)
  if strLen > 0:
    copyMem(addr result[0], data, strLen.int)

`,
  '/bindweb/apis/fetch.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## FETCH namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Event opcode constants
# ------------------------------------------------------------------------------

const
  SUCCESS_EVENT_OPCODE* = 0x10'u8
  ERROR_EVENT_OPCODE* = 0x11'u8

# ------------------------------------------------------------------------------
# Event types
# ------------------------------------------------------------------------------

type
  SuccessEvent* = object
    ## Event: SUCCESS (opcode 0x10)
    id*: FetchRequestHandle
    data*: string

  ErrorEvent* = object
    ## Event: ERROR (opcode 0x11)
    id*: FetchRequestHandle
    error*: string

# ------------------------------------------------------------------------------
# Event parsing
# ------------------------------------------------------------------------------

proc parseSuccessEvent*(data: ptr uint8; len: uint32): SuccessEvent =
  ## Parse SUCCESS event from raw event buffer data.
  var offset: uint32 = 0
  result.id = cast[FetchRequestHandle](readInt32(data, offset))
  result.data = readString(data, offset)

proc parseErrorEvent*(data: ptr uint8; len: uint32): ErrorEvent =
  ## Parse ERROR event from raw event buffer data.
  var offset: uint32 = 0
  result.id = cast[FetchRequestHandle](readInt32(data, offset))
  result.error = readString(data, offset)


# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_fetch_get(url: cstring; urlLen: uint32; headers: cstring; headersLen: uint32): int32 {.importc.}
proc bindweb_fetch_post(url: cstring; urlLen: uint32; body: cstring; bodyLen: uint32; headers: cstring; headersLen: uint32): int32 {.importc.}
proc bindweb_fetch_patch(url: cstring; urlLen: uint32; body: cstring; bodyLen: uint32; headers: cstring; headersLen: uint32): int32 {.importc.}

proc get*(url: string; headers: string): FetchRequestHandle =
  ## fetch.GET
  flush()
  return FetchRequestHandle(bindweb_fetch_get(url.cstring, url.len.uint32, headers.cstring, headers.len.uint32))

proc post*(url: string; body: string; headers: string): FetchRequestHandle =
  ## fetch.POST
  flush()
  return FetchRequestHandle(bindweb_fetch_post(url.cstring, url.len.uint32, body.cstring, body.len.uint32, headers.cstring, headers.len.uint32))

proc patch*(url: string; body: string; headers: string): FetchRequestHandle =
  ## fetch.PATCH
  flush()
  return FetchRequestHandle(bindweb_fetch_patch(url.cstring, url.len.uint32, body.cstring, body.len.uint32, headers.cstring, headers.len.uint32))

`,
  '/bindweb/apis/handles.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## Typed handle definitions

import bindwebtypes

export Handle

type
  DOMElementHandle* = distinct int32
    ## Handle for DOMElement
    ## Inherits from Handle

  CanvasHandle* = distinct int32
    ## Handle for Canvas
    ## Inherits from DOMElementHandle

  CanvasContext2DHandle* = distinct int32
    ## Handle for CanvasContext2D
    ## Inherits from Handle

  WebGLContextHandle* = distinct int32
    ## Handle for WebGLContext
    ## Inherits from Handle

  WGPUContextHandle* = distinct int32
    ## Handle for WGPUContext
    ## Inherits from Handle

  ImageHandle* = distinct int32
    ## Handle for Image
    ## Inherits from DOMElementHandle

  AudioHandle* = distinct int32
    ## Handle for Audio
    ## Inherits from DOMElementHandle

  WebSocketHandle* = distinct int32
    ## Handle for WebSocket
    ## Inherits from Handle

  FetchRequestHandle* = distinct int32
    ## Handle for FetchRequest
    ## Inherits from Handle

  WebGLShaderHandle* = distinct int32
    ## Handle for WebGLShader
    ## Inherits from Handle

  WebGLProgramHandle* = distinct int32
    ## Handle for WebGLProgram
    ## Inherits from Handle

  WebGLBufferHandle* = distinct int32
    ## Handle for WebGLBuffer
    ## Inherits from Handle

  WebGLUniformHandle* = distinct int32
    ## Handle for WebGLUniform
    ## Inherits from Handle

  WGPUAdapterHandle* = distinct int32
    ## Handle for WGPUAdapter
    ## Inherits from Handle

  WGPUQueueHandle* = distinct int32
    ## Handle for WGPUQueue
    ## Inherits from Handle

  WGPUDeviceHandle* = distinct int32
    ## Handle for WGPUDevice
    ## Inherits from Handle

  WGPUShaderModuleHandle* = distinct int32
    ## Handle for WGPUShaderModule
    ## Inherits from Handle

  WGPUCommandEncoderHandle* = distinct int32
    ## Handle for WGPUCommandEncoder
    ## Inherits from Handle

  WGPUTextureViewHandle* = distinct int32
    ## Handle for WGPUTextureView
    ## Inherits from Handle

  WGPURenderPassHandle* = distinct int32
    ## Handle for WGPURenderPass
    ## Inherits from Handle

  WGPUCommandBufferHandle* = distinct int32
    ## Handle for WGPUCommandBuffer
    ## Inherits from Handle

  WGPURenderPipelineHandle* = distinct int32
    ## Handle for WGPURenderPipeline
    ## Inherits from Handle

# ------------------------------------------------------------------------------
# Inheritance converters
# ------------------------------------------------------------------------------

converter toDOMElementHandle*(h: CanvasHandle): DOMElementHandle =
  DOMElementHandle(h.int32)

converter toDOMElementHandle*(h: ImageHandle): DOMElementHandle =
  DOMElementHandle(h.int32)

converter toDOMElementHandle*(h: AudioHandle): DOMElementHandle =
  DOMElementHandle(h.int32)

# ------------------------------------------------------------------------------
# Handle comparison operators
# ------------------------------------------------------------------------------

proc \x60==\x60*(a, b: DOMElementHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: DOMElementHandle): bool = a.int32 != b.int32
proc isValid*(h: DOMElementHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: CanvasHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: CanvasHandle): bool = a.int32 != b.int32
proc isValid*(h: CanvasHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: CanvasContext2DHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: CanvasContext2DHandle): bool = a.int32 != b.int32
proc isValid*(h: CanvasContext2DHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WebGLContextHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WebGLContextHandle): bool = a.int32 != b.int32
proc isValid*(h: WebGLContextHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPUContextHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPUContextHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPUContextHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: ImageHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: ImageHandle): bool = a.int32 != b.int32
proc isValid*(h: ImageHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: AudioHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: AudioHandle): bool = a.int32 != b.int32
proc isValid*(h: AudioHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WebSocketHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WebSocketHandle): bool = a.int32 != b.int32
proc isValid*(h: WebSocketHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: FetchRequestHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: FetchRequestHandle): bool = a.int32 != b.int32
proc isValid*(h: FetchRequestHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WebGLShaderHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WebGLShaderHandle): bool = a.int32 != b.int32
proc isValid*(h: WebGLShaderHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WebGLProgramHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WebGLProgramHandle): bool = a.int32 != b.int32
proc isValid*(h: WebGLProgramHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WebGLBufferHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WebGLBufferHandle): bool = a.int32 != b.int32
proc isValid*(h: WebGLBufferHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WebGLUniformHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WebGLUniformHandle): bool = a.int32 != b.int32
proc isValid*(h: WebGLUniformHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPUAdapterHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPUAdapterHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPUAdapterHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPUQueueHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPUQueueHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPUQueueHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPUDeviceHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPUDeviceHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPUDeviceHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPUShaderModuleHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPUShaderModuleHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPUShaderModuleHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPUCommandEncoderHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPUCommandEncoderHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPUCommandEncoderHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPUTextureViewHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPUTextureViewHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPUTextureViewHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPURenderPassHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPURenderPassHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPURenderPassHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPUCommandBufferHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPUCommandBufferHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPUCommandBufferHandle): bool = h.int32 != 0

proc \x60==\x60*(a, b: WGPURenderPipelineHandle): bool = a.int32 == b.int32
proc \x60!=\x60*(a, b: WGPURenderPipelineHandle): bool = a.int32 != b.int32
proc isValid*(h: WGPURenderPipelineHandle): bool = h.int32 != 0

`,
  '/bindweb/apis/image.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## IMAGE namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_image_load(src: cstring; srcLen: uint32): int32 {.importc.}

proc load*(src: string): ImageHandle =
  ## image.LOAD
  flush()
  return ImageHandle(bindweb_image_load(src.cstring, src.len.uint32))

`,
  '/bindweb/apis/input.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## INPUT namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Event opcode constants
# ------------------------------------------------------------------------------

const
  KEY_DOWN_EVENT_OPCODE* = 0x05'u8
  KEY_UP_EVENT_OPCODE* = 0x06'u8
  MOUSE_DOWN_EVENT_OPCODE* = 0x07'u8
  MOUSE_UP_EVENT_OPCODE* = 0x08'u8
  MOUSE_MOVE_EVENT_OPCODE* = 0x09'u8
  MOUSE_WHEEL_EVENT_OPCODE* = 0x14'u8
  RESIZE_EVENT_OPCODE* = 0x15'u8

# ------------------------------------------------------------------------------
# Event types
# ------------------------------------------------------------------------------

type
  KeyDownEvent* = object
    ## Event: KEY_DOWN (opcode 0x05)
    key_code*: int32

  KeyUpEvent* = object
    ## Event: KEY_UP (opcode 0x06)
    key_code*: int32

  MouseDownEvent* = object
    ## Event: MOUSE_DOWN (opcode 0x07)
    button*: int32
    x*: int32
    y*: int32

  MouseUpEvent* = object
    ## Event: MOUSE_UP (opcode 0x08)
    button*: int32
    x*: int32
    y*: int32

  MouseMoveEvent* = object
    ## Event: MOUSE_MOVE (opcode 0x09)
    x*: int32
    y*: int32

  MouseWheelEvent* = object
    ## Event: MOUSE_WHEEL (opcode 0x14)
    delta_x*: int32
    delta_y*: int32

  ResizeEvent* = object
    ## Event: RESIZE (opcode 0x15)
    width*: int32
    height*: int32

# ------------------------------------------------------------------------------
# Event parsing
# ------------------------------------------------------------------------------

proc parseKeyDownEvent*(data: ptr uint8; len: uint32): KeyDownEvent =
  ## Parse KEY_DOWN event from raw event buffer data.
  var offset: uint32 = 0
  result.key_code = cast[int32](readInt32(data, offset))

proc parseKeyUpEvent*(data: ptr uint8; len: uint32): KeyUpEvent =
  ## Parse KEY_UP event from raw event buffer data.
  var offset: uint32 = 0
  result.key_code = cast[int32](readInt32(data, offset))

proc parseMouseDownEvent*(data: ptr uint8; len: uint32): MouseDownEvent =
  ## Parse MOUSE_DOWN event from raw event buffer data.
  var offset: uint32 = 0
  result.button = cast[int32](readInt32(data, offset))
  result.x = cast[int32](readInt32(data, offset))
  result.y = cast[int32](readInt32(data, offset))

proc parseMouseUpEvent*(data: ptr uint8; len: uint32): MouseUpEvent =
  ## Parse MOUSE_UP event from raw event buffer data.
  var offset: uint32 = 0
  result.button = cast[int32](readInt32(data, offset))
  result.x = cast[int32](readInt32(data, offset))
  result.y = cast[int32](readInt32(data, offset))

proc parseMouseMoveEvent*(data: ptr uint8; len: uint32): MouseMoveEvent =
  ## Parse MOUSE_MOVE event from raw event buffer data.
  var offset: uint32 = 0
  result.x = cast[int32](readInt32(data, offset))
  result.y = cast[int32](readInt32(data, offset))

proc parseMouseWheelEvent*(data: ptr uint8; len: uint32): MouseWheelEvent =
  ## Parse MOUSE_WHEEL event from raw event buffer data.
  var offset: uint32 = 0
  result.delta_x = cast[int32](readInt32(data, offset))
  result.delta_y = cast[int32](readInt32(data, offset))

proc parseResizeEvent*(data: ptr uint8; len: uint32): ResizeEvent =
  ## Parse RESIZE event from raw event buffer data.
  var offset: uint32 = 0
  result.width = cast[int32](readInt32(data, offset))
  result.height = cast[int32](readInt32(data, offset))


# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc init_keyboard*() =
  ## input.INIT_KEYBOARD (opcode 0x53)
  pushCommand(0x53u32)

proc init_mouse*(handle: DOMElementHandle) =
  ## input.INIT_MOUSE (opcode 0x54)
  pushCommand(0x54u32)
  pushData(handle.int32)

proc exit_pointer_lock*() =
  ## input.EXIT_POINTER_LOCK (opcode 0x55)
  pushCommand(0x55u32)

proc init_mouse_wheel*(handle: DOMElementHandle) =
  ## input.INIT_MOUSE_WHEEL (opcode 0x98)
  pushCommand(0x98u32)
  pushData(handle.int32)

proc init_resize*() =
  ## input.INIT_RESIZE (opcode 0x99)
  pushCommand(0x99u32)

`,
  '/bindweb/apis/storage.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## STORAGE namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc set_item*(key: string, value: string) =
  ## storage.SET_ITEM (opcode 0x67)
  pushCommand(0x67u32)
  pushString(key)
  pushString(value)

proc remove_item*(key: string) =
  ## storage.REMOVE_ITEM (opcode 0x68)
  pushCommand(0x68u32)
  pushString(key)

proc clear*() =
  ## storage.CLEAR (opcode 0x69)
  pushCommand(0x69u32)

`,
  '/bindweb/apis/system.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## SYSTEM namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Event opcode constants
# ------------------------------------------------------------------------------

const
  POPSTATE_EVENT_OPCODE* = 0x0A'u8
  VISIBILITY_CHANGE_EVENT_OPCODE* = 0x0B'u8

# ------------------------------------------------------------------------------
# Event types
# ------------------------------------------------------------------------------

type
  PopstateEvent* = object
    ## Event: POPSTATE (opcode 0x0A)
    path*: string

  VisibilityChangeEvent* = object
    ## Event: VISIBILITY_CHANGE (opcode 0x0B)
    hidden*: uint8
    state*: string

# ------------------------------------------------------------------------------
# Event parsing
# ------------------------------------------------------------------------------

proc parsePopstateEvent*(data: ptr uint8; len: uint32): PopstateEvent =
  ## Parse POPSTATE event from raw event buffer data.
  var offset: uint32 = 0
  result.path = readString(data, offset)

proc parseVisibilityChangeEvent*(data: ptr uint8; len: uint32): VisibilityChangeEvent =
  ## Parse VISIBILITY_CHANGE event from raw event buffer data.
  var offset: uint32 = 0
  result.hidden = uint8(readUint32(data, offset))
  result.state = readString(data, offset)


# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc log*(msg: string) =
  ## system.LOG (opcode 0x56)
  pushCommand(0x56u32)
  pushString(msg)

proc warn*(msg: string) =
  ## system.WARN (opcode 0x57)
  pushCommand(0x57u32)
  pushString(msg)

proc error*(msg: string) =
  ## system.ERROR (opcode 0x58)
  pushCommand(0x58u32)
  pushString(msg)

proc set_main_loop*(fn: pointer) =
  ## system.SET_MAIN_LOOP (opcode 0x59)
  pushCommand(0x59u32)
  pushData(cast[uint32](fn))

proc set_title*(title: string) =
  ## system.SET_TITLE (opcode 0x5A)
  pushCommand(0x5Au32)
  pushString(title)

proc reload*() =
  ## system.RELOAD (opcode 0x5B)
  pushCommand(0x5Bu32)

proc open_url*(url: string) =
  ## system.OPEN_URL (opcode 0x5C)
  pushCommand(0x5Cu32)
  pushString(url)

proc push_state*(path: string) =
  ## system.PUSH_STATE (opcode 0x64)
  pushCommand(0x64u32)
  pushString(path)

proc init_popstate*() =
  ## system.INIT_POPSTATE (opcode 0x65)
  pushCommand(0x65u32)

proc init_visibility_change*() =
  ## system.INIT_VISIBILITY_CHANGE (opcode 0x66)
  pushCommand(0x66u32)

# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_system_get_time(): float64 {.importc.}
proc bindweb_system_get_date_now(): float64 {.importc.}
proc bindweb_system_get_pathname(): uint32 {.importc.}
proc bindweb_system_get_search(): uint32 {.importc.}
proc bindweb_system_get_query_param(name: cstring; nameLen: uint32): uint32 {.importc.}
proc bindweb_system_get_visibility_state(): uint32 {.importc.}
proc bindweb_system_is_hidden(): uint8 {.importc.}

proc get_time*(): float64 =
  ## system.GET_TIME
  flush()
  return bindweb_system_get_time()

proc get_date_now*(): float64 =
  ## system.GET_DATE_NOW
  flush()
  return bindweb_system_get_date_now()

proc get_pathname*(): string =
  ## system.GET_PATHNAME
  flush()
  let strLen = bindweb_system_get_pathname()
  let data = cast[cstring](bindwebScratchBufferData())
  result = newString(strLen.int)
  if strLen > 0:
    copyMem(addr result[0], data, strLen.int)

proc get_search*(): string =
  ## system.GET_SEARCH
  flush()
  let strLen = bindweb_system_get_search()
  let data = cast[cstring](bindwebScratchBufferData())
  result = newString(strLen.int)
  if strLen > 0:
    copyMem(addr result[0], data, strLen.int)

proc get_query_param*(name: string): string =
  ## system.GET_QUERY_PARAM
  flush()
  let strLen = bindweb_system_get_query_param(name.cstring, name.len.uint32)
  let data = cast[cstring](bindwebScratchBufferData())
  result = newString(strLen.int)
  if strLen > 0:
    copyMem(addr result[0], data, strLen.int)

proc get_visibility_state*(): string =
  ## system.GET_VISIBILITY_STATE
  flush()
  let strLen = bindweb_system_get_visibility_state()
  let data = cast[cstring](bindwebScratchBufferData())
  result = newString(strLen.int)
  if strLen > 0:
    copyMem(addr result[0], data, strLen.int)

proc is_hidden*(): uint8 =
  ## system.IS_HIDDEN
  flush()
  return bindweb_system_is_hidden().uint8

`,
  '/bindweb/apis/webgl.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## WEBGL namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc viewport*(ctx_handle: WebGLContextHandle, x: int32, y: int32, width: int32, height: int32) =
  ## webgl.VIEWPORT (opcode 0x78)
  pushCommand(0x78u32)
  pushData(ctx_handle.int32)
  pushData(x.int32)
  pushData(y.int32)
  pushData(width.int32)
  pushData(height.int32)

proc clear_color*(ctx_handle: WebGLContextHandle, r: float64, g: float64, b: float64, a: float64) =
  ## webgl.CLEAR_COLOR (opcode 0x79)
  pushCommand(0x79u32)
  pushData(ctx_handle.int32)
  pushData(r.float64)
  pushData(g.float64)
  pushData(b.float64)
  pushData(a.float64)

proc clear*(ctx_handle: WebGLContextHandle, mask: uint32) =
  ## webgl.CLEAR (opcode 0x7A)
  pushCommand(0x7Au32)
  pushData(ctx_handle.int32)
  pushData(mask.uint32)

proc attach_shader*(ctx_handle: WebGLContextHandle, prog_handle: WebGLProgramHandle, shader_handle: WebGLShaderHandle) =
  ## webgl.ATTACH_SHADER (opcode 0x7D)
  pushCommand(0x7Du32)
  pushData(ctx_handle.int32)
  pushData(prog_handle.int32)
  pushData(shader_handle.int32)

proc link_program*(ctx_handle: WebGLContextHandle, prog_handle: WebGLProgramHandle) =
  ## webgl.LINK_PROGRAM (opcode 0x7E)
  pushCommand(0x7Eu32)
  pushData(ctx_handle.int32)
  pushData(prog_handle.int32)

proc bind_attrib_location*(ctx_handle: WebGLContextHandle, prog_handle: WebGLProgramHandle, index: uint32, name: string) =
  ## webgl.BIND_ATTRIB_LOCATION (opcode 0x7F)
  pushCommand(0x7Fu32)
  pushData(ctx_handle.int32)
  pushData(prog_handle.int32)
  pushData(index.uint32)
  pushString(name)

proc use_program*(ctx_handle: WebGLContextHandle, prog_handle: WebGLProgramHandle) =
  ## webgl.USE_PROGRAM (opcode 0x80)
  pushCommand(0x80u32)
  pushData(ctx_handle.int32)
  pushData(prog_handle.int32)

proc bind_buffer*(ctx_handle: WebGLContextHandle, target: uint32, buf_handle: WebGLBufferHandle) =
  ## webgl.BIND_BUFFER (opcode 0x82)
  pushCommand(0x82u32)
  pushData(ctx_handle.int32)
  pushData(target.uint32)
  pushData(buf_handle.int32)

proc buffer_data*(ctx_handle: WebGLContextHandle, target: uint32, data_ptr: uint32, data_len: uint32, usage: uint32) =
  ## webgl.BUFFER_DATA (opcode 0x83)
  pushCommand(0x83u32)
  pushData(ctx_handle.int32)
  pushData(target.uint32)
  pushData(data_ptr.uint32)
  pushData(data_len.uint32)
  pushData(usage.uint32)

proc enable_vertex_attrib_array*(ctx_handle: WebGLContextHandle, index: uint32) =
  ## webgl.ENABLE_VERTEX_ATTRIB_ARRAY (opcode 0x84)
  pushCommand(0x84u32)
  pushData(ctx_handle.int32)
  pushData(index.uint32)

proc enable*(ctx_handle: WebGLContextHandle, cap: uint32) =
  ## webgl.ENABLE (opcode 0x85)
  pushCommand(0x85u32)
  pushData(ctx_handle.int32)
  pushData(cap.uint32)

proc uniform_1f*(ctx_handle: WebGLContextHandle, loc_handle: WebGLUniformHandle, val: float64) =
  ## webgl.UNIFORM_1F (opcode 0x87)
  pushCommand(0x87u32)
  pushData(ctx_handle.int32)
  pushData(loc_handle.int32)
  pushData(val.float64)

proc vertex_attrib_pointer*(ctx_handle: WebGLContextHandle, index: uint32, size: int32, typ: uint32, normalized: uint8, stride: int32, offset: int32) =
  ## webgl.VERTEX_ATTRIB_POINTER (opcode 0x88)
  pushCommand(0x88u32)
  pushData(ctx_handle.int32)
  pushData(index.uint32)
  pushData(size.int32)
  pushData(typ.uint32)
  pushData(normalized.uint32)
  pushData(stride.int32)
  pushData(offset.int32)

proc draw_arrays*(ctx_handle: WebGLContextHandle, mode: uint32, first: int32, count: int32) =
  ## webgl.DRAW_ARRAYS (opcode 0x89)
  pushCommand(0x89u32)
  pushData(ctx_handle.int32)
  pushData(mode.uint32)
  pushData(first.int32)
  pushData(count.int32)

# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_webgl_create_shader(ctx_handle: int32; typ: uint32; source: cstring; sourceLen: uint32): int32 {.importc.}
proc bindweb_webgl_create_program(ctx_handle: int32): int32 {.importc.}
proc bindweb_webgl_create_buffer(ctx_handle: int32): int32 {.importc.}
proc bindweb_webgl_get_uniform_location(ctx_handle: int32; prog_handle: int32; name: cstring; nameLen: uint32): int32 {.importc.}

proc create_shader*(ctx_handle: WebGLContextHandle; typ: uint32; source: string): WebGLShaderHandle =
  ## webgl.CREATE_SHADER
  flush()
  return WebGLShaderHandle(bindweb_webgl_create_shader(int32(ctx_handle), typ, source.cstring, source.len.uint32))

proc create_program*(ctx_handle: WebGLContextHandle): WebGLProgramHandle =
  ## webgl.CREATE_PROGRAM
  flush()
  return WebGLProgramHandle(bindweb_webgl_create_program(int32(ctx_handle)))

proc create_buffer*(ctx_handle: WebGLContextHandle): WebGLBufferHandle =
  ## webgl.CREATE_BUFFER
  flush()
  return WebGLBufferHandle(bindweb_webgl_create_buffer(int32(ctx_handle)))

proc get_uniform_location*(ctx_handle: WebGLContextHandle; prog_handle: WebGLProgramHandle; name: string): WebGLUniformHandle =
  ## webgl.GET_UNIFORM_LOCATION
  flush()
  return WebGLUniformHandle(bindweb_webgl_get_uniform_location(int32(ctx_handle), int32(prog_handle), name.cstring, name.len.uint32))

`,
  '/bindweb/apis/websocket.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## WEBSOCKET namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Event opcode constants
# ------------------------------------------------------------------------------

const
  MESSAGE_EVENT_OPCODE* = 0x0C'u8
  OPEN_EVENT_OPCODE* = 0x0D'u8
  CLOSE_EVENT_OPCODE* = 0x0E'u8
  ERROR_EVENT_OPCODE* = 0x0F'u8

# ------------------------------------------------------------------------------
# Event types
# ------------------------------------------------------------------------------

type
  MessageEvent* = object
    ## Event: MESSAGE (opcode 0x0C)
    handle*: WebSocketHandle
    data*: string

  OpenEvent* = object
    ## Event: OPEN (opcode 0x0D)
    handle*: WebSocketHandle

  CloseEvent* = object
    ## Event: CLOSE (opcode 0x0E)
    handle*: WebSocketHandle

  ErrorEvent* = object
    ## Event: ERROR (opcode 0x0F)
    handle*: WebSocketHandle

# ------------------------------------------------------------------------------
# Event parsing
# ------------------------------------------------------------------------------

proc parseMessageEvent*(data: ptr uint8; len: uint32): MessageEvent =
  ## Parse MESSAGE event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[WebSocketHandle](readInt32(data, offset))
  result.data = readString(data, offset)

proc parseOpenEvent*(data: ptr uint8; len: uint32): OpenEvent =
  ## Parse OPEN event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[WebSocketHandle](readInt32(data, offset))

proc parseCloseEvent*(data: ptr uint8; len: uint32): CloseEvent =
  ## Parse CLOSE event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[WebSocketHandle](readInt32(data, offset))

proc parseErrorEvent*(data: ptr uint8; len: uint32): ErrorEvent =
  ## Parse ERROR event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[WebSocketHandle](readInt32(data, offset))


# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc send*(handle: WebSocketHandle, msg: string) =
  ## websocket.SEND (opcode 0x72)
  pushCommand(0x72u32)
  pushData(handle.int32)
  pushString(msg)

proc close*(handle: WebSocketHandle) =
  ## websocket.CLOSE (opcode 0x73)
  pushCommand(0x73u32)
  pushData(handle.int32)

# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_websocket_connect(url: cstring; urlLen: uint32): int32 {.importc.}

proc connect*(url: string): WebSocketHandle =
  ## websocket.CONNECT
  flush()
  return WebSocketHandle(bindweb_websocket_connect(url.cstring, url.len.uint32))

`,
  '/bindweb/apis/wgpu.nim': `
## Generated by BindWeb - DO NOT EDIT
## Source: schema.def

## WGPU namespace API

import bindweb, bindwebtypes

import handles

# ------------------------------------------------------------------------------
# Event opcode constants
# ------------------------------------------------------------------------------

const
  ADAPTER_READY_EVENT_OPCODE* = 0x12'u8
  DEVICE_READY_EVENT_OPCODE* = 0x13'u8

# ------------------------------------------------------------------------------
# Event types
# ------------------------------------------------------------------------------

type
  AdapterReadyEvent* = object
    ## Event: ADAPTER_READY (opcode 0x12)
    handle*: WGPUAdapterHandle

  DeviceReadyEvent* = object
    ## Event: DEVICE_READY (opcode 0x13)
    handle*: WGPUDeviceHandle

# ------------------------------------------------------------------------------
# Event parsing
# ------------------------------------------------------------------------------

proc parseAdapterReadyEvent*(data: ptr uint8; len: uint32): AdapterReadyEvent =
  ## Parse ADAPTER_READY event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[WGPUAdapterHandle](readInt32(data, offset))

proc parseDeviceReadyEvent*(data: ptr uint8; len: uint32): DeviceReadyEvent =
  ## Parse DEVICE_READY event from raw event buffer data.
  var offset: uint32 = 0
  result.handle = cast[WGPUDeviceHandle](readInt32(data, offset))


# ------------------------------------------------------------------------------
# Void commands (push to command buffer)
# ------------------------------------------------------------------------------

proc request_adapter*() =
  ## wgpu.REQUEST_ADAPTER (opcode 0x8A)
  pushCommand(0x8Au32)

proc request_device*(adapter_handle: WGPUAdapterHandle) =
  ## wgpu.REQUEST_DEVICE (opcode 0x8B)
  pushCommand(0x8Bu32)
  pushData(adapter_handle.int32)

proc configure*(context_handle: WGPUContextHandle, device_handle: WGPUDeviceHandle, format: string) =
  ## wgpu.CONFIGURE (opcode 0x8F)
  pushCommand(0x8Fu32)
  pushData(context_handle.int32)
  pushData(device_handle.int32)
  pushString(format)

proc end_pass*(pass_handle: WGPURenderPassHandle) =
  ## wgpu.END_PASS (opcode 0x92)
  pushCommand(0x92u32)
  pushData(pass_handle.int32)

proc queue_submit*(queue_handle: WGPUQueueHandle, command_buffer_handle: WGPUCommandBufferHandle) =
  ## wgpu.QUEUE_SUBMIT (opcode 0x94)
  pushCommand(0x94u32)
  pushData(queue_handle.int32)
  pushData(command_buffer_handle.int32)

proc set_pipeline*(pass_handle: WGPURenderPassHandle, pipeline_handle: WGPURenderPipelineHandle) =
  ## wgpu.SET_PIPELINE (opcode 0x96)
  pushCommand(0x96u32)
  pushData(pass_handle.int32)
  pushData(pipeline_handle.int32)

proc draw*(pass_handle: WGPURenderPassHandle, vertex_count: int32, instance_count: int32, first_vertex: int32, first_instance: int32) =
  ## wgpu.DRAW (opcode 0x97)
  pushCommand(0x97u32)
  pushData(pass_handle.int32)
  pushData(vertex_count.int32)
  pushData(instance_count.int32)
  pushData(first_vertex.int32)
  pushData(first_instance.int32)

# ------------------------------------------------------------------------------
# Return-value commands (JS imports)
# ------------------------------------------------------------------------------

proc bindweb_wgpu_get_queue(device_handle: int32): int32 {.importc.}
proc bindweb_wgpu_create_shader_module(device_handle: int32; code: cstring; codeLen: uint32): int32 {.importc.}
proc bindweb_wgpu_create_command_encoder(device_handle: int32): int32 {.importc.}
proc bindweb_wgpu_get_current_texture_view(context_handle: int32): int32 {.importc.}
proc bindweb_wgpu_begin_render_pass(encoder_handle: int32; view_handle: int32; r: float64; g: float64; b: float64; a: float64): int32 {.importc.}
proc bindweb_wgpu_finish_encoder(encoder_handle: int32): int32 {.importc.}
proc bindweb_wgpu_create_render_pipeline_simple(device_handle: int32; vs_module_handle: int32; fs_module_handle: int32; vs_entry: cstring; vs_entryLen: uint32; fs_entry: cstring; fs_entryLen: uint32; format: cstring; formatLen: uint32): int32 {.importc.}

proc get_queue*(device_handle: WGPUDeviceHandle): WGPUQueueHandle =
  ## wgpu.GET_QUEUE
  flush()
  return WGPUQueueHandle(bindweb_wgpu_get_queue(int32(device_handle)))

proc create_shader_module*(device_handle: WGPUDeviceHandle; code: string): WGPUShaderModuleHandle =
  ## wgpu.CREATE_SHADER_MODULE
  flush()
  return WGPUShaderModuleHandle(bindweb_wgpu_create_shader_module(int32(device_handle), code.cstring, code.len.uint32))

proc create_command_encoder*(device_handle: WGPUDeviceHandle): WGPUCommandEncoderHandle =
  ## wgpu.CREATE_COMMAND_ENCODER
  flush()
  return WGPUCommandEncoderHandle(bindweb_wgpu_create_command_encoder(int32(device_handle)))

proc get_current_texture_view*(context_handle: WGPUContextHandle): WGPUTextureViewHandle =
  ## wgpu.GET_CURRENT_TEXTURE_VIEW
  flush()
  return WGPUTextureViewHandle(bindweb_wgpu_get_current_texture_view(int32(context_handle)))

proc begin_render_pass*(encoder_handle: WGPUCommandEncoderHandle; view_handle: WGPUTextureViewHandle; r: float64; g: float64; b: float64; a: float64): WGPURenderPassHandle =
  ## wgpu.BEGIN_RENDER_PASS
  flush()
  return WGPURenderPassHandle(bindweb_wgpu_begin_render_pass(int32(encoder_handle), int32(view_handle), r, g, b, a))

proc finish_encoder*(encoder_handle: WGPUCommandEncoderHandle): WGPUCommandBufferHandle =
  ## wgpu.FINISH_ENCODER
  flush()
  return WGPUCommandBufferHandle(bindweb_wgpu_finish_encoder(int32(encoder_handle)))

proc create_render_pipeline_simple*(device_handle: WGPUDeviceHandle; vs_module_handle: WGPUShaderModuleHandle; fs_module_handle: WGPUShaderModuleHandle; vs_entry: string; fs_entry: string; format: string): WGPURenderPipelineHandle =
  ## wgpu.CREATE_RENDER_PIPELINE_SIMPLE
  flush()
  return WGPURenderPipelineHandle(bindweb_wgpu_create_render_pipeline_simple(int32(device_handle), int32(vs_module_handle), int32(fs_module_handle), vs_entry.cstring, vs_entry.len.uint32, fs_entry.cstring, fs_entry.len.uint32, format.cstring, format.len.uint32))

`
};
