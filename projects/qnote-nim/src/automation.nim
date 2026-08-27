import models, commands

const AutomationApiVersion* = "1.0.0-nim"

proc insertText*(doc: var Document; text: string; style: TextStyle) =
  let old = doc.plainText()
  doc.replaceFromPlainText(old, old & text, style)

