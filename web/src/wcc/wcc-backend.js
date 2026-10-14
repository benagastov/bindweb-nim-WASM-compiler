// wcc-backend.js -- how a Nim-generated C file becomes a wcc translation unit,
// and how wcc links them. Shared by the IDE (wcc-compiler.js) and the Node
// test tools; dependency-free ESM.

// Index of the `}` matching the `{` at `open`, skipping strings, chars, comments.
function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++; }
    else if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 1; }
    else if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; }
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Nim's goto-based exceptions jump forward into blocks:
 *   `goto L; ... if (COND) { L:; body }`  and  `goto L; ... { L:; body }`.
 * wcc emits structured wasm control flow and only supports forward jumps to
 * labels in the same or an enclosing block, so both shapes are rewritten
 * into equivalent code without jumps into blocks:
 *   `if (!(COND)) goto L_skip; L: ;{ body } L_skip: ;`   and   `L: ;{ body }`.
 * @returns {{text: string, count: number}}
 */
export function hoistNimLabels(src) {
  let count = 0;
  let s = src;
  const re = /if \(([^\n{]*)\) \{(\s*)([A-Za-z_]\w*):;/g;
  let m;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].indexOf('{');
    const close = matchBrace(s, open);
    if (close < 0 || /^\s*else\b/.test(s.slice(close + 1, close + 20))) continue;
    const [, cond, ws, label] = m;
    const head = `if (!(${cond})) goto ${label}_skip; ${label}: ;{${ws}`;
    s = s.slice(0, m.index) + head + s.slice(m.index + m[0].length, close + 1) + ` ${label}_skip: ;` + s.slice(close + 1);
    re.lastIndex = m.index + head.length;
    count++;
  }
  // Only standalone blocks (after `;`, `{` or `}`), never an if/else/loop body.
  s = s.replace(/([;{}]\s*)\{(\s*)([A-Za-z_]\w*):\s*;/g, (_, pre, ws, l) => (count++, `${pre}${l}: ;{${ws}`));
  return { text: s, count };
}

/** Link flags matching the clang path: host imports allowed, a 1 MB stack
 *  (wcc's default is 8 KB), and every non-hidden function exported like
 *  wasm-ld's --export-dynamic. */
export const WCC_LINK_FLAGS = ['-Wl,--allow-undefined', '-Wl,--export-dynamic', '-Wl,--export-table', '--stack-size=1048576'];

/** Drop the per-TU lines the prologue replaces (same as pipeline.js stripNimPrologue). */
export function stripNimPrologue(c) {
  return c.split('\n')
    .filter((l) => !/^#include\s+["<](?:\/lib\/)?nimbase\.h[">]\s*$/.test(l))
    .filter((l) => !/^#define NIM_INTBITS/.test(l))
    .filter((l) => !/^#define NIM_EmulateOverflowChecks/.test(l))
    .filter((l) => !/^#undef (LANGUAGE_C|MIPSEB|MIPSEL|PPC|R3000|R4000|i386|linux|mips|near|far|powerpc|unix)\s*$/.test(l))
    .join('\n');
}

/** Nim's 3-arg main -> the 2-arg form crt calls (same as pipeline.js fixNimMain). */
export function fixNimMain(c) {
  return c.replace(/int main\(int (\w+), char\*\* (\w+), char\*\* (\w+)\) \{/,
    'int main(int $1, char** $2) {\n\tchar** $3 = (char**)0;');
}

/**
 * Assemble a wcc TU from one Nim-generated C file (raw, as nim wrote it).
 * Nim built with -d:nimEmulateOverflowChecks defines nimAddInt & co. itself
 * and says so with `#define NIM_EmulateOverflowChecks`; that define is kept
 * so nimbase.h doesn't add its builtin-based macros on top.
 * @param {string} prologue contents of wcc-prologue.h
 * @param {string} nimbase contents of nimbase.h
 */
export function buildWccTU(name, raw, prologue, nimbase) {
  const emulate = /^#define NIM_EmulateOverflowChecks/m.test(raw);
  const { text: body, count } = hoistNimLabels(fixNimMain(stripNimPrologue(raw)));
  const mode = emulate ? '#define NIM_EmulateOverflowChecks\n' : '';
  return { code: `${prologue}\n${mode}${nimbase}\n/* ===== ${name} ===== */\n${body}\n`, rewrites: count };
}

/** Same as pipeline.js RAISE_STUB_C: WASI has no signals. */
export const RAISE_STUB_C = '__attribute__((weak)) int raise(int sig) { (void)sig; return 0; }\n';

/** The bindweb C runtime as one TU (same as pipeline.js buildBindwebRuntimeTU). */
export function buildBindwebRuntimeTU(runtimeC, runtimeH) {
  const inlined = runtimeC.replace(/#include\s+"bindweb_runtime\.h"/g, runtimeH);
  return `#include <string.h>\n${inlined}`;
}
