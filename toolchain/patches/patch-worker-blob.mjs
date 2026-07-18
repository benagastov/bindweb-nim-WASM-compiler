/**
 * patch-worker-blob.mjs — on-disk twin of the in-memory runtime patch
 * patchWorkerClockShim() in web/src/clang-compiler.js (lines 56-99).
 *
 * WHY THIS EXISTS
 * ---------------
 * The web worker that compiles and links inside binji's clang.js is
 * embedded as one long base64 string literal, so sed/line-oriented edits
 * cannot reach it. Two verified-live quirks of the pinned prebuilt
 * toolchain live inside that blob:
 *
 *   QUIRK 1 — the worker's WASI shim throws
 *     `wasi_unstable.clock_time_get not implemented`, which every
 *     `clang -cc1 -emit-obj` invocation hits (createUniqueFile ->
 *     Process::GetRandomNumber -> /dev/urandom is absent from the memfs
 *     -> time() fallback -> clock_time_get -> throw), wedging the worker
 *     before the first object file is written.
 *     Fix: replace the throwing
 *       clock_time_get(args){throw new X("wasi_unstable","clock_time_get")}
 *     with an implementation that writes a u64 nanosecond timestamp into
 *     module memory and returns 0 — the same shape as the adjacent
 *     random_get shim.
 *
 *   QUIRK 2 — the pinned clang.wasm's -Oz function-pass pipeline traps
 *     deterministically (PMTopLevelManager::schedulePass ->
 *     "RuntimeError: null function" — a pass-registry/static-initializer
 *     defect in this LLVM wasm build). -O0 skips that pipeline entirely,
 *     works, and compiles noticeably faster.
 *     Fix: rewrite "-Oz" to "-O0" in the worker's compile args.
 *
 * HOW
 * ---
 * The needle regex, the replacement shape, the 1000-char blob threshold
 * and the latin1 (one char per byte, byte-exact) base64 round-trip are
 * taken verbatim from patchWorkerClockShim() so the on-disk result is
 * identical to what the browser builds in memory. Each quirk is detected
 * independently: a partially patched file is completed, a fully patched
 * file is reported "already patched" and left byte-identical, and a blob
 * in which a needle is absent (e.g. a future toolchain fixed the shim
 * upstream) is kept pristine — mirroring the runtime patch's behavior.
 *
 * Usage: node patch-worker-blob.mjs <clang.js> [more.js ...]
 * Exit:  0 = patched / already patched / needle absent / blob not found
 *        1 = usage, I/O error, or non-latin1 worker (btoa would reject)
 *        2 = round-trip verification failed (file NOT modified)
 *
 * Node 18+, zero dependencies. Invoked by patch-worker.sh when node is
 * available; when it is not, the in-memory runtime patch in
 * web/src/clang-compiler.js remains as the fallback.
 */
import { readFileSync, writeFileSync } from 'node:fs';

// --- Needles: identical to web/src/clang-compiler.js (patchWorkerClockShim).
const NEEDLE = /clock_time_get\(([^)]*)\)\{throw new \w+\("wasi_unstable","clock_time_get"\)\}/;
// The worker is embedded as one or more long base64 string literals
// (the pinned clang.js embeds a ~15 kB one; keep the threshold low).
const BLOB_RE = /"([A-Za-z0-9+/=]{1000,})"/g;
const OZ = '"-Oz"';
const O0 = '"-O0"';

// Markers proving a quirk was already fixed (used for idempotent detection).
const CLOCK_MARKER =
  'this.mem.check();const n=BigInt(Date.now())*1000000n;' +
  'new DataView(this.mem.buffer).setBigUint64(';

// latin1 round-trip: one char per byte, so the splice is byte-exact —
// the Node equivalent of the browser's atob/btoa used by the runtime patch.
function atobLatin1(b64) {
  return Buffer.from(b64, 'base64').toString('latin1');
}
function btoaLatin1(s) {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0xff) {
      throw new Error('worker contains a non-latin1 character; btoa would reject it');
    }
  }
  return Buffer.from(s, 'latin1').toString('base64');
}

