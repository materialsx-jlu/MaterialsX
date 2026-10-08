import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadBuiltinSkillState} from './catalog-loader.js';
import {applicationCapabilities,publicApplicationCapabilities} from './application-capabilities.js';

test('registered built-in names do not imply an installed file or executable dependencies',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mx-host-facts-'));
  try{
    const vendor=join(dir,'vendor/materialsx-default-skills');mkdirSync(vendor,{recursive:true});mkdirSync(join(dir,'skills'));
    writeFileSync(join(vendor,'MANIFEST.json'),JSON.stringify({skills:['present','missing']}));
    writeFileSync(join(dir,'skills/materialsx-default.json'),JSON.stringify({enabledSkills:['present','missing']}));
    let state=loadBuiltinSkillState(dir);assert(state.every(s=>!s.installed&&!s.enabled));
    mkdirSync(join(vendor,'skills/present'),{recursive:true});writeFileSync(join(vendor,'skills/present/SKILL.md'),'Fixture instructions');
    state=loadBuiltinSkillState(dir);const facts=applicationCapabilities(state,[],false,true);
    assert.equal(facts.find(f=>f.id==='skill:present')!.installed,true);
    assert.equal(facts.find(f=>f.id==='skill:present')!.readiness,'unverified');
    assert.equal(facts.find(f=>f.id==='skill:missing')!.installed,false);
    assert.equal(facts.find(f=>f.id==='skill:missing')!.authorization,'denied');
    assert.equal(facts.find(f=>f.id==='service:moos')!.configured,false);
    assert.equal(facts.find(f=>f.id==='service:paper')!.readiness,'unverified');
    rmSync(join(vendor,'skills/present/SKILL.md'));assert.equal(loadBuiltinSkillState(dir).find(s=>s.name==='present')!.installed,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('cloud receives public application actions without consulting or exposing local resource and service inventory',()=>{
 const facts=publicApplicationCapabilities();assert(facts.some(f=>f.id==='host:skill.install'&&f.configured&&f.authorization==='requires-user-command'));
 assert(facts.every(f=>f.kind==='host-action'));assert(!JSON.stringify(facts).match(/service:|potential:|skill:|MOOS|sourceId|snapshotId/));
 assert.deepEqual(applicationCapabilities([],[],false,false).filter(f=>f.kind==='host-action'),facts);
});
