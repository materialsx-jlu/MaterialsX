import { build } from "esbuild";
import { execFileSync } from "node:child_process";
const stamp = execFileSync(process.execPath, ["--import", "tsx", "scripts/agent/build-identity.ts", "--prepare"], { encoding: "utf8" }).trim();

await Promise.all([
  build({
    entryPoints: ["apps/desktop/main/index.ts"],
    outfile: "dist/apps/desktop/main/index.js",
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "external",
    external: ["electron"],
    sourcemap: true,
    define: { __MATERIALSX_BUILD_IDENTITY__: stamp },
  }),
  build({
    entryPoints: ["apps/desktop/preload/index.ts"],
    outfile: "dist/apps/desktop/preload/index.cjs",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node24",
    external: ["electron"],
    sourcemap: true,
  }),
]);
