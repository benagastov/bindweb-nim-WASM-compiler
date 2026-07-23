// =============================================================================
// tests/site-template.test.mjs -- contract tests for the site generator in
// web/src/site-template.js
// =============================================================================
//
// A generated site is index.html + one .wasm per project .nim file — the JS
// runtime (wasi-shim, bindweb-runtime, run-wasm, boot) is INLINED into
// index.html as minified classic <script> blocks; there is no nim-runtime/
// folder.
//
// Tests:
//   (a) generateSiteIndex inlines the four runtime scripts in execution
//       order (wasi-shim -> bindweb-runtime -> run-wasm -> boot), with the
//       window.__APP_WASM_URL__ line BEFORE them, still carrying the quoted
//       wasm path; the generated marker is present; no external
//       nim-runtime/* <script src> references remain.
//   (b) </script>-safety: the emitted document's only "</script" sequences
//       are the real closing tags (one per <script> block), and a runtime
//       source containing "</script" makes generateSiteIndex throw a
//       build-time error naming the file.
//   (c) minifyInlineRuntime strips block comments and full-line //
//       comments, trims trailing whitespace and collapses blank runs —
//       but preserves string contents, inline // comments and code
//       verbatim (no renaming).
//   (d) the real runtime sources (web/src/runtime/*.js + SITE_BOOT_JS)
//       inline cleanly: no "</script" anywhere, and the emitted document
//       still contains the runnable globals in order.
//   (e) rewriteSiteUrls still rewrites the quoted wasm path in the
//       generated document (the in-IDE preview depends on it).
//
// Run with Node 18+:  node tests/site-template.test.mjs
// No dependencies beyond node: builtins and web/src/site-template.js.
// =============================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  SITE_GENERATED_MARKER,
  RUNTIME_SITE_FILES,
  SITE_BOOT_JS,
  stripEsmExports,
  minifyInlineRuntime,
  rewriteSiteUrls,
  disarmDomainGateForPreview,
  generateSiteIndex,
  normalizeDomainName,
  collectBoundDomains,
  encodeRuntimePayload,
  decodeRuntimePayload,
} from '../web/src/site-template.js';

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

/** Synthetic runtime scripts in the real execution order. */
function fakeRuntimeScripts() {
  return [
    { name: 'wasi-shim.js', code: 'function createWasiShim() { return 1; }\n' },
    { name: 'bindweb-runtime.js', code: 'function createBindwebRunner() { return 2; }\n' },
    { name: 'run-wasm.js', code: 'async function runWasmApp() { return 3; }\n' },
    { name: 'boot.js', code: 'runWasmApp();\n' },
  ];
}

/** The real runtime sources, loaded and stripped exactly like Build does. */
function realRuntimeScripts() {
  const scripts = RUNTIME_SITE_FILES.map((f) => ({
    name: f.dest.slice('nim-runtime/'.length),
    code: stripEsmExports(readFileSync(join(repoRoot, 'web/src/runtime', f.src.split('/').pop()), 'utf8')),
  }));
  scripts.push({ name: 'boot.js', code: SITE_BOOT_JS });
  return scripts;
}

