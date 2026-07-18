/**
 * run-wasm.js — instantiate a freshly linked app.wasm and run it in a page.
 *
 * This is the shared "step 4" of the build pipeline: import reflection
 * ("env" -> bindweb runtime, "wasi_*" -> shim, anything else -> a safe
 * no-op), memory wiring, _start()/main() invocation, the trailing bindweb
 * flush, and the event-loop kick. Ported from the legacy IDE step 3.
 *
 * Like wasi-shim.js this file is consumed two ways (imported by
 * pipeline.js; inlined into the deployed static site by Build), so it has
 * NO imports: every collaborator is passed in by the caller.
 *
 * @param {object} args
 * @param {Uint8Array} args.wasmBytes linked app.wasm
 * @param {HTMLElement} args.outputEl DOM container the app renders into
 * @param {(msg: string, kind?: string) => void} args.onLog log sink
 * @param {(el: HTMLElement) => object} args.createBindwebRunner bindweb runtime factory
 * @param {(onLog: Function) => {impl: object, setMemory: Function}} args.createWasiShim
 * @param {Function} args.ProcExit the ProcExit class from wasi-shim.js
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function runWasmApp({ wasmBytes, outputEl, onLog, createBindwebRunner, createWasiShim, ProcExit }) {
  try {
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const runner = createBindwebRunner(outputEl);
    const wasi = createWasiShim(onLog);

    // Build the import object by reflecting over what the module actually
    // needs (ported from legacy IDE step 3).
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

    if (!ranOk) return { ok: false, error: 'app ran but reported a failure' };
    return { ok: true };
  } catch (e) {
    onLog(`run failed: ${e.message || e}`, 'error');
    if (e.stack) onLog(String(e.stack).split('\n').slice(0, 4).join('\n'), 'stderr');
    return { ok: false, error: `run failed: ${e.message || e}` };
  }
}
