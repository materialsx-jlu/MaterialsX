import { Type } from "typebox";
import { z } from "zod";
import { localId } from "./atomistic-runtime.js";
import { selectionRequestSchema } from "./potential-physics.js";
const actions = [
  "auto_plan",
  "auto_run",
  "auto_get",
  "auto_cancel",
  "inspect",
  "import_sample",
  "select",
  "singlepoint",
  "relaxation",
  "md",
  "get",
  "cancel",
  "view",
  "compare",
] as const;
const nullableId = Type.Union([
  Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$" }),
  Type.Null(),
]);
export const scienceParameters = Type.Object(
  {
    action: Type.Union(actions.map((a) => Type.Literal(a))),
    targetId: nullableId,
    secondaryId: nullableId,
    potentialId: nullableId,
    domain: Type.Union(
      selectionRequestSchema.shape.domain.options.map((a) => Type.Literal(a)),
    ),
    mode: Type.Union([Type.Literal("production"), Type.Literal("exploratory")]),
    evidenceIds: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export const molecularScienceParameters = Type.Object(
  {
    ...scienceParameters.properties,
    interaction: Type.Optional(
      Type.Union(
        [...selectionRequestSchema.shape.interaction
          .unwrap()
          .options.map((v) => Type.Literal(v)), Type.Null()],
      ),
    ),
  },
  { additionalProperties: false },
);
export const legacyScienceParameters = Type.Object(
  {
    ...scienceParameters.properties,
    action: Type.Union(
      actions.filter((a) => !a.startsWith("auto_")).map((a) => Type.Literal(a)),
    ),
  },
  { additionalProperties: false },
);
export const scienceActionSchema = z.strictObject({
  interaction: selectionRequestSchema.shape.interaction.nullable().transform((value) => value ?? undefined),
  action: z.enum(actions),
  targetId: localId.nullable(),
  secondaryId: localId.nullable(),
  potentialId: localId.nullable(),
  domain: selectionRequestSchema.shape.domain,
  mode: selectionRequestSchema.shape.mode,
  evidenceIds: z.array(localId).max(20),
});
