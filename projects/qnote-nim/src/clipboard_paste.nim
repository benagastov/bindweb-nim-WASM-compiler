import std/strutils
import models

proc normalizeClipboardText*(text: string): string =
  text.replace("\r\n", "\n").replace("\r", "\n")

proc clipboardElements*(doc: var Document; text: string;
                        style: TextStyle): seq[DocElement] =
  for ch in normalizeClipboardText(text):
    result.add(doc.makeChar($ch, style))
