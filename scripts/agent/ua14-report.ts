import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fingerprint } from "../../packages/release-readiness/src/qualification/fingerprint.js";
import { qualifyRelease } from "../../packages/release-readiness/src/qualification/gate.js";
import { hash, ownedText } from "../../packages/atomistic/src/discovery-io.js";
import { verifyTechnical } from "../../packages/release-readiness/src/qualification/technical.js";
const args = process.argv.slice(2),
  option = (key: string, fallback: string) =>
    args.includes(key) ? (args[args.indexOf(key) + 1] ?? fallback) : fallback;
const root = process.cwd(),
  output = resolve(option("--output", "runtime/agent/ua-14")),
  fp = await fingerprint(root);
const load = async (path: string) => {
  try {
    return JSON.parse(ownedText(path, 16 * 1024 * 1024));
  } catch {
    return null;
  }
};
const technical = await load(join(output, "technical.json")),
  benchmark = await load(
    resolve(option("--benchmark", join(output, "benchmark/benchmark.json"))),
  );
const dir = resolve(option("--evidence", join(output, "attestations"))),
  attestations = [];
for (const file of await readdir(dir).catch(() => [] as string[]))
  if (file.endsWith(".json")) attestations.push(await load(join(dir, file)));
const trustFile = option("--trust", ""),
  trust = trustFile ? await load(resolve(trustFile)) : null;
const artifact = option("--artifact", "");
let artifactSha256: string | null = null;
if (artifact)
  artifactSha256 = await import("node:crypto").then(async ({ createHash }) => {
    const { createReadStream } = await import("node:fs");
    const h = createHash("sha256");
    for await (const b of createReadStream(resolve(artifact))) h.update(b);
    return h.digest("hex");
  });
const currentTechnical = await verifyTechnical(technical, fp, async (index) => {
  try {
    return hash(
      ownedText(join(output, `technical-${index}.log`), 8 * 1024 * 1024),
    );
  } catch {
    return null;
  }
});
const gate = qualifyRelease({
  fingerprint: fp,
  benchmark,
  attestations,
  trust,
  artifactSha256,
  technicalPassed: currentTechnical,
});
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(
  join(output, "release-gate.json"),
  JSON.stringify(gate, null, 2) + "\n",
  { mode: 0o600 },
);
const text = [
  "# MaterialsX UA.14 技术与发行验收",
  "",
  `正式发行：${gate.formalReleaseReady ? "通过" : "未通过"}`,
  `源码指纹：${fp.sourceSha256}`,
  "",
  "|检查|结果|要求|",
  "|---|---|---|",
  ...gate.checks.map(
    (c) => `|${c.id}|${c.passed ? "通过" : "未通过"}|${c.reason}|`,
  ),
  "",
  "## 科学资格",
  "",
  gate.scientificQualification
    ? "已收到当前分发包的可信科学审核证据。"
    : "未获得当前分发包的科学专家审核；工程成功不代表材料结论准确。",
  "",
  "## 性能比较",
  "",
  JSON.stringify(gate.summary, null, 2),
  "",
  "参考组为共享相同材料工具的开源 Codex App Server，不代表商业 Codex 产品。不同模型、机器、协议或输入的性能不做因果比较。",
  "没有统计到完整 usage 的 Token 标记为 unknown，不记作 0。未测平台和未通过组合不声明正式支持。",
  "",
].join("\n");
await writeFile(join(output, "technical-report.md"), text, { mode: 0o600 });
await writeFile(
  join(output, "scientific-report.md"),
  [
    "# 科学验收报告",
    "",
    `状态：${gate.scientificQualification ? "可信审核证据已核验" : "待专家审核"}`,
    "",
    "60 个内置双语案例为团队自有的合成工程任务。固定数值参考测试仅验证算法实现；真实论文事实、单位、出处、材料适用性和实验复现不能由这些任务替代。",
    "真实保留集发布前需授权来源、至少 60 个金标准字段、独立专家签收、适用边界及复现报告。",
    "",
  ].join("\n"),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    formalReleaseReady: gate.formalReleaseReady,
    currentTechnical,
    blocked: gate.checks.filter((c) => !c.passed).map((c) => c.id),
    output,
  }),
);
if (args.includes("--strict") && !gate.formalReleaseReady) process.exitCode = 1;
