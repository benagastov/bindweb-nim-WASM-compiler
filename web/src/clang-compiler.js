/**
 * clang-compiler.js — wraps binji's prebuilt clang toolchain
 * (vendor/clang/clang.js: clang.wasm + lld.wasm + memfs.wasm + sysroot.tar)
 * to compile the C translation units emitted by nim.wasm and link them
 * into app.wasm, entirely in the browser.
 *
 * Uses binji's `compileEachLink(files, out)` worker API. The worker is
 * patched by toolchain/patches/patch-clang-js.sh (-fno-common cc1 fix)
 * and toolchain/patches/patch-worker.sh (try/catch around the built-in
 * WASI run step so a LinkError from the missing bindweb env imports still
 * posts `compile-each-link-done` with {ok:false, linked:true} and leaves
 * app.wasm in the worker memfs).
 *
 * Compile and link flags live in the (patched) worker and are the SPEC §5
 * canonical set:
 *   clang -cc1 -emit-obj -disable-free -isysroot /
 *     -internal-isystem /include/c++/v1 -internal-isystem /include
 *     -internal-isystem /lib/clang/8.0.1/include
 *     -ferror-limit 19 -fmessage-length 80 -fcolor-diagnostics
 *     -Oz -fno-common -o <out>.o -x c <input>
 *   wasm-ld --no-threads --export-dynamic -z stack-size=1048576
 *     -L lib/wasm32-wasi lib/wasm32-wasi/crt1.o <objs...>
 *     --allow-undefined --export-table -lc -lcanvas -lwasi-emulated-mman
 *     -o app.wasm
 * (verified against the legacy IDE's patched worker,
 *  /mnt/agents/repo/IDE/static/clang/clang.js, step 2.)
 */

/** Output name inside the worker memfs (legacy IDE used 'app.wasm'). */
const OUT_NAME = 'app.wasm';

/** Strip ANSI SGR sequences from worker log output (legacy IDE step 2). */
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * QUIRK (verified live against the pinned clang.wasm): the worker's WASI
 * shim (base64-embedded inside clang.js) throws
 * `wasi_unstable.clock_time_get not implemented` — and clang's
 * `CompilerInstance::createOutputFile` calls it on EVERY `-cc1 -emit-obj`
 * invocation (createUniqueFile -> Process::GetRandomNumber -> /dev/urandom
 * is absent from the memfs -> time() fallback -> clock_time_get -> throw),
 * wedging the worker before the first object file is written. The legacy
 * IDE hits the exact same wall with these artifacts.
 *
 * The vendored clang.js is NOT modified; instead the embedded worker code
 * is patched in memory at load time with a minimal clock_time_get (writes
 * a u64 ns timestamp into module memory, returns 0) — the same shape as
 * the adjacent `random_get` shim. If the needle is not found (a future
 * toolchain patch fixes the shim upstream), the pristine worker is kept.
 * RECOMMENDATION: mirror this in toolchain/patches/patch-worker.sh.
 *
 * @param {string} src clang.js module source text
 * @param {(msg: string) => void} log
 * @returns {string} patched module source text (or the original)
 */
function patchWorkerClockShim(src, log) {
  const needle = /clock_time_get\(([^)]*)\)\{throw new \w+\("wasi_unstable","clock_time_get"\)\}/;
  // The worker is embedded as one or more long base64 string literals
  // (the pinned clang.js embeds a ~15 kB one; keep the threshold low).
  const blobRe = /"([A-Za-z0-9+/=]{1000,})"/g;
  let match;
  let patched = src;
  let applied = 0;
  while ((match = blobRe.exec(src)) !== null) {
    // latin1 round-trip: one char per byte, so the splice is byte-exact.
    let worker = atob(match[1]);
    let changed = false;
    const hit = needle.exec(worker);
    if (hit) {
      const ptr = hit[1].split(',').pop().trim(); // last arg: time pointer
      const impl =
        `clock_time_get(${hit[1]}){this.mem.check();` +
        `const n=BigInt(Date.now())*1000000n;` +
        `new DataView(this.mem.buffer).setBigUint64(${ptr},n,true);return 0}`;
      worker = worker.slice(0, hit.index) + impl + worker.slice(hit.index + hit[0].length);
      changed = true;
      applied |= 1;
    }
    // QUIRK #2 (verified live): this clang.wasm build's -Oz function-pass
    // pipeline traps deterministically
    // (PMTopLevelManager::schedulePass -> "RuntimeError: null function" —
    // a pass registry/static-initializer defect in the pinned LLVM wasm
    // build). -O0 skips that pipeline entirely, works, and compiles
    // noticeably faster — a win for the beginner UX. If a future toolchain
    // rebuild fixes the Oz pipeline, this replacement simply remains a
    // harmless performance trade-off.
    if (worker.includes('"-Oz"')) {
      worker = worker.split('"-Oz"').join('"-O0"');
      changed = true;
      applied |= 2;
    }
    if (!changed) continue;
    patched = patched.slice(0, match.index) + `"${btoa(worker)}"` + patched.slice(match.index + match[0].length);
  }
  if (applied & 1) log('clang: patched embedded worker (clock_time_get shim) in memory');
  else log('clang: worker shim already provides clock_time_get (no runtime patch needed)');
  if (applied & 2) log('clang: patched embedded worker (-Oz -> -O0, Oz pipeline traps in this build)');
  return patched;
}

