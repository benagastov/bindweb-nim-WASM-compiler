import std/[strutils]
import bindweb
import apis/storage
import models

const StorageKey* = "qnote-nim-autosave-v1"

proc escapeText(s: string): string =
  s.replace("\\", "\\\\").replace("\n", "\\n").replace("\t", "\\t")

proc serializeDoc*(doc: Document): string =
  ## Compact line format; intentionally independent of the renderer.
  result.add("QNOTE-NIM\t1\n")
  for el in doc.elements:
    case el.kind
    of ekChar:
      result.add("C\t" & escapeText(el.text) & "\t" & $el.style.size & "\t" &
        $(if el.style.bold: 1 else: 0) & "\t" &
        $(if el.style.italic: 1 else: 0) & "\t" & el.style.color & "\t" &
        el.style.font & "\n")
    of ekPageBreak: result.add("P\n")
    else: discard

proc saveLocal*(doc: Document) =
  setItem(StorageKey, serializeDoc(doc))
  flush()

