/**
 * libimport.js — fetch a Nim library from a GitHub link or an uploaded zip,
 * trim it down to the files the compiler needs, and store it in IndexedDB
 * (libstore.js).
 *
 * GitHub strategy (no build step, everything CORS-safe):
 *   1. api.github.com  -> repo info (default branch) + recursive git tree
 *      (both send Access-Control-Allow-Origin: *).
 *   2. raw.githubusercontent.com -> the individual source files
 *      (also CORS-enabled), fetched with limited concurrency.
 *   3. Fallback when the API is unreachable/rate-limited: the repo zipball
 *      (codeload.github.com) fetched through a public CORS proxy and read
 *      with zip.js. codeload itself sends no CORS headers, hence the proxy.
 *
 * Source layout convention (matches nimble): if the repo keeps its .nim
 * files under src/, that directory becomes the library root; otherwise the
 * repo root is used and tests/docs/examples are filtered out. Either way
 * the library mounts at /libs/<name> so `import <module>` resolves.
 */

import { unzip } from './zip.js';
import { putLib, slugify } from './libstore.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_RAW = 'https://raw.githubusercontent.com';

/**
 * The official nimble package registry (nim-lang/packages). Two mirrors are
 * tried in order — both serve the file with CORS enabled.
 */
const REGISTRY_URLS = [
  'https://cdn.jsdelivr.net/gh/nim-lang/packages@master/packages.json',
  'https://raw.githubusercontent.com/nim-lang/packages/master/packages.json',
];

let registryCache = null; // Promise<Map<lowercaseName, {name, url}>>

/**
 * Fetch (once per session) the nimble registry as a name -> package map.
 *
 * @returns {Promise<Map<string, {name: string, url: string}>>}
 */
export function fetchRegistry() {
  if (!registryCache) {
    registryCache = (async () => {
      let lastErr = null;
      for (const url of REGISTRY_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const pkgs = await res.json();
          const map = new Map();
          for (const p of pkgs) {
            if (p && p.name && p.url) map.set(p.name.toLowerCase(), { name: p.name, url: p.url });
          }
          return map;
        } catch (e) {
          lastErr = e;
        }
      }
      registryCache = null; // allow a later retry
      throw lastErr || new Error('registry unavailable');
    })();
  }
  return registryCache;
}

/**
 * Normalize the odd URL shapes found in the nimble registry
 * (git@github.com:, git://, git+https://, trailing .git) to a plain https
 * URL that parseGitHubUrl accepts.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeGitUrl(url) {
  return String(url || '')
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//i, 'https://');
}

/** Public CORS proxies used only for the zipball fallback (see header). */
const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

/** Files the compiler can consume; everything else stays behind. */
const KEEP_RE = /\.(nim|c|h|cpp|cc|hpp)$/i;
/** Directories (relative to the library root) never needed to compile. */
const SKIP_DIRS_RE = /^(tests?|docs?|examples?|\.github|\.vscode|benchmarks?|images?|img)\//i;

const MAX_FILE_BYTES = 3 * 1024 * 1024;   // skip single huge files
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // sanity cap for one library
const FETCH_CONCURRENCY = 6;

/**
 * Parse a GitHub repository URL.
 *
 * Accepts https://github.com/<owner>/<repo>, with an optional .git suffix
 * or /tree/<ref> path.
 *
 * @param {string} input
 * @returns {{owner: string, repo: string, ref: string|null}}
 * @throws {Error} on anything that is not a github.com repo URL
 */
export function parseGitHubUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch (e) {
    throw new Error('That does not look like a URL. Paste e.g. https://github.com/PMunch/protobuf-nim');
  }
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) {
    throw new Error('Only github.com links are supported (upload a .zip for anything else).');
  }
  const parts = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Expected https://github.com/<owner>/<repo>');
  }
  let ref = null;
  const treeAt = parts.indexOf('tree');
  if (treeAt >= 0 && parts.length > treeAt + 1) {
    ref = parts.slice(treeAt + 1).join('/');
  }
  return { owner: parts[0], repo: parts[1], ref };
}

/**
 * Choose which repo files become the mounted library.
 *
 * @param {Array<{path: string, size: number}>} allFiles every file in the repo
 * @returns {{root: string, files: Array<{repoPath: string, rel: string, size: number}>,
 *   nimblePath: string|null}}
 *   root: '' or 'src/'; files: kept sources with their repo-relative and
 *   root-relative paths; nimblePath: top-level *.nimble for metadata.
 */
