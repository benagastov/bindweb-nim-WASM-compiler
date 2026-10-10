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

import { splitTU } from './tu-split.js';

/** Output name inside the worker memfs (legacy IDE used 'app.wasm'). */
const OUT_NAME = 'app.wasm';
// TUs at least this big are split into codegen units of ~SPLIT_TARGET each.
const SPLIT_MIN = 640 * 1024;
const SPLIT_TARGET = 512 * 1024;

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
    const pooled = patchWorkerForPool(worker);
    if (pooled) { worker = pooled; changed = true; applied |= 4; }
    if (!changed) continue;
    poolWorkerText = worker;
    patched = patched.slice(0, match.index) + `"${btoa(worker)}"` + patched.slice(match.index + match[0].length);
  }
  if (applied & 4) {
    const main = patchMainForPool(patched);
    if (main) patched = main; else poolWorkerText = '';
  }
  if (applied & 1) log('clang: patched embedded worker (clock_time_get shim) in memory');
  else log('clang: worker shim already provides clock_time_get (no runtime patch needed)');
  if (applied & 2) log('clang: patched embedded worker (-Oz -> -O0, Oz pipeline traps in this build)');
  if (poolWorkerText) log('clang: worker pool enabled (parallel compile, shared modules, object cache)');
  return patched;
}

/* --------------------------------------------------------------------------
 * Parallel, cached compilation.
 *
 * Measured on QGraph (72 translation units): Nim -> C took 11 s, but clang
 * compiling the TUs one after another in a single worker took 117 s of a
 * 133 s build. Two levers, as in any compiler-performance work:
 *   - parallelism: a pool of clang workers (each wasm clang is single
 *     threaded), fed largest TU first, sharing ONE compiled clang.wasm /
 *     lld.wasm module (posted to each worker, not recompiled per worker);
 *   - not doing work at all: an IndexedDB cache of object files keyed by
 *     sha256(compile flags + TU source). Nim's C output for an unchanged
 *     module (and the whole stdlib) is byte-identical between builds, so a
 *     rebuild only compiles what changed.
 * The worker gains two messages ("compile-one", "link-objs"); the old
 * compileEachLink path stays as the fallback. The link no longer tries to
 * run the module in the worker (it always failed: no bindweb env).
 * ------------------------------------------------------------------------ */

/** The patched worker source (its flags are part of every cache key); '' = pool off. */
let poolWorkerText = '';

function patchWorkerForPool(worker) {
  const ctor = 's.ready.then((()=>{i.postMessage({id:"ready"})}))';
  const caseAnchor = 'case"compile-each-link":{';
  const link = /await s\.run\(r,"wasm-ld",("--no-threads".*?),\.\.\.objs,(.*?),"-o",h\.out\);/.exec(worker);
  if (!worker.includes(ctor) || !worker.includes(caseAnchor) || !link) return null;
  const define = /defines:(\[[^\]]*\])/.exec(worker);
  const defines = define ? define[1] : '[]';
  const cases =
    `case"compile-one":{const f=h.file;let ok=!1,bytes=null,error="";` +
    // run() returns false on exit(0) and throws on a non-zero exit: success is
    // "no exception and an object written" (an empty file is put first so a
    // stale object from an earlier build cannot pass for this one).
    `try{const obj=f.input.replace(/\\.c$/,".o");await s.ready;s.memfs.addFile(obj,new Uint8Array(0));` +
    `await s.compile({input:f.input,code:f.code,obj,defines:${defines}});` +
    `const v=s.memfs.getFileContents(obj);if(v.length){bytes=new Uint8Array(v.length);bytes.set(v);ok=!0}else error="clang wrote no object"}` +
    `catch(e){error=String(e&&e.message||e)}` +
    `i.postMessage({id:"compile-one-done",data:{seq:h.seq,ok,bytes,error}},bytes?[bytes.buffer]:[]);break}` +
    `case"link-objs":{let ok=!1,bytes=null,error="";` +
    `try{await s.ready;for(const o of h.objects){s.ensureParentDir(o.name);s.memfs.addFile(o.name,o.bytes)}` +
    `const sys="lib/wasm32-wasi";const objs=h.objects.map(o=>o.name);const r=await s.getModule(s.lldFilename);` +
    `s.memfs.addFile(h.out,new Uint8Array(0));await s.run(r,"wasm-ld",${link[1]},...objs,${link[2]},"-o",h.out);` +
    `const v=s.memfs.getFileContents(h.out);if(v.length){bytes=new Uint8Array(v.length);bytes.set(v);ok=!0}else error="wasm-ld wrote nothing"}` +
    `catch(e){error=String(e&&e.message||e)}` +
    `i.postMessage({id:"link-objs-done",data:{ok,bytes,error}},bytes?[bytes.buffer]:[]);break}`;
  return worker
    .replace(ctor, `(h.modules&&Object.assign(s.moduleCache,h.modules)),${ctor}`)
    .replace(caseAnchor, cases + caseAnchor);
}

