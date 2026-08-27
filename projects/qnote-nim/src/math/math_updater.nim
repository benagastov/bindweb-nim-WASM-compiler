import std/strutils

proc compactInlineLatex*(latex: string): string =
  latex.replace("\\displaystyle", "").strip()

proc updateMathLatex*(latex: string; isDisplay: bool): string =
  if isDisplay: latex.strip() else: compactInlineLatex(latex)

