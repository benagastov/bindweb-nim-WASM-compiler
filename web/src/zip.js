/**
 * zip.js — minimal ZIP archive reader + writer, dependency-free.
 *
 * Reader: reads the central directory (so entries written with a data
 * descriptor still report correct sizes), then inflates each entry.
 * Compression methods supported: 0 (stored) and 8 (deflate, via the
 * browser's DecompressionStream('deflate-raw')). Zip64 archives,
 * encrypted entries, and multi-disk archives are rejected with a clear
 * error — GitHub repo zips and nimble package zips never use them.
 *
 * Writer: zipFiles() emits method-0 (stored) archives with correct
 * CRC-32s, local headers, a central directory and an EOCD record — no
 * zip64, no data descriptors, UTF-8 names flagged (bit 11). Stored is
 * deliberate: the export is a download convenience, not a size
 * optimization, and it keeps the writer (and its round-trip through
 * unzip()) trivially verifiable.
 *
 * Works in any modern browser (DecompressionStream is Chrome 80+,
 * Firefox 113+, Safari 16.4+; the writer needs nothing but TextEncoder).
 */

const SIG_LFH = 0x04034b50;
const SIG_CDH = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** General-purpose flag bit 11: entry name is UTF-8. */
const FLAG_UTF8 = 0x0800;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Locate the End Of Central Directory record by scanning backwards from
 * the end of the archive (it lives in the last 64 KiB + 22 bytes).
 *
 * @param {DataView} view
 * @returns {number} offset of the EOCD record
 * @throws {Error} if the signature is not found
 */
function findEocd(view) {
  const min = Math.max(0, view.byteLength - (0xffff + 22));
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new Error('zip: not a zip archive (end-of-central-directory not found)');
}

/**
 * Inflate one deflated entry with the platform DecompressionStream.
 *
 * @param {Uint8Array} compressed raw deflate stream (no zlib header)
 * @param {number} expected uncompressed size (sanity check)
 * @returns {Promise<Uint8Array>}
 */
async function inflate(compressed, expected) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('zip: this browser cannot inflate zip entries (no DecompressionStream)');
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  const out = new Uint8Array(buf);
  if (out.length !== expected) {
    throw new Error(`zip: inflate size mismatch (want ${expected}, got ${out.length})`);
  }
  return out;
}

/**
 * Extract a ZIP archive.
 *
 * @param {Uint8Array} u8 archive bytes
 * @returns {Promise<Array<{name: string, data: Uint8Array, isDir: boolean}>>}
 *   Directory entries have empty data and isDir=true.
 * @throws {Error} on unsupported or corrupt archives
 */
