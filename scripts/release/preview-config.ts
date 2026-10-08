import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const platform = process.argv[2];
if (!['mac', 'win', 'linux'].includes(platform ?? '')) throw Error('Usage: preview-config.ts mac|win|linux');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (!pkg.version.includes('-preview.')) throw Error('PREVIEW_VERSION_REQUIRED');
const output = resolve('release/dist', pkg.version);
const state = resolve('runtime/release-build', platform!);
await mkdir(state, {recursive:true});
const fullMac = platform === 'mac' && !process.argv.includes('--core');
const resources = pkg.build.extraResources.filter((r:{to:string})=>fullMac || !['model-packages', 'offline-bundle-manifest.json'].includes(r.to));
const docs = resources.find((r:{to:string})=>r.to==='docs');
if (docs) docs.filter = [...docs.filter, 'agent/preview-release.md', 'agent/preview-release-0.2.md', 'agent/AGENT_RELIABILITY_PATCH_PLAN.md', 'agent/ap-*.md'];
resources.push({from:join(state,'release-support.json'),to:'release-support.json'});
const config = {
 ...pkg.build, extends:null, publish:null,
 directories:{output, buildResources:'assets/brand'},
 extraResources:resources,
 // Seal the renamed Electron bundle without claiming a trusted certificate or notarization.
 // Runtime manifests bind upstream bytes; do not re-sign their embedded executables.
 mac:{...pkg.build.mac, identity:'-', hardenedRuntime:false,
  signIgnore:['/Contents/Resources/(agent-runtime|python-runtime|atomistic-runtime|native-engines|model-packages)(/|$)'],
  icon:'assets/brand/materialsx-atom-depth-1024.png',
  ...(!fullMac?{extraResources:[{from:'runtime/skill-python/macos-arm64',to:'python-runtime'}]}:{})},
 win:{...pkg.build.win, signAndEditExecutable:false,
  extraResources:[{from:'runtime/skill-python/windows-x64',to:'python-runtime'}]},
 linux:{category:'Science', executableName:'materialsx', icon:'assets/brand/materialsx-atom-depth-512.png',
  target:[{target:'AppImage',arch:['x64']},{target:'tar.gz',arch:['x64']}],
  extraResources:[{from:'runtime/skill-python/linux-x64',to:'python-runtime'}]},
};
const support = {
 schemaVersion:'materialsx-preview-v1', version:pkg.version, channel:'preview', platform,
 formalReleaseReady:false, signed:false,
 core:['bilingual-skills','model-catalog','Pi','bundled-Codex-App-Server','PDF-Python','research-workspace'],
 atomicRuntimeBundled:fullMac, atomicRuntimeScope:fullMac?'macOS arm64 reviewed M6 profiles':'not bundled; directory entries are not installed models',
 nativeCodexExecution:platform==='mac'?'macOS sandbox; model qualification remains scoped':'disabled pending project isolation qualification',
 platformWorkspaceShell:platform==='mac'?'macOS sandbox':'disabled; file/host tools remain available',
 localPiShell:'Local-user grant only; OS isolation outside macOS remains unqualified',
 limits:['not scientific certification','no bundled chat-model weights','production cloud configuration required','unsigned preview'],
};
await writeFile(join(state,'release-support.json'),JSON.stringify(support,null,2)+'\n');
await writeFile(join(state,'builder.json'),JSON.stringify(config,null,2)+'\n');
console.log(join(state,'builder.json'));