/** Extract every classic <script> body from a generated document, in order. */
function scriptBodies(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/** Extract the base64 payload from the emitted decoder script and decode it. */
function decodePayloadFrom(html) {
  const m = html.match(/\(new Function\(decode\("([A-Za-z0-9+/=]+)"\)\)\)\(\);/);
  assert.ok(m, 'payload decoder script present');
  return { base64: m[1], source: decodeRuntimePayload(m[1]) };
}

// (a) Payload placement, __APP_WASM_URL__ placement, marker, no nim-runtime.
await test('generateSiteIndex emits one obfuscated payload after the plaintext wasm global', async () => {
  const html = generateSiteIndex('main.nim', 'sub/main.wasm', fakeRuntimeScripts());

  assert.ok(html.includes(SITE_GENERATED_MARKER), 'generated marker present');

  // The config script stays PLAINTEXT (the in-IDE preview rewrites it).
  const idxGlobal = html.indexOf('window.__APP_WASM_URL__ = "sub/main.wasm";');
  assert.ok(idxGlobal !== -1, 'wasm global line carries the quoted wasm path');

  // One decoder script, after the config script; view-source shows no
  // readable runtime source at all.
  const idxDecoder = html.indexOf('(new Function(decode("');
  assert.ok(idxDecoder !== -1, 'obfuscated payload decoder script present');
  assert.ok(idxDecoder > idxGlobal, 'payload comes after the wasm global');
  assert.ok(!html.includes('function createWasiShim'), 'runtime source not readable in view-source');
  assert.ok(!html.includes('runWasmApp();'), 'boot source not readable in view-source');

  // Decode the payload: the four runtime scripts are concatenated in
  // execution order, each behind its minified-inline banner.
  const { source } = decodePayloadFrom(html);
  const names = ['wasi-shim.js', 'bindweb-runtime.js', 'run-wasm.js', 'boot.js'];
  let prev = -1;
  for (const name of names) {
    const idx = source.indexOf(`/* ${name} — inlined (minified) by Nim Playground Build */`);
    assert.ok(idx !== -1, `payload segment for ${name} present`);
    assert.ok(idx > prev, `${name} comes after the previous segment`);
    prev = idx;
  }
  assert.ok(source.includes('function createWasiShim'), 'decoded payload carries the runtime source');

  assert.ok(!html.includes('nim-runtime/'), 'no nim-runtime/ references left');
  assert.ok(!/<script[^>]*\bsrc=/.test(html), 'no external <script src> tags');
});

// (b) </script>-safety of the emitted document + hard error on bad input. --
await test('emitted document has no stray </script and rejects sources containing one', async () => {
  const scripts = fakeRuntimeScripts();
  const html = generateSiteIndex('main.nim', 'main.wasm', scripts);

  const opens = html.match(/<script>/g) || [];
  assert.equal(opens.length, 2, 'the wasm global config script + one payload script');
  const closes = html.match(/<\/script>/gi) || [];
  assert.equal(closes.length, opens.length, 'every </script is a real closing tag');
  // The base64 alphabet cannot produce "</script", so the payload script is
  // inline-safe by construction.
  assert.ok(!/<\/script/i.test(decodePayloadFrom(html).base64), 'payload itself contains no </script');

  assert.throws(
    () => generateSiteIndex('t', 'a.wasm', [{ name: 'bad.js', code: 'const s = "</scrIpt>";\n' }]),
    (e) => e instanceof Error && e.message.includes('bad.js') && e.message.includes('</script'),
    'throws a build-time error naming the offending file (case-insensitive match)'
  );
});

// (c) minifyInlineRuntime: comments/whitespace stripped, strings/code kept. -
await test('minifyInlineRuntime strips comments but preserves strings and code', async () => {
  const input = [
    '/**',
    ' * JSDoc banner.',
    ' */',
    '',
    '',
    '',
    '// full-line comment',
    '   // indented full-line comment',
    'const url = "http://example.com//not-a-comment";  ',
    'const tag = "/* not a comment */";',
    'const x = 1; // inline comment stays',
    '/* one-line block */',
    '/* starts',
    '   ends */ const kept = true;',
    '',
  ].join('\n');
  const out = minifyInlineRuntime(input);

  assert.ok(!out.includes('JSDoc banner'), 'block comment stripped');
  assert.ok(!out.includes('full-line comment'), 'full-line // comments stripped');
  assert.ok(!out.includes('one-line block'), 'one-line block comment stripped');
  assert.ok(!out.includes('starts'), 'multi-line block comment stripped');
  assert.ok(out.includes('const url = "http://example.com//not-a-comment";'), 'string contents preserved');
  assert.ok(out.includes('const tag = "/* not a comment */";'), 'inline /* inside a string preserved');
  assert.ok(out.includes('const x = 1; // inline comment stays'), 'inline // comment kept');
  assert.ok(out.includes('const kept = true;'), 'code after a block comment survives');
  assert.ok(!/ \n/.test(out) && !out.endsWith(' '), 'trailing whitespace trimmed');
  assert.ok(!/\n\n\n/.test(out), 'blank runs collapsed to at most one');
  assert.ok(!out.startsWith('\n'), 'no leading blank line');
});

// (d) The real runtime sources inline cleanly (decode the payload first). -
await test('real runtime sources encode verbatim-safe and keep their globals in order', async () => {
  const html = generateSiteIndex('main.nim', 'main.wasm', realRuntimeScripts());

  const closes = html.match(/<\/script/gi) || [];
  const opens = html.match(/<script>/g) || [];
  assert.equal(closes.length, opens.length, 'no </script leaked from real sources');

  // The emitted document is gibberish: nothing readable survives outside
  // the payload.
  assert.ok(!html.includes('createWasiShim'), 'runtime source obfuscated in the emitted document');
  assert.ok(!html.includes('DO NOT EDIT'), 'no readable commentary in the emitted document');

  const { source } = decodePayloadFrom(html);
  const iShim = source.indexOf('createWasiShim');
  const iBind = source.indexOf('createBindwebRunner');
  const iRun = source.indexOf('runWasmApp');
  const iBoot = source.indexOf("window.__APP_WASM_URL__ || 'app.wasm'");
  assert.ok(iShim !== -1 && iBind !== -1 && iRun !== -1 && iBoot !== -1, 'runtime globals present in the decoded payload');
  assert.ok(iShim < iBind && iBind < iRun && iRun < iBoot, 'globals appear in execution order');

  assert.ok(!/^\s*export\s+(function|const|let|default)/m.test(source), 'ESM exports stripped from inlined code');
  assert.ok(!source.includes('DO NOT EDIT'), 'block-comment banners minified away');
  assert.ok(!source.includes('WASI (preview1) host shim'), 'readable engine commentary minified away');
});

// (e) rewriteSiteUrls still rewrites the quoted wasm path. ------------------
await test('rewriteSiteUrls rewrites the wasm path in the generated document', async () => {
  const html = generateSiteIndex('main.nim', 'sub/main.wasm', fakeRuntimeScripts());
  const urlMap = new Map([['sub/main.wasm', 'blob:https://fake/1234']]);
  const rewritten = rewriteSiteUrls(html, urlMap);

  assert.ok(
    rewritten.includes('window.__APP_WASM_URL__ = "blob:https://fake/1234";'),
    'wasm global now points at the blob URL'
  );
  assert.ok(!rewritten.includes('"sub/main.wasm"'), 'quoted wasm path fully rewritten');
});

// (f) Boot-gate globals: bound domains + wasm manifest embedded by opts. --
await test('generateSiteIndex embeds bound domains and the wasm manifest from opts', async () => {
  const html = generateSiteIndex('main.nim', 'main.wasm', fakeRuntimeScripts(), {
    boundDomains: ['example.com'],
    wasmManifest: ['main.wasm', 'sub/mod.wasm'],
  });

  const idxUrl = html.indexOf('window.__APP_WASM_URL__ = "main.wasm";');
  const idxManifest = html.indexOf('window.__APP_WASM_MANIFEST__ = ["main.wasm","sub/mod.wasm"];');
  const idxBound = html.indexOf('window.__BINDWEB_BOUND_DOMAINS__ = ["example.com"];');
  assert.ok(idxUrl !== -1, 'wasm URL global present');
  assert.ok(idxManifest !== -1, 'wasm manifest embedded, entry first');
  assert.ok(idxBound !== -1, 'bound domains embedded');
  assert.ok(idxUrl < idxManifest && idxManifest < idxBound, 'gate globals follow the wasm URL, before the runtime');

  // Without opts the legacy document shape is unchanged (no gate globals).
  const plain = generateSiteIndex('main.nim', 'main.wasm', fakeRuntimeScripts());
  assert.ok(!plain.includes('__APP_WASM_MANIFEST__'), 'no manifest global without opts');
  assert.ok(!plain.includes('__BINDWEB_BOUND_DOMAINS__'), 'no bound-domains global without opts');

  // The in-IDE preview's rewriteSiteUrls rewrites manifest entries too.
  const rewritten = rewriteSiteUrls(html, new Map([['sub/mod.wasm', 'blob:https://fake/99']]));
  assert.ok(rewritten.includes('"blob:https://fake/99"'), 'manifest path rewritten to blob URL');
  assert.ok(!rewritten.includes('"sub/mod.wasm"'), 'quoted manifest path fully rewritten');
});

// (g) Domain scanning + normalization helpers used by the Build handler. ---
await test('collectBoundDomains scans bindDomain/bind_domain calls and normalizes', async () => {
  const sources = [
    'bindDomain("https://www.Example.com:8080/app")\necho "hi"',
    'bind_domain( "EXAMPLE.com" )', // duplicate after normalization
    'bindDomain("static.example.net")',
    'bind_domain("   ")', // whitespace-only: dropped
    'let x = 1 # bindDomain("commented.example") still matches textually (regex scan)',
  ];
  const domains = collectBoundDomains(sources);
  assert.deepEqual(domains, ['commented.example', 'example.com', 'static.example.net'],
    'unique, normalized, sorted (a textual regex scan, comments included)');

  assert.equal(normalizeDomainName('https://www.Example.com:8080/x?q=1#f'), 'example.com');
  assert.equal(normalizeDomainName('WWW.Foo.NET'), 'foo.net');
  assert.equal(normalizeDomainName('foo.net:8443'), 'foo.net');
  assert.equal(normalizeDomainName(''), '');
  // Same anchored-scheme semantics as runtime/bindweb-browser-runtime.js:
  // only a real `scheme://` prefix is stripped ("1http://..." is not).
  assert.equal(normalizeDomainName('1http://foo.com'), '1http');
  assert.equal(normalizeDomainName('git+ssh://www.foo.com'), 'foo.com');
});

// (j) In-IDE preview disarms the domain gate; the stored site file keeps it.
await test('disarmDomainGateForPreview empties the bound domains only in the preview document', async () => {
  const stored = generateSiteIndex('main.nim', 'main.wasm', fakeRuntimeScripts(), {
    boundDomains: ['example.com'],
  });
  assert.ok(stored.includes('window.__BINDWEB_BOUND_DOMAINS__ = ["example.com"];'),
    'stored index.html keeps the armed bound-domains list (real hosting enforces)');

  // The preview pipeline: rewriteSiteUrls first, then disarm — what
  // renderSite() puts into the srcdoc iframe.
  const preview = disarmDomainGateForPreview(rewriteSiteUrls(stored, new Map()));
  assert.ok(preview.includes('window.__BINDWEB_BOUND_DOMAINS__ = [];'),
    'preview document has the bound-domains list emptied (gate disarmed)');
  assert.ok(!preview.includes('"example.com"'), 'no bound domain left in the preview document');

  // A document without the gate globals is returned unchanged.
  const plain = generateSiteIndex('main.nim', 'main.wasm', fakeRuntimeScripts());
  assert.equal(disarmDomainGateForPreview(plain), plain, 'no bound-domains global -> no-op');

  // Boot gate, fed the disarmed global, fetches and runs on any host.
  const { sandbox, fetchCalls } = await runBootInVm({
    hostname: 'localhost',
    globals: { __APP_WASM_URL__: 'main.wasm', __BINDWEB_BOUND_DOMAINS__: [] },
  });
  assert.ok(!sandbox.window.__BINDWEB_DOMAIN_ENFORCE__, 'enforce flag NOT armed in the preview');
  assert.deepEqual(fetchCalls, ['main.wasm'], 'preview boot fetches the wasm normally');
  assert.equal(sandbox.runWasmAppCalls.length, 1, 'app started in the IDE preview');
});

// (h) Boot code structure: gate before ANY fetch, sequential manifest load. -
await test('SITE_BOOT_JS gates on bound domains before any fetch and loads the manifest one-by-one', async () => {
  const idxEnforce = SITE_BOOT_JS.indexOf('window.__BINDWEB_DOMAIN_ENFORCE__ = true');
  const idxGateAbort = SITE_BOOT_JS.indexOf('The requested URL was not found on the server.');
  const idxNotFound = SITE_BOOT_JS.indexOf('Not Found');
  const idxFirstFetch = SITE_BOOT_JS.indexOf('await fetch');
  assert.ok(idxEnforce !== -1, 'enforce flag set when bound domains exist');
  assert.ok(idxGateAbort !== -1, 'fake-404 lockout message present');
  assert.ok(idxNotFound !== -1 && idxNotFound < idxFirstFetch, 'Not Found heading comes before the first fetch');
  assert.ok(!SITE_BOOT_JS.includes('not available on this domain'), 'old lockout message fully replaced');
  assert.ok(idxEnforce < idxFirstFetch, 'gate (and enforce flag) comes before the first fetch');
  assert.ok(idxGateAbort < idxFirstFetch, 'lockout message comes before the first fetch');
  assert.ok(/for \(const path of manifest\) \{\n\s+const res = await fetch\(path\);/.test(SITE_BOOT_JS),
    'sequential await fetch inside a manifest-order loop');
});

// (i) Execute the real boot script in a vm: foreign domain -> no fetch. ----

/** Minimal DOM/console/fetch fakes plus a vm context running SITE_BOOT_JS. */
async function runBootInVm({ hostname, globals = {}, fetchImpl }) {
  const appended = [];
  const makeEl = (tag) => ({
    tagName: tag ? String(tag).toUpperCase() : '',
    innerHTML: '',
    textContent: '',
    className: '',
    style: { cssText: '' },
    children: [],
    appendChild(c) { this.children.push(c); appended.push(c); },
  });
  const body = makeEl('body');
  const byId = { app: makeEl(), 'nim-console': makeEl() };
  const fetchCalls = [];
  const events = [];
  const sandbox = {
    window: { ...globals },
    document: {
      body,
      documentElement: makeEl(),
      getElementById: (id) => byId[id] || null,
      createElement: (tag) => makeEl(tag),
    },
    location: { hostname },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} }, // quiet
    fetch: fetchImpl || (async (url) => {
      fetchCalls.push(url);
      events.push(`start:${url}`);
      await Promise.resolve();
      events.push(`end:${url}`);
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`bytes:${url}`).buffer };
    }),
    runWasmAppCalls: [],
  };
  sandbox.runWasmApp = async (args) => { sandbox.runWasmAppCalls.push(args); };
  sandbox.createBindwebRunner = () => ({});
  sandbox.createWasiShim = () => ({});
  sandbox.ProcExit = class ProcExit extends Error {};
  const script = new vm.Script(SITE_BOOT_JS);
  await script.runInContext(vm.createContext(sandbox));
  return { sandbox, fetchCalls, events, appended, byId, body };
}

