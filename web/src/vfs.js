/**
 * vfs.js — a tiny virtual file system persisted in IndexedDB, giving the
 * playground two VS-Code-style working folders:
 *
 *   IndexedDB "nim-playground-vfs"
 *     object store "workspace"  — the Nim working folder (the codebase:
 *                                 .nim sources edited in the Code tab,
 *                                 mounted at /workspace on every compile)
 *     object store "site"       — the deployed static webpage folder
 *                                 (Build output: index.html + app.wasm +
 *                                 the runtime; the app pane renders it)
 *
 * Record shape (keyPath "path"):
 *
 *   { path: 'src/main.nim',  // normalized, no leading slash
 *     isDir: false,          // folders are explicit records so empty
 *                            // folders can exist (like VS Code)
 *     data: Uint8Array,      // empty for folders
 *     updatedAt: 1720000000000 }
 *
 * The pure path helpers at the top are exported for the unit tests
 * (tests/vfs.test.mjs) — everything below the DB section touches
 * indexedDB only inside functions, so importing this module in Node is safe.
 */

const DB_NAME = 'nim-playground-vfs';
const DB_VERSION = 1;

/** The two working folders. */
export const AREA_WORKSPACE = 'workspace';
export const AREA_SITE = 'site';

/* --------------------------------------------------------------------------
 * Pure path helpers (no browser state).
 * ------------------------------------------------------------------------ */

/**
 * Normalize a user-supplied VFS path to the canonical stored form:
 * forward slashes, no leading/trailing slash, no "." or empty segments,
 * ".." resolved (never escaping the root).
 *
 * @param {string} input e.g. '/src//util/../main.nim'
 * @returns {string} e.g. 'src/main.nim'
 * @throws {Error} on an empty/root result
 */
export function normalizeVfsPath(input) {
  const parts = [];
  for (const seg of String(input || '').trim().replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) throw new Error(`path escapes the folder root: "${input}"`);
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  if (parts.length === 0) throw new Error('path must name a file or folder inside the working folder');
  return parts.join('/');
}

/**
 * Normalize a path that may name a folder; returns null for the root
 * instead of throwing (callers use it for "delete everything under x/").
 *
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeVfsPathOrNull(input) {
  try {
    return normalizeVfsPath(input);
  } catch (e) {
    return null;
  }
}

/**
 * Parent folder of a normalized path ('' for top-level entries).
 *
 * @param {string} path 'src/util/x.nim'
 * @returns {string} 'src/util' (or '' for 'x.nim')
 */
export function parentDirPath(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/**
 * Final segment of a normalized path.
 *
 * @param {string} path 'src/util/x.nim'
 * @returns {string} 'x.nim'
 */
export function baseName(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * Heuristic binary sniff: NUL byte inside the first 8 KB means this is
 * not a text file (used to keep the editor from opening wasm/binaries).
 *
 * @param {Uint8Array} data
 * @returns {boolean}
 */
export function isLikelyBinary(data) {
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) {
    if (data[i] === 0) return true;
  }
  return false;
}

/* --------------------------------------------------------------------------
 * IndexedDB plumbing.
 * ------------------------------------------------------------------------ */

/** Open (and on first use, create) the database. */
function openDb() {
  return new Promise((resolve, reject) => {
    // indexedDB is an IDBFactory object, so feature-test by presence, not type.
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of [AREA_WORKSPACE, AREA_SITE]) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'path' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('could not open the file store'));
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('file store request failed'));
  });
}

async function withStore(area, mode, fn) {
  if (area !== AREA_WORKSPACE && area !== AREA_SITE) {
    throw new Error(`vfs: unknown area "${area}"`);
  }
  const db = await openDb();
  try {
    return await fn(db.transaction(area, mode).objectStore(area));
  } finally {
    db.close();
  }
}

const encoder = new TextEncoder();

/* --------------------------------------------------------------------------
 * Public API.
 * ------------------------------------------------------------------------ */

/**
 * List every record in an area, metadata only (file payloads stripped).
 * Folders and files interleave in path order; the tree UI derives the
 * hierarchy from the paths.
 *
 * @param {string} area AREA_WORKSPACE | AREA_SITE
 * @returns {Promise<Array<{path: string, isDir: boolean, size: number, updatedAt: number}>>}
 */
