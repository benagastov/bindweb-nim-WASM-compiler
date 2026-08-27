type
  ProgramCommandKind* = enum
    pckInsertText, pckSetStyle, pckPageBreak

  ProgramCommand* = object
    kind*: ProgramCommandKind
    text*, key*, value*: string

  CustomProgram* = object
    name*: string
    commands*: seq[ProgramCommand]

