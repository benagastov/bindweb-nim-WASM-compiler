## Schema parser for WebCC.
## Reads the schema.def file and produces data structures for code generation.

import std/[strutils, tables, sets]

type
  ParamType* = enum
    ptInt32, ptUint32, ptUint8, ptFloat32, ptFloat64,
    ptString, ptHandle, ptFuncPtr

  SchemaParam* = object
    name*: string
    paramType*: ParamType
    handleType*: string      ## e.g. "DOMElement", "" if not a handle

  SchemaCommand* = object
    ns*: string
    name*: string            ## e.g. "GET_BODY"
    funcName*: string        ## e.g. "get_body"
    opcode*: uint8
    params*: seq[SchemaParam]
    returnType*: string      ## "", "int32", "uint32", "float64", "string", "handle"
    returnHandleType*: string
    action*: string          ## JavaScript action code

  SchemaEvent* = object
    ns*: string
    name*: string
    opcode*: uint8
    params*: seq[SchemaParam]

  SchemaMeta* = object
    kind*: string
    derived*: string
    base*: string

  SchemaDefs* = object
    commands*: seq[SchemaCommand]
    events*: seq[SchemaEvent]
    metas*: seq[SchemaMeta]
    handleInheritance*: Table[string, string]  ## derived -> base

# ------------------------------------------------------------------------------
# Helper: parse a type string like "handle(DOMElement)", "int32", "string"
# ------------------------------------------------------------------------------
proc parseParamType(typeStr: string; outHandleType: var string): ParamType =
  outHandleType = ""
  if typeStr == "int32": return ptInt32
  if typeStr == "uint32": return ptUint32
  if typeStr == "uint8": return ptUint8
  if typeStr == "float32": return ptFloat32
  if typeStr == "float64": return ptFloat64
  if typeStr == "string": return ptString
  if typeStr == "func_ptr": return ptFuncPtr
  if typeStr.startsWith("handle(") and typeStr.endsWith(")"):
    outHandleType = typeStr[7 .. ^2]
    return ptHandle
  if typeStr == "handle":
    return ptHandle
  raise newException(ValueError, "Unknown type: " & typeStr)

# ------------------------------------------------------------------------------
# Helper: parse parameter spec like "handle(DOMElement):handle" or "string:id"
# ------------------------------------------------------------------------------
proc parseParamSpec(spec: string): SchemaParam =
  ## Parse "type:name" or "handle(Type):name"
  let colonIdx = spec.rfind(':')
  if colonIdx < 0:
    raise newException(ValueError, "Invalid param spec (no colon): " & spec)
  let typePart = spec[0 ..< colonIdx]
  let namePart = spec[colonIdx + 1 .. ^1]
  result.name = namePart
  result.paramType = parseParamType(typePart, result.handleType)

# ------------------------------------------------------------------------------
# Helper: parse return spec like "RET:handle(DOMElement)" or "RET:string"
# ------------------------------------------------------------------------------
proc parseReturnSpec(spec: string; outHandleType: var string): string =
  ## Returns the base type string ("handle", "string", "int32", etc.)
  ## and sets outHandleType if it's a typed handle.
  outHandleType = ""
  if not spec.startsWith("RET:"):
    return ""
  let typeStr = spec[4 .. ^1]
  if typeStr.startsWith("handle(") and typeStr.endsWith(")"):
    outHandleType = typeStr[7 .. ^2]
    return "handle"
  discard parseParamType(typeStr, outHandleType)
  return typeStr

