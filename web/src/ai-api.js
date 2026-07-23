/**
 * ai-api.js — window.NimIDE: a GUI-less driving API for the IDE, so an
 * AI/CLI agent (DevTools console, CDP Runtime.evaluate, Playwright) can do
 * everything the UI can: write project files, run the exact Build-button
 * flow, read the captured log lines, and export zips as base64 (an agent
 * can't click a download dialog).
 *
 * main.js imports installNimIDE() and hands over hooks into its private
 * pieces (the shared runBuild() wrapper, the log() tap, the ready promise,
 * the editor); the file ops here are thin wrappers over vfs.js and the zip
 * writer is web/src/zip.js — nothing is reimplemented.
 *
 * Everything is promise-based and returns plain JSON-serializable objects
 * (CDP Runtime.evaluate with returnByValue round-trips them cleanly).
 * Documented for agents in SKILL.md and AI.md at the repo root.
 */

import {
  AREA_WORKSPACE, AREA_SITE,
  listFiles as vfsListFiles, readFile as vfsReadFile, writeFile as vfsWriteFile,
  makeDir as vfsMakeDir, deletePath as vfsDeletePath,
  getFilesWithData, isLikelyBinary,
} from './vfs.js';
import { zipFiles } from './zip.js';

const textDecoder = new TextDecoder();

/** Map the public area names onto the vfs area constants. */
const AREAS = { project: AREA_WORKSPACE, site: AREA_SITE };

/**
 * Resolve a public area name ('project' | 'site') to a vfs area constant.
 *
 * @param {string} [area] defaults to 'project'
 * @returns {string} AREA_WORKSPACE | AREA_SITE
 */
function mapArea(area = 'project') {
  const mapped = AREAS[String(area)];
  if (!mapped) throw new Error(`NimIDE: unknown area "${area}" — use "project" or "site"`);
  return mapped;
}

