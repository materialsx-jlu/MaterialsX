// macOS owns the launcher so closing a terminal or killing a child cannot strand login.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,chmodSync,existsSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
const label='com.materialsx.local-identity';
const domain=`gui/${process.getuid()}`,target=`${domain}/${label}`;
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const ctl=(args)=>spawnSync('/bin/launchctl',args,{encoding:'utf8'});
export async function manageLocalIdentity(root,args){
 const dir=join(root,'runtime/m5-local'),agents=join(homedir(),'Library/LaunchAgents'),plist=join(agents,label+'.plist');
 const loaded=ctl(['print',target]).status===0;
 if(loaded){
  if(ctl(['bootout',target]).status!==0)throw Error('Could not stop managed identity launcher');
  for(let i=0;i<100&&existsSync(join(dir,'launcher.lock'));i++)await delay(100);
 }
 if(args.includes('--stop')){
  // Removing our agent prevents RunAtLoad from undoing an explicit stop at next login.
  if(existsSync(plist)){if(lstatSync(plist).isSymbolicLink())throw Error('LaunchAgent file must not be a symlink');unlinkSync(plist)}
  return false; // The foreground stop path also stops PostgreSQL.
 }
 mkdirSync(dir,{recursive:true,mode:0o700});
 if(lstatSync(dir).isSymbolicLink())throw Error('Private runtime directory must not be a symlink');
 chmodSync(dir,0o700);mkdirSync(agents,{recursive:true});
 if(existsSync(plist)&&lstatSync(plist).isSymbolicLink())throw Error('LaunchAgent file must not be a symlink');
 const log=join(dir,'launcher.log');
 if(existsSync(log)&&lstatSync(log).isSymbolicLink())throw Error('Launcher log must not be a symlink');
 writeFileSync(log,'',{flag:'a',mode:0o600});chmodSync(log,0o600);
 const argv=[process.execPath,join(root,'scripts/local-identity.mjs'),'--foreground',...args];
 // Credentials stay in private-config.json, never in the launchd plist.
 writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
 <key>Label</key><string>${label}</string>
 <key>ProgramArguments</key><array>${argv.map(v=>`<string>${xml(v)}</string>`).join('')}</array>
 <key>WorkingDirectory</key><string>${xml(root)}</string>
 <key>EnvironmentVariables</key><dict><key>LC_ALL</key><string>C</string><key>PATH</key><string>${xml(process.env.PATH||'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')}</string>${process.env.MATERIALSX_POSTGRES_BIN?`<key>MATERIALSX_POSTGRES_BIN</key><string>${xml(process.env.MATERIALSX_POSTGRES_BIN)}</string>`:''}</dict>
 <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
 <key>ThrottleInterval</key><integer>5</integer>
 <key>ExitTimeOut</key><integer>15</integer>
 <key>StandardOutPath</key><string>${xml(log)}</string>
 <key>StandardErrorPath</key><string>${xml(log)}</string>
 </dict></plist>\n`,{mode:0o600});chmodSync(plist,0o600);
 if(ctl(['bootstrap',domain,plist]).status!==0)throw Error('Could not register local identity LaunchAgent');
 for(let i=0;i<180;i++){
  try{if((await fetch('http://127.0.0.1:8788/health',{signal:AbortSignal.timeout(500)})).ok){
   console.log('MaterialsX identity is managed by launchd and restarts automatically.\nOperations: http://127.0.0.1:8788/ops\nPrivate login details: '+join(dir,'LOGIN.md')+'\nStop: npm run identity:local -- --stop');return true;
  }}catch{}
  await delay(250);
 }
 throw Error('Managed identity did not become healthy; inspect runtime/m5-local/launcher.log');
}
