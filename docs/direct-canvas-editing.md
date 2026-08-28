# Direct canvas rich-text input

BindWeb applications that render a rich editor directly into a canvas can opt
into the focused-editor keyboard path by setting:

```html
<canvas data-bindweb-direct-editor="true" tabindex="0"></canvas>
```

For compatibility, an element with id `qnote-canvas` opts in automatically.
Mouse-down focuses the canvas without scrolling. Keyboard and paste input are
then forwarded through the existing `KEY_DOWN` / `KEY_UP` int32 event ABI.

## Packed key values

- Unicode characters use their Unicode code point.
- Editing/navigation keys use `0x110001` through `0x11000b`.
- Modifier flags are ORed into the value: Ctrl `0x200000`, Shift
  `0x400000`, Alt `0x800000`, Meta `0x1000000`.

A toolbar can preserve editor focus by adding
`data-bindweb-preserve-editor-focus`. QNote's historical
`#toolbar-container` is also supported.

Applications without an opted-in canvas retain the original window-level
`keyCode` behavior.
