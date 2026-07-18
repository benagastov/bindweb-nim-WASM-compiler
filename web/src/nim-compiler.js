/**
 * nim-compiler.js — loads the Emscripten-built Nim compiler (nim.wasm)
 * and drives it to compile Nim source down to C inside the browser.
 *
 * The compiler ships as `vendor/nim/nim-bundle.js`, an Emscripten
 * MODULARIZE build with EXPORT_NAME "Nim" (see toolchain/nim/build.sh:
 * `-s MODULARIZE=1 -s EXPORT_NAME=Nim -s EXIT_RUNTIME=1`). A FRESH module
 * instance is created per compile() because EXIT_RUNTIME=1 shuts the
 * runtime down after each callMain; init() therefore prepares a factory
 * plus everything a fresh instance needs (manifest, nimbase.h). The
 * prebuilt preview artifacts (SPEC §8d) use the older singleton glue
 * (global FS/callMain); that shape is detected and reused per compile
 * instead.
 *
 * stdout/stderr capture, the nimcache layout, and the flag set are ported
 * from the legacy IDE (/mnt/agents/repo/IDE/index.html, steps 1 and 1b)
 * with the SPEC §5 canonical paths (/project, /project/cache, libpack
 * mounts /nim/lib, /nim/config, /bindweb) replacing the old baked-in
 * bundle paths (/tmp, /lib/pure).
 */

import { fetchManifest, mountLibpacks } from './libpacks.js';

/** Emscripten EXPORT_NAME of the compiler module factory. */
const EXPORT_NAME = 'Nim';

/**
 * Canonical Nim flag set (SPEC §5, verified against the legacy IDE
 * index.html STEP 1). The legacy argv was:
 *
 *   ['c', '--hints:off', '-d:release', '-d:useMalloc', '-d:wasm',
 *    '--path:/lib/pure', '--path:/lib/pure/collections', '--path:/lib/core',
 *    '--path:/lib/pure/bindweb', '-o:/tmp/user', '/tmp/user.nim']
 *
 * with --os:linux/--cpu:wasm32 baked in as the compiler binary's own
 * default target (toolchain/nim/build.sh compiles nim.wasm with
 * `--os:linux --cpu:wasm32`). Keeping them here is redundant but explicit
 * and matches SPEC §5.
 *
 * `-d:wasm` is CRITICAL (old IDE comment): it selects the real importc
 * command-buffer layer in bindweb.nim/apis — without it the
 * `when defined(wasm)` else-branch compiles the push/flush command
 * functions to no-ops.
 *
 * DOCUMENTED DEVIATIONS from SPEC §5:
 *  1. `--noMain:on` is intentionally NOT passed. The old IDE did not pass
 *     it, and the whole C-cleaner fixup (SPEC §6.1, the 3-arg -> 2-arg
 *     main rewrite) only exists because nim DOES emit
 *     `main(argc, args, env)`. With --noMain:on nim emits no main at all,
 *     so wasi crt1's _start would call an undefined import and the
 *     program would silently do nothing.
 *  2. SPEC §5's `--noLink:on` is spelled `--noLinking:on` here: that is
 *     the actual Nim option (`nim --fullhelp`); `--noLink` is rejected
 *     with "invalid command line option" (verified against the pinned
 *     nim.wasm build). --noLinking/--compileOnly stop nim from invoking a
 *     (nonexistent) host C linker, which is exactly what the old IDE
 *     relied on before scraping the nimcache.
 *  3. `--path:/bindweb/nim` is added next to `--path:/bindweb`: the
 *     bindweb libpack (libpacks/src/bindweb/) ships its Nim modules under
 *     nim/ (e.g. bindweb/nim/bindweb.nim), which mounts at
 *     /bindweb/nim/bindweb.nim. Both paths are passed so either pack
 *     layout resolves `import bindweb`.
 */