/** Uint8Array -> base64 without stack-overflowing on large files. */
function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 -> Uint8Array (throws a clear error on malformed input). */
function base64ToBytes(b64) {
  let bin;
  try {
    bin = atob(String(b64));
  } catch (e) {
    throw new Error('NimIDE: writeFile with {binary: true} needs valid base64');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Install window.NimIDE. Called once by main.js with hooks into the UI
 * layer; all hooks are required except syncEditor / refreshTrees (pure UI
 * conveniences).
 *
 * @param {object} hooks
 * @param {string} hooks.version API version string
 * @param {() => Promise<boolean>} hooks.ready resolves true once both
 *   toolchains loaded (the moment Run/Build get enabled)
 * @param {() => string} hooks.status current status-pill text
 * @param {() => Promise<object>} hooks.runBuild the shared build wrapper
 *   (one build at a time; runs the exact Build-button flow)
 * @param {(fn: (msg: string, kind: string) => void) => () => void}
 *   hooks.addLogListener tap into log(); returns an unregister function
 * @param {() => Promise<void>} hooks.saveOpenFile flush the editor into the
 *   workspace store
 * @param {(path: string, text: string|null) => void} [hooks.syncEditor]
 *   keep the editor in sync when the API overwrites the open file
 * @param {() => void} [hooks.refreshTrees] re-render the file trees
 */
export function installNimIDE(hooks) {
  const refresh = () => { if (hooks.refreshTrees) hooks.refreshTrees(); };

  const api = {
    version: String(hooks.version || '1.0.0'),

    /** Resolves true once the toolchains are loaded and Build works. */
    ready: () => hooks.ready(),

    /** Current status-pill text (e.g. "Ready — press Run"). */
    status: () => String(hooks.status()),

    /**
     * List files/folders in an area.
     *
     * @param {'project'|'site'} [area] default 'project'
     * @returns {Promise<Array<{path: string, isDir: boolean, size: number, updatedAt: number}>>}
     */
    async listFiles(area) {
      return vfsListFiles(mapArea(area));
    },

    /**
     * Read one file. Text files come back in `.text`, binary files
     * (vfs.js's isLikelyBinary heuristic) base64-encoded in `.base64`.
     * Returns null when the path does not exist or is a folder.
     *
     * @param {string} path area-relative path
     * @param {'project'|'site'} [area] default 'project'
     * @returns {Promise<null | {path: string, binary: boolean, size: number,
     *   text?: string, base64?: string}>}
     */
    async readFile(path, area) {
      const data = await vfsReadFile(mapArea(area), path);
      if (!data) return null;
      if (isLikelyBinary(data)) {
        return { path: String(path), binary: true, size: data.length, base64: bytesToBase64(data) };
      }
      return { path: String(path), binary: false, size: data.length, text: textDecoder.decode(data) };
    },

    /**
     * Create or replace a file (parent folders are created implicitly).
     * Text by default; pass {binary: true} with base64 content for binary
     * files. If the file is open in the editor, the editor is updated too,
     * so a later auto-save/build does not clobber the write.
     *
     * @param {string} path area-relative path
     * @param {string} textOrBase64 file contents (base64 when binary)
     * @param {object} [opts]
     * @param {boolean} [opts.binary] default false
     * @param {'project'|'site'} [opts.area] default 'project'
     * @returns {Promise<{path: string, bytes: number}>}
     */
    async writeFile(path, textOrBase64, opts = {}) {
      const area = mapArea(opts.area);
      const data = opts.binary ? base64ToBytes(textOrBase64) : String(textOrBase64);
      const stored = await vfsWriteFile(area, path, data);
      if (area === AREA_WORKSPACE && hooks.syncEditor) {
        hooks.syncEditor(stored, opts.binary ? null : String(textOrBase64));
      }
      refresh();
      return { path: stored, bytes: data.length };
    },

    /**
     * Create a folder (and missing parents). Idempotent.
     *
     * @param {string} path
     * @param {'project'|'site'} [area] default 'project'
     * @returns {Promise<{path: string}>}
     */
    async makeDir(path, area) {
      const stored = await vfsMakeDir(mapArea(area), path);
      refresh();
      return { path: stored };
    },

    /**
     * Delete a file or folder (folders: everything inside them).
     *
     * @param {string} path
     * @param {'project'|'site'} [area] default 'project'
     * @returns {Promise<{deleted: number}>} number of entries removed
     */
    async deletePath(path, area) {
      const deleted = await vfsDeletePath(mapArea(area), path);
      refresh();
      return { deleted };
    },

    /**
     * Run the EXACT same flow as the Build button (unsaved editor changes
     * are saved first, one build at a time, buttons disabled meanwhile)
     * and return a plain summary with every captured log line.
     *
     * @returns {Promise<{ok: boolean, summary: string, logs: string[],
     *   deployed: string[], skipped: string[], siteFiles: string[]}>}
     *   deployed: site-relative wasm paths written (entry first);
     *   skipped: non-entry .nim files that failed to compile;
     *   siteFiles: every file path in the Site folder after the build.
     */
    async build() {
      const logs = [];
      const untap = hooks.addLogListener((msg, kind) => {
        logs.push(kind === 'info' ? msg : `[${kind}] ${msg}`);
      });
      let result;
      try {
        result = await hooks.runBuild();
      } finally {
        untap();
      }
      const siteEntries = await vfsListFiles(AREA_SITE).catch(() => []);
      return {
        ok: !!result.ok,
        summary: String(result.summary || ''),
        logs,
        deployed: Array.isArray(result.deployed) ? result.deployed.slice() : [],
        skipped: Array.isArray(result.skipped) ? result.skipped.slice() : [],
        siteFiles: siteEntries.filter((e) => !e.isDir).map((e) => e.path),
      };
    },

    /**
     * Zip up a whole area and RETURN it base64-encoded (unlike the
     * toolbar buttons, which trigger a download an agent can't click).
     * The open editor file is saved first when exporting the project, same
     * as the toolbar button.
     *
     * @param {'project'|'site'} [area] default 'project'
     * @returns {Promise<{name: string, base64: string, files: number, bytes: number}>}
     * @throws {Error} when the folder is empty (nothing to export)
     */
    async exportZip(area) {
      const mapped = mapArea(area);
      if (mapped === AREA_WORKSPACE) await hooks.saveOpenFile();
      const [entries, files] = await Promise.all([vfsListFiles(mapped), getFilesWithData(mapped)]);
      if (entries.length === 0) {
        throw new Error(`NimIDE: nothing to export — the ${mapped === AREA_SITE ? 'site' : 'project'} folder is empty`);
      }
      const zipEntries = [
        ...entries.filter((e) => e.isDir).map((e) => ({ name: e.path, isDir: true })),
        ...files.map((f) => ({ name: f.path, data: f.data })),
      ].sort((a, b) => a.name.localeCompare(b.name));
      const bytes = zipFiles(zipEntries);
      return {
        name: mapped === AREA_SITE ? 'site.zip' : 'project.zip',
        base64: bytesToBase64(bytes),
        files: files.length,
        bytes: bytes.length,
      };
    },
  };

  window.NimIDE = api;
  console.info(`[NimIDE] window.NimIDE v${api.version} installed — see AI.md / SKILL.md for the driving API`);
  return api;
}