function selectRepoFiles(allFiles) {
  const usesSrc = allFiles.some((f) => f.path.startsWith('src/') && f.path.endsWith('.nim'));
  const root = usesSrc ? 'src/' : '';
  const files = [];
  let nimblePath = null;
  for (const f of allFiles) {
    if (/^[^/]+\.nimble$/i.test(f.path)) { nimblePath = f.path; continue; }
    if (root && !f.path.startsWith(root)) continue;
    const rel = root ? f.path.slice(root.length) : f.path;
    if (!rel || rel.startsWith('.git')) continue;
    if (SKIP_DIRS_RE.test(rel)) continue;
    if (!KEEP_RE.test(rel)) continue;
    if (f.size > MAX_FILE_BYTES) continue;
    files.push({ repoPath: f.path, rel, size: f.size });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { root, files, nimblePath };
}

/** Extract dependency names from .nimble file text (best effort). */
function parseNimbleRequires(text) {
  const names = [];
  const re = /requires\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+/)[0];
      if (name && name.toLowerCase() !== 'nim') names.push(name);
    }
  }
  return [...new Set(names)];
}

/** Run async fn over items with a bounded number of parallel workers. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i); // eslint-disable-line no-await-in-loop
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

async function fetchJson(url, what) {
  const res = await fetch(url);
  if (!res.ok) {
    const hint = res.status === 403 ? ' (GitHub API rate limit — try the .zip upload instead)' : '';
    throw new Error(`${what}: HTTP ${res.status}${hint}`);
  }
  return res.json();
}

/** Assemble, store and return a library record. */
async function saveLib({ name, source, files, requires, pkgName = null }) {
  const id = slugify(name);
  const totalBytes = files.reduce((acc, f) => acc + f.data.length, 0);
  const record = {
    id,
    name,
    pkgName: pkgName || name, // nimble package name (from the .nimble filename)
    mount: `/libs/${id}`,
    source,
    addedAt: Date.now(),
    fileCount: files.length,
    totalBytes,
    requires,
    files,
  };
  await putLib(record);
  const { files: _omit, ...meta } = record;
  return meta;
}

/**
 * Import a library from a GitHub repository link.
 *
 * @param {string} input repo URL (see parseGitHubUrl)
 * @param {(msg: string) => void} [onProgress] progress narration for the UI
 * @returns {Promise<object>} the stored library metadata
 * @throws {Error} with a user-readable message on failure
 */
export async function importFromGitHub(input, onProgress = () => {}, opts = {}) {
  const { owner, repo, ref: refFromUrl } = parseGitHubUrl(input);
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const via = typeof opts.via === 'string' && opts.via ? opts.via : null;

  // -- Path 1: GitHub API (file list) + raw.githubusercontent.com (files) --
  let ref = refFromUrl;
  let treeFiles = null;
  let apiError = null;
  try {
    if (!ref) {
      onProgress('looking up the repository…');
      const info = await fetchJson(`${GITHUB_API}/repos/${owner}/${repo}`, 'repository lookup failed');
      ref = info.default_branch || 'main';
    }
    onProgress(`reading the file list (${ref})…`);
    const tree = await fetchJson(
      `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      'file list failed'
    );
    treeFiles = (tree.tree || [])
      .filter((e) => e.type === 'blob')
      .map((e) => ({ path: e.path, size: e.size || 0 }));
  } catch (e) {
    apiError = e;
  }

  if (treeFiles) {
    const sel = selectRepoFiles(treeFiles);
    if (sel.files.length === 0) {
      throw new Error('No Nim sources found in that repository (looked for .nim files, src/ layout included).');
    }
    const totalSize = sel.files.reduce((a, f) => a + f.size, 0);
    if (totalSize > MAX_TOTAL_BYTES) {
      throw new Error(`That library is too large (${Math.round(totalSize / 1048576)} MB of sources, limit 25 MB).`);
    }
    let done = 0;
    const files = await mapLimit(sel.files, FETCH_CONCURRENCY, async (f) => {
      const url = `${GITHUB_RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/` +
        f.repoPath.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download failed for ${f.repoPath} (HTTP ${res.status})`);
      const data = new Uint8Array(await res.arrayBuffer());
      done += 1;
      onProgress(`downloading sources… ${done}/${sel.files.length}`);
      return { path: f.rel, data };
    });

    let requires = [];
    if (sel.nimblePath) {
      try {
        const res = await fetch(
          `${GITHUB_RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/${sel.nimblePath}`
        );
        if (res.ok) requires = parseNimbleRequires(await res.text());
      } catch (e) { /* metadata only — ignore */ }
    }

    return saveLib({
      name: repo,
      source: { kind: 'github', url: repoUrl, ref, via },
      files,
      requires,
      pkgName: sel.nimblePath ? sel.nimblePath.replace(/\.nimble$/i, '') : null,
    });
  }

  // -- Path 2 (fallback): repo zipball through a CORS proxy ----------------
  onProgress(`direct GitHub access failed (${apiError.message}); trying a zip mirror…`);
  const branches = [...new Set([ref, 'main', 'master'].filter(Boolean))];
  for (const branch of branches) {
    const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
    for (const wrap of CORS_PROXIES) {
      try {
        onProgress(`fetching zip mirror (${branch})…`);
        const res = await fetch(wrap(zipUrl));
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        return await importFromZipBytes(bytes, {
          name: repo,
          source: { kind: 'github', url: repoUrl, ref: branch, via },
        }, onProgress);
      } catch (e) { /* try the next mirror */ }
    }
  }
  throw new Error(
    `Could not download the library: ${apiError.message}. ` +
    'You can also download the repository as a .zip yourself and use the upload button.'
  );
}

