import bindweb
import apis/[dom, handles, canvas, input]

type
  UiHandles* = object
    root*, toolbar*, textInput*, status*: DOMElementHandle
    btnBold*, btnItalic*, btnUndo*, btnRedo*, btnSave*: DOMElementHandle
    btnPageBreak*, btnZoomIn*, btnZoomOut*: DOMElementHandle
    fontSize*, alignment*: DOMElementHandle
    canvas*: CanvasHandle

const EditorShell* = """
<style>
  * { box-sizing: border-box; }
  html, body, #app { margin: 0; min-height: 100%; }
  body { overflow: hidden; background: #e7eaf0; color: #172033;
         font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
  #qnote-root { height: 100vh; display: grid; grid-template-rows: 50px 62px 1fr 28px; }
  #qnote-toolbar { display: flex; align-items: center; gap: 6px; padding: 7px 12px;
    background: #fff; border-bottom: 1px solid #d9deea; box-shadow: 0 1px 4px rgba(15,23,42,.06); }
  #qnote-toolbar button, #qnote-toolbar select { height: 34px; border: 1px solid #d5dae5;
    border-radius: 7px; background: #fff; color: #1e293b; padding: 0 10px; font: inherit; }
  #qnote-toolbar button:hover { background: #f1f5f9; }
  #qnote-toolbar button.active { color: #1d4ed8; background: #dbeafe; border-color: #93c5fd; }
  #qnote-toolbar .sep { width: 1px; height: 24px; background: #d9deea; margin: 0 3px; }
  #qnote-input-wrap { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center;
    padding: 8px 14px; background: #f8fafc; border-bottom: 1px solid #d9deea; }
  #qnote-input-wrap label { color: #64748b; font-size: 12px; font-weight: 650; }
  #qnote-text-input { width: 100%; min-height: 42px; max-height: 48px; resize: none;
    border: 1px solid #cbd5e1; border-radius: 8px; padding: 9px 11px; outline: none;
    font: 14px/1.5 Arial, sans-serif; background: white; }
  #qnote-text-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.13); }
  #qnote-canvas-stage { min-height: 0; overflow: hidden; display: grid; place-items: stretch; }
  #qnote-canvas { width: 100%; height: 100%; display: block; outline: none; }
  #qnote-status { background: #0f172a; color: #cbd5e1; display: flex; align-items: center;
    justify-content: space-between; padding: 0 12px; font-size: 11px; }
  .brand { font-weight: 800; color: #0f172a; margin-right: 8px; letter-spacing: -.02em; }
</style>
<div id="qnote-root">
  <div id="qnote-toolbar">
    <span class="brand">QNote · Nim/WASM</span>
    <button id="btn-undo" title="Undo">↶</button><button id="btn-redo" title="Redo">↷</button>
    <span class="sep"></span>
    <button id="btn-bold" title="Bold"><b>B</b></button><button id="btn-italic" title="Italic"><i>I</i></button>
    <select id="font-size" aria-label="Font size">
      <option value="9">9</option><option value="10">10</option><option value="11" selected>11</option>
      <option value="12">12</option><option value="14">14</option><option value="18">18</option>
      <option value="24">24</option><option value="32">32</option>
    </select>
    <select id="alignment" aria-label="Alignment">
      <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
    </select>
    <span class="sep"></span>
    <button id="btn-page-break">Page break</button>
    <button id="btn-zoom-out">−</button><button id="btn-zoom-in">＋</button>
    <span class="sep"></span><button id="btn-save">Save</button>
  </div>
  <div id="qnote-input-wrap"><label for="qnote-text-input">TYPE / PASTE</label>
    <textarea id="qnote-text-input" spellcheck="true" placeholder="Type here; the Nim layout engine renders the document below…"></textarea>
  </div>
  <div id="qnote-canvas-stage"></div>
  <div id="qnote-status"><span id="qnote-status-text">Ready · Nim WASM</span><span>Canvas 2D · cached page layout</span></div>
</div>
"""

proc setupUi*(width = 1280.0; height = 720.0): UiHandles =
  result.root = getElementById("app")
  setInnerHtml(result.root, EditorShell)
  flush()
  result.toolbar = getElementById("qnote-toolbar")
  result.textInput = getElementById("qnote-text-input")
  result.status = getElementById("qnote-status-text")
  result.btnBold = getElementById("btn-bold")
  result.btnItalic = getElementById("btn-italic")
  result.btnUndo = getElementById("btn-undo")
  result.btnRedo = getElementById("btn-redo")
  result.btnSave = getElementById("btn-save")
  result.btnPageBreak = getElementById("btn-page-break")
  result.btnZoomIn = getElementById("btn-zoom-in")
  result.btnZoomOut = getElementById("btn-zoom-out")
  result.fontSize = getElementById("font-size")
  result.alignment = getElementById("alignment")
  result.canvas = createCanvas("qnote-canvas", width, height)
  appendChild(getElementById("qnote-canvas-stage"), result.canvas)
  for h in [result.btnBold, result.btnItalic, result.btnUndo, result.btnRedo,
            result.btnSave, result.btnPageBreak, result.btnZoomIn, result.btnZoomOut]:
    addClickListener(h)
  addInputListener(result.textInput)
  addChangeListener(result.fontSize)
  addChangeListener(result.alignment)
  initMouse(result.canvas)
  initMouseWheel(result.canvas)
  initResize()
  flush()

proc setStatus*(ui: UiHandles; text: string) =
  setInnerText(ui.status, text)

proc setButtonActive*(handle: DOMElementHandle; active: bool) =
  if active: addClass(handle, "active")
  else: removeClass(handle, "active")

