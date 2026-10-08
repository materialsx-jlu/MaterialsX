import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeLookup,recipeSourceText} from './research-recipe-view.js';
import type {ResearchSnapshot} from '../../../packages/contracts/src/research-project.js';
test('recipe source view preserves 10 g separately from 0.1 g, units, roles and evidence locators without filling gaps',()=>{
 const snapshot={title:'WCP-10',sha256:'a'.repeat(64),ref:{experimentId:988,generation:2},reviewStatus:'pending_review',data:{ingredients:[{material_id:'MAT-DOI123-BARIUM-SULFATE',amount:{original_value:10,original_unit:'g'},role:'solar_scattering_agent',evidence_ids:['e1']},{material_id:'MAT-DOI123-SODIUM-POLYACRYLATE',amount:{original_value:0.1,original_unit:'g'},role:'electrostatic_dispersant',evidence_ids:['e2']},{material_id:'unknown',amount:{},evidence_ids:[]}],processes:[{display_name_zh:'干燥',source_text:'Ambient drying',parameters:{time:'2 days'},evidence_ids:['e1']}],readEvidence:[{id:'e1',locator:{pdf_page:2}}]}} as unknown as ResearchSnapshot;
 const text=recipeSourceText([snapshot]);assert.match(text,/BARIUM SULFATE \| 10 \| g \| solar_scattering_agent/);assert.match(text,/SODIUM POLYACRYLATE \| 0.1 \| g \| electrostatic_dispersant/);assert.match(text,/PDF p.2/);assert.match(text,/pending_review/);assert.match(text,/2 days/);assert.match(text,/unknown \| 未记录/);assert(!text.includes('| |'));assert(!text.includes('交联剂'));
 assert(recipeLookup('从 moos 获取配方数据，再具体一点'));assert(recipeLookup('Search MOOS recipes'));
 for(const q of ['如何设计水性涂料','MOOS 配方分析与优化','搜索 MOOS 论文','比较 MOOS recipes'])assert(!recipeLookup(q));
});
