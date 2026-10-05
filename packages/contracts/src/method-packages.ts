import {z} from 'zod';
import {publicHttps,catalogPublicKeySchema} from './potential-discovery.js';
const text=z.string().min(1).max(2000),id=z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const methodBi=z.strictObject({zh:text,en:text});
export const methodPackagePin=z.strictObject({id,version:id,sha256:sha});
const license=z.strictObject({component:z.enum(['paper','code','data','weights']),status:z.enum(['reviewed','pending','not-applicable']),identifier:text,basis:text,url:publicHttps.nullable()});
export const methodPackageSchema=z.strictObject({
  schemaVersion:z.literal('ua10-method-v1'),id,version:id,name:methodBi,description:methodBi,
  scope:z.array(methodBi).min(1).max(12),limitations:z.array(methodBi).min(1).max(12),
  sources:z.array(z.strictObject({kind:z.enum(['paper','code','data','documentation']),url:publicHttps,citation:text,revision:text})).min(1).max(12),
  licenses:z.array(license).length(4).superRefine((v,c)=>{if(new Set(v.map(x=>x.component)).size!==4)c.addIssue({code:'custom',message:'Separate paper/code/data/weights decisions required'});}),
  execution:z.strictObject({backend:z.enum(['summary-v1','ols-v1','unavailable']),tool:z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),methodId:id,
    inputSchema:sha,outputSchema:sha,inputContract:z.literal('methods/contracts/research-method-input.schema.json'),outputContract:z.literal('methods/contracts/research-method-output.schema.json'),files:z.array(z.strictObject({path:z.string().regex(/^experiments\/[a-z0-9.-]+\.mjs$/),sha256:sha})).min(1).max(6),dependencyLock:sha,
    runtime:z.enum(['bundled-node','unavailable']),precision:z.literal('float64'),maxSamples:z.number().int().min(1).max(1000000),network:z.boolean(),gpu:z.boolean(),memoryMiB:z.number().int().min(1).max(1000000)}),
  reference:z.strictObject({id,file:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/),sha256:sha,source:publicHttps,
    expected:z.record(z.string().min(1).max(50),z.number().finite()),absoluteTolerance:z.number().positive().max(1),relativeTolerance:z.number().nonnegative().max(1),scope:methodBi}),
  skill:z.strictObject({name:id,instructions:methodBi,examples:z.array(methodBi).min(1).max(2)}),
});
export type MethodPackage=z.infer<typeof methodPackageSchema>;
export type MethodPackagePin=z.infer<typeof methodPackagePin>;
export const methodReferenceSchema=z.strictObject({id:z.uuid(),at:z.iso.datetime(),pin:methodPackagePin,referenceSha256:sha,executionSha256:sha,
  environment:z.strictObject({node:text,platform:text,arch:text}),status:z.enum(['passed','failed']),
  checks:z.array(z.strictObject({field:text,actual:z.number().finite(),expected:z.number().finite(),error:z.number().nonnegative(),tolerance:z.number().positive(),passed:z.boolean()})).min(1).max(10),
  domainValidated:z.literal(false),productionApproved:z.literal(false)});
export type MethodReference=z.infer<typeof methodReferenceSchema>;
export const methodReviewSchema=z.strictObject({at:z.iso.datetime(),pin:methodPackagePin,decision:z.enum(['approve','reject']),reviewer:text,reason:text});
export const methodReleasePayload=z.strictObject({channel:z.literal('materialsx-methods-v1'),sequence:z.number().int().positive().safe(),previous:sha.nullable(),issuedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
  action:z.enum(['publish','rollback']),rollbackOf:z.number().int().positive().nullable(),entries:z.array(methodPackageSchema).max(40),reviews:z.array(methodReviewSchema).max(40),
  withdrawals:z.array(z.strictObject({sha256:sha,reason:methodBi})).max(200),nextKeys:z.array(catalogPublicKeySchema).max(10),retireKeyIds:z.array(id).max(10)});
export const signedMethodRelease=z.strictObject({keyId:id,payload:methodReleasePayload,payloadSha256:sha,signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)});
export type SignedMethodRelease=z.infer<typeof signedMethodRelease>;
export const methodPackageState=z.strictObject({version:z.literal('ua10-state-v1'),candidates:z.array(methodPackageSchema).max(40),reviews:z.array(methodReviewSchema).max(200),
  releases:z.array(signedMethodRelease).max(64),references:z.array(methodReferenceSchema).max(200)});
export type MethodPackageState=z.infer<typeof methodPackageState>;
export const methodPackageQuery=z.strictObject({query:z.string().max(160).default(''),limit:z.number().int().min(1).max(20).default(10)});
export interface MethodPackageEntry{manifest:MethodPackage;pin:MethodPackagePin;origin:'bundled'|'community';status:'candidate'|'reference-reproduced'|'withdrawn';
  executable:boolean;review:'bundled'|'pending'|'approve'|'reject';reference:MethodReference|null;blockers:string[];domainValidated:false}
export interface MethodPackageOverview{entries:MethodPackageEntry[];sequence:number;releases:SignedMethodRelease[];reviews:MethodPackageState['reviews'];error:string|null;executionAuthority:false}
export interface MethodPackageAPI{
  getMethodPackages():Promise<MethodPackageOverview>;
  verifyMethodPackage(pin:MethodPackagePin):Promise<MethodReference>;
  importMethodPackage():Promise<MethodPackageOverview|null>;
  reviewMethodPackage(input:{pin:MethodPackagePin;decision:'approve'|'reject';reviewer:string;reason:string}):Promise<MethodPackageOverview>;
}
