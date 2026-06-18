## Nim Bindweb Canvas Demo
## Ported from the C++ cnv demo.
## Creates a cnv, tracks mouse movement, and draws shapes.

import bindweb, bindwebtypes
import apis/handles, apis/canvas, apis/dom, apis/system, apis/input

var
  cnv: CanvasHandle
  ctx: CanvasContext2DHandle
  mouseX = 400
  mouseY = 300

# ------------------------------------------------------------------------------
# Main update function called every frame
# ------------------------------------------------------------------------------
proc update(timeMs: float64) =
  # Poll events
  var ev: PollEvent
  while pollEvent(ev):
    # We check the event opcode to determine the type
    # Input events have opcodes starting from the input namespace
    # For this demo we check against the mouse move event opcode
    # which we determine at runtime or use a known constant
    if ev.opcode == 0x0B:  # MOUSE_MOVE event opcode (may vary)
      let event = parseMouseMoveEvent(ev.data, ev.len)
      mouseX = event.x
      mouseY = event.y

  # Clear background (Blue)
  setFillStyle(ctx, 52, 152, 219)
  fillRect(ctx, 0, 0, 800, 600)

  # Draw circle at mouse position (Yellow)
  beginPath(ctx)
  arc(ctx, float64(mouseX), float64(mouseY), 50.0, 0.0, 6.28318)
  setFillStyle(ctx, 241, 196, 15)
  fill(ctx)

  # Draw text
  setFont(ctx, "30px Arial")
  setFillStyle(ctx, 255, 255, 255)
  fillText(ctx, "Move your mouse!", 280, 500)

  # Flush commands to JS
  flush()

# ------------------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------------------
proc main() =
  # Setup DOM
  let body = getBody()
  cnv = createCanvas("game-canvas", 800, 600)
  appendChild(body, cnv)

  # Get 2D context
  ctx = getContext2d(cnv)

  # Initialize mouse input on the cnv
  # (CanvasHandle converts to DOMElementHandle via converter)
  initMouse(cnv)

  # Start the main loop
  setMainLoop(update)

  # Flush initial commands
  flush()

main()
