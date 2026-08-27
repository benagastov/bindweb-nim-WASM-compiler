import bindweb
import apis/[canvas, handles]

type MathRenderer* = object

proc drawMathFallback*(renderer: MathRenderer; ctx: CanvasContext2DHandle;
                       latex: string; x, y: float64; color = "#0f172a") =
  ## BindWeb-compatible fallback. A future KaTeX bridge can replace this
  ## without changing worker/engine geometry contracts.
  setFont(ctx, "italic 16px Georgia")
  setFillStyleStr(ctx, color)
  fillText(ctx, latex, x, y)

proc measureMathFallback*(renderer: MathRenderer; ctx: CanvasContext2DHandle;
                          latex: string): float64 =
  setFont(ctx, "italic 16px Georgia")
  measureTextWidth(ctx, latex)

