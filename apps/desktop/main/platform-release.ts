import { z } from 'zod';
import type { PlatformConfiguration } from './platform-configuration.js';

const asset = z.strictObject({ name: z.string().regex(/^MaterialsX-[A-Za-z0-9._-]+$/), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const manifest = z.strictObject({ schemaVersion: z.literal(1), channel: z.enum(['preview','stable']), version: z.string().regex(/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/), assets: z.array(asset).min(1) });
export type ReleaseCheck = { state: 'unconfigured'|'offline'|'current'|'available'; version?: string; url?: string; sha256?: string };
const components = (version: string) => version.match(/\d+/g)?.map(Number) ?? [];
export function isNewer(candidate: string, current: string) {
  const a = components(candidate), b = components(current);
  for (let i=0; i<3; i++) if ((a[i]??0)!==(b[i]??0)) return (a[i]??0)>(b[i]??0);
  if (candidate.includes('-preview.') && !current.includes('-preview.')) return false;
  if (!candidate.includes('-preview.') && current.includes('-preview.')) return true;
  return (a[3]??0)>(b[3]??0);
}
export async function checkRelease(config: PlatformConfiguration, current: string, platform: NodeJS.Platform, transport: typeof fetch = fetch): Promise<ReleaseCheck> {
  if (!config.websiteOrigin || config.releaseChannel === 'development') return {state:'unconfigured'};
  try {
    const origin = new URL(config.websiteOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('INVALID_WEBSITE_ORIGIN');
    const response = await transport(`${origin.origin}/releases/${config.releaseChannel}.json`, {redirect:'error', credentials:'omit', signal:AbortSignal.timeout(5000)});
    if (!response.ok || Number(response.headers.get('Content-Length') ?? 0) > 16384) throw Error('RELEASE_UNAVAILABLE');
    const body = await response.text();
    if (Buffer.byteLength(body)>16384) throw Error('RELEASE_TOO_LARGE');
    const value=manifest.parse(JSON.parse(body));
    if (value.channel !== config.releaseChannel || (value.channel === 'preview') !== value.version.includes('-preview.')) throw Error('CHANNEL_MISMATCH');
    if (!isNewer(value.version,current)) return {state:'current',version:value.version};
    const suffix=platform==='darwin'?'-mac-arm64.dmg':platform==='win32'?'-win-x64.exe':'-linux-x86_64.AppImage';
    const found=value.assets.find(a=>a.name===`MaterialsX-${value.version}${suffix}`);
    if (!found) return {state:'offline'};
    return {state:'available',version:value.version,sha256:found.sha256,url:`https://github.com/materialsx-jlu/MaterialsX/releases/download/v${value.version}/${found.name}`};
  } catch { return {state:'offline'}; }
}
