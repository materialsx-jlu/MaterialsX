import { listPackage, extractFile, uncache } from "@electron/asar";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
const patterns = [
  /\bsk-[A-Za-z0-9_-]{24,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
];
export function productionPath(path) {
  const p = path.replaceAll("\\", "/").replace(/^\//, "");
  return !/(^|\/)(?:fixtures|tests|spikes|scripts|__tests__|\.env[^/]*|materials-output)(?:\/|$)|(?:\.test\.|(?:^|\/)[^/]*smoke[^/]*\.(?:c?js|mjs|ts)$)|\.(?:db|sqlite3?|pem|pfx|p12|key|dump|backup)$|platform-session\.bin/i.test(
    p,
  );
}
export function publicResourcePath(path) {
  const p = path.replaceAll("\\", "/");
  if (
    /(^|\/)(?:\.env(?:\.[^/]+)?|materials-output)(?:\/|$)|\.(?:db|sqlite3?|pem|pfx|p12|key|dump|backup)$|platform-session\.bin/i.test(
      p,
    )
  )
    return false;
  // Skill scripts and their authored examples are real product assets, not development harnesses.
  return p.startsWith("vendor/") || p.startsWith("skills/")
    ? true
    : productionPath(p);
}
export function checkPublicText(text) {
  return patterns.some((p) => p.test(text));
}
/** Actual packaged bytes, not package.json promises. Third-party code is covered by license review, not relabeled as our source. */
export async function auditProductionPackage(resources) {
  const asar = join(resources, "app.asar");
  uncache(asar);
  const names = listPackage(asar),
    findings = [],
    hashes = [];
  for (const path of names) {
    const p = path.replaceAll("\\", "/").replace(/^\/+/, "");
    if (p.startsWith("node_modules/")) continue;
    if (!productionPath(p)) {
      findings.push(p + ":forbidden-build-content");
      continue;
    }
    if (/\.(?:[cm]?js|json|md|html|css)$/.test(p)) {
      const bytes = extractFile(asar, p.replaceAll("/", sep));
      if (checkPublicText(bytes.toString("utf8")))
        findings.push(p + ":credential-pattern");
      hashes.push([p, createHash("sha256").update(bytes).digest("hex")]);
    }
  }
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, e.name),
        p = relative(resources, path).replaceAll("\\", "/");
      if (e.isSymbolicLink()) {
        findings.push(p + ":unexpected-symlink");
        continue;
      }
      if (
        [
          "app.asar",
          "app.asar.unpacked",
          "agent-runtime",
          "atomistic-runtime",
          "python-runtime",
          "native-engines",
          "model-packages",
        ].includes(p)
      )
        continue;
      if (e.isDirectory()) {
        if (!publicResourcePath(p)) findings.push(p + ":private-directory");
        else await walk(path);
      } else {
        if (!publicResourcePath(p)) findings.push(p + ":private-file");
        if (
          /\.(?:json|md|txt|py|js|mjs|cjs|html)$/.test(p) &&
          e.isFile() &&
          (await lstat(path)).size <= 2 * 1024 * 1024 &&
          checkPublicText(await readFile(path, "utf8"))
        )
          findings.push(p + ":credential-pattern");
      }
    }
  }
  await walk(resources);
  const report = {
    schemaVersion: "ua14-package-audit-v1",
    passed: findings.length === 0,
    checkedApplicationFiles: hashes.length,
    sourceFilesSha256: createHash("sha256")
      .update(JSON.stringify(hashes))
      .digest("hex"),
    findings,
    coverage:
      "Application ASAR and selected first-party resources. Bundled third-party runtimes/weights require their own digest/license checks.",
  };
  if (findings.length)
    throw Error("MaterialsX package audit blocked: " + findings.join(", "));
  return report;
}
