import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentMatrix } from './capability-matrix.js';
import { profileFor } from './local-model-transport.js';
import { mcpConfigurationSchema } from '../../contracts/src/agent-configuration.js';
const settings = { mode: 'local' as const, modelId: 'fixture', localEndpoint: 'http://127.0.0.1:1234/v1', localProtocol: 'responses' as const };
const connection = { id: ('model-' + 'a'.repeat(32)), source: 'local' as const, endpoint: settings.localEndpoint, modelId: settings.modelId, protocol: 'responses' as const, contextWindow: 32768, maxOutputTokens: 4096, revision: 'fixture' };
test('matrix has four scoped combinations, expired evidence and changed budgets require another test', () => {
    const profile = profileFor(connection, 'codex', 'limited', { zh: 'Fixture protocol only', en: 'Fixture protocol only' }, ['stream', 'tool-call']);
    profile.platform = 'darwin-arm64';
    const matrix = agentMatrix(settings, [profile], 'darwin-arm64');
    assert.equal(matrix.rows.length, 4);
    assert.equal(matrix.rows.find(r => r.source === 'local' && r.engine === 'codex')?.status, 'limited');
    assert(matrix.rows.every(r => r.vision === 'unverified'));
    for (const props of [{ ...profile, testedAt: '2020-01-01T00:00:00Z' }, { ...profile, engineVersion: 'old-version' }, { ...profile, connection: { ...connection, modelId: 'other' } }])
        assert.equal(agentMatrix(settings, [props], 'darwin-arm64').rows.find(r => r.source === 'local' && r.engine === 'codex')?.status, 'unverified');
    assert.equal(agentMatrix({ ...settings, localMaxOutputTokens: 3200 }, [profile], 'darwin-arm64').rows.find(r => r.source === 'local' && r.engine === 'codex')?.status, 'unverified');
    assert(agentMatrix(settings, [profile], 'win32-x64').rows.filter(r => r.engine === 'codex').every(r => r.status === 'unsupported'));
});
test('MCP configuration never accepts remote origin, credential URLs or arbitrary server identifiers', () => {
    const valid = { id: 'moos-local', enabled: false, directory: null, origin: 'http://127.0.0.1:8080', revision: 2 };
    assert(mcpConfigurationSchema.safeParse(valid).success);
    for (const origin of ['https://example.com', 'http://user:secret@localhost:8080', 'http://localhost:8080/path', 'http://localhost:8080?key=x'])
        assert(!mcpConfigurationSchema.safeParse({ ...valid, origin }).success);
    assert(!mcpConfigurationSchema.safeParse({ ...valid, id: 'arbitrary-script' }).success);
});
