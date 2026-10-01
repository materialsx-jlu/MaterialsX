import { z } from "zod";

export const missingReasonSchema = z.enum([
  "not_reported",
  "not_applicable",
  "illegible",
  "conflicting_sources",
  "extraction_failed",
]);

export const evidenceLocatorSchema = z.object({
  sourceUri: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/i, "sourceHash 必须是 SHA-256"),
  page: z.number().int().positive().optional(),
  table: z.string().min(1).optional(),
  row: z.string().min(1).optional(),
  quote: z.string().min(1).max(2_000).optional(),
  extractionMethod: z.enum(["native_text", "table", "ocr", "manual", "api"]),
});

export const compositionEntrySchema = z.object({
  component: z.string().min(1),
  value: z.number().finite().nonnegative(),
  basis: z.enum(["mass_percent", "volume_percent", "mole_percent", "phr", "absolute"]),
  unit: z.string().min(1).optional(),
  evidence: z.array(evidenceLocatorSchema).min(1),
});

export const processStepSchema = z.object({
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  evidence: z.array(evidenceLocatorSchema).min(1),
});

export const measurementSchema = z.object({
  property: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  uncertainty: z.number().finite().nonnegative().optional(),
  uncertaintyType: z.enum(["sd", "se", "ci95", "range", "reported_unknown"]).optional(),
  conditions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  evidence: z.array(evidenceLocatorSchema).min(1),
});

export const sampleRecordSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    composition: z.array(compositionEntrySchema),
    process: z.array(processStepSchema),
    measurements: z.array(measurementSchema),
    missing: z.array(
      z.object({
        field: z.string().min(1),
        reason: missingReasonSchema,
        detail: z.string().min(1).optional(),
      }),
    ),
  })
  .superRefine((sample, context) => {
    for (const basis of ["mass_percent", "volume_percent", "mole_percent"] as const) {
      const total = sample.composition
        .filter((item) => item.basis === basis)
        .reduce((sum, item) => sum + item.value, 0);
      if (total > 100.000_001) {
        context.addIssue({
          code: "custom",
          path: ["composition"],
          message: `${basis} 合计不能超过 100，当前为 ${total}`,
        });
      }
    }
  });

export const materialsDatasetSchema = z.object({
  schemaVersion: z.literal("1.0"),
  datasetId: z.string().min(1),
  title: z.string().min(1),
  source: z.object({
    uri: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    importedAt: z.iso.datetime(),
  }),
  samples: z.array(sampleRecordSchema).min(1),
  revisions: z.array(
    z.object({
      revision: z.number().int().positive(),
      timestamp: z.iso.datetime(),
      actor: z.enum(["extractor", "reviewer", "system"]),
      note: z.string().min(1),
    }),
  ),
});

export type MaterialsDataset = z.infer<typeof materialsDatasetSchema>;
export const materialsDatasetJsonSchema = z.toJSONSchema(materialsDatasetSchema);
