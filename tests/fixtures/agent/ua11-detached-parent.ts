/** Actual parent-exit fixture. The child uses production submission and receipts; no simulated worker. */
import {join} from 'node:path';
import {WorkspaceStore} from '../../../apps/desktop/main/store.js';
import {ResearchService} from '../../../apps/desktop/main/research-service.js';
import {campaignTask} from './ua11-task.js';
const directory=process.argv[2];if(!directory)throw Error('FIXTURE_DIRECTORY_REQUIRED');
const store=new WorkspaceStore(join(directory,'db.sqlite')),p=store.createProject(directory),service=new ResearchService(store,{client:null,assetRoot:process.cwd(),jobStateRoot:join(directory,'private-jobs')});
const configuration=await service.campaigns.installExample(p.id),task=campaignTask({temp:directory,store,p,service},configuration.id),args={action:'submit',configurationId:configuration.id,reason:'Verify survival after actual parent exit'};
task.control.beforeTool({id:'actual-parent-exit',name:'campaign_job',args,permissions:task.context.grant.permissions});
const result=await service.campaigns.tool(p.id,task.run.id,args) as {job:{id:string}};
task.control.afterTool('actual-parent-exit',{content:[{type:'text',text:JSON.stringify(result)}]},false);task.control.finish('completed_with_limitations');
if(task.control.snapshot().state!=='waiting')throw Error('TASK_NOT_WAITING');store.updateRun(task.run.id,'waiting');store.close();
process.stdout.write(JSON.stringify({projectId:p.id,taskId:task.run.id,jobId:result.job.id,parentPid:process.pid})+'\n',()=>process.exit(0));
