import { readFile, readdir, lstat, realpath } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { z } from "zod";
import { buildStampSchema, type BuildStamp, type BuildIdentity, type QualificationFingerprint } from "../../../contracts/src/qualification.js";
import { hash, canonical } from "../../../atomistic/src/discovery-io.js";

export { buildStampSchema, type BuildStamp, type BuildIdentity };
const entry = z.strictObject({
  path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
});
export const buildManifestSchema = buildStampSchema.extend({
  files: z.array(entry).min(3),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BuildManifest = z.infer<typeof buildManifestSchema>;
export function createBuildStamp(fingerprint: QualificationFingerprint, builtAt = new Date().toISOString()): BuildStamp {
  return buildStampSchema.parse({ schemaVersion: "materials-build-v1", fingerprint, builtAt,
    buildId: hash(canonical({ fingerprint, builtAt })) });
}
function validateStamp(stamp: BuildStamp) {
  if (createBuildStamp(stamp.fingerprint, stamp.builtAt).buildId !== stamp.buildId)
    throw Error("BUILD_STAMP_INVALID");
}
async function owned(root: string, path: string) {
  if (path.includes("\\") || path.split("/").some(p => !p || p === "." || p === "..") || isAbsolute(path))
    throw Error("BUILD_PATH_INVALID");
  const file = join(root, path);
  const local = relative(await realpath(root), await realpath(file));
  if (local === ".." || local.startsWith(".." + sep) || isAbsolute(local) || (await lstat(file)).isSymbolicLink())
    throw Error("BUILD_PATH_INVALID");
  if (!(await lstat(file)).isFile()) throw Error("BUILD_FILE_INVALID");
  return readFile(file);
}
async function desktopFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string) {
    for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = dir + "/" + e.name;
      if (e.isSymbolicLink()) throw Error("BUILD_SYMLINK");
      if (e.isDirectory()) await walk(path);
      else if (e.isFile() && !path.endsWith(".map") && !/\.test\.|smoke/i.test(path)) result.push(path);
    }
  }
  await walk("apps/desktop");
  return result.sort();
}
export async function sealBuild(root: string, stamp: BuildStamp): Promise<BuildManifest> {
  validateStamp(stamp);
  const files = [];
  for (const path of await desktopFiles(root)) {
    const bytes = await owned(root, path);
    files.push({ path, sha256: hash(bytes), bytes: bytes.length });
  }
  for (const required of ["apps/desktop/main/index.js", "apps/desktop/preload/index.cjs", "apps/desktop/renderer/index.html"])
    if (!files.some(e => e.path === required)) throw Error("BUILD_ENTRYPOINT_MISSING");
  return buildManifestSchema.parse({ ...stamp, files, artifactSha256: hash(canonical(files)) });
}
/** Byte identity only; this is neither a signature nor release/scientific qualification. */
export async function inspectBuild(root: string, loadedStamp?: BuildStamp): Promise<BuildIdentity> {
  let stamp: BuildStamp | null = null;
  try {
    const manifest = buildManifestSchema.parse(JSON.parse((await owned(root, "build-identity.json")).toString()));
    stamp = buildStampSchema.parse({ schemaVersion: manifest.schemaVersion, fingerprint: manifest.fingerprint,
      buildId: manifest.buildId, builtAt: manifest.builtAt });
    validateStamp(stamp);
    if (loadedStamp && canonical(stamp) !== canonical(loadedStamp)) throw Error("BUILD_LOADED_STAMP_MISMATCH");
    if (new Set(manifest.files.map(f => f.path)).size !== manifest.files.length) throw Error("BUILD_DUPLICATE_FILE");
    const actual = await sealBuild(root, stamp);
    if (canonical(actual.files) !== canonical(manifest.files) || actual.artifactSha256 !== manifest.artifactSha256)
      throw Error("BUILD_BYTES_MISMATCH");
    return { status: "verified", stamp, artifactSha256: manifest.artifactSha256,
      checkedFiles: manifest.files.length, detail: "应用构建文件已核对 / Build bytes verified" };
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT" && !stamp;
    return { status: missing ? "unattested" : "mismatch", stamp: stamp ?? loadedStamp ?? null,
      artifactSha256: null, checkedFiles: 0,
      detail: missing ? "此构建没有身份清单 / Build identity unavailable" : "构建身份或文件不匹配 / Build identity mismatch" };
  }
}
