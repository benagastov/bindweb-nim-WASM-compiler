// In-memory WASI preview1 for running cc.wasm (wcc) in a browser or worker.
// Only what wcc's libc calls is implemented. Files live in a Map keyed by
// absolute path; directories are implied by file paths plus `dirs`.

const E = { SUCCESS: 0, BADF: 8, EXIST: 20, INVAL: 28, ISDIR: 31, NOENT: 44, NOTDIR: 54, NOSYS: 52 };
const FT = { CHAR: 2, DIR: 3, FILE: 4 };

export class ExitError extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}

function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return '/' + out.join('/');
}

// A file system whose reads fall back to a shared, read-only `base` map.
export class MemFS {
  constructor(base = new Map()) {
    this.base = base;          // path -> Uint8Array (never mutated)
    this.files = new Map();    // path -> { buf, size } (this run's writes)
    this.removed = new Set();
    this.dirs = new Set(['/', '/tmp', '/work']);
    for (const p of base.keys()) this.addParents(p);
  }
  addParents(path) {
    for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) this.dirs.add(path.slice(0, i));
  }
  get(path) {
    const f = this.files.get(path);
    if (f) return f;
    if (this.removed.has(path) || !this.base.has(path)) return null;
    const data = this.base.get(path);
    return { buf: data, size: data.length, shared: true };
  }
  writable(path) {
    let f = this.files.get(path);
    if (!f) {
      const src = this.get(path);
      f = { buf: new Uint8Array(src ? Math.max(src.size, 256) : 256), size: 0 };
      if (src) { f.buf.set(src.buf.subarray(0, src.size)); f.size = src.size; }
      this.files.set(path, f);
      this.removed.delete(path);
      this.addParents(path);
    }
    return f;
  }
  create(path) {
    const f = { buf: new Uint8Array(4096), size: 0 };
    this.files.set(path, f);
    this.removed.delete(path);
    this.addParents(path);
    return f;
  }
  remove(path) { this.files.delete(path); this.removed.add(path); }
  read(path) { const f = this.get(path); return f ? f.buf.slice(0, f.size) : null; }
  write(path, data) { const f = this.create(path); f.buf = data; f.size = data.length; }
}

