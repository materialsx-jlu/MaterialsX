import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { identityOrigin } from '../../../packages/control-plane-client/src/identity.js';

const bundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  apiOrigin: z.string().nullable(),
  releaseChannel: z.enum(['development', 'preview', 'stable']),
  websiteOrigin: z.string().url().max(256).optional(),
});
const remoteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogRevision: z.string().regex(/^[a-f0-9]{64}$/),
  recommendedVersion: z.string().max(100).nullable(),
  features: z.strictObject({ account: z.boolean(), models: z.boolean(), research: z.boolean(), payments: z.boolean() }),
  availability: z.record(z.enum(['account', 'models', 'research', 'payments']), z.strictObject({
    status: z.enum(['available', 'unavailable']), reason: z.enum(['', 'not_configured', 'paused']),
  })).optional(),
});
export type RemoteClientConfig = z.infer<typeof remoteSchema>;
export type PlatformConfiguration = {
  apiOrigin: string | null;
  websiteOrigin: string | null;
  releaseChannel: 'development' | 'preview' | 'stable';
  connection: 'unconfigured' | 'online' | 'offline';
  stale: boolean;
  remote: RemoteClientConfig | null;
};

/** Installed builds never consult process environment for their platform address. */
export async function loadPlatformBundle(resources: string, installed: boolean, developmentOverride?: string): Promise<PlatformConfiguration> {
  if (!installed) {
    const origin = developmentOverride === undefined ? 'http://127.0.0.1:8788' : developmentOverride;
    return { apiOrigin: origin ? identityOrigin(origin, true) : null, websiteOrigin: null, releaseChannel: 'development',
      connection: origin ? 'offline' : 'unconfigured', stale: false, remote: null };
  }
  try {
    const raw = await readFile(join(resources, 'materialsx-client.json'), 'utf8');
    if (Buffer.byteLength(raw) > 8192) throw Error('CLIENT_CONFIG_TOO_LARGE');
    const bundle = bundleSchema.parse(JSON.parse(raw));
    const origin = bundle.apiOrigin ? identityOrigin(bundle.apiOrigin, bundle.releaseChannel === 'development') : null;
    if (bundle.releaseChannel === 'stable' && !origin) throw Error('STABLE_API_REQUIRED');
    return { apiOrigin: origin, websiteOrigin: bundle.websiteOrigin ?? null, releaseChannel: bundle.releaseChannel,
      connection: origin ? 'offline' : 'unconfigured', stale: false, remote: null };
  } catch {
    return { apiOrigin: null, websiteOrigin: null, releaseChannel: 'preview', connection: 'unconfigured', stale: false, remote: null };
  }
}

export class PlatformConfigurationService {
  private state: PlatformConfiguration;
  private etag: string | null = null;
  private readonly cacheFile: string;
  constructor(bundle: PlatformConfiguration, userData: string, private transport: typeof fetch = fetch) {
    this.state = bundle;
    this.cacheFile = join(userData, 'platform-public-config.json');
  }
  snapshot() { return structuredClone(this.state); }
  async restore() {
    if (!this.state.apiOrigin) return;
    try {
      const cached = z.strictObject({ origin: z.string(), etag: z.string().regex(/^"[a-f0-9]{64}"$/).nullable(), remote: remoteSchema }).parse(
        JSON.parse(await readFile(this.cacheFile, 'utf8')));
      if (cached.origin !== this.state.apiOrigin) return;
      this.etag = cached.etag;
      this.state.remote = cached.remote;
      this.state.stale = true;
    } catch { /* No trusted cached metadata. */ }
  }
  async refresh() {
    if (!this.state.apiOrigin) return this.snapshot();
    try {
      const response = await this.transport(`${this.state.apiOrigin}/v1/client-config`, {
        method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(5000),
        headers: this.etag ? { 'If-None-Match': this.etag } : {},
      });
      if (response.status === 304 && this.state.remote) {
        this.state.connection = 'online'; this.state.stale = false;
        return this.snapshot();
      }
      if (!response.ok || Number(response.headers.get('Content-Length') ?? 0) > 8192) throw Error('CLIENT_CONFIG_UNAVAILABLE');
      if (!response.body) throw Error('CLIENT_CONFIG_EMPTY');
      const reader = response.body.getReader(), chunks:Uint8Array[]=[];
      let size=0;
      while(true){
        const part=await reader.read();
        if(part.done)break;
        size+=part.value.byteLength;
        if(size>8192){await reader.cancel();throw Error('CLIENT_CONFIG_TOO_LARGE')}
        chunks.push(part.value);
      }
      const body=Buffer.concat(chunks).toString('utf8');
      this.state.remote = remoteSchema.parse(JSON.parse(body));
      const etag = response.headers.get('ETag');
      this.etag = etag && /^"[a-f0-9]{64}"$/.test(etag) ? etag : null;
      this.state.connection = 'online'; this.state.stale = false;
      await writeFile(this.cacheFile, JSON.stringify({ origin: this.state.apiOrigin, etag: this.etag, remote: this.state.remote }), { mode: 0o600 }).catch(() => undefined);
    } catch { this.state.connection = 'offline'; this.state.stale = this.state.remote !== null; }
    return this.snapshot();
  }
}