await test('boot gate: foreign domain aborts before any fetch, shows the fake 404 page', async () => {
  const { sandbox, fetchCalls, body } = await runBootInVm({
    hostname: 'evil.example.net',
    globals: {
      __APP_WASM_URL__: 'main.wasm',
      __APP_WASM_MANIFEST__: ['main.wasm', 'sub/mod.wasm'],
      __BINDWEB_BOUND_DOMAINS__: ['example.com'],
    },
  });
  assert.equal(fetchCalls.length, 0, 'NOTHING was fetched on a foreign domain (clean network tab)');
  assert.equal(sandbox.runWasmAppCalls.length, 0, 'app never started');
  assert.equal(sandbox.window.__BINDWEB_DOMAIN_ENFORCE__, true, 'enforce flag armed (for the runtime guard)');
  assert.equal(body.innerHTML, '', 'document cleared');
  assert.equal(body.children.length, 2, 'h1 + p appended (a bare 404 document)');
  assert.equal(body.children[0].textContent, 'Not Found', 'Flask-style heading');
  assert.equal(body.children[0].tagName, 'H1', 'heading is an <h1>');
  assert.equal(body.children[1].textContent,
    'The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.',
    'Flask-style body text, no hint which check fired');
});

await test('boot gate: matching domain fetches the manifest strictly one-by-one, then runs the entry', async () => {
  const { sandbox, fetchCalls, events } = await runBootInVm({
    hostname: 'WWW.Example.COM', // normalization: www. + case must match "example.com"
    globals: {
      __APP_WASM_URL__: 'main.wasm',
      __APP_WASM_MANIFEST__: ['main.wasm', 'sub/mod.wasm'],
      __BINDWEB_BOUND_DOMAINS__: ['example.com'],
    },
  });
  assert.deepEqual(fetchCalls, ['main.wasm', 'sub/mod.wasm'], 'manifest fetched in order');
  assert.deepEqual(events, ['start:main.wasm', 'end:main.wasm', 'start:sub/mod.wasm', 'end:sub/mod.wasm'],
    'strictly sequential: each fetch completes before the next starts');
  assert.equal(sandbox.runWasmAppCalls.length, 1, 'app started once');
  const entryBytes = new TextDecoder().decode(sandbox.runWasmAppCalls[0].wasmBytes);
  assert.equal(entryBytes, 'bytes:main.wasm', 'runWasmApp received the ENTRY wasm bytes (manifest[0])');
});

