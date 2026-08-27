type ZoomState* = object
  logical*, physical*: float64

proc initZoom*(): ZoomState = ZoomState(logical: 0.78, physical: 1.0)

proc changeZoom*(z: var ZoomState; delta: float64) =
  z.logical = min(2.0, max(0.35, z.logical + delta))

