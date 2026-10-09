const { Arch } = require("builder-util");
const path = require("node:path");
const load = () => import("./codex-runtime-package.mjs");
exports.beforePack = async (context) => {
  const { prepareCodexSource } = await load();
  await prepareCodexSource(
    context.packager.projectDir,
    context.electronPlatformName,
    Arch[context.arch],
  );
};
exports.afterPack = async (context) => {
  const { bundleCodex } = await load();
  const resources = context.packager.getResourcesDir(context.appOutDir);
  if (context.electronPlatformName === 'darwin') {
    const { dedupeAtomisticRuntime } = await import('./release/dedupe-atomistic-runtime.mjs');
    const result = await dedupeAtomisticRuntime(path.join(resources, 'atomistic-runtime'));
    console.log(`MaterialsX identical atomistic files linked: ${result.linked}, ${result.savedBytes} bytes`);
  }
  const report = await bundleCodex(
    context.packager.projectDir,
    resources,
    context.electronPlatformName,
    Arch[context.arch],
  );
  // Isolated runtime fixtures have their own packaging tests; production application bytes are checked here.
  if (context.packager.appInfo.id === "cn.edu.jlu.jamip.materialsx") {
    const { auditProductionPackage } = await import("./release-package-audit.mjs");
    await auditProductionPackage(resources);
  }
  console.log(
    `MaterialsX bundled Codex ${report.version}: ${report.platform}-${report.arch}, ${report.files.length} resources`,
  );
};
