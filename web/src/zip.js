/**
 * zip.js — minimal ZIP archive reader, dependency-free.
 *
 * Reads the central directory (so entries written with a data descriptor
 * still report correct sizes), then inflates each entry. Compression
 * methods supported: 0 (stored) and 8 (deflate, via the browser's
 * DecompressionStream('deflate-raw')). Zip64 archives, encrypted entries,
 * and multi-disk archives are rejected with a clear error — GitHub repo
 * zips and nimble package zips never use them.
 *
 * Works in any modern browser (DecompressionStream is Chrome 80+,
 * Firefox 113+, Safari 16.4+).
 */

const SIG_LFH = 0x04034b50;
const SIG_CDH = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const decoder = new TextDecoder();

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
