import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {methodPackageSchema} from '../../packages/contracts/src/method-packages.js';
import {reproduceMethod} from '../../packages/agent/src/method-reference.js';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {MethodPackages} from '../../apps/desktop/main/method-packages.js';
const manifests=z.array(methodPackageSchema).parse(JSON.parse(readFileSync('methods/catalog.json','utf8'))),receipts=[];
const store=new WorkspaceStore(':memory:');try{assert(new MethodPackages(store.research,process.cwd()).overview().entries.every(e=>e.executable),'Runtime/schema/source/lock assets must match the reviewed manifests');}finally{store.close();}
for(let repeat=0;repeat<3;repeat++)for(const m of manifests){const receipt=reproduceMethod(process.cwd(),m);assert.equal(receipt.status,'passed');receipts.push(receipt);}
const report={stage:'UA.10',referenceDatasets:2,distinctCertifiedFields:6,independentExecutions:3,checkedFields:receipts.reduce((n,r)=>n+r.checks.length,0),
  maxAbsoluteError:Math.max(...receipts.flatMap(r=>r.checks.map(c=>c.error))),reference:'NIST/ITL StRD PiDigits + Norris certified statistics',domainValidated:false,productionApproved:false,receipts};
const root=resolve('runtime/agent/ua-10');mkdirSync(root,{recursive:true});writeFileSync(resolve(root,'reference.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,receipts:undefined}));