const NIM_FLAGS = [
  'c',
  '--hints:off', // extra flag used by the legacy IDE (step 1)
  '--os:linux', '--cpu:wasm32', '--mm:arc', '--panics:on',
  '-d:useMalloc', '-d:wasm',
  // Nim 2.0 made --threads:on the DEFAULT. That pulls in std/typedthreads,
  // std/private/syslocks and threadtypes, which emit thread-local (__thread /
  // NIM_THREADVAR) variables. The in-browser linker is wasm-ld from binji's
  // LLVM 8.0.1 fork, which predates WebAssembly TLS relocations, so it rejects
  // those objects at link time with:
  //     wasm-ld: error: <obj>.o: invalid data symbol index
  // (observed as w30.o = std/typedthreads.nim.c). There are no threads in this
  // single-threaded wasm target anyway, so turn them off explicitly: this drops
  // the thread TUs entirely and takes TLS symbols from 3 files to 0.
  '--threads:off',
  '--noLinking:on', '--compileOnly:on',
  '--nimcache:/project/cache',
  '--path:/bindweb', '--path:/bindweb/nim', '--path:/nim/lib',
  '-d:release',
  '-o:main.wasm',
];

/**
 * nimcache candidates, in priority order. The first entry is the SPEC §5
 * location requested via --nimcache; the rest are the legacy IDE's
 * discovery list (step 1b), kept as a fallback in case a future nim.wasm
 * ignores the flag.
 */
const NIMCACHE_DIRS = [
  '/project/cache',
  '/home/web_user/.cache/nim/main_r',
  '/home/web_user/.cache/nim/main_d',
  '/home/web_user/.cache/nim/user_r',
  '/home/web_user/.cache/nim/user_d',
  '/tmp/nimcache/user_r',
  '/tmp/.nimcache/user_r',
];

/**
 * Inject a classic <script> tag and wait for it to load.
 *
 * @param {string} url script URL
 * @returns {Promise<void>}
 */
function injectScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load script ${url}`));
    document.head.appendChild(el);
  });
}

/**
 * Load the Emscripten module named "Nim". Handles all glue shapes the
 * build can produce:
 *  - MODULARIZE (the SPEC §4 shape): a factory callable, either as an
 *    ES-module export (EXPORT_ES6) or as a global `Nim` function after a
 *    classic <script> tag;
 *  - LEGACY singleton glue (the prebuilt preview artifacts,
 *    SPEC §8d): the script runs at load, reads a pre-set global `Nim`
 *    object as its Module overrides (`var Module = typeof Nim != "undefined"
 *    ? Nim : {}`), and exposes global FS/callMain once the runtime is up.
 *
 * @param {string} url URL of nim-bundle.js (document-relative, e.g.
 *   './vendor/nim/nim-bundle.js')
 * @param {(path: string) => string} locateFile maps wasm/data file names
 *   to URLs (also serves preloaded blobs)
 * @returns {Promise<{kind: 'factory', factory: Function} |
 *   {kind: 'legacy', module: object}>}
 * @throws {Error} if no usable glue can be obtained
 */
async function loadNimGlue(url, locateFile) {
  if (typeof globalThis[EXPORT_NAME] === 'function') {
    return { kind: 'factory', factory: globalThis[EXPORT_NAME] };
  }
  // Resolve against the document: dynamic import() would otherwise treat
  // the relative URL as relative to THIS module (web/src/), not the page.
  const absUrl = new URL(url, document.baseURI).href;
  // Try ES-module glue first: if the build used EXPORT_ES6 the file
  // contains `export` statements and a classic <script> would fail.
  try {
    const ns = await import(absUrl);
    if (typeof ns[EXPORT_NAME] === 'function') return { kind: 'factory', factory: ns[EXPORT_NAME] };
    if (typeof ns.default === 'function') return { kind: 'factory', factory: ns.default };
    if (typeof globalThis[EXPORT_NAME] === 'function') {
      return { kind: 'factory', factory: globalThis[EXPORT_NAME] };
    }
  } catch (e) {
    // Not an ES module — fall through to the classic script tag.
  }

  // Pre-set the global Module overrides the legacy glue reads. A
  // MODULARIZE classic script simply overwrites this with its factory.
  let runtimeReady;
  const readyPromise = new Promise((resolve) => { runtimeReady = resolve; });
  if (typeof globalThis[EXPORT_NAME] !== 'function') {
    globalThis[EXPORT_NAME] = {
      noInitialRun: true,
      locateFile,
      onRuntimeInitialized: () => runtimeReady(),
    };
  }
  await injectScript(absUrl);

  if (typeof globalThis[EXPORT_NAME] === 'function') {
    return { kind: 'factory', factory: globalThis[EXPORT_NAME] };
  }
  // Legacy singleton glue: wait for the runtime (wasm + data file) to come
  // up, then wrap the globals in a module-shaped object. The glue sets
  // Module.calledRun=true and fires Module.onRuntimeInitialized once
  // ready; poll both in case the callback fired before we subscribed.
  const deadline = Date.now() + 120000;
  for (;;) {
    const mod = globalThis[EXPORT_NAME];
    if (globalThis.FS && globalThis.callMain && mod && mod.calledRun) break;
    if (Date.now() > deadline) {
      throw new Error('nim-compiler: legacy nim-bundle.js runtime did not initialize');
    }
    await Promise.race([readyPromise, new Promise((r) => setTimeout(r, 100))]);
  }
  return {
    kind: 'legacy',
    module: {
      FS: globalThis.FS,
      ENV: globalThis.ENV || {},
      callMain: (argv) => globalThis.callMain(argv),
      __singleton: true,
    },
  };
}

/**
 * Wrap an Emscripten MODULARIZE factory call so both Promise-returning
 * and `.ready`-style glue resolve to the initialized module.
 *
 * @param {(opts: object) => any} factory
 * @param {object} opts module arguments
 * @returns {Promise<object>} initialized module
 */
async function instantiate(factory, opts) {
  const result = factory(opts);
  if (result && typeof result.then === 'function') return await result;
  if (result && result.ready && typeof result.ready.then === 'function') {
    return await result.ready;
  }
  return result;
}

/**
 * Browser-side Nim compiler: Nim source -> C translation units.
 */
export class NimCompiler {
  /**
   * @param {{vendorUrl: string, libpacksUrl: string,
   *          onLog?: (msg: string, kind?: string) => void,
   *          preloaded?: Map<string, Blob>}} config
   *   vendorUrl: base URL of the vendor directory (e.g. './vendor')
   *   libpacksUrl: base URL of the libpacks directory (e.g. './libpacks')
   *   onLog: progress logger
   *   preloaded: optional basename -> Blob map for vendor files the UI
   *     already downloaded while showing progress (e.g. 'nim.wasm',
   *     'nim-bundle.data'); locateFile then serves them from blob: URLs
   *     instead of fetching them a second time.
   */
  constructor({ vendorUrl, libpacksUrl, onLog = () => {}, preloaded = null }) {
    this.vendorUrl = vendorUrl;
    this.libpacksUrl = libpacksUrl;
    this.onLog = onLog;
    this.preloaded = preloaded;
    /** @private */ this._glue = null; // {kind:'factory',factory} | {kind:'legacy',module}
    /** @private */ this._manifest = null;
    /** @private */ this._nimbaseHeader = '';
    /** @private */ this._lastModule = null;
    /** @private */ this._blobUrls = new Map();
  }

  /**
   * Load vendor/nim/nim-bundle.js, fetch + validate the libpack manifest,
   * and fetch nimbase.h (inlined into every C translation unit later by
   * the pipeline — ported from the legacy IDE's combined header).
   *
   * @returns {Promise<void>}
   */
  async init() {
    this.onLog(`nim: loading ${this.vendorUrl}/nim/nim-bundle.js`, 'info');
    this._glue = await loadNimGlue(`${this.vendorUrl}/nim/nim-bundle.js`, (p) => this._locateFile(p));
    if (this._glue.kind === 'legacy') {
      this.onLog('nim: legacy (non-modularize) glue detected — reusing the singleton module per compile', 'warn');
    }

    this._manifest = await fetchManifest(this.libpacksUrl);
    this.onLog(`nim: libpack manifest ok (${this._manifest.packs.length} packs)`, 'info');

    try {
      const res = await fetch(`${this.vendorUrl}/nim/nimbase.h`);
      if (res.ok) {
        this._nimbaseHeader = await res.text();
        this.onLog(`nim: nimbase.h ready (${this._nimbaseHeader.length} chars)`, 'info');
      } else {
        this.onLog(`nim: nimbase.h fetch failed (HTTP ${res.status}) — C compile will likely fail`, 'warn');
      }
    } catch (e) {
      this.onLog(`nim: nimbase.h fetch failed: ${e.message || e}`, 'warn');
    }
  }

  /**
   * The nimbase.h header text fetched during init (used by the pipeline
   * to build the combined C prologue).
   *
   * @returns {string}
   */
  get nimbaseHeader() {
    return this._nimbaseHeader;
  }

  /**
   * locateFile for the Emscripten glue: maps `nim-bundle.wasm` onto the
   * renamed `nim.wasm` (toolchain/nim/build.sh renames the emcc output),
   * resolves nim-bundle.data alongside the glue, and serves files the UI
   * already downloaded (progress prefetch) from blob: URLs so first-visit
   * megabytes are never fetched twice (SPEC §8c).
   *
   * @private
   * @param {string} path file name the glue is looking for
   * @returns {string} URL to load it from
   */
  _locateFile(path) {
    const name = path === 'nim-bundle.wasm' ? 'nim.wasm' : path;
    if (this.preloaded && this.preloaded.has(name)) {
      let blobUrl = this._blobUrls.get(name);
      if (!blobUrl) {
        blobUrl = URL.createObjectURL(this.preloaded.get(name));
        this._blobUrls.set(name, blobUrl);
      }
      return blobUrl;
    }
    return `${this.vendorUrl}/nim/${name}`;
  }

  /**
   * Provide an Emscripten module instance with libpacks mounted. With
   * MODULARIZE glue a FRESH instance is created per compile (SPEC §4:
   * EXIT_RUNTIME=1 semantics); with legacy singleton glue the same module
   * is reused (the stale /project/cache is cleared so nimcache scraping
   * only sees the current compile).
   *
   * @private
   * @returns {Promise<object>} initialized module with FS + callMain
   */
  async _createModule() {
    let module;
    if (this._glue.kind === 'factory') {
      module = await instantiate(this._glue.factory, {
        noInitialRun: true,
        locateFile: (p) => this._locateFile(p),
      });
    } else {
      module = this._glue.module;
      // Singleton reuse: drop the previous compile's cache + captures.
      for (const stale of ['/project/cache', '/project/out.txt', '/project/err.txt']) {
        try { module.FS.unlink(stale); } catch (e) { /* missing or a dir */ }
        try {
          for (const f of module.FS.readdir(stale)) module.FS.unlink(`${stale}/${f}`);
          module.FS.rmdir(stale);
        } catch (e) { /* not a dir / missing */ }
      }
    }
    const FS = module.FS;
    FS.mkdirTree('/project');
    FS.mkdirTree('/project/cache');

    // --- wasi getAppFilename() fix -------------------------------------------
    // nim.wasm is built with --os:linux, so getAppFilename() resolves the exe
    // path via readlink("/proc/self/exe"). Under Emscripten/wasi that file does
    // not exist, readlink returns -1, and Nim's os.getApplAux does
    // setLen(result, -1) -> "value out of range: -1 notin 0 .. 2147483647"
    // [RangeDefect] at compiler boot, before any user code is read.
    //
    // Providing the symlink makes readlink succeed AND makes the compiler's
    // prefix resolve to /nim: getPrefixDir = dirname(dirname(getAppFilename())),
    // so a target of /nim/bin/nim yields prefixDir=/nim => libpath=/nim/lib and
    // config=/nim/config, which is exactly where the libpacks are mounted.
    // The target need not exist; readlink only returns the stored link string.
    FS.mkdirTree('/proc/self');
    try {
      FS.symlink('/nim/bin/nim', '/proc/self/exe');
    } catch (e) {
      /* EEXIST on singleton-module reuse: link already present, fine. */
    }

    await mountLibpacks(FS, this._manifest, this.libpacksUrl, (m) => this.onLog(m, 'info'));
    return module;
  }

  /**
   * Read a file from the FS of the most recent compile's module instance
   * (e.g. /bindweb/c/bindweb_runtime.c from a mounted libpack). Returns
   * null when the file does not exist.
   *
   * @param {string} path absolute MEMFS path
   * @returns {Uint8Array|null} file contents, or null if missing
   * @throws {Error} if compile() has never run
   */
  readLibFile(path) {
    if (!this._lastModule) {
      throw new Error('nim-compiler: readLibFile() called before compile()');
    }
    try {
      return this._lastModule.FS.readFile(path);
    } catch (e) {
      return null;
    }
  }

  /**
   * Compile Nim source to C translation units.
   *
   * Ported from the legacy IDE step 1 / 1b: the source is written to
   * /project/main.nim, FDs 1/2 are redirected to /project/out.txt and
   * /project/err.txt (nim.wasm writes through Emscripten's TTY layer, so
   * swapping FS.streams is the reliable capture mechanism), callMain runs
   * the SPEC §5 flag set, and every *.nim.c / *.nim.cpp under the
   * nimcache is read back.
   *
   * @param {string} source Nim source code
   * @param {{flags?: string[], outFile?: string}} [options]
   *   flags: full replacement argv for the nim invocation (default: SPEC §5 set)
   *   outFile: MEMFS path of the source file (default: /project/main.nim)
   * @returns {Promise<{ok: boolean, cfiles: Array<{name: string, data: Uint8Array}>,
   *   stdout: string, stderr: string, rc: number}>}
   */
  async compile(source, options = {}) {
    if (!this._glue) throw new Error('nim-compiler: init() has not completed');
    const module = await this._createModule();
    this._lastModule = module;
    const FS = module.FS;

    const outFile = options.outFile || '/project/main.nim';
    FS.writeFile(outFile, source);

    // -- TTY redirection (ported from legacy IDE index.html, step 1) -----
    const stdoutPath = '/project/out.txt';
    const stderrPath = '/project/err.txt';
    try { FS.writeFile(stdoutPath, ''); } catch (e) { /* ignore */ }
    try { FS.writeFile(stderrPath, ''); } catch (e) { /* ignore */ }

    const argv = options.flags || [...NIM_FLAGS, outFile];
    let rc = -1;
    let stdoutBuf = '';
    let stderrBuf = '';

    const stdoutFd = FS.open(stdoutPath, 'w');
    const stderrFd = FS.open(stderrPath, 'w');
    const origStdout = FS.streams[1];
    const origStderr = FS.streams[2];
    FS.streams[1] = stdoutFd;
    FS.streams[2] = stderrFd;
    try {
      rc = module.callMain(argv);
    } catch (e) {
      stderrBuf += `[nim] callMain threw: ${e && e.message ? e.message : e}\n`;
      rc = -1;
    } finally {
      // Flush and restore (ported from legacy IDE index.html, step 1).
      try { FS.close(stdoutFd); } catch (e) { /* ignore */ }
      try { FS.close(stderrFd); } catch (e) { /* ignore */ }
      FS.streams[1] = origStdout;
      FS.streams[2] = origStderr;
    }

    try { stdoutBuf = FS.readFile(stdoutPath, { encoding: 'utf8' }) + stdoutBuf; } catch (e) { /* ignore */ }
    try { stderrBuf = FS.readFile(stderrPath, { encoding: 'utf8' }) + stderrBuf; } catch (e) { /* ignore */ }

    // -- Collect C files from the nimcache (ported from step 1b) --------
    let cacheDir = null;
    for (const d of NIMCACHE_DIRS) {
      try { FS.readdir(d); cacheDir = d; break; } catch (e) { /* keep looking */ }
    }

    const cfiles = [];
    if (cacheDir) {
      const names = FS.readdir(cacheDir)
        .filter((f) => f.endsWith('.nim.c') || f.endsWith('.nim.cpp'))
        .sort();
      for (const name of names) {
        cfiles.push({ name, data: FS.readFile(`${cacheDir}/${name}`) });
      }
      this.onLog(`nim: ${cfiles.length} C files from ${cacheDir} (rc=${rc})`, 'info');
    } else {
      stderrBuf += `[nim] no nimcache directory found (tried ${NIMCACHE_DIRS.join(', ')})\n`;
    }

    // Presence of C files is the real success signal (step 1b); some
    // Emscripten glue versions return undefined from callMain on success,
    // so an undefined rc is not treated as failure.
    const ok = cfiles.length > 0 && (rc === 0 || rc === null || rc === undefined);
    return { ok, cfiles, stdout: stdoutBuf, stderr: stderrBuf, rc };
  }
}
