import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspectLocalPixels } from './local-vision.js';
import { harness } from '../../agent/src/task-supervisor.fixture.js';
import { localModelConnection } from '../../agent/src/local-model-transport.js';
const base = { id: 'model-' + 'a'.repeat(32), source: 'local' as const, modelId: 'vision-wire-fixture', endpoint: 'http://127.0.0.1:1234/v1', protocol: 'chat-completions' as const, contextWindow: 32768, maxOutputTokens: 1024, revision: 'fixture' };
test('vision requires actual capability metadata; text models are denied before any request', async () => {
    const h = harness();
    h.control.acceptPlan(h.plan);
    await assert.rejects(inspectLocalPixels(base, Buffer.from('fixture'), 'Read visible features', new AbortController().signal, h.control), /VISION_UNSUPPORTED/);
    assert.equal(h.control.snapshot().requests.length, 0);
    const request: typeof fetch = async (url) => new Response(JSON.stringify(String(url).includes('/api/v1/models') ? { models: [{ key: 'vision-wire-fixture', loaded_instances: [{ id: 'vision-wire-fixture', config: { context_length: 32768 } }], capabilities: { vision: true } }] } : String(url).includes('/api/v0/models') ? { data: [{ id: 'vision-wire-fixture', state: 'loaded', max_context_length: 32768 }] } : { data: [{ id: 'vision-wire-fixture' }] }), { headers: { 'content-type': 'application/json' } });
    const connection = await localModelConnection(base.endpoint, base.modelId, request, 'chat-completions');
    assert.equal(connection.vision, true);
});
test('real SDK sends image bytes through original bounded local streaming transport and records genuine request usage; fixture is not visual qualification', async () => {
    let body: any;
    const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req)
            chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(req.headers.authorization, undefined);
        assert.equal(req.url, '/v1/chat/completions');
        const events = [{ id: 'fixture', object: 'chat.completion.chunk', model: base.modelId, choices: [{ index: 0, delta: { role: 'assistant', content: 'Controlled transport fixture; no image semantics qualified.' }, finish_reason: null }] }, { id: 'fixture', object: 'chat.completion.chunk', model: base.modelId, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }];
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n');
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const connection = { ...base, endpoint: 'http://127.0.0.1:' + (server.address() as any).port + '/v1', vision: true }, h = harness();
    h.control.acceptPlan(h.plan);
    const bytes = Buffer.from([255, 216, 255, 217]);
    try {
        const text = await inspectLocalPixels(connection, bytes, 'Describe visible shapes; do not infer measurements.', new AbortController().signal, h.control);
        assert.match(text, /transport fixture/);
        const user = body.messages.find((m: any) => m.role === 'user'), image = user.content.find((c: any) => c.type === 'image_url');
        assert.equal(image.image_url.url, 'data:image/jpeg;base64,' + bytes.toString('base64'));
        assert.equal(body.stream, true);
        assert.equal(body.tool_choice, 'none');
        assert.equal(body.max_tokens ?? body.max_completion_tokens, 1024);
        assert.equal(h.control.snapshot().requests.length, 1);
        assert.equal(h.control.snapshot().requests[0]?.state, 'completed');
        assert(h.control.snapshot().requests[0]?.usage);
    }
    finally {
        await new Promise<void>(r => server.close(() => r()));
    }
});