# ------------------------------------------------------------------------------
# Main: load schema from file
# ------------------------------------------------------------------------------
proc loadSchema*(path: string): SchemaDefs =
  ## Load and parse a schema.def file.
  ## Commands and events each get a global sequential opcode starting from 1,
  ## matching the original C++ parser behavior.
  result = SchemaDefs()
  var nextCmdOpcode: uint8 = 1
  var nextEventOpcode: uint8 = 1

  let content = readFile(path)
  for rawLine in content.splitLines():
    var line = rawLine.strip()
    if line.len == 0 or line.startsWith("#"):
      continue

    let parts = line.split('|')
    if parts.len < 2:
      continue

    # Check for meta lines first: meta|inherit|Derived|Base
    if parts[0].strip() == "meta":
      if parts.len >= 4:
        result.metas.add(SchemaMeta(
          kind: parts[1].strip(),
          derived: parts[2].strip(),
          base: if parts.len >= 4: parts[3].strip() else: ""
        ))
        if parts[1].strip() == "inherit" and parts.len >= 4:
          result.handleInheritance[parts[2].strip()] = parts[3].strip()
      continue

    let kind = parts[1].strip()

    if kind == "command":
      # dom|command|GET_BODY|get_body|RET:handle(DOMElement)|{ ... }
      if parts.len < 6:
        continue
      let ns = parts[0].strip()
      let name = parts[2].strip()
      let funcName = parts[3].strip()
      let typesSpec = parts[4].strip()
      # Action may contain '|', so reconstruct from remaining parts
      var action = parts[5]
      for i in 6 ..< parts.len:
        action.add("|" & parts[i])
      action = action.strip()

      # Assign global opcode (all commands share one counter, starting from 1)
      let opcode = nextCmdOpcode
      nextCmdOpcode = opcode + 1

      var cmd = SchemaCommand(
        ns: ns, name: name, funcName: funcName,
        opcode: opcode, action: action
      )

      # Parse params and return type
      let typeParts = typesSpec.splitWhitespace()
      for tp in typeParts:
        if tp.startsWith("RET:"):
          cmd.returnType = parseReturnSpec(tp, cmd.returnHandleType)
        else:
          cmd.params.add(parseParamSpec(tp))

      result.commands.add(cmd)
      continue

    if kind == "event":
      # dom|event|CLICK|handle(DOMElement):handle
      if parts.len < 4:
        continue
      let ns = parts[0].strip()
      let name = parts[2].strip()
      let typesSpec = parts[3].strip()

      # Assign global event opcode (all events share one counter, starting from 1)
      let opcode = nextEventOpcode
      nextEventOpcode = opcode + 1

      var evt = SchemaEvent(
        ns: ns, name: name, opcode: opcode
      )

      let typeParts = typesSpec.splitWhitespace()
      for tp in typeParts:
        evt.params.add(parseParamSpec(tp))

      result.events.add(evt)
      continue

# ------------------------------------------------------------------------------
# Utility functions
# ------------------------------------------------------------------------------

proc getCommands*(defs: SchemaDefs; ns: string): seq[SchemaCommand] =
  ## Get all commands for a namespace.
  for c in defs.commands:
    if c.ns == ns:
      result.add(c)

proc getEvents*(defs: SchemaDefs; ns: string): seq[SchemaEvent] =
  ## Get all events for a namespace.
  for e in defs.events:
    if e.ns == ns:
      result.add(e)

proc getNamespaces*(defs: SchemaDefs): seq[string] =
  ## Get all unique namespace names.
  var seen = initHashSet[string]()
  for c in defs.commands:
    if not seen.contains(c.ns):
      seen.incl(c.ns)
      result.add(c.ns)
  for e in defs.events:
    if not seen.contains(e.ns):
      seen.incl(e.ns)
      result.add(e.ns)

proc collectHandleTypes*(defs: SchemaDefs): seq[string] =
  ## Collect all unique handle types from schema.
  var seen = initHashSet[string]()
  for c in defs.commands:
    if c.returnHandleType != "" and not seen.contains(c.returnHandleType):
      seen.incl(c.returnHandleType)
      result.add(c.returnHandleType)
    for p in c.params:
      if p.handleType != "" and not seen.contains(p.handleType):
        seen.incl(p.handleType)
        result.add(p.handleType)
  for e in defs.events:
    for p in e.params:
      if p.handleType != "" and not seen.contains(p.handleType):
        seen.incl(p.handleType)
        result.add(p.handleType)
  # Ensure base types from inheritance are included
  for derived, base in defs.handleInheritance:
    if not seen.contains(base):
      seen.incl(base)
      result.add(base)

# ------------------------------------------------------------------------------
# Helper: convert schema type to Nim type string
# ------------------------------------------------------------------------------
proc nimType*(p: SchemaParam): string =
  case p.paramType:
    of ptInt32: "int32"
    of ptUint32: "uint32"
    of ptUint8: "uint8"
    of ptFloat32: "float32"
    of ptFloat64: "float64"
    of ptString: "string"
    of ptHandle:
      if p.handleType != "": p.handleType & "Handle" else: "Handle"
    of ptFuncPtr: "pointer"

