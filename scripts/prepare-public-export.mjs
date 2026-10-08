// Run only in a disposable clone. The full local checkout keeps private services.
import {readFile,writeFile,rm,stat,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const root=resolve(process.argv[2]??'');
if(!process.argv[2]||root===process.cwd()||!root.endsWith('/MaterialsX')){
  throw new Error('Pass a disposable MaterialsX export clone, not the full working checkout');
}
if(!(await stat(join(root,'.git')).catch(()=>null)))throw new Error('Export target must be a Git clone');

for(const path of [
  'apps/billing-admin','services/billing-admin','services/control-plane/internal/billingadmin',
  'services/litellm','services/litellm-console','packages/contracts/src/billing-admin.ts',
  'scripts/build-billing-admin.mjs','scripts/reconcile-local-mx.mjs',
])await rm(join(root,path),{recursive:true,force:true});
for(const path of await readdir(join(root,'scripts'))){
  // Private 0.3 release, payment, proxy and reconciliation operators are not
  // runnable from the public checkout and must not publish operational internals.
  if(path.startsWith('mx03-'))await rm(join(root,'scripts',path),{force:true});
}

const entry=join(root,'services/control-plane/cmd/identity/main.go');
let go=await readFile(entry,'utf8');
const importLine='\t"github.com/jamip/materialsx/control-plane/internal/billingadmin"\n';
const begin='\tbillingOrigin := os.Getenv("MATERIALSX_BILLING_ADMIN_PUBLIC_URL")\n';
const end='\tserver := identity.NewServer(cfg.Address, handler)\n';
if(!go.includes(importLine)||!go.includes(begin)||!go.includes(end))throw new Error('Billing API mount changed; review export boundary before publishing');
go=go.replace(importLine,'');
go=go.slice(0,go.indexOf(begin))+go.slice(go.indexOf(end));
await writeFile(entry,go);

const manifest=join(root,'package.json');
const pkg=JSON.parse(await readFile(manifest,'utf8'));
for(const name of Object.keys(pkg.scripts)){
  if(name.startsWith('mx03:')||name.startsWith('billing-admin:')||name.startsWith('litellm:')||name==='build:billing-admin'||name==='check:billing-admin')delete pkg.scripts[name];
}
pkg.scripts.check=pkg.scripts.check.replace(' && npm run check:billing-admin','');
if(pkg.scripts.verify)pkg.scripts.verify=pkg.scripts.verify.replace(' && npm run check:billing-admin','');
await writeFile(manifest,JSON.stringify(pkg,null,2)+'\n');
console.log('Public export prepared; run source and secret checks before Git staging.');
