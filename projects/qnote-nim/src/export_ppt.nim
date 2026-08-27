import models

type SlidePage* = object
  pageIndex*: int
  plainText*: string

proc collectSlidePages*(doc: Document): seq[SlidePage] =
  ## Keeps export independent from canvas painting. Binary PPTX packaging is
  ## intentionally a host-side adapter, as it was in export_ppt.js.
  result.add(SlidePage(pageIndex: 0, plainText: doc.plainText()))

