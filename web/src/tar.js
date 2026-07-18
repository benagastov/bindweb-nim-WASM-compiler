/**
 * tar.js — dependency-free POSIX USTAR archive reader/writer.
 *
 * Pure JavaScript, no dependencies. Works in the browser and in Node 18+
 * (only Uint8Array/TextEncoder/TextDecoder are used; no Node-only APIs).
 *
 * Format notes:
 *  - 512-byte header blocks, file data padded to 512-byte boundaries.
 *  - Long names are stored via the USTAR `prefix` field (name split at a
 *    '/' so that prefix <= 155 chars and name <= 100 chars).
 *  - Header checksum: bytes 148..155 are treated as spaces while summing,
 *    then stored as 6 octal digits + NUL + space.
 *  - Archives end with two zero-filled 512-byte blocks.
 *  - The reader additionally tolerates GNU longname ('L') entries and
 *    base-256 encoded numeric fields so tars produced without
 *    `--format=ustar` can still be read.
 */

const BLOCK = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Magic written at offset 257: "ustar\0" + "00". */
const USTAR_MAGIC = [0x75, 0x73, 0x74, 0x61, 0x72, 0x00, 0x30, 0x30];

/**
 * Parse an octal ASCII numeric field, tolerating NUL/space padding and
 * (as a fallback) GNU base-256 binary encoding for large values.
 *
 * @param {Uint8Array} bytes header block
 * @param {number} off field offset
 * @param {number} len field length
 * @returns {number} parsed value
 */
function parseNumber(bytes, off, len) {
  // GNU base-256: high bit of the first byte set.
  if (bytes[off] & 0x80) {
    let value = 0;
    for (let i = 1; i < len; i++) value = value * 256 + bytes[off + i];
    return value;
  }
  let value = 0;
  for (let i = 0; i < len; i++) {
    const c = bytes[off + i];
    if (c === 0 || c === 0x20) {
      if (value !== 0) break; // trailing padding after digits
      continue; // leading padding
    }
    if (c < 0x30 || c > 0x37) break;
    value = value * 8 + (c - 0x30);
  }
  return value;
}

/**
 * Read a NUL-terminated string field.
 *
 * @param {Uint8Array} bytes header block
 * @param {number} off field offset
 * @param {number} len field length
 * @returns {string}
 */
function parseString(bytes, off, len) {
  let end = off;
  const limit = off + len;
  while (end < limit && bytes[end] !== 0) end++;
  return decoder.decode(bytes.subarray(off, end));
}

/**
 * Write an octal ASCII numeric field as zero-padded digits + terminator.
 *
 * @param {Uint8Array} out header block
 * @param {number} off field offset
 * @param {number} len field length
 * @param {number} value value to encode
 * @param {string} [tail] terminator, default single NUL
 */
function writeNumber(out, off, len, value, tail = '\0') {
  const digits = value.toString(8).padStart(len - tail.length, '0');
  const text = digits.slice(-(len - tail.length)) + tail;
  for (let i = 0; i < len; i++) out[off + i] = i < text.length ? text.charCodeAt(i) : 0;
}

/**
 * Write a string field, NUL-padded. Returns false if it does not fit.
 *
 * @param {Uint8Array} out header block
 * @param {number} off field offset
 * @param {number} len field length
 * @param {string} text
 * @returns {boolean} whether the text fit
 */
function writeString(out, off, len, text) {
  const bytes = encoder.encode(text);
  if (bytes.length > len) return false;
  out.set(bytes, off);
  for (let i = off + bytes.length; i < off + len; i++) out[i] = 0;
  return true;
}

/**
 * Split a long path into USTAR prefix + name parts at a '/' boundary.
 *
 * @param {string} name full path
 * @returns {{prefix: string, name: string}}
 * @throws {Error} if the path cannot be represented in USTAR fields
 */
function splitLongName(name) {
  if (encoder.encode(name).length <= 100) return { prefix: '', name };
  // Walk right-to-left looking for a '/' that makes both halves fit.
  for (let i = name.length - 1; i >= 0; i--) {
    if (name[i] !== '/') continue;
    const head = name.slice(0, i);
    const tail = name.slice(i + 1);
    if (encoder.encode(tail).length <= 100 && encoder.encode(head).length <= 155) {
      return { prefix: head, name: tail };
    }
  }
  throw new Error(`tar: name too long for USTAR: ${name}`);
}

