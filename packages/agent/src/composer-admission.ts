import { AgentError, type Permission } from '../../contracts/src/agent.js';
import type { ExecutionControl } from './execution-control.js';
/** Narrow steps accept one literal tool invocation. Opaque programs require an explicitly broad engine.execute step.
 * This is not a JavaScript sandbox/parser, and never executes the code. The native OS sandbox and MCP checks remain authoritative. */
export function composerAdmission(code:unknown,control:ExecutionControl,tools:ReadonlyMap<string,readonly Permission[]>,hostTools?:ReadonlySet<string>) {
 if(typeof code==='string'){
  const match=/^\s*text\(await tools\.([A-Za-z_]\w*)\(([\s\S]*)\)\);?\s*$/.exec(code);
  if(match){
   let args:unknown;try{args=JSON.parse(match[2]!);}catch{/* Non-literal code requires broad admission. */}
   if(args!==undefined){
    const name=match[1]!.replace(/^mcp__materialsx__/,'');const permissions=tools.get(name);
    if(!permissions)throw new AgentError('UNKNOWN_METHOD','原生程序引用未开放的工具');
    // Registered HostMcp tools perform admission at the actual dispatcher, returning
    // a normal tool error the native loop can correct. OS tools remain pre-admitted.
    if(!(name!==match[1]&&hostTools?.has(name)))control.authorize(name,permissions);
    return {name,permissions,args,host:name!==match[1]};
   }
  }
 }
 const permissions=['read','search','terminal','patch'] as const;
 control.authorize('engine.execute',permissions);
 return {name:'engine.execute',permissions,args:{input:code},host:false};
}
