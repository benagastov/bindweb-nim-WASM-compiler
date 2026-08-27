import std/[math]
import bindweb
import apis/[canvas, handles]
import config, models

type
  GlyphLayout* = object
    sourceIndex*: int
    text*: string
    style*: TextStyle
    x*, y*, w*, h*: float64

  LineLayout* = object
    glyphs*: seq[GlyphLayout]
    x*, y*, width*, height*: float64
    align*: TextAlign

  PageLayout* = object
    index*: int
    lines*: seq[LineLayout]
    top*, width*, height*: float64

  LayoutResult* = object
    revision*: int
    pages*: seq[PageLayout]
    contentHeight*: float64

proc styleLineHeight(style: TextStyle; cfg: EditorConfig; zoom: float64): float64 =
  max(18.0 * zoom, style.size * (96.0 / 72.0) * cfg.lineHeightMult * zoom)

proc alignLine(line: var LineLayout; contentWidth: float64; left: float64) =
  var shift = 0.0
  case line.align
  of taCenter: shift = max(0.0, (contentWidth - line.width) / 2.0)
  of taRight: shift = max(0.0, contentWidth - line.width)
  else: discard
  if shift != 0:
    for glyph in line.glyphs.mitems:
      glyph.x += shift
    line.x = left + shift

proc layoutDocument*(doc: Document; cfg: EditorConfig;
                     ctx: CanvasContext2DHandle; zoom = 1.0): LayoutResult =
  ## Typed replacement for worker.js. It produces immutable page geometry;
  ## engine.nim alone paints that geometry.
  var layout = LayoutResult(revision: doc.revision)
  let pageW = cfg.pageWidth * zoom
  let pageH = cfg.pageHeight * zoom
  let marginL = cfg.marginLeft * zoom
  let marginR = cfg.marginRight * zoom
  let marginT = cfg.marginTop * zoom
  let marginB = cfg.marginBottom * zoom
  let contentW = pageW - marginL - marginR
  let contentBottom = pageH - marginB
  var page = PageLayout(index: 0, top: 0.0, width: pageW, height: pageH)
  var line = LineLayout(x: marginL, y: marginT,
                        height: styleLineHeight(defaultTextStyle(), cfg, zoom),
                        align: taLeft)
  var cursorX = marginL
  var baselineY = marginT + line.height * 0.78

  proc finishLine() =
    line.width = max(0.0, cursorX - marginL)
    line.y = baselineY
    line.alignLine(contentW, marginL)
    page.lines.add(line)
    baselineY += line.height
    line = LineLayout(x: marginL, y: baselineY,
                      height: styleLineHeight(defaultTextStyle(), cfg, zoom),
                      align: taLeft)
    cursorX = marginL

  proc finishPage(force = false) =
    if line.glyphs.len > 0 or force:
      finishLine()
    layout.pages.add(page)
    page = PageLayout(index: layout.pages.len,
      top: float64(layout.pages.len) * (pageH + cfg.pageGap * zoom),
      width: pageW, height: pageH)
    baselineY = marginT + styleLineHeight(defaultTextStyle(), cfg, zoom) * 0.78
    line = LineLayout(x: marginL, y: baselineY,
                      height: styleLineHeight(defaultTextStyle(), cfg, zoom),
                      align: taLeft)
    cursorX = marginL

  if doc.elements.len == 0:
    finishPage(true)
  else:
    for i, el in doc.elements:
      if el.kind == ekPageBreak:
        finishPage(line.glyphs.len > 0)
        continue
      if el.kind != ekChar: continue
      let lh = styleLineHeight(el.style, cfg, zoom)
      line.height = max(line.height, lh)
      if line.glyphs.len == 0: line.align = el.style.align
      if el.text == "\n":
        finishLine()
        if baselineY + line.height > contentBottom: finishPage()
        continue
      setFont(ctx, fontCss(el.style, zoom))
      let advance = measureTextWidth(ctx, el.text) + cfg.letterSpacing * zoom
      if cursorX + advance > marginL + contentW and line.glyphs.len > 0:
        finishLine()
        if baselineY + line.height > contentBottom: finishPage()
      line.glyphs.add(GlyphLayout(
        sourceIndex: i, text: el.text, style: el.style,
        x: cursorX, y: baselineY, w: advance, h: lh
      ))
      cursorX += advance
      if baselineY + line.height > contentBottom: finishPage()
    if page.lines.len > 0 or line.glyphs.len > 0:
      finishPage(line.glyphs.len > 0)
  if layout.pages.len == 0:
    layout.pages.add(PageLayout(index: 0, top: 0.0, width: pageW, height: pageH))
  layout.contentHeight = layout.pages[^1].top + layout.pages[^1].height
  result = layout
