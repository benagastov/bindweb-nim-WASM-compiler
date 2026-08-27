import std/strutils

const FontVariants* = ["regular", "bold", "italic", "bolditalic"]

proc normalizeFontFamily*(family: string): string =
  let key = family.toLowerAscii()
  if "roboto" in key: "'Roboto', sans-serif"
  elif "courier" in key: "'Courier New', monospace"
  elif "georgia" in key: "Georgia, serif"
  elif "trebuchet" in key: "'Trebuchet MS', sans-serif"
  else: "Arial, sans-serif"