function patchMainForPool(src) {
  // The bridge class: accept precompiled modules, and export it so the
  // driver can start more than the module's one singleton worker.
  const ctor = /constructor\((\w)\)\{(this\.nextResponseId=0,.*?payload:\{port:(\w),path:\1\})/;
  const hit = ctor.exec(src);
  const cls = /class (\w+)\{onReady;/.exec(src);
  if (!hit || !cls) return null;
  const body = hit[2].replace(`payload:{port:${hit[3]},path:${hit[1]}}`, `payload:{port:${hit[3]},path:${hit[1]},modules:__mods}`);
  return src.replace(hit[0], `constructor(${hit[1]},__mods){${body}`) + `\nexport{${cls[1]} as ClangBridge};\n`;
}

const CACHE_DB = 'bindweb-object-cache';
const CACHE_STORE = 'objects';
const CACHE_MAX = 3000;

function idb(request) {
  return new Promise((ok, no) => { request.onsuccess = () => ok(request.result); request.onerror = () => no(request.error); });
}

async function openCache() {
  const open = indexedDB.open(CACHE_DB, 1);
  open.onupgradeneeded = () => {
    const store = open.result.createObjectStore(CACHE_STORE);
    store.createIndex('used', 'used');
  };
  return idb(open);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class ClangPool {
  constructor(Bridge, distUrl, size, modules) {
    this.workers = [];
    for (let k = 0; k < size; k++) this.workers.push(new Bridge(distUrl, modules));
    this.ready = Promise.all(this.workers.map((w) => w.onReady));
    this.seq = 0;
  }

  /** One request/response round trip on a worker's port. */
  ask(worker, id, payload, doneId, transfer = []) {
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.id !== doneId) return;
        if (payload.seq !== undefined && e.data.data.seq !== payload.seq) return;
        worker.port.removeEventListener('message', handler);
        resolve(e.data.data);
      };
      worker.port.addEventListener('message', handler);
      worker.port.postMessage({ id, payload }, transfer);
    });
  }

  /** Compile `files` (largest first) across the pool; objects by index. */
  async compileAll(files) {
    const order = files.map((f, i) => i).sort((a, b) => files[b].code.length - files[a].code.length);
    const objects = new Array(files.length);
    let next = 0;
    let failure = null;
    await Promise.all(this.workers.map(async (worker) => {
      while (next < order.length && !failure) {
        const index = order[next++];
        const seq = this.seq++;
        const t = performance.now();
        const result = await this.ask(worker, 'compile-one', { file: files[index], seq }, 'compile-one-done'); // eslint-disable-line no-await-in-loop
        if (!result.ok) { failure = `${files[index].input}: ${result.error}`; return; }
        objects[index] = result.bytes;
        this.timings.push({ name: files[index].label || files[index].input, ms: performance.now() - t, bytes: files[index].code.length });
      }
    }));
    if (failure) throw new Error(failure);
    return objects;
  }

  timings = [];

  async link(objects, out) {
    const copies = objects.map((o) => ({ name: o.name, bytes: o.bytes.slice() }));
    return this.ask(this.workers[0], 'link-objs', { objects: copies, out }, 'link-objs-done', copies.map((o) => o.bytes.buffer));
  }
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
    // The pool warms up in the background: the first build waits for it.
    if (poolWorkerText && mod.ClangBridge) {
      this._poolPromise = this._startPool(mod.ClangBridge, distUrl).catch((e) => {
        this.onLog(`clang: worker pool unavailable (${e.message || e}); compiling serially`, 'warn');
        return null;
      });
    }
  }

  /**
   * Workers: one per two hardware threads (each wasm clang instance can take
   * a few hundred MB while compiling a large TU), at least 2, at most 8;
   * override with localStorage "bindweb.clangWorkers".
   * @private
   */
  async _startPool(Bridge, distUrl) {
    const t0 = performance.now();
    const cores = navigator.hardwareConcurrency || 4;
    const configured = Number(globalThis.localStorage?.getItem('bindweb.clangWorkers'));
    const size = configured > 0 ? Math.min(32, configured) : Math.max(2, Math.min(8, Math.floor(cores / 2)));
    const compile = async (name) => WebAssembly.compileStreaming(fetch(`${distUrl}/${name}`));
    const [clang, lld] = await Promise.all([compile('clang.wasm'), compile('lld.wasm')]);
    const pool = new ClangPool(Bridge, distUrl, size, { 'clang.wasm': clang, 'lld.wasm': lld });
    await pool.ready;
    this._flagsKey = await sha256Hex(poolWorkerText);
    try { this._cache = await openCache(); } catch (e) { this._cache = null; }
    this.onLog(`clang: ${size} compile workers ready (${Math.round(performance.now() - t0)} ms)`, 'info');
    return pool;
  }

  /**
   * The pooled build: cached objects for unchanged TUs, the rest compiled in
   * parallel, then one wasm-ld.
   * @private
   */
  async _compileAndLinkPooled(pool, files0, all0) {
    // Codegen units: an oversized TU (one Nim module that `include`s a whole
    // app) is split so every worker gets a share instead of one worker
    // compiling it alone. If a split part fails, rebuild unsplit.
    const split = this._splitUnits(pool, files0, all0);
    if (split) {
      try {
        return await this._pooledOnce(pool, split.files, split.all, split.note);
      } catch (e) {
        this.onLog(`clang: split build failed (${String(e.message || e).split(String.fromCharCode(10))[0]}) — retrying without splitting`, 'warn');
      }
    }
    return this._pooledOnce(pool, files0, all0, '');
  }

  /** Expand oversized TUs into codegen units, or null if none applies. @private */
  _splitUnits(pool, files, all) {
    let off = false;
    try { off = globalThis.localStorage?.getItem('bindweb.splitTU') === 'off'; } catch (e) { /* default on */ }
    if (off || globalThis.__bindwebNoSplit) return null;
    const outFiles = [];
    const outAll = [];
    const notes = [];
    files.forEach((f, i) => {
      const parts = f.code.length >= SPLIT_MIN
        ? splitTU(f.code, Math.min(pool.workers.length, Math.ceil(f.code.length / SPLIT_TARGET)))
        : null;
      if (!parts) { outFiles.push(f); outAll.push(all[i]); return; }
      parts.forEach((code, k) => {
        outFiles.push({ ...f, input: f.input.replace(/\.c$/, `_cgu${k}.c`), code });
        outAll.push({ ...all[i], name: `${all[i].name || f.input}#cgu${k + 1}of${parts.length}` });
      });
      notes.push(`${String(all[i].name || f.input).split('/').pop()} → ${parts.length}`);
    });
    return notes.length ? { files: outFiles, all: outAll, note: ` (split ${notes.join(', ')} codegen units)` } : null;
  }

  /** @private */
  async _pooledOnce(pool, files, all, note) {
    const t0 = performance.now();
    const keys = await Promise.all(files.map((f) => sha256Hex(`${this._flagsKey}\0${f.code}`)));
    const objects = new Array(files.length);
    if (this._cache) {
      const tx = this._cache.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE);
      const hits = await Promise.all(keys.map((k) => idb(tx.get(k)).catch(() => null)));
      hits.forEach((hit, i) => { if (hit && hit.bytes) objects[i] = hit.bytes; });
    }
    const missing = files.map((f, i) => i).filter((i) => !objects[i]);
    const cached = files.length - missing.length;
    if (missing.length) {
      pool.timings = [];
      const built = await pool.compileAll(missing.map((i) => ({ ...files[i], label: all[i].name || files[i].input })));
      missing.forEach((i, k) => { objects[i] = built[k]; });
      const slow = pool.timings.sort((a, b) => b.ms - a.ms).slice(0, 5)
        .map((t) => `${String(t.name).split('/').pop()} ${Math.round(t.ms)} ms (${Math.round(t.bytes / 1024)} KB)`);
      this.onLog(`clang: slowest TUs: ${slow.join(', ')}`, 'info');
    }
    const tCompile = performance.now();
    if (this._cache && missing.length) {
      const now = Date.now();
      const store = this._cache.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE);
      for (const i of missing) store.put({ bytes: objects[i], used: now }, keys[i]);
    }
    if (this._cache && cached) {
      // Mark hits as used (keeps them through pruning).
      const now = Date.now();
      const store = this._cache.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE);
      files.forEach((f, i) => { if (!missing.includes(i)) store.put({ bytes: objects[i], used: now }, keys[i]); });
    }
    const linked = await pool.link(files.map((f, i) => ({ name: f.input.replace(/\.c$/, '.o'), bytes: objects[i] })), OUT_NAME);
    if (!linked.ok) throw new Error(`link failed: ${linked.error}`);
    this.onLog(`clang: ${files.length} TUs${note} — ${cached} from cache, ${missing.length} compiled on ${pool.workers.length} workers ` +
      `(${Math.round(tCompile - t0)} ms) + link (${Math.round(performance.now() - tCompile)} ms)`, 'ok');
    this._prune();
    return linked.bytes;
  }

  /** Keep the object cache bounded: drop the least recently used beyond CACHE_MAX. @private */
  async _prune() {
    if (!this._cache) return;
    try {
      const store = this._cache.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE);
      const count = await idb(store.count());
      if (count <= CACHE_MAX) return;
      let drop = count - CACHE_MAX;
      const cursor = store.index('used').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || drop-- <= 0) return;
        c.delete();
        c.continue();
      };
    } catch (e) { /* pruning is best effort */ }
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
    const pool = this._poolPromise ? await this._poolPromise : null;
    if (pool) {
      try {
        const wasm = await this._compileAndLinkPooled(pool, files, all);
        this.onLog(`clang: ${OUT_NAME} ready (${wasm.length} bytes)`, 'ok');
        return { ok: true, wasm, log: chunks.join('\n') };
      } catch (e) {
        if (/process exited with code|error:/i.test(chunks.join('\n'))) {
          // A real compile error: report it as the serial path would.
          return { ok: false, wasm: null, log: chunks.join('\n') + `\n${e.message || e}` };
        }
        this.onLog(`clang: pooled build failed (${e.message || e}); retrying serially`, 'warn');
      } finally {
        console.log = origLog;
        console.error = origErr;
      }
      console.log = capture(origLog, 'out');
      console.error = capture(origErr, 'err');
    }
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
