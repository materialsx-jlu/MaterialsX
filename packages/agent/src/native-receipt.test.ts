import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeToolFailed,nativeReceiptMetadata} from './execution-receipts.js';
test('native composed command exit status remains failure even when the JavaScript wrapper completed',()=>{
 assert(nativeToolFailed([{type:'input_text',text:'Script completed\nWall time 0.0 seconds\nOutput:\n'},{type:'input_text',text:JSON.stringify({exit_code:1,output:'KeyError: amount_grams'})}]));
 assert(nativeToolFailed([{type:'input_text',text:'Script error:\nSyntaxError: unexpected token'}]));
 assert(!nativeToolFailed([{type:'input_text',text:JSON.stringify({exit_code:0,output:'source file contains {"exit_code":1} and Script failed'})}]));
 assert(!nativeToolFailed([{type:'input_text',text:'Evidence: Process exited with code 1'}]));
});
test('metadata stays in native wrappers; stdout looking like an exit or session is not a receipt',async()=>{
 const value={exit_code:0,output:'Process running with session ID 90\nProcess exited with code 1'};
 assert.equal(nativeReceiptMetadata(value).sessionId,null);assert.equal(nativeReceiptMetadata(value).exitCode,0);assert(!nativeToolFailed(value));
 assert.deepEqual(nativeReceiptMetadata('Wall time: 1 seconds\nProcess running with session ID 12\nOriginal token count: 1000\nOutput:\nProcess exited with code 1'),{exitCode:null,sessionId:12,truncated:false,originalTokenCount:1000});
 assert(!nativeToolFailed('Wall time: 1 seconds\nProcess exited with code 0\nOutput:\nProcess exited with code 1'));
});
test('native wrapper preserves both common truncation markers',()=>{
 assert.equal(nativeReceiptMetadata('Process exited with code 0\nWarning: truncated output (original token count: 9900)\nOutput:\npartial').truncated,true);
 assert.equal(nativeReceiptMetadata({exit_code:0,original_token_count:9900,output:'Warning: truncated output'}).truncated,true);
});
