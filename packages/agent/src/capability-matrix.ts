import type { AgentMatrix, AgentMatrixRow } from '../../contracts/src/agent-configuration.js';
import type { CompatibilityProfile } from '../../contracts/src/engine-selection.js';
import type { ModelSettings } from '../../contracts/src/desktop.js';
import { CODEX_VERSION, PI_VERSION, LOCAL_VALIDATION_VERSION } from './local-model-transport.js';
/** Evidence is scoped to model revision, engine, protocol, runtime and OS. No default 'ready' claims. */
export function agentMatrix(settings: ModelSettings, profiles: CompatibilityProfile[], platform: string): AgentMatrix {
    const rows: AgentMatrixRow[] = [];
    for (const source of ['local', 'platform'] as const)
        for (const engine of ['pi', 'codex'] as const) {
            const protocol = source === 'local' ? (settings.localProtocol ?? (engine === 'pi' ? 'chat-completions' : 'responses')) : 'responses';
            const profile = profiles.filter(p => p.connection.source === source && p.engine === engine && p.platform === platform && p.engineVersion === (engine === 'pi' ? PI_VERSION : CODEX_VERSION) && p.connection.protocol === protocol && p.validationVersion === LOCAL_VALIDATION_VERSION &&
                (source !== 'local' || p.connection.endpoint === settings.localEndpoint.replace(/\/$/, '') && p.connection.modelId === settings.modelId)).sort((a, b) => (b.testedAt ?? '').localeCompare(a.testedAt ?? '')).at(0);
            const stale = !!profile && (!profile.testedAt || Date.now() - Date.parse(profile.testedAt) > 86400000 || source === 'local' && (settings.localContextBudget !== undefined && profile.connection.contextWindow !== settings.localContextBudget || settings.localMaxOutputTokens !== undefined && profile.connection.maxOutputTokens !== settings.localMaxOutputTokens));
            const unsupported = engine === 'codex' && !platform.startsWith('darwin-');
            rows.push({ source, engine, modelId: profile?.connection.modelId ?? (source === 'local' && settings.mode === 'local' ? settings.modelId : null), protocol, status: unsupported ? 'unsupported' : stale ? 'unverified' : profile?.status ?? 'unverified',
                reason: unsupported ? { zh: 'Codex 项目隔离尚未验收此平台', en: 'Codex project isolation is not verified on this OS' } : stale ? { zh: '旧测试记录或预算已改变；请重新检查当前组合', en: 'Previous test expired or budget changed; check this combination again' } : profile?.reason ?? { zh: '尚无当前组合的实测记录；不会自动切换模型', en: 'No current qualification evidence; no automatic model fallback' },
                contextWindow: profile?.connection.contextWindow ?? null, maxOutputTokens: profile?.connection.maxOutputTokens ?? null, testedAt: profile?.testedAt ?? null, checks: profile?.checks ?? [], vision: 'unverified', reasoning: 'unverified', sandbox: unsupported ? 'unverified' : engine === 'codex' ? 'macos-project' : source === 'platform' && settings.cloudWorkspaceTools && platform.startsWith('darwin-') ? 'macos-project' : 'unverified' });
        }
    return { schemaVersion: 'ua5-capability-matrix-v1', platform, versions: { pi: PI_VERSION, codex: CODEX_VERSION, mcp: '1.31.0' }, rows, licenses: [{ name: '@earendil-works/pi-coding-agent', license: 'MIT', scope: 'Bundled SDK and base tools' }, { name: '@openai/codex', license: 'Apache-2.0', scope: 'Independent MaterialsX App Server runtime' }, { name: '@modelcontextprotocol/sdk', license: 'MIT', scope: 'Host and MOOS MCP transport' }] };
}
