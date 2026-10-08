import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { MaterialsMcpClient, MCP_PROTOCOL } from "./mcp-client.js";
test("MCP pinned initialization, discovery, readonly permissions, cancellation and reconnect", async () => {
  const client = new MaterialsMcpClient({
    command: process.execPath,
    args: ["--import", "tsx", resolve("fixtures/agent/mcp-fixture.ts")],
    env: { PATH: process.env.PATH ?? "" },
  });
  try {
    await client.connect();
    assert.equal(MCP_PROTOCOL, "2025-11-25");
    assert.equal(client.discover().length, 3);
    const response = await client.call("read", { value: "Si" });
    assert.match(JSON.stringify(response), /Si/);
    assert.match(JSON.stringify(await client.readResource("fixture://verified")), /owned resource/);
    await assert.rejects(client.readResource("file:///private/secret"));
    await assert.rejects(client.call("write", {}), /授权/);
    await assert.rejects(client.call("missing", {}), /不存在/);
    await assert.rejects(
      client.call("slow", {}, { signal: AbortSignal.timeout(100) }),
    );
    await client.reconnect();
    assert.match(
      JSON.stringify(await client.call("read", { value: "after" })),
      /after/,
    );
  } finally {
    await client.close();
  }
});
