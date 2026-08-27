import std/strutils

type MathEditorState* = object
  latex*: string
  cursor*: int

proc insertCode*(state: var MathEditorState; code: string) =
  let at = min(max(0, state.cursor), state.latex.len)
  state.latex.insert(code, at)
  state.cursor = at + code.len