export function runWasi(module, { args, fs, cwd = '/work' }) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  let memory;
  const u8 = () => new Uint8Array(memory.buffer);
  const dv = () => new DataView(memory.buffer);
  const str = (ptr, len) => dec.decode(u8().subarray(ptr, ptr + len));
  const output = { stdout: '', stderr: '' };

  // fd table. 3 = "/" preopen, 4 = "." preopen (cwd).
  const fds = new Map([
    [0, { kind: 'stdin' }], [1, { kind: 'out', name: 'stdout' }], [2, { kind: 'out', name: 'stderr' }],
    [3, { kind: 'dir', path: '/', preopen: '/' }], [4, { kind: 'dir', path: cwd, preopen: '.' }],
  ]);
  let nextFd = 5;
  const resolvePath = (dirfd, ptr, len) => {
    const d = fds.get(dirfd);
    if (!d || d.kind !== 'dir') return null;
    const p = str(ptr, len);
    return normalize(p.startsWith('/') ? p : d.path + '/' + p);
  };
  const statInto = (ptr, ft, size) => {
    const v = dv();
    for (let i = 0; i < 64; i += 8) v.setBigUint64(ptr + i, 0n, true);
    v.setUint8(ptr + 16, ft);
    v.setBigUint64(ptr + 24, 1n, true);
    v.setBigUint64(ptr + 32, BigInt(size), true);
  };
  const iovs = (ptr, n) => {
    const v = dv(), out = [];
    for (let i = 0; i < n; i++) out.push([v.getUint32(ptr + i * 8, true), v.getUint32(ptr + i * 8 + 4, true)]);
    return out;
  };

  const wasi = {
    args_sizes_get(argcPtr, bufSizePtr) {
      dv().setUint32(argcPtr, args.length, true);
      dv().setUint32(bufSizePtr, args.reduce((n, a) => n + enc.encode(a).length + 1, 0), true);
      return E.SUCCESS;
    },
    args_get(argvPtr, bufPtr) {
      let p = bufPtr;
      args.forEach((a, i) => {
        dv().setUint32(argvPtr + i * 4, p, true);
        const b = enc.encode(a + '\0'); u8().set(b, p); p += b.length;
      });
      return E.SUCCESS;
    },
    environ_sizes_get(cPtr, sPtr) { dv().setUint32(cPtr, 0, true); dv().setUint32(sPtr, 0, true); return E.SUCCESS; },
    environ_get() { return E.SUCCESS; },
    clock_time_get(id, precision, outPtr) {
      dv().setBigUint64(outPtr, BigInt(Math.round(performance.now() * 1e6)), true);
      return E.SUCCESS;
    },
    random_get(ptr, len) { crypto.getRandomValues(u8().subarray(ptr, ptr + len)); return E.SUCCESS; },
    proc_exit(code) { throw new ExitError(code); },

    fd_prestat_get(fd, ptr) {
      const d = fds.get(fd);
      if (!d || !d.preopen) return E.BADF;
      dv().setUint8(ptr, 0);
      dv().setUint32(ptr + 4, enc.encode(d.preopen).length, true);
      return E.SUCCESS;
    },
    fd_prestat_dir_name(fd, ptr, len) {
      const d = fds.get(fd);
      if (!d || !d.preopen) return E.BADF;
      u8().set(enc.encode(d.preopen).subarray(0, len), ptr);
      return E.SUCCESS;
    },

    path_open(dirfd, dirflags, pathPtr, pathLen, oflags, rb, ri, fdflags, outPtr) {
      const path = resolvePath(dirfd, pathPtr, pathLen);
      if (path === null) return E.BADF;
      const isDir = fs.dirs.has(path);
      if (oflags & 2) {  // O_DIRECTORY
        if (!isDir) return E.NOTDIR;
        fds.set(nextFd, { kind: 'dir', path });
      } else {
        if (isDir) {
          fds.set(nextFd, { kind: 'dir', path });
        } else {
          const exists = fs.get(path) !== null;
          if ((oflags & 1) && (oflags & 4) && exists) return E.EXIST;  // CREAT|EXCL
          if (!exists && !(oflags & 1)) return E.NOENT;
          if (!exists || (oflags & 8)) fs.create(path);               // create or TRUNC
          fds.set(nextFd, { kind: 'file', path, pos: 0, append: !!(fdflags & 1) });
        }
      }
      dv().setUint32(outPtr, nextFd++, true);
      return E.SUCCESS;
    },
    fd_close(fd) { fds.delete(fd); return E.SUCCESS; },
    fd_read(fd, iovPtr, iovCnt, nreadPtr) {
      const d = fds.get(fd);
      if (!d) return E.BADF;
      if (d.kind === 'stdin') { dv().setUint32(nreadPtr, 0, true); return E.SUCCESS; }
      if (d.kind !== 'file') return E.ISDIR;
      const f = fs.get(d.path);
      let n = 0;
      for (const [p, l] of iovs(iovPtr, iovCnt)) {
        const k = Math.max(0, Math.min(l, f.size - d.pos));
        u8().set(f.buf.subarray(d.pos, d.pos + k), p);
        d.pos += k; n += k;
        if (k < l) break;
      }
      dv().setUint32(nreadPtr, n, true);
      return E.SUCCESS;
    },
    fd_write(fd, iovPtr, iovCnt, nwrittenPtr) {
      const d = fds.get(fd);
      if (!d) return E.BADF;
      let n = 0;
      for (const [p, l] of iovs(iovPtr, iovCnt)) {
        const chunk = u8().subarray(p, p + l);
        if (d.kind === 'out') output[d.name] += dec.decode(chunk);
        else {
          const f = fs.writable(d.path);
          if (d.append) d.pos = f.size;
          const need = d.pos + l;
          if (need > f.buf.length) {
            const nb = new Uint8Array(Math.max(need, f.buf.length * 2));
            nb.set(f.buf.subarray(0, f.size)); f.buf = nb;
          }
          f.buf.set(chunk, d.pos);
          d.pos += l;
          if (d.pos > f.size) f.size = d.pos;
        }
        n += l;
      }
      dv().setUint32(nwrittenPtr, n, true);
      return E.SUCCESS;
    },
    fd_seek(fd, offset, whence, outPtr) {
      const d = fds.get(fd);
      if (!d || d.kind !== 'file') return E.BADF;
      const size = fs.get(d.path)?.size ?? 0;
      const base = whence === 0 ? 0 : whence === 1 ? d.pos : size;
      const pos = base + Number(offset);
      if (pos < 0) return E.INVAL;
      d.pos = pos;
      dv().setBigUint64(outPtr, BigInt(pos), true);
      return E.SUCCESS;
    },
    fd_filestat_get(fd, ptr) {
      const d = fds.get(fd);
      if (!d) return E.BADF;
      if (d.kind === 'dir') statInto(ptr, FT.DIR, 0);
      else if (d.kind === 'file') statInto(ptr, FT.FILE, fs.get(d.path)?.size ?? 0);
      else statInto(ptr, FT.CHAR, 0);
      return E.SUCCESS;
    },
    fd_fdstat_get(fd, ptr) {
      const d = fds.get(fd);
      if (!d) return E.BADF;
      const v = dv();
      v.setUint8(ptr, d.kind === 'dir' ? FT.DIR : d.kind === 'file' ? FT.FILE : FT.CHAR);
      v.setUint16(ptr + 2, 0, true);
      v.setBigUint64(ptr + 8, 0xffffffffffffffffn, true);
      v.setBigUint64(ptr + 16, 0xffffffffffffffffn, true);
      return E.SUCCESS;
    },
    path_filestat_get(dirfd, flags, pathPtr, pathLen, ptr) {
      const path = resolvePath(dirfd, pathPtr, pathLen);
      if (path === null) return E.BADF;
      if (fs.dirs.has(path)) { statInto(ptr, FT.DIR, 0); return E.SUCCESS; }
      const f = fs.get(path);
      if (!f) return E.NOENT;
      statInto(ptr, FT.FILE, f.size);
      return E.SUCCESS;
    },
    path_unlink_file(dirfd, pathPtr, pathLen) {
      const path = resolvePath(dirfd, pathPtr, pathLen);
      if (!path || !fs.get(path)) return E.NOENT;
      fs.remove(path);
      return E.SUCCESS;
    },
    path_create_directory(dirfd, pathPtr, pathLen) {
      const path = resolvePath(dirfd, pathPtr, pathLen);
      if (!path) return E.BADF;
      if (fs.dirs.has(path)) return E.EXIST;
      fs.dirs.add(path); fs.addParents(path);
      return E.SUCCESS;
    },
    path_remove_directory(dirfd, pathPtr, pathLen) {
      const path = resolvePath(dirfd, pathPtr, pathLen);
      if (!path || !fs.dirs.has(path)) return E.NOENT;
      fs.dirs.delete(path);
      return E.SUCCESS;
    },
    path_rename(fd1, p1, l1, fd2, p2, l2) {
      const from = resolvePath(fd1, p1, l1), to = resolvePath(fd2, p2, l2);
      const data = from && fs.read(from);
      if (!data) return E.NOENT;
      fs.write(to, data); fs.remove(from);
      return E.SUCCESS;
    },
  };

  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi });
  memory = instance.exports.memory;
  let code = 0;
  try {
    instance.exports._start();
  } catch (e) {
    if (e instanceof ExitError) code = e.code;
    else { output.stderr += `\n[trap] ${e && e.message}`; code = 134; }
  }
  return { code, ...output };
}
