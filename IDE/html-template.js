// html-template.js
// ================
// Exported HTML template for the "Export Standalone HTML" feature.
//
// IMPORTANT — why this lives in its own file:
//   The previous implementation inlined this template as a backtick-delimited
//   string literal inside the main <script type="module"> block of index.html.
//   That works in a pristine browser, but the deployment CDN appends debug
//   scripts (iframe-highlight-injector, floating-ball, ...) whose own real
//   `</script>` close tags are then visible *inside* the template literal —
//   and the HTML parser treats any literal `</script>` inside a <script> block
//   as the end of that block, regardless of whether it sits inside a JS
//   string. The result: the outer script terminated early, the page stopped
//   working, and Claude Fable flagged the file as "malformed script tags".
//
//   By moving the template to its own file we eliminate the entire class of
//   problems. There is no inlined template in index.html, so the CDN's
//   appended `</script>` tags land in their own proper <script> blocks (or
//   outside any block) and can never terminate the IDE's main script.
//
//   The placeholder names (__WASM_B64__, __RUNTIME_CODE__) are kept verbatim
//   for backwards compatibility with anything that grepped the source.

export const htmlTemplate =
'<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>Nim Bindweb App</title>\n' +
'<style>\n' +
'  html, body { margin: 0; padding: 0; }\n' +
'  #bindweb-error { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;\n' +
'                 background: #8b1a1a; color: #fff; padding: 10px 14px; white-space: pre-wrap;\n' +
'                 word-break: break-word; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<script type="module">\n' +
'// ---- inlined wasm (base64) ----\n' +
'const WASM_B64 = "__WASM_B64__";\n' +
'\n' +
'// ---- Nim Bindweb Browser Runtime (inlined) ----\n' +
'__RUNTIME_CODE__\n' +
'\n' +
'// ---- Minimal WASI host (memory wired after instantiation) ----\n' +
'let __wasiMemory = null;\n' +
'const __u8 = () => new Uint8Array(__wasiMemory.buffer);\n' +
'const __dv = () => new DataView(__wasiMemory.buffer);\n' +
'const WASI_OK = 0, WASI_EBADF = 8;\n' +
'class ProcExit extends Error { constructor(code){ super(\'exit \' + code); this.code = code; } }\n' +
'function __writeIovs(fd, iovsPtr, iovsLen, nwrittenPtr) {\n' +
'  const v = __dv(); let total = 0;\n' +
'  for (let i = 0; i < iovsLen; i++) {\n' +
'    const p = iovsPtr + i * 8, buf = v.getUint32(p, true), len = v.getUint32(p + 4, true);\n' +
'    if (len > 0) {\n' +
'      let s = new TextDecoder().decode(__u8().slice(buf, buf + len));\n' +
'      while (s.length && (s.charCodeAt(s.length - 1) === 10 || s.charCodeAt(s.length - 1) === 13)) s = s.slice(0, -1);\n' +
'      (fd === 2 ? console.error : console.log)(s);\n' +
'      total += len;\n' +
'    }\n' +
'  }\n' +
'  v.setUint32(nwrittenPtr, total, true);\n' +
'  return WASI_OK;\n' +
'}\n' +
'const wasiImpl = {\n' +
'  proc_exit(code){ throw new ProcExit(code); },\n' +
'  fd_write(fd, p, n, w){ return __writeIovs(fd, p, n, w); },\n' +
'  fd_read(_f, _i, _n, nr){ __dv().setUint32(nr, 0, true); return WASI_OK; },\n' +
'  fd_close(){ return WASI_OK; },\n' +
'  fd_seek(_f, _lo, _hi, _w, no){ if (typeof no === \'number\') { __dv().setUint32(no, 0, true); __dv().setUint32(no + 4, 0, true); } return WASI_OK; },\n' +
'  fd_fdstat_get(_f, buf){ const v = __dv(); v.setUint8(buf, 2); v.setUint16(buf + 2, 0, true); v.setBigUint64(buf + 8, 0xffffffffffffffffn, true); v.setBigUint64(buf + 16, 0xffffffffffffffffn, true); return WASI_OK; },\n' +
'  fd_prestat_get(){ return WASI_EBADF; },\n' +
'  fd_prestat_dir_name(){ return WASI_EBADF; },\n' +
'  args_sizes_get(a, b){ const v = __dv(); v.setUint32(a, 0, true); v.setUint32(b, 0, true); return WASI_OK; },\n' +
'  args_get(){ return WASI_OK; },\n' +
'  environ_sizes_get(a, b){ const v = __dv(); v.setUint32(a, 0, true); v.setUint32(b, 0, true); return WASI_OK; },\n' +
'  environ_get(){ return WASI_OK; },\n' +
'  clock_time_get(_i, _p, t){ __dv().setBigUint64(t, BigInt(Date.now()) * 1000000n, true); return WASI_OK; },\n' +
'  clock_res_get(_i, r){ __dv().setBigUint64(r, 1000000n, true); return WASI_OK; },\n' +
'  random_get(buf, len){ const b = __u8().subarray(buf, buf + len); if (globalThis.crypto && crypto.getRandomValues) for (let o = 0; o < len; o += 65536) crypto.getRandomValues(b.subarray(o, Math.min(o + 65536, len))); else for (let i = 0; i < len; i++) b[i] = (Math.random() * 256) | 0; return WASI_OK; },\n' +
'  poll_oneoff(_i, _o, _n, ne){ __dv().setUint32(ne, 0, true); return WASI_OK; },\n' +
'  sched_yield(){ return WASI_OK; },\n' +
'};\n' +
'\n' +
'function showError(msg) {\n' +
'  let el = document.getElementById(\'bindweb-error\');\n' +
'  if (!el) { el = document.createElement(\'div\'); el.id = \'bindweb-error\'; document.body.appendChild(el); }\n' +
'  el.textContent = \'Nim Bindweb error: \' + msg;\n' +
'}\n' +
'\n' +
'async function boot() {\n' +
'  try {\n' +
'    const bytes = Uint8Array.from(atob(WASM_B64), c => c.charCodeAt(0));\n' +
'    const runner = createBindwebRunner(document.body);\n' +
'    const wasmModule = await WebAssembly.compile(bytes);\n' +
'    const envImports = (runner.imports && runner.imports.env) || {};\n' +
'    const importObject = {};\n' +
'    for (const desc of WebAssembly.Module.imports(wasmModule)) {\n' +
'      const mod = desc.module, name = desc.name;\n' +
'      importObject[mod] = importObject[mod] || {};\n' +
'      if (desc.kind !== \'function\') continue;\n' +
'      if (mod === \'env\' && typeof envImports[name] === \'function\') importObject[mod][name] = envImports[name];\n' +
'      else if (typeof wasiImpl[name] === \'function\') importObject[mod][name] = wasiImpl[name];\n' +
'      else importObject[mod][name] = () => 0;\n' +
'    }\n' +
'    const instance = await WebAssembly.instantiate(wasmModule, importObject);\n' +
'    __wasiMemory = instance.exports.memory;\n' +
'    runner.connect(instance);\n' +
'    try {\n' +
'      if (instance.exports._start) instance.exports._start();\n' +
'      else if (instance.exports.main) instance.exports.main();\n' +
'    } catch (e) {\n' +
'      if (!(e instanceof ProcExit)) throw e;\n' +
'    }\n' +
'    if (instance.exports.bindweb_flush) { try { instance.exports.bindweb_flush(); } catch (_) {} }\n' +
'    runner.startEventLoop();\n' +
'  } catch (e) {\n' +
'    console.error(e);\n' +
'    showError(e && (e.message || e));\n' +
'  }\n' +
'}\n' +
'boot();\n' +
'<' + '/script>\n' +
'</body>\n' +
'</html>\n';
