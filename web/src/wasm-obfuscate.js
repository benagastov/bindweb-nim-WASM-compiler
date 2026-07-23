/**
 * wasm-obfuscate.js — strip the Nim fingerprints from a built .wasm while
 * keeping it byte-for-byte runnable.
 *
 * A wasm module produced by the in-browser pipeline carries two custom
 * sections that give the engine away to anyone opening DevTools or a
 * wasm analysis tool:
 *
 *   "name"       function/local names — this is what makes Chrome DevTools
 *                show readable Nim symbols in stack traces and the
 *                debugger;
 *   "producers"  toolchain metadata ("language: Nim", clang/wasm-ld
 *                versions) — leaks exactly what built the binary.
 *
 * obfuscateWasm() drops both and injects one decoy custom section named
 * ".comment" whose payload is the classic GCC version string, so casual
 * analysis tools report a GCC-built C binary instead of Nim. Every other
 * section (type/import/function/table/memory/global/export/start/element/
 * code/data, plus unknown custom sections) passes through byte-identical,
 * so the module instantiates and runs exactly the same.
 *
 * The parser is deliberately strict — a malformed header, a bad LEB128
 * length or a truncated section throws a clear error instead of silently
 * emitting a corrupt module. Pure and Node-safe (no DOM, no fetch).
 */

/** Custom-section names removed from the module. */
const DROP_SECTION_NAMES = new Set(['name', 'producers']);

/** Decoy custom section: name + payload (a classic C-compiler signature). */
const DECOY_SECTION_NAME = '.comment';
const DECOY_SECTION_PAYLOAD = 'GCC: (GNU) 12.2.0';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Read an unsigned LEB128 u32 at `pos`.
 *
 * @param {Uint8Array} bytes
 * @param {number} pos
 * @returns {{value: number, next: number}} value and the offset just past it
 */
function readU32Leb(bytes, pos) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    if (pos >= bytes.length) throw new Error('wasm-obfuscate: truncated LEB128 length');
    const b = bytes[pos++];
    value += (b & 0x7f) * 2 ** shift; // exact for u32 (avoids << 28 sign flip)
    if ((b & 0x80) === 0) {
      if (value > 0xffffffff) throw new Error('wasm-obfuscate: LEB128 value exceeds u32');
      return { value, next: pos };
    }
    shift += 7;
  }
  throw new Error('wasm-obfuscate: LEB128 length uses more than 5 bytes (not a u32)');
}

/**
 * Encode a u32 as unsigned LEB128.
 *
 * @param {number} value
 * @returns {Uint8Array}
 */
function writeU32Leb(value) {
  const out = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v = Math.floor(v / 128); // >>> 7 would sign-extend nothing, but stay exact
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return Uint8Array.from(out);
}

/**
 * Strip the "name" and "producers" custom sections from a wasm binary and
 * append a decoy ".comment" section posing as a GCC-built C module.
 *
 * @param {Uint8Array} bytes the linked wasm module
 * @returns {Uint8Array} the obfuscated module (same imports/exports/code)
 * @throws {Error} on malformed input (bad magic/version, bad LEB, truncation)
 */
export function obfuscateWasm(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('wasm-obfuscate: expected a Uint8Array');
  }
  if (bytes.length < 8) {
    throw new Error('wasm-obfuscate: input shorter than the 8-byte wasm header');
  }
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error('wasm-obfuscate: bad magic (expected \\0asm)');
  }
  const version = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  if (version !== 1) {
    throw new Error(`wasm-obfuscate: unsupported wasm version ${version} (expected 1)`);
  }

  const chunks = [bytes.slice(0, 8)];
  let pos = 8;
  while (pos < bytes.length) {
    const sectionStart = pos;
    const id = bytes[pos++];
    const { value: size, next } = readU32Leb(bytes, pos);
    const payloadStart = next;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > bytes.length) {
      throw new Error(
        `wasm-obfuscate: section id ${id} at offset ${sectionStart} declares ${size} ` +
        `payload bytes but only ${bytes.length - payloadStart} remain`
      );
    }

    let drop = false;
    if (id === 0) {
      // Custom section: payload starts with a LEB128 name length + UTF-8 name.
      const { value: nameLen, next: nameStart } = readU32Leb(bytes, payloadStart);
      if (nameStart + nameLen > payloadEnd) {
        throw new Error(
          `wasm-obfuscate: custom section at offset ${sectionStart} has a name ` +
          `(${nameLen} bytes) overrunning its payload`
        );
      }
      const name = textDecoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
      drop = DROP_SECTION_NAMES.has(name);
    }

    if (!drop) {
      // Byte-identical passthrough, original LEB encoding included.
      chunks.push(bytes.slice(sectionStart, payloadEnd));
    }
    pos = payloadEnd;
  }

  // Decoy ".comment" custom section: id 0, payload = LEB(nameLen) + name +
  // raw payload bytes. Custom sections may sit anywhere; appended last.
  const decoyName = textEncoder.encode(DECOY_SECTION_NAME);
  const decoyPayload = textEncoder.encode(DECOY_SECTION_PAYLOAD);
  const decoyBodyLen = writeU32Leb(decoyName.length).length + decoyName.length + decoyPayload.length;
  chunks.push(Uint8Array.from([0]));
  chunks.push(writeU32Leb(decoyBodyLen));
  chunks.push(writeU32Leb(decoyName.length));
  chunks.push(decoyName);
  chunks.push(decoyPayload);

  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export default obfuscateWasm;
