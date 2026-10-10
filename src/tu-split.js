/**
 * tu-split.js — split one oversized Nim C translation unit into N "codegen
 * units" that clang can compile in parallel (the rustc codegen-units idea).
 *
 * A Nim module that `include`s the whole app becomes one multi-megabyte C
 * file, and clang.wasm compiles a TU on one thread: QNote's main.nim.c
 * (6.6 MB) alone took 45 s while the other workers sat idle. Splitting it
 * puts that work on every worker.
 *
 * Every part keeps all preprocessor lines, types, prototypes, `static`
 * items (clang drops the unused ones) and inline functions. Non-static
 * function bodies are dealt out to the parts by size; the other parts see
 * only their prototype. Non-static global variables are defined in part 0
 * and declared `extern` (initializer removed) in the rest.
 *
 * splitTU() returns null whenever the file does not look like plain Nim
 * codegen output (unbalanced braces, a mutable `static` global that would
 * be duplicated, ...) — the caller then compiles the file unsplit, and it
 * also falls back to unsplit if a split part fails to compile or link.
 */

/**
 * Top-level items of a C file: [{text, kind}] where kind is 'pp' | 'func'
 * | 'decl'. Comments, strings and char literals are skipped while matching
 * braces. Returns null if the braces never balance.
 */
function topLevelItems(code) {
  const items = [];
  const n = code.length;
  let i = 0;
  let start = 0;
  let depth = 0;
  let firstBrace = -1;      // index of the first depth-0 '{' in this item
  const push = (end, kind) => {
    const text = code.slice(start, end);
    if (text.trim()) items.push({ text, kind, head: firstBrace >= 0 ? code.slice(start, firstBrace) : text });
    start = end;
    firstBrace = -1;
  };
  while (i < n) {
    const c = code.charCodeAt(i);
    // Preprocessor line at top level: '#' first on its line, and nothing but
    // whitespace/comments pending in the current item (those are flushed as
    // their own item so the directive stays in every part).
    if (c === 35 /* # */ && depth === 0 && atLineStart(code, i) && !stripComments(code.slice(start, i)).trim()) {
      if (code.slice(start, i).trim()) push(i, 'pp');
      let j = i;
      while (j < n) {
        const nl = code.indexOf('\n', j);
        if (nl < 0) { j = n; break; }
        let k = nl - 1;
        if (code.charCodeAt(k) === 13) k--;
        if (code.charCodeAt(k) === 92 /* \ */) { j = nl + 1; continue; }
        j = nl + 1;
        break;
      }
      i = j;
      push(i, 'pp');
      continue;
    }
    if (c === 47 /* / */ && code.charCodeAt(i + 1) === 47) {
      const nl = code.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === 47 && code.charCodeAt(i + 1) === 42 /* * */) {
      const e = code.indexOf('*/', i + 2);
      if (e < 0) return null;
      i = e + 2;
      continue;
    }
    if (c === 34 /* " */ || c === 39 /* ' */) {
      let j = i + 1;
      while (j < n) {
        const d = code.charCodeAt(j);
        if (d === 92) { j += 2; continue; }
        if (d === c) break;
        if (d === 10) return null;
        j++;
      }
      if (j >= n) return null;
      i = j + 1;
      continue;
    }
    if (c === 123 /* { */) {
      if (depth === 0 && firstBrace < 0) firstBrace = i;
      depth++;
    } else if (c === 125 /* } */) {
      depth--;
      if (depth < 0) return null;
      if (depth === 0) {
        const head = code.slice(start, firstBrace);
        const isAggregate = /=\s*$/.test(head) ||
          /^\s*(typedef|struct|union|enum)\b/.test(head) ||
          /(^|\s)(struct|union|enum)(\s+\w+)?\s*$/.test(head);
        if (!isAggregate) {
          i++;
          push(i, 'func');
          continue;
        }
      }
    } else if (c === 59 /* ; */ && depth === 0) {
      i++;
      push(i, 'decl');
      continue;
    }
    i++;
  }
  if (depth !== 0) return null;
  if (code.slice(start).trim()) return null;
  return items;
}

function atLineStart(code, i) {
  for (let j = i - 1; j >= 0; j--) {
    const d = code.charCodeAt(j);
    if (d === 10) return true;
    if (d !== 32 && d !== 9 && d !== 13) return false;
  }
  return true;
}

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const isStatic = (head) => /^\s*static\b/.test(head);
const isInline = (head) => /\b(N_INLINE|inline|__inline__|__inline)\b/.test(head);
const isTypeDecl = (head) => /^\s*(typedef|struct|union|enum)\b/.test(head);

/**
 * Does a top-level declaration define a variable (rather than declare a
 * function or a type)? Prototypes end in ')' before ';'.
 */
function isVariableDefinition(text) {
  const t = stripComments(text).trim();
  if (isTypeDecl(t) || /^\s*extern\b/.test(t)) return false;
  const eq = topLevelEquals(t);
  const decl = eq >= 0 ? t.slice(0, eq) : t.slice(0, -1);
  return !/\)\s*$/.test(decl);
}

/** Index of the first '=' outside parentheses/brackets/braces, or -1. */
function topLevelEquals(t) {
  let d = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === '=' && d === 0 && t[i + 1] !== '=') return i;
  }
  return -1;
}

/** `T x = {...};` -> `extern T x;` */
function externOf(text) {
  const t = stripComments(text).trim();
  const eq = topLevelEquals(t);
  const decl = (eq >= 0 ? t.slice(0, eq) : t.slice(0, -1)).trim();
  return `extern ${decl};\n`;
}

