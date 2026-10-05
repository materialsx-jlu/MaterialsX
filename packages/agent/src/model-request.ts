import { AgentError } from '../../contracts/src/agent.js';
function fail(detail: string): never { throw new AgentError('PROTOCOL_ERROR', detail); }
export type WireProtocol = 'responses' | 'chat-completions';
export function objectArguments(value: unknown) {
    let parsed: unknown;
    try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
    }
    catch {
        fail('工具参数不是完整 JSON / Incomplete tool arguments');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        fail('工具参数必须为对象 / Tool arguments must be an object');
    return parsed;
}
/** Validate call/result pairing before transport; no tools are executed here. */
export function validateCallPairs(body: any, protocol: WireProtocol) {
    const pending = new Set<string>(), seen = new Set<string>();
    const add = (id: unknown, args: unknown) => { if (typeof id !== 'string' || !id || seen.has(id))
        fail('工具调用 ID 缺失或重复 / Missing or repeated call ID'); objectArguments(args); seen.add(id); pending.add(id); };
    const result = (id: unknown) => { if (typeof id !== 'string' || !pending.delete(id))
        fail('工具回执没有匹配的调用 / Unpaired tool result'); };
    if (protocol === 'responses')
        for (const item of body.input ?? []) {
            if (item.type === 'function_call')
                add(item.call_id, item.arguments);
            if (item.type === 'function_call_output')
                result(item.call_id);
        }
    else
        for (const item of body.messages ?? []) {
            for (const call of item.tool_calls ?? [])
                add(call.id, call.function?.arguments);
            if (item.role === 'tool')
                result(item.tool_call_id);
        }
    if (pending.size)
        fail('工具调用缺少回执，不能继续请求 / Missing tool results');
}
export function declaredTools(body: any, protocol: WireProtocol): Set<string> {
    const names = new Set<string>();
    for (const t of body.tools ?? []) {
        const name = protocol === 'responses' ? t.name : t.function?.name;
        if (t.type !== 'function' || typeof name !== 'string' || !name || names.has(name))
            fail('工具目录格式无效或重名 / Invalid tool registry');
        names.add(name);
    }
    return names;
}
export function checkText(value: unknown) { if (typeof value !== 'string')
    fail('模型文本格式无效 / Invalid model text'); if (/<\|(?:channel|im_start|im_end|start|end|message|python_tag)\|>/.test(value))
    fail('模型返回未解析的协议标记 / Unparsed model markers'); return value; }
export function responsesToChat(raw: any, developerRole:'system'|'developer'='system') {
    if (!Array.isArray(raw.input))
        fail('模型输入缺失 / Missing model input');
    const messages: any[] = [];
    for (const item of raw.input) {
        if (item.type === 'reasoning')
            continue; // Private analysis is not disguised as user evidence.
        if (item.type === 'function_call') {
            const last = messages.at(-1);
            const call = { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } };
            if (last?.role === 'assistant' && last.tool_calls)
                last.tool_calls.push(call);
            else
                messages.push({ role: 'assistant', content: null, tool_calls: [call] });
        }
        else if (item.type === 'function_call_output')
            messages.push({ role: 'tool', tool_call_id: item.call_id, content: item.output });
        else if (item.type === 'message' || !item.type && item.role) {
            let content = item.content;
            if (Array.isArray(content))
                content = content.map(p => { if (!['input_text', 'output_text', 'text'].includes(p.type) || typeof p.text !== 'string')
                    fail('此组合未验证图片输入 / Image input is unverified for this combination'); return p.text; }).join('\n');
            if (typeof content !== 'string')
                fail('不支持的消息内容 / Unsupported message content');
            messages.push({ role: item.role === 'developer' ? developerRole : item.role, content });
        }
        else
            fail('不支持的输入类型 / Unsupported model input type');
    }
    return { messages, tools: (raw.tools ?? []).map((t: any) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters, ...(t.strict === undefined ? {} : { strict: t.strict }) } })), tool_choice: raw.tool_choice ?? 'auto', stream: true, stream_options: { include_usage: true } };
}