// Decode every embedded blob, apply both quirk fixes, and return the
// replacement literal contents (null = blob unchanged).
function patchBlob(b64, state) {
  let worker = atobLatin1(b64);
  let changed = false;

  const hit = NEEDLE.exec(worker);
  if (hit) {
    const ptr = hit[1].split(',').pop().trim(); // last arg: time pointer
    const impl =
      `clock_time_get(${hit[1]}){this.mem.check();` +
      `const n=BigInt(Date.now())*1000000n;` +
      `new DataView(this.mem.buffer).setBigUint64(${ptr},n,true);return 0}`;
    worker = worker.slice(0, hit.index) + impl + worker.slice(hit.index + hit[0].length);
    changed = true;
    state.applied |= 1;
  } else if (worker.includes(CLOCK_MARKER)) {
    state.seen |= 1;
  }

  if (worker.includes(OZ)) {
    worker = worker.split(OZ).join(O0);
    changed = true;
    state.applied |= 2;
  } else if (worker.includes(O0)) {
    state.seen |= 2;
  }

  return changed ? btoaLatin1(worker) : null;
}

// Re-decode the patched source and confirm each quirk applied this run is
// actually in place (and the original defect is gone).
function verifyRoundTrip(src, applied) {
  BLOB_RE.lastIndex = 0;
  let match;
  let checked = 0;
  while ((match = BLOB_RE.exec(src)) !== null) {
    const worker = atobLatin1(match[1]);
    if (applied & 1) {
      if (NEEDLE.test(worker) || !worker.includes(CLOCK_MARKER)) return false;
      checked |= 1;
    }
    if (applied & 2) {
      if (worker.includes(OZ) || !worker.includes(O0)) return false;
      checked |= 2;
    }
  }
  return (checked & applied) === applied;
}

function report(path, state) {
  if (state.applied & 1) {
    console.log(`  ${path}: clock_time_get shim injected into embedded worker (wasi_unstable)`);
  } else if (state.seen & 1) {
    console.log(`  ${path}: already patched (clock_time_get shim present)`);
  } else {
    console.log(`  ${path}: clock_time_get: throwing shim not found; worker kept as-is (no patch needed)`);
  }
  if (state.applied & 2) {
    console.log(`  ${path}: -Oz -> -O0 applied to embedded worker (Oz pipeline traps in this build)`);
  } else if (state.seen & 2) {
    console.log(`  ${path}: already patched (-O0 present, no -Oz left)`);
  } else {
    console.log(`  ${path}: "-Oz" not found in embedded worker; no patch needed`);
  }
}

function patchFile(path) {
  const src = readFileSync(path, 'utf8');
  const state = { applied: 0, seen: 0, blobs: 0 };

  // Collect the blob matches first, then splice right-to-left so earlier
  // splices cannot invalidate later match indices (equivalent to the
  // runtime patch for the pinned single-blob clang.js, and correct for
  // the hypothetical multi-blob case).
  BLOB_RE.lastIndex = 0;
  const splices = [];
  let match;
  while ((match = BLOB_RE.exec(src)) !== null) {
    state.blobs++;
    const b64new = patchBlob(match[1], state);
    if (b64new !== null) {
      splices.push({ index: match.index, length: match[0].length, text: `"${b64new}"` });
    }
  }
  if (state.blobs === 0) {
    console.log(`  ${path}: could not locate embedded worker blob; nothing patched`);
    return 0;
  }

  if (splices.length === 0) {
    report(path, state); // already patched / nothing to do
    return 0;
  }

  let patched = src;
  for (let i = splices.length - 1; i >= 0; i--) {
    const sp = splices[i];
    patched = patched.slice(0, sp.index) + sp.text + patched.slice(sp.index + sp.length);
  }

  if (!verifyRoundTrip(patched, state.applied)) {
    console.error(`  ${path}: round-trip verification FAILED; file not modified`);
    return 2;
  }
  writeFileSync(path, patched, 'utf8');
  // Re-read from disk and verify once more so a corrupt write cannot pass.
  if (!verifyRoundTrip(readFileSync(path, 'utf8'), state.applied)) {
    console.error(`  ${path}: post-write verification FAILED`);
    return 2;
  }
  report(path, state);
  console.log(`  ${path}: worker blob re-encoded, round-trip OK`);
  return 0;
}

function main(argv) {
  if (argv.length < 1) {
    console.error('usage: node patch-worker-blob.mjs <clang.js> [more.js ...]');
    return 1;
  }
  let worst = 0;
  for (const path of argv) {
    try {
      const code = patchFile(path);
      if (code > worst) worst = code;
    } catch (e) {
      console.error(`  ${path}: error: ${(e && e.message) || e}`);
      worst = Math.max(worst, 1);
    }
  }
  return worst;
}

process.exit(main(process.argv.slice(2)));
