import { z } from "zod";
import { taskRefSchema } from "./agent.js";

export const engineKindSchema = z.enum(["pi", "codex"]);
export const modelConnectionSchema = z.strictObject({
  id: z.string().regex(/^model-[a-f0-9]{32}$/),
  source: z.enum(["local", "platform"]),
  modelId: z.string().min(1).max(256),
  endpoint: z.url().nullable(),
  protocol: z.enum(["chat-completions", "responses"]),
  contextWindow: z.number().int().min(1024).nullable(),
  maxOutputTokens: z.number().int().positive(),
  revision: z.string().min(1),
  vision:z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.source === "platform" && value.endpoint !== null)
    ctx.addIssue({ code: "custom", message: "Platform endpoint is host-managed" });
  if (value.source === "local") {
    if (value.contextWindow === null) ctx.addIssue({ code: "custom", message: "Local context budget is required" });
    let url: URL | null = null;
    try { url = value.endpoint ? new URL(value.endpoint) : null; } catch { /* Invalid URLs are schema errors. */ }
    if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      ctx.addIssue({ code: "custom", message: "Local connection must be credential-free loopback" });
  }
  if (value.contextWindow !== null && value.maxOutputTokens >= value.contextWindow)
    ctx.addIssue({ code: "custom", message: "Output must leave input capacity" });
});
export const compatibilityProfileSchema = z.strictObject({
  schemaVersion: z.literal("engine-compatibility-v1"),
  id: z.string().regex(/^compat-[a-f0-9]{32}$/),
  connection: modelConnectionSchema,
  engine: engineKindSchema,
  engineVersion: z.string().min(1),
  platform: z.string().min(1),
  status: z.enum(["available", "limited", "unsupported", "unverified"]),
  testedAt: z.iso.datetime().nullable(),
  validationVersion: z.enum(["ua1-local-v1", "ua5-wire-v1", "ua5-wire-v2"]),
  checks: z.array(z.enum(["stream", "tool-call", "tool-result", "native-execution", "mcp", "isolation", "cancel", "resume"])),
  reason: z.object({ zh: z.string(), en: z.string() }),
});
export const engineSelectionSchema = z.strictObject({
  engine: engineKindSchema,
  engineVersion: z.string().min(1),
  modelConnectionRef: z.string().min(1),
  compatibilityRef: z.string().min(1),
  selectedBy: z.enum(["user", "legacy-default"]),
});
export const engineSessionRefSchema = z.strictObject({
  task: taskRefSchema,
  accountRef: z.string().min(1),
  selection: engineSelectionSchema,
  connection: modelConnectionSchema,
  nativeSessionId: z.string().min(1).nullable(),
}).refine((v) => v.connection.id === v.selection.modelConnectionRef, "Connection reference mismatch");
export type EngineKind = z.infer<typeof engineKindSchema>;
export type ModelConnection = z.infer<typeof modelConnectionSchema>;
export type CompatibilityProfile = z.infer<typeof compatibilityProfileSchema>;
export type EngineSelection = z.infer<typeof engineSelectionSchema>;
export type EngineSessionRef = z.infer<typeof engineSessionRefSchema>;
