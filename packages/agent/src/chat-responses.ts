import { randomUUID } from 'node:crypto';
/** A wire-only bridge for Codex's Responses runtime on a verified Chat Completions endpoint. */
export function chatAsResponses(response: Response): Response {
    const encoder = new TextEncoder(), decoder = new TextDecoder(), id = 'resp_' + randomUUID(), messageId = 'msg_' + randomUUID();
    const calls = new Map<number, any>();
    let buffer = '', text = '', reasoning = '', started = false, textAdded = false, usage: any;
    const stream = response.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, c) {
            const send = (type: string, fields: any = {}) => c.enqueue(encoder.encode('data: ' + JSON.stringify({ type, ...fields }) + '\n\n'));
            if (!started) {
                started = true;
                send('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
            }
            buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
            let at: number;
            while ((at = buffer.indexOf('\n\n')) !== -1) {
                const block = buffer.slice(0, at);
                buffer = buffer.slice(at + 2);
                const data = block.split('\n').filter(s => s.startsWith('data:')).map(s => s.slice(5).trim()).join('\n');
                if (!data || data === '[DONE]')
                    continue;
                const e = JSON.parse(data);
                if (e.usage)
                    usage = e.usage;
                const delta = e.choices?.[0]?.delta ?? {};
                if (delta.reasoning_content || delta.reasoning)
                    reasoning += delta.reasoning_content ?? delta.reasoning;
                if (typeof delta.content === 'string' && delta.content) {
                    if (!textAdded) {
                        textAdded = true;
                        send('response.output_item.added', { output_index: 0, item: { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
                        send('response.content_part.added', { item_id: messageId, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
                    }
                    text += delta.content;
                    send('response.output_text.delta', { item_id: messageId, output_index: 0, content_index: 0, delta: delta.content });
                }
                for (const t of delta.tool_calls ?? []) {
                    let call = calls.get(t.index);
                    if (!call) {
                        call = { id: 'fc_' + randomUUID(), type: 'function_call', name: t.function?.name, call_id: t.id, arguments: '' };
                        calls.set(t.index, call);
                        send('response.output_item.added', { output_index: t.index + 1, item: { ...call, status: 'in_progress' } });
                    }
                    if (t.function?.arguments) {
                        call.arguments += t.function.arguments;
                        send('response.function_call_arguments.delta', { item_id: call.id, output_index: t.index + 1, delta: t.function.arguments });
                    }
                }
            }
        },
        flush(c) {
            const send = (type: string, fields: any = {}) => c.enqueue(encoder.encode('data: ' + JSON.stringify({ type, ...fields }) + '\n\n'));
            const output: any[] = [];
            if (reasoning)
                output.push({ id: 'rs_' + randomUUID(), type: 'reasoning', summary: [{ type: 'summary_text', text: reasoning }] });
            if (textAdded) {
                const item = { id: messageId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
                send('response.output_text.done', { item_id: messageId, output_index: 0, content_index: 0, text });
                send('response.content_part.done', { item_id: messageId, output_index: 0, content_index: 0, part: item.content[0] });
                send('response.output_item.done', { output_index: 0, item });
                output.push(item);
            }
            for (const [index, call] of calls) {
                send('response.function_call_arguments.done', { item_id: call.id, output_index: index + 1, arguments: call.arguments });
                send('response.output_item.done', { output_index: index + 1, item: { ...call, status: 'completed' } });
                output.push({ ...call, status: 'completed' });
            }
            send('response.completed', { response: { id, object: 'response', status: 'completed', output, ...(usage ? { usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0 }, output_tokens_details: { reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0 } } } : {}) } });
        },
    }));
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}
