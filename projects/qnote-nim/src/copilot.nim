type
  CopilotEditKind* = enum
    cekInsert, cekReplace, cekDelete

  CopilotEdit* = object
    kind*: CopilotEditKind
    startIndex*, endIndex*: int
    content*: string

proc validateCopilotEdit*(edit: CopilotEdit; documentLength: int): bool =
  edit.startIndex >= 0 and edit.endIndex >= edit.startIndex and
    edit.endIndex <= documentLength

