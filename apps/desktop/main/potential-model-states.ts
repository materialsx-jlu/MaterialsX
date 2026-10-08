import type {PotentialCatalog} from '../../../packages/contracts/src/potential-hub.js';
import type {PotentialModelState} from '../../../packages/contracts/src/catalog-weights.js';
import type {AtomisticRuntime} from '../../../packages/atomistic/src/runtime.js';
import type {CatalogWeightManager} from '../../../packages/atomistic/src/catalog-weights.js';

/** Share only concurrent reads, never cache execution authority or stale states. */
export function singleFlight<T>(read:()=>Promise<T>):()=>Promise<T>{
 let pending:Promise<T>|null=null;
 return ()=>{
  if(!pending)pending=Promise.resolve().then(read).finally(()=>{pending=null;});
  return pending;
 };
}

export function modelStateReader(options:{runtime:AtomisticRuntime;catalog:()=>PotentialCatalog;weights:CatalogWeightManager;assertUsable:(id:string)=>void;loaded:Set<string>;loading:Set<string>}){
 return singleFlight(async()=>{
  const {runtime:atomistic,weights:catalogWeights,loaded,loading}=options;
  const mounted=new Map((await atomistic.mountedPackages.status()).map(p=>[p.potentialId,p]));
  const runtime=new Map(atomistic.status().map(r=>[r.potentialId,r]));
  const entries=options.catalog().entries.filter(e=>e.entityType==='checkpoint'||runtime.has(e.id));
  return Promise.all(entries.map(async(e):Promise<PotentialModelState>=>{
   const r=runtime.get(e.id),p=mounted.get(e.id);
   const installed=!!r?.installed&&(!p||p.state==='installed');
   const supported=!!r,runtimeReady=p?atomistic.environmentReady(e.id):!!r?.installed;
   let cache={potentialId:e.id,state:'absent' as PotentialModelState['state'],bytes:0,totalBytes:e.asset.bytes,observedSha256:null as string|null,expectedSha256:e.asset.sha256,verifiedAgainstCatalog:false,error:null as string|null};
   const downloadable=catalogWeights.allowed(e);
   // Approved packages already checked their identity above; do not also
   // create/check a second inert catalog download folder for the same model.
   try{if(downloadable&&!p)cache=await catalogWeights.status(e.id);}catch(err){cache.error=err instanceof Error?err.message:'CATALOG_CACHE_INVALID';}
   if(p)cache={...cache,state:p.state,bytes:p.bytes,totalBytes:p.totalBytes,expectedSha256:p.sha256,observedSha256:p.state==='installed'?p.sha256:null,verifiedAgainstCatalog:p.state==='installed',error:p.error};
   if(installed){cache.state=loaded.has(e.id)?'ready':'installed';cache.bytes=e.asset.bytes??p?.totalBytes??0;cache.observedSha256=e.asset.sha256;cache.verifiedAgainstCatalog=true;}
   else loaded.delete(e.id);
   let usable=true;try{options.assertUsable(e.id);}catch(err){usable=false;cache.error=err instanceof Error?err.message:'POTENTIAL_WITHDRAWN';}
   if(loading.has(e.id))cache.state='loading';
   return {...cache,supported,managedPackage:!!p,cacheOwned:p?(p.cacheOwned||p.state==='paused'):cache.bytes>0&&!installed,runtimeReady,canDownload:usable&&(!!p||downloadable&&!installed),canImport:usable&&(!!p||downloadable&&!!e.asset.sha256&&!!e.asset.bytes&&!installed),canLoad:usable&&installed&&cache.state!=='loading'};
  }));
 });
}
