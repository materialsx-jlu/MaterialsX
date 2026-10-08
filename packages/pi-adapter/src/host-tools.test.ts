import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { PiLocalSessionService } from "./local-session.js";

test("Codex bridge uses the existing tool once, respects grants and reads only approved Skill files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mx-host-tools-"));
  const project = join(dir, "project"), skills = join(dir, "skills");
  await mkdir(project); await mkdir(skills);
  await mkdir(join(skills, "safe"));
  await writeFile(join(skills, "safe/SKILL.md"), "---\nname: safe\ndescription: Safe bilingual example\n---\n硅 Si\n");
  await writeFile(join(dir, "outside.md"), "---\nname: outside\ndescription: Not approved\n---\nPRIVATE_FIXTURE\n");
  await symlink(join(dir, "outside.md"), join(skills, "outside.md"));
  let calls = 0;
  const service = new PiLocalSessionService(dir, join(dir, "state"), () => [defineTool({
    name: "materials_science", label: "Science", description: "Existing domain tool", parameters: Type.Object({ value: Type.String() }),
    async execute(_id, args, signal) {
      signal?.throwIfAborted(); calls++;
      return { content: [{ type: "text", text: args.value }], details: {} };
    },
  })], () => [skills]);
  try {
    const denied = await service.hostTools(project, "conversation", ["read"]);
    assert(!denied.some((t) => t.name === "materials_science"));
    const allowed = await service.hostTools(project, "conversation", ["read", "science"]);
    const signal = new AbortController().signal;
    const science = allowed.find((t) => t.name === "materials_science")!;
    assert.equal((await science.execute({ value: "actual" }, signal)).content[0]?.text, "actual");
    assert.equal(calls, 1);
    const read = allowed.find((t) => t.name === "read_skill")!;
    const result = JSON.parse((await read.execute({ name: "safe" }, signal)).content[0]!.text);
    assert.match(result.text, /硅 Si/); assert.match(result.sha256, /^[a-f0-9]{64}$/);
    await writeFile(join(skills,'safe/SKILL.md'),'---\nname: safe\ndescription: Changed actual instructions\n---\nNew version\n');
    const fresh=(await service.hostTools(project,'next-conversation',['read'])).find(t=>t.name==='read_skill')!;
    const next=JSON.parse((await fresh.execute({name:'safe'},signal)).content[0]!.text);assert.notEqual(next.sha256,result.sha256);
    const part = JSON.parse((await read.execute({ name: "safe", startLine: 1, endLine: 3 }, signal)).content[0]!.text);
    assert.equal(part.partial, true); assert.equal(part.sha256, result.sha256); assert.equal(part.endLine, 3);
    assert(!part.text.includes("硅 Si"));
    const whole=JSON.parse((await read.execute({name:'safe',startLine:1,endLine:200},signal)).content[0]!.text);
    assert.equal(whole.text,result.text);assert.equal(whole.sha256,result.sha256);assert.equal(whole.endLine,result.totalLines);assert.equal(whole.partial,false);
    await assert.rejects(read.execute({name:'safe',startLine:1,endLine:201},signal),/INVALID_LINE_RANGE/);
    await assert.rejects(read.execute({ name: "outside" }, signal), /OUTSIDE_APPROVED_ROOT/);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(science.execute({ value: "cancelled" }, cancelled.signal));
    assert.equal(calls, 1);
  } finally { service.dispose(); await rm(dir, { recursive: true, force: true }); }
});
