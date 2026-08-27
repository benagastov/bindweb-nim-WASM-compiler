import std/strutils

type QOChartSource* = object
  xml*, name*, diagramId*: string

proc isQOChart*(source: string): bool =
  "<mxGraphModel" in source or "<qochart" in source
