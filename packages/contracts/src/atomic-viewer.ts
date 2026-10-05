import { z } from "zod";
import { atomicStructureSchema, atomicViewerConfigSchema } from "./atomistic.js";
import { localId } from "./atomistic-runtime.js";

/** No paths, URLs, HTML, functions or provider credentials cross this interface. */
export const atomicViewRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({kind:z.literal("import"),projectId:localId,structureId:localId}),
  z.strictObject({kind:z.literal("artifact"),projectId:localId,runId:localId,artifactId:localId}),
]);
export type AtomicViewRequest = z.infer<typeof atomicViewRequestSchema>;
const vector = z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
export const atomicViewPayloadSchema = z.strictObject({
  version:z.literal("m6.2-v1"),request:atomicViewRequestSchema,structure:atomicStructureSchema,
  forcesEvPerAngstrom:z.array(vector).min(1).max(2000).nullable(),
  quality:z.enum(["unreviewed","needs_review"]),
}).superRefine((v,ctx)=>{
  if(v.request.kind==="import" && v.request.structureId!==v.structure.id)ctx.addIssue({code:"custom",message:"structure identity mismatch"});
  if(v.forcesEvPerAngstrom && v.forcesEvPerAngstrom.length!==v.structure.atoms.length)ctx.addIssue({code:"custom",message:"force count mismatch"});
});
export type AtomicViewPayload = z.infer<typeof atomicViewPayloadSchema>;
export const atomicPngExportSchema = z.strictObject({request:atomicViewRequestSchema,
  png:z.string().max(12*1024*1024).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)});
/** Static views only; MD frames and displacement coloring have not been implemented. */
export const staticViewerConfigSchema = atomicViewerConfigSchema.refine(v=>v.frame===0,"static viewer requires frame zero");
export const atomicSceneSchema = z.strictObject({type:z.literal("scene"),payload:atomicViewPayloadSchema,
  config:staticViewerConfigSchema,theme:z.enum(["materials-dark","codex-light"])});
export const atomicFrameCommandSchema = z.union([atomicSceneSchema,
  z.strictObject({type:z.enum(["reset","png","dispose"])}),
  z.strictObject({type:z.literal("select"),index:z.number().int().min(0).max(4095).nullable()}),
]);
export const atomicFrameEventSchema = z.discriminatedUnion("type",[
  z.strictObject({type:z.literal("ready")}),
  z.strictObject({type:z.literal("error"),message:z.string().max(1000)}),
  z.strictObject({type:z.literal("selected"),indices:z.array(z.number().int().min(0).max(4095)).max(3)}),
  z.strictObject({type:z.literal("png"),png:atomicPngExportSchema.shape.png}),
  z.strictObject({type:z.literal("rendered"),count:z.number().int().min(1).max(4096),bonds:z.number().int().min(0).max(12000),
    limited:z.boolean(),unsupported:z.array(z.string().max(3)).max(118),colors:z.record(z.string().max(3),z.string().regex(/^#[a-f0-9]{6}$/i))}),
]);
