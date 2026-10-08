import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { permissionGrantSchema } from "../../contracts/src/agent.js";
import { requestedGrant } from "./request-limits.js";
const grant = permissionGrantSchema.parse({
  grantId: randomUUID(),
  projectId: randomUUID(),
  conversationId: randomUUID(),
  permissions: ["read", "search", "terminal", "patch", "network"],
  approvedBy: "local-user",
  maxCredits: "500",
  maxSeconds: 600,
});
test("explicit bilingual limits reduce host grant; material target is not budget", () => {
  const p = requestedGrant(
    grant,
    "强度最多100 MPa；限时2分钟，预算10积分，不要联网，不允许执行脚本",
  );
  assert.equal(p.maxSeconds, 120);
  assert.equal(p.maxCredits, "10");
  assert(!p.permissions.includes("network"));
  assert(!p.permissions.includes("terminal"));
  assert.equal(
    requestedGrant(
      grant,
      "Within 20 seconds, at most 2 credits. Do not write files.",
    ).maxSeconds,
    20,
  );
  assert(
    !requestedGrant(grant, "Do not write files").permissions.includes("patch"),
  );
  assert.equal(
    requestedGrant(grant, "time limit 10 hours; budget 1000 credits")
      .maxSeconds,
    600,
  );
  assert.equal(requestedGrant(grant, "强度1000 MPa").maxCredits, "500");
  assert.throws(() => requestedGrant(grant, "限时0秒"));
});
