import test from 'node:test';
import assert from 'node:assert/strict';
import {recipeScope,recipeScopeMatches} from './research-recipe-scope.js';
const request='搜索 MOOS 中的水性辐射制冷涂料配方，允许本次读取待复核记录，最终形成3个实验配方';
test('explicit waterborne radiative paint scope rejects real but unrelated membrane/solvent film recipes',()=>{
 for(const identity of [{label:'WCP-10 静电辅助高PVC水性辐射制冷涂料'},{label:'无氟水性PDRC涂料'},{title:'Electrostatic repellent dispersion method for green and cost-effective aqueous radiative cooling paint'}])assert(recipeScopeMatches(request,identity));
 for(const identity of [{label:'PEO-ISA/氧化铝/TMPTA-20电纺膜',title:'Water-Resistant Poly(ethylene oxide) Electrospun Membranes for Radiative Cooling'},{label:'PDMS / P-PMMA 双层涂层',title:'Radiative cooling coating'},{label:'PolyCool',title:'Polymer cooling film'},{label:'水性防腐涂料'}])assert(!recipeScopeMatches(request,identity));
 assert.equal(recipeScope(request)!.suggestedQuery,'水性辐射制冷涂料');assert(recipeScopeMatches('Search MOOS waterborne radiative cooling paint recipes',{title:'Aqueous radiative cooling paint'}));
 assert(recipeScopeMatches('Search MOOS membrane recipes',{title:'Membranes'}));assert.equal(recipeScope('比较 MOOS 水性涂料配方'),null);
});
