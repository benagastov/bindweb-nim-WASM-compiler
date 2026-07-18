/**
 * wasi-shim.js — WASI (preview1) host shim for running app.wasm in a page.
 *
 * app.wasm is linked with crt1.o + wasi-libc, so besides the bindweb "env"
 * imports it imports WASI syscalls from "wasi_unstable"/"wasi_snapshot_preview1".
 * The bindweb runtime only provides "env", so this shim covers the rest. Its
 * memory is wired after instantiation (exports.memory).
 *
 * Ported from the legacy IDE step 3. This file is used TWO ways:
 *   1. imported by web/src/pipeline.js for the in-IDE Run button;
 *   2. fetched as text and inlined into the deployed static site by the
 *      Build flow (site-template.js strips the `export` prefixes), so the
 *      site runs the EXACT same code the IDE ran.
 * Keep it dependency-free: no imports, `export` only at the start of a line.
 */

const WASI_ESUCCESS = 0;
const WASI_EBADF = 8;

/** Thrown by the shim's proc_exit; exit(0) is normal completion. */
export class ProcExit extends Error {
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
export function createWasiShim(onLog) {
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
