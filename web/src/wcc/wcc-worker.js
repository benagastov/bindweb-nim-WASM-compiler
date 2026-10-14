// Compile jobs for cc.wasm (wcc). Each job gets a fresh copy-on-write view of
// the shared base files, so workers never see each other's temp files.
import { MemFS, runWasi } from './memwasi.js';

let module = null;
let base = null;

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    module = msg.module;
    base = new Map(msg.files);
    self.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'job') {
    const fs = new MemFS(base);
    for (const [path, data] of msg.files || []) fs.write(path, data);
    const t = performance.now();
    const r = runWasi(module, { args: ['wcc', ...msg.args], fs });
    const ms = performance.now() - t;
    const out = msg.output ? fs.read(msg.output) : null;
    self.postMessage({ type: 'done', id: msg.id, code: r.code, stderr: r.stderr, stdout: r.stdout, ms, out },
      out ? [out.buffer] : []);
  }
};
