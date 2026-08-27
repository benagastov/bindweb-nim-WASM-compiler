import std/[strutils]
import bindweb, bindwebtypes, bindwebevents
import apis/[dom, input, system, handles]
import config, models, commands, engine, saving, bindEvents

var
  cfg = defaultConfig()
  doc = initDocument()
  history = initHistory()
  currentStyle = defaultTextStyle()
  lastInput = ""
  ui: UiHandles
  renderer: Engine

proc syncInput() =
  lastInput = doc.plainText()
  setProperty(ui.textInput, "value", lastInput)
  ui.setStatus("Ready · " & $doc.elements.len & " elements · revision " & $doc.revision)
  renderer.invalidate()

proc handleInput(ev: dom.InputEvent) =
  if ev.handle != ui.textInput: return
  doc.replaceFromPlainText(lastInput, ev.value, currentStyle)
  lastInput = ev.value
  history.pushSnapshot(doc)
  renderer.invalidate()
  ui.setStatus("Editing · " & $doc.elements.len & " elements")

proc handleChange(ev: dom.ChangeEvent) =
  if ev.handle == ui.fontSize:
    try: currentStyle.size = parseFloat(ev.value)
    except ValueError: discard
  elif ev.handle == ui.alignment:
    case ev.value
    of "center": currentStyle.align = taCenter
    of "right": currentStyle.align = taRight
    else: currentStyle.align = taLeft
  doc.setStyleAll(currentStyle)
  history.pushSnapshot(doc)
  renderer.invalidate()

proc handleClick(ev: dom.ClickEvent) =
  if ev.handle == ui.btnBold:
    currentStyle.bold = not currentStyle.bold
    setButtonActive(ui.btnBold, currentStyle.bold)
    doc.setStyleAll(currentStyle)
  elif ev.handle == ui.btnItalic:
    currentStyle.italic = not currentStyle.italic
    setButtonActive(ui.btnItalic, currentStyle.italic)
    doc.setStyleAll(currentStyle)
  elif ev.handle == ui.btnUndo:
    if history.undo(doc): syncInput()
  elif ev.handle == ui.btnRedo:
    if history.redo(doc): syncInput()
  elif ev.handle == ui.btnSave:
    saveLocal(doc)
    ui.setStatus("Saved locally · QNOTE-NIM v1")
  elif ev.handle == ui.btnPageBreak:
    doc.insertPageBreak()
    history.pushSnapshot(doc)
    syncInput()
  elif ev.handle == ui.btnZoomIn:
    renderer.zoomBy(0.10)
  elif ev.handle == ui.btnZoomOut:
    renderer.zoomBy(-0.10)
  flush()

proc handleWheel(ev: input.MouseWheelEvent) =
  renderer.scrollBy(float64(ev.deltaY))

proc handleResize(ev: input.ResizeEvent) =
  renderer.resize(float64(ev.width), max(420.0, float64(ev.height) - 140.0))

proc main() =
  setTitle("QNote · Nim WebAssembly")
  ui = setupUi()
  renderer = initEngine(ui.canvas, 1280.0, 720.0)
  history.pushSnapshot(doc)
  let app = newWebApp()
  app.onInput = handleInput
  app.onChange = handleChange
  app.onClick = handleClick
  app.onMouseWheel = handleWheel
  app.onResize = handleResize
  app.webloop:
    renderer.render(doc, cfg, getTime())

main()

