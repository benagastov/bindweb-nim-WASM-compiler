import ../models

type MathToken* = object
  latex*: string
  display*: bool
  style*: TextStyle

proc autoDetectMath*(text: string): bool =
  text.len >= 2 and ((text[0] == '$' and text[^1] == '$') or
    (text.len >= 4 and text[0..1] == "\\(" and text[^2..^1] == "\\)"))

