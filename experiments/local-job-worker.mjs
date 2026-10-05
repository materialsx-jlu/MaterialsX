/** Detached local provider. It writes owned receipts, never an Agent plan or billing record. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, lstatSync, fsyncSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
const packetPath = process.argv[2], raw = readFileSync(packetPath), packet = JSON.parse(raw), root = dirname(packetPath);
if (!Number.isSafeInteger(packet.elapsedUntil) || packet.elapsedUntil <= Date.now() || packet.version !== 'ua11-local-v1' || !Number.isInteger(packet.maxComputeSeconds) || packet.maxComputeSeconds < 1 || packet.maxComputeSeconds > 604800 || packet.command !== '/usr/bin/sandbox-exec')
    throw Error('WORKER_PACKET_INVALID');
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), now = Date.now();
if (sha(readFileSync(process.argv[1])) !== packet.providerSha256)
    throw Error('WORKER_CODE_CHANGED');
const record = { version: 'ua11-local-v1', jobId: packet.jobId, manifestSha256: sha(raw), nonce: packet.nonce, workerPid: process.pid, pid: null, status: 'queued', createdAt: now, startedAt: null, finishedAt: null, exitCode: null, error: null, outputs: [], stdoutBytes: 0, stderrBytes: 0, environment: { node: process.versions.node, platform: process.platform, arch: process.arch } };
function publish() { const tmp = join(root, 'receipt.json.tmp'), fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600); try {
    writeFileSync(fd, JSON.stringify(record));
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} renameSync(tmp, join(root, 'receipt.json')); }
publish();
let child, stopReason = null, settled = false, killTimer, timeout, poll;
const logs = { stdout: openSync(join(root, 'stdout.txt'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600), stderr: openSync(join(root, 'stderr.txt'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600) };
function stop(reason) {
    if (stopReason || settled)
        return;
    stopReason = reason;
    // Only this worker's own spawned process group can be signalled; never a recovered or user-supplied PID.
    try {
        process.kill(-child.pid, 'SIGTERM');
    }
    catch { }
    killTimer = setTimeout(() => { try {
        process.kill(-child.pid, 'SIGKILL');
    }
    catch { } }, 2000);
}
function finish(code, error = null) {
    if (settled)
        return;
    settled = true;
    clearTimeout(timeout);
    clearInterval(poll);
    clearTimeout(killTimer);
    for (const fd of Object.values(logs))
        closeSync(fd);
    try {
        if (child?.pid)
            process.kill(-child.pid, 'SIGKILL');
    }
    catch { }
    record.exitCode = code;
    record.finishedAt = Date.now();
    record.status = stopReason === 'USER_CANCELLED' ? 'cancelled' : stopReason || error || code !== 0 ? 'failed' : 'completed';
    record.error = stopReason ?? error ?? (code === 0 ? null : 'PROCESS_EXIT_' + String(code));
    if (record.status === 'completed')
        try {
            let total = 0;
            for (const name of packet.outputs) {
                if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name))
                    throw Error('OUTPUT_NAME_INVALID');
                const path = join(packet.workspace, name), s = lstatSync(path);
                if (s.isSymbolicLink() || !s.isFile() || s.size > 8 * 1048576)
                    throw Error('OUTPUT_MISSING_OR_UNSAFE');
                total += s.size;
                if (total > packet.maxOutputMiB * 1048576)
                    throw Error('OUTPUT_SIZE_LIMIT');
                const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
                let bytes;
                try {
                    bytes = readFileSync(fd);
                }
                finally {
                    closeSync(fd);
                }
                record.outputs.push({ name, sha256: sha(bytes), bytes: bytes.length });
            }
        }
        catch (e) {
            record.status = 'failed';
            record.error = String(e).slice(0, 2000);
            record.outputs = [];
        }
    publish();
}
child = spawn(packet.command, packet.args, { cwd: packet.workspace, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: packet.environment });
child.once('spawn', () => { record.pid = child.pid; record.status = 'running'; record.startedAt = Date.now(); publish(); });
for (const name of ['stdout', 'stderr'])
    child[name].on('data', bytes => { record[name + 'Bytes'] += bytes.length; if (record[name + 'Bytes'] <= 512 * 1024)
        writeFileSync(logs[name], bytes);
    else
        stop('LOG_SIZE_LIMIT'); });
child.once('error', e => finish(null, 'SPAWN_FAILED: ' + e.message));
child.once('close', code => finish(code));
timeout = setTimeout(() => stop('COMPUTE_TIME_LIMIT'), packet.maxComputeSeconds * 1000);
poll = setInterval(() => { if (Date.now() >= packet.elapsedUntil) stop('ELAPSED_TIME_LIMIT'); try {
    const p = JSON.parse(readFileSync(join(root, 'cancel.json'), 'utf8'));
    if (p.jobId === packet.jobId && p.nonce === packet.nonce)
        stop('USER_CANCELLED');
}
catch { } }, 200);
