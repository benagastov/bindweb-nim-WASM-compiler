/**
 * pipeline.js — orchestrates the full in-browser build:
 *
 *   Nim source --(nim.wasm)--> C files --(fixups)--> clang.wasm/wasm-ld
 *     --> app.wasm --(bindweb env + WASI shim)--> running app
 *
 * The C-source fixups (SPEC §6) and the run step are ported from the
 * legacy IDE (/mnt/agents/repo/IDE/index.html, steps 1b and 3); the
 * origins are cited at each port.
 *
 * SPEC §6.3 mechanism choice (documented): the bindweb C runtime is read
 * from the bindweb libpack through the nim module's FS
 * (/bindweb/c/bindweb_runtime.c + bindweb_runtime.h), the header is
 * inlined into the source, and the result is passed to clang as an
 * `extraHeaders` translation unit. The weak raise() stub is a separate TU
 * (raise-stub.c, SPEC §6.2).
 */

/**
 * C prologue prepended to every Nim-generated TU.
 *
 * Ported from the legacy IDE step 1b "combined header", minus the weak
 * raise() stub (now raise-stub.c per SPEC §6.2) and minus nimbase.h
 * (appended at build time from vendor/nim/nimbase.h). Provides what
 * wasi-libc lacks for Nim codegen:
 *  - NIM_INTBITS/NIM_EmulateOverflowChecks (stripped from the TUs and
 *    re-established here),
 *  - __sighandler_t / SIG_* / a no-op signal() (WASI has no signals),
 *  - jmp_buf typedefs matching the musl-style layout Nim expects.
 */
const C_PROLOGUE_PRE = `/* Combined header (ported from legacy IDE index.html, step 1b) */
#define NIM_INTBITS 32
#define NIM_EmulateOverflowChecks
#include <signal.h>
#include <string.h>
/* wasi signal.h does NOT define __sighandler_t / SIG_* / signal() (WASI has no signals). */
typedef void (*__sighandler_t)(int);
#ifndef SIG_IGN
#define SIG_IGN ((__sighandler_t)1)
#endif
#ifndef SIG_DFL
#define SIG_DFL ((__sighandler_t)0)
#endif
#ifndef SIG_ERR
#define SIG_ERR ((__sighandler_t)-1)
#endif
static __sighandler_t signal(int sig, __sighandler_t handler) { (void)sig; (void)handler; return SIG_DFL; }
typedef long int __jmp_buf[8];
typedef struct { __jmp_buf __jmpbuf; int __mask_was_saved; } __jmp_buf_tag;
typedef __jmp_buf_tag jmp_buf[1];
extern int setjmp(jmp_buf __env) __attribute__((__nothrow__));
_Noreturn void longjmp(jmp_buf __env, int __val) __attribute__((__nothrow__));
`;

/**
 * raise-stub.c — SPEC §6.2.
 *
 * wasi-libc declares but does not implement raise(). The legacy IDE
 * injected this weak no-op inside its combined header; here it is a
 * separate translation unit appended to cfiles (same link semantics: a
 * single weak definition wins over the undefined reference).
 */
export const RAISE_STUB_C = `/* raise-stub.c — weak raise() stub for wasi-libc.
 * Ported from the legacy IDE combined header (index.html, step 1b). */
__attribute__((weak)) int raise(int sig) { (void)sig; return 0; }
`;

/**
 * Strip the per-TU bits that the combined prologue replaces.
 *
 * Ported verbatim from the legacy IDE C cleaner (index.html, step 1b):
 * removes the nimbase.h include, the duplicate NIM_INTBITS /
 * NIM_EmulateOverflowChecks defines, and the platform #undef lines that
 * fight the wasi sysroot headers.
 *
 * @param {string} c C source of one Nim-generated TU
 * @returns {string} stripped source
 */
