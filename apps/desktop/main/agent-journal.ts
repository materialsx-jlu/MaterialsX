import { DatabaseSync } from "node:sqlite";
import { AgentError } from "../../../packages/contracts/src/agent.js";
import { taskExecutionSchema, type TaskExecution, type ExecutionEvent } from "../../../packages/contracts/src/task-execution.js";
/** Uses the existing WorkspaceStore database, not another plan/task database. */
export class AgentJournal {
  private depth=0;
  constructor(private db: DatabaseSync) {}
  interrupted() {
    for (const row of this.db.prepare("SELECT value FROM app_meta WHERE key LIKE 'task_execution:%'").all()) {
      const state = taskExecutionSchema.parse(JSON.parse(String(row.value)));
      if (state.state !== "running") continue;
      const expected=state.version;state.version++;state.sequence++;state.state="interrupted";state.reason="应用重启；先查真实回执，未重置预算";
      for (const a of state.attempts) if (a.state==="running") a.state="unknown";
      for (const r of state.requests) if (r.state==="running") r.state="unknown";
      this.save(state,expected,{taskId:state.task.taskId,sequence:state.sequence,at:Date.now(),planRevision:state.planRevision,type:"terminal",id:"restart",state:"interrupted",detail:state.reason});
    }
  }
  forProject(id:string){return this.db.prepare("SELECT value FROM app_meta WHERE key LIKE 'task_execution:%' AND json_extract(value,'$.task.projectId')=?").all(id).map(r=>taskExecutionSchema.parse(JSON.parse(String(r.value))));}
  forConversation(id: string) {
    return this.db.prepare("SELECT value FROM app_meta WHERE key LIKE 'task_execution:%' AND json_extract(value,'$.task.conversationId')=?").all(id)
      .map(r=>taskExecutionSchema.parse(JSON.parse(String(r.value))));
  }
  read(id: string): TaskExecution | null {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key=?").get(`task_execution:${id}`);
    return row ? taskExecutionSchema.parse(JSON.parse(String(row.value))) : null;
  }
  save(state: TaskExecution, expected: number | null, event: ExecutionEvent, mutation?:()=>void) {
    const parsed = taskExecutionSchema.parse(state);
    const owner=this.depth===0;
    if(owner)this.db.exec("BEGIN IMMEDIATE");this.depth++;
    try {
    const previous = this.read(parsed.task.taskId);
    const run = this.db.prepare("SELECT project_id FROM runs WHERE id=?").get(parsed.task.taskId);
    const conversation = this.db.prepare("SELECT project_id FROM conversations WHERE id=?").get(parsed.task.conversationId);
    if (run?.project_id !== parsed.task.projectId || conversation?.project_id !== parsed.task.projectId) throw new AgentError("CONFLICT", "执行记录不属于当前任务范围");
    if (expected === null ? !!previous : previous?.version !== expected) throw new AgentError("CONFLICT", "执行记录版本冲突");
    if (previous && (previous.connectionId !== parsed.connectionId || previous.engine !== parsed.engine || previous.accountRef !== parsed.accountRef ||
      previous.parentTaskId !== parsed.parentTaskId || JSON.stringify(previous.task) !== JSON.stringify(parsed.task) || parsed.sequence !== previous.sequence + 1 || parsed.version !== previous.version + 1))
      throw new AgentError("CONFLICT", "执行身份或事件序号不可改变");
      if (event.taskId !== parsed.task.taskId || event.sequence !== parsed.sequence || event.planRevision !== parsed.planRevision) throw new AgentError("CONFLICT", "事件与执行记录不匹配");
      mutation?.();
      this.db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`task_execution:${parsed.task.taskId}`, JSON.stringify(parsed));
      this.db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?)").run(`agent_event:${parsed.task.taskId}:${String(event.sequence).padStart(8,"0")}`, JSON.stringify(event));
      if(owner)this.db.exec("COMMIT");
    } catch (error) { if(owner)this.db.exec("ROLLBACK"); throw error; }
    finally {this.depth--;}
  }
  events(id: string): ExecutionEvent[] {
    return this.db.prepare("SELECT value FROM app_meta WHERE key LIKE ? ORDER BY key").all(`agent_event:${id}:%`).map(r => JSON.parse(String(r.value)));
  }
  result(id: string, hash: string, value: unknown) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 1024 * 1024) throw new AgentError("BUDGET_EXCEEDED", "工具回执超过日志大小上限");
    this.db.prepare("INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)").run(`agent_result:${id}:${hash}`, text);
    return hash;
  }
  readResult(id: string, hash: string) {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key=?").get(`agent_result:${id}:${hash}`);
    if (!row) throw new AgentError("RECONCILIATION_REQUIRED", "已完成操作的真实回执缺失，不能重新执行");
    return JSON.parse(String(row.value));
  }
}
