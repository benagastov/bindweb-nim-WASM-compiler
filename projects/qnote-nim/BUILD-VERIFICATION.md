# Build verification

- Compiler: `benagastov/bindweb-nim-WASM-compiler` public browser IDE
- Nim translation: succeeded, 30 translation units
- Clang/WASM link: succeeded
- Output: `app.wasm`, 2,444,192 bytes
- Runtime: WASM instance created; `_start()` executed; trailing BindWeb
  commands flushed
- Smoke test: entered two paragraphs / 140 document elements; Canvas 2D page,
  text, margins and ruler rendered correctly

Warnings were limited to unused imports in BindWeb-generated APIs and do not
affect the output.

