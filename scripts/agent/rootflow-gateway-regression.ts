// Real isolated PostgreSQL regression; provider calls inside Go tests are fixtures, never production payments.
import {spawn} from 'node:child_process';
import {isolatedRootflowEvaluation} from './rootflow-evaluation-fixture.js';
const fixture=await isolatedRootflowEvaluation();
const env={...process.env,MATERIALSX_IDENTITY_TEST_DATABASE_URL:fixture.testDatabaseUrl,
 MATERIALSX_IDENTITY_FIXTURE_URL:fixture.identityFixture.origin,MATERIALSX_IDENTITY_FIXTURE_EMAIL:fixture.identityFixture.email,MATERIALSX_IDENTITY_FIXTURE_PASSWORD:fixture.identityFixture.password};
const run=(command:string,args:string[])=>new Promise<void>((resolve,reject)=>{
 const child=spawn(command,args,{env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Isolated regression failed; see sanitized test output')));
});
try{await run('go',['-C','services/control-plane','test','./...']);await run(process.execPath,['--import','tsx','--test','packages/control-plane-client/src/identity.test.ts']);}
finally{await fixture.close();}
