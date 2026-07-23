// =============================================================================
// tests/wasm-obfuscate.test.mjs -- contract tests for obfuscateWasm() in
// web/src/wasm-obfuscate.js
// =============================================================================
//
// obfuscateWasm(bytes) strips the "name" and "producers" custom sections
// (the Nim fingerprints: readable symbols in DevTools, "language: Nim"
// toolchain metadata), injects one decoy ".comment" custom section with the
// payload "GCC: (GNU) 12.2.0", and passes every other section through
// byte-identical, so the module still compiles and runs.
//
// Tests:
//   (a) synthetic wasm (header + fake custom sections "name", "producers",
//       "other" + a fake type section): name/producers are gone, "other" is
//       preserved byte-identical, the ".comment" decoy is present with the
//       exact GCC payload, and WebAssembly.compile(result) succeeds.
//   (b) malformed input throws clear errors: bad magic, bad version,
//       truncated header, truncated LEB, a section size overrunning the
//       buffer, a custom-section name overrunning its payload.
//   (c) a REAL wasm (web/vendor/clang/memfs.wasm, which carries both "name"
//       and "producers" sections — no clang needed in the sandbox): after
//       obfuscation the fingerprints are gone, the decoy is present, and
//       WebAssembly.compile succeeds. Skipped gracefully if the file is
//       absent.
//
// Run with Node 18+:  node tests/wasm-obfuscate.test.mjs
// No dependencies beyond node: builtins and web/src/wasm-obfuscate.js.
// =============================================================================

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { obfuscateWasm } from '../web/src/wasm-obfuscate.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

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

/** Unsigned LEB128 encode. */
function leb(value) {
  const out = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v = Math.floor(v / 128);
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
}

/** Build a custom section (id 0) with the given name and payload. */
function customSection(name, payload) {
  const nameBytes = Array.from(new TextEncoder().encode(name));
  const body = [...leb(nameBytes.length), ...nameBytes, ...payload];
  return [0, ...leb(body.length), ...body];
}

/** Build a non-custom section with a raw payload. */
function section(id, payload) {
  return [id, ...leb(payload.length), ...payload];
}

const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** Walk a wasm binary and return [{id, name?, payload}] for every section. */
function parseSections(bytes) {
  const out = [];
  let pos = 8;
  const readLeb = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[pos++];
      value += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return value;
      shift += 7;
    }
  };
  while (pos < bytes.length) {
    const id = bytes[pos++];
    const size = readLeb();
    const payload = bytes.slice(pos, pos + size);
    let name;
    if (id === 0) {
      const save = pos;
      pos = pos;
      const nameLen = readLeb();
      name = new TextDecoder().decode(bytes.slice(pos, pos + nameLen));
      pos = save; // name parse must not disturb the payload slice above
    }
    out.push({ id, name, payload });
    pos += size;
  }
  return out;
}

// (a) synthetic wasm: fingerprints stripped, decoy injected, rest intact. --
await test('synthetic wasm: name/producers dropped, others preserved, .comment injected, still compiles', async () => {
  const typePayload = [0x01, 0x60, 0x00, 0x00]; // one () -> () func type
  const nameSec = customSection('name', [1, 2, 3]);
  const producersSec = customSection('producers', [4, 5]);
  const otherSec = customSection('other', [9, 8, 7, 6]);
  const wasm = Uint8Array.from([
    ...WASM_HEADER,
    ...section(1, typePayload),
    ...nameSec,
    ...producersSec,
    ...otherSec,
  ]);

  const result = obfuscateWasm(wasm);
  const sections = parseSections(result);
  const customNames = sections.filter((s) => s.id === 0).map((s) => s.name);

  assert.ok(!customNames.includes('name'), '"name" custom section gone');
  assert.ok(!customNames.includes('producers'), '"producers" custom section gone');
  assert.ok(customNames.includes('other'), 'unrelated custom section preserved');

  const decoys = sections.filter((s) => s.id === 0 && s.name === '.comment');
  assert.equal(decoys.length, 1, 'exactly one decoy .comment section');
  const decoyNameLen = decoys[0].payload[0];
  const decoyPayload = new TextDecoder().decode(decoys[0].payload.slice(1 + decoyNameLen));
  assert.equal(decoyPayload, 'GCC: (GNU) 12.2.0', 'decoy payload is the exact GCC version string');

  // Byte-identical passthrough: the type section and the "other" custom
  // section must appear in the output exactly as authored.
  const typeOut = sections.find((s) => s.id === 1);
  assert.deepEqual(Array.from(typeOut.payload), typePayload, 'type section payload byte-identical');
  const otherOut = sections.find((s) => s.id === 0 && s.name === 'other');
  const otherPayloadExpect = Uint8Array.from([...leb(5), ...new TextEncoder().encode('other'), 9, 8, 7, 6]);
  assert.deepEqual(otherOut.payload, otherPayloadExpect, '"other" section byte-identical (name + payload)');

  await WebAssembly.compile(result); // must still be a valid module
});

