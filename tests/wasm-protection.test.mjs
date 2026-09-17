import test from 'node:test';
import assert from 'node:assert/strict';
import {protectWasm} from '../web/src/wasm-obfuscate.js';
import {installNimIDE} from '../web/src/ai-api.js';
const header=Uint8Array.of(0,97,115,109,1,0,0,0);
const section=name=>{const bytes=new TextEncoder().encode(name);return [0,bytes.length+1,bytes.length,...bytes];};
const fixture=Uint8Array.from([...header,...section('name'),...section('producers'),
  ...section('.debug_info'),...section('.debug_line'),...section('sourceMappingURL'),
  ...section('external_debug_info'),...section('.comment'),...section('keep')]);
test('release protection strips debug metadata without injecting decoys',()=>{
  const bytes=protectWasm(fixture), module=new WebAssembly.Module(bytes);
  for(const name of ['name','producers','.debug_info','.debug_line','sourceMappingURL','external_debug_info','.comment'])
    assert.equal(WebAssembly.Module.customSections(module,name).length,0,name);
  assert.equal(WebAssembly.Module.customSections(module,'keep').length,1);
  assert.deepEqual(protectWasm(bytes),bytes,'release transform must be idempotent');
});
test('IDE protection API is pure and accurately describes protection',async()=>{
  globalThis.window={};
  try {
    installNimIDE({version:'test',ready:async()=>true,status:()=> 'ready'});
    const out=await window.NimIDE.protectWasm(Buffer.from(fixture).toString('base64'));
    assert.equal(out.encrypted,false);
    assert.equal(out.protection,'debug-metadata-stripped');
    assert.deepEqual(Buffer.from(out.base64,'base64'),Buffer.from(protectWasm(fixture)));
    await assert.rejects(window.NimIDE.protectWasm('AAAA'),/Invalid WebAssembly/);
  }finally{delete globalThis.window;}
});