await test('boot gate: no bound domains -> no enforce flag, manifest still one-by-one', async () => {
  const { sandbox, fetchCalls } = await runBootInVm({
    hostname: 'anything.example.org',
    globals: {
      __APP_WASM_URL__: 'main.wasm',
      __APP_WASM_MANIFEST__: ['main.wasm', 'other.wasm'],
    },
  });
  assert.ok(!sandbox.window.__BINDWEB_DOMAIN_ENFORCE__, 'enforce flag NOT set without bound domains');
  assert.deepEqual(fetchCalls, ['main.wasm', 'other.wasm'], 'manifest fetched sequentially');
  assert.equal(sandbox.runWasmAppCalls.length, 1, 'app started');
});

await test('legacy page (no gate globals): single fetch of __APP_WASM_URL__, unchanged behavior', async () => {
  const { sandbox, fetchCalls } = await runBootInVm({
    hostname: 'any.host',
    globals: { __APP_WASM_URL__: 'sub/main.wasm' },
  });
  assert.deepEqual(fetchCalls, ['sub/main.wasm'], 'single fetch, legacy path');
  assert.equal(sandbox.runWasmAppCalls.length, 1, 'app started from the single fetch');

  // Legacy non-200 keeps the informative "url: HTTP status" message.
  const failing = await runBootInVm({
    hostname: 'any.host',
    globals: { __APP_WASM_URL__: 'gone.wasm' },
    fetchImpl: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
  });
  assert.equal(failing.sandbox.runWasmAppCalls.length, 0, 'app not started on HTTP error');
  const consoleEl = failing.byId['nim-console'];
  assert.equal(consoleEl.children.length, 1, 'one log line written to the console element');
  assert.ok(consoleEl.children[0].textContent.includes('gone.wasm: HTTP 404'),
    'legacy path keeps the informative url + HTTP status message');
});

