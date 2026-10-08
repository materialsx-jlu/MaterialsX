import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, lstat } from "node:fs/promises";
import { dirname, join, relative, isAbsolute, sep } from "node:path";
import { z } from "zod";
import {
  ownedText,
  canonical,
  hash,
} from "../../packages/atomistic/src/discovery-io.js";
const manifest = z.strictObject({
  modelId: z.string(),
  quantization: z.string(),
  runtimeVersion: z.string(),
  files: z
    .array(
      z.strictObject({
        path: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(100),
});
/** User-owned weight identity only. Never downloads, loads or copies multi-GiB weights. */
export async function verifyWeights(path: string, modelId: string) {
  const data = manifest.parse(JSON.parse(ownedText(path, 64 * 1024))),
    base = await realpath(dirname(path));
  if (data.modelId !== modelId) throw Error("WEIGHT_MODEL_ID_MISMATCH");
  for (const f of data.files) {
    const p = join(base, f.path),
      r = relative(base, p),
      resolved = relative(base, await realpath(p));
    if (
      isAbsolute(f.path) ||
      r.startsWith("..") ||
      (await lstat(p)).isSymbolicLink() ||
      resolved === ".." ||
      resolved.startsWith(".." + sep) ||
      isAbsolute(resolved)
    )
      throw Error("WEIGHT_PATH_DENIED");
    const h = createHash("sha256");
    for await (const chunk of createReadStream(p)) h.update(chunk);
    if (h.digest("hex") !== f.sha256) throw Error("WEIGHT_IDENTITY_CHANGED");
  }
  return hash(canonical(data));
}
