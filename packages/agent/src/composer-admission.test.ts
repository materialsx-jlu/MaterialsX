import test from 'node:test';
import assert from 'node:assert/strict';
import { composerAdmission } from './composer-admission.js';
import type { ExecutionControl } from './execution-control.js';
test('literal native calls retain target method; opaque programs need broad grant',()=>{
 const admitted:any[]=[];const control={authorize:(name:string,permissions:unknown)=>admitted.push({name,permissions})} as unknown as ExecutionControl;
 const tools=new Map<string,readonly any[]>([['materials_science',['science']],['exec_command',['terminal']]]);
 const science=composerAdmission('text(await tools.mcp__materialsx__materials_science({"action":"get","targetId":"job1"}));',control,tools);
 assert.equal(science.host,true);assert.equal(science.name,'materials_science');assert.deepEqual(admitted[0],{name:'materials_science',permissions:['science']});
 assert.equal(composerAdmission('text(await tools.exec_command({"cmd":"echo test"}));',control,tools).name,'exec_command');
 assert.equal(composerAdmission('const method="exec_command";text(await tools[method]({cmd:"test"}));',control,tools).name,'engine.execute');
 assert.throws(()=>composerAdmission('text(await tools.foreign({}));',control,tools),/未开放/);
});
test('only explicitly registered HostMcp calls defer admission to the original dispatcher; native OS tools stay guarded',()=>{
 const control={authorize:()=>{throw Error('ADMISSION_DENIED');}} as unknown as ExecutionControl;
 const tools=new Map<string,readonly any[]>([['research_methods',['read','science']],['exec_command',['terminal']]]);
 assert.equal(composerAdmission('text(await tools.mcp__materialsx__research_methods({"action":"assess"}));',control,tools,new Set(['research_methods'])).host,true);
 assert.throws(()=>composerAdmission('text(await tools.exec_command({"cmd":"echo test"}));',control,tools,new Set(['research_methods'])),/ADMISSION_DENIED/);
 assert.throws(()=>composerAdmission('text(await tools.mcp__materialsx__research_methods({}));',control,tools,new Set()),/ADMISSION_DENIED/);
});
