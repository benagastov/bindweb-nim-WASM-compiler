import std/[math]
import bindweb
import apis/[canvas, handles]
import config, models, worker, ruler

type
  Engine* = object
    canvas*: CanvasHandle
    ctx*: CanvasContext2DHandle
    viewportW*, viewportH*: float64
    zoom*, scrollY*: float64
    layout*: LayoutResult
    laidOutRevision*: int
    blinkOn*: bool
    lastBlinkMs*: float64

proc initEngine*(canvas: CanvasHandle; width, height: float64): Engine =
  result.canvas = canvas
  result.ctx = getContext2d(canvas)
  result.viewportW = width
  result.viewportH = height
  result.zoom = 0.78
  result.laidOutRevision = -1
  setTextBaseline(result.ctx, "alphabetic")

proc resize*(engine: var Engine; width, height: float64) =
  engine.viewportW = max(600.0, width)
  engine.viewportH = max(420.0, height)
  setSize(engine.canvas, engine.viewportW, engine.viewportH)

proc invalidate*(engine: var Engine) = engine.laidOutRevision = -1

proc ensureLayout*(engine: var Engine; doc: Document; cfg: EditorConfig) =
  if engine.laidOutRevision != doc.revision:
    engine.layout = layoutDocument(doc, cfg, engine.ctx, engine.zoom)
    engine.laidOutRevision = doc.revision

proc pageLeft(engine: Engine; page: PageLayout): float64 =
  max(32.0, (engine.viewportW - page.width) / 2.0)

proc drawPageChrome(engine: Engine; page: PageLayout; y: float64) =
  let x = engine.pageLeft(page)
  setShadow(engine.ctx, 14.0, 0.0, 4.0, "rgba(15,23,42,0.20)")
  setFillStyleStr(engine.ctx, "#ffffff")
  fillRect(engine.ctx, x, y, page.width, page.height)
  setShadow(engine.ctx, 0.0, 0.0, 0.0, "transparent")
  setStrokeStyleStr(engine.ctx, "#d8dee9")
  setLineWidth(engine.ctx, 1.0)
  strokeRect(engine.ctx, x + 0.5, y + 0.5, page.width - 1.0, page.height - 1.0)

proc drawGlyph(engine: Engine; glyph: GlyphLayout; pageX, pageY: float64) =
  let gx = pageX + glyph.x
  let gy = pageY + glyph.y
  if glyph.style.fillColor.len > 0:
    setFillStyleStr(engine.ctx, glyph.style.fillColor)
    fillRect(engine.ctx, gx, gy - glyph.h * 0.78, glyph.w, glyph.h)
  setFont(engine.ctx, fontCss(glyph.style, engine.zoom))
  setFillStyleStr(engine.ctx, glyph.style.color)
  fillText(engine.ctx, glyph.text, gx, gy)

proc cursorGeometry(engine: Engine; doc: Document): tuple[ok: bool, x, y, h: float64] =
  if engine.layout.pages.len == 0: return
  for page in engine.layout.pages:
    let px = engine.pageLeft(page)
    let py = 42.0 + page.top - engine.scrollY
    for line in page.lines:
      for glyph in line.glyphs:
        if glyph.sourceIndex == doc.cursorIndex:
          return (true, px + glyph.x, py + glyph.y - glyph.h * 0.78, glyph.h)
        if glyph.sourceIndex + 1 == doc.cursorIndex:
          return (true, px + glyph.x + glyph.w, py + glyph.y - glyph.h * 0.78, glyph.h)
  let first = engine.layout.pages[0]
  (true, engine.pageLeft(first) + 96.0 * engine.zoom,
   42.0 + 96.0 * engine.zoom - engine.scrollY, 20.0 * engine.zoom)

proc render*(engine: var Engine; doc: Document; cfg: EditorConfig; nowMs: float64) =
  engine.ensureLayout(doc, cfg)
  if nowMs - engine.lastBlinkMs > 520.0:
    engine.blinkOn = not engine.blinkOn
    engine.lastBlinkMs = nowMs
  setFillStyleStr(engine.ctx, "#e7eaf0")
  fillRect(engine.ctx, 0.0, 0.0, engine.viewportW, engine.viewportH)

  for page in engine.layout.pages:
    let py = 42.0 + page.top - engine.scrollY
    if py + page.height < 0 or py > engine.viewportH: continue
    engine.drawPageChrome(page, py)
    let px = engine.pageLeft(page)
    for line in page.lines:
      for glyph in line.glyphs:
        engine.drawGlyph(glyph, px, py)
    drawRuler(engine.ctx, cfg, px, py - 28.0, engine.zoom)

  if engine.blinkOn:
    let c = engine.cursorGeometry(doc)
    if c.ok:
      setStrokeStyleStr(engine.ctx, "#2563eb")
      setLineWidth(engine.ctx, 1.5)
      beginPath(engine.ctx)
      moveTo(engine.ctx, c.x, c.y)
      lineTo(engine.ctx, c.x, c.y + c.h)
      stroke(engine.ctx)
  flush()

proc scrollBy*(engine: var Engine; delta: float64) =
  let maxScroll = max(0.0, engine.layout.contentHeight + 84.0 - engine.viewportH)
  engine.scrollY = min(maxScroll, max(0.0, engine.scrollY + delta))

proc zoomBy*(engine: var Engine; delta: float64) =
  engine.zoom = min(2.0, max(0.35, engine.zoom + delta))
  engine.invalidate()

