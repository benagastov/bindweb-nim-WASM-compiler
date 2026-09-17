// Build-time only. Vendored Terser 5.47.1 (BSD-2-Clause); never shipped in apps.
export function javascriptMode(mode = 'obfuscate') {
  if (!['none', 'minify', 'obfuscate'].includes(mode))
    throw new TypeError('javascript must be none, minify, or obfuscate');
  return mode;
}

export async function protectJavaScript(source, { mode = 'obfuscate', toplevel = false, reserved = [] } = {}) {
  javascriptMode(mode);
  if (mode === 'none') return source;
  await import('./vendor/terser/terser.mjs');
  // Per-transform randomized identifiers; stable for each binding within this
  // transform. No decoder, runtime indirection or source map is introduced.
  const identifiers = [];
  const used = new Set();
  const nth_identifier = { get(index) {
    while (identifiers.length <= index) {
      const bytes = new Uint8Array(5);
      globalThis.crypto.getRandomValues(bytes);
      const name = '_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      if (!used.has(name)) { used.add(name); identifiers.push(name); }
    }
    return identifiers[index];
  }};
  const result = await globalThis.Terser.minify(source, {
    // Top-level mangling is opt-in for a complete bundle. Separately executed
    // classic scripts retain their global contract by default.
    compress: { defaults: false, dead_code: true, drop_debugger: true },
    mangle: mode === 'obfuscate' ? { toplevel, reserved, eval: false, nth_identifier } : false,
    sourceMap: false,
    format: { comments: false, ascii_only: true, inline_script: true },
  });
  if (typeof result.code !== 'string') throw Error('JavaScript protection failed');
  return result.code;
}
