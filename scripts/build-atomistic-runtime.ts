import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parsePotentialRegistry } from "../packages/atomistic/src/registry.js";

const root = process.cwd();
const development = process.argv.includes("--development");
const portable = !development || process.argv.includes("--portable");
const platform = process.platform === "darwin" && process.arch === "arm64" ? "macos-arm64" : process.platform === "win32" && process.arch === "x64" ? "windows-x64" : null;
if (!platform) throw Error("M6.1 runtime requires macOS arm64 or Windows x64");
const output = join(root, "runtime/atomistic", platform);
const registry = parsePotentialRegistry(JSON.parse(await readFile(join(root,"models/potentials/registry.json"),"utf8")));
const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
async function command(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (data: Buffer) => { out += data.toString(); });
    child.stderr.on("data", (data: Buffer) => process.stderr.write(data));
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(out.trim()) : reject(Error(`uv ${args[0]} exited ${code}`)));
  });
}
const disk = await statfs(root);
const freeMiB = Number(disk.bavail) * Number(disk.bsize) / 1048576;
// Development uses shared uv hardlinks; the installer/portable build retains the frozen 8 GiB gate.
if (freeMiB < (development ? 3072 : 8192)) throw Error(`Insufficient free space: ${Math.floor(freeMiB)} MiB; ${development ? 3072 : 8192} MiB required`);
await mkdir(output, { recursive: true });

for (const potentialId of ["mace-mp-0b3-medium", "chgnet-0.3.0"]) {
  const potential = registry.potentials.find(p => p.id === potentialId)!;
  const family = potential.family.toLowerCase();
  const environment = join(root, "atomistic/environments", family);
  const lock = await readFile(join(environment,"uv.lock"));
  const existing=join(output,family,"RUNTIME.json");
  if(portable && existsSync(existing) && !process.argv.includes("--rebuild")){
    try{const receipt=JSON.parse(await readFile(existing,"utf8"));const base=join(output,family);if(receipt.portable&&receipt.python===(process.platform==="win32"?"python.exe":"bin/python3.12")&&receipt.environmentProfileId===potential.environment.profileId&&receipt.platform===platform&&receipt.potentialId===potentialId&&receipt.sourceRevision===potential.environment.codeRevision&&receipt.dependencyLockSha256===digest(lock)&&receipt.sha256===potential.weights.sha256&&receipt.bytes===potential.weights.bytes&&(await stat(join(base,"checkpoint.bin"))).size===receipt.bytes&&digest(await readFile(join(base,"checkpoint.bin")))===receipt.sha256){
      const {stdout}=await promisify(execFile)(join(base,receipt.python),["-I","-c",`import sys,pathlib,torch,ase,numpy,${family}; assert pathlib.Path(sys.executable).resolve().parent.parent in pathlib.Path(torch.__file__).resolve().parents if sys.platform!='win32' else pathlib.Path(sys.executable).resolve().parent in pathlib.Path(torch.__file__).resolve().parents; assert sys.version.split()[0]=='3.12.10'; assert torch.__version__.split('+')[0]=='2.8.0'; assert ase.__version__=='3.26.0'; assert numpy.__version__=='2.2.6'; print('reused')`],{timeout:60000,maxBuffer:1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});if(stdout.includes("reused")){console.log(`Retained matching portable ${family}; use --rebuild for an explicit rebuild`);continue;}
    }}catch{/* A missing/invalid existing runtime is rebuilt from locked dependencies. */}
  }
  await command(["python", "install", "3.12.10"]);
  const envDir = join(root,"runtime/m6-environments",family);
  await command(["sync", "--project", environment, "--frozen", "--no-dev"], { UV_PROJECT_ENVIRONMENT: envDir });
  const familyDir = join(output, family);
  await mkdir(familyDir,{recursive:true});
  let python = process.platform === "win32" ? join(envDir,"Scripts/python.exe") : join(envDir,"bin/python");
  if (portable) {
    const managed = await command(["python", "find", "3.12.10", "--managed-python"]);
    const pythonRoot = process.platform === "win32" ? dirname(managed) : dirname(dirname(managed));
    const staging = `${familyDir}.staging`;
    await rm(staging,{recursive:true,force:true});
    await cp(pythonRoot,staging,{recursive:true,dereference:true});
    const site = process.platform === "win32" ? "Lib/site-packages" : "lib/python3.12/site-packages";
    await rm(join(staging,site),{recursive:true,force:true});
    await cp(join(envDir,site),join(staging,site),{recursive:true,dereference:true});
    const existingWeight=join(familyDir,"checkpoint.bin");
    if(existsSync(existingWeight)&&(await stat(existingWeight)).size===potential.weights.bytes&&digest(await readFile(existingWeight))===potential.weights.sha256)await copyFile(existingWeight,join(staging,"checkpoint.bin"));
    // The weights are copied after staging; no source venv or global interpreter is shipped.
    await rm(familyDir,{recursive:true,force:true});
    await rename(staging,familyDir);
    python = join(familyDir, process.platform === "win32" ? "python.exe" : "bin/python3.12");
  }
  const weight = join(familyDir,"checkpoint.bin");
  let valid = existsSync(weight) && (await stat(weight)).size === potential.weights.bytes && digest(await readFile(weight)) === potential.weights.sha256;
  if (!valid) {
    console.log(`Downloading pinned ${potentialId} (${potential.weights.bytes} bytes)`);
    const response = await fetch(potential.weights.url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw Error(`Weight HTTP ${response.status}`);
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if(size > potential.weights.bytes!) throw Error("Weight size exceeds pinned limit"); chunks.push(Buffer.from(chunk)); }
    const data = Buffer.concat(chunks);
    if(size !== potential.weights.bytes || digest(data) !== potential.weights.sha256) throw Error("Weight digest mismatch");
    await writeFile(`${weight}.tmp`,data,{mode:0o600}); await rename(`${weight}.tmp`,weight);
    valid = true;
  }
  const receipt = { version: "m6.1-v1", platform, potentialId, environmentProfileId: potential.environment.profileId,
    sourceRevision: potential.environment.codeRevision, dependencyLockSha256: digest(lock), python: portable ? (process.platform === "win32" ? "python.exe" : "bin/python3.12") : python,
    portable, weight: "checkpoint.bin", sha256: potential.weights.sha256, bytes: potential.weights.bytes,
    createdAt: new Date().toISOString(), runtimeValidation: "pending", scientificQuality: "needs_review" };
  await writeFile(join(familyDir,"RUNTIME.json"),JSON.stringify(receipt,null,2)+"\n");
  await cp(join(root,"docs/m6/licenses"),join(familyDir,"licenses"),{recursive:true});
  await promisify(execFile)(python,[join(root,"atomistic/dependency_inventory.py"),join(familyDir,"licenses/dependencies")],{timeout:60_000,maxBuffer:1024*1024});
  console.log(`Ready ${family}: ${portable ? "portable runtime" : "isolated development environment"}; runtime probe still required`);
}
