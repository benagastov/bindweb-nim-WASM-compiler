/**
 * wcc-compiler.js — the fast C backend: wcc (tyfkda/xcc, built as wasm)
 * compiling Nim's C straight to WebAssembly in a pool of workers.
 *
 * Same contract as ClangCompiler.compileAndLink ({ok, wasm, log}), plus
 * prepare(), because wcc needs its own prologue instead of the clang one
 * (pipeline.js asks the compiler when `kind === 'wcc'`).
 *
 * Toolchain: vendor/wcc/cc.wasm (~0.5 MB, the whole compiler + linker) and
 * vendor/wcc/sysroot.tar (headers + libc with musl's libm and float I/O,
 * ~0.3 MB), from toolchain/wcc/ (see toolchain/wcc/README.md).
 *
 * Every compile runs on an in-memory WASI file system (wcc/memwasi.js): no
 * disk, no shared state between jobs. Compiled objects are cached in
 * IndexedDB keyed by SHA-256 over (compiler, prologue, flags, TU source),
 * like the clang object cache.
 */

import { untar } from './tar.js';
import { buildWccTU, buildBindwebRuntimeTU, RAISE_STUB_C, WCC_LINK_FLAGS } from './wcc/wcc-backend.js';

const CACHE_DB = 'bindweb-wcc-cache';
const CACHE_STORE = 'objects';
const CACHE_MAX = 3000;

function idb(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

async function openCache() {
  const req = indexedDB.open(CACHE_DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(CACHE_STORE).createIndex('used', 'used');
  return idb(req);
}

async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Workers that each hold the compiled cc.wasm and the sysroot. */
class WccPool {
  constructor(size, module, files) {
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    const workerUrl = new URL('./wcc/wcc-worker.js', import.meta.url);
    this.ready = Promise.all(Array.from({ length: size }, () => new Promise((resolve, reject) => {
      const w = new Worker(workerUrl, { type: 'module' });
      w.onerror = (e) => reject(new Error(`wcc worker: ${e.message || 'failed to start'}`));
      w.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.type === 'ready') { this.workers.push(w); this.idle.push(w); resolve(); return; }
        const done = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        this.idle.push(w);
        done(msg);
        this.pump();
      };
      w.postMessage({ type: 'init', module, files });
    })));
  }

  /** @returns {Promise<{code: number, stderr: string, stdout: string, ms: number, out: Uint8Array|null}>} */
  run(args, files, output) {
    return new Promise((resolve) => { this.queue.push({ args, files, output, resolve }); this.pump(); });
  }

  pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      const id = this.nextId++;
      this.pending.set(id, job.resolve);
      w.postMessage({ type: 'job', id, args: job.args, files: job.files, output: job.output });
    }
  }
}

/** wcc diagnostics, minus the warnings Nim's generated C always triggers. */
function errorLines(stderr) {
  return stderr.split('\n').filter((l) => l.trim() && !/warning/i.test(l) && !/^\s/.test(l)).slice(0, 20).join('\n');
}

export class WccCompiler {
  /**
   * @param {{vendorUrl: string, onLog?: (msg: string, kind?: string) => void}} config
   */
  constructor({ vendorUrl, onLog = () => {} }) {
    this.kind = 'wcc';
    this.vendorUrl = vendorUrl;
    this.onLog = onLog;
    /** @private */ this._pool = null;
  }

  /** Load cc.wasm + sysroot + prologue and start the worker pool. */
  async init() {
    const t0 = performance.now();
    const base = new URL(`${this.vendorUrl}/wcc/`, document.baseURI).href;
    const get = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r;
    };
    const [wasmBytes, tarBytes, prologue] = await Promise.all([
      get(`${base}cc.wasm`).then((r) => r.arrayBuffer()),
      get(`${base}sysroot.tar`).then((r) => r.arrayBuffer()),
      get(new URL('./wcc/wcc-prologue.h', import.meta.url).href).then((r) => r.text()),
    ]);
    const module = await WebAssembly.compile(wasmBytes);
    const files = untar(new Uint8Array(tarBytes))
      .filter((e) => e.type === 'file')
      .map((e) => [`/${e.name.replace(/^\.?\//, '')}`, e.data]);
    this._prologue = prologue;
    this._key = await sha256Hex(`${await sha256Hex(new Uint8Array(wasmBytes))}\0${prologue}\0${WCC_LINK_FLAGS.join(' ')}`);

