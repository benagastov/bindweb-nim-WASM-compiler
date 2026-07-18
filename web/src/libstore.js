/**
 * libstore.js — user-installed Nim libraries, persisted in IndexedDB.
 *
 * Unlike the shipped libpacks (libpacks/*.tar, rebuilt by tools/pack-lib.sh),
 * these are libraries the END USER adds at runtime — from a GitHub link or an
 * uploaded zip (see libimport.js). They live entirely in the browser:
 *
 *   IndexedDB "nim-playground-libs"
 *     object store "libs" (keyPath "id")
 *
 * One record per library:
 *
 *   {
 *     id:         'protobuf-nim',           // slug, also the store key
 *     name:       'protobuf-nim',           // display name
 *     mount:      '/libs/protobuf-nim',     // MEMFS mount point (+ --path flag)
 *     source:     { kind: 'github', url, ref } | { kind: 'zip', filename },
 *     addedAt:    1720000000000,            // Date.now()
 *     fileCount:  3,
 *     totalBytes: 60874,
 *     requires:   ['some-dep'],             // parsed from *.nimble (excl. "nim")
 *     files:      [{ path: 'protobuf.nim', data: Uint8Array }, ...]
 *   }
 *
 * The compiler mounts every record's files under `mount` before each compile
 * and adds `--path:<mount>` to the nim invocation (web/src/nim-compiler.js),
 * so `import <module>` just works. Everything is re-read from IndexedDB on
 * every compile, so adds/removes take effect on the next Run — no reload.
 */

const DB_NAME = 'nim-playground-libs';
const DB_VERSION = 1;
const STORE = 'libs';

/**
 * Turn a repo or file name into a stable library id / mount slug.
 *
 * @param {string} name e.g. 'protobuf-nim', 'Protobuf-Nim-main.zip'
 * @returns {string} slug like 'protobuf-nim'
 */
export function slugify(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/\.zip$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'lib';
}

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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('could not open the library store'));
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('library store request failed'));
  });
}

async function withDb(mode, fn) {
  const db = await openDb();
  try {
    return await fn(db.transaction(STORE, mode).objectStore(STORE));
  } finally {
    db.close();
  }
}

/**
 * List installed libraries, metadata only (the `files` payloads are
 * stripped so the list stays cheap to render).
 *
 * @returns {Promise<Array<object>>} records sorted by name
 */
export async function listLibs() {
  const all = await withDb('readonly', (store) => reqToPromise(store.getAll()));
  return all
    .map(({ files, ...meta }) => meta)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Full records including file contents — used by the compiler to mount
 * every library into MEMFS before a compile.
 *
 * @returns {Promise<Array<object>>} records sorted by name
 */
export async function getLibsWithFiles() {
  const all = await withDb('readonly', (store) => reqToPromise(store.getAll()));
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Insert or replace a library record (re-adding the same id = update).
 *
 * @param {object} record full record including files
 * @returns {Promise<void>}
 */
export async function putLib(record) {
  await withDb('readwrite', (store) => reqToPromise(store.put(record)));
}

/**
 * Remove a library by id.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteLib(id) {
  await withDb('readwrite', (store) => reqToPromise(store.delete(id)));
}
