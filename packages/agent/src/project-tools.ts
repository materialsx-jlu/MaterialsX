import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, mkdir, lstat, open, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, join, dirname } from 'node:path';
import { createReadTool, createWriteTool, createEditTool, createBashTool, createLsTool } from '@earendil-works/pi-coding-agent';
import { readOwnedBytes } from '../../atomistic/src/artifact-io.js';
import { codexSandbox } from './codex-sandbox.js';
import type { HostTool } from './host-mcp.js';
import { AgentError } from '../../contracts/src/agent.js';
const secret = /(^|\/)(\.env(?:\.[^/]*)?|[^/]*\.env|[^/]*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|auth\.json|credentials\.json)$/i;
export const PROJECT_TOOL_PERMISSIONS = { read: ['read'], ls: ['read'], write: ['patch'], edit: ['read', 'patch'], bash: ['read', 'terminal', 'patch'], git_status: ['read', 'terminal'] } as const;
/** Reuse Pi's base tools with a project-only filesystem and an OS sandbox for shell execution. */
export async function projectTools(project: string, home: string): Promise<HostTool[]> {
    const root = await realpath(project);
    await mkdir(home, { recursive: true, mode: 0o700 });
    const scope = (path: string) => { const resolved = resolve(root, path), rel = relative(root, resolved); if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || secret.test(resolved))
        throw new AgentError('PERMISSION_DENIED', 'Project path is outside scope or contains credentials'); return resolved; };
    const owned = async (path: string) => { const candidate = scope(path); const actual = await realpath(candidate); scope(actual); return actual; };
    const writable = async (path: string) => {
        const candidate = scope(path);
        let parent = dirname(candidate);
        const parts: string[] = [];
        for (;;) {
            try {
                const actual = await realpath(parent);
                scope(actual);
                if (actual !== parent)
                    throw Error('PROJECT_WRITE_SYMLINK');
                break;
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
                parts.unshift(parent);
                parent = dirname(parent);
            }
        }
        for (const part of parts)
            await mkdir(part);
        try {
            if ((await lstat(candidate)).isSymbolicLink())
                throw Error('PROJECT_WRITE_SYMLINK');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
        }
        return candidate;
    };
    const read = async (path: string) => { const actual = await owned(path); const bytes = await readOwnedBytes(root, actual, null, 2 * 1024 * 1024); new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (bytes.includes(0))
        throw Error('TEXT_ONLY_TOOL'); return bytes; };
    const write = async (path: string, content: string) => { if (Buffer.byteLength(content) > 65536)
        throw Error('PROJECT_WRITE_SIZE_LIMIT'); const target = await writable(path), handle = await open(target, constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); try {
        if (!(await handle.stat()).isFile())
            throw Error('PROJECT_WRITE_NOT_FILE');
        await handle.truncate(0);
        await handle.writeFile(content);
    }
    finally {
        await handle.close();
    } };
    const definitions: any[] = [createReadTool(root, { operations: { readFile: read, access: async (path) => { await owned(path); }, detectImageMimeType: async () => null } }),
        createWriteTool(root, { operations: { mkdir: async (path) => { await writable(join(path, '.scope-check')); }, writeFile: write } }),
        createEditTool(root, { operations: { readFile: read, writeFile: write, access: async (path) => { await owned(path); } } }),
        createLsTool(root, { operations: { exists: async (path) => { try {
                    await owned(path);
                    return true;
                }
                catch {
                    return false;
                } }, stat: async (path) => stat(await owned(path)), readdir: async (path) => (await readdir(await owned(path))).filter(name => !secret.test(name)) } })];
    const shell = async (command: string, cwd: string, options: {
        onData(data: Buffer): void;
        signal?: AbortSignal;
        timeout?: number;
    }) => {
        if (process.platform !== 'darwin')
            throw new AgentError('UNAVAILABLE', 'Project shell isolation is verified on macOS only');
        const sandbox = await codexSandbox('/bin/bash', home, await owned(cwd));
        options.signal?.throwIfAborted();
        return await new Promise<{
            exitCode: number | null;
        }>((resolve, reject) => {
            const child = spawn(sandbox.command, [...sandbox.args.slice(0, -3), '/bin/bash', '--noprofile', '--norc', '-c', command], { cwd: root, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', TMPDIR: sandbox.temporary }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
            let bytes = 0, stopped = false;
            const stop = () => { stopped = true; try {
                process.kill(-child.pid!, 'SIGKILL');
            }
            catch { } };
            const timer = setTimeout(stop, Math.min((options.timeout ?? 60) * 1000, 120000));
            options.signal?.addEventListener('abort', stop, { once: true });
            const data = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024)
                stop();
            else
                options.onData(chunk); };
            child.stdout.on('data', data);
            child.stderr.on('data', data);
            child.once('error', reject);
            child.once('close', code => { clearTimeout(timer); options.signal?.removeEventListener('abort', stop); if (stopped)
                reject(new AgentError(options.signal?.aborted ? 'CANCELLED' : 'BUDGET_EXCEEDED', 'Project shell stopped'));
            else
                resolve({ exitCode: code }); });
        });
    };
    if (process.platform === 'darwin')
        definitions.push(createBashTool(root, { operations: { exec: shell }, exposeSessionEnvironment: false }));
    const tools: HostTool[] = definitions.map(t => ({ name: t.name, description: t.description, parameters: t.parameters, permissions: PROJECT_TOOL_PERMISSIONS[t.name as keyof typeof PROJECT_TOOL_PERMISSIONS], execute: async (args, signal) => {
            signal.throwIfAborted();
            const result = await t.execute(randomUUID(), args, signal);
            if (result.isError)
                throw new Error(result.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n'));
            if (result.content.some((p: any) => p.type !== 'text'))
                throw Error('TEXT_ONLY_TOOL');
            return { content: result.content };
        } }));
    if (process.platform === 'darwin')
        tools.push({ name: 'git_status', description: 'Read the current project Git status. No commit, reset, push or network access.', parameters: { type: 'object', properties: {}, additionalProperties: false }, permissions: ['read', 'terminal'], execute: async (_args, signal) => { let text = ''; const result = await shell('git status --porcelain=v1', root, { signal, onData: b => { text += b.toString(); } }); if (result.exitCode !== 0)
                throw Error('PROJECT_GIT_FAILED'); return { content: [{ type: 'text', text }] }; } });
    return tools;
}
