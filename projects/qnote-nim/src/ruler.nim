import bindweb
import apis/[canvas, handles]
import config

proc drawRuler*(ctx: CanvasContext2DHandle; cfg: EditorConfig;
                pageX, y, zoom: float64) =
  let width = cfg.pageWidth * zoom
  setFillStyleStr(ctx, "#f8fafc")
  fillRect(ctx, pageX, y, width, 24.0)
  setStrokeStyleStr(ctx, "#cbd5e1")
  setLineWidth(ctx, 1.0)
  beginPath(ctx)
  moveTo(ctx, pageX, y + 23.5)
  lineTo(ctx, pageX + width, y + 23.5)
  stroke(ctx)
  var inch = 0
  var x = pageX
  while x <= pageX + width:
    let major = inch mod 4 == 0
    beginPath(ctx)
    moveTo(ctx, x, y + (if major: 11.0 else: 16.0))
    lineTo(ctx, x, y + 23.0)
    stroke(ctx)
    if major:
      setFont(ctx, "10px Arial")
      setFillStyleStr(ctx, "#64748b")
      fillText(ctx, $(inch div 4), x + 3.0, y + 10.0)
    x += 24.0 * zoom
    inc inch

