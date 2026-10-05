import {createHash,randomUUID} from 'node:crypto';
import {AgentError} from '../../contracts/src/agent.js';
import {moosRefSchema,type MoosRef,type ResearchSnapshot,type SourceReceipt} from '../../contracts/src/research-project.js';
import type {MaterialsMcpClient} from './mcp-client.js';
export const sourceHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface SourceStore {
  project(id:string):{selected:string[];withdrawn:string[]};snapshots(id:string):ResearchSnapshot[];
  snapshot(projectId:string,id:string):ResearchSnapshot;saveSnapshot(s:ResearchSnapshot):ResearchSnapshot;
  receipt(r:SourceReceipt):SourceReceipt;
}
export class SourceFailure extends AgentError {
  constructor(public outcome:SourceReceipt['outcome'],message:string){super(outcome==='denied'?'PERMISSION_DENIED':outcome==='stale'?'CONFLICT':'UNAVAILABLE',message);}
}
/** Exactly one source path. Selected project data wins; MOOS supplies its own filtering/comparison rules. */
export class DataSourceRouter {
  constructor(private store:SourceStore,private client:(Pick<MaterialsMcpClient,'call'|'readResource'> & {remoteProjectId?:string|null})|null|((projectId:string)=>(Pick<MaterialsMcpClient,'call'|'readResource'> & {remoteProjectId?:string|null})|null)){}
  private source(projectId:string){return typeof this.client==='function'?this.client(projectId):this.client;}
  private log(projectId:string,taskId:string|null,tool:string,args:unknown,origin:'project'|'moos',outcome:SourceReceipt['outcome'],result:unknown,detail=''){
    return this.store.receipt({id:randomUUID(),projectId,taskId,tool,args,origin,outcome,at:new Date().toISOString(),sha256:result===null?null:sourceHash(result),detail});
  }
  async moos(projectId:string,taskId:string|null,name:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<any>{
    try {
      const client=this.source(projectId);if(!client)throw new SourceFailure('unavailable','MOOS MCP is not configured / 未配置 MOOS MCP');
      const raw=await client.call(name,args,signal?{signal}:{});
      const part=(raw.content as Array<{type:string;text?:string}>).find(c=>c.type==='text');
      const envelope=JSON.parse(part?.text??'null');
      if(raw.isError){const code=envelope?.error?.code??envelope?.code;throw new SourceFailure(
        ['unauthorized','forbidden','metadata_only'].includes(code)?'denied':['stale_version','integrity_error'].includes(code)?'stale':code==='cancelled'?'cancelled':'unavailable',String(code??'MOOS rejected request'));}
      if(envelope?.adapterVersion!=='moos-mcp-v1'||envelope.projectionVersion!=='rpsme-experiment-sections-v1.1'||(client.remoteProjectId ? envelope.authorizationScope!=='project-research'||envelope.authorization?.projectId!==client.remoteProjectId : envelope.authorizationScope!=='local-research')||envelope.cloudExportAuthorized!==false||envelope.externalModelCalls!==0)
        throw new SourceFailure('invalid','MOOS response contract mismatch');
      let data=envelope.data;
      if(data?.resource&&name==='moos_get_experiment'){
        const resource=await client.readResource(data.resource,signal?{signal}:{});
        data=JSON.parse(String(resource.contents.find(c=>'text' in c)?.text));
      }
      this.log(projectId,taskId,name,args,'moos',data?.outcome??'matched',envelope);
      return {data,receipts:envelope.receipts??[],retrievedAt:envelope.retrievedAt};
    } catch(e){const fail=e instanceof SourceFailure?e:/401|403|FORBIDDEN|UNAUTHORIZED|PERMISSION_DENIED/.test(String(e))?new SourceFailure('denied','Project access denied / 项目访问被拒绝'):new SourceFailure(signal?.aborted?'cancelled':'unavailable',signal?.aborted?'Cancelled / 已取消':'MOOS connection unavailable / MOOS 服务不可用');
      this.log(projectId,taskId,name,args,'moos',fail.outcome,null,fail.message);throw fail;}
  }
  async search(projectId:string,taskId:string|null,args:{query:string;reviewScope:'verified'|'include-unreviewed';cursor?:string},signal?:AbortSignal){
    const p=this.store.project(projectId);
    if(!args.cursor){
      const normalize=(v:string)=>v.normalize('NFKC').toLocaleLowerCase().replace(/[_\s-]+/g,' ').trim();
      const q=normalize(args.query);
      const items=this.store.snapshots(projectId).filter(s=>p.selected.includes(s.id)&&!p.withdrawn.includes(s.id)&&
        (args.reviewScope==='include-unreviewed'||s.reviewStatus==='verified')&&normalize(JSON.stringify({title:s.title,data:s.data})).includes(q));
      if(items.length){for(const item of items)await this.verify(item,taskId,signal);this.log(projectId,taskId,'research_search',args,'project','matched',items.map(s=>({id:s.id,sha256:s.sha256})));
        return {origin:'project',outcome:'matched',items:items.map(s=>({snapshotId:s.id,title:s.title,ref:s.ref,reviewStatus:s.reviewStatus,sha256:s.sha256})),nextCursor:null};}
      this.log(projectId,taskId,'research_search',args,'project','no_match',[]);
    }
    const r=await this.moos(projectId,taskId,'moos_search',{...args,entityKinds:['experiment','recipe','process','performance','simulation'],limit:20},signal);
    return {origin:'moos',...r.data};
  }
  async select(projectId:string,taskId:string|null,input:MoosRef,signal?:AbortSignal):Promise<ResearchSnapshot>{
    const ref=moosRefSchema.parse(input),data:Record<string,any[]>={},receipts:unknown[]=[];
    const cached=this.store.snapshots(projectId).find(s=>s.origin==='moos'&&sourceHash(s.ref)===sourceHash(ref));
    if(cached){await this.verify(cached,taskId,signal);return cached;}
    let cursor:string|null=null,retrievedAt='';
    for(let i=0;i<10;i++){
      const r=await this.moos(projectId,taskId,'moos_get_experiment',{ref,section:'all',limit:50,...(cursor?{cursor}:{})},signal);
      if(!r.data?.data||r.data.ref&&sourceHash(r.data.ref)!==sourceHash(ref))throw new SourceFailure('invalid','Pinned record mismatch');
      for(const [key,rows] of Object.entries(r.data.data)){
        if(!Array.isArray(rows))throw new SourceFailure('invalid','Invalid MOOS section');
        data[key]??=[];data[key]!.push(...rows);
      }
      data.sourceStatus=[{sourceNullSections:r.data.sourceNullSections??[],missingFields:r.data.missingFields??[],identity:r.data.identity,scientificValidation:r.data.scientificValidation}];
      receipts.push(...r.receipts);retrievedAt=r.retrievedAt;cursor=r.data.nextCursor;if(!cursor)break;
    }
    if((data.evidence??[]).length>200)throw new SourceFailure('invalid','Evidence exceeds bounded snapshot');
    if(cursor)throw new SourceFailure('invalid','Record exceeds bounded snapshot; select a smaller experiment');
    const evidence:ResearchSnapshot['evidence']=[],evidenceData=[];
    for(const row of (data.evidence??[]).slice(0,200)){
      const r=await this.moos(projectId,taskId,'moos_get_evidence',{ref,evidenceId:row.id},signal);
      if(!r.data.evidenceSha256||!r.data.evidence)throw new SourceFailure('invalid','Evidence receipt missing');
      evidence.push({sourceId:String(ref.sourceId),generation:String(ref.generation),sha256:r.data.evidenceSha256,locator:String(row.id)});
      evidenceData.push(r.data.evidence);receipts.push(...r.receipts);
    }
    data.readEvidence=evidenceData;
    const sha256=sourceHash(data),existing=this.store.snapshots(projectId).find(s=>s.origin==='moos'&&sourceHash(s.ref)===sourceHash(ref)&&s.sha256===sha256);
    if(existing)return existing;
    return this.store.saveSnapshot({id:randomUUID(),projectId,origin:'moos',title:String(data.sourceStatus?.[0]?.identity?.label??`Experiment ${ref.experimentId}`),ref,sha256,
      version:String(ref.generation)+':'+ref.projectionSha256,retrievedAt,reviewStatus:ref.reviewStatus,evidence,data,receipts});
  }
  async verify(snapshot:ResearchSnapshot,taskId:string|null,signal?:AbortSignal){
    if(snapshot.ref)await this.moos(snapshot.projectId,taskId,'moos_get_experiment',{ref:snapshot.ref,section:'observations',limit:1},signal);
    if(sourceHash(snapshot.data)!==snapshot.sha256)throw new SourceFailure('stale','Cached project snapshot changed');
  }
  async image(projectId:string,taskId:string|null,snapshot:ResearchSnapshot,mediaId:string,signal?:AbortSignal){
    if(!snapshot.ref)throw new SourceFailure('denied','Only source-authorized MOOS images can be previewed');
    let cursor:string|null=null,asset:any;
    for(let page=0;page<10;page++){
      const r=await this.moos(projectId,taskId,'moos_search_assets',{ref:snapshot.ref,reviewScope:snapshot.ref.reviewScope,limit:50,...(cursor?{cursor}:{})},signal);
      asset=r.data.items.find((a:any)=>a.mediaId===mediaId);cursor=r.data.nextCursor;if(asset||!cursor)break;
    }
    if(!asset)throw new SourceFailure('denied','Image is not owned by selected experiment');
    const linked=await this.moos(projectId,taskId,'moos_read_asset',{handle:asset.handle,representation:'preview'},signal);
    const resource=await this.source(projectId)!.readResource(linked.data.resource,signal?{signal}:{});
    const blob=resource.contents.find(c=>'blob'in c) as {blob:string;mimeType:string}|undefined;
    const provenance=JSON.parse(String(resource.contents.find(c=>'text'in c)?.text))?.data;
    if(!blob||blob.mimeType!=='image/jpeg'||!provenance?.rightsBasis||provenance.cloudExportAuthorized!==false)throw new SourceFailure('denied','Missing image permission/provenance');
    const bytes=Buffer.from(blob.blob,'base64'),hash=createHash('sha256').update(bytes).digest('hex');
    if(bytes.length>2*1024*1024||hash!==provenance.contentSha256)throw new SourceFailure('stale','Image hash mismatch');
    this.log(projectId,taskId,'research_image',{snapshotId:snapshot.id,mediaId},'moos','matched',{sha256:hash,rightsBasis:provenance.rightsBasis});
    return {dataUrl:`data:image/jpeg;base64,${blob.blob}`,rightsBasis:String(provenance.rightsBasis),sha256:hash,bytes};
  }
}