/**
 * Import the vendored clang.js as an ES module, applying the in-memory
 * worker shim patch first (see patchWorkerClockShim). Falls back to the
 * pristine URL import if anything unexpected happens.
 *
 * @param {string} absUrl absolute URL of vendor/clang/clang.js
 * @param {(msg: string) => void} log
 * @returns {Promise<object>} the clang.js module namespace
 */
async function importClangModule(absUrl, log) {
  try {
    const res = await fetch(absUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const src = await res.text();
    const patched = patchWorkerClockShim(src, log);
    if (patched === src) throw new Error('not patched');
    const blobUrl = URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));
    return await import(blobUrl);
  } catch (e) {
    log(`clang: importing vendored clang.js as-is (${e.message || e})`);
    return import(absUrl);
  }
}

/**
 * Normalize one C translation unit to binji's {input, code} shape.
 *
 * The input is renamed to `w<idx>.c` — the exact scheme the legacy IDE
 * used (index.html step 1b: `input: 'w' + idx + '.c'`). The worker
 * derives the object name via `input.replace(/.c$/, '.o')`, so simple
 * flat names keep the object's path predictable, and the original name
 * survives in the TU's banner comment (pipeline buildTU) and in the log
 * mapping below.
 *
 * @param {{name?: string, input?: string, data?: Uint8Array|string, code?: string}} entry
 * @param {number} idx translation unit index
 * @returns {{input: string, code: string}}
 */
function normalizeTU(entry, idx) {
  const input = `w${idx}.c`;
  let code = entry.code;
  if (code === undefined || code === null) {
    code = typeof entry.data === 'string' ? entry.data : new TextDecoder().decode(entry.data);
  }
  return { input, code };
}

/**
 * Browser-side clang/lld driver.
 */
export class ClangCompiler {
  /**
   * @param {{vendorUrl: string, onLog?: (msg: string, kind?: string) => void}} config
   */
  constructor({ vendorUrl, onLog = () => {} }) {
    this.vendorUrl = vendorUrl;
    this.onLog = onLog;
    /** @private */ this._api = null;
  }

  /**
   * Load vendor/clang/clang.js and start its worker. `init({path})` needs
   * the absolute URL of the clang dist directory (the worker fetches
   * `${path}/clang.wasm` etc.), matching the legacy IDE's init.
   *
   * @returns {Promise<void>}
   */
  async init() {
    // Resolve against the document: dynamic import() would otherwise
    // treat the relative URL as relative to THIS module (web/src/).
    const moduleUrl = new URL(`${this.vendorUrl}/clang/clang.js`, document.baseURI).href;
    this.onLog(`clang: loading ${moduleUrl}`, 'info');
    const mod = await importClangModule(moduleUrl, (m) => this.onLog(m, 'info'));
    const distUrl = new URL(`${this.vendorUrl}/clang`, window.location.href).href.replace(/\/$/, '');
    await mod.init({ path: distUrl });
    this._api = mod;
    this.onLog('clang: toolchain ready', 'info');
  }

