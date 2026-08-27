type
  ObjectRef* = object
    path*: seq[int]
    index*: int

  ObjectSelection* = object
    members*: seq[ObjectRef]

proc clearSelection*(s: var ObjectSelection) = s.members.setLen(0)

proc selectObject*(s: var ObjectSelection; item: ObjectRef; additive = false) =
  if not additive: s.clearSelection()
  s.members.add(item)

proc hasMultiSelection*(s: ObjectSelection): bool = s.members.len > 1

