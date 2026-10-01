import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateModelSelection } from "./capabilities.js";

describe("validateModelSelection", () => {
  it("accepts a platform model without user credentials or endpoint", () => {
    assert.deepEqual(validateModelSelection({ mode: "platform", modelId: "research-default" }), {
      mode: "platform",
      modelId: "research-default",
    });
  });

  it("accepts a loopback local model", () => {
    assert.ok(validateModelSelection({ mode: "local", modelId: "local", localEndpoint: "http://127.0.0.1:11434" }));
  });

  it("rejects a remote endpoint disguised as a local model", () => {
    assert.throws(
      () => validateModelSelection({ mode: "local", modelId: "remote", localEndpoint: "https://models.example.com" }),
      /loopback/,
    );
  });

  it("rejects custom endpoints for platform models", () => {
    assert.throws(
      () => validateModelSelection({ mode: "platform", modelId: "x", localEndpoint: "http://127.0.0.1:1" }),
      /cannot receive/,
    );
  });
});