// (k) Payload codec round-trips, including non-ASCII (the inline banners --
// contain an em dash, so UTF-8 safety is load-bearing). ------------------
await test('encodeRuntimePayload/decodeRuntimePayload round-trip arbitrary JS source', async () => {
  const src = '/* wasi-shim.js — inlined */\nconst π = "héllo 🚀"; // ünïcode\nfunction f() { return "</div>"; }\n';
  assert.equal(decodeRuntimePayload(encodeRuntimePayload(src)), src, 'lossless through UTF-8 + XOR + base64');
  const b64 = encodeRuntimePayload(src);
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(b64), 'payload is pure base64 (inline-script safe)');
  assert.ok(!b64.includes('createWasiShim') && !b64.includes('héllo'), 'payload is not human-readable');
});

// (l) Execute the EMITTED scripts in order in a vm: the real decoder script
// (decode + new Function) must run the concatenated payload, whose four
// segments share ONE function scope, and the real boot logic must behave
// exactly as before (gate before fetch, sequential manifest, then run). --

/**
 * Generate a document whose payload is three fake runtime segments (real
 * global names, recording into the sandbox via globalThis) + the REAL
 * SITE_BOOT_JS, then execute every emitted <script> body in document order
 * inside a vm context. The decoder script uses `new Function`, so the
 * context explicitly allows string code generation.
 */
