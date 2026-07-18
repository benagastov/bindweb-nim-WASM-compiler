/**
 * libpacks.js — fetch libpack tar archives and mount them into an
 * Emscripten MEMFS file system at runtime.
 *
 * A libpack is an uncompressed POSIX USTAR `.tar` (see SPEC §3). The
 * manifest at `<baseUrl>/manifest.json` lists the available packs:
 *
 *   {"version": 1, "packs": [
 *     {"name": "nim-config", "file": "nim-config.tar", "mount": "/nim/config",
 *      "strip": 1, "required": true}, ...]}
 *
 * Mounting never rebuilds anything: each compile of the in-browser Nim
 * compiler gets a fresh Emscripten module, and the packs are re-mounted
 * from cached tar bytes (fetched once per page load, cached in this module).
 */

import { untar } from './tar.js';

/**
 * Cache of fetched tar bytes, keyed by absolute URL. A fresh Emscripten
 * module is created per compile, so mountLibpacks() runs once per compile;
 * caching avoids re-downloading multi-megabyte stdlib packs every time.
 * @type {Map<string, Uint8Array>}
 */
const tarCache = new Map();

/**
 * Fetch and validate the libpack manifest.
 *
 * @param {string} baseUrl base URL of the libpacks directory (no trailing
 *   slash required), e.g. './libpacks'
 * @returns {Promise<{version: number, packs: Array<{name: string, file: string,
 *   mount: string, strip: number, required: boolean}>}>} validated manifest
 * @throws {Error} if the manifest cannot be fetched or fails validation
 */
export async function fetchManifest(baseUrl) {
  const url = `${baseUrl}/manifest.json`;
  let manifest;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    manifest = await response.json();
  } catch (e) {
    throw new Error(`libpacks: cannot load manifest ${url}: ${e.message || e}`);
  }
  validateManifest(manifest, url);
  return manifest;
}

/**
 * Validate a manifest object against the SPEC §3 schema.
 *
 * @param {*} manifest parsed JSON
 * @param {string} [source] origin for error messages
 * @throws {Error} on the first schema violation
 */
export function validateManifest(manifest, source = 'manifest.json') {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`libpacks: ${source} is not a JSON object`);
  }
  if (manifest.version !== 1) {
    throw new Error(`libpacks: ${source}: unsupported version ${JSON.stringify(manifest.version)} (want 1)`);
  }
  if (!Array.isArray(manifest.packs)) {
    throw new Error(`libpacks: ${source}: "packs" must be an array`);
  }
  const seen = new Set();
  for (let i = 0; i < manifest.packs.length; i++) {
    const p = manifest.packs[i];
    const where = `${source}: packs[${i}]`;
    if (!p || typeof p !== 'object') throw new Error(`libpacks: ${where} is not an object`);
    for (const field of ['name', 'file', 'mount']) {
      if (typeof p[field] !== 'string' || p[field].length === 0) {
        throw new Error(`libpacks: ${where}.${field} must be a non-empty string`);
      }
    }
    if (!p.mount.startsWith('/')) {
      throw new Error(`libpacks: ${where}.mount must be absolute (got ${JSON.stringify(p.mount)})`);
    }
    if (!Number.isInteger(p.strip) || p.strip < 0) {
      throw new Error(`libpacks: ${where}.strip must be a non-negative integer`);
    }
    if (typeof p.required !== 'boolean') {
      throw new Error(`libpacks: ${where}.required must be a boolean`);
    }
    if (seen.has(p.name)) {
      throw new Error(`libpacks: ${where}: duplicate pack name ${JSON.stringify(p.name)}`);
    }
    seen.add(p.name);
  }
}

/**
 * Fetch a pack tar, using the module-level cache.
 *
 * @param {string} url absolute or relative URL of the .tar file
 * @returns {Promise<Uint8Array>} tar bytes
 * @throws {Error} on fetch failure
 */
async function fetchTar(url) {
  const cached = tarCache.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  tarCache.set(url, bytes);
  return bytes;
}

/**
 * Create a directory and all missing parents in an Emscripten FS.
 * FS.mkdirTree exists on current Emscripten builds; fall back to a manual
 * mkdir chain for older glue.
 *
 * @param {object} FS Emscripten file system object
 * @param {string} path absolute directory path
 */
function mkdirTree(FS, path) {
  if (typeof FS.mkdirTree === 'function') {
    FS.mkdirTree(path);
    return;
  }
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    try { FS.mkdir(current); } catch (e) { /* EEXIST: keep going */ }
  }
}

/**
 * Fetch every pack in the manifest and mount it into `FS`.
 *
 * For each pack: fetch `<baseUrl>/<pack.file>` -> untar ->
 * FS.mkdirTree(pack.mount) -> write each file at
 * `pack.mount + '/' + entry.name.split('/').slice(pack.strip).join('/')`.
 * Entries that strip to the empty string are skipped. Directory entries
 * are created (with parents). Missing required packs throw; missing
 * optional packs are logged and skipped.
 *
 * @param {object} FS Emscripten file system object of the target module
 * @param {{packs: Array<object>}} manifest validated manifest (see fetchManifest)
 * @param {string} baseUrl base URL of the libpacks directory
 * @param {(msg: string) => void} [log] progress logger
 * @returns {Promise<Array<{name: string, mount: string, files: number}>>}
 *   summary per mounted pack
 * @throws {Error} when a required pack cannot be fetched or mounted
 */
export async function mountLibpacks(FS, manifest, baseUrl, log = () => {}) {
  const mounted = [];
  for (const pack of manifest.packs) {
    const url = `${baseUrl}/${pack.file}`;
    let bytes;
    try {
      bytes = await fetchTar(url);
    } catch (e) {
      const msg = `libpacks: pack "${pack.name}" (${pack.file}) unavailable: ${e.message || e}`;
      if (pack.required) throw new Error(msg);
      log(`${msg} — optional, skipped`);
      continue;
    }

    let entries;
    try {
      entries = untar(bytes);
    } catch (e) {
      const msg = `libpacks: pack "${pack.name}" (${pack.file}) is not a valid tar: ${e.message || e}`;
      if (pack.required) throw new Error(msg);
      log(`${msg} — optional, skipped`);
      continue;
    }

    mkdirTree(FS, pack.mount);
    let files = 0;
    for (const entry of entries) {
      const rel = entry.name.split('/').slice(pack.strip).join('/');
      if (rel === '') continue; // stripped away entirely (e.g. the top-level dir)
      const target = `${pack.mount}/${rel}`;
      if (entry.type === 'dir') {
        mkdirTree(FS, target);
      } else {
        const slash = target.lastIndexOf('/');
        if (slash > 0) mkdirTree(FS, target.slice(0, slash));
        FS.writeFile(target, entry.data);
        files++;
      }
    }
    log(`libpacks: mounted "${pack.name}" at ${pack.mount} (${files} files)`);
    mounted.push({ name: pack.name, mount: pack.mount, files });
  }
  return mounted;
}
