#!/usr/bin/env node
// Builds the Go API as its own deployable unit. Runtime secrets stay outside the archive.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';

const platform=process.argv[2]??`${process.platform}-${process.arch}`;
const supported={'darwin-arm64':['darwin','arm64'],'linux-amd64':['linux','amd64'],'linux-arm64':['linux','arm64']};
if(!Object.hasOwn(supported,platform))throw Error('Use darwin-arm64, linux-amd64 or linux-arm64');
const [goos,goarch]=supported[platform];
const packageVersion=JSON.parse(await readFile(resolve('package.json'),'utf8')).version;
if(typeof packageVersion!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(packageVersion))throw Error('Invalid package release version');
const version=`v${packageVersion}`;
const staging=resolve('dist/control-plane',`${version}-${platform}`);
const archive=`${staging}.tar.gz`;
const files={};
function command(exe,args,env=process.env){return new Promise((accept,reject)=>{
  const child=spawn(exe,args,{env,stdio:'inherit'});
  child.once('error',reject);
  child.once('exit',code=>code===0?accept():reject(Error(`${exe} exited ${code}`)));
})}
async function hashTree(root,prefix=''){
  for(const entry of await readdir(root,{withFileTypes:true})){
    if(!/^[A-Za-z0-9_.-]+$/.test(entry.name))throw Error('Unexpected release filename');
    const rel=prefix+entry.name,path=join(root,entry.name);
    if(entry.isDirectory())await hashTree(path,rel+'/');
    else if(entry.isFile())files[rel]=createHash('sha256').update(await readFile(path)).digest('hex');
    else throw Error('Release may contain only regular files and directories');
  }
}

await rm(staging,{recursive:true,force:true});
await mkdir(join(staging,'bin'),{recursive:true});
for(const name of ['identity','identityctl','worker','modeldeploy']){
  await command('go',['-C','services/control-plane','build','-trimpath','-o',join(staging,'bin',name),`./cmd/${name}`],
    {...process.env,GOOS:goos,GOARCH:goarch,CGO_ENABLED:'0'});
}
const adminSource=resolve('dist/apps/admin');
await readFile(join(adminSource,'index.html'));
async function copyTree(source,target){
  await mkdir(target,{recursive:true});
  for(const entry of await readdir(source,{withFileTypes:true})){
    if(entry.isDirectory())await copyTree(join(source,entry.name),join(target,entry.name));
    else if(entry.isFile())await copyFile(join(source,entry.name),join(target,entry.name));
    else throw Error('Admin assets may contain only regular files and directories');
  }
}
await copyTree(adminSource,join(staging,'admin'));
await hashTree(staging);
await writeFile(join(staging,'release-manifest.json'),JSON.stringify({version,platform,files},null,2)+'\n');
await command('tar',['-czf',archive,'-C',staging,'.']);
console.log(JSON.stringify({artifact:archive,sha256:createHash('sha256').update(await readFile(archive)).digest('hex'),fileCount:Object.keys(files).length}));
