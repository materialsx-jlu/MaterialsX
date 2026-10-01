import { build } from "esbuild";

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