async function runGeneratedSiteInVm({ hostname, wasmPath = 'main.wasm', boundDomains = [], wasmManifest = [] }) {
  const runtimeScripts = [
    { name: 'wasi-shim.js', code: 'class ProcExit extends Error {}\nfunction createWasiShim() { return 1; }\n' },
    // Cross-segment reference: bindweb-runtime uses wasi-shim's declaration.
    { name: 'bindweb-runtime.js', code: 'function createBindwebRunner() { return createWasiShim() + 1; }\n' },
    { name: 'run-wasm.js', code: 'async function runWasmApp(args) { globalThis.__runWasmAppCalls.push({ args, scope: createBindwebRunner() }); }\n' },
    { name: 'boot.js', code: SITE_BOOT_JS },
  ];
  const opts = {};
  if (boundDomains.length) opts.boundDomains = boundDomains;
  if (wasmManifest.length) opts.wasmManifest = wasmManifest;
  const html = generateSiteIndex('main.nim', wasmPath, runtimeScripts, opts);

  const appended = [];
  const makeEl = (tag) => ({
    tagName: tag ? String(tag).toUpperCase() : '',
    innerHTML: '', textContent: '', className: '', style: { cssText: '' },
    children: [],
    appendChild(c) { this.children.push(c); appended.push(c); },
  });
  const body = makeEl('body');
  const byId = { app: makeEl(), 'nim-console': makeEl() };
  const fetchCalls = [];
  const events = [];
  const sandbox = {
    window: {}, // populated by executing the emitted config script(s)
    document: {
      body,
      documentElement: makeEl(),
      getElementById: (id) => byId[id] || null,
      createElement: (tag) => makeEl(tag),
    },
    location: { hostname },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    fetch: async (url) => {
      fetchCalls.push(url);
      events.push(`start:${url}`);
      await Promise.resolve();
      events.push(`end:${url}`);
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`bytes:${url}`).buffer };
    },
    atob,
    btoa,
    TextDecoder,
    TextEncoder,
    __runWasmAppCalls: [],
  };
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: true, wasm: true } });
  for (const body_ of scriptBodies(html)) {
    await new vm.Script(body_).runInContext(ctx, { codeGeneration: { strings: true, wasm: true } });
  }
  // The boot IIFE is async; let its fetch/await chain settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { sandbox, fetchCalls, events, appended, byId, body };
}