/**
 * Import a library from an uploaded .zip File (e.g. GitHub's
 * "Code -> Download ZIP", or a zip of any folder of Nim sources).
 *
 * @param {File} file the picked file
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<object>} the stored library metadata
 */
export async function importFromZipFile(file, onProgress = () => {}, opts = {}) {
  const base = file.name.replace(/\.zip$/i, '').replace(/-(main|master|head)$/i, '');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importFromZipBytes(bytes, {
    name: base,
    source: { kind: 'zip', filename: file.name, via: opts.via || null },
  }, onProgress);
}

/**
 * Shared zip path: unpack, strip the single top-level folder GitHub adds,
 * select sources, store.
 *
 * @param {Uint8Array} bytes zip archive
 * @param {{name: string, source: object}} meta naming + provenance
 * @param {(msg: string) => void} onProgress
 * @returns {Promise<object>} the stored library metadata
 */
async function importFromZipBytes(bytes, meta, onProgress) {
  onProgress('reading the zip archive…');
  const entries = (await unzip(bytes)).filter((e) => !e.isDir);
  if (entries.length === 0) throw new Error('That zip archive is empty.');

  // GitHub zips wrap everything in one "<repo>-<ref>/" folder — strip a
  // single shared top-level directory so src/ detection sees the real tree.
  let prefix = '';
  const first = entries[0].name.split('/')[0];
  if (first && entries.every((e) => e.name.startsWith(`${first}/`))) {
    prefix = `${first}/`;
  }

  const allFiles = entries
    .map((e) => ({ path: prefix ? e.name.slice(prefix.length) : e.name, entry: e }))
    .filter((f) => f.path !== '');
  const sel = selectRepoFiles(allFiles.map((f) => ({ path: f.path, size: f.entry.data.length })));
  if (sel.files.length === 0) {
    throw new Error('No Nim sources found in that zip (looked for .nim files, src/ layout included).');
  }

  const byPath = new Map(allFiles.map((f) => [f.path, f.entry]));
  const totalBytes = sel.files.reduce((a, f) => a + byPath.get(f.repoPath).data.length, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`That library is too large (${Math.round(totalBytes / 1048576)} MB of sources, limit 25 MB).`);
  }
  const files = sel.files.map((f) => ({ path: f.rel, data: byPath.get(f.repoPath).data }));

  let requires = [];
  if (sel.nimblePath && byPath.has(sel.nimblePath)) {
    requires = parseNimbleRequires(new TextDecoder().decode(byPath.get(sel.nimblePath).data));
  }

  return saveLib({
    name: meta.name,
    source: meta.source,
    files,
    requires,
    pkgName: sel.nimblePath ? sel.nimblePath.replace(/\.nimble$/i, '') : null,
  });
}
