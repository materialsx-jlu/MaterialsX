import { createHash } from 'node:crypto';
import { readFile, open, lstat, mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { validateRelease } from '../../website/src/release-validation.mjs';

const [action,releasePath,configPath]=process.argv.slice(2);
if(!['publish','rollback'].includes(action)||!releasePath||!configPath)throw Error('Usage: deployment-audit.mjs publish|rollback <release.json> <deployment.yaml>');
const auditPath=process.env.MATERIALSX_OD6_AUDIT_FILE;
if(!auditPath?.startsWith('/')||!process.env.MATERIALSX_OD6_OPERATOR||!process.env.MATERIALSX_OD6_REASON)throw Error('PRIVATE_AUDIT_FILE_OPERATOR_REASON_REQUIRED');
const channel=process.env.MATERIALSX_OD6_CHANNEL;
if(!['preview','stable'].includes(channel))throw Error('RELEASE_CHANNEL_REQUIRED');
const release=validateRelease(JSON.parse(await readFile(resolve(releasePath),'utf8')),channel);
const config=await readFile(resolve(configPath));
if(config.byteLength>256*1024)throw Error('DEPLOYMENT_CONFIG_TOO_LARGE');
const sha=value=>createHash('sha256').update(value).digest('hex');
const file=resolve(auditPath),repository=resolve(import.meta.dirname,'../..');
if(file===repository||file.startsWith(repository+sep))throw Error('AUDIT_MUST_BE_OUTSIDE_REPOSITORY');
await mkdir(dirname(file),{recursive:true,mode:0o700});
if((await lstat(dirname(file))).mode&0o077)throw Error('AUDIT_DIRECTORY_NOT_PRIVATE');
const row={at:new Date().toISOString(),action,channel,version:release.version,releaseDigest:sha(JSON.stringify(release)),configDigest:sha(config),operator:process.env.MATERIALSX_OD6_OPERATOR.slice(0,80),reason:process.env.MATERIALSX_OD6_REASON.slice(0,240),previousVersion:process.env.MATERIALSX_OD6_PREVIOUS_VERSION||null};
const handle=await open(file,'a',0o600);
try{if((await handle.stat()).mode&0o077)throw Error('AUDIT_FILE_NOT_PRIVATE');await handle.write(`${JSON.stringify(row)}\n`);await handle.sync()}finally{await handle.close()}
console.log(`${action} audit recorded: ${channel} ${release.version}, release ${row.releaseDigest.slice(0,12)}, configuration ${row.configDigest.slice(0,12)}`);
