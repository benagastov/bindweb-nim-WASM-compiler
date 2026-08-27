type
  ObjectPaneState* = object
    selectedId*: int
    visible*: bool

proc selectForPane*(state: var ObjectPaneState; id: int) =
  state.selectedId = id
  state.visible = id != 0