// (a2) header-only module (no sections at all) still gets the decoy. -------
await test('header-only module gains only the decoy section', async () => {
  const result = obfuscateWasm(Uint8Array.from(WASM_HEADER));
  const sections = parseSections(result);
  assert.equal(sections.length, 1, 'one section appended');
  assert.equal(sections[0].name, '.comment', 'it is the decoy');
  await WebAssembly.compile(result);
});

// (b) malformed inputs throw clear errors. ---------------------------------
await test('malformed input throws', async () => {
  assert.throws(() => obfuscateWasm(new Uint8Array(0)), /expected a Uint8Array|shorter than the 8-byte/, 'empty input');
  assert.throws(() => obfuscateWasm('not bytes'), /expected a Uint8Array/, 'non-Uint8Array input');
  assert.throws(() => obfuscateWasm(Uint8Array.from([0, 97, 115])), /shorter than the 8-byte/, 'truncated header');
  assert.throws(
    () => obfuscateWasm(Uint8Array.from([1, 2, 3, 4, 1, 0, 0, 0])),
    /bad magic/, 'bad magic'
  );
  assert.throws(
    () => obfuscateWasm(Uint8Array.from([0, 97, 115, 109, 2, 0, 0, 0])),
    /unsupported wasm version 2/, 'bad version'
  );
  assert.throws(
    () => obfuscateWasm(Uint8Array.from([...WASM_HEADER, 1, 0x80])), // LEB continuation with no next byte
    /truncated LEB128/, 'truncated LEB length'
  );
  assert.throws(
    () => obfuscateWasm(Uint8Array.from([...WASM_HEADER, 1, 10, 0, 0])), // declares 10, has 2
    /declares 10 payload bytes but only 2 remain/, 'section size overruns buffer'
  );
  assert.throws(
    () => obfuscateWasm(Uint8Array.from([...WASM_HEADER, 0, 2, 9, 65])), // name len 9, payload 2
    /name .* overrunning its payload/, 'custom-section name overruns payload'
  );
  assert.throws(
    () => obfuscateWasm(Uint8Array.from([...WASM_HEADER, 1, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00])),
    /more than 5 bytes/, 'LEB longer than 5 bytes'
  );
});

// (c) real wasm from the vendor tree (has both name + producers sections). -
await test('real wasm (web/vendor/clang/memfs.wasm) loses its fingerprints and still compiles', async (t) => {
  const realPath = join(repoRoot, 'web/vendor/clang/memfs.wasm');
  if (!existsSync(realPath)) {
    console.log('  (skipped: web/vendor/clang/memfs.wasm not present in this checkout)');
    return;
  }
  const real = new Uint8Array(readFileSync(realPath));
  const before = parseSections(real).filter((s) => s.id === 0).map((s) => s.name);
  assert.ok(before.includes('name') && before.includes('producers'), 'fixture carries the fingerprints');

  const result = obfuscateWasm(real);
  const after = parseSections(result);
  const customNames = after.filter((s) => s.id === 0).map((s) => s.name);
  assert.ok(!customNames.includes('name'), '"name" stripped from real module');
  assert.ok(!customNames.includes('producers'), '"producers" stripped from real module');
  assert.ok(customNames.includes('.comment'), 'decoy injected into real module');
  assert.ok(result.length < real.length, 'module shrank (fingerprints outweighed the decoy)');

  // Non-custom sections survive untouched: same count, same ids, same order.
  const realNonCustom = parseSections(real).filter((s) => s.id !== 0).map((s) => s.id);
  const outNonCustom = after.filter((s) => s.id !== 0).map((s) => s.id);
  assert.deepEqual(outNonCustom, realNonCustom, 'non-custom sections byte-identical in count/order');

  await WebAssembly.compile(result); // a 345 KB real module must still validate
});

// -----------------------------------------------------------------------------
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All wasm-obfuscate tests passed.');