    const cores = navigator.hardwareConcurrency || 4;
    const configured = Number(globalThis.localStorage?.getItem('bindweb.wccWorkers'));
    const size = configured > 0 ? Math.min(32, configured) : Math.max(2, Math.min(16, cores));
    this._pool = new WccPool(size, module, files);
    await this._pool.ready;
    try { this._cache = await openCache(); } catch (e) { this._cache = null; }
    this.onLog(`wcc: ${size} compile workers ready (${Math.round(performance.now() - t0)} ms, ` +
      `${Math.round((wasmBytes.byteLength + tarBytes.byteLength) / 1024)} KB toolchain)`, 'info');
  }

  /**
   * Turn Nim's C output into wcc translation units.
   * @param {{cfiles: Array<{name: string, data: Uint8Array}>, nimbase: string,
   *          runtimeC?: string, runtimeH?: string}} args
   * @returns {{tus: Array<{name: string, code: string}>, rewrites: number}}
   */
  prepare({ cfiles, nimbase, runtimeC, runtimeH }) {
    const decoder = new TextDecoder();
    let rewrites = 0;
    const tus = cfiles.map(({ name, data }) => {
      const tu = buildWccTU(name, decoder.decode(data), this._prologue, nimbase);
      rewrites += tu.rewrites;
      return { name, code: tu.code };
    });
    tus.push({ name: 'raise-stub.c', code: RAISE_STUB_C });
    if (runtimeC && runtimeH) tus.push({ name: 'bindweb_runtime.c', code: buildBindwebRuntimeTU(runtimeC, runtimeH) });
    return { tus, rewrites };
  }

  /**
   * Compile every TU (cache first, then the pool, largest first) and link.
   * @param {Array<{name: string, code: string}>} tus
   * @returns {Promise<{ok: boolean, wasm: Uint8Array|null, log: string}>}
   */
  async compileAndLink(tus) {
    if (!this._pool) throw new Error('wcc-compiler: init() has not completed');
    const t0 = performance.now();
    const enc = new TextEncoder();
    const keys = await Promise.all(tus.map((t) => sha256Hex(`${this._key}\0${t.code}`)));
    const objects = new Array(tus.length);
    if (this._cache) {
      const store = this._cache.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE);
      const hits = await Promise.all(keys.map((k) => idb(store.get(k)).catch(() => null)));
      hits.forEach((hit, i) => { if (hit && hit.bytes) objects[i] = hit.bytes; });
    }
    const missing = tus.map((t, i) => i).filter((i) => !objects[i]).sort((a, b) => tus[b].code.length - tus[a].code.length);
    const timings = [];
    const failures = [];
    await Promise.all(missing.map(async (i) => {
      const src = `/work/t${i}.c`, obj = `/work/t${i}.o`;
      const r = await this._pool.run(['-c', '-o', obj, src], [[src, enc.encode(tus[i].code)]], obj);
      timings.push({ name: tus[i].name, ms: r.ms, bytes: tus[i].code.length });
      if (r.code !== 0 || !r.out) failures.push(`${tus[i].name}:\n${errorLines(r.stderr) || `wcc exited with code ${r.code}`}`);
      else objects[i] = r.out;
    }));
    if (failures.length) {
      const log = `wcc: ${failures.length} translation unit(s) failed\n${failures.join('\n')}`;
      this.onLog(log.split('\n')[0], 'error');
      return { ok: false, wasm: null, log };
    }
    const tCompile = performance.now();
    if (this._cache && missing.length) {
      const now = Date.now();
      const store = this._cache.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE);
      for (const i of missing) store.put({ bytes: objects[i], used: now }, keys[i]);
    }
    if (timings.length) {
      const slow = timings.sort((a, b) => b.ms - a.ms).slice(0, 5)
        .map((t) => `${String(t.name).split('/').pop()} ${Math.round(t.ms)} ms (${Math.round(t.bytes / 1024)} KB)`);
      this.onLog(`wcc: slowest TUs: ${slow.join(', ')}`, 'info');
    }

    const objNames = tus.map((t, i) => `/work/t${i}.o`);
    const link = await this._pool.run([...WCC_LINK_FLAGS, '-o', '/work/app.wasm', ...objNames],
      objNames.map((n, i) => [n, objects[i]]), '/work/app.wasm');
    if (link.code !== 0 || !link.out) {
      const log = `wcc: link failed\n${errorLines(link.stderr) || `exit code ${link.code}`}`;
      this.onLog(log.split('\n')[0], 'error');
      return { ok: false, wasm: null, log };
    }
    this.onLog(`wcc: ${tus.length} TUs — ${tus.length - missing.length} from cache, ${missing.length} compiled on ` +
      `${this._pool.workers.length} workers (${Math.round(tCompile - t0)} ms) + link (${Math.round(performance.now() - tCompile)} ms)`, 'ok');
    this._prune();
    return { ok: true, wasm: link.out, log: '' };
  }

  /** Keep the object cache bounded (least recently used out). @private */
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
    } catch (e) { /* best effort */ }
  }
}
