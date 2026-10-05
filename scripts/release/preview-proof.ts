import { createReadStream } from 'node:fs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fingerprint } from '../../packages/release-readiness/src/qualification/fingerprint.js';
import { verifyTechnical } from '../../packages/release-readiness/src/qualification/technical.js';
import { hash, ownedText } from '../../packages/atomistic/src/discovery-io.js';
const pkg=JSON.parse(await readFile('package.json','utf8'));
if(!pkg.version.includes('-preview.'))throw Error('PREVIEW_VERSION_REQUIRED');
const root=process.cwd(),fp=await fingerprint(root),dir=join(root,'release/dist',pkg.version);
const technical=JSON.parse(ownedText(join(root,'runtime/agent/ua-14/technical.json'),2*1024*1024));
if(!await verifyTechnical(technical,fp,async i=>hash(ownedText(join(root,'runtime/agent/ua-14',`technical-${i}.log`),8*1024*1024))))throw Error('CURRENT_TECHNICAL_VERIFICATION_REQUIRED');
const files=[];
for(const name of (await readdir(dir)).sort()){
 if(!name.startsWith('MaterialsX-'+pkg.version+'-')||!(/\.(dmg|exe|AppImage|tar\.gz|zip|blockmap)$/.test(name)))continue;
 const h=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(join(dir,name))){h.update(chunk);bytes+=chunk.length;}
 if(bytes>2*1024**3)throw Error('GITHUB_ASSET_SIZE_LIMIT:'+name);
 files.push({name,bytes,sha256:h.digest('hex')});
}
for(const suffix of ['mac-arm64.dmg','win-x64.exe','linux-x86_64.AppImage','linux-x64.tar.gz','source.zip']){
 if(!files.some(f=>f.name===`MaterialsX-${pkg.version}-${suffix}`))throw Error('MISSING_PREVIEW_ASSET:'+suffix);
}
const audits=JSON.parse(ownedText(join(root,'runtime/release-build/package-audits.json'),2*1024*1024));
if(audits.length!==3||!['darwin','win32','linux'].every(p=>audits.some((a:any)=>a.platform===p&&a.audit?.passed===true)))throw Error('PACKAGE_BYTE_AUDIT_REQUIRED');
const proof={schemaVersion:'materialsx-preview-release-v1',version:pkg.version,channel:'preview',formalReleaseReady:false,
 fingerprint:fp,currentTechnicalPassed:true,assets:files,
 platforms:{'darwin-arm64':{signed:false,scope:'M6 research preview',startup:'isolated packaged-resource harness'},
 'win32-x64':{signed:false,scope:'desktop/PDF preview',physicalMachineTested:false,nativeCodex:false,atomicRuntime:false},
 'linux-x64':{signed:false,scope:'desktop/PDF preview',physicalMachineTested:false,nativeCodex:false,atomicRuntime:false}},
 limitations:['full model qualification incomplete','scientific expert qualification incomplete','production deployment/signing incomplete'],
 source:'Exact public working tree in the matching source ZIP; never use an older tag snapshot as its substitute'};
await writeFile(join(dir,'release-info.json'),JSON.stringify(proof,null,2)+'\n');
const h=createHash('sha256').update(await readFile(join(dir,'release-info.json'))).digest('hex');
await writeFile(join(dir,'SHA256SUMS.txt'),[...files.map(f=>`${f.sha256}  ${f.name}`),`${h}  release-info.json`].join('\n')+'\n');
console.log(JSON.stringify({version:pkg.version,files:files.length,currentTechnicalPassed:true,formalReleaseReady:false,output:dir}));