export async function unzip(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const eocd = findEocd(view);

  const diskNo = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  if (diskNo !== 0 || cdDisk !== 0) throw new Error('zip: multi-disk archives are not supported');

  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('zip: zip64 archives are not supported');
  }
  if (cdOffset + cdSize > u8.length) throw new Error('zip: truncated central directory');

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CDH) {
      throw new Error(`zip: corrupt central directory at entry ${i}`);
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const lfhOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x01) throw new Error(`zip: encrypted entry not supported: ${name}`);
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
      throw new Error('zip: zip64 archives are not supported');
    }
    const isDir = name.endsWith('/');
    entries.push({ name, method, compSize, uncompSize, lfhOffset, isDir });
  }

  // Read each entry's data from its local file header. The LFH name/extra
  // lengths can differ from the central directory's, so re-read them.
  const out = [];
  for (const entry of entries) {
    if (entry.isDir) {
      out.push({ name: entry.name.slice(0, -1), data: new Uint8Array(0), isDir: true });
      continue;
    }
    const lfh = entry.lfhOffset;
    if (view.getUint32(lfh, true) !== SIG_LFH) {
      throw new Error(`zip: corrupt local header for ${entry.name}`);
    }
    const lNameLen = view.getUint16(lfh + 26, true);
    const lExtraLen = view.getUint16(lfh + 28, true);
    const dataStart = lfh + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + entry.compSize;
    if (dataEnd > u8.length) throw new Error(`zip: truncated data for ${entry.name}`);
    const raw = u8.subarray(dataStart, dataEnd);

    let data;
    if (entry.method === 0) {
      data = u8.slice(dataStart, dataEnd);
    } else if (entry.method === 8) {
      data = await inflate(raw, entry.uncompSize); // eslint-disable-line no-await-in-loop
    } else {
      throw new Error(`zip: unsupported compression method ${entry.method} for ${entry.name}`);
    }
    out.push({ name: entry.name, data, isDir: false });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Writer (stored entries only — see the header comment).
 * ------------------------------------------------------------------------ */

/** CRC-32 (IEEE 802.3 polynomial) lookup table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 of a byte range, as stored in zip headers.
 *
 * @param {Uint8Array} u8
 * @returns {number} unsigned 32-bit checksum
 */
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a ZIP archive (stored, no compression) from a flat entry list.
 * Directory entries ({isDir: true}) are written as `name/` records so
 * empty folders survive the round-trip; file directories are implied by
 * their paths and need no explicit records.
 *
 * @param {Array<{name: string, data?: Uint8Array, isDir?: boolean}>} entries
 * @returns {Uint8Array} the archive bytes
 * @throws {Error} on names/data too large for the classic (non-zip64) format
 */
export function zipFiles(entries) {
  // Normalize: UTF-8 name bytes, directory trailing slash, empty data for dirs.
  const norm = entries.map((entry) => {
    let name = String(entry.name).replace(/\\/g, '/');
    if (entry.isDir && !name.endsWith('/')) name += '/';
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 0xffff) throw new Error(`zip: entry name too long: ${name}`);
    const data = entry.isDir ? new Uint8Array(0) : (entry.data || new Uint8Array(0));
    if (data.length > 0xffffffff) throw new Error(`zip: entry too large: ${name}`);
    return { nameBytes, data, crc: crc32(data), isDir: !!entry.isDir };
  });
  if (norm.length > 0xffff) throw new Error('zip: too many entries (zip64 not supported)');

  // One pass to size the archive, one DataView to fill it: local headers +
  // data, then the central directory, then the EOCD record.
  let localSize = 0;
  let cdSize = 0;
  for (const e of norm) {
    localSize += 30 + e.nameBytes.length + e.data.length;
    cdSize += 46 + e.nameBytes.length;
  }
  const out = new Uint8Array(localSize + cdSize + 22);
  const view = new DataView(out.buffer);

  // Fixed DOS date/time (1980-01-01 00:00:00): deterministic archives, and
  // the VFS has no meaningful mtimes to preserve here.
  const DOS_TIME = 0;
  const DOS_DATE = 0x21;

  const central = [];
  let p = 0;
  for (const e of norm) {
    const offset = p;
    view.setUint32(p, SIG_LFH, true);
    view.setUint16(p + 4, 20, true); // version needed
    view.setUint16(p + 6, FLAG_UTF8, true);
    view.setUint16(p + 8, 0, true); // method 0: stored
    view.setUint16(p + 10, DOS_TIME, true);
    view.setUint16(p + 12, DOS_DATE, true);
    view.setUint32(p + 14, e.crc, true);
    view.setUint32(p + 18, e.data.length, true); // compressed size
    view.setUint32(p + 22, e.data.length, true); // uncompressed size
    view.setUint16(p + 26, e.nameBytes.length, true);
    view.setUint16(p + 28, 0, true); // extra length
    p += 30;
    out.set(e.nameBytes, p);
    p += e.nameBytes.length;
    out.set(e.data, p);
    p += e.data.length;
    central.push({ e, offset });
  }

  const cdOffset = p;
  for (const { e, offset } of central) {
    view.setUint32(p, SIG_CDH, true);
    view.setUint16(p + 4, 20, true); // version made by
    view.setUint16(p + 6, 20, true); // version needed
    view.setUint16(p + 8, FLAG_UTF8, true);
    view.setUint16(p + 10, 0, true); // method 0: stored
    view.setUint16(p + 12, DOS_TIME, true);
    view.setUint16(p + 14, DOS_DATE, true);
    view.setUint32(p + 16, e.crc, true);
    view.setUint32(p + 20, e.data.length, true);
    view.setUint32(p + 24, e.data.length, true);
    view.setUint16(p + 28, e.nameBytes.length, true);
    view.setUint16(p + 30, 0, true); // extra length
    view.setUint16(p + 32, 0, true); // comment length
    view.setUint16(p + 34, 0, true); // disk number
    view.setUint16(p + 36, 0, true); // internal attributes
    view.setUint32(p + 38, e.isDir ? 0o40755 << 16 : 0o100644 << 16, true); // external attributes
    view.setUint32(p + 42, offset, true);
    p += 46;
    out.set(e.nameBytes, p);
    p += e.nameBytes.length;
  }

  view.setUint32(p, SIG_EOCD, true);
  view.setUint16(p + 4, 0, true); // disk number
  view.setUint16(p + 6, 0, true); // central directory disk
  view.setUint16(p + 8, norm.length, true);
  view.setUint16(p + 10, norm.length, true);
  view.setUint32(p + 12, cdSize, true);
  view.setUint32(p + 16, cdOffset, true);
  view.setUint16(p + 20, 0, true); // comment length
  return out;
}
