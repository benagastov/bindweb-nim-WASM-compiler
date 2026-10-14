// Minimal `ar rc` for wasm object files, with the GNU symbol index that
// wcc's linker (src/util/archive.c) and wasm-ld read.
//   node tools/wasm-ar.mjs out.a a.o b.o ...
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

function uleb(buf, pos) {
  let result = 0, shift = 0, b;
  do { b = buf[pos++]; result += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
  return [result, pos];
}

// Global symbols a wasm object defines, from its "linking" custom section.
export function definedSymbols(bytes) {
  const out = [];
  let pos = 8;
  while (pos < bytes.length) {
    const id = bytes[pos++];
    let size; [size, pos] = uleb(bytes, pos);
    const end = pos + size;
    if (id === 0) {
      let nlen; [nlen, pos] = uleb(bytes, pos);
      const name = Buffer.from(bytes.subarray(pos, pos + nlen)).toString(); pos += nlen;
      if (name === 'linking') readLinking(bytes, pos, end, out);
    }
    pos = end;
  }
  return out;
}

function readLinking(b, pos, end, out) {
  let version; [version, pos] = uleb(b, pos);
  while (pos < end) {
    const type = b[pos++];
    let len; [len, pos] = uleb(b, pos);
    const subEnd = pos + len;
    if (type === 8) {  // WASM_SYMBOL_TABLE
      let count; [count, pos] = uleb(b, pos);
      for (let i = 0; i < count; i++) {
        const kind = b[pos++];
        let flags; [flags, pos] = uleb(b, pos);
        const undefined_ = flags & 0x10, local = flags & 0x02, explicitName = flags & 0x40;
        let name = null;
        if (kind === 1) {  // data
          let n; [n, pos] = uleb(b, pos);
          name = Buffer.from(b.subarray(pos, pos + n)).toString(); pos += n;
          if (!undefined_) { let t; [t, pos] = uleb(b, pos); [t, pos] = uleb(b, pos); [t, pos] = uleb(b, pos); }
        } else if (kind === 3) {  // section
          let t; [t, pos] = uleb(b, pos);
        } else {  // function, global, event/tag, table
          let idx; [idx, pos] = uleb(b, pos);
          if (!undefined_ || explicitName) {
            let n; [n, pos] = uleb(b, pos);
            name = Buffer.from(b.subarray(pos, pos + n)).toString(); pos += n;
          }
        }
        if (name && !undefined_ && !local) out.push(name);
      }
    }
    pos = subEnd;
  }
}

const pad = (s, n) => String(s).padEnd(n, ' ').slice(0, n);
const header = (name, size) => Buffer.from(
  pad(name, 16) + pad(0, 12) + pad(0, 6) + pad(0, 6) + pad('644', 8) + pad(size, 10) + '`\n');

export function makeArchive(files) {
  const members = files.map(f => ({ name: basename(f) + '/', data: readFileSync(f) }));
  for (const m of members) m.syms = definedSymbols(m.data);
  const symCount = members.reduce((n, m) => n + m.syms.length, 0);
  const strtab = Buffer.from(members.flatMap(m => m.syms.map(s => s + '\0')).join(''));
  let symSize = 4 + 4 * symCount + strtab.length;
  if (symSize & 1) symSize++;
  // Member offsets: after magic, symbol-table header + body.
  let off = 8 + 60 + symSize;
  for (const m of members) {
    if (m.name.length > 16) m.name = m.name.slice(0, 15) + '/';
    m.offset = off;
    off += 60 + m.data.length + (m.data.length & 1);
  }
  const index = Buffer.alloc(4 + 4 * symCount);
  index.writeUInt32BE(symCount, 0);
  let k = 4;
  for (const m of members) for (const _ of m.syms) { index.writeUInt32BE(m.offset, k); k += 4; }
  const parts = [Buffer.from('!<arch>\n'), header('/', symSize), index, strtab];
  if ((index.length + strtab.length) & 1) parts.push(Buffer.from('\n'));
  for (const m of members) {
    parts.push(header(m.name, m.data.length), m.data);
    if (m.data.length & 1) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

if (process.argv[1] && import.meta.filename && process.argv[1].endsWith('wasm-ar.mjs')) {
  const [out, ...files] = process.argv.slice(2);
  const ar = makeArchive(files);
  writeFileSync(out, ar);
  console.log(`${out}: ${files.length} members, ${ar.length} bytes`);
}
