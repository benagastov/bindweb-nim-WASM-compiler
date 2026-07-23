// =============================================================================
// tests/zip.test.mjs -- contract tests for the zipFiles() writer in
// web/src/zip.js
// =============================================================================
//
// zip.js gained a ZIP writer next to the existing unzip() reader:
//
//   export function zipFiles(entries)  // entries: Array<{name, data?, isDir?}>
//     -> Uint8Array                     (stored, no compression; CRC-32, local
//                                        headers, central directory, EOCD;
//                                        UTF-8 names flagged via bit 11)
//
// Tests:
//   (a) round-trip: unzip(zipFiles(entries)) returns identical names/data
//       for a synthetic entry set: nested paths, an empty file, binary data
//       with NUL bytes, a non-ASCII (UTF-8) name, and a directory entry
//       (empty folders must survive as `name/` records).
//   (b) structure: the archive starts with a local-file-header signature and
//       ends with a well-formed EOCD whose counts/sizes agree with the
//       central directory (no zip64, no data descriptors).
//   (c) the system `unzip -t` (if available) accepts the archive, i.e. the
//       output is a real zip, not just something our own reader parses.
//   (d) unzip() still reads a zip produced by the system `zip` binary (if
//       available), guarding against writer changes breaking the reader.
//
// Run with Node 18+:  node tests/zip.test.mjs
// No dependencies beyond node: builtins and web/src/zip.js.
// =============================================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { unzip, zipFiles } from '../web/src/zip.js';

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${name}`);
    console.error(err && err.stack ? err.stack : String(err));
  }
}

// True when a system binary is on PATH (used to skip, not fail, interop
// tests on minimal systems).
function hasCommand(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Index an unzip() result by entry name, checking the entry shape.
function entriesByName(entries) {
  const map = new Map();
  for (const entry of entries) {
    assert.equal(typeof entry.name, 'string', 'entry.name must be a string');
    assert.ok(entry.data instanceof Uint8Array, 'entry.data must be a Uint8Array');
    assert.equal(typeof entry.isDir, 'boolean', 'entry.isDir must be a boolean');
    map.set(entry.name, entry);
  }
  return map;
}

const enc = new TextEncoder();

// (a) Round-trip through unzip(). -------------------------------------------
await test('round-trip: nested paths, empty file, binary NULs, UTF-8 name, dir entry', async () => {
  const binary = new Uint8Array(256);
  for (let i = 0; i < binary.length; i++) binary[i] = i; // includes NUL bytes
  const entries = [
    { name: 'main.nim', data: enc.encode('echo "hello"\n') },
    { name: 'sub/mod.nim', data: enc.encode('proc helper*() = discard\n') },
    { name: 'sub/deep/empty.txt', data: new Uint8Array(0) },
    { name: 'assets/raw.bin', data: binary },
    { name: 'docs/nim-ümlaut.md', data: enc.encode('unicode content ✓\n') },
    { name: 'empty-folder', isDir: true },
  ];

  const archive = zipFiles(entries);
  assert.ok(archive instanceof Uint8Array, 'zipFiles() must return a Uint8Array');

  const got = entriesByName(await unzip(archive));
  assert.equal(got.size, entries.length, 'entry count must survive the round-trip');
  for (const entry of entries) {
    const out = got.get(entry.name);
    assert.ok(out, `missing entry after round-trip: ${entry.name}`);
    assert.equal(out.isDir, !!entry.isDir, `isDir mismatch for ${entry.name}`);
    const want = entry.isDir ? new Uint8Array(0) : entry.data;
    assert.deepEqual(out.data, want, `data mismatch for ${entry.name}`);
  }
});

// (b) Archive structure: signatures and EOCD bookkeeping. --------------------
await test('structure: LFH signature, stored method, UTF-8 flag, EOCD counts', async () => {
  const entries = [
    { name: 'a.txt', data: enc.encode('aaa') },
    { name: 'dir', isDir: true },
    { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 255]) },
  ];
  const archive = zipFiles(entries);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  assert.equal(view.getUint32(0, true), 0x04034b50, 'archive must start with a local file header');
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800, 'UTF-8 flag (bit 11) must be set');
  assert.equal(view.getUint16(8, true), 0, 'method must be 0 (stored)');
  assert.equal(view.getUint16(6, true) & 0x08, 0, 'no data-descriptor flag allowed');

  // EOCD is the last 22 bytes (we never write a comment).
  const eocd = archive.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, 'archive must end with an EOCD record');
  assert.equal(view.getUint16(eocd + 8, true), entries.length, 'EOCD entry count (this disk)');
  assert.equal(view.getUint16(eocd + 10, true), entries.length, 'EOCD entry count (total)');
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  assert.equal(cdOffset + cdSize, eocd, 'central directory must sit right before the EOCD');
  assert.equal(view.getUint32(cdOffset, true), 0x02014b50, 'central directory must start with a CDH');
});

// (c) Interop: the system unzip must accept our archive. ---------------------
await test('interop: system `unzip -t` accepts zipFiles() output', async () => {
  if (!hasCommand('unzip')) {
    console.log('SKIP interop (system unzip not available)');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
  try {
    const archive = zipFiles([
      { name: 'main.nim', data: enc.encode('echo "hi"\n') },
      { name: 'sub/mod.nim', data: enc.encode('discard\n') },
      { name: 'empty-folder', isDir: true },
    ]);
    const zipPath = join(dir, 'out.zip');
    writeFileSync(zipPath, archive);
    execFileSync('unzip', ['-t', zipPath], { stdio: 'ignore' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (d) Regression: unzip() still reads a zip made by the system zip binary. ---
await test('interop: unzip() reads a system `zip` archive', async () => {
  if (!hasCommand('zip')) {
    console.log('SKIP interop (system zip not available)');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
  try {
    writeFileSync(join(dir, 'hello.txt'), 'hello zip\n');
    execFileSync('zip', ['out.zip', 'hello.txt'], { cwd: dir, stdio: 'ignore' });
    const got = entriesByName(await unzip(new Uint8Array(readFileSync(join(dir, 'out.zip')))));
    assert.deepEqual([...got.keys()], ['hello.txt']);
    assert.deepEqual(got.get('hello.txt').data, enc.encode('hello zip\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All zip tests passed.');
