import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isSource, physicalLines, sourceInventory } from "./check-source-size.js";

test("physical line boundary includes blank lines and handles final newline", () => {
  assert.equal(physicalLines(""), 0);
  assert.equal(physicalLines("\n".repeat(600)), 600);
  assert.equal(physicalLines("\n".repeat(600) + "x"), 601);
  assert.equal(physicalLines("x\r\ny\r\n"), 2);
});
test("source gate includes new files and SQL, excludes third party, generated and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "mx-size-"));
  try {
    await mkdir(join(root, "vendor"));
    await writeFile(join(root, "vendor", "upstream.ts"), "\n".repeat(700));
    await writeFile(join(root, "new.sql"), "\n".repeat(601));
    await writeFile(join(root, "generated.pb.go"), "\n".repeat(700));
    assert.deepEqual(await sourceInventory(root), [{ path: "new.sql", lines: 601 }]);
    assert(!isSource("runtime/windows/file.ts"));
    assert(!isSource("node_modules\\library\\index.ts"));
    assert(isSource("packages/contracts/src/domain.ts"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
