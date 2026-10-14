// =============================================================================
// tests/wcc.test.mjs -- the wcc C backend (web/src/wcc-compiler.js helpers)
// =============================================================================
//
// Runs the committed toolchain (toolchain/wcc/prebuilt/cc.wasm + sysroot.tar)
// on the in-memory WASI the IDE workers use (web/src/wcc/memwasi.js):
//   (a) hoistNimLabels rewrites Nim's jumps-into-blocks, nothing else;
//   (b) a C program built with the IDE's prologue + link flags runs and
//       prints what glibc/Python print (values checked independently): musl printf (%e %f %g %a, flags,
//       * precision), musl strtod (exact, subnormals), musl libm, GNU case
//       ranges, the __builtin_*_overflow shims, __alignof__;
//   (c) exports: export_name and default-visibility functions are exported
//       (like wasm-ld --export-dynamic), hidden ones are not; the function
//       table is exported for the bindweb runtime.
//
// Run with Node 18+:  node tests/wcc.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { untar } from '../web/src/tar.js';
import { MemFS, runWasi } from '../web/src/wcc/memwasi.js';
import { hoistNimLabels, buildWccTU, WCC_LINK_FLAGS } from '../web/src/wcc/wcc-backend.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREBUILT = join(ROOT, 'toolchain', 'wcc', 'prebuilt');
let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${String(e.stack || e).split('\n').slice(0, 6).join('\n     ')}`); }
}

// ---- (a) label rewrites -----------------------------------------------------
await test('hoistNimLabels: if-block label', () => {
  const src = 'goto LA1_;\n\tif (NIM_UNLIKELY(*nimErr_)) {\n\t\tLA1_:;\n\t\tx = 1;\n\t}\n\ty = 2;';
  const { text, count } = hoistNimLabels(src);
  assert.equal(count, 1);
  assert.match(text, /if \(!\(NIM_UNLIKELY\(\*nimErr_\)\)\) goto LA1__skip; LA1_: ;\{/);
  assert.match(text, /x = 1;\n\t\} LA1__skip: ;\n\ty = 2;/);
});
await test('hoistNimLabels: standalone block label', () => {
  const { text, count } = hoistNimLabels('a();\n\t{\n\t\tLA2_:;\n\t\tb();\n\t}');
  assert.equal(count, 1);
  assert.match(text, /a\(\);\n\tLA2_: ;\{\s*b\(\);/);
});
await test('hoistNimLabels: leaves else-branches and loop bodies alone', () => {
  const src = 'if (c) { L1:; a(); } else { b(); }\nwhile (1) { L2:; }';
  assert.equal(hoistNimLabels(src).count, 0);
});

// ---- toolchain on the in-memory WASI ---------------------------------------
const module = new WebAssembly.Module(readFileSync(join(PREBUILT, 'cc.wasm')));
const base = new Map(untar(readFileSync(join(PREBUILT, 'sysroot.tar')))
  .filter((e) => e.type === 'file').map((e) => [`/${e.name.replace(/^\.?\//, '')}`, e.data]));
const prologue = readFileSync(join(ROOT, 'web', 'src', 'wcc', 'wcc-prologue.h'), 'utf8');
const enc = new TextEncoder();

function build(cSource) {
  const fs = new MemFS(base);
  const tu = buildWccTU('test.c', cSource, prologue, '/* nimbase not needed */');
  fs.write('/work/t.c', enc.encode(tu.code));
  const cc = runWasi(module, { args: ['wcc', '-c', '-o', '/work/t.o', '/work/t.c'], fs });
  assert.equal(cc.code, 0, `compile failed:\n${cc.stderr}`);
  const ld = runWasi(module, { args: ['wcc', ...WCC_LINK_FLAGS, '-o', '/work/a.wasm', '/work/t.o'], fs });
  assert.equal(ld.code, 0, `link failed:\n${ld.stderr}`);
  return fs.read('/work/a.wasm');
}

const PROGRAM = String.raw`
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <string.h>

__attribute__((export_name("api_exported"))) int api_exported(int x) { return x + 1; }
__attribute__((visibility("hidden"))) int hidden_helper(int x) { return x * 2; }
int dynamic_export(int x) { return hidden_helper(x); }

static const char *kind(int c) {
  switch (c) {
  case '0' ... '9': return "digit";
  case 'a' ... 'z': case 'A' ... 'Z': return "letter";
  default: return "other";
  }
}

int main(void) {
  printf("%.2f|%8.3f|%+.1f|%e|%g|%.3e|%#.*f|%a\n", 3.14159, 2.5, -1.0, 1e10, 12345.678, 0.000123, 2, 1.0, 1.0);
  printf("%5d|%-5d|%05d|%x|%X|%o|%s|%c|%%\n", 42, 42, 42, 255, 255, 8, "str", 'z');
  printf("%.17g %.17g %g\n", strtod("1e300", 0), strtod("123456789.125", 0), strtod("1e-310", 0));
  printf("%s %s\n", fpclassify(strtod("1e-310", 0)) == FP_SUBNORMAL ? "subnormal" : "not-subnormal", 1e300 == strtod("1e300", 0) ? "exact" : "inexact");
  printf("%.15g %.15g %.15g %.15g %.15g\n", sin(1e6), tgamma(5.5), cbrt(-27.0), erf(0.5), hypot(3, 4));
  printf("%.7g %.7g\n", (double)sinf(0.5f), (double)powf(2.0f, 10.5f));
  printf("%s %s %s\n", kind('7'), kind('Q'), kind('#'));
  int r32; long long r64;
  printf("%d %d %d\n", __builtin_sadd_overflow(2147483647, 1, &r32), __builtin_smul_overflow(46341, 46341, &r32),
         __builtin_saddll_overflow(9223372036854775807LL, 1LL, &r64));
  printf("%d %d %d\n", (int)__alignof__(double), (int)sizeof(long), api_exported(1) + dynamic_export(2));
  return 0;
}
`;

const EXPECTED = [
  '3.14|   2.500|-1.0|1.000000e+10|12345.7|1.230e-04|1.00|0x1p+0',
  '   42|42   |00042|ff|FF|10|str|z|%',
  '1.0000000000000001e+300 123456789.125 1e-310',
  'subnormal exact',
  '-0.349993502171293 52.3427777845535 -3 0.520499877813047 5',
  '0.4794255 1448.155',
  'digit letter other',
  '1 1 1',
  '8 4 6',
].join('\n') + '\n';

let wasm = null;
await test('wcc builds a C program with the IDE prologue and link flags', () => { wasm = build(PROGRAM); });

await test('the program prints exactly what glibc prints', () => {
  const app = new WebAssembly.Module(wasm);
  const r = runWasi(app, { args: ['a.wasm'], fs: new MemFS(new Map()) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, EXPECTED);
});

await test('exports follow export_name/visibility like wasm-ld --export-dynamic', () => {
  const names = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map((e) => e.name);
  for (const n of ['api_exported', 'dynamic_export', 'memory', '__indirect_function_table']) assert.ok(names.includes(n), `${n} missing in ${names}`);
  assert.ok(!names.includes('hidden_helper'), 'hidden function exported');
  assert.ok(!names.includes('printf'), 'libc function exported');
});

await test('imports are only WASI (no stray env imports)', () => {
  const mods = new Set(WebAssembly.Module.imports(new WebAssembly.Module(wasm)).map((i) => i.module));
  assert.deepEqual([...mods], ['wasi_snapshot_preview1']);
});

if (failures) { console.log(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nall wcc tests passed');
