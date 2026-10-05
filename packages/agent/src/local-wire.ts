import { z } from 'zod';
import { AgentError } from '../../contracts/src/agent.js';
import { modelConnectionSchema, type ModelConnection } from '../../contracts/src/engine-selection.js';
import { guardModelStream } from './model-stream.js';
import { declaredTools, validateCallPairs, responsesToChat } from './model-request.js';
import { chatAsResponses } from './chat-responses.js';
export function modelBudget(body: unknown, connection: ModelConnection) {
    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (connection.contextWindow === null || bytes + connection.maxOutputTokens + 1024 > connection.contextWindow)
        throw new AgentError('PROTOCOL_ERROR', '本轮输入超过本地保守上下文预算 / Local context budget exceeded');
}
/** The SDK owns execution. This callback accepts only its frozen loopback route and validates the wire. */
export function localWireFetch(connection: ModelConnection, request: typeof fetch = fetch, onUsage?: (usage: unknown | null) => void): typeof fetch {
    const checked = modelConnectionSchema.parse(connection);
    if (checked.source !== 'local')
        throw new AgentError('UNAVAILABLE', 'Local transport requires a local connection');
    return async (input, init) => {
        const url = input instanceof Request ? input.url : String(input), path = checked.protocol === 'responses' ? 'responses' : 'chat/completions';
        if (url !== `${checked.endpoint}/${path}` || init?.method?.toUpperCase() !== 'POST')
            throw new AgentError('PERMISSION_DENIED', '本地模型请求边界被拒绝 / Local model route denied');
        const body = JSON.parse(String(init.body));
        if (body.model !== checked.modelId || body.stream !== true)
            throw new AgentError('PROTOCOL_ERROR', '模型身份或流设置改变 / Model identity or stream changed');
        const output = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
        if (!Number.isInteger(output) || output < 1 || output > checked.maxOutputTokens)
            throw new AgentError('BUDGET_EXCEEDED', '输出预算超限 / Output budget exceeded');
        validateCallPairs(body, checked.protocol);
        const names = declaredTools(body, checked.protocol);
        // Reject invalid arguments before any terminal tool event can reach the SDK.
        // Compile only the actual advertised schemas; validation never modifies or executes a call.
        const schemas=new Map<string,z.ZodType>();
        for(const item of body.tools??[]){const tool=checked.protocol==='responses'?item:item.function;
            try{schemas.set(tool.name,z.fromJSONSchema(tool.parameters??{type:'object',additionalProperties:true}));}
            catch{throw new AgentError('PROTOCOL_ERROR','Declared tool schema is unsupported: '+tool.name);}
        }
        // LM Studio otherwise inherits UI sampling defaults, including repetition penalties.
        // Repeated JSON keys and receipt IDs are essential to a multi-step tool conversation.
        Object.assign(body, {temperature: 0, top_p: 1, frequency_penalty: 0, presence_penalty: 0, parallel_tool_calls: false});
        if (/gpt[-_]oss/i.test(checked.modelId)) {
            // LM Studio's multiplicative penalty is separate from OpenAI's additive penalties.
            body.repeat_penalty=1;
            body.top_k=0;
            body.min_p=0;
            if (checked.protocol === 'responses') body.reasoning = {effort: 'low'};
            else body.reasoning_effort = 'low';
        }
        modelBudget(body, checked);
        const headers = new Headers(init.headers);
        for (const name of ['authorization', 'cookie', 'proxy-authorization'])
            headers.delete(name);
        const response = await request(url, { ...init, body: JSON.stringify(body), headers, redirect: 'error' });
        return guardModelStream(response, checked.protocol, names, body.tool_choice !== 'none', onUsage, checked.modelId,undefined,(name,args)=>{const result=schemas.get(name)!.safeParse(args);return result.success?null:result.error.issues.slice(0,6).map(i=>i.path.join('.')+': '+i.message).join('; ').slice(0,1200);});
    };
}
export function localNativeInvoker(connection: ModelConnection, request: typeof fetch = fetch, onUsage?: (usage: unknown | null) => void) {
    const checked = modelConnectionSchema.parse(connection);
    const transport = localWireFetch(checked, request, onUsage);
    return async (input: unknown, signal: AbortSignal) => {
        signal.throwIfAborted();
        const raw = input as any;
        // Native private reasoning remains engine-owned; it is neither evidence nor
        // portable state for LM Studio's independent Responses parser. Keep all real
        // messages and matched function receipts, never replay private reasoning items.
        const messages = (raw.input ?? []).filter((item:any)=>item.type!=='reasoning');
        // Static wire instructions belong before history: retain the final tool
        // receipt/current host state as the end of the actual conversation.
        if((raw.tools??[]).some((t:any)=>t.name==='agent_exec'))messages.unshift({type:'message',role:'developer',content:
          'Local transport mapping: the documented functions.exec custom tool is encoded on this wire as the function agent_exec. Call the registered wire name agent_exec using a complete JSON object with one input string containing the native composer code. Escape quotes inside that string. Do not send raw code as function arguments or manually print protocol/Harmony tokens. The original native engine executes the code; all host grants and tool gates remain in force.'});
        const common = { ...raw, input: messages, max_output_tokens: Math.min(raw.max_output_tokens ?? checked.maxOutputTokens, checked.maxOutputTokens) };
        const body = checked.protocol === 'responses' ? { model: checked.modelId, input: messages, tools: raw.tools ?? [], tool_choice: raw.tool_choice ?? 'auto', stream: true, store: false, max_output_tokens: common.max_output_tokens, truncation: 'disabled', temperature: 0 } :
            // gpt-oss's native template distinguishes developer instructions from
            // system setup. Keep host updates in that role instead of introducing
            // fresh system setup messages between real tool calls and receipts.
            { model: checked.modelId, ...responsesToChat(common,/gpt[-_]oss/i.test(checked.modelId)?'developer':'system'), max_completion_tokens: common.max_output_tokens, temperature: 0 };
        const response = await transport(`${checked.endpoint}/${checked.protocol === 'responses' ? 'responses' : 'chat/completions'}`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body) });
        return checked.protocol === 'responses' ? response : chatAsResponses(response);
    };
}
