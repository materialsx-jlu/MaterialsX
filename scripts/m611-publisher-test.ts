import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {CatalogUpdateService} from '../packages/atomistic/src/catalog-updates.js';
const root=process.cwd(),temp=await mkdtemp(join(tmpdir(),'mx-m611-publisher-')),state=join(temp,'state');
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const cli=(...args:string[])=>execFileSync(process.execPath,['--import','tsx','scripts/m611-publisher.ts',...args,'--state',state],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
try{
 await mkdir(state);await cp(join(root,'runtime/m6/discovery-publisher/potential-discovery'),join(state,'potential-discovery'),{recursive:true});
 const ledger=await json(join(state,'potential-discovery/state.json'));const record=ledger.records.find((r:{observation:{kind:string};relation:string})=>r.observation.kind==='checkpoint'&&r.relation!=='same_official_asset');assert(record);
 const review=join(temp,'review.json');await writeFile(review,JSON.stringify({id:record.id,sha256:'f'.repeat(64),decision:'approved',reviewer:'Isolated publisher acceptance',note:{zh:'仅用于签名元数据验收，未授予运行',en:'Signing metadata acceptance only; no execution permission'}}));assert.throws(()=>cli('review','--file',review));
 const q=await json(review);q.sha256=record.contentSha256;await writeFile(review,JSON.stringify(q));cli('review','--file',review);
 const second=join(temp,'second.json');cli('publish','--output',second);const r2=await json(second);assert.equal(r2.payload.sequence,2);assert.equal(r2.payload.entries.length,1);assert.equal(r2.payload.entries[0].execution.adapter,null);
 const next=generateKeyPairSync('ed25519'),nextPrivate=join(temp,'catalog-test.private.pem'),nextPublic=join(temp,'next.pub.pem');await writeFile(nextPrivate,next.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});await writeFile(nextPublic,next.publicKey.export({type:'spki',format:'pem'}));
 const third=join(temp,'third.json');cli('rotate','--previous',second,'--next-key-id','acceptance-next','--next-public-key',nextPublic,'--retire-key-id','materialsx-catalog-2026-bootstrap','--output',third);assert.equal((await json(third)).payload.sequence,3);
 const fourth=join(temp,'fourth.json');cli('publish','--previous',third,'--key',nextPrivate,'--key-id','acceptance-next','--output',fourth);assert.equal((await json(fourth)).payload.sequence,4);
 const badPrevious=join(temp,'forged-previous.json');const forged=await json(second);forged.payload.entries[0].description.en='Forged historical metadata';await writeFile(badPrevious,JSON.stringify(forged));assert.throws(()=>cli('rollback','--previous',badPrevious,'--key',nextPrivate,'--key-id','acceptance-next','--output',join(temp,'rejected.json')));
 const rollback=join(temp,'rollback.json');cli('rollback','--previous','models/potentials/catalog-release.json','--key',nextPrivate,'--key-id','acceptance-next','--output',rollback);const client=new CatalogUpdateService(root,state);assert.equal(client.status().sequence,5);assert.equal(client.status().keyId,'acceptance-next');assert.equal(client.status().metadataEntries,0);
 const fresh=new CatalogUpdateService(root,join(temp,'fresh-client'));const latest=await json(rollback);assert.throws(()=>fresh.accept(latest),/SIGNATURE/);assert(fresh.accept(await json(join(temp,'catalog-bundle.json'))));assert.equal(fresh.status().sequence,5);assert.equal(fresh.status().keyId,'acceptance-next');
 const evidence=join(root,'runtime/m6/acceptance/m611');await mkdir(evidence,{recursive:true});const receipt={stage:'M6.11',passed:true,realPublisherCLI:true,staleReviewRejected:true,metadataOnlySignedPublish:true,signedKeyRotation:true,retiredKeyReplaced:true,forgedHistoricalRollbackRejected:true,signedRollback:true,isolatedState:true,remotePublished:false,newClientBundleCatchUpAcrossRotation:true};await writeFile(join(evidence,'publisher.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await rm(temp,{recursive:true,force:true});}
