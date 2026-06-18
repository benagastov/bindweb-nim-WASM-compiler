## Basic tests for the WebCC Nim + C WASM library

import std/[unittest, tables]
import ../src/nim/bindwebtypes
import ../src/nim/bindweb
import ../src/nim/bindwebschema

# ------------------------------------------------------------------------------
# Test handle types
# ------------------------------------------------------------------------------
suite "Handle types":
  test "Handle creation and comparison":
    let h1 = Handle(42)
    let h2 = Handle(42)
    let h3 = Handle(100)

    check h1 == h2
    check h1 != h3
    check h1.toInt32 == 42
    check h1.isValid

  test "Invalid handle":
    let h = INVALID_HANDLE
    check not h.isValid
    check h.toInt32 == -1

  test "Deferred handles":
    let h1 = nextDeferredHandle()
    let h2 = nextDeferredHandle()
    check h1 == 0x100000
    check h2 == 0x100001
    check h2 > h1

# ------------------------------------------------------------------------------
# Test schema parsing
# ------------------------------------------------------------------------------
suite "Schema parsing":
  test "Load schema from file":
    let defs = loadSchema("src/schema.def")
    check defs.commands.len > 0
    check defs.events.len > 0

  test "Command count":
    let defs = loadSchema("src/schema.def")
    check defs.commands.len == 151

  test "Event count":
    let defs = loadSchema("src/schema.def")
    check defs.events.len == 19

  test "Namespace count":
    let defs = loadSchema("src/schema.def")
    let ns = defs.getNamespaces()
    check ns.len == 11

  test "Handle types collected":
    let defs = loadSchema("src/schema.def")
    let ht = defs.collectHandleTypes()
    check ht.len > 0
    check "DOMElement" in ht

  test "Opcode assignment":
    let defs = loadSchema("src/schema.def")
    check defs.commands[0].opcode > 0
    check defs.events[0].opcode > 0

  test "Command fields parsed":
    let defs = loadSchema("src/schema.def")
    let cmd = defs.commands[0]  # GET_BODY
    check cmd.ns == "dom"
    check cmd.name == "GET_BODY"
    check cmd.funcName == "get_body"
    check cmd.returnType == "handle"
    check cmd.returnHandleType == "DOMElement"

  test "Event fields parsed":
    let defs = loadSchema("src/schema.def")
    let evt = defs.events[0]  # CLICK
    check evt.ns == "dom"
    check evt.name == "CLICK"

  test "Inheritance parsed":
    let defs = loadSchema("src/schema.def")
    check defs.handleInheritance["Canvas"] == "DOMElement"
    check defs.handleInheritance["Image"] == "DOMElement"
    check defs.handleInheritance["Audio"] == "DOMElement"

  test "Handle inheritance ordering":
    let defs = loadSchema("src/schema.def")
    let ordered = defs.orderedHandleTypes()
    check ordered.len > 0
    # DOMElement should come before Canvas (Canvas inherits from DOMElement)
    let domIdx = ordered.find("DOMElement")
    let canvasIdx = ordered.find("Canvas")
    check domIdx >= 0
    check canvasIdx >= 0
    check domIdx < canvasIdx

# ------------------------------------------------------------------------------
# Test type mapping
# ------------------------------------------------------------------------------
suite "Type mapping":
  test "ParamType enum values":
    check ptHandle != ptString
    check ptInt32 != ptFloat64
    check ptUint8 != ptUint32

# ------------------------------------------------------------------------------
# Test event struct naming
# ------------------------------------------------------------------------------
suite "Event struct names":
  test "MOUSE_DOWN becomes MouseDownEvent":
    check eventStructName("MOUSE_DOWN") == "MouseDownEvent"

  test "CLICK becomes ClickEvent":
    check eventStructName("CLICK") == "ClickEvent"

  test "KEY_DOWN becomes KeyDownEvent":
    check eventStructName("KEY_DOWN") == "KeyDownEvent"
