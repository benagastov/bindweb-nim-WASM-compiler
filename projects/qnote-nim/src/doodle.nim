type
  DoodlePoint* = object
    x*, y*, pressure*: float32

  DoodleStroke* = object
    color*: string
    width*: float32
    points*: seq[DoodlePoint]

  DoodleLayer* = object
    id*, name*: string
    visible*: bool
    strokes*: seq[DoodleStroke]

  DoodleDocument* = object
    layers*: seq[DoodleLayer]

