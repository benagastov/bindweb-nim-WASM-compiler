import models

proc applyPlainTemplate*(doc: var Document; text: string; style: TextStyle) =
  let old = doc.plainText()
  doc.replaceFromPlainText(old, text, style)