/**
 * Split `code` into `parts` compilable TUs, or return null if it cannot be
 * split safely.
 *
 * @param {string} code full TU (prologue + nimbase + module C)
 * @param {number} parts desired number of codegen units (>= 2)
 * @returns {string[] | null}
 */
export function splitTU(code, parts) {
  if (parts < 2) return null;
  // The prologue + nimbase.h (pipeline buildTU) go verbatim into every part:
  // nimbase has `namespace ... {` inside #ifdef __cplusplus, which a brace
  // matcher cannot follow. Only the module code after the marker is split.
  const marker = code.indexOf('\n/* ===== ');
  if (marker < 0) return null;
  const bodyStart = code.indexOf('\n', marker + 1) + 1;
  const prefix = code.slice(0, bodyStart);
  const items = topLevelItems(code.slice(bodyStart));
  if (!items) return null;
  for (const it of items) {
    // Every brace-bodied item must look like `... name(args)`; anything else
    // (an `extern "C" {` block, odd macros) means: do not split.
    if (it.kind === 'func' && !/\)\s*$/.test(stripComments(it.head))) return null;
  }

  // Which function bodies can be moved?
  const movable = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.kind === 'decl') {
      const t = stripComments(it.text).trim();
      // A mutable static global would silently become one copy per part.
      if (isStatic(t) && isVariableDefinition(t)) {
        const eq = topLevelEquals(t);
        if (!/\b(const|NIM_CONST)\b/.test(eq >= 0 ? t.slice(0, eq) : t)) return null;
      }
      continue;
    }
    if (it.kind !== 'func') continue;
    if (isStatic(it.head) || isInline(it.head)) continue;
    // Function-local `static` storage in a moved body is fine (it lives in
    // exactly one part); nothing else to check.
    movable.push(k);
  }
  if (movable.length < parts) return null;

  // Largest-first onto the least-loaded part. Optimizer time grows faster
  // than linearly with function size (QGraph's 239 KB blockBody alone made
  // its part twice as slow as the others), so big bodies weigh more.
  const cost = (k) => { const n = items[k].text.length; return n * (1 + n / 65536); };
  const owner = new Map();
  const load = new Array(parts).fill(0);
  const bySize = movable.slice().sort((a, b) => cost(b) - cost(a));
  for (const k of bySize) {
    let p = 0;
    for (let q = 1; q < parts; q++) if (load[q] < load[p]) p = q;
    owner.set(k, p);
    load[p] += cost(k);
  }

  // Static definitions (string literals, const tables, inline functions)
  // are copied only into the parts that reach them: a Nim module carries
  // thousands of literals, and parsing all of them in every part was most
  // of each part's compile time.
  const staticName = new Map();   // name -> item index
  const isPrunable = new Array(items.length).fill(false);
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    let name = null;
    if (it.kind === 'func' && !owner.has(k)) name = funcName(it.head);
    else if (it.kind === 'decl' && isStatic(it.text) && isVariableDefinition(it.text)) name = varName(it.text);
    if (name && !staticName.has(name)) { staticName.set(name, k); isPrunable[k] = true; }
  }
  const refCache = new Map();
  const refsOf = (k) => {
    let r = refCache.get(k);
    if (!r) {
      r = [];
      const seen = new Set();
      for (const m of stripComments(items[k].text).matchAll(/[A-Za-z_]\w*/g)) {
        const j = staticName.get(m[0]);
        if (j !== undefined && j !== k && !seen.has(j)) { seen.add(j); r.push(j); }
      }
      refCache.set(k, r);
    }
    return r;
  };

  const out = [];
  for (let p = 0; p < parts; p++) {
    // Roots: everything this part keeps verbatim that is not prunable.
    const keep = new Uint8Array(items.length);
    const stack = [];
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (isPrunable[k]) continue;
      if (it.kind === 'func' && owner.has(k) && owner.get(k) !== p) continue;
      if (p > 0 && it.kind === 'decl' && !isStatic(it.text) && isVariableDefinition(it.text)) continue;
      stack.push(k);
    }
    while (stack.length) {
      for (const j of refsOf(stack.pop())) {
        if (!keep[j]) { keep[j] = 1; stack.push(j); }
      }
    }
    const chunks = [prefix];
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (isPrunable[k]) {
        if (keep[k]) chunks.push(it.text);
      } else if (it.kind === 'func' && owner.has(k)) {
        chunks.push(owner.get(k) === p ? it.text : `${stripComments(it.head).trim()};\n`);
      } else if (p > 0 && it.kind === 'decl' && !isStatic(it.text) && isVariableDefinition(it.text)) {
        chunks.push(externOf(it.text));
      } else {
        chunks.push(it.text);
      }
    }
    out.push(chunks.join(''));
  }
  return out;
}

/** `static N_INLINE(void, foo)(int a)` / `static int foo(int a)` -> foo */
function funcName(head) {
  const h = stripComments(head);
  const macro = h.match(/(\w+)\s*\)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*$/);
  if (macro && /\b(N_\w+)\s*\(/.test(h)) return macro[1];
  const plain = h.match(/(\w+)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*$/);
  return plain ? plain[1] : null;
}

/** `static const T name[3] = {...};` -> name */
function varName(text) {
  const t = stripComments(text).trim();
  const eq = topLevelEquals(t);
  let decl = (eq >= 0 ? t.slice(0, eq) : t.slice(0, -1)).trim();
  decl = decl.replace(/(\s*\[[^\]]*\])+$/, '');
  const m = decl.match(/(\w+)\s*$/);
  return m ? m[1] : null;
}

/** Exposed for tests. */
export const _internal = { topLevelItems, isVariableDefinition, externOf };
