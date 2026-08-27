# QNote Nim/WASM port

This project ports QNote's browser editor core from JavaScript to typed Nim and
builds it with `benagastov/bindweb-nim-WASM-compiler`.

## Rendering architecture

The original rendering principle is preserved:

1. `models.nim` owns document elements and styles.
2. `worker.nim` measures text and produces immutable, cached page/line/glyph
   geometry. It does not paint.
3. `engine.nim` paints that geometry with Canvas 2D, including page chrome,
   margins, ruler, text backgrounds, cursor, zoom and scrolling.
4. `bindEvents.nim` owns the DOM shell and event wiring; `main.nim` coordinates
   state, commands, layout invalidation and animation frames.

The WASM build tested in the BindWeb IDE produced `app.wasm` at 2,444,192 bytes
and executed `_start()` successfully. Canvas text layout was smoke-tested with
140 document elements.

## Build with BindWeb

1. Open the BindWeb Nim/WASM IDE.
2. Put every file under `src/` into the Project folder, preserving subfolders.
3. Keep `main.nim` at the project root.
4. Press **Build**. The generated Site folder contains `app.wasm`, `index.html`
   and `nim-runtime/`.

## Implemented editor surface

- Unicode-aware incremental text model and style retention
- A4/Letter/Legal/A5/A6/Blog page configuration
- Canvas 2D paged layout using real `measureText` metrics
- Margins, line wrapping, alignment, ruler, cursor, scrolling and zoom
- Bold, italic, font size, paragraph alignment and page breaks
- Undo/redo snapshots and browser-local save serialization
- Typed compatibility modules matching the original JavaScript filenames

The original Python DOCX converters are format adapters rather than renderer
code and remain outside the WASM module. Advanced object editing (tables,
floating images, doodle UI, KaTeX, QOChart and PPTX binary export) has typed
module boundaries in this port but still needs its browser/host adapter filled
in for full feature parity.