export function stripNimPrologue(c) {
  return c
    .split('\n')
    .filter((line) => !/^#include\s+["<](?:\/lib\/)?nimbase\.h[">]\s*$/.test(line))
    .filter((line) => !/^#define NIM_INTBITS/.test(line))
    .filter((line) => !/^#define NIM_EmulateOverflowChecks/.test(line))
    .filter((line) => !/^#undef (LANGUAGE_C|MIPSEB|MIPSEL|PPC|R3000|R4000|i386|linux|mips|near|far|powerpc|unix)\s*$/.test(line))
    .join('\n');
}

/**
 * Rewrite Nim's 3-arg main to the 2-arg form wasi's crt1 calls.
 *
 * SPEC §6.1, ported verbatim from the legacy IDE C cleaner
 * (index.html, step 1b): Nim emits `main(argc, args, env)`; wasi crt1
 * calls 2-arg main, so the env parameter becomes a local NULL.
 *
 * @param {string} c C source of one Nim-generated TU
 * @returns {string} source with the main signature rewritten
 */
export function fixNimMain(c) {
  return c.replace(
    /int main\(int (\w+), char\*\* (\w+), char\*\* (\w+)\) \{/,
    'int main(int $1, char** $2) {\n\tchar** $3 = (char**)0;'
  );
}

/**
 * Assemble one compilable TU from a Nim-generated C file.
 *
 * @param {string} name original file name (for the banner comment)
 * @param {string} text decoded C source
 * @param {string} nimbaseHeader contents of nimbase.h
 * @returns {string} TU source with prologue + fixups applied
 */
function buildTU(name, text, nimbaseHeader) {
  const cleaned = fixNimMain(stripNimPrologue(text));
  return `${C_PROLOGUE_PRE}${nimbaseHeader}\n/* ===== ${name} ===== */\n${cleaned}\n`;
}

/**
 * Build the bindweb runtime TU by inlining bindweb_runtime.h into
 * bindweb_runtime.c.
 *
 * Ported from the legacy IDE step 1b: the header defines
 * WEBCC_COMMAND_BUFFER_SIZE (+ the other WEBCC_* sizes), the
 * bindweb_js_flush import and all prototypes, and pulls in
 * stdint/stddef/stdbool — stripping it instead of inlining it left
 * uint8_t/uint32_t/size_t undeclared. <string.h> is added for
 * memcpy/memset/memmove/strlen used by the runtime. The header has its
 * own include guard, so inlining once is safe.
 *
 * @param {string} runtimeC contents of bindweb_runtime.c
 * @param {string} runtimeH contents of bindweb_runtime.h
 * @returns {string} TU source
 */
export function buildBindwebRuntimeTU(runtimeC, runtimeH) {
  const inlined = runtimeC.replace(/#include\s+"bindweb_runtime\.h"/g, runtimeH);
  return `/* Nim Bindweb Runtime (ported from legacy IDE index.html, step 1b) */\n#include <string.h>\n${inlined}`;
}

/* --------------------------------------------------------------------------
 * WASI (preview1) host shim.
 *
 * Ported from the legacy IDE step 3: app.wasm is linked with crt1.o +
 * wasi-libc, so besides the bindweb "env" imports it imports WASI
 * syscalls from "wasi_unstable"/"wasi_snapshot_preview1". The bindweb
 * runtime only provides "env", so this shim covers the rest. Its memory
 * is wired after instantiation (exports.memory).
 * ------------------------------------------------------------------------ */

const WASI_ESUCCESS = 0;
const WASI_EBADF = 8;

/** Thrown by the shim's proc_exit; exit(0) is normal completion. */
class ProcExit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

/**
 * Create the WASI shim.
 *
 * @param {(msg: string, kind?: string) => void} onLog log sink;
 *   fd_write to fd 1 logs as 'stdout', fd 2 as 'stderr'
 * @returns {{impl: object, setMemory: (mem: WebAssembly.Memory) => void}}
 */
function createWasiShim(onLog) {
  let memory = null;
  const u8 = () => new Uint8Array(memory.buffer);
  const dv = () => new DataView(memory.buffer);
  const textDecoder = new TextDecoder();

  function writeIovs(fd, iovsPtr, iovsLen, nwrittenPtr) {
    const view = dv();
    let total = 0;
    for (let i = 0; i < iovsLen; i++) {
      const p = iovsPtr + i * 8;
      const buf = view.getUint32(p, true);
      const len = view.getUint32(p + 4, true);
      if (len > 0) {
        const txt = textDecoder.decode(u8().slice(buf, buf + len));
        onLog(txt.replace(/\n$/, ''), fd === 2 ? 'stderr' : 'stdout');
        total += len;
      }
    }
    view.setUint32(nwrittenPtr, total, true);
    return WASI_ESUCCESS;
  }

  const impl = {
    proc_exit(code) { throw new ProcExit(code); },
    fd_write(fd, p, n, w) { return writeIovs(fd, p, n, w); },
    fd_read(_fd, _i, _n, nreadPtr) { dv().setUint32(nreadPtr, 0, true); return WASI_ESUCCESS; },
    fd_close() { return WASI_ESUCCESS; },
    fd_seek(_fd, _lo, _hi, _w, newOffPtr) {
      if (typeof newOffPtr === 'number') {
        dv().setUint32(newOffPtr, 0, true);
        dv().setUint32(newOffPtr + 4, 0, true);
      }
      return WASI_ESUCCESS;
    },
    fd_fdstat_get(_fd, buf) {
      const v = dv();
      v.setUint8(buf, 2);
      v.setUint16(buf + 2, 0, true);
      v.setBigUint64(buf + 8, 0xffffffffffffffffn, true);
      v.setBigUint64(buf + 16, 0xffffffffffffffffn, true);
      return WASI_ESUCCESS;
    },
    fd_prestat_get() { return WASI_EBADF; },
    fd_prestat_dir_name() { return WASI_EBADF; },
    args_sizes_get(a, b) { const v = dv(); v.setUint32(a, 0, true); v.setUint32(b, 0, true); return WASI_ESUCCESS; },
    args_get() { return WASI_ESUCCESS; },
    environ_sizes_get(a, b) { const v = dv(); v.setUint32(a, 0, true); v.setUint32(b, 0, true); return WASI_ESUCCESS; },
    environ_get() { return WASI_ESUCCESS; },
    clock_time_get(_id, _p, t) { dv().setBigUint64(t, BigInt(Date.now()) * 1000000n, true); return WASI_ESUCCESS; },
    clock_res_get(_id, r) { dv().setBigUint64(r, 1000000n, true); return WASI_ESUCCESS; },
    random_get(buf, len) {
      const b = u8().subarray(buf, buf + len);
      if (globalThis.crypto && crypto.getRandomValues) {
        for (let o = 0; o < len; o += 65536) {
          crypto.getRandomValues(b.subarray(o, Math.min(o + 65536, len)));
        }
      } else {
        for (let i = 0; i < len; i++) b[i] = (Math.random() * 256) | 0;
      }
      return WASI_ESUCCESS;
    },
    poll_oneoff(_i, _o, _n, neventsPtr) { dv().setUint32(neventsPtr, 0, true); return WASI_ESUCCESS; },
    sched_yield() { return WASI_ESUCCESS; },
  };

  return { impl, setMemory(mem) { memory = mem; } };
}

/* --------------------------------------------------------------------------
 * Public pipeline.
 * ------------------------------------------------------------------------ */

/**
 * Compile Nim source and run the resulting wasm app.
 *
 * @param {object} args
 * @param {string} args.source Nim source code
 * @param {import('./nim-compiler.js').NimCompiler} args.nim initialized NimCompiler
 * @param {import('./clang-compiler.js').ClangCompiler} args.clang initialized ClangCompiler
 * @param {{createBindwebRunner: (el: HTMLElement) => object}} args.runtime
 *   the bindweb browser runtime (web/src/runtime/bindweb-browser-runtime.js)
 * @param {HTMLElement} [args.outputEl] DOM container the app renders into
 *   (extension of the SPEC §4 signature: the runner needs a mount point;
 *   defaults to document.body)
 * @param {(msg: string, kind?: string) => void} [args.onLog] log sink;
 *   kind is one of 'step' | 'info' | 'ok' | 'warn' | 'error' | 'stdout' | 'stderr'
 * @returns {Promise<{ok: boolean, stage: string, nimStdout: string,
 *   nimStderr: string, clangLog: string, error?: string}>}
 */
export async function compileAndRun({ source, nim, clang, runtime, outputEl, onLog = () => {} }) {
  const result = { ok: false, stage: 'nim', nimStdout: '', nimStderr: '', clangLog: '' };
  if (!outputEl) {
    if (typeof document === 'undefined' || !document.body) {
      throw new Error('pipeline: outputEl is required outside a DOM (bindweb app mount point)');
    }
    outputEl = document.body;
  }
  if (!runtime || typeof runtime.createBindwebRunner !== 'function') {
    throw new Error('pipeline: runtime must provide createBindwebRunner(el)');
  }

  // -- Step 1: Nim -> C --------------------------------------------------
  onLog('=== step 1: Nim -> C (nim.wasm) ===', 'step');
  const nimResult = await nim.compile(source);
  result.nimStdout = nimResult.stdout;
  result.nimStderr = nimResult.stderr;
  if (nimResult.stdout.trim()) {
    for (const line of nimResult.stdout.trim().split('\n')) onLog(line, 'stdout');
  }
  if (nimResult.stderr.trim()) {
    for (const line of nimResult.stderr.trim().split('\n')) onLog(line, 'stderr');
  }
  if (!nimResult.ok) {
    result.error = `nim compile failed (rc=${nimResult.rc}, ${nimResult.cfiles.length} C files)`;
    onLog(result.error, 'error');
    return result;
  }
  onLog(`nim: ok, ${nimResult.cfiles.length} translation units`, 'ok');

  // -- Step 2: C fixups (SPEC §6) ----------------------------------------
  onLog('=== step 2: C fixups ===', 'step');
  const decoder = new TextDecoder();
  const cfiles = nimResult.cfiles.map(({ name, data }) => ({
    name,
    code: buildTU(name, decoder.decode(data), nim.nimbaseHeader),
  }));
  cfiles.push({ name: 'raise-stub.c', code: RAISE_STUB_C });

  // bindweb C runtime from the bindweb libpack, via the nim module FS
  // (SPEC §6.3; optional so plain Nim programs build without the pack).
  const extraHeaders = [];
  const runtimeC = nim.readLibFile('/bindweb/c/bindweb_runtime.c');
  const runtimeH = nim.readLibFile('/bindweb/c/bindweb_runtime.h');
  if (runtimeC && runtimeH) {
    extraHeaders.push({
      name: 'bindweb_runtime.c',
      code: buildBindwebRuntimeTU(decoder.decode(runtimeC), decoder.decode(runtimeH)),
    });
    onLog('fixups: bindweb_runtime.c inlined from /bindweb/c/', 'info');
  } else {
    onLog('fixups: bindweb C runtime not found at /bindweb/c/ — continuing without it', 'warn');
  }
  onLog(`fixups: prologue + 2-arg main rewrite applied, raise-stub.c appended (${cfiles.length} TUs)`, 'info');

  // -- Step 3: C -> WASM (clang.wasm + wasm-ld) ---------------------------
  onLog('=== step 3: C -> WASM (clang.js) ===', 'step');
  result.stage = 'clang';
  const link = await clang.compileAndLink(cfiles, { extraHeaders });
  result.clangLog = link.log;
  if (link.log) {
    for (const line of link.log.split('\n')) {
      if (line.trim()) onLog(line, 'stdout');
    }
  }
  if (!link.ok) {
    result.error = 'clang compile/link failed';
    onLog(result.error, 'error');
    return result;
  }
  onLog(`clang: linked app.wasm (${link.wasm.length} bytes)`, 'ok');

  // -- Step 4: instantiate + run (ported from legacy IDE step 3) ---------
  onLog('=== step 4: run with bindweb runtime ===', 'step');
  result.stage = 'run';
  try {
    const wasmModule = await WebAssembly.compile(link.wasm);
    const runner = runtime.createBindwebRunner(outputEl);
    const wasi = createWasiShim(onLog);

    // Build the import object by reflecting over what the module actually
    // needs: "env" -> bindweb runtime, "wasi_*" -> shim, anything else ->
    // safe no-op (ported from legacy IDE step 3).
    const envImports = (runner.imports && runner.imports.env) || {};
    const importObject = {};
    for (const desc of WebAssembly.Module.imports(wasmModule)) {
      const mod = desc.module;
      const name = desc.name;
      importObject[mod] = importObject[mod] || {};
      if (desc.kind !== 'function') continue;
      if (mod === 'env' && typeof envImports[name] === 'function') {
        importObject[mod][name] = envImports[name];
      } else if (typeof wasi.impl[name] === 'function') {
        importObject[mod][name] = wasi.impl[name];
      } else {
        importObject[mod][name] = () => 0;
      }
    }

    const instance = await WebAssembly.instantiate(wasmModule, importObject);
    onLog('run: wasm instance created', 'ok');

    // Wire memory into the WASI shim, then connect the bindweb runtime.
    wasi.setMemory(instance.exports.memory);
    runner.connect(instance);

    // Clear the output container before running.
    outputEl.innerHTML = '';

    // wasi-libc's _start calls exit() when main returns, which the shim
    // raises as ProcExit; treat exit(0) as normal completion.
    let ranOk = false;
    try {
      if (instance.exports._start) {
        instance.exports._start();
        onLog('run: _start() executed', 'ok');
        ranOk = true;
      } else if (instance.exports.main) {
        instance.exports.main();
        onLog('run: main() executed', 'ok');
        ranOk = true;
      } else {
        onLog('run: no _start or main export found', 'warn');
      }
    } catch (e) {
      if (e instanceof ProcExit) {
        onLog(`run: program exited with code ${e.code}`, e.code === 0 ? 'ok' : 'warn');
        ranOk = e.code === 0;
      } else {
        throw e;
      }
    }

    // Drain the trailing command batch: bindweb only auto-flushes the
    // command buffer on the next return-value DOM call, so void commands
    // queued after the last create/get are still pending when main()
    // returns (ported from legacy IDE step 3).
    if (instance.exports.bindweb_flush) {
      try {
        instance.exports.bindweb_flush();
        onLog('run: flushed trailing commands', 'ok');
      } catch (e) {
        onLog(`run: trailing flush failed: ${e.message || e}`, 'stderr');
      }
    }

    // Start the event loop if set_main_loop was called.
    runner.startEventLoop();

    result.ok = ranOk;
    if (!ranOk) result.error = 'app ran but reported a failure';
  } catch (e) {
    result.error = `run failed: ${e.message || e}`;
    onLog(result.error, 'error');
    if (e.stack) onLog(String(e.stack).split('\n').slice(0, 4).join('\n'), 'stderr');
  }
  return result;
}
