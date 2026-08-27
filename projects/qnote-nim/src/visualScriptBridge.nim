type
  VisualScriptMessageKind* = enum
    vsmOpenDiagram, vsmListInputs, vsmRun, vsmRunAll

  VisualScriptMessage* = object
    kind*: VisualScriptMessageKind
    path*, inputId*, nonce*: string

