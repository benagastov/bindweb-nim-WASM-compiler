# Nim Bindweb-Nim Documentation

Complete guide for writing Nim code that compiles to WASM and manipulates the browser DOM, handles events, draws to Canvas, and more.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Event System (`bindwebevents`)](#event-system-bindwebevents)
4. [DOM API (`apis/dom`)](#dom-api-apisdom)
5. [Canvas API (`apis/canvas`)](#canvas-api-apiscanvas)
6. [Input API (`apis/input`)](#input-api-apisinput)
7. [System API (`apis/system`)](#system-api-apissystem)
8. [Handle Types (`apis/handles`)](#handle-types-apishandles)
9. [Complete Examples](#complete-examples)

---

## Introduction

Nim Bindweb-Nim is a framework that lets you write Nim code that compiles to WASM and controls the browser. It uses a **command-buffer architecture**: your Nim code pushes commands (opcodes) into a shared WASM memory buffer, and JavaScript reads and executes them. Events from JavaScript flow back through a separate event buffer.

### Architecture Overview

```
Your Nim Code
      |
      v
  Push commands --> WASM Memory Buffer --> JS reads & executes --> DOM/Canvas/WebGL
      ^                                                              |
      |                                                              |
  Poll events <----- Event Buffer <------- JS pushes events <--------+
```

### Key Modules

| Module | Import Path | Purpose |
|--------|-------------|---------|
| `bindweb` | `bindweb` | Core: `flush()`, `pushCommand()`, `pollEvent()` |
| `bindwebtypes` | `bindwebtypes` | Types: `Handle`, `PollEvent`, `StringView` |
| `bindwebevents` | `bindwebevents` | **High-level event system**: `WebApp`, callbacks |
| `apis/dom` | `apis/dom` | DOM manipulation: create elements, set attributes |
| `apis/canvas` | `apis/canvas` | Canvas 2D drawing |
| `apis/input` | `apis/input` | Mouse, keyboard events |
| `apis/system` | `apis/system` | Logging, title, URL, time |
| `apis/handles` | `apis/handles` | Typed handle definitions |

---

## Getting Started

### Minimal Program

```nim
import bindweb, bindwebtypes
import apis/handles, apis/dom, apis/system

proc main() =
  let body = getBody()
  let myDiv = createElement("div")
  setAttribute(myDiv, "style", "padding: 20px; color: #2196F3; font-family: sans-serif;")
  setInnerText(myDiv, "Hello from Nim + Nim Bindweb!")
  appendChild(body, myDiv)
  setTitle("My First Nim Bindweb App")
  flush()

main()
```

### Every Program Needs These Imports

```nim
import bindweb, bindwebtypes              # Core framework
import apis/handles, apis/dom         # DOM manipulation
import apis/system                    # Logging, title
import apis/input                     # Mouse/keyboard (if needed)
import apis/canvas                    # Drawing (if needed)
import bindwebevents                    # High-level events (recommended)
```

### Critical: `flush()`

After building a frame of commands, call `flush()` to send them to JavaScript:

```nim
# Create element, set attributes, append...
flush()  # <-- Everything above this line is sent to the browser
```

Without `flush()`, nothing appears on screen.

---

## Event System (`bindwebevents`)

The high-level event system replaces manual `pollEvent()` loops with typed callbacks.

### Two Ways to Handle Events

**Old way** (low-level, verbose):
```nim
var ev: PollEvent
while pollEvent(ev):
  if ev.opcode == 0x01:      # hardcoded opcode
    let event = parseClickEvent(ev.data, ev.len)
    echo "Clicked: ", event.handle
  elif ev.opcode == 0x09:    # hardcoded opcode
    let event = parseMouseMoveEvent(ev.data, ev.len)
    echo "Mouse: ", event.x, ", ", event.y
```

**New way** (high-level, clean):
```nim
import bindwebevents

let app = newWebApp()

app.onClick = proc(ev: ClickEvent) =
  echo "Clicked: ", ev.handle

app.onMouseMove = proc(ev: MouseMoveEvent) =
  echo "Mouse: ", ev.x, ", ", ev.y

app.run()  # Auto-dispatching event loop starts
```

### WebApp

`WebApp` is the main event manager. Create one, register callbacks for events you care about, then call `run()`.

```nim
let app = newWebApp()
```

### Available Event Callbacks

| Callback | Event Type | Trigger |
|----------|------------|---------|
| `onClick` | `ClickEvent` | Click on element with `addClickListener()` |
| `onInput` | `InputEvent` | Input on element with `addInputListener()` |
| `onChange` | `ChangeEvent` | Change on element with `addChangeListener()` |
| `onKeyDown` | `KeyDownEvent` | Key pressed (with `initKeyboard()`) |
| `onKeyUp` | `KeyUpEvent` | Key released (with `initKeyboard()`) |
| `onMouseDown` | `MouseDownEvent` | Mouse button pressed (with `initMouse()`) |
| `onMouseUp` | `MouseUpEvent` | Mouse button released |
| `onMouseMove` | `MouseMoveEvent` | Mouse moved |
| `onMouseWheel` | `MouseWheelEvent` | Scroll wheel used |
| `onResize` | `ResizeEvent` | Window resized |
| `onPopstate` | `PopstateEvent` | Browser back/forward button |
| `onVisibilityChange` | `VisibilityChangeEvent` | Tab hidden/shown |
| `onMessage` | `MessageEvent` | WebSocket message received |
| `onOpen` | `OpenEvent` | WebSocket connected |
| `onClose` | `CloseEvent` | WebSocket closed |
| `onWSError` | `ErrorEvent` | WebSocket error |
| `onFetchSuccess` | `SuccessEvent` | HTTP fetch succeeded |
| `onFetchError` | `ErrorEvent` | HTTP fetch failed |

### Event Data Types

```nim
# DOM events
ClickEvent        # handle: DOMElementHandle
InputEvent        # handle: DOMElementHandle, value: string
ChangeEvent       # handle: DOMElementHandle, value: string

# Input events
KeyDownEvent      # key_code: int32
KeyUpEvent        # key_code: int32
MouseDownEvent    # button: int32, x: int32, y: int32
MouseUpEvent      # button: int32, x: int32, y: int32
MouseMoveEvent    # x: int32, y: int32
MouseWheelEvent   # deltaX: float64, deltaY: float64

# System events
ResizeEvent       # width: int32, height: int32
PopstateEvent     # path: string
VisibilityChangeEvent  # hidden: uint8, state: string

# WebSocket events
MessageEvent      # handle: WebSocketHandle, data: string
OpenEvent         # handle: WebSocketHandle
CloseEvent        # handle: WebSocketHandle, code: int32, reason: string
ErrorEvent        # handle: WebSocketHandle, message: string

# Fetch events
SuccessEvent      # handle: FetchRequestHandle, status: int32, data: string
ErrorEvent        # handle: FetchRequestHandle, message: string
```

### Boolean Helpers

Check event type without comparing opcodes:

```nim
if isClick(ev): ...
if isMouseMove(ev): ...
if isKeyDown(ev): ...
if isResize(ev): ...
```

### `eventName()` for Debugging

```nim
proc eventName(ev: PollEvent): string
# Returns: "Click", "MouseMove", "KeyDown", "Unknown", etc.

# Usage:
app.onClick = proc(ev: ClickEvent) =
  log("Got event: " & eventName(ev))  # "Got event: Click"
```

### `run()` - Start the Event Loop

```nim
proc run*(app: WebApp)
```
Starts `setMainLoop` with an internal `update()` that polls all events, dispatches them to your callbacks, then calls `frameCallback` (if set).

### `webloop` Template - Simplest Possible API

For simple apps that only need a frame callback:

```nim
let app = newWebApp()

app.onClick = proc(ev: ClickEvent) =
  echo "click!"

# Set frameCallback and start the loop in one call:
app.webloop:
  drawEverything()
  flush()
```

This is equivalent to:
```nim
app.frameCallback = proc(timeMs: float64) =
  drawEverything()
  flush()
app.run()
```

### Complete Event Example

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/input, apis/system

proc main() =
  let body = getBody()

  # Create a container
  let container = createElement("div")
  setAttribute(container, "style", "padding: 24px; font-family: sans-serif;")
  appendChild(body, container)

  # Create a button
  let btn = createElement("button")
  setAttribute(btn, "style", "padding: 12px 24px; font-size: 16px; cursor: pointer;")
  setInnerText(btn, "Click Me")
  appendChild(container, btn)

  # Register the button for click events
  addClickListener(btn)

  # Create a display area
  let display = createElement("div")
  setAttribute(display, "style", "margin-top: 16px; color: #4CAF50;")
  setInnerText(display, "No clicks yet")
  appendChild(container, display)

  flush()

  # --- Event handling with WebApp ---
  let app = newWebApp()
  var clickCount = 0

  app.onClick = proc(ev: ClickEvent) =
    clickCount += 1
    setInnerText(display, "Clicked " & $clickCount & " times!")
    log("Click event: " & eventName(ev))
    flush()

  app.onMouseMove = proc(ev: MouseMoveEvent) =
    # Throttle: only log every 50 pixels
    if ev.x mod 100 == 0:
      log("Mouse at (" & $ev.x & ", " & $ev.y & ")")

  # Start the auto-dispatching loop
  app.run()

main()
```

---

## DOM API (`apis/dom`)

### Creating Elements

All creation functions return a `DOMElementHandle`:

```nim
let body = getBody()                           # Get <body>
let div = createElement("div")                 # Create <div>
let span = createElement("span")               # Create <span>
let btn = createElement("button")              # Create <button>
let inp = createElement("input")               # Create <input>
let img = createElement("img")                 # Create <img>
let h1 = createElement("h1")                   # Create <h1>
let p = createElement("p")                     # Create <p>

# With scope (shadow DOM)
let scoped = createElementScoped("div", "my-scope")

# Get existing element
let existing = getElementById("my-id")

# Text nodes and comments
let text = createTextNode("Hello")             # Text node
let comment = createComment("This is a comment") # Comment node
```

### Modifying Elements

```nim
# --- Attributes ---
setAttribute(elem, "id", "my-id")
setAttribute(elem, "class", "container active")
setAttribute(elem, "style", "color: red; padding: 10px;")
setAttribute(elem, "src", "image.png")
setAttribute(elem, "href", "https://example.com")

# Read attribute
let val = getAttribute(elem, "data-value")

# --- CSS Classes ---
addClass(elem, "highlight")
removeClass(elem, "hidden")

# --- Properties ---
setProperty(elem, "value", "default text")

# --- Inner content ---
setInnerText(elem, "Visible text content")     # Text only (safe)
setInnerHTML(elem, "<b>Bold</b> text")         # HTML (raw, use carefully)
setNodeValue(elem, "new value")                # For text nodes

# --- Title ---
setTitle("My Page Title")
```

### DOM Tree Manipulation

```nim
# --- Building the tree ---
appendChild(parent, child)        # Add child as last child of parent
insertBefore(parent, child, ref)  # Insert child before ref
removeElement(elem)               # Remove element from DOM

# --- Move nodes ---
moveBefore(parent, node, ref)     # Move existing node before ref

# --- Scroll ---
scrollToTop()
```

### Event Listeners on Elements

Before the WebApp can receive events, register the element:

```nim
addClickListener(btn)       # Enable click events for this element
addInputListener(input)     # Enable input events
addChangeListener(select)   # Enable change events
addKeydownListener(textarea) # Enable keydown events
```

### Fullscreen and Pointer Lock

```nim
requestFullscreen(elem)       # Make element fullscreen
requestPointerLock(elem)      # Lock pointer to element (games)
```

### DOM Event Types (Low-Level)

If not using `bindwebevents`, parse events manually:

```nim
var ev: PollEvent
while pollEvent(ev):
  case ev.opcode:
  of 0x01:
    let click = parseClickEvent(ev.data, ev.len)
    echo "Clicked element: ", click.handle.int32
  of 0x02:
    let inp = parseInputEvent(ev.data, ev.len)
    echo "Input on ", inp.handle.int32, " value: ", inp.value
  of 0x03:
    let chg = parseChangeEvent(ev.data, ev.len)
    echo "Change on ", chg.handle.int32, " value: ", chg.value
```

---

## Canvas API (`apis/canvas`)

### Setup

```nim
import apis/canvas

proc main() =
  let body = getBody()
  let canvas = createCanvas("my-canvas", 600.0, 400.0)  # id, width, height
  appendChild(body, canvas)

  let ctx = getContext2d(canvas)  # Get 2D context
  # ... draw commands ...
  flush()
```

### Drawing Shapes

```nim
# --- Rectangles ---
setFillStyle(ctx, 100, 200, 255)       # RGB color
fillRect(ctx, 10.0, 10.0, 100.0, 50.0)  # x, y, w, h
clearRect(ctx, 20.0, 20.0, 30.0, 30.0)
setStrokeStyle(ctx, 255, 0, 0)
strokeRect(ctx, 5.0, 5.0, 90.0, 40.0)

# --- Paths ---
beginPath(ctx)
moveTo(ctx, 50.0, 50.0)
lineTo(ctx, 150.0, 100.0)
lineTo(ctx, 50.0, 150.0)
closePath(ctx)
setStrokeStyleStr(ctx, "#00FF00")
stroke(ctx)
setFillStyleStr(ctx, "rgba(0,0,255,0.3)")
fill(ctx)

# --- Circles and arcs ---
beginPath(ctx)
arc(ctx, 100.0, 100.0, 30.0, 0.0, 6.28318)  # x, y, radius, start, end
fill(ctx)

# --- Text ---
setFont(ctx, "20px Arial")
setFillStyle(ctx, 255, 255, 255)
fillText(ctx, "Hello Canvas!", 50.0, 30.0)
```

### Colors (Two Styles)

```nim
# RGB integers (0-255)
setFillStyle(ctx, 255, 128, 0)       # Orange
setStrokeStyle(ctx, 0, 0, 255)       # Blue

# CSS strings
setFillStyleStr(ctx, "#FF8000")
setFillStyleStr(ctx, "rgba(255,0,0,0.5)")
setFillStyleStr(ctx, "hsl(120, 100%, 50%)")
setStrokeStyleStr(ctx, "red")
```

### Transformations

```nim
save(ctx)                              # Save current state
translate(ctx, 100.0, 50.0)            # Move origin
rotate(ctx, 0.5)                       # Rotate radians
scale(ctx, 2.0, 0.5)                   # Scale x, y
restore(ctx)                           # Restore saved state
resetTransform(ctx)                    # Reset all transforms
```

### Styling

```nim
setLineWidth(ctx, 2.0)
setLineCap(ctx, "round")               # "butt", "round", "square"
setLineJoin(ctx, "bevel")              # "miter", "round", "bevel"
setMiterLimit(ctx, 10.0)
setGlobalAlpha(ctx, 0.5)               # 0.0 to 1.0
setShadow(ctx, 10.0, 5.0, 5.0, "rgba(0,0,0,0.5)")  # blur, offX, offY, color
setFont(ctx, "16px 'Courier New'")
setTextAlign(ctx, "center")            # "start", "end", "left", "right", "center"
setTextBaseline(ctx, "middle")         # "top", "hanging", "middle", "alphabetic", "bottom"
setGlobalCompositeOperation(ctx, "source-over")  # "multiply", "screen", "overlay", etc.
```

### Animation with `setMainLoop`

```nim
var rotation = 0.0

proc update(timeMs: float64) =
  setFillStyle(ctx, 20, 20, 35)
  fillRect(ctx, 0, 0, 600, 400)

  save(ctx)
  translate(ctx, 300.0, 200.0)
  rotate(ctx, rotation)
  setFillStyle(ctx, 100, 200, 255)
  fillRect(ctx, -50.0, -50.0, 100.0, 100.0)
  restore(ctx)

  rotation += 0.02
  flush()

proc main() =
  let body = getBody()
  let canvas = createCanvas("anim-canvas", 600.0, 400.0)
  appendChild(body, canvas)
  let ctx = getContext2d(canvas)
  setMainLoop(update)
  flush()

main()
```

---

## Input API (`apis/input`)

### Mouse

```nim
# Initialize mouse on a canvas element
initMouse(canvas)

# Then handle events via WebApp:
app.onMouseDown = proc(ev: MouseDownEvent) =
  echo "Button ", ev.button, " pressed at (", ev.x, ", ", ev.y, ")"

app.onMouseUp = proc(ev: MouseUpEvent) =
  echo "Button ", ev.button, " released"

app.onMouseMove = proc(ev: MouseMoveEvent) =
  echo "Mouse at (", ev.x, ", ", ev.y, ")"
```

### Keyboard

```nim
# Initialize keyboard (global)
initKeyboard()

# Then handle events via WebApp:
app.onKeyDown = proc(ev: KeyDownEvent) =
  echo "Key pressed: code=", ev.key_code
  if ev.key_code == 32:    # Space
    echo "Space!"
  elif ev.key_code == 13:  # Enter
    echo "Enter!"

app.onKeyUp = proc(ev: KeyUpEvent) =
  echo "Key released: code=", ev.key_code
```

### Exit Pointer Lock

```nim
exitPointerLock()
```

---

## System API (`apis/system`)

### Logging

```nim
log("Hello from Nim!")     # Console log
warn("This is a warning")   # Console warn
error("Something broke")    # Console error
```

### Page Control

```nim
setTitle("My App Title")
reload()                   # Reload the page
openUrl("https://example.com")
pushState("/new-path")     # Update URL without reload
```

### Time

```nim
let t = getTime()          # High-res timestamp (seconds)
let d = getDateNow()       # Unix timestamp (ms)
```

### URL Info

```nim
let path = getPathname()         # "/my/page"
let search = getSearch()         # "?q=test&page=2"
let q = getQueryParam("q")       # "test"
let vis = getVisibilityState()   # "visible" or "hidden"
let hidden = isHidden()          # 0 or 1
```

### Browser Events

```nim
# Initialize (call before using WebApp callbacks)
initPopstate()           # Enable onPopstate callback
initVisibilityChange()   # Enable onVisibilityChange callback
```

### Low-Level Main Loop

If not using `bindwebevents`, use `setMainLoop` directly:

```nim
proc update(timeMs: float64) =
  # Your frame code here
  flush()

setMainLoop(update)
flush()
```

---

## Handle Types (`apis/handles`)

All DOM/Canvas/WebGL objects are referenced by typed handles (distinct `int32` for type safety):

| Handle Type | Use For |
|-------------|---------|
| `DOMElementHandle` | Any DOM element (div, span, button, etc.) |
| `CanvasHandle` | Canvas element (extends DOMElementHandle) |
| `CanvasContext2DHandle` | Canvas 2D rendering context |
| `WebGLContextHandle` | WebGL context |
| `ImageHandle` | Image element (extends DOMElementHandle) |
| `AudioHandle` | Audio element (extends DOMElementHandle) |
| `WebSocketHandle` | WebSocket connection |
| `FetchRequestHandle` | HTTP fetch request |

### Handle Operations

```nim
let h = createElement("div")
if h.isValid:                      # Check if handle is valid
  echo h.toInt32                   # Get raw int32 value
```

---

## Complete Examples

### 1. Creating a Form with Input Handling

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/input, apis/system

proc main() =
  let body = getBody()

  # Container
  let form = createElement("div")
  setAttribute(form, "style", "padding: 24px; max-width: 400px; margin: 0 auto; font-family: sans-serif;")
  appendChild(body, form)

  # Title
  let title = createElement("h2")
  setInnerText(title, "Sign Up Form")
  appendChild(form, title)

  # Name input
  let nameLabel = createElement("label")
  setInnerText(nameLabel, "Name: ")
  appendChild(form, nameLabel)

  let nameInput = createElement("input")
  setAttribute(nameInput, "placeholder", "Enter your name")
  setAttribute(nameInput, "style", "padding: 8px; margin: 8px 0; width: 100%;")
  appendChild(form, nameInput)
  addInputListener(nameInput)   # Register for input events

  # Result display
  let result = createElement("div")
  setAttribute(result, "style", "margin-top: 16px; padding: 12px; background: #f0f0f0; border-radius: 4px;")
  setInnerText(result, "Type something...")
  appendChild(form, result)

  # Submit button
  let submitBtn = createElement("button")
  setInnerText(submitBtn, "Submit")
  setAttribute(submitBtn, "style", "padding: 10px 20px; margin-top: 12px; cursor: pointer;")
  appendChild(form, submitBtn)
  addClickListener(submitBtn)

  flush()

  # --- Handle events ---
  let app = newWebApp()

  app.onInput = proc(ev: InputEvent) =
    setInnerText(result, "You typed: " & ev.value)
    flush()

  app.onClick = proc(ev: ClickEvent) =
    setInnerText(result, "Form submitted!")
    setAttribute(result, "style", "margin-top: 16px; padding: 12px; background: #d4edda; border-radius: 4px; color: #155724;")
    flush()

  app.run()

main()
```

### 2. Dynamic List - Adding and Removing Elements

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/system

proc main() =
  let body = getBody()

  let container = createElement("div")
  setAttribute(container, "style", "padding: 24px; font-family: sans-serif;")
  appendChild(body, container)

  let title = createElement("h2")
  setInnerText(title, "Dynamic Todo List")
  appendChild(container, title)

  # Add button
  let addBtn = createElement("button")
  setInnerText(addBtn, "Add Item")
  setAttribute(addBtn, "style", "padding: 8px 16px; cursor: pointer; margin-bottom: 12px;")
  appendChild(container, addBtn)
  addClickListener(addBtn)

  # List container
  let listDiv = createElement("div")
  appendChild(container, listDiv)

  flush()

  let app = newWebApp()
  var itemCount = 0

  app.onClick = proc(ev: ClickEvent) =
    itemCount += 1

    # Create new item
    let item = createElement("div")
    setAttribute(item, "style", "padding: 8px; margin: 4px 0; background: #f5f5f5; border-radius: 4px; display: flex; justify-content: space-between;")
    setInnerText(item, "Item #" & $itemCount)

    # Delete button for this item
    let delBtn = createElement("button")
    setInnerText(delBtn, "x")
    setAttribute(delBtn, "style", "cursor: pointer; color: red; border: none; background: none;")
    appendChild(item, delBtn)

    appendChild(listDiv, item)
    flush()

  app.run()

main()
```

### 3. Mouse Tracking with Canvas

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/canvas, apis/input, apis/system

var
  ctx: CanvasContext2DHandle
  mouseX = 300
  mouseY = 200
  isClicking = false

proc drawFrame() =
  # Clear
  setFillStyle(ctx, 15, 15, 25)
  fillRect(ctx, 0, 0, 600, 400)

  # Draw circle at mouse position
  beginPath(ctx)
  arc(ctx, float64(mouseX), float64(mouseY), 25.0, 0.0, 6.28318)
  if isClicking:
    setFillStyle(ctx, 255, 80, 80)
  else:
    setFillStyle(ctx, 80, 200, 255)
  fill(ctx)

  # Info text
  setFont(ctx, "14px monospace")
  setFillStyle(ctx, 255, 255, 255)
  fillText(ctx, "Mouse: (" & $mouseX & ", " & $mouseY & ")", 10.0, 20.0)
  if isClicking:
    fillText(ctx, "CLICKING!", 10.0, 45.0)

  flush()

proc main() =
  let body = getBody()

  let canvas = createCanvas("track-canvas", 600.0, 400.0)
  appendChild(body, canvas)

  ctx = getContext2d(canvas)
  initMouse(canvas)

  let app = newWebApp()

  app.onMouseMove = proc(ev: MouseMoveEvent) =
    mouseX = ev.x
    mouseY = ev.y

  app.onMouseDown = proc(ev: MouseDownEvent) =
    isClicking = true

  app.onMouseUp = proc(ev: MouseUpEvent) =
    isClicking = false

  setTitle("Mouse Tracker")
  app.webloop:
    drawFrame()

main()
```

### 4. Combined DOM + Canvas + Events

```nim
import bindweb, bindwebtypes, bindwebevents
import apis/handles, apis/dom, apis/canvas, apis/input, apis/system

var ctx: CanvasContext2DHandle

proc main() =
  let body = getBody()

  # --- Control panel (DOM) ---
  let panel = createElement("div")
  setAttribute(panel, "style", "padding: 16px; background: #1e1e1e; color: #fff; font-family: sans-serif;")
  appendChild(body, panel)

  let header = createElement("h3")
  setInnerText(header, "Canvas Controller")
  appendChild(panel, header)

  let colorBtn = createElement("button")
  setInnerText(colorBtn, "Random Color")
  setAttribute(colorBtn, "style", "padding: 8px 16px; margin-right: 8px; cursor: pointer;")
  appendChild(panel, colorBtn)
  addClickListener(colorBtn)

  let clearBtn = createElement("button")
  setInnerText(clearBtn, "Clear")
  setAttribute(clearBtn, "style", "padding: 8px 16px; cursor: pointer;")
  appendChild(panel, clearBtn)
  addClickListener(clearBtn)

  # --- Canvas ---
  let canvas = createCanvas("demo-canvas", 600.0, 400.0)
  appendChild(body, canvas)

  ctx = getContext2d(canvas)
  initMouse(canvas)

  setTitle("DOM + Canvas Demo")
  flush()

  # --- Event handling ---
  let app = newWebApp()
  var r = 100
  var g = 200
  var b = 255
  var mouseX = 0
  var mouseY = 0

  app.onClick = proc(ev: ClickEvent) =
    r = rand(256)
    g = rand(256)
    b = rand(256)

  app.onMouseMove = proc(ev: MouseMoveEvent) =
    mouseX = ev.x
    mouseY = ev.y

  app.webloop:
    setFillStyle(ctx, 20, 20, 30)
    fillRect(ctx, 0, 0, 600, 400)

    setFillStyle(ctx, uint8(r), uint8(g), uint8(b))
    fillRect(ctx, float64(mouseX - 25), float64(mouseY - 25), 50.0, 50.0)

    setFont(ctx, "14px sans-serif")
    setFillStyle(ctx, 255, 255, 255)
    fillText(ctx, "Move mouse. Click buttons to change color.", 10.0, 20.0)
    flush()

main()
```

---

## Quick Reference Card

### Must-Call Procedures

| Call | When |
|------|------|
| `flush()` | After building each frame of commands |
| `app.run()` | After setting up all WebApp callbacks |
| `addClickListener(elem)` | Before `onClick` will fire for that element |
| `addInputListener(elem)` | Before `onInput` will fire |
| `initMouse(canvas)` | Before `onMouseMove`/`onMouseDown` will fire |
| `initKeyboard()` | Before `onKeyDown`/`onKeyUp` will fire |

### Event Flow

```
User clicks button in browser
       |
       v
  JS detects click
       |
       v
  JS writes CLICK opcode + handle to event buffer (WASM memory)
       |
       v
  Nim's update() polls event buffer via pollEvent()
       |
       v
  WebApp.dispatch() routes to your onClick callback
       |
       v
  Your callback runs (modifies DOM, logs, etc.)
       |
       v
  Frame callback runs (draw code)
       |
       v
  flush() sends all commands back to JS
       |
       v
  JS executes commands, updates browser display
```

---

## Tips and Gotchas

1. **Always call `flush()`**: Nothing appears until you flush the command buffer.
2. **Register listeners**: `addClickListener(btn)` is required before `onClick` fires for that button.
3. **`div` is a Nim keyword**: Use `myDiv` or `divElem` as variable names, not `div`.
4. **Import `bindwebevents`**: The high-level event system is in a separate module.
5. **Use `webloop` for simple apps**: It combines `frameCallback =` and `run()` into one template.
6. **Handles are opaque**: They are distinct `int32` values. Use `.int32` to convert, `.isValid` to check.
7. **Color values are 0-255**: `setFillStyle(ctx, 255, 0, 0)` is red.
8. **Canvas coordinates are float64**: `fillRect(ctx, 10.0, 10.0, 100.0, 50.0)`.
9. **Event callbacks are nil by default**: Check `if app.onClick != nil` is done internally by `dispatch()`.
10. **`eventName()` is for debugging**: It returns a human-readable string like "Click" or "MouseMove".
