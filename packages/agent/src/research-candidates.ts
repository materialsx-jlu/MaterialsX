import type {MoosRef} from '../../contracts/src/research-project.js';
import {sourceHash} from './data-source-router.js';
/** Short handles for exact searched references; this neither searches nor executes tools. */
export class ResearchCandidates {
  private entries=new Map<string,{projectId:string;taskId:string;target:CandidateTarget}>();
  issue(projectId:string,taskId:string,ref:MoosRef):string {
    return this.put(projectId,taskId,{kind:'moos',ref});
  }
  issueSnapshot(projectId:string,taskId:string,snapshot:{id:string;version:string;sha256:string}):string {
    return this.put(projectId,taskId,{kind:'snapshot',snapshotId:snapshot.id,version:snapshot.version,sha256:snapshot.sha256});
  }
  private put(projectId:string,taskId:string,target:CandidateTarget){
    const id='moos-'+sourceHash({projectId,taskId,target}).slice(0,24);
    const previous=this.entries.get(id);
    if(previous&&sourceHash(previous.target)!==sourceHash(target))throw Error('MOOS_CANDIDATE_COLLISION');
    this.entries.set(id,{projectId,taskId,target:structuredClone(target)});
    while(this.entries.size>200)this.entries.delete(this.entries.keys().next().value!);
    return id;
  }
  resolve(projectId:string,taskId:string,id:string):MoosRef {
    const target=this.resolveTarget(projectId,taskId,id);
    if(target.kind!=='moos')throw Error('CANDIDATE_IS_PROJECT_SNAPSHOT');
    return target.ref;
  }
  resolveTarget(projectId:string,taskId:string,id:string):CandidateTarget {
    const entry=this.entries.get(id);
    if(!entry||entry.projectId!==projectId||entry.taskId!==taskId)throw Error('MOOS_CANDIDATE_NOT_IN_TASK: search again and use the actual returned candidateId');
    return structuredClone(entry.target);
  }
  clear(){this.entries.clear();}
}
type CandidateTarget={kind:'moos';ref:MoosRef}|{kind:'snapshot';snapshotId:string;version:string;sha256:string};
