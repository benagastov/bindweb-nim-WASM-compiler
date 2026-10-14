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
 *
 * The run step lives in runtime/run-wasm.js (with the WASI shim in
 * runtime/wasi-shim.js) so the SAME code can be inlined into the static
 * site produced by the Build button — see site-template.js.
 */

import { createWasiShim, ProcExit } from './runtime/wasi-shim.js';
import { runWasmApp } from './runtime/run-wasm.js';
import { obfuscateWasm } from './wasm-obfuscate.js';

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

/**
 * The clang compile + link. Kept as this exact statement: build drivers
 * (e.g. QNote's scripts/wasm-build/build-wasm.mjs) instrument
 * `const link = await clang.compileAndLink(cfiles, ...)` as it is served.
 */
async function linkWithClang(clang, cfiles, extraHeaders) {
  const link = await clang.compileAndLink(cfiles, { extraHeaders });
  return link;
}

/* --------------------------------------------------------------------------
 * Public pipeline.
 * ------------------------------------------------------------------------ */

/**
 * Compile Nim source to a linked app.wasm (steps 1–3 of the pipeline).
 *
 * This is the shared core of both the Run button (compileAndRun below,
 * which additionally instantiates the wasm in the page) and the Build
 * button (main.js, which stores the wasm into the deployed-site folder).
 *
 * @param {object} args
 * @param {string} args.source Nim source code of the entry file
 * @param {string} [args.outFile] MEMFS path of the entry file
 *   (default: /project/main.nim; multi-file projects pass
 *   /workspace/<entry> — see nim-compiler.js `workspace` option)
 * @param {import('./nim-compiler.js').NimCompiler} args.nim initialized NimCompiler
 * @param {import('./clang-compiler.js').ClangCompiler|import('./wcc-compiler.js').WccCompiler} args.clang
 *   initialized C compiler: ClangCompiler, or WccCompiler (kind === 'wcc')
 * @param {() => Promise<import('./clang-compiler.js').ClangCompiler>} [args.fallback]
 *   with wcc: resolves an initialized ClangCompiler to retry with if wcc fails
 * @param {(msg: string, kind?: string) => void} [args.onLog] log sink
 * @returns {Promise<{ok: boolean, stage: string, wasm: Uint8Array|null,
 *   nimStdout: string, nimStderr: string, clangLog: string, error?: string}>}
 */
