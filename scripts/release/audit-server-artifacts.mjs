#!/usr/bin/env node
// Audit exact release bytes without unpacking a tar archive onto the host.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function tar(archive,...args){
  const result=spawnSync('tar',[...args,archive],{maxBuffer:64*1024*1024});
  if(result.status!==0)throw Error(`Unreadable archive: ${archive}`);
  return result.stdout;
}
function archiveFile(archive,name){
  const result=spawnSync('tar',['-xOzf',archive,`./${name}`],{maxBuffer:64*1024*1024});
  if(result.status!==0)throw Error(`Missing archive file: ${name}`);
  return result.stdout;
}
function safeName(value){return typeof value==='string'&&value.length>0&&/^[A-Za-z0-9_.\/-]+$/.test(value)&&!value.split('/').some(part=>part==='.'||part==='..')&&!value.startsWith('/')&&!value.includes('//')}
function verifyManifest(manifest){
  if(!manifest||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)||Object.keys(manifest.files).length<1)throw Error('Empty release manifest');
  for(const [name,digest] of Object.entries(manifest.files)){
    if(!safeName(name)||name.endsWith('/')||!(/^[a-f0-9]{64}$/).test(digest))throw Error('Invalid release file inventory');
    if(/(^|\/)(config\.json|secrets\.env|\.env|private-config\.json)$/.test(name))throw Error('Private configuration in release');
  }
}
async function auditArchive(label,archive,prefix,expectedVersion,platform){
  const listing=tar(archive,'-tzf').toString('utf8').trim().split('\n');
  const modes=tar(archive,'-tvzf').toString('utf8').trim().split('\n');
  if(modes.length!==listing.length||modes.some(line=>!['-','d'].includes(line[0])))throw Error(`${label}: archive contains non-regular entry`);
  const names=listing.filter(path=>path!=='./').map(path=>path.startsWith('./')?path.slice(2):path);
  if(names.some(path=>!safeName(path)))throw Error(`${label}: invalid archive path`);
  const files=names.filter(path=>!path.endsWith('/'));
  if(new Set(files).size!==files.length||files.some(path=>!safeName(path)))throw Error(`${label}: invalid archive path`);
  const manifest=JSON.parse(archiveFile(archive,'release-manifest.json'));
  verifyManifest(manifest);
  if(manifest.version!==expectedVersion)throw Error(`${label}: wrong release version`);
  if(platform&&manifest.platform!==platform)throw Error(`${label}: wrong release platform`);
  const expected=['release-manifest.json',...Object.keys(manifest.files).map(name=>prefix+name)];
  if(expected.length!==files.length||expected.some(name=>!files.includes(name)))throw Error(`${label}: archive inventory mismatch`);
  if(label==='go-api'&&!files.includes('bin/modeldeploy'))throw Error('Model deployment worker missing');
  if(label==='litellm'&&['deploy-runner.mjs','systemd/materialsx-model-deploy.service','systemd/50-materialsx-model-deploy.rules']
    .some(name=>!files.includes(prefix+name)))throw Error('Model deployment adapter missing');
  const expectedDirs=new Set();
  for(const name of expected){const parts=name.split('/');for(let i=1;i<parts.length;i++)expectedDirs.add(parts.slice(0,i).join('/')+'/')}
  const actualDirs=names.filter(name=>name.endsWith('/'));
  if(actualDirs.length!==expectedDirs.size||actualDirs.some(name=>!expectedDirs.has(name)))throw Error(`${label}: archive directory inventory mismatch`);
  for(const [name,digest] of Object.entries(manifest.files)){
    if(hash(archiveFile(archive,prefix+name))!==digest)throw Error(`${label}: checksum mismatch`);
  }
  return {component:label,sha256:hash(await readFile(archive)),files:expected.length-1};
}
async function auditDirectory(root){
  const manifest=JSON.parse(await readFile(join(root,'release.json')));
  const workspaceVersion=JSON.parse(await readFile(resolve('package.json'))).version;
  if(manifest.workspaceVersion!==workspaceVersion||!/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(manifest.componentVersion))throw Error('Wrong billing Web release version');
  verifyManifest(manifest);
  const found=[];
  async function walk(dir,prefix=''){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const name=prefix+entry.name,path=join(dir,entry.name);
      if(entry.isDirectory())await walk(path,name+'/');
      else if(entry.isFile())found.push(name);
      else throw Error('Billing release contains non-file');
    }
  }
  await walk(root);
  const expected=['release.json',...Object.keys(manifest.files)];
  if(found.length!==expected.length||expected.some(name=>!found.includes(name)))throw Error('Billing release inventory mismatch');
  for(const [name,digest] of Object.entries(manifest.files)){
    const path=join(root,name),info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||hash(await readFile(path))!==digest)throw Error('Billing release checksum mismatch');
  }
  return {component:'billing-web',sha256:hash(await readFile(join(root,'release.json'))),files:found.length-1};
}

const results=[];
const platform=process.argv[2]??`${process.platform}-${process.arch}`;
if(!['darwin-arm64','linux-amd64','linux-arm64'].includes(platform))throw Error('Unsupported Go release platform');
const packageVersion=JSON.parse(await readFile(resolve('package.json'))).version;
if(typeof packageVersion!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(packageVersion))throw Error('Invalid workspace version');
results.push(await auditArchive('go-api',resolve(`dist/control-plane/v${packageVersion}-${platform}.tar.gz`),'',`v${packageVersion}`,platform));
results.push(await auditDirectory(resolve('dist/billing-admin')));
async function componentRelease(directory){
  const pointer=JSON.parse(await readFile(resolve(`dist/${directory}/latest.json`)));
  if(typeof pointer.version!=='string'||!/^v[A-Za-z0-9.-]{1,80}$/.test(pointer.version)||pointer.archive!==`${pointer.version}.tar.gz`||!(/^[a-f0-9]{64}$/).test(pointer.sha256))throw Error(`${directory}: invalid release pointer`);
  const archive=resolve(`dist/${directory}/${pointer.archive}`);
  if(hash(await readFile(archive))!==pointer.sha256)throw Error(`${directory}: archive checksum mismatch`);
  return {archive,version:pointer.version};
}
const litellm=await componentRelease('litellm');
const consoleRelease=await componentRelease('litellm-console');
results.push(await auditArchive('litellm',litellm.archive,'services/litellm/',litellm.version));
results.push(await auditArchive('litellm-console',consoleRelease.archive,'services/litellm-console/',consoleRelease.version));
console.log(JSON.stringify({status:'pass',artifacts:results}));
