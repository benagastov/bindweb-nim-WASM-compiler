import models

type
  Snapshot* = object
    elements*: seq[DocElement]
    cursorIndex*: int

  History* = object
    entries*: seq[Snapshot]
    index*: int
    capacity*: int

proc initHistory*(capacity = 100): History =
  History(index: -1, capacity: capacity)

proc cloneElements(items: seq[DocElement]): seq[DocElement] =
  for item in items: result.add(item)

proc pushSnapshot*(history: var History; doc: Document) =
  if history.index + 1 < history.entries.len:
    history.entries.setLen(history.index + 1)
  history.entries.add(Snapshot(elements: cloneElements(doc.elements),
                               cursorIndex: doc.cursorIndex))
  if history.entries.len > history.capacity:
    history.entries.delete(0)
  history.index = history.entries.high

proc restore(doc: var Document; snap: Snapshot) =
  doc.elements = cloneElements(snap.elements)
  doc.cursorIndex = snap.cursorIndex
  inc doc.revision

proc undo*(history: var History; doc: var Document): bool =
  if history.index <= 0: return false
  dec history.index
  doc.restore(history.entries[history.index])
  true

proc redo*(history: var History; doc: var Document): bool =
  if history.index + 1 >= history.entries.len: return false
  inc history.index
  doc.restore(history.entries[history.index])
  true

proc insertPageBreak*(doc: var Document) =
  let at = min(max(0, doc.cursorIndex), doc.elements.len)
  doc.elements.insert(doc.makePageBreak(), at)
  doc.cursorIndex = at + 1
  inc doc.revision

proc setStyleAll*(doc: var Document; style: TextStyle) =
  for el in doc.elements.mitems:
    if el.kind == ekChar: el.style = style
  inc doc.revision