  /**
   * Compile every C translation unit and link them into a wasm module.
   *
   * Ported from the legacy IDE step 2: console.log/console.error are
   * temporarily wrapped because the worker forwards compiler diagnostics
   * through them; the compile races a safety timeout in case the worker
   * wedges (the patched worker is expected to always answer); afterwards
   * app.wasm is pulled out of the worker memfs via getFile. The linked
   * module is NOT run here — instantiation happens in the pipeline with
   * the proper bindweb env imports.
   *
   * @param {Array<{name?: string, input?: string, data?: Uint8Array|string, code?: string}>} cfiles
   *   C translation units (nim output with fixups already applied).
   * @param {{extraHeaders?: Array<{name?: string, code?: string, data?: Uint8Array|string}>,
   *          timeoutMs?: number}} [options]
   *   extraHeaders: additional C sources appended to `cfiles`
   *     (pipeline passes bindweb_runtime.c here — SPEC §6.3 mechanism).
   *   timeoutMs: safety-net timeout for the worker round-trip. When omitted it
   *     SCALES with the number of translation units (60s base + 10s per TU,
   *     floor 120s). A 46-TU build compiles each TU serially in-browser at -O0
   *     and legitimately exceeded the old fixed 120000 ms on slower machines,
   *     aborting a healthy build with a misleading "worker wedged?" error.
   *     (The legacy IDE used 8000, tight even on cold starts.)
   * @returns {Promise<{ok: boolean, wasm: Uint8Array|null, log: string}>}
   */
  async compileAndLink(cfiles, { extraHeaders = [], timeoutMs = null } = {}) {
    if (!this._api) throw new Error('clang-compiler: init() has not completed');

    const all = [...cfiles, ...extraHeaders];
    const files = all.map((e, i) => normalizeTU(e, i));
    if (files.length === 0) {
      return { ok: false, wasm: null, log: 'clang: no input files' };
    }
    // Safety net only: generous, and proportional to the actual workload.
    const effectiveTimeoutMs = timeoutMs != null
      ? timeoutMs
      : Math.max(120000, 60000 + 10000 * files.length);
    this.onLog(`clang: compiling ${files.length} translation units`, 'info');
    for (let i = 0; i < all.length; i++) {
      const orig = all[i].name || all[i].input;
      if (orig) this.onLog(`clang:   ${files[i].input} = ${orig}`, 'info');
    }

    // Capture worker diagnostics forwarded through console (step 2 port).
    const chunks = [];
    const origLog = console.log;
    const origErr = console.error;
    const capture = (orig, tag) => function (...args) {
      orig.apply(console, args);
      const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
      const stripped = text.replace(ANSI_RE, '');
      if (stripped.trim()) chunks.push(stripped);
    };
    console.log = capture(origLog, 'out');
    console.error = capture(origErr, 'err');

    let linkResult = null;
    try {
      const compilePromise = this._api.compileEachLink(files, OUT_NAME);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`compile-link safety timeout after ${effectiveTimeoutMs} ms (worker wedged?)`)), effectiveTimeoutMs);
      });
      try {
        linkResult = await Promise.race([compilePromise, timeoutPromise]);
        if (linkResult && linkResult.ok) {
          this.onLog('clang: compile+link+run completed', 'ok');
        } else {
          // Expected: the worker's built-in WASI runner lacks the bindweb
          // env imports, so the patched worker reports
          // {ok:false, linked:true} and leaves app.wasm in memfs.
          this.onLog('clang: compile+link done (worker run skipped as expected — pipeline re-instantiates with bindweb env)', 'info');
        }
      } catch (e) {
        this.onLog(`clang: ${e.message || e} — falling through to getFile`, 'warn');
      }
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    // Extract app.wasm from the worker memfs (step 3 port).
    let wasm = null;
    try {
      const fileResult = await this._api.getFile(OUT_NAME);
      if (fileResult && fileResult.ok && fileResult.bytes) {
        wasm = fileResult.bytes;
        this.onLog(`clang: ${OUT_NAME} ready (${wasm.length} bytes)`, 'ok');
      } else {
        const err = (fileResult && fileResult.error) || 'unknown error';
        chunks.push(`clang: getFile(${OUT_NAME}) failed: ${err}`);
        this.onLog(`clang: getFile(${OUT_NAME}) failed: ${err}`, 'error');
      }
    } catch (e) {
      chunks.push(`clang: getFile(${OUT_NAME}) threw: ${e.message || e}`);
      this.onLog(`clang: getFile(${OUT_NAME}) threw: ${e.message || e}`, 'error');
    }

    return { ok: wasm !== null, wasm, log: chunks.join('\n') };
  }
}
