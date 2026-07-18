// =============================================================================
// tests/tar.test.mjs -- contract tests for web/src/tar.js
// =============================================================================
//
// tar.js implements the libpack tar contract (SPEC section 4):
//
//   export function untar(u8)  // u8: Uint8Array
//     -> Array<{name: string, data: Uint8Array, mode: number,
//               type: 'file'|'dir'}>
//   export function tar(entries)  // entries: Array<{name, data, mode?}>
//     -> Uint8Array               (ustar, 512-byte blocks, proper checksums)
//
// Tests:
//   (a) round-trip: tar(untar-compatible entries) then untar() preserves
//       names and bytes for a synthetic entry set: nested paths, an empty
//       file, a file name longer than 100 characters (ustar prefix split),
//       and a non-ASCII (UTF-8) name.
//   (b) untar() parses a REAL archive produced by the system tar binary
//       (created in a temporary directory via child_process), i.e. the same
//       format tools/pack-lib.sh writes.
//   (c) untar() rejects garbage input with a thrown error.
//   (d) untar() reads the committed libpacks/bindweb.tar and finds the
//       bindweb Nim bindings and C runtime with non-empty data.
//
// Run with Node 18+:  node tests/tar.test.mjs
// No dependencies beyond node: builtins and web/src/tar.js.
// =============================================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tar, untar } from '../web/src/tar.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${name}`);
    console.error(err && err.stack ? err.stack : String(err));
  }
}

// Index an untar() result by entry name, checking the entry shape on the way.
// Directory entries are skipped (their data is empty by definition).
function filesByName(entries) {
  const map = new Map();
  for (const entry of entries) {
    assert.equal(typeof entry.name, 'string', 'entry.name must be a string');
    assert.ok(entry.data instanceof Uint8Array, 'entry.data must be a Uint8Array');
    assert.equal(typeof entry.mode, 'number', 'entry.mode must be a number');
    assert.ok(entry.type === 'file' || entry.type === 'dir',
      `entry.type must be 'file' or 'dir', got ${String(entry.type)}`);
    if (entry.type === 'file') map.set(entry.name, entry);
  }
  return map;
}

// (a) Round-trip through tar() and untar(). ------------------------------------
test('round-trip: nested paths, empty file, >100 char name, non-ASCII name', () => {
  const longName =
    `deep/${'segment/'.repeat(14)}a-very-long-file-name-that-pushes-us-well-past-one-hundred-characters.nim`;
  assert.ok(longName.length > 100, 'test setup: name must exceed 100 characters');
  const utf8Name = 'src/äöü-日本語.nim';

  const inputs = [
    { name: 'hello.txt', data: new TextEncoder().encode('hello world\n'), mode: 0o644 },
    { name: 'src/main.nim', data: new TextEncoder().encode('echo "hi"\n'), mode: 0o644 },
    { name: 'src/apis/deep/nested.bin', data: new Uint8Array([0, 1, 2, 3, 254, 255]), mode: 0o644 },
    { name: 'empty.nim', data: new Uint8Array(0), mode: 0o644 },
    { name: longName, data: new TextEncoder().encode('long names survive\n'), mode: 0o644 },
    { name: utf8Name, data: new TextEncoder().encode('unicode names survive\n'), mode: 0o644 },
  ];

  const packed = tar(inputs);
  assert.ok(packed instanceof Uint8Array, 'tar() must return a Uint8Array');
  assert.equal(packed.length % 512, 0, 'tar output must be a multiple of 512 bytes');

  const got = filesByName(untar(packed));
  assert.equal(got.size, inputs.length, 'every file must come back exactly once');
  for (const input of inputs) {
    const entry = got.get(input.name);
    assert.ok(entry, `missing entry after round-trip: ${input.name}`);
    assert.deepEqual(entry.data, input.data, `byte mismatch for ${input.name}`);
  }
});

// (b) untar() parses an archive written by the real system tar. ----------------
test('system tar: untar() parses output of the tar binary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'libpack-tartest-'));
  try {
    mkdirSync(join(dir, 'work', 'sub', 'dir'), { recursive: true });
    writeFileSync(join(dir, 'work', 'alpha.txt'), 'alpha\n');
    writeFileSync(join(dir, 'work', 'sub', 'dir', 'beta.nim'), 'echo "beta"\n');
    writeFileSync(join(dir, 'work', 'empty'), '');

    // Same deterministic ustar flags as tools/pack-lib.sh.
    execFileSync('tar', [
      '--sort=name', '--owner=0', '--group=0', '--numeric-owner',
      '--format=ustar', '-cf', join(dir, 'pack.tar'), '-C', join(dir, 'work'), '.',
    ]);

    const got = filesByName(untar(new Uint8Array(readFileSync(join(dir, 'pack.tar')))));
    for (const [name, text] of [
      ['./alpha.txt', 'alpha\n'],
      ['./sub/dir/beta.nim', 'echo "beta"\n'],
    ]) {
      const entry = got.get(name) || got.get(name.slice(2)); // tolerate 'x' vs './x'
      assert.ok(entry, `missing entry from system-tar archive: ${name}`);
      assert.equal(new TextDecoder().decode(entry.data), text, `byte mismatch for ${name}`);
    }
    const empty = got.get('./empty') || got.get('empty');
    assert.ok(empty, 'missing empty file from system-tar archive');
    assert.equal(empty.data.length, 0, 'empty file must have zero-length data');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.log('SKIP system-tar test: tar binary not found in PATH');
      return;
    }
    throw err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (c) Garbage input must raise an error, never a silent mis-parse. -------------
test('garbage: untar() throws on non-tar input', () => {
  const garbage = new Uint8Array(2048);
  for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 37 + 11) & 0xff;
  assert.throws(() => untar(garbage), 'untar() must throw on patterned garbage');

  // Prose spanning several blocks: the checksum field never validates.
  const text = new TextEncoder().encode('not a tar archive, just prose.\n'.repeat(64));
  assert.throws(() => untar(text), 'untar() must throw on plain text input');
});

// (d) Real libpack: the committed bindweb.tar must untar cleanly. --------------
test('real pack: untar() reads libpacks/bindweb.tar', () => {
  const packPath = join(REPO_ROOT, 'libpacks', 'bindweb.tar');
  const got = filesByName(untar(new Uint8Array(readFileSync(packPath))));

  for (const expected of ['bindweb/bindweb.nim', 'bindweb/c/bindweb_runtime.c']) {
    const entry = got.get(expected);
    assert.ok(entry, `missing entry in bindweb.tar: ${expected}`);
    assert.ok(entry.data.length > 0, `entry has empty data: ${expected}`);
  }
});

// -----------------------------------------------------------------------------
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All tar tests passed.');
