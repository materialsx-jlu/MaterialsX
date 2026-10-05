import { isDeepStrictEqual } from 'node:util';
import { AgentError } from '../../contracts/src/agent.js';
import { checkText, objectArguments, type WireProtocol } from './model-request.js';
function fail(detail: string): never { throw new AgentError('PROTOCOL_ERROR', detail); }
export function measuredUsage(raw: any, protocol: WireProtocol): unknown | null {
    if (!raw)
        return null;
    const input = protocol === 'responses' ? raw.input_tokens : raw.prompt_tokens, output = protocol === 'responses' ? raw.output_tokens : raw.completion_tokens;
    const cached = protocol === 'responses' ? raw.input_tokens_details?.cached_tokens : raw.prompt_tokens_details?.cached_tokens;
    const reasoning = protocol === 'responses' ? raw.output_tokens_details?.reasoning_tokens : raw.completion_tokens_details?.reasoning_tokens;
    if (![input, output].every(v => Number.isSafeInteger(v) && v >= 0) || (cached !== undefined && (!Number.isSafeInteger(cached) || cached < 0 || cached > input)) || (reasoning !== undefined && (!Number.isSafeInteger(reasoning) || reasoning < 0 || reasoning > output)))
        fail('模型用量格式无效 / Invalid reported usage');
    return raw;
}
/** Hold terminal until the whole wire stream is valid. Partial text can be shown, never used to execute tools. */
export function guardModelStream(response: Response, protocol: WireProtocol, tools: Set<string>, allowTools: boolean, onUsage?: (usage: unknown | null) => void, expectedModel?: string, onFailure?: (error: AgentError) => void, validateArguments?: (name:string,args:unknown)=>string|null): Response {
    const fail = (detail: string): never => { const e = new AgentError('PROTOCOL_ERROR', detail); onFailure?.(e); throw e; };
    if (!response.ok)
        throw new AgentError('UNAVAILABLE', `模型端点返回 HTTP ${response.status} / Model endpoint failed; no fallback`);
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
        fail('模型未返回 SSE / Expected model SSE');
    const decoder = new TextDecoder(), encoder = new TextEncoder();
    let buffer = '', terminal = '', text = '', toolTerminals = '', finished = false, done = false, total = 0, usage: unknown | null = null;
    const completedItems = new Map<string, any>();
    const calls = new Map<number, {
        id: string;
        name: string;
        arguments: string;
    }>(), ids = new Set<string>();
    const validateCall = (item: any) => { if (!allowTools || !tools.has(item.name) || typeof item.call_id !== 'string' || !item.call_id || ids.has(item.call_id))
        fail('模型调用了未开放工具或重复 ID / Unapproved or repeated call'); const args=objectArguments(item.arguments),invalid=validateArguments?.(item.name,args);if(invalid)fail('工具参数不符合声明 Schema / Tool arguments do not match schema: '+item.name+'; '+invalid);ids.add(item.call_id); };
    return new Response(response.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, c) {
            total += chunk.byteLength;
            if (total > 8 * 1024 * 1024)
                fail('模型输出超过 8 MiB / Model stream size limit');
            buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
            if (buffer.length > 1024 * 1024)
                fail('模型流片段过大 / Model frame limit');
            let at: number;
            while ((at = buffer.indexOf('\n\n')) !== -1) {
                const block = buffer.slice(0, at);
                buffer = buffer.slice(at + 2);
                const data = block.split('\n').filter(s => s.startsWith('data:')).map(s => s.slice(5).trim()).join('\n');
                if (!data)
                    continue;
                if (data === '[DONE]') {
                    if (protocol === 'chat-completions') {
                        if (!finished || done)
                            fail('模型流终态无效 / Invalid DONE');
                        done = true;
                    }
                    continue;
                }
                if (done)
                    fail('终态之后出现模型数据 / Data after DONE');
                let e: any;
                try {
                    e = JSON.parse(data);
                }
                catch {
                    fail('模型流 JSON 无效 / Invalid SSE JSON');
                }
                if (e.error || ['error', 'response.failed', 'response.incomplete'].includes(e.type))
                    fail('模型响应失败或被截断 / Incomplete model response');
                if (protocol === 'responses') {
                    if (finished)
                        fail('重复终态或终态后数据 / Repeated terminal');
                    if (e.type === 'response.output_item.done') {
                        const item = e.item;
                        if (!item || typeof item.id !== 'string' || completedItems.has(item.id))
                            fail('输出项 ID 缺失或重复 / Invalid output item ID');
                        if (item.type === 'function_call') {
                            if (!allowTools || !tools.has(item.name))
                                fail('模型调用未开放工具 / Unapproved tool');
                            objectArguments(item.arguments);
                        }
                        if (['function_call', 'message'].includes(item.type))
                            completedItems.set(item.id, item);
                    }
                    if (e.type === 'response.completed') {
                        if (expectedModel && e.response?.model && e.response.model !== expectedModel)
                            fail('响应模型身份改变 / Response model changed');
                        if (e.response?.status && e.response.status !== 'completed')
                            fail('模型终态未完成 / Model is not completed');
                        const output = e.response?.output;
                        if (!Array.isArray(output))
                            fail('模型终态缺少输出 / Missing output');
                        const finalIds = new Set(output.map((item: any) => item.id));
                        for (const [id, item] of completedItems) {
                            const final = output.find((v: any) => v.id === id || item.type === 'function_call' && v.type === 'function_call' && v.call_id === item.call_id || item.type === 'message' && v.type === 'message' && v.role === item.role && isDeepStrictEqual(v.content, item.content));
                            if (!final || final.type !== item.type || item.type === 'function_call' && (final.name !== item.name || final.call_id !== item.call_id || !isDeepStrictEqual(objectArguments(final.arguments), objectArguments(item.arguments))) || item.type === 'message' && (final.role !== item.role || !isDeepStrictEqual(final.content, item.content)))
                                fail('最终输出与流式回执不一致 / Terminal output mismatch: ' + (!final ? 'missing item' : Object.keys(item).filter(k => !isDeepStrictEqual(item[k], final[k])).join(',')));
                        }
                        if (finalIds.size !== output.length)
                            fail('最终输出 ID 重复 / Duplicate terminal item');
                        let meaningful = false;
                        for (const item of output) {
                            if (item.type === 'function_call') {
                                validateCall(item);
                                meaningful = true;
                            }
                            else if (item.type === 'message') {
                                if (item.role !== 'assistant')
                                    fail('模型未返回 assistant / Missing assistant');
                                for (const part of item.content ?? [])
                                    if (part.type === 'output_text') {
                                        const value = checkText(part.text);
                                        if (value.trim())
                                            meaningful = true;
                                    }
                            }
                        }
                        if (!meaningful)
                            fail('模型返回空文本 / Empty assistant output');
                        usage = measuredUsage(e.response.usage, protocol);
                        finished = true;
                        terminal = block + '\n\n';
                        continue;
                    }
                    if (e.type === 'response.function_call_arguments.done' || e.type === 'response.output_item.done') {
                        toolTerminals += block + '\n\n';
                        continue;
                    }
                    if (e.type === 'response.output_text.delta') {
                        text += checkText(e.delta);
                        checkText(text);
                    }
                    c.enqueue(encoder.encode(block + '\n\n'));
                }
                else {
                    if (expectedModel && e.model && e.model !== expectedModel)
                        fail('响应模型身份改变 / Response model changed');
                    if (e.usage)
                        usage = measuredUsage(e.usage, protocol);
                    if (e.choices?.length > 1)
                        fail('只支持一个候选响应 / Multiple choices not supported');
                    const choice = e.choices?.[0];
                    if (!choice) {
                        if (e.usage)
                            terminal += block + '\n\n';
                        continue;
                    }
                    if (finished)
                        fail('模型结束后仍返回候选 / Choice after finish');
                    const delta = choice.delta ?? {};
                    if (delta.role && delta.role !== 'assistant')
                        fail('模型未返回 assistant / Missing assistant');
                    if (delta.content !== undefined && delta.content !== null) {
                        text += checkText(delta.content);
                        checkText(text);
                    }
                    for (const t of delta.tool_calls ?? []) {
                        if (!Number.isInteger(t.index) || t.index < 0 || t.index > 63)
                            fail('工具索引无效 / Invalid call index');
                        let call = calls.get(t.index);
                        if (!call) {
                            call = { id: t.id ?? '', name: t.function?.name ?? '', arguments: '' };
                            calls.set(t.index, call);
                        }
                        else {
                            if (t.id && t.id !== call.id || t.function?.name && t.function.name !== call.name)
                                fail('工具身份在流中改变 / Tool identity changed');
                        }
                        call.arguments += t.function?.arguments ?? '';
                        if (call.arguments.length > 65536)
                            fail('工具参数过大 / Tool argument size limit');
                    }
                    if (choice.finish_reason) {
                        if (!['stop', 'tool_calls'].includes(choice.finish_reason))
                            fail('模型输出被截断 / Model output truncated');
                        if (calls.size) {
                            if (choice.finish_reason !== 'tool_calls')
                                fail('工具调用终态不匹配 / Invalid tool terminal');
                            for (const call of calls.values())
                                validateCall({ name: call.name, call_id: call.id, arguments: call.arguments });
                        }
                        else if (choice.finish_reason === 'tool_calls' || !text.trim())
                            fail('模型返回空消息 / Empty assistant message');
                        finished = true;
                        terminal = block + '\n\n' + terminal;
                        continue;
                    }
                    c.enqueue(encoder.encode(block + '\n\n'));
                }
            }
        },
        flush(c) { buffer += decoder.decode(); if (buffer.trim() || !finished || protocol === 'chat-completions' && !done)
            fail('模型流缺少完整终态 / Incomplete stream terminal'); onUsage?.(usage); c.enqueue(encoder.encode(toolTerminals + terminal + (protocol === 'chat-completions' ? 'data: [DONE]\n\n' : ''))); },
    })), { status: response.status, headers: { 'Content-Type': 'text/event-stream' } });
}