proc nimReturnType*(c: SchemaCommand): string =
  ## Get the Nim return type for a command.
  case c.returnType:
    of "": "void"
    of "int32": "int32"
    of "uint32": "uint32"
    of "uint8": "uint8"
    of "float32": "float32"
    of "float64": "float64"
    of "string": "string"
    of "handle":
      if c.returnHandleType != "": c.returnHandleType & "Handle" else: "Handle"
    else: "void"

proc nimReturnTypeC*(c: SchemaCommand): string =
  ## Get the C return type for the importc declaration.
  case c.returnType:
    of "": "void"
    of "int32": "int32"
    of "uint32": "uint32"
    of "uint8": "uint8"
    of "float32": "float32"
    of "float64": "float64"
    of "string": "uint32"  # Returns length
    of "handle": "int32"
    else: "void"

# ------------------------------------------------------------------------------
# Helper: generate a Nim-safe parameter name
# ------------------------------------------------------------------------------
proc nimParamName*(name: string; index: int): string =
  ## Generate a Nim-safe parameter name, avoiding Nim keywords.
  result = if name.len > 0: name else: "arg" & $index
  # Avoid Nim keywords that would cause syntax errors
  case result:
    of "func": result = "fn"
    of "proc": result = "pfn"
    of "type": result = "typ"
    of "method": result = "mtd"
    of "template": result = "tpl"
    of "macro": result = "mcr"
    of "var": result = "vr"
    of "let": result = "lt"
    of "const": result = "cst"
    of "ref": result = "rf"
    of "ptr": result = "p"
    of "out": result = "outp"
    else: discard

# ------------------------------------------------------------------------------
# Helper: event name to PascalCase struct name
# ------------------------------------------------------------------------------
proc eventStructName*(name: string): string =
  ## Convert "MOUSE_DOWN" to "MouseDownEvent"
  result = ""
  var upperNext = true
  for c in name:
    if c == '_':
      upperNext = true
    elif upperNext:
      result.add(c.toUpperAscii())
      upperNext = false
    else:
      result.add(c.toLowerAscii())
  result.add("Event")

# ------------------------------------------------------------------------------
# Helper: ordered handle types respecting inheritance
# ------------------------------------------------------------------------------
proc orderedHandleTypes*(defs: SchemaDefs): seq[string] =
  ## Return handle types in inheritance order (bases before derived).
  let allTypes = defs.collectHandleTypes()
  var seen = initHashSet[string]()
  var remaining = allTypes

  while remaining.len > 0:
    var progress = false
    var i = 0
    while i < remaining.len:
      let ht = remaining[i]
      var base = ""
      if defs.handleInheritance.hasKey(ht):
        base = defs.handleInheritance[ht]

      # If base exists and not emitted yet, skip
      if base != "" and not seen.contains(base):
        i += 1
        continue

      result.add(ht)
      seen.incl(ht)
      remaining.delete(i)
      progress = true

    if not progress:
      # Fallback: emit remaining in any order
      for ht in remaining:
        result.add(ht)
      break

# ------------------------------------------------------------------------------
# Self-test
# ------------------------------------------------------------------------------
when isMainModule:
  let schemaPath = "src/schema.def"
  echo "Loading schema from ", schemaPath, "..."
  let defs = loadSchema(schemaPath)
  echo "Commands: ", defs.commands.len
  echo "Events: ", defs.events.len
  echo "Namespaces: ", defs.getNamespaces()
  echo "Handle types: ", defs.collectHandleTypes()
  echo "\nFirst 5 commands:"
  for i in 0 ..< min(5, defs.commands.len):
    let c = defs.commands[i]
    echo "  ", c.ns, " | ", c.name, " | ", c.funcName, " | opcode=", c.opcode
  echo "\nFirst 5 events:"
  for i in 0 ..< min(5, defs.events.len):
    let e = defs.events[i]
    echo "  ", e.ns, " | ", e.name, " | opcode=", e.opcode
