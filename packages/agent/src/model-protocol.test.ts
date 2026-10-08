import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardModelStream, measuredUsage } from './model-stream.js';
import { validateCallPairs, responsesToChat } from './model-request.js';
import { chatAsResponses } from './chat-responses.js';
const sse = (events: unknown[], done = true) => { const bytes = Buffer.from(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + (done ? 'data: [DONE]\n\n' : '')); return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3)
        c.enqueue(bytes.subarray(i, i + 3)); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } }); };
const chunk = (delta: unknown, finish_reason: string | null = null) => ({ model: 'fixture', choices: [{ index: 0, delta, finish_reason }] });
const call = { index: 0, id: 'actual-call', type: 'function', function: { name: 'read', arguments: '{"path":"硅.txt"}' } };
const usage = { prompt_tokens: 21, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 3 } };
test('CC fragments preserve UTF-8, real tool identity and usage through the native wire bridge', async () => {
    let measured: unknown = null;
    const stream = guardModelStream(sse([chunk({ role: 'assistant', reasoning_content: 'Use actual evidence' }), chunk({ tool_calls: [{ ...call, function: { ...call.function, arguments: '{"path":' } }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: '"硅.txt"}' } }] }), chunk({}, 'tool_calls'), { choices: [], usage }]), 'chat-completions', new Set(['read']), true, v => measured = v, 'fixture');
    const data = await chatAsResponses(stream).text();
    assert.match(data, /硅.txt/);
    assert.match(data, /actual-call/);
    assert.match(data, /Use actual evidence/);
    assert.deepEqual(measured, usage);
    const completed = data.split('\n\n').filter(Boolean).map(s => JSON.parse(s.split('data: ')[1]!)).find(e => e.type === 'response.completed');
    assert.equal(completed.response.usage.input_tokens, 21);
    assert.equal(completed.response.usage.output_tokens_details.reasoning_tokens, 3);
});
test('truncated, malformed, empty, unapproved, swapped and repeated tool streams cannot complete', async () => {
    const variants = [
        [chunk({ content: 'partial' }), chunk({}, 'length')],
        [chunk({}), chunk({}, 'stop')],
        [chunk({ tool_calls: [{ ...call, function: { ...call.function, arguments: '[]' } }] }), chunk({}, 'tool_calls')],
        [chunk({ tool_calls: [call] }), chunk({}, 'stop')],
        [chunk({ tool_calls: [call] }), chunk({ tool_calls: [{ index: 0, id: 'swap' }] }), chunk({}, 'tool_calls')],
        [chunk({ tool_calls: [call, { ...call, index: 1 }] }), chunk({}, 'tool_calls')],
        [chunk({ role: 'user', content: 'text' }), chunk({}, 'stop')],
        [chunk({ content: '<|channel|>analysis' }), chunk({}, 'stop')],
        [chunk({ content: 'text' }), chunk({}, 'stop'), chunk({ content: 'after' })],
        [chunk({ content: 'text' }), chunk({}, 'stop'), { choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 3 } } }],
    ];
    for (const events of variants)
        await assert.rejects(guardModelStream(sse(events), 'chat-completions', new Set(['read']), true).text());
    await assert.rejects(guardModelStream(sse([chunk({ tool_calls: [call] }), chunk({}, 'tool_calls')]), 'chat-completions', new Set(), false).text());
    await assert.rejects(guardModelStream(sse([chunk({ content: 'text' }), chunk({}, 'stop')], false), 'chat-completions', new Set(), false).text());
});
test('Responses terminal cannot replace a streamed tool receipt or declare a foreign model', async () => {
    const item = { id: 'item', type: 'function_call', name: 'read', call_id: 'actual', arguments: '{"path":"a"}' };
    const terminal = (output: unknown[], model = 'fixture') => ({ type: 'response.completed', response: { status: 'completed', model, output } });
    for (const events of [
        [{ type: 'response.output_item.done', item }, terminal([{ ...item, arguments: '{"path":"b"}' }])],
        [{ type: 'response.output_item.done', item }, terminal([])],
        [terminal([item], 'foreign')],
        [terminal([item, item])],
    ])
        await assert.rejects(guardModelStream(sse(events, false), 'responses', new Set(['read']), true, undefined, 'fixture').text());
});
test('history pairing rejects orphan, duplicate and unfinished calls; image conversion is explicit', () => {
    const body = { input: [{ type: 'function_call', call_id: 'actual', name: 'read', arguments: '{}' }, { type: 'function_call_output', call_id: 'actual', output: 'evidence' }] };
    validateCallPairs(body, 'responses');
    const cc = responsesToChat({ ...body, tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }] });
    validateCallPairs(cc, 'chat-completions');
    assert.equal(cc.messages[1].tool_call_id, 'actual');
    for (const input of [body.input.slice(0, 1), body.input.slice(1), [...body.input, ...body.input]])
        assert.throws(() => validateCallPairs({ input }, 'responses'));
    assert.throws(() => responsesToChat({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'secret' }] }] }), /图片/);
    assert.equal(measuredUsage(null, 'responses'), null);
    assert.throws(() => measuredUsage({ input_tokens: 1, output_tokens: -1 }, 'responses'));
});
test('proxy output item IDs and JSON key order may change while real call identity and arguments stay fixed', async () => {
    const streamed = { id: 'proxy-item', type: 'function_call', name: 'read', call_id: 'actual', arguments: '{"path":"a","offset":1}' };
    const final = { ...streamed, id: 'terminal-item', arguments: '{"offset":1,"path":"a"}' };
    const completed = (item: unknown) => ({ type: 'response.completed', response: { status: 'completed', output: [item] } });
    const valid = [{ type: 'response.output_item.done', item: { id: 'reasoning', type: 'reasoning', summary: [] } }, { type: 'response.output_item.done', item: streamed }, completed(final)];
    assert.match(await guardModelStream(sse(valid, false), 'responses', new Set(['read']), true).text(), /response.completed/);
    await assert.rejects(guardModelStream(sse([{ type: 'response.output_item.done', item: streamed }, completed({ ...final, call_id: 'swapped' })], false), 'responses', new Set(['read']), true).text());
});
