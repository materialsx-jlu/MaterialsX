import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectTools } from './project-tools.js';
test('SDK project tools read, write, edit and list actual files while denying outside and credential paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mx-project-tools-')), project = join(dir, 'project');
    await mkdir(project);
    const tools = await projectTools(project, join(dir, 'home'));
    const run = (name: string, args: unknown) => tools.find(t => t.name === name)!.execute(args, new AbortController().signal);
    try {
        await writeFile(join(dir, 'outside.txt'), 'private');
        await writeFile(join(project, '.env'), 'private');
        await symlink(join(dir, 'outside.txt'), join(project, 'escape.txt'));
        await run('write', { path: 'notes/硅.txt', content: 'before\n' });
        assert.match(JSON.stringify(await run('read', { path: 'notes/硅.txt' })), /before/);
        await run('edit', { path: 'notes/硅.txt', edits: [{ oldText: 'before', newText: 'after' }] });
        assert.equal(await readFile(join(project, 'notes/硅.txt'), 'utf8'), 'after\n');
        assert.doesNotMatch(JSON.stringify(await run('ls', { path: '.' })), /\.env/);
        for (const path of ['../outside.txt', '.env', 'escape.txt'])
            await assert.rejects(run('read', { path }));
        for (const path of ['../outside.txt', '.env', 'escape.txt'])
            await assert.rejects(run('write', { path, content: 'bad' }));
        await assert.rejects(run('write', { path: 'huge', content: 'x'.repeat(65537) }));
        assert.equal(await readFile(join(dir, 'outside.txt'), 'utf8'), 'private');
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('macOS SDK shell uses OS isolation, detects failure and aborts the real child process', { skip: process.platform !== 'darwin' }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mx-project-shell-')), project = join(dir, 'project');
    await mkdir(project);
    const tools = await projectTools(project, join(dir, 'home'));
    const bash = tools.find(t => t.name === 'bash')!;
    try {
        await writeFile(join(dir, 'private.txt'), 'private');
        await writeFile(join(project, '.env'), 'private');
        const result = await bash.execute({ command: 'echo verified > output.txt; cat output.txt' }, new AbortController().signal);
        assert.match(JSON.stringify(result), /verified/);
        assert.equal(await readFile(join(project, 'output.txt'), 'utf8'), 'verified\n');
        for (const command of [`cat '${join(dir, 'private.txt')}'`, 'cat .env', 'curl --connect-timeout 1 http://127.0.0.1:1234/v1/models', 'exit 7'])
            await assert.rejects(bash.execute({ command }, new AbortController().signal));
        const controller = new AbortController(), pending = bash.execute({ command: 'sleep 30' }, controller.signal);
        setTimeout(() => controller.abort(), 100);
        await assert.rejects(pending);
        await assert.rejects(tools.find(t => t.name === 'git_status')!.execute({}, new AbortController().signal));
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
