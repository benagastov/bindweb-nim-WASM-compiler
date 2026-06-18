## Core types for the WebCC WASM framework.
## Handle types, string views, and event primitives.

type
  ## Handle type -- distinct int32 for type safety.
  ## Each API module defines its own handle types (e.g., DOMElementHandle = distinct int32).
  Handle* = distinct int32

  ## StringView -- lightweight borrowed string referencing external memory.
  ## Used for reading strings from the event buffer without copying.
  StringView* = object
    data*: ptr char
    len*: uint32

  ## PollEvent -- raw event read from the event buffer.
  ## Use pollEvent() to get one. Check opcode, then parse with the appropriate parse function.
  PollEvent* = object
    opcode*: uint8
    data*: ptr uint8
    len*: uint32

const
  ## Invalid handle sentinel value.
  INVALID_HANDLE* = Handle(-1)

  ## Deferred handle starting value (avoids collision with JS-assigned handles).
  DEFERRED_HANDLE_START* = 0x100000'i32

# ------------------------------------------------------------------------------
# Handle operations
# ------------------------------------------------------------------------------

proc isValid*(h: Handle): bool {.inline.} =
  int32(h) != -1

proc `==`*(a, b: Handle): bool {.inline.} =
  int32(a) == int32(b)

proc `!=`*(a, b: Handle): bool {.inline.} =
  int32(a) != int32(b)

proc toInt32*(h: Handle): int32 {.inline.} =
  int32(h)

proc handle*(v: int32): Handle {.inline.} =
  Handle(v)

# ------------------------------------------------------------------------------
# Typed handle helpers (generic-ish via template)
# ------------------------------------------------------------------------------

# Distinct int32 types don't support generic converters easily,
# so each module defines its own inline constructors.
# This template helps:
template makeHandleType*(Name: untyped) =
  type Name* = distinct int32
  proc `==`*(a, b: Name): bool {.inline.} = int32(a) == int32(b)
  proc `!=`*(a, b: Name): bool {.inline.} = int32(a) != int32(b)
  proc toInt32*(h: Name): int32 {.inline.} = int32(h)
  proc isValid*(h: Name): bool {.inline.} = int32(h) != -1

# ------------------------------------------------------------------------------
# StringView helpers
# ------------------------------------------------------------------------------

proc toString*(sv: StringView): string {.inline.} =
  if sv.data == nil or sv.len == 0:
    return ""
  result = newString(sv.len)
  copyMem(addr result[0], sv.data, sv.len)

proc len*(sv: StringView): int {.inline.} =
  int(sv.len)