export async function listFiles(area) {
  const all = await withStore(area, 'readonly', (store) => reqToPromise(store.getAll()));
  return all
    .map(({ path, isDir, data, updatedAt }) => ({
      path,
      isDir: !!isDir,
      size: data ? data.length : 0,
      updatedAt: updatedAt || 0,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Read one file's bytes.
 *
 * @param {string} area
 * @param {string} path normalized path
 * @returns {Promise<Uint8Array|null>} contents, or null if missing / a folder
 */
export async function readFile(area, path) {
  const rec = await withStore(area, 'readonly', (store) => reqToPromise(store.get(path)));
  if (!rec || rec.isDir) return null;
  return rec.data;
}

/**
 * Full file records including contents — used to mount the workspace into
 * MEMFS before a compile, and to render the deployed site. Folders are
 * skipped (MEMFS/site blobs only need real files).
 *
 * @param {string} area
 * @returns {Promise<Array<{path: string, data: Uint8Array}>>}
 */
export async function getFilesWithData(area) {
  const all = await withStore(area, 'readonly', (store) => reqToPromise(store.getAll()));
  return all
    .filter((rec) => !rec.isDir)
    .map(({ path, data }) => ({ path, data }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Create or replace a file. Parent folders are created implicitly as
 * explicit folder records (so they survive the file later being deleted).
 *
 * @param {string} area
 * @param {string} rawPath user-supplied path (normalized here)
 * @param {Uint8Array | string} data file contents
 * @returns {Promise<string>} the normalized path stored
 */
export async function writeFile(area, rawPath, data) {
  const path = normalizeVfsPath(rawPath);
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  await withStore(area, 'readwrite', async (store) => {
    await ensureParents(store, path);
    await reqToPromise(store.put({ path, isDir: false, data: bytes, updatedAt: Date.now() }));
  });
  return path;
}

/**
 * Create a folder record (and any missing parents). Idempotent.
 *
 * @param {string} area
 * @param {string} rawPath
 * @returns {Promise<string>} the normalized path stored
 */
export async function makeDir(area, rawPath) {
  const path = normalizeVfsPath(rawPath);
  await withStore(area, 'readwrite', async (store) => {
    const existing = await reqToPromise(store.get(path));
    if (existing && !existing.isDir) {
      throw new Error(`a file named "${path}" already exists`);
    }
    await ensureParents(store, path);
    if (!existing) {
      await reqToPromise(store.put({ path, isDir: true, data: new Uint8Array(0), updatedAt: Date.now() }));
    }
  });
  return path;
}

/** Create explicit folder records for every ancestor of `path`. */
async function ensureParents(store, path) {
  let dir = parentDirPath(path);
  const chain = [];
  while (dir) {
    chain.unshift(dir);
    dir = parentDirPath(dir);
  }
  for (const p of chain) {
    const existing = await reqToPromise(store.get(p));
    if (existing && !existing.isDir) {
      throw new Error(`a file named "${p}" blocks the folder of the same name`);
    }
    if (!existing) {
      await reqToPromise(store.put({ path: p, isDir: true, data: new Uint8Array(0), updatedAt: Date.now() }));
    }
  }
}

/**
 * Delete a file, or a folder together with everything under it.
 *
 * @param {string} area
 * @param {string} path normalized path
 * @returns {Promise<number>} how many records were deleted
 */
export async function deletePath(area, path) {
  return withStore(area, 'readwrite', async (store) => {
    const rec = await reqToPromise(store.get(path));
    if (!rec) return 0;
    let count = 0;
    const prefix = `${path}/`;
    if (rec.isDir) {
      const all = await reqToPromise(store.getAllKeys());
      for (const key of all) {
        if (typeof key === 'string' && key.startsWith(prefix)) {
          await reqToPromise(store.delete(key));
          count++;
        }
      }
    }
    await reqToPromise(store.delete(path));
    return count + 1;
  });
}

/**
 * Rename/move a file, or a folder with everything under it.
 *
 * @param {string} area
 * @param {string} fromRaw current path
 * @param {string} toRaw new path
 * @returns {Promise<{from: string, to: string, moved: number}>}
 */
export async function renamePath(area, fromRaw, toRaw) {
  const from = normalizeVfsPath(fromRaw);
  const to = normalizeVfsPath(toRaw);
  if (from === to) return { from, to, moved: 0 };
  if (to.startsWith(`${from}/`)) {
    throw new Error('a folder cannot be moved into itself');
  }
  return withStore(area, 'readwrite', async (store) => {
    const rec = await reqToPromise(store.get(from));
    if (!rec) throw new Error(`"${from}" does not exist`);
    if (await reqToPromise(store.get(to))) {
      throw new Error(`"${to}" already exists`);
    }
    await ensureParents(store, to);
    let moved = 0;
    const moveOne = async (oldPath, record) => {
      const newPath = to + oldPath.slice(from.length);
      await reqToPromise(store.put({ ...record, path: newPath, updatedAt: Date.now() }));
      await reqToPromise(store.delete(oldPath));
      moved++;
    };
    if (rec.isDir) {
      const all = await reqToPromise(store.getAll());
      // Deepest-first so children land before their folder record moves.
      const children = all
        .filter((r) => r.path.startsWith(`${from}/`))
        .sort((a, b) => b.path.length - a.path.length);
      for (const child of children) await moveOne(child.path, child);
    }
    await moveOne(from, rec);
    return { from, to, moved };
  });
}

/**
 * Remove every record in an area.
 *
 * @param {string} area
 * @returns {Promise<void>}
 */
export async function clearArea(area) {
  await withStore(area, 'readwrite', (store) => reqToPromise(store.clear()));
}
