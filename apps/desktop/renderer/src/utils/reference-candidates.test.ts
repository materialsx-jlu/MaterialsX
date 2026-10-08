import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestReferences,previewReferences,type ReferenceCandidate} from './reference-candidates.js';
const values:ReferenceCandidate[]=[{kind:'skill',id:'paper-fixture',label:'paper-fixture',description:'查找论文 / Search papers',status:'available',version:'pin on submit',range:'read_skill'},
 {kind:'file',id:'owned-file',label:'Si sample.xyz',description:'已选文本 / Selected snapshot',status:'frozen',version:'a'.repeat(64),range:'1..2'},
 {kind:'structure',id:'structure-1',label:'2 Si atoms',description:'晶体 / Crystal',status:'not-authorized',version:'pin on submit',range:'summary'}];
test('bilingual picker filters types and uses exact resource IDs rather than mutable display names',()=>{
 assert.equal(suggestReferences(values,'查论文')[0]?.id,'paper-fixture');assert.equal(suggestReferences(values,'search literature')[0]?.id,'paper-fixture');
 assert.equal(suggestReferences(values,'file:"Si sample')[0]?.name,'file:"owned-file"');assert.equal(suggestReferences(values,'structure:')[0]?.id,'structure-1');assert(suggestReferences(values,'').length<=8);
});
test('preview states preserve no-grant and not-found semantics; code examples have no bindings',()=>{
 const refs=previewReferences('@file:"Si sample.xyz" @structure:structure-1 @missing',values);assert.equal(refs[0]?.id,'owned-file');assert.equal(refs[1]?.status,'not-authorized');assert.match(refs[2]!.status,/Not found/);
 assert.deepEqual(previewReferences('`@missing` "@file:owned-file"',values),[]);
});
