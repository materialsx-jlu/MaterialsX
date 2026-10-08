import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bindTaskReferences} from './task-reference-binding.js';
import type {SkillSummary} from '../../../packages/contracts/src/desktop.js';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const options={platform:false,files:[{id:'file-owned',name:'硅 sample.txt',text:'Si',sha256:sha('Si')}],skills:[{name:'pymatgen',enabled:true,availability:'ready'} as SkillSummary],
 skillText:async()=> 'Pinned instructions',hash:sha,recipe:(id:string)=>{if(id!=='recipe-owned')throw Error('OTHER_PROJECT');return {id,title:'Fixture',version:'v2',sha256:sha('recipe'),selected:true};},
 paper:(id:string)=>{if(id!=='arxiv:2601.12345v2')throw Error('OTHER_PROJECT');return {id,title:'Public fixture',version:'v2',sha256:sha('metadata'),range:'metadata-only'};},
 structure:(id:string)=>{if(id!=='structure-owned')throw Error('OTHER_PROJECT');return {id,title:'2 Si atoms',sha256:sha('structure'),authorized:false};}};
test('binding uses actual IDs and immutable hashes, deduplicates mentions and preserves metadata/authorization boundaries',async()=>{
 const result=await bindTaskReferences('@pymatgen @file:"硅 sample.txt" @file:file-owned @recipe:recipe-owned @paper:arxiv:2601.12345v2 @structure:structure-owned','project',options);
 assert.equal(result.length,5);assert(result.every(r=>r.projectId==='project'));assert.equal(result[0]!.sha256,sha('Pinned instructions'));assert.equal(result[1]!.id,'file-owned');
 assert.equal(result[3]!.status,'metadata-only');assert.equal(result[4]!.status,'not-authorized');assert.equal(options.structure('structure-owned').authorized,false);
});
test('missing, not installed, disabled, ambiguous and cross-project inputs fail without granting or downloading',async()=>{
 await assert.rejects(bindTaskReferences('@missing','project',options),/UNAVAILABLE/);
 await assert.rejects(bindTaskReferences('@pymatgen','project',{...options,skills:[{...options.skills[0]!,availability:'planned'}]}),/UNAVAILABLE/);
 await assert.rejects(bindTaskReferences('@pymatgen','project',{...options,skills:[{...options.skills[0]!,enabled:false}]}),/UNAVAILABLE/);
 await assert.rejects(bindTaskReferences('@file:"硅 sample.txt"','project',{...options,files:[...options.files,{...options.files[0]!,id:'second'}]}),/AMBIGUOUS/);
 await assert.rejects(bindTaskReferences('@file:"/outside/private.txt"','project',options),/NOT_APPROVED/);
 for(const kind of ['paper','recipe','structure'])await assert.rejects(bindTaskReferences('@'+kind+':another-project-id','project',options),/OTHER_PROJECT/);
 assert.deepEqual(await bindTaskReferences('"@missing" `@missing` user@missing','project',options),[]);
});
test('recipe selection and cloud export remain independent of explicit mentions',async()=>{
 await assert.rejects(bindTaskReferences('@recipe:recipe-owned','project',{...options,recipe:id=>({...options.recipe(id),selected:false})}),/NOT_SELECTED/);
 await assert.rejects(bindTaskReferences('@recipe:recipe-owned','project',{...options,platform:true}),/EXPORT_NOT_AUTHORIZED/);
});
