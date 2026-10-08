/** Only called on actual engine/host tool output, never on a model's completion claim. */
export function observedJobs(result: unknown): Array<{ id: string; state: string }> {
  const jobs = new Map<string,string>();
  const walk = (value: any, depth = 0) => {
    if (!value || depth > 8) return;
    if (typeof value === "string") { try { walk(JSON.parse(value),depth+1); } catch { /* Plain tool text has no typed job proof. */ } return; }
    if (Array.isArray(value)) { value.slice(0,128).forEach(v=>walk(v,depth+1));return; }
    if (typeof value !== "object") return;
    if (typeof value.runId === "string" && typeof (value.status ?? value.state) === "string") jobs.set(value.runId,value.status??value.state);
    if (value.job && typeof value.job.id === "string" && typeof value.job.status === "string") jobs.set(value.job.id,value.job.status);
    if (typeof value.workflowId === "string" && typeof value.state === "string") jobs.set(value.workflowId,value.state);
    for (const v of Object.values(value)) walk(v,depth+1);
  };
  walk(result); return [...jobs].slice(0,32).map(([id,state])=>({id,state}));
}

/** Pi defaults absent usage to zero. Keep absent/empty accounting unknown, never invent a bill. */
export function reportedPiUsage(value: any): unknown { return value && Number(value.totalTokens)>0 ? value : null; }

/** Read native wrapper status, not error-looking text inside user files or command stdout. */
export function nativeToolFailed(value:unknown):boolean {
 const items=Array.isArray(value)?value:[value];
 return items.some(item=>{
  const part=item as any;
  if(part&&typeof part==='object'&&!('text' in part))return part.isError===true||typeof part.exit_code==='number'&&part.exit_code!==0;
  const text=typeof part==='string'?part:part?.text;
  if(typeof text!=='string')return false;
  if(/^(?:Script failed|Script error:)(?:\r?\n|$)/.test(text))return true;
  try{const result=JSON.parse(text);if(result&&typeof result==='object'&&!Array.isArray(result))return result.isError===true||typeof result.exit_code==='number'&&result.exit_code!==0;}catch{/* Native human-readable command metadata below. */}
  const code=nativeReceiptMetadata(text).exitCode;return code!==null&&code!==0;
 });
}

/** Only wrapper fields/header metadata, never arbitrary stdout or a model's prose. */
export function nativeReceiptMetadata(value:unknown):{exitCode:number|null;sessionId:string|number|null;truncated:boolean;originalTokenCount:number|null}{
 const result:{exitCode:number|null;sessionId:string|number|null;truncated:boolean;originalTokenCount:number|null}={exitCode:null,sessionId:null,truncated:false,originalTokenCount:null};
 const items=Array.isArray(value)?value:[value];
 for(const item of items){
  let part:any=item;
  const text=typeof item==='string'?item:(item as any)?.text;
  if(typeof text==='string'){
   try{part=JSON.parse(text);}catch{
    const header=text.split(/(?:^|\n)Output:\s*\n/)[0]!;
    const code=/(?:^|\n)(?:Process exited with code|Exit code:)\s*(-?\d+)\b/.exec(header);
    const session=/(?:^|\n)Process running with session ID\s+(\d+)\b/.exec(header);
    if(code)result.exitCode=Number(code[1]);if(session)result.sessionId=Number(session[1]);
    const count=/Original token count:\s*(\d+)/i.exec(header);if(count)result.originalTokenCount=Number(count[1]);
    result.truncated ||= /Output truncated|truncated output/i.test(header);continue;
   }
  }
  if(!part||typeof part!=='object'||Array.isArray(part))continue;
  if(Number.isInteger(part.exit_code))result.exitCode=part.exit_code;
  if(typeof part.session_id==='string'||Number.isInteger(part.session_id))result.sessionId=part.session_id;
  if(typeof part.original_token_count==='number')result.originalTokenCount=part.original_token_count;
  result.truncated ||= part.truncated===true||typeof part.output==='string'&&/\[?Output truncated|truncated output|output.{0,15}truncated/i.test(part.output);
 }
 return result;
}
