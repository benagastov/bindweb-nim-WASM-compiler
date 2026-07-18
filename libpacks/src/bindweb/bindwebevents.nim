## WebCCEvents - High-level event system for WebCC-Nim
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
    ## All event types across all WebCC namespaces.
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
