import { ipcMain, dialog } from 'electron';
import { readOwnedBytes } from '../../../packages/atomistic/src/artifact-io.js';
import { dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { mcpConfigurationSchema } from '../../../packages/contracts/src/agent-configuration.js';
import { agentMatrix } from '../../../packages/agent/src/capability-matrix.js';
import { userSkillDraftSchema } from '../../../packages/contracts/src/potential-hub.js';
import type { WorkspaceStore } from './store.js';
import type { ResearchService } from './research-service.js';
import type { UserSkillService } from '../../../packages/atomistic/src/user-skills.js';
export function registerAgentConfiguration(store: WorkspaceStore, research: ResearchService, userSkills: UserSkillService, idle: () => boolean) {
    let changing = false;
    ipcMain.handle('agent:matrix', () => agentMatrix(store.getSettings(), store.compatibilities(), process.platform + '-' + process.arch));
    ipcMain.handle('mcp:configuration', () => store.mcpConfiguration());
    ipcMain.handle('mcp:choose-directory', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0] ?? null; });
    ipcMain.handle('mcp:save', async (_e, input: unknown, expected: unknown) => {
        if (changing || !idle())
            throw Error('MCP_CHANGE_REQUIRES_IDLE_TASKS');
        const value = mcpConfigurationSchema.parse(input);
        if (!Number.isInteger(expected) || store.mcpConfiguration().revision !== expected || value.revision !== Number(expected) + 1)
            throw Error('MCP_REVISION_CONFLICT');
        changing = true;
        try {
            await research.configure(value);
            return store.saveMcpConfiguration(value, Number(expected));
        }
        finally {
            changing = false;
        }
    });
    ipcMain.handle('skills:import', async () => {
        if (!idle())
            throw Error('SKILL_CHANGE_REQUIRES_IDLE_TASKS');
        const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'MaterialsX bilingual Skill draft', extensions: ['json'] }] });
        if (selected.canceled || !selected.filePaths[0])
            return null;
        const path = selected.filePaths[0], bytes = await readOwnedBytes(dirname(path), path, null, 65536), draft = userSkillDraftSchema.parse(JSON.parse(bytes.toString('utf8')));
        userSkills.preview(draft);
        return { draft, sha256: createHash('sha256').update(bytes).digest('hex'), source: basename(path) };
    });
}
