import { z } from 'zod';
import {selectionRequestSchema as molecularRequest} from './potential-molecules.js';
import {selectionRequestSchema as physicsRequest} from './potential-physics.js';
import { localId, startAtomisticSchema, type AtomisticRuntimeStatus as LegacyStatus } from './atomistic-runtime.js';
import { capabilityReceiptSchema as legacyCapability, selectionAssessmentSchema as legacyAssessment, selectionProposalSchema as legacyProposal } from './atomistic-selection.js';
import { startRelaxationSchema as legacyRelaxation } from './atomistic-relaxation.js';
import { selectedRunSchema as legacySelected } from './atomistic-dynamics.js';
export const mountedId=z.string().regex(/^[a-z][a-z0-9.-]{0,95}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const notice=z.strictObject({path:z.string().regex(/^docs\/m6\/licenses\/[a-zA-Z0-9.-]+$/),sha256:hash});
export const packageEntrySchema=z.strictObject({potentialId:mountedId,family:z.enum(['mace','chgnet']),adapter:z.enum(['mace-ase','chgnet-ase']),basePotentialId:z.enum(['mace-mp-0b3-medium','chgnet-0.3.0']),environmentProfileId:localId,dependencyLockSha256:hash,sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),url:z.url().startsWith('https://'),sha256:hash,bytes:z.number().int().positive().max(2*1024**3),license:z.string().max(128),notices:z.array(notice).min(1).max(8),reviewedAt:z.iso.datetime(),elements:z.array(z.string().regex(/^[A-Z][a-z]?$/)).min(1).max(118),loadedMemoryMiB:z.number().positive().max(16384),dtype:z.enum(['float64','float32'])}).refine(e=>(e.family==='mace')===(e.adapter==='mace-ase')&&(e.family==='mace')===(e.basePotentialId==='mace-mp-0b3-medium'),'adapter/environment family mismatch');
export const packageManifestSchema=z.strictObject({version:z.literal('m6.8-v1'),entries:z.array(packageEntrySchema).min(1).max(100)}).refine(v=>new Set(v.entries.map(e=>e.potentialId)).size===v.entries.length,'duplicate packages');
export type ApprovedPackage=z.infer<typeof packageEntrySchema> | import('./potential-adapters.js').SevenNetPackage | import('./potential-molecules.js').MolecularPackage | import('./potential-native.js').NativePackage;
export const mountedPackageRequest=z.strictObject({potentialId:mountedId});
export const mountedPackageStatus=z.strictObject({potentialId:mountedId,state:z.enum(['absent','downloading','paused','installed','disabled','failed']),bytes:z.number().int().nonnegative(),totalBytes:z.number().int().positive(),sha256:hash,error:z.string().max(200).nullable(),runtimeReady:z.boolean(),quality:z.literal('needs_review'),environmentProfileId:localId,cacheOwned:z.boolean()});
export type MountedPackageStatus=z.infer<typeof mountedPackageStatus>;
// These current APIs widen IDs without altering archived M6.1–M6.6 schemas.
export const capabilityReceiptSchema=legacyCapability.extend({potentialId:mountedId});
export type CapabilityReceipt=z.infer<typeof capabilityReceiptSchema>;
export const selectionAssessmentSchema=legacyAssessment.extend({version:z.enum(['m6.4-v1','m6.8-v1']),capabilities:z.array(capabilityReceiptSchema).max(100)});
export const molecularSelectionAssessmentSchema=selectionAssessmentSchema.extend({request:molecularRequest});
export const currentSelectionAssessmentSchema=selectionAssessmentSchema.extend({request:physicsRequest});
export type SelectionAssessment=z.infer<typeof currentSelectionAssessmentSchema>;
export const selectionProposalSchema=legacyProposal.extend({selectedPotentialId:mountedId});
export const selectedRunSchema=z.strictObject({...legacySelected.shape,proposal:selectionProposalSchema}).refine(v=>!(v.options&&v.mdOptions),'tasks mutually exclusive');
export const startAtomisticMountedSchema=startAtomisticSchema.extend({potentialId:mountedId});
export const startRelaxationMountedSchema=legacyRelaxation.extend({potentialId:mountedId});
export interface MountedRuntimeStatus extends Omit<LegacyStatus,'potentialId'>{potentialId:string}
