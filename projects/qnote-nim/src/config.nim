type
  PageSize* = enum
    psA4, psLetter, psLegal, psA5, psA6, psBlog

  PageOrientation* = enum
    poPortrait, poLandscape

  EditorConfig* = object
    pageWidth*, pageHeight*, pageGap*: float64
    marginTop*, marginBottom*, marginLeft*, marginRight*: float64
    lineHeightMult*, letterSpacing*: float64
    pageSize*: PageSize
    orientation*: PageOrientation
    continuousPage*: bool

proc pageDimensions*(size: PageSize): tuple[w, h: float64] =
  case size
  of psLetter: (816.0, 1056.0)
  of psLegal: (816.0, 1344.0)
  of psA4: (794.0, 1123.0)
  of psA5: (559.0, 794.0)
  of psA6: (397.0, 559.0)
  of psBlog: (816.0, 1123.0)

proc defaultConfig*(): EditorConfig =
  EditorConfig(
    pageWidth: 794.0, pageHeight: 1123.0, pageGap: 40.0,
    marginTop: 96.0, marginBottom: 96.0,
    marginLeft: 96.0, marginRight: 96.0,
    lineHeightMult: 1.6, letterSpacing: 0.0,
    pageSize: psA4, orientation: poPortrait, continuousPage: false
  )

proc applyPageLayout*(cfg: var EditorConfig; size: PageSize;
                      orientation: PageOrientation) =
  let d = pageDimensions(size)
  cfg.pageSize = size
  cfg.orientation = orientation
  cfg.continuousPage = size == psBlog
  cfg.pageGap = if cfg.continuousPage: 24.0 else: 40.0
  if orientation == poLandscape and not cfg.continuousPage:
    cfg.pageWidth = d.h
    cfg.pageHeight = d.w
  else:
    cfg.pageWidth = d.w
    cfg.pageHeight = d.h

