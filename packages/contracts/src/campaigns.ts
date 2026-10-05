import { z } from 'zod';
const sha = z.string().regex(/^[a-f0-9]{64}$/), text = z.string().min(1).max(2000);
export const jobFile = z.strictObject({ path: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/).refine(p => !p.split('/').includes('..')), sha256: sha, bytes: z.number().int().nonnegative().max(8 * 1024 * 1024) });
export const longJobConfigInput = z.strictObject({ label: z.string().min(1).max(200), script: z.string().min(1).max(180), inputs: z.array(z.string().min(1).max(180)).max(8),
    outputs: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/)).min(1).max(6), args: z.array(z.string().max(1000)).max(8),
    maxComputeSeconds: z.number().int().min(1).max(7 * 86400), maxElapsedSeconds: z.number().int().min(1).max(7 * 86400), heapMiB: z.number().int().min(64).max(4096), maxOutputMiB: z.number().int().min(1).max(16),
    detachApproved: z.literal(true), pauseModelWhileComputing: z.literal(true) }).refine(q => q.maxComputeSeconds <= q.maxElapsedSeconds, 'Compute limit exceeds total elapsed limit');
export const longJobConfig = z.strictObject({ id: z.uuid(), projectId: z.uuid(), createdAt: z.iso.datetime(), input: longJobConfigInput, files: z.array(jobFile).min(1).max(9), sha256: sha });
export type LongJobConfig = z.infer<typeof longJobConfig>;
export const longJobStatus = z.enum(['prepared', 'queued', 'running', 'completed', 'failed', 'cancelled', 'unknown']);
export const workerReceipt = z.strictObject({ version: z.literal('ua11-local-v1'), jobId: z.uuid(), manifestSha256: sha, nonce: sha, workerPid: z.number().int().positive(), pid: z.number().int().positive().nullable(),
    status: longJobStatus, createdAt: z.number().int().positive(), startedAt: z.number().int().positive().nullable(), finishedAt: z.number().int().positive().nullable(), exitCode: z.number().int().nullable(), error: z.string().max(2000).nullable(),
    outputs: z.array(z.strictObject({ name: text, sha256: sha, bytes: z.number().int().nonnegative() })).max(6), stdoutBytes: z.number().int().nonnegative(), stderrBytes: z.number().int().nonnegative(), environment: z.strictObject({ node: text, platform: text, arch: text }) });
export type WorkerReceipt = z.infer<typeof workerReceipt>;
export const longJobSchema = z.strictObject({ id: z.uuid(), projectId: z.uuid(), taskId: z.uuid(), stepId: text, planRevision: z.number().int().positive(), configurationId: z.uuid(), configurationSha256: sha,
    provider: z.literal('local-node'), createdAt: z.iso.datetime(), elapsedUntil: z.number().int().positive(), status: longJobStatus, manifestSha256: sha, nonce: sha,
    worker: workerReceipt.nullable(), artifacts: z.array(z.strictObject({ path: text, sha256: sha, bytes: z.number().int().nonnegative() })).max(10), error: z.string().max(2000).nullable(),
    scientificStatus: z.literal('needs_review'), cost: z.strictObject({ currency: z.literal('CNY'), platformCharged: z.literal('0'), externalActual: z.null(), basis: z.literal('offline-local-compute') }) });
export type LongJob = z.infer<typeof longJobSchema>;
export const campaignSchema = z.strictObject({ id: z.uuid(), projectId: z.uuid(), taskId: z.uuid(), createdAt: z.iso.datetime(), elapsedUntil: z.number().int().positive(), jobIds: z.array(z.uuid()).max(32) });
export type ResearchCampaign = z.infer<typeof campaignSchema>;
export const campaignToolInput = z.strictObject({ action: z.enum(['inputs', 'submit', 'status', 'cancel']), configurationId: z.uuid().optional(), jobId: z.uuid().optional(), reason: text.optional() });
export interface CampaignOverview {
    configurations: LongJobConfig[];
    campaigns: ResearchCampaign[];
    jobs: LongJob[];
    timings: {
        modelMs: number;
        queueMs: number;
        downloadMs: number;
        computeMs: number;
        waitingMs: number;
    };
    providerAvailable: boolean;
}
export interface CampaignAPI {
    getCampaigns(projectId: string): Promise<CampaignOverview>;
    configureLongJob(projectId: string, input: z.infer<typeof longJobConfigInput>): Promise<LongJobConfig>;
    chooseLongJobFile(projectId: string): Promise<string | null>;
    installCampaignExample(projectId: string): Promise<LongJobConfig>;
    queryLongJob(projectId: string, jobId: string): Promise<LongJob>;
    cancelLongJob(projectId: string, jobId: string): Promise<LongJob>;
    getLongJobLogs(projectId: string, jobId: string): Promise<{
        stdout: string | null;
        stderr: string | null;
        truncated: boolean;
    }>;
    previewLongJob(projectId: string, jobId: string, path: string): Promise<string>;
}
