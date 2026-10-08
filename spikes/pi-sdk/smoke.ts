import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import {
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const skillConfig = JSON.parse(await readFile(resolve(root, "skills/kdense-initial.json"), "utf8")) as {
  skills: string[];
  enabledSkills: string[];
};
const materialsxSkillConfig = JSON.parse(await readFile(resolve(root, "skills/materialsx-default.json"), "utf8")) as {
  skills: string[];
  enabledSkills: string[];
};
const enabledSkills = new Set([...skillConfig.enabledSkills, ...materialsxSkillConfig.enabledSkills]);
const skillRoots = [
  resolve(root, "vendor/kdense-scientific-agent-skills/skills"),
  resolve(root, "vendor/materialsx-default-skills/skills"),
];
const tempRoot = await mkdtemp(resolve(tmpdir(), "materialsx-pi-m0-"));
const agentDir = resolve(tempRoot, "agent");
await mkdir(agentDir, { recursive: true });

const serverPath = resolve(root, "spikes/mcp-server/server.ts");
const serverCommand = process.execPath;
const serverArgs = [resolve(root, "node_modules/tsx/dist/cli.mjs"), serverPath];
await writeFile(
  resolve(agentDir, "mcp.json"),
  `${JSON.stringify(
    {
      mcpServers: {
        materials_m0: {
          command: serverCommand,
          args: serverArgs,
          exposure: "direct",
          timeout: 10,
        },
      },
    },
    null,
    2,
  )}\n`,
);

const modelRuntime = await ModelRuntime.create({
  authPath: resolve(tempRoot, "auth.json"),
  modelsPath: resolve(tempRoot, "models.json"),
});
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
const resourceLoader = new DefaultResourceLoader({
  cwd: root,
  agentDir,
  settingsManager,
  additionalSkillPaths: skillRoots,
  extensionFactories: [
    createMcpExtension({
      loadConfig: () => ({
        servers: [
          {
            name: "materials_m0",
            config: { command: serverCommand, args: serverArgs, exposure: "direct", timeout: 10 },
            source: resolve(agentDir, "mcp.json"),
            scope: "global",
          },
        ],
        errors: [],
      }),
      logPath: resolve(tempRoot, "mcp.log"),
    }),
  ],
  skillsOverride: (current) => ({
    skills: current.skills.filter(
      (skill) =>
        skillRoots.some((skillRoot) => skill.baseDir.startsWith(skillRoot)) && enabledSkills.has(skill.name),
    ),
    diagnostics: current.diagnostics.filter((diagnostic) => {
      const diagnosticPath = "path" in diagnostic ? String(diagnostic.path) : "";
      return skillRoots.some((skillRoot) => diagnosticPath.startsWith(skillRoot));
    }),
  }),
  noContextFiles: true,
  noPromptTemplates: true,
  noThemes: true,
});

await resourceLoader.reload();
const { skills, diagnostics } = resourceLoader.getSkills();
if (diagnostics.length > 0) {
  throw new Error(`Pi reported skill diagnostics: ${JSON.stringify(diagnostics)}`);
}
if (skills.length !== enabledSkills.size) {
  throw new Error(`Expected ${enabledSkills.size} enabled Skills, found ${skills.length}`);
}

const { session } = await createAgentSession({
  cwd: root,
  agentDir,
  modelRuntime,
  resourceLoader,
  settingsManager,
  sessionManager: SessionManager.inMemory(root),
  tools: ["read", "find", "grep", "ls", "bash", "write", "mcp__materials_m0__materials_ping"],
});

try {
  const extensionErrors: string[] = [];
  await session.bindExtensions({ onError: (error) => extensionErrors.push(JSON.stringify(error)) });
  const deadline = Date.now() + 10_000;
  while (!session.getActiveToolNames().includes("mcp__materials_m0__materials_ping") && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  const activeTools = session.getActiveToolNames();
  const requiredExecutionTools = ["read", "find", "grep", "ls", "bash", "write"];
  const missingExecutionTools = requiredExecutionTools.filter((name) => !activeTools.includes(name));
  if (missingExecutionTools.length > 0) {
    throw new Error(`Pi execution tools did not register: ${missingExecutionTools.join(", ")}`);
  }
  if (!activeTools.includes("mcp__materials_m0__materials_ping")) {
    throw new Error(
      `MCP tool did not register. Active tools: ${activeTools.join(", ")}; all tools: ${session
        .getAllTools()
        .map((tool) => tool.name)
        .join(", ")}; extension errors: ${extensionErrors.join(" | ")}`,
    );
  }

  const client = new Client({ name: "materialsx-m0-verifier", version: "0.0.1" });
  class AuditedStdioTransport extends StdioClientTransport {
    negotiatedProtocolVersion: string | undefined;
    setProtocolVersion(version: string) { this.negotiatedProtocolVersion = version; }
  }
  const transport = new AuditedStdioTransport({
    command: serverCommand,
    args: serverArgs,
  });
  await client.connect(transport);
  if (transport.negotiatedProtocolVersion !== LATEST_PROTOCOL_VERSION) throw Error("MCP protocol version mismatch");
  const serverVersion = client.getServerVersion();
  const tools = await client.listTools();
  if (!tools.tools.some(tool => tool.name === "materials_ping" && tool.annotations?.readOnlyHint === true)) throw Error("MCP read-only capability missing");
  const result = (await client.callTool({ name: "materials_ping", arguments: { formula: "SiO2" } })) as {
    content: Array<{ type: string; text?: string }>;
  };
  await client.close();
  const text = result.content.find((part: { type: string; text?: string }) => part.type === "text");
  if (text?.type !== "text" || text.text !== "M0:SiO2") throw new Error("Unexpected MCP tool result");

  process.stdout.write(
    `${JSON.stringify({
      piPackage: "@earendil-works/pi-coding-agent@0.99.1",
      sessionCreated: true,
      modelSelected: session.model !== undefined,
      skillsLoaded: skills.length,
      executionToolsReady: requiredExecutionTools,
      mcpToolRegistered: true,
      mcpToolCalled: true,
      mcpResult: text.text,
      mcpProtocol: transport.negotiatedProtocolVersion,
      mcpServer: serverVersion,
    })}\n`,
  );
} finally {
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  session.dispose();
  await rm(tempRoot, { recursive: true, force: true });
}
