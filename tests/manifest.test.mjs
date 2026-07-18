// =============================================================================
// tests/manifest.test.mjs -- validate libpacks/manifest.json and the pack tars
// =============================================================================
//
// Manifest schema (SPEC section 3):
//   {
//     "version": 1,
//     "packs": [
//       { "name": "...", "file": "....tar", "mount": "/abs/dir",
//         "strip": 1, "required": true|false }
//     ]
//   }
//
// Checks:
//   * version is exactly 1; packs is a non-empty array;
//   * every pack entry matches the schema: unique non-empty name, file
//     ending in ".tar", absolute mount, integer strip >= 0, boolean required;
//   * every listed pack file exists in libpacks/ and carries a valid POSIX
//     ustar header ("ustar" magic at offset 257 of the first header block);
//   * every committed libpacks/*.tar is listable by the system tar binary and
//     every entry in it lives under a single top-level directory whose name
//     equals the pack name (so "strip": 1 normalizes on extraction).
//
// Run with Node 18+:  node tests/manifest.test.mjs
// No dependencies beyond node: builtins.
// =============================================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIBPACKS_DIR = join(REPO_ROOT, 'libpacks');
const MANIFEST_PATH = join(LIBPACKS_DIR, 'manifest.json');

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

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

test('manifest parses and declares version 1', () => {
  const manifest = loadManifest();
  assert.equal(manifest.version, 1, 'manifest.version must be exactly 1');
});

test('manifest lists a non-empty packs array', () => {
  const manifest = loadManifest();
  assert.ok(Array.isArray(manifest.packs), 'manifest.packs must be an array');
  assert.ok(manifest.packs.length > 0, 'manifest.packs must not be empty');
});

test('every pack entry matches the schema', () => {
  const manifest = loadManifest();
  const names = new Set();
  for (const pack of manifest.packs) {
    const label = pack && typeof pack === 'object' ? JSON.stringify(pack) : String(pack);
    assert.equal(typeof pack.name, 'string', `pack name must be a string: ${label}`);
    assert.ok(pack.name.length > 0, `pack name must not be empty: ${label}`);
    assert.equal(typeof pack.file, 'string', `pack file must be a string: ${label}`);
    assert.ok(pack.file.endsWith('.tar'), `pack file must end in .tar: ${label}`);
    assert.equal(typeof pack.mount, 'string', `pack mount must be a string: ${label}`);
    assert.ok(pack.mount.startsWith('/'), `pack mount must be absolute: ${label}`);
    assert.ok(Number.isInteger(pack.strip) && pack.strip >= 0,
      `pack strip must be an integer >= 0: ${label}`);
    assert.equal(typeof pack.required, 'boolean', `pack required must be a boolean: ${label}`);
    assert.ok(!names.has(pack.name), `duplicate pack name: ${pack.name}`);
    names.add(pack.name);
  }
});

test('every listed pack file exists and is a valid ustar archive', () => {
  const manifest = loadManifest();
  for (const pack of manifest.packs) {
    const tarPath = join(LIBPACKS_DIR, pack.file);
    const buf = readFileSync(tarPath); // throws if the file is missing
    assert.ok(buf.length >= 512, `${pack.file}: smaller than one tar block`);
    assert.equal(buf.length % 512, 0, `${pack.file}: size must be a multiple of 512`);
    assert.equal(buf.toString('latin1', 257, 262), 'ustar',
      `${pack.file}: missing ustar magic at offset 257`);
  }
});

test('every committed tar is listable and rooted at <packname>/', () => {
  // The expected top-level directory for each tar: the manifest pack name
  // when the tar is listed, otherwise the tar basename without ".tar".
  const manifest = loadManifest();
  const byFile = new Map(manifest.packs.map((p) => [p.file, p.name]));

  const tarFiles = readdirSync(LIBPACKS_DIR).filter((f) => f.endsWith('.tar'));
  assert.ok(tarFiles.length > 0, 'no .tar files found in libpacks/');

  for (const file of tarFiles) {
    const expectedRoot = byFile.get(file) ?? file.replace(/\.tar$/, '');
    let listing;
    try {
      listing = execFileSync('tar', ['-tf', join(LIBPACKS_DIR, file)], { encoding: 'utf8' });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        console.log(`SKIP tar-listing check for ${file}: tar binary not found in PATH`);
        continue;
      }
      assert.fail(`${file}: system tar cannot list the archive: ${err.message}`);
    }
    const entries = listing.split('\n').filter((line) => line.length > 0);
    assert.ok(entries.length > 0, `${file}: archive is empty`);
    for (const entry of entries) {
      const top = entry.replace(/^\.\//, '').split('/')[0];
      assert.equal(top, expectedRoot,
        `${file}: entry ${JSON.stringify(entry)} is not under top-level dir ` +
        `${JSON.stringify(expectedRoot)} (strip: 1 would mis-mount it)`);
    }
  }
});

// -----------------------------------------------------------------------------
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All manifest tests passed.');