await test('emitted payload: fake segments share one scope and the boot runs on a bound domain', async () => {
  const { sandbox, fetchCalls, events } = await runGeneratedSiteInVm({
    hostname: 'example.com',
    wasmPath: 'main.wasm',
    boundDomains: ['example.com'],
    wasmManifest: ['main.wasm', 'sub/mod.wasm'],
  });
  // The emitted plaintext config scripts set the globals boot reads.
  assert.equal(sandbox.window.__APP_WASM_URL__, 'main.wasm', 'config script ran and set the wasm URL');
  assert.equal(JSON.stringify(sandbox.window.__APP_WASM_MANIFEST__), '["main.wasm","sub/mod.wasm"]',
    'manifest global set (realm-proof comparison)');
  assert.equal(sandbox.window.__BINDWEB_DOMAIN_ENFORCE__, true, 'enforce flag armed by the real boot');
  assert.deepEqual(events, ['start:main.wasm', 'end:main.wasm', 'start:sub/mod.wasm', 'end:sub/mod.wasm'],
    'manifest fetched strictly one-by-one through the decoded boot');
  assert.deepEqual(fetchCalls, ['main.wasm', 'sub/mod.wasm'], 'fetch order matches the manifest');
  assert.equal(sandbox.__runWasmAppCalls.length, 1, 'decoded boot called runWasmApp once');
  const entryBytes = new TextDecoder().decode(sandbox.__runWasmAppCalls[0].args.wasmBytes);
  assert.equal(entryBytes, 'bytes:main.wasm', 'entry wasm bytes (manifest[0]) handed to runWasmApp');
  // scope: createBindwebRunner() -> createWasiShim() + 1 -> 2 proves the
  // payload segments share ONE new Function scope (a cross-segment call).
  assert.equal(sandbox.__runWasmAppCalls[0].scope, 2, 'payload segments share one function scope');
});

await test('emitted payload: foreign domain aborts before any fetch with the fake 404', async () => {
  const { sandbox, fetchCalls, body } = await runGeneratedSiteInVm({
    hostname: 'evil.example.net',
    boundDomains: ['example.com'],
    wasmManifest: ['main.wasm'],
  });
  assert.equal(fetchCalls.length, 0, 'nothing fetched on a foreign domain');
  assert.equal(sandbox.__runWasmAppCalls.length, 0, 'app never started');
  assert.equal(body.children.length, 2, 'fake 404 rendered (h1 + p)');
  assert.equal(body.children[0].textContent, 'Not Found', 'Flask-style heading');
  assert.ok(body.children[1].textContent.startsWith('The requested URL was not found on the server.'),
    'Flask-style body text');
});

await test('emitted payload: no bound domains -> boot fetches and runs on any host', async () => {
  const { sandbox, fetchCalls } = await runGeneratedSiteInVm({ hostname: 'anything.example.org' });
  assert.ok(!sandbox.window.__BINDWEB_DOMAIN_ENFORCE__, 'enforce flag not armed');
  assert.deepEqual(fetchCalls, ['main.wasm'], 'single legacy fetch of the wasm URL');
  assert.equal(sandbox.__runWasmAppCalls.length, 1, 'app started');
});

// -----------------------------------------------------------------------------
if (failures > 0) {
  console.error(`${failures} test(s) failed`);
  process.exit(1);
}
console.log('All site-template tests passed.');
