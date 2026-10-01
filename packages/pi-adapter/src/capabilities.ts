export const PI_BASELINE = Object.freeze({
  package: "@earendil-works/pi-coding-agent",
  version: "0.99.1",
  required: ["session", "skills", "mcp", "cancel", "resume"] as const,
});

export type RuntimeMode = "platform" | "local";

export interface ModelSelection {
  mode: RuntimeMode;
  modelId: string;
  localEndpoint?: string;
}

export function validateModelSelection(selection: ModelSelection): ModelSelection {
  if (selection.mode === "platform" && selection.localEndpoint !== undefined) {
    throw new Error("Platform models cannot receive a user-configured endpoint.");
  }
  if (selection.mode === "local") {
    if (!selection.localEndpoint) throw new Error("A local model requires a loopback endpoint.");
    const endpoint = new URL(selection.localEndpoint);
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(endpoint.hostname)) {
      throw new Error("Local model endpoints must use loopback.");
    }
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error("Unsupported local endpoint protocol.");
  }
  return selection;
}
