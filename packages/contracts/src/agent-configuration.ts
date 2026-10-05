import { z } from 'zod';
export const mcpConfigurationSchema = z.strictObject({ id: z.literal('moos-local'), enabled: z.boolean(), directory: z.string().min(1).max(2048).nullable(), origin: z.url(), revision: z.number().int().positive() }).superRefine((v, c) => { const u = new URL(v.origin); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.protocol !== 'http:' || u.username || u.password || u.search || u.hash || u.pathname !== '/')
    c.addIssue({ code: 'custom', message: 'MOOS supports credential-free loopback HTTP only' }); });
export type McpConfiguration = z.infer<typeof mcpConfigurationSchema>;
export interface AgentMatrixRow {
    source: 'local' | 'platform';
    engine: 'pi' | 'codex';
    modelId: string | null;
    protocol: string | null;
    status: 'available' | 'limited' | 'unsupported' | 'unverified';
    reason: {
        zh: string;
        en: string;
    };
    contextWindow: number | null;
    maxOutputTokens: number | null;
    testedAt: string | null;
    checks: string[];
    vision: 'unverified' | 'unsupported';
    reasoning: 'unverified' | 'observed';
    sandbox: 'macos-project' | 'pi-session' | 'unverified';
}
export interface AgentMatrix {
    schemaVersion: 'ua5-capability-matrix-v1';
    platform: string;
    versions: {
        pi: string;
        codex: string;
        mcp: string;
    };
    rows: AgentMatrixRow[];
    licenses: Array<{
        name: string;
        license: string;
        scope: string;
    }>;
}
export interface AgentConfigurationAPI {
    getMcpConfiguration(): Promise<McpConfiguration>;
    chooseMcpDirectory(): Promise<string | null>;
    saveMcpConfiguration(value: McpConfiguration, expectedRevision: number): Promise<McpConfiguration>;
    getAgentMatrix(): Promise<AgentMatrix>;
    importUserSkill(): Promise<{
        draft: import('zod').infer<typeof import('./potential-hub.js').userSkillDraftSchema>;
        sha256: string;
        source: string;
    } | null>;
}
