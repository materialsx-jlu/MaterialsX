import { mkdir, writeFile } from "node:fs/promises";
import { PiDiagnosticFailure, ROOTFLOW_TEST_MODEL, verifyPiResponsesFixture, verifyPiResponsesLive } from "../packages/pi-adapter/src/platform-probe.js";

const live = process.argv.includes("--live");

try {
  if (live && (!process.argv.includes("--key-stdin") || !process.argv.includes("--unbudgeted-test"))) {
    throw new Error("explicit_live_diagnostic_flags_required");
  }
  let key = "";
  if (live) {
    for await (const chunk of process.stdin) {
      key += String(chunk);
      if (Buffer.byteLength(key) > 4096) throw new Error("invalid_stdin_credential");
    }
    key = key.trim();
  }
  const result = live ? await verifyPiResponsesLive(key) : await verifyPiResponsesFixture();
  key = "";
  await mkdir("runtime/m5", { recursive: true });
  await writeFile(live ? "runtime/m5/pi-responses-live-sol.json" : "runtime/m5/pi-responses-fixture.json",
    `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(live ? "Pi Responses real-provider diagnostic passed; redacted evidence written" :
    "Pi 0.99.1 Responses fixture passed; no supplier request or fee");
} catch (error) {
  if (live) {
    // Replace prior success evidence on failure, never expose SDK error bodies.
    await mkdir("runtime/m5", { recursive: true });
    const diagnostic = error instanceof PiDiagnosticFailure ? error.diagnostic : null;
    await writeFile("runtime/m5/pi-responses-live-sol.json", `${JSON.stringify({
      schemaVersion: "m5.0-live-pi-v1", generatedAt: new Date().toISOString(),
      environment: diagnostic?.httpStatuses.length ? "real-provider" : "unverified",
      provider: "rootflowai", model: ROOTFLOW_TEST_MODEL, protocol: "openai-responses",
      status: "failed", reason: error instanceof PiDiagnosticFailure ? error.message : "diagnostic_failed",
      diagnostic,
    }, null, 2)}\n`, { mode: 0o600 });
  }
  console.error(live ? "Pi real-provider diagnostic failed; no credential or supplier payload logged" :
    "Pi offline Responses compatibility failed; no supplier payload logged");
  process.exitCode = 1;
}
