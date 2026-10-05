import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexRuntime } from "./codex-runtime.js";
const target = "aarch64-apple-darwin";
function fixture(resources: string) {
  const base = join(resources, "agent-runtime", "codex"),
    root = join(base, target);
  const files = [
    "bin/codex",
    "bin/codex-code-mode-host",
    "codex-path/rg",
    "codex-package.json",
  ];
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(
      join(root, file),
      file === "codex-package.json"
        ? JSON.stringify({
            layoutVersion: 1,
            version: "0.160.0",
            target,
            entrypoint: "bin/codex",
          })
        : "fixture",
    );
  }
  for (const notice of ["LICENSE", "NOTICE"])
    writeFileSync(join(base, notice), "notice");
  writeFileSync(
    join(base, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      version: "0.160.0",
      platform: "darwin",
      arch: "arm64",
      target,
      files: files.map((path) => ({ path: target + "/" + path })),
    }),
  );
  return { base, root };
}
test("packaged Codex resolves only MaterialsX resources regardless of PATH/global installation", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-codex-resolver-")),
    oldPath = process.env.PATH;
  try {
    const { root } = fixture(join(dir, "Resources"));
    process.env.PATH = "/fake/global/codex/bin";
    const runtime = codexRuntime({
      packaged: true,
      resourcesPath: join(dir, "Resources"),
      platform: "darwin",
      arch: "arm64",
    });
    assert.equal(runtime.binary, realpathSync(join(root, "bin/codex")));
    assert.ok(runtime.path.includes(realpathSync(join(root, "codex-path"))));
    assert.ok(!runtime.path.includes("/fake"));
    rmSync(join(root, "bin/codex-code-mode-host"));
    assert.throws(
      () =>
        codexRuntime({
          packaged: true,
          resourcesPath: join(dir, "Resources"),
          platform: "darwin",
          arch: "arm64",
        }),
      /重新安装 MaterialsX/,
    );
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
test("runtime rejects missing bundle, mismatched platform and escaping symlinks instead of falling back", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-codex-boundary-"));
  try {
    const resources = join(dir, "Resources"),
      { root } = fixture(resources);
    assert.throws(() =>
      codexRuntime({
        packaged: true,
        resourcesPath: join(dir, "absent"),
        platform: "darwin",
        arch: "arm64",
      }),
    );
    assert.throws(() =>
      codexRuntime({
        packaged: true,
        resourcesPath: resources,
        platform: "darwin",
        arch: "x64",
      }),
    );
    if (process.platform !== "win32") {
      const outside = join(dir, "external-codex");
      writeFileSync(outside, "external");
      rmSync(join(root, "bin/codex"));
      symlinkSync(outside, join(root, "bin/codex"));
      assert.throws(
        () =>
          codexRuntime({
            packaged: true,
            resourcesPath: resources,
            platform: "darwin",
            arch: "arm64",
          }),
        /重新安装 MaterialsX/,
      );
    }
    assert.throws(() =>
      codexRuntime({ packaged: true, platform: "darwin", arch: "arm64" }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
