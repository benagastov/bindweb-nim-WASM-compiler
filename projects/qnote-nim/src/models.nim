import std/[strutils, unicode]

type
  TextAlign* = enum
    taLeft, taCenter, taRight, taJustify

  HeadingKind* = enum
    hkNormal, hkTitle, hkHeading1, hkHeading2, hkHeading3

  TextStyle* = object
    bold*, italic*: bool
    color*, fillColor*, font*: string
    size*: float64
    align*: TextAlign
    heading*: HeadingKind

  ElementKind* = enum
    ekChar, ekPageBreak, ekImage, ekTable, ekMath, ekTextBox, ekDoodle

  DocElement* = object
    kind*: ElementKind
    text*: string
    style*: TextStyle
    id*: int

  Document* = object
    elements*: seq[DocElement]
    cursorIndex*: int
    selectionStart*, selectionEnd*: int
    revision*: int
    nextId*: int

proc defaultTextStyle*(): TextStyle =
  TextStyle(
    bold: false, italic: false, color: "#0f172a", fillColor: "",
    font: "Arial, sans-serif", size: 11.0, align: taLeft,
    heading: hkNormal
  )

proc initDocument*(): Document =
  result.selectionStart = -1
  result.selectionEnd = -1
  result.nextId = 1

proc makeChar*(doc: var Document; ch: string; style: TextStyle): DocElement =
  result = DocElement(kind: ekChar, text: ch, style: style, id: doc.nextId)
  inc doc.nextId

proc makePageBreak*(doc: var Document): DocElement =
  result = DocElement(kind: ekPageBreak, id: doc.nextId)
  inc doc.nextId

proc plainText*(doc: Document): string =
  for el in doc.elements:
    case el.kind
    of ekChar: result.add(el.text)
    of ekPageBreak: result.add('\n')
    else: discard

proc splitGlyphs*(text: string): seq[string] =
  for rune in text.toRunes:
    result.add($rune)

proc replaceFromPlainText*(doc: var Document; oldText, newText: string;
                           insertionStyle: TextStyle) =
  ## Retain element identities/styles in the unchanged prefix and suffix.
  ## This is the same incremental-state principle used by the JS editor.
  let oldRunes = splitGlyphs(oldText)
  let newRunes = splitGlyphs(newText)
  var prefix = 0
  while prefix < oldRunes.len and prefix < newRunes.len and
        oldRunes[prefix] == newRunes[prefix]:
    inc prefix
  var suffix = 0
  while suffix < oldRunes.len - prefix and suffix < newRunes.len - prefix and
        oldRunes[oldRunes.high - suffix] == newRunes[newRunes.high - suffix]:
    inc suffix

  var rebuilt: seq[DocElement]
  for i in 0..<min(prefix, doc.elements.len):
    rebuilt.add(doc.elements[i])
  for i in prefix..<(newRunes.len - suffix):
    rebuilt.add(doc.makeChar(newRunes[i], insertionStyle))
  if suffix > 0 and doc.elements.len >= suffix:
    for i in (doc.elements.len - suffix)..<doc.elements.len:
      rebuilt.add(doc.elements[i])
  doc.elements = rebuilt
  doc.cursorIndex = prefix + max(0, newRunes.len - prefix - suffix)
  inc doc.revision

proc fontCss*(style: TextStyle; zoom = 1.0): string =
  var prefix = ""
  if style.italic: prefix.add("italic ")
  if style.bold: prefix.add("bold ")
  let px = style.size * (96.0 / 72.0) * zoom
  result = prefix & formatFloat(px, ffDecimal, 2) & "px " & style.font

