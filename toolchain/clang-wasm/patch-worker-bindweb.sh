#!/bin/bash
# =============================================================================
# patch-worker-bindweb.sh  --  make the in-browser Nim/Bindweb pipeline robust
#                              to the worker's built-in WASI runner
# =============================================================================
#
# WHY THIS PATCH EXISTS
# ---------------------
# binji/wasm-clang's clang.js exposes a `compileEachLink` helper that does
# THREE things in the embedded web worker:
#
#   1. clang -cc1 -emit-obj each .c file
#   2. wasm-ld ... --allow-undefined -o app.wasm link all the .o files
#   3. WebAssembly.compile(app.wasm) and then s.run(inst, out)
#      which instantiates the linked module with a HARDCODED
#      {wasi_unstable:{proc_exit, fd_write, fd_read, fd_close, fd_seek,
#                       fd_fdstat_get, fd_prestat_get, fd_prestat_dir_name,
#                       args_sizes_get, args_get, environ_sizes_get,
#                       environ_get, clock_time_get, random_get,
#                       poll_oneoff, sched_yield}} import object and calls _start
#
# Step (3) is fine for a plain wasi-libc app (the demo's hello-world style
# programs). It is WRONG for the **Bindweb** pipeline:
#
# The Bindweb framework adds a "env" import layer — `env.bindweb_js_flush`,
# `env.bindweb_js_create`, `env.bindweb_js_set_attr`, etc. — for the Nim
# runtime to push DOM commands into JavaScript. wasi-ld emits the app.wasm
# with those imports unresolved (we pass --allow-undefined so linking succeeds
# even when the linker can't see them). But the worker's hardcoded import
# object does NOT contain them, so WebAssembly.instantiate throws a LinkError.
#
# The original `case "compile-each-link"` in the worker does NOT wrap
# `s.run(inst, h.out)` in try/catch. The throw escapes the case block
# before `compile-each-link-done` is posted. The main thread's
# `compileEachLink` Promise therefore hangs forever (the only thing keeping
# the IDE alive was a 25 s Promise.race safety timeout in the host page).
#
# THE FIX
# --------
# Wrap the run step in try/catch. On LinkError, log a warning naming the
# expected cause (missing bindweb env imports), and still post
# `compile-each-link-done` with `{ok:false, linked:true}`. The linked
# app.wasm is left in the worker's memfs; the host page's STEP 3
# re-instantiates it with the proper Nim Bindweb env + WASI shim and runs
# _start itself.
#
# The fix is surgical and idempotent. It does NOT change clang.wasm, lld.wasm,
# sysroot.tar, memfs.wasm, or any of the compiler's compile/link flags.
#
# Parts that live elsewhere (for cross-reference):
#   - The 25 s safety timeout in the host page is now reduced to 8 s.
#   - The `?v=p1` cache-bust on the host page's `import('./static/clang/clang.js')`
#     forces the browser to load the patched clang.js.
#   - STEP 3 in the host page re-instantiates the linked app.wasm with the
#     Nim Bindweb "env" + a minimal wasi_snapshot_preview1 shim.
#
# Run:  ./patch-worker-bindweb.sh                 # patches the two clang.js copies
#       ./patch-worker-bindweb.sh path/to/clang.js [more.js ...]
#
# Idempotent: re-running detects an already-patched file and does nothing.
# =============================================================================
set -euo pipefail
# Resolve paths relative to the repo root (one directory up from this script's
# toolchain/clang-wasm/ location) so the script works whether you invoke it
# from the repo root or from this directory.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DEFAULT_TARGETS=(
  "$ROOT/bindweb-nim-browser/static/clang/clang.js"
)
if [ "$#" -ge 1 ]; then
  TARGETS=("$@")
else
  TARGETS=("${DEFAULT_TARGETS[@]}")
fi

# The exact un-patched substring we want to replace. The worker source is
# minified to one line, so the substring is unambiguous.
ORIG='const finalResult=await s.run(inst,h.out);i.postMessage({id:"compile-each-link-done",data:finalResult?{ok:true}:{ok:false}});break;}'

# The patched replacement. We capture finalResult in a `let` so the postMessage
# line below can still use it whether the run succeeded or threw.
PATCHED='let finalResult=null;try{finalResult=await s.run(inst,h.out);}catch(e){console.log("WARN: app.wasm instantiation failed in worker (likely missing env imports; main thread will re-instantiate with proper env): "+(e&&e.message||e));}i.postMessage({id:"compile-each-link-done",data:finalResult?{ok:true}:{ok:false,linked:true}});break;}'

# An already-patched worker contains this string verbatim.
PATCH_MARKER='let finalResult=null;try{finalResult=await s.run(inst,h.out);}catch(e){console.log("WARN: app.wasm instantiation failed in worker'

for f in "${TARGETS[@]}"; do
  if [ ! -f "$f" ]; then
    echo "skip: $f not found"
    continue
  fi
  python3 - "$f" "$ORIG" "$PATCHED" "$PATCH_MARKER" <<'PYEOF'
import sys, re, base64
path, ORIG, PATCHED, MARKER = sys.argv[1:5]
with open(path, encoding='utf8') as fh:
    s = fh.read()

# The worker source is base64-encoded inside clang.js as a="...".
m = re.search(r'\(a="([A-Za-z0-9+/=]+)",G=null', s)
if not m:
    print(f"  {path}: could not locate embedded worker blob; nothing patched")
    sys.exit(0)
b64 = m.group(1)
worker = base64.b64decode(b64).decode('utf8')

if MARKER in worker:
    print(f"  {path}: already patched (worker try/catch present); no change")
    sys.exit(0)

n = worker.count(ORIG)
if n != 1:
    print(f"  {path}: expected exactly 1 un-patched site, found {n}; aborting to be safe")
    sys.exit(1)

worker2 = worker.replace(ORIG, PATCHED)
b64new = base64.b64encode(worker2.encode('utf8')).decode('ascii')
s2 = s.replace('(a="' + b64 + '",G=null', '(a="' + b64new + '",G=null')
with open(path, 'w', encoding='utf8') as fh:
    fh.write(s2)

# Round-trip verification: re-decode and confirm both the marker and the
# original substring are absent (i.e. the patch is in place).
chk = base64.b64decode(re.search(r'\(a="([A-Za-z0-9+/=]+)",G=null', s2).group(1)).decode('utf8')
ok = (MARKER in chk) and (ORIG not in chk)
print(f"  {path}: worker try/catch injected, round-trip {'OK' if ok else 'FAILED'}")
sys.exit(0 if ok else 2)
PYEOF
done

echo "Done. The patched clang.js worker now always posts compile-each-link-done,"
echo "even when the linked app.wasm has unresolved env imports (Bindweb)."
echo "Bump the ?v= cache-bust query string on the host page's"
echo "import('./static/clang/clang.js') if you want to be sure browsers pick up"
echo "the new worker."