export async function compileToWasm({ source, outFile, nim, clang, fallback = null, onLog = () => {} }) {
  const result = { ok: false, stage: 'nim', wasm: null, nimStdout: '', nimStderr: '', clangLog: '' };

  // -- Step 1: Nim -> C --------------------------------------------------
  onLog('=== step 1: Nim -> C (nim.wasm) ===', 'step');
  const nimResult = await nim.compile(source, outFile ? { outFile } : undefined);
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

  // bindweb C runtime from the bindweb libpack, via the nim module FS
  // (SPEC §6.3; optional so plain Nim programs build without the pack).
  const decoder = new TextDecoder();
  const runtimeCBytes = nim.readLibFile('/bindweb/c/bindweb_runtime.c');
  const runtimeHBytes = nim.readLibFile('/bindweb/c/bindweb_runtime.h');
  const runtimeC = runtimeCBytes && runtimeHBytes ? decoder.decode(runtimeCBytes) : null;
  const runtimeH = runtimeC ? decoder.decode(runtimeHBytes) : null;
  if (!runtimeC) onLog('fixups: bindweb C runtime not found at /bindweb/c/ — continuing without it', 'warn');

  result.stage = 'clang';
  let link = null;
  if (clang.kind === 'wcc') {
    // -- Steps 2+3, fast path: wcc (its own prologue, see wcc/wcc-backend.js)
    onLog('=== step 2: C fixups (wcc) ===', 'step');
    const { tus, rewrites } = clang.prepare({
      cfiles: nimResult.cfiles, nimbase: nim.nimbaseHeader, runtimeC, runtimeH,
    });
    onLog(`fixups: wcc prologue, ${rewrites} label rewrites, raise-stub.c${runtimeC ? ' + bindweb_runtime.c' : ''} (${tus.length} TUs)`, 'info');
    onLog('=== step 3: C -> WASM (wcc) ===', 'step');
    link = await clang.compileAndLink(tus);
    if (!link.ok && fallback) {
      // Anything wcc can't handle is still built: fall back to clang.
      for (const line of link.log.split('\n')) if (line.trim()) onLog(line, 'stderr');
      onLog('wcc could not build this program — building it with clang instead', 'warn');
      clang = await fallback();
      link = null;
    }
  }
  if (!link) {
    // -- Step 2: C fixups (SPEC §6) --------------------------------------
    onLog('=== step 2: C fixups ===', 'step');
    const cfiles = nimResult.cfiles.map(({ name, data }) => ({
      name,
      code: buildTU(name, decoder.decode(data), nim.nimbaseHeader),
    }));
    cfiles.push({ name: 'raise-stub.c', code: RAISE_STUB_C });
    const extraHeaders = [];
    if (runtimeC) {
      extraHeaders.push({ name: 'bindweb_runtime.c', code: buildBindwebRuntimeTU(runtimeC, runtimeH) });
      onLog('fixups: bindweb_runtime.c inlined from /bindweb/c/', 'info');
    }
    onLog(`fixups: prologue + 2-arg main rewrite applied, raise-stub.c appended (${cfiles.length} TUs)`, 'info');

    // -- Step 3: C -> WASM (clang.wasm + wasm-ld) -------------------------
    onLog('=== step 3: C -> WASM (clang.js) ===', 'step');
    link = await linkWithClang(clang, cfiles, extraHeaders);
  }
  result.clangLog = link.log;
  if (link.log) {
    for (const line of link.log.split('\n')) {
      if (line.trim()) onLog(line, 'stdout');
    }
  }
  if (!link.ok) {
    result.error = `${clang.kind === 'wcc' ? 'wcc' : 'clang'} compile/link failed`;
    onLog(result.error, 'error');
    return result;
  }
  onLog(`${clang.kind === 'wcc' ? 'wcc' : 'clang'}: linked app.wasm (${link.wasm.length} bytes)`, 'ok');

  // -- Step 3b: obfuscate (strip Nim fingerprints, keep it runnable) ------
  // Applies to BOTH Run and Build: drops the "name"/"producers" custom
  // sections (readable Nim symbols in DevTools, "language: Nim" toolchain
  // metadata) and injects a decoy ".comment" GCC section. Sections that
  // affect execution pass through byte-identical.
  const obfuscated = obfuscateWasm(link.wasm, { decoy: false, stripDebug: true });
  onLog(
    `release: stripped names, producers and debug metadata (not encryption) ` +
    `(${link.wasm.length} bytes -> ${obfuscated.length} bytes)`,
    'info'
  );

  result.ok = true;
  result.wasm = obfuscated;
  return result;
}

/**
 * Compile Nim source and run the resulting wasm app.
 *
 * @param {object} args
 * @param {string} args.source Nim source code
 * @param {string} [args.outFile] MEMFS path of the entry file
 * @param {import('./nim-compiler.js').NimCompiler} args.nim initialized NimCompiler
 * @param {import('./clang-compiler.js').ClangCompiler|import('./wcc-compiler.js').WccCompiler} args.clang
 *   initialized C compiler (see compileToWasm)
 * @param {() => Promise<import('./clang-compiler.js').ClangCompiler>} [args.fallback] see compileToWasm
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
export async function compileAndRun({ source, outFile, nim, clang, fallback = null, runtime, outputEl, onLog = () => {} }) {
  if (!outputEl) {
    if (typeof document === 'undefined' || !document.body) {
      throw new Error('pipeline: outputEl is required outside a DOM (bindweb app mount point)');
    }
    outputEl = document.body;
  }
  if (!runtime || typeof runtime.createBindwebRunner !== 'function') {
    throw new Error('pipeline: runtime must provide createBindwebRunner(el)');
  }

  const result = await compileToWasm({ source, outFile, nim, clang, fallback, onLog });
  if (!result.ok) return result;

  // -- Step 4: instantiate + run (ported from legacy IDE step 3) ---------
  onLog('=== step 4: run with bindweb runtime ===', 'step');
  result.stage = 'run';
  const ran = await runWasmApp({
    wasmBytes: result.wasm,
    outputEl,
    onLog,
    createBindwebRunner: runtime.createBindwebRunner,
    createWasiShim,
    ProcExit,
  });
  result.ok = ran.ok;
  if (!ran.ok) result.error = ran.error;
  return result;
}
