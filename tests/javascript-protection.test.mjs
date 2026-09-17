import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {protectJavaScript} from '../web/src/javascript-protection.mjs';
test('tracked Terser supports every protection mode without source maps',async()=>{
  const source='/* private comment */ function compute(value){return value+7;} globalThis.answer=compute(5);';
  for(const mode of ['none','minify','obfuscate']){
    const code=await protectJavaScript(source,{mode,toplevel:true});
    const context={};vm.runInNewContext(code,context);assert.equal(context.answer,12);
    assert.ok(!code.includes('sourceMappingURL'));
    if(mode!=='none')assert.ok(!code.includes('private comment'));
    if(mode==='obfuscate')assert.ok(!code.includes('function compute'));
  }
});
