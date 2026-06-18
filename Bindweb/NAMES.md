# Names for Nim Bindweb — A Complete Guide to API Naming

This document explains every name, convention, and identifier in Nim Bindweb so you know exactly what to import, what to call, and what each name means.

---

## Table of Contents

1. [Module Names](#module-names)
2. [Core Types](#core-types)
3. [Handle Types](#handle-types)
4. [Proc Naming Conventions](#proc-naming-conventions)
5. [Event Names](#event-names)
6. [Constants and Opcodes](#constants-and-opcodes)
7. [The WebApp Type and Callbacks](#the-webapp-type-and-callbacks)
8. [OwnedHandle (GC-Aware)](#ownedhandle-gc-aware)
9. [Complete Import Cheat Sheet](#complete-import-cheat-sheet)

---

## Module Names

| Module File | Import As | Purpose | When You Need It |
|-------------|-----------|---------|-----------------|
| `bindweb.nim` | `bindweb` | Core: `flush()`, `pushCommand()`, `pollEvent()`, `OwnedHandle`, `markUsed` | **Always** |
| `bindwebtypes.nim` | `bindwebtypes` | Types: `Handle`, `PollEvent`, `StringView` | **Always** |
| `bindwebevents.nim` | `bindwebevents` | High-level events: `WebApp`, `newWebApp()`, `eventName()` | When handling events |
| `apis/handles.nim` | `apis/handles` | Typed handles: `DOMElementHandle`, `CanvasHandle`, etc. | When using typed handles |
| `apis/dom.nim` | `apis/dom` | DOM: `createElement()`, `setAttribute()`, `appendChild()` | When manipulating DOM |
| `apis/canvas.nim` | `apis/canvas` | Canvas 2D: `createCanvas()`, `getContext2d()`, `fillRect()` | When drawing |
| `apis/input.nim` | `apis/input` | Input: `initMouse()`, `initKeyboard()`, `MouseMoveEvent` | When handling mouse/keyboard |
| `apis/system.nim` | `apis/system` | System: `setTitle()`, `log()`, `setMainLoop()` | Always (title, logging) |
| `apis/webgl.nim` | `apis/webgl` | WebGL: `getContextWebgl()`, `createShader()` | When using WebGL |
| `apis/wgpu.nim` | `apis/wgpu` | WebGPU: `requestAdapter()`, `createDevice()` | When using WebGPU |
| `apis/audio.nim` | `apis/audio` | Audio: `createAudio()`, `playAudio()` | When playing sound |
| `apis/websocket.nim` | `apis/websocket` | WebSocket: `createWebSocket()`, event opcodes | When using WebSockets |
| `apis/fetch.nim` | `apis/fetch` | Fetch: `fetchUrl()`, event opcodes | When doing HTTP |
| `apis/image.nim` | `apis/image` | Image: `createImage()` | When loading images |
| `apis/storage.nim` | `apis/storage` | Storage: `localStorageGet()`, `localStorageSet()` | When using localStorage |

### Import Pattern

```nim
# Minimal (DOM only)
import bindweb, bindwebtypes
import apis/handles, apis/dom, apis/system

# DOM + Events
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/system

# Canvas + Input
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/canvas, apis/input, apis/system

# Everything
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/canvas, apis/input, apis/system
import apis/websocket, apis/fetch, apis/webgl, apis/audio
```

---

## Core Types

### Handle

```nim
type Handle* = distinct int32
```

The root handle type. All typed handles convert to/from `Handle`:

```nim
let h: DOMElementHandle = createElement("div")
let base: Handle = h.Handle      # convert to base Handle
let back: DOMElementHandle = base.DOMElementHandle  # convert back
```

### PollEvent

```nim
type PollEvent* = object
  opcode*: uint8      # Event type identifier (1=Click, 2=Input, etc.)
  data*: ptr uint8    # Pointer to event data in event buffer
  len*: uint32        # Length of event data
```

Read by `pollEvent()`. Use with `bindwebevents` — don't check `opcode` manually.

### StringView

```nim
type StringView* = object
  data*: ptr uint8
  len*: uint32
```

Used for zero-copy string reads from the C runtime.

---

## Handle Types

All handle types are `distinct int32` from `Handle`. They are defined in `apis/handles.nim`.

| Handle Type | Extends | Use For |
|-------------|---------|---------|
| `DOMElementHandle` | `Handle` | Any DOM element (div, button, span, etc.) |
| `CanvasHandle` | `DOMElementHandle` | `<canvas>` elements |
| `ImageHandle` | `DOMElementHandle` | `<img>` elements |
| `AudioHandle` | `DOMElementHandle` | `<audio>` elements |
| `CanvasContext2DHandle` | `Handle` | Canvas 2D rendering context |
| `WebGLContextHandle` | `Handle` | WebGL rendering context |
| `WebGLShaderHandle` | `Handle` | WebGL shader objects |
| `WebGLProgramHandle` | `Handle` | WebGL program objects |
| `WebGLBufferHandle` | `Handle` | WebGL buffer objects |
| `WebSocketHandle` | `Handle` | WebSocket connections |
| `FetchRequestHandle` | `Handle` | HTTP fetch requests |

### Handle Conversions to Primitive Types

Handles are `distinct int32`, so you must explicitly convert them to use in string interpolation, arithmetic, or APIs expecting raw integers:

```nim
let h: DOMElementHandle = createElement("div")

# Convert to int32 (most common — for printing, comparing)
let raw = h.int32                    # → 5
let text = "handle " & $h.int32     # → "handle 5"
let label = "Clicked element #" & $ev.handle.int32

# Convert to uint32 (for command buffer APIs)
let u = h.uint32

# Convert to int (for Nim array indexing, loops, etc.)
let idx = h.int

# Convert from int32 (when creating handles from raw values)
let restored = raw.DOMElementHandle
```

**Common pattern in event handlers:**

```nim
app.onClick = proc(ev: ClickEvent) =
  log("Clicked handle " & $ev.handle.int32)     # Print handle value
  if ev.handle.int32 == 0:                      # Compare with literal
    log("Clicked the body!")
  let handleStr = $ev.handle.int32              # Convert to string for display
  setInnerText(statusDiv, "Last clicked: #" & handleStr)
```

**Why `.int32` is required:** Because `Handle` and `DOMElementHandle` are `distinct int32`, not plain `int32`, Nim does not allow implicit conversion. You must write `h.int32` explicitly. This is a safety feature — it prevents accidentally passing a canvas context handle where a DOM element handle is expected.

### Handle Operations

```nim
let h = createElement("div")
if h.isValid:          # Check if handle is valid (not -1)
  echo h.int32        # Get raw int32 value
  echo h == body      # Handles support == operator
```

---

## Proc Naming Conventions

Nim Bindweb follows consistent naming across all modules:

| Pattern | Example | Meaning |
|---------|---------|---------|
| `create_*` | `createElement()`, `createCanvas()` | Creates a JS object, returns a handle |
| `get_*` | `getBody()`, `getElementById()` | Retrieves an existing object |
| `set_*` | `setAttribute()`, `setFillStyle()` | Sets a property/value |
| `get_context_*` | `getContext2d()`, `getContextWebgl()` | Gets a rendering context |
| `add_*_listener` | `addClickListener()` | Registers an element for events |
| `init_*` | `initMouse()`, `initKeyboard()` | Initializes a subsystem |
| `push_*` | `pushCommand()`, `pushString()` | Low-level: pushes to command buffer |
| `parse_*_event` | `parseClickEvent()`, `parseMouseMoveEvent()` | Parses raw event data into typed object |
| `request_*` | `requestFullscreen()`, `requestAdapter()` | Async request to browser |
| `release_*` | `releaseHandle()` | Releases a resource without destroying |
| `inject_*` | `injectScript()` | Injects JS into the page |

### Snake Case

All procs use `snake_case` (Nim convention). The schema generates `set_inner_text` from `SET_INNER_TEXT`:

```nim
# In schema: SET_INNER_TEXT
# Generated: set_inner_text*
setInnerText(elem, "Hello")   # Camel alias also available
```

---

## Event Names

### Event Kinds (WebEventKind enum)

```nim
type WebEventKind* = enum
  wekClick, wekInput, wekChange
  wekKeyDown, wekKeyUp
  wekMouseDown, wekMouseUp, wekMouseMove, wekMouseWheel
  wekResize
  wekPopstate, wekVisibilityChange
  wekMessage, wekOpen, wekClose, wekWSError
  wekFetchSuccess, wekFetchError
  wekUnknown
```

### Boolean Checkers

```nim
if isClick(ev): ...
if isMouseMove(ev): ...
if isKeyDown(ev): ...
if isResize(ev): ...
```

### Event Opcode Constants (for advanced use)

Defined in each API module:

```nim
dom.CLICK_EVENT_OPCODE      # 0x01
dom.INPUT_EVENT_OPCODE      # 0x02
dom.CHANGE_EVENT_OPCODE     # 0x03
input.KEY_DOWN_EVENT_OPCODE   # 0x05
input.MOUSE_DOWN_EVENT_OPCODE # 0x07
input.MOUSE_MOVE_EVENT_OPCODE # 0x09
input.MOUSE_WHEEL_EVENT_OPCODE # 0x12
input.RESIZE_EVENT_OPCODE    # 0x13
system.POPSTATE_EVENT_OPCODE # 0x0A
websocket.MESSAGE_EVENT_OPCODE # 0x0C
fetch.SUCCESS_EVENT_OPCODE   # 0x10
```

### Event Data Types

| Event | Type | Fields |
|-------|------|--------|
| Click | `ClickEvent` | `handle: DOMElementHandle` |
| Input | `InputEvent` | `handle: DOMElementHandle`, `value: string` |
| Change | `ChangeEvent` | `handle: DOMElementHandle`, `value: string` |
| KeyDown | `KeyDownEvent` | `key_code: int32` |
| MouseDown | `MouseDownEvent` | `button: int32`, `x: int32`, `y: int32` |
| MouseMove | `MouseMoveEvent` | `x: int32`, `y: int32` |
| MouseWheel | `MouseWheelEvent` | `deltaX: float64`, `deltaY: float64` |
| Resize | `ResizeEvent` | `width: int32`, `height: int32` |
| Message | `MessageEvent` | `handle: WebSocketHandle`, `data: string` |
| FetchSuccess | `SuccessEvent` | `handle: FetchRequestHandle`, `status: int32`, `data: string` |

---

## The WebApp Type and Callbacks

`WebApp` is the high-level event manager from `bindwebevents`.

### Creating and Running

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/system

proc main() =
  let app = newWebApp()

  app.onClick = proc(ev: ClickEvent) =
    echo "Clicked: ", ev.handle.int32

  app.onMouseMove = proc(ev: MouseMoveEvent) =
    echo "Mouse: ", ev.x, ", ", ev.y

  app.run()  # Starts the main loop
```

### All WebApp Callbacks

| Callback | Event Type | Register With |
|----------|-----------|---------------|
| `onClick` | `ClickEvent` | `addClickListener(elem)` |
| `onInput` | `InputEvent` | `addInputListener(elem)` |
| `onChange` | `ChangeEvent` | `addChangeListener(elem)` |
| `onKeyDown` | `KeyDownEvent` | `initKeyboard()` |
| `onKeyUp` | `KeyUpEvent` | `initKeyboard()` |
| `onMouseDown` | `MouseDownEvent` | `initMouse(canvas)` |
| `onMouseUp` | `MouseUpEvent` | `initMouse(canvas)` |
| `onMouseMove` | `MouseMoveEvent` | `initMouse(canvas)` |
| `onMouseWheel` | `MouseWheelEvent` | `initMouse(canvas)` |
| `onResize` | `ResizeEvent` | (auto-initialized) |
| `onPopstate` | `PopstateEvent` | `initPopstate()` |
| `onVisibilityChange` | `VisibilityChangeEvent` | `initVisibilityChange()` |
| `onMessage` | `MessageEvent` | `createWebSocket(url)` |
| `onOpen` | `OpenEvent` | `createWebSocket(url)` |
| `onClose` | `CloseEvent` | `createWebSocket(url)` |
| `onWSError` | `ErrorEvent` | `createWebSocket(url)` |
| `onFetchSuccess` | `SuccessEvent` | `fetchUrl(url)` |
| `onFetchError` | `ErrorEvent` | `fetchUrl(url)` |
| `frameCallback` | `proc(timeMs: float64)` | Set manually |

### The `webloop` Template

For simple frame-based apps:

```nim
let app = newWebApp()
app.onClick = proc(ev: ClickEvent) = echo "click"
app.webloop:
  drawFrame()
  flush()
```

This is shorthand for:
```nim
app.frameCallback = proc(timeMs: float64) =
  drawFrame()
  flush()
app.run()
```

---

## OwnedHandle (GC-Aware)

`OwnedHandle` is a handle wrapper with an ARC destructor. When the Nim value goes out of scope, JS recycles the handle slot automatically.

```nim
import bindweb  # OwnedHandle is defined here
import apis/handles, apis/dom

proc makeButton(): OwnedHandle =
  let h = createElement("button")
  setInnerText(h, "Click Me")
  own(h)  # Wrap in OwnedHandle

proc main() =
  let btn = makeButton()  # btn: OwnedHandle
  # ... use btn ...
  # When btn goes out of scope, =destroy emits RELEASE_HANDLE
  # JS recycles the slot via releaseHandle()
```

### Why Use It?

Without `OwnedHandle`, handles are bare `int32` values. Nim's GC doesn't know about JS handle tables, so dropped handles leak slots. `OwnedHandle` bridges the gap: ARC's deterministic destructor tells JS to recycle.

The symmetric counterpart is `GC_ref(app)` in `run()`, which keeps the WebApp alive after `main()` returns.

---

## Complete Import Cheat Sheet

### DOM App (Buttons, forms, text)

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/system
```

### Canvas App (Drawing, animation)

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/canvas, apis/input, apis/system
```

### WebSocket App

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/websocket, apis/system
```

### Fetch App (HTTP requests)

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/fetch, apis/system
```

### Full-Featured App (everything)

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/canvas, apis/input, apis/system
import apis/webgl, apis/audio, apis/websocket, apis/fetch, apis/image
```

---

## Naming Comparison: Before vs After

If you're coming from WebCC (the upstream C++ project):

| WebCC (C++) | Nim Bindweb (Nim) | Notes |
|-------------|-------------------|-------|
| `coi::DomHandle` | `DOMElementHandle` | Same concept, Nim naming |
| `coi::CanvasHandle` | `CanvasHandle` | Extends DOMElementHandle |
| `coiGetBody()` | `getBody()` | Snake case |
| `coiCreateElement()` | `createElement()` | |
| `coiSetAttribute()` | `setAttribute()` | |
| `coiFlush()` | `flush()` | |
| `coiPollEvent()` | `pollEvent()` | |
| `coiSetMainLoop()` | `setMainLoop()` | |
| `coiApp` | `WebApp` | High-level event manager |
| `coiOnClick` | `onClick` | WebApp callback field |
| N/A | `OwnedHandle` | GC-aware handle (new in Nim Bindweb) |
| N/A | `injectScript()` | Inject real `<script>` elements (new) |
| N/A | `releaseHandle()` | Free handle slot without DOM removal (new) |

---

## Reserved Words to Avoid

Nim keywords that conflict with common DOM names:

| DOM Name | Use Instead | Why |
|----------|-------------|-----|
| `div` | `myDiv`, `divElem` | `div` is a Nim keyword (integer division) |
| `method` | `httpMethod`, `reqMethod` | `method` is a Nim keyword |
| `type` | `inputType`, `elemType` | `type` is a Nim keyword |
| `proc` | `callback`, `fn` | `proc` is a Nim keyword |
| `ref` | `reference` | `ref` is a Nim keyword |
| `addr` | `address` | `addr` is a Nim keyword |
| `ptr` | `pointer` | `ptr` is a Nim keyword |
