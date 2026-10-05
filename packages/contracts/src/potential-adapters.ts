import { z } from 'zod';
import { packageEntrySchema } from './potential-packages.js';
import { potentialManifestSchema } from './atomistic.js';
import { hubEntrySchema } from './potential-hub.js';

/** New code families require an application-reviewed adapter and their own locked environment. */
export const sevenNetPackageSchema = z.strictObject({
  ...packageEntrySchema.shape,
  potentialId: z.literal('sevennet-0-11jul2024'),
  family: z.literal('sevennet'), adapter: z.literal('sevennet-ase'),
  basePotentialId: z.literal('sevennet-0-11jul2024'),
  environmentProfileId: z.literal('sevennet-0.13.0-cpu-v1'),
  dtype: z.literal('float32'),
  platforms: z.array(z.strictObject({
    platform: z.enum(['macos-arm64','windows-x64']), device: z.enum(['cpu','cuda','mps']),
    status: z.enum(['verified','not-tested','unsupported']), evidenceId: z.string().nullable(),
  })).min(1).max(6),
}).superRefine((e,ctx)=>{
  for(const row of e.platforms) if(row.status==='verified'&&(!row.evidenceId||row.platform!=='macos-arm64'||row.device!=='cpu'))
    ctx.addIssue({code:'custom',message:'Only the measured macOS arm64 CPU backend is approved in M6.10'});
});
export type SevenNetPackage = z.infer<typeof sevenNetPackageSchema>;
export const adapterExpansionSchema = z.strictObject({
  version: z.literal('m6.10-v1'),
  entries: z.array(sevenNetPackageSchema).length(1),
  potentials: z.array(potentialManifestSchema).length(1),
  candidates: z.array(hubEntrySchema).max(20),
}).superRefine((m,ctx)=>{
  const e=m.entries[0]!,p=m.potentials[0]!;
  if(p.id!==e.potentialId||p.family!=='SevenNet'||p.weights.sha256!==e.sha256||p.weights.bytes!==e.bytes||
     p.weights.url!==e.url||p.environment.codeRevision!==e.sourceRevision||p.environment.adapter!==e.adapter||
     p.environment.profileId!==e.environmentProfileId||p.licenses.weights.status!=='documented'||
     p.licenses.redistribution!=='permitted-with-notices'||p.declared.conservative!=='yes'||
     JSON.stringify(p.environment.matrix)!==JSON.stringify(e.platforms)||JSON.stringify(p.declared.elements)!==JSON.stringify(e.elements))
    ctx.addIssue({code:'custom',message:'Adapter package and scientific manifest identities must agree'});
  if(m.candidates.some(c=>c.execution.legacyId!==null||c.execution.profileId!==null||c.execution.platforms.some(r=>r.status==='verified')))
    ctx.addIssue({code:'custom',message:'Public candidates do not grant execution or verified backends'});
});
