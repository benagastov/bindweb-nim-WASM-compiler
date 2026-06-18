## Panic override for WASM builds.
## Strips the default panic path (stack traces, stderr writes, string formatting)
## to shrink the WASM binary. Use with --panics:on.

when defined(wasm):
  proc rawoutput(s: string) = discard
  proc panic(s: string) {.noreturn.} =
    while true: discard