/**
 * Extract a USTAR archive.
 *
 * @param {Uint8Array} u8 archive bytes
 * @returns {Array<{name: string, data: Uint8Array, mode: number, type: 'file'|'dir'}>}
 *   Entries in archive order. Directory entries have an empty `data`.
 * @throws {Error} on truncated archives or bad header checksums
 */
export function untar(u8) {
  const entries = [];
  let offset = 0;
  let longName = null; // pending GNU 'L' longname

  while (offset + BLOCK <= u8.length) {
    const header = u8.subarray(offset, offset + BLOCK);

    // Two consecutive zero blocks mark the end; a single zero block is
    // enough in practice (some writers omit the second).
    let zero = true;
    for (let i = 0; i < BLOCK; i++) {
      if (header[i] !== 0) { zero = false; break; }
    }
    if (zero) break;

    // Verify checksum: chksum field (148..155) counts as spaces.
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) {
      sum += (i >= 148 && i < 156) ? 0x20 : header[i];
    }
    const stored = parseNumber(header, 148, 8);
    if (sum !== stored) {
      throw new Error(`tar: bad header checksum at offset ${offset} (want ${stored}, got ${sum})`);
    }

    const size = parseNumber(header, 124, 12);
    const mode = parseNumber(header, 100, 8);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > u8.length) {
      throw new Error(`tar: truncated file data for entry at offset ${offset}`);
    }

    if (typeflag === 'L') {
      // GNU longname: data block holds the NUL-terminated real name.
      longName = parseString(u8, dataStart, size);
    } else {
      let name = parseString(header, 0, 100);
      const prefix = parseString(header, 345, 155);
      if (prefix) name = prefix + '/' + name;
      if (longName) { name = longName; longName = null; }

      const isDir = typeflag === '5' || name.endsWith('/');
      if (typeflag === '0' || typeflag === '5' || isDir) {
        entries.push({
          name: isDir && name.endsWith('/') ? name.slice(0, -1) : name,
          data: isDir ? new Uint8Array(0) : u8.slice(dataStart, dataEnd),
          mode,
          type: isDir ? 'dir' : 'file',
        });
      }
      // Other typeflags (links, devices, ...) are skipped: libpacks are
      // plain file/dir archives produced by tools/pack-lib.sh.
    }

    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}

/**
 * Build a USTAR archive.
 *
 * @param {Array<{name: string, data: Uint8Array|string, mode?: number, type?: 'file'|'dir'}>} entries
 *   `data` may be a Uint8Array or a string (encoded as UTF-8).
 *   `mode` defaults to 0o644 for files, 0o755 for directories.
 *   `type` defaults to 'file' unless the name ends with '/'.
 * @returns {Uint8Array} archive bytes (ends with two zero blocks)
 * @throws {Error} if a name cannot be represented in USTAR
 */
export function tar(entries) {
  const chunks = [];

  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const data = raw || new Uint8Array(0);
    const isDir = entry.type === 'dir' || entry.name.endsWith('/');
    const name = isDir && entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name;
    const mode = entry.mode !== undefined ? entry.mode : (isDir ? 0o755 : 0o644);

    const header = new Uint8Array(BLOCK);
    const { prefix, name: shortName } = splitLongName(name);
    if (!writeString(header, 0, 100, shortName)) {
      throw new Error(`tar: name field overflow: ${name}`);
    }
    writeNumber(header, 100, 8, mode);
    writeNumber(header, 108, 8, 0); // uid
    writeNumber(header, 116, 8, 0); // gid
    writeNumber(header, 124, 12, isDir ? 0 : data.length);
    writeNumber(header, 136, 12, 0); // mtime: fixed for deterministic output
    // checksum placeholder: spaces while computing
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    header[156] = isDir ? 0x35 /* '5' */ : 0x30 /* '0' */;
    // linkname 157..256 stays zeroed
    header.set(USTAR_MAGIC, 257);
    writeString(header, 265, 32, 'root'); // uname
    writeString(header, 297, 32, 'root'); // gname
    writeNumber(header, 329, 8, 0); // devmajor
    writeNumber(header, 337, 8, 0); // devminor
    if (prefix) writeString(header, 345, 155, prefix);

    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += header[i];
    // 6 octal digits + NUL + space (POSIX)
    const chk = sum.toString(8).padStart(6, '0') + '\0 ';
    for (let i = 0; i < 8; i++) header[148 + i] = chk.charCodeAt(i);

    chunks.push(header);
    if (!isDir) {
      chunks.push(data);
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
      if (pad) chunks.push(new Uint8Array(pad));
    }
  }

  chunks.push(new Uint8Array(BLOCK * 2)); // end-of-archive markers

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}
