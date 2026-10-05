import { ipcMain } from "electron";
import { z } from "zod";
import type { WorkspaceStore } from "./store.js";
import type { DesktopAgentRuntime } from "./agent-runtime.js";
import type { IdentityClient } from "../../../packages/control-plane-client/src/identity.js";
import type { MessageStreamEvent } from "../../../packages/contracts/src/desktop.js";
import { researchGoalPlanSchema } from "../../../packages/contracts/src/research-goal.js";
import { TextStreamBuffer } from "../../../packages/pi-adapter/src/text-stream-buffer.js";
import { AgentError } from "../../../packages/contracts/src/agent.js";
export function registerExecutionIpc(context: {store:WorkspaceStore;agentRuntime:DesktopAgentRuntime;identityClient:IdentityClient;
  sendMessageStream(event:MessageStreamEvent):void;activeConversations:Set<string>}) {
  const {store,agentRuntime,identityClient,sendMessageStream,activeConversations}=context;
  const owned=(input:unknown)=>{
    const id=z.uuid().parse(input),state=agentRuntime.execution(id);
    if(state && store.listConversations().find(c=>c.id===state.task.conversationId)?.projectId!==state.task.projectId)throw new AgentError("CONFLICT","任务项目范围不一致");
    return {id,state};
  };
  ipcMain.handle("agent:execution",(_event,input)=>owned(input).state);
  ipcMain.handle("agent:events",(_event,input)=>agentRuntime.events(owned(input).id));
  ipcMain.handle("agent:reconcile",async (_event,input)=>{
    const {id}=owned(input),account=await identityClient.snapshot();
    return agentRuntime.reconcile(id,account.status==="connected"?account.user?.id:undefined);
  });
  ipcMain.handle("agent:revise",(_event,input)=>{
    const q=z.strictObject({taskId:z.uuid(),expectedRevision:z.number().int().positive(),proposal:researchGoalPlanSchema}).parse(input);
    owned(q.taskId);return agentRuntime.revise(q.taskId,q.expectedRevision,q.proposal);
  });
  const continueTask=async (input:unknown,engine?:"pi"|"codex")=>{
    const {id,state}=owned(input);if(!state)throw new AgentError("UNAVAILABLE","没有受管执行记录");
    const conversationId=state.task.conversationId;
    if(activeConversations.has(conversationId))throw new AgentError("CONFLICT","对话已有任务执行中");
    activeConversations.add(conversationId);
    const streamId=`stream:${conversationId}:${crypto.randomUUID()}`;let sequence=0,text="";
    const emit=(event:Omit<MessageStreamEvent,"conversationId"|"streamId"|"sequence">)=>sendMessageStream({conversationId,streamId,sequence:sequence++,...event});
    const buffer=new TextStreamBuffer(delta=>emit({type:"delta",delta}),32);
    emit({type:"start"});
    const delta=(value:string)=>{text+=value;buffer.push(value);};
    let runningId=id;
    const onEvent=(event:NonNullable<MessageStreamEvent["executionEvent"]>)=>{runningId=event.taskId;emit({type:"phase",executionEvent:event});};
    try {
      const answer=engine?await agentRuntime.handoff(id,engine,delta,onEvent):await agentRuntime.resume(id,delta,onEvent);
      buffer.close();store.appendMessage(conversationId,"assistant",answer,"complete",runningId);
      store.updateRun(runningId,agentRuntime.execution(runningId)?.state==="waiting"?"waiting":agentRuntime.execution(runningId)?.state==="blocked"?"blocked":"completed_with_limitations");
      emit({type:"complete",content:answer});
    }catch(error){
      buffer.close();const message=error instanceof Error?error.message:String(error);
      const actual=agentRuntime.execution(runningId)?.state, cancelled=actual==="cancelled";
      if(runningId!==id||actual!=="handed_off")store.updateRun(runningId,cancelled?"cancelled":actual==="blocked"?"blocked":"failed");
      store.appendMessage(conversationId,"system",message,cancelled?"cancelled":"failed");
      emit({type:cancelled?"cancelled":"error",content:text,error:message});throw error;
    }finally{buffer.close();activeConversations.delete(conversationId);}
  };
  ipcMain.handle("agent:resume",(_event,input)=>continueTask(input));
  ipcMain.handle("agent:handoff",(_event,input)=>{
    const q=z.strictObject({taskId:z.uuid(),engine:z.enum(["pi","codex"])}).parse(input);return continueTask(q.taskId,q.engine);
  });
}
