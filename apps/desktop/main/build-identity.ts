import { inspectBuild, type BuildStamp } from "../../../packages/release-readiness/src/qualification/build-identity.js";
declare const __MATERIALSX_BUILD_IDENTITY__: BuildStamp;
/** Embedded in this actual main bundle; no source-tree or external Codex identity is substituted. */
export function loadedBuildIdentity(distRoot: string) {
  const stamp = typeof __MATERIALSX_BUILD_IDENTITY__ === "undefined" ? undefined : __MATERIALSX_BUILD_IDENTITY__;
  if (!stamp) return Promise.resolve({ status: "unattested" as const, stamp: null, artifactSha256: null,
    checkedFiles: 0, detail: "当前主程序没有构建标识 / Loaded bundle has no build stamp" });
  return inspectBuild(distRoot, stamp);
}
