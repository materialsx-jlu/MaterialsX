import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextStreamBuffer } from "./text-stream-buffer.js";

describe("TextStreamBuffer", () => {
  it("coalesces small token deltas before crossing the UI boundary", () => {
    const flushed: string[] = [];
    const buffer = new TextStreamBuffer((text) => flushed.push(text), 1_000);
    buffer.push("材");
    buffer.push("料");
    buffer.push("科学");
    assert.deepEqual(flushed, []);
    buffer.close();
    assert.deepEqual(flushed, ["材料科学"]);
  });

  it("flushes automatically after the configured interval", async () => {
    const flushed: string[] = [];
    const buffer = new TextStreamBuffer((text) => flushed.push(text), 5);
    buffer.push("stream");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(flushed, ["stream"]);
  });
});
