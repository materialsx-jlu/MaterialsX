import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseReferences,referenceToken,referenceGuidance} from './task-references.js';
test('explicit references support bilingual prose, spaces, multiple kinds and legacy Skill syntax',()=>{
 const refs=parseReferences('使用 @pymatgen 与 @file:"硅 结构.xyz"，检查 @recipe:owned-1 和 @paper:arxiv:2601.12345v2 以及 @structure:structure-1。 /skill:materials-mlip-singlepoint $other-skill');
 assert.deepEqual(refs.map(r=>[r.kind,r.value]),[['skill','pymatgen'],['file','硅 结构.xyz'],['recipe','owned-1'],['paper','arxiv:2601.12345v2'],['structure','structure-1'],['skill','materials-mlip-singlepoint'],['skill','other-skill']]);
 for(const ref of refs)assert.equal(parseReferences(referenceToken(ref.kind,ref.value))[0]?.value,ref.value);
});
test('emails, quoted examples, fenced and inline code are inert; ordinary apostrophes do not hide real mentions',()=>{
 const text='user@example.com `@ignored` "@ignored2" “@ignored3”\n```text\n@ignored4\n```\n~~~\n@ignored5\n~~~\nLet\'s use @pymatgen';
 assert.deepEqual(parseReferences(text).map(r=>r.value),['pymatgen']);assert.deepEqual(parseReferences('@file:"not closed'),[]);
});
test('reference guidance carries only pinned metadata and explicitly preserves permissions',()=>{
 const hint=referenceGuidance([{kind:'file',id:'owned',label:'public.txt',projectId:'project',version:'a'.repeat(64),sha256:'a'.repeat(64),status:'bound',range:'1..2'}]);
 assert.match(hint,/not read/);assert.match(hint,/never additional permissions/);assert(!hint.includes('file content'));assert.equal(referenceGuidance([]),'');
});
