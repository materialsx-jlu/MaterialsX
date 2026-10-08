import {profilePath} from './profile-path.js';
import {selectedFileMetadata,snapshotAttachmentFile} from './cloud-files.js';
import {modelStateReader} from './potential-model-states.js';
import {TeamResearchWorkspace} from "./team-research.js";
import {registerTeamResearchIpc} from "./team-research-ipc.js";
import {AgentWorkspace} from './agent-workspace.js';
import {registerAgentWorkspaceIpc} from './agent-workspace-ipc.js';
import {PublicResearchNetwork} from "../../../packages/agent/src/papers/network.js";
import {createResearchFetch} from "./research-network.js";
import {ResearchPaperService} from "./paper-service.js";
import {registerAgentConfiguration} from "./agent-configuration.js";
import {ResearchService} from "./research-service.js";
import {registerResearchIpc} from "./research-ipc.js";
import {DesktopAgentRuntime} from './agent-runtime.js';
import {registerAgentMessaging} from './agent-messaging.js';
import { loadBuiltinSkills as readBuiltinSkills, loadBuiltinSkillState, loadResearchModels as readResearchModels, loadPotentialRegistry as readPotentialRegistry } from "./catalog-loader.js";
import { labelLocalSupervisorSkills } from './supervisor-local-metadata.js';
import { mxPointsDiagnostic, runtimeDiagnostics } from "./runtime-diagnostics.js";
import { loadedBuildIdentity } from "./build-identity.js";
import { saveSupportBundle } from "./support-bundle.js";
import {CatalogWeightManager} from '../../../packages/atomistic/src/catalog-weights.js';
import {catalogWeightRequest} from '../../../packages/contracts/src/catalog-weights.js';
import {currentScientificScopeSchema as scientificScopeSchema,type ScientificScope} from '../../../packages/contracts/src/potential-physics.js';
import {PotentialDistributionService} from '../../../packages/atomistic/src/potential-distribution.js';
import {storageSelectionSchema} from '../../../packages/contracts/src/potential-distribution.js';
import {inspectReproductionReceipt} from '../../../packages/atomistic/src/reproduction-receipt.js';
import {CatalogUpdateService} from '../../../packages/atomistic/src/catalog-updates.js';
import {PotentialDiscoveryService} from '../../../packages/atomistic/src/potential-discovery.js';
import {discoverySearchSchema,discoverySyncSchema} from '../../../packages/contracts/src/potential-discovery.js';
import {ownedText} from '../../../packages/atomistic/src/discovery-io.js';
import { mountReviewedCatalog } from "../../../packages/atomistic/src/mounted-catalog.js";
import { PotentialAnalysisService } from "../../../packages/atomistic/src/potential-workflow.js";
import { UserSkillService } from "../../../packages/atomistic/src/user-skills.js";
import { SkillInstallationService } from "../../../packages/skills/src/installation-service.js";
import { GitHubSkillSource } from "../../../packages/skills/src/skill-sources.js";
import { registerSkillInstallationIpc } from "./skill-installation.js";
import { createInstalledSkillTools } from "../../../packages/pi-adapter/src/installed-skill-tools.js";
import { applicationCapabilities } from './application-capabilities.js';
import { analysisScopeSchema,currentAnalysisRequestSchema as analysisRequestSchema,freezeAnalysisSchema,type AnalysisScope } from "../../../packages/contracts/src/potential-workflow.js";
import { mountedPackageRequest,selectedRunSchema as mountedSelectedRunSchema } from "../../../packages/contracts/src/potential-packages.js";
import { userSkillDraftSchema } from "../../../packages/contracts/src/potential-hub.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import { selectionRequestSchema } from "../../../packages/contracts/src/potential-physics.js";
import { trajectoryRequestSchema, mdPngExportSchema } from "../../../packages/contracts/src/atomistic-dynamics.js";

import {ticketsSchema,ticketSchema,newTicketSchema,ticketReplySchema,attachmentInputSchema,attachmentSchema} from "../../../packages/contracts/src/lifecycle.js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath, writeFile, open, rename, rm } from "node:fs/promises";
import { arch, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import {registerMxPointsIpc} from './mx-points-ipc.js';
import { IdentityClient, IdentityLoginError } from "../../../packages/control-plane-client/src/identity.js";
import { SystemCredentialVault } from "./credential-vault.js";
import type { ConnectionSummary, DesktopBootstrap, MessageStreamEvent, ModelSettings, ReleaseReadiness, SkillSummary } from "../../../packages/contracts/src/desktop.js";
import {billingActivitySchema,workspaceStatusSchema,taskBillsSchema,taskRequestsSchema,releasesSchema,walletSchema,creditLedgerSchema,unsignedInteger,paymentPlansSchema,paymentOrdersSchema,orderSchema,paymentRefundsSchema,paymentRefundSchema,refundInputSchema,subscriptionPeriodsSchema} from "../../../packages/contracts/src/platform.js";
import { validateModelSelection } from "../../../packages/pi-adapter/src/capabilities.js";
import { discoverLocalModels, PiLocalSessionService } from "../../../packages/pi-adapter/src/local-session.js";
import { PiPlatformSessionService, type CloudAsset } from "../../../packages/pi-adapter/src/platform-session.js";


import { ControlPlaneClient } from "../../../packages/control-plane-client/src/index.js";
import { createReleaseReadiness } from "../../../packages/release-readiness/src/index.js";
import { WorkspaceStore, loadJson } from "./store.js";
import { createCatalogTools } from "../../../packages/pi-adapter/src/catalog-tools.js";
import { buildPotentialCatalog,searchCatalog,searchSkills,findCatalogEntry } from "../../../packages/atomistic/src/potential-hub.js";
import { catalogId } from "../../../packages/contracts/src/potential-hub.js";
import { ScientificValidationService } from "../../../packages/atomistic/src/scientific-validation.js";
import { packageRequestSchema } from "../../../packages/contracts/src/atomistic-validation.js";
import { AtomisticRuntime } from "../../../packages/atomistic/src/runtime.js";
import { localId } from "../../../packages/contracts/src/atomistic-runtime.js";
import { atomicPngExportSchema, atomicViewRequestSchema } from "../../../packages/contracts/src/atomic-viewer.js";
import { cleanAtomicPng } from "./atomic-export.js";
import { createAtomisticTools } from "../../../packages/pi-adapter/src/atomistic-tools.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const developmentRoot = resolve(currentDir, "../../../..");
const packaged = app.isPackaged && process.env.MATERIALSX_DEV_BUNDLE !== '1';
const projectRoot = packaged ? process.resourcesPath : developmentRoot;
const currentBuild = loadedBuildIdentity(resolve(currentDir, "../../.."));
let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;
let store: WorkspaceStore;
let agentRuntime:DesktopAgentRuntime;
let agentWorkspace:AgentWorkspace;
let researchService:ResearchService;
let piSessions: PiLocalSessionService;
let atomistic: AtomisticRuntime;
let catalogUpdates:CatalogUpdateService;
let potentialDistribution:PotentialDistributionService;
let catalogWeights:CatalogWeightManager;
const loadingModels=new Set<string>();
const loadedModels=new Set<string>();
let potentialDiscovery:PotentialDiscoveryService;
let discoveryTimer:ReturnType<typeof setInterval>|null=null;
let potentialAnalysis:PotentialAnalysisService;
let userSkills:UserSkillService;
let installedSkills:SkillInstallationService;
const analysisScopes=new Map<string,AnalysisScope>();
let scientificValidation:ScientificValidationService;
const scienceScopes=new Map<string,ScientificScope>();
const requestAtomicView=(projectId:string,structureId:string)=>mainWindow?.webContents.send("atomistic:view-request",{kind:"import",projectId,structureId});
let identityClient: IdentityClient;
let teamResearch: TeamResearchWorkspace;
let platformSessions: PiPlatformSessionService;
const cloudFiles = new Map<string, CloudAsset[]>();
const activeConversations = new Set<string>();
const controlPlane = new ControlPlaneClient();

const rootPackage = loadJson<{version: string}>(join(projectRoot, "package.json"))
  ?? (packaged ? loadJson<{version: string}>(join(projectRoot, "app.asar", "package.json")) : null);
const supervisorLocalMetadata = loadJson<Record<string, { zh: string; en: string; example: string }>>(join(projectRoot, 'skills/supervisor-local-metadata.json')) ?? {};
const loadSkills = (): SkillSummary[] => [...readBuiltinSkills(projectRoot), ...(userSkills?.summaries() ?? []), ...labelLocalSupervisorSkills(projectRoot, installedSkills?.summaries() ?? [], installedSkills?.list() ?? [], supervisorLocalMetadata)];
const loadResearchModels = () => readResearchModels(projectRoot);
const loadPotentialRegistry = () => readPotentialRegistry(projectRoot);
let potentialCatalogCache: ReturnType<typeof buildPotentialCatalog> | null = null;
function loadPotentialCatalog() {
  if (potentialCatalogCache) return potentialCatalogCache;
  const base = mountReviewedCatalog(projectRoot, buildPotentialCatalog(loadPotentialRegistry(), loadJson<unknown>(join(projectRoot, "models/potentials/catalog-m67.json"))));
  return potentialCatalogCache = catalogUpdates ? catalogUpdates.catalog(base) : base;
}

const diagnostics = () => runtimeDiagnostics(projectRoot, store.getSettings(),()=>mxPointsDiagnostic(identityClient),()=>researchService.diagnostic());

async function bootstrap(): Promise<DesktopBootstrap> {
  return {
    appVersion: rootPackage?.version ?? app.getVersion(),
    buildIdentity: await currentBuild,
    platform: `${platform()} · ${hostname()}`,
    projects: store.listProjects(),
    conversations: store.listConversations().filter(c=>!agentRuntime?.subtasks.scope(c.id)),
    settings: store.getSettings(),
    skills: loadSkills(),
    models: loadResearchModels(),
    potentialRegistry: loadPotentialRegistry(),
    potentialCatalog: loadPotentialCatalog(),
    connections: await diagnostics(),
    runs: store.listRuns(),
  };
}

async function releaseReadiness(currentDiagnostics?: ConnectionSummary[]): Promise<ReleaseReadiness> {
  const connections = currentDiagnostics ?? (await diagnostics());
  const loadedSkills = loadSkills();
  const summary = store.getSupportSummary();
  return createReleaseReadiness({
    version: rootPackage?.version ?? app.getVersion(),
    target: (rootPackage?.version ?? app.getVersion()).startsWith("0.2.0-preview.") ? "v0.2-preview" : "v1",
    platform: `${platform()}-${arch()}`,
    packaged: packaged,
    signed: process.env.MATERIALSX_RELEASE_SIGNED === "1",
    skillCount: loadedSkills.filter((item) => item.enabled).length,
    licenseBlocked: loadedSkills.filter((item) => item.license === "待复核").length,
    databaseIntegrity: summary.databaseIntegrity,
    runtimeReady: connections.filter((item) => item.status === "ready").length,
    runtimeTotal: connections.length,
    macOSInstallEvidence: existsSync(join(projectRoot, "release/evidence/macos-arm64-install.json")),
    windowsInstallEvidence: existsSync(join(projectRoot, "release/evidence/windows-x64-install.json")),
    scienceEvaluationEvidence: existsSync(join(projectRoot, "release/evidence/science-holdout.json")),
    updateRollbackEvidence: existsSync(join(projectRoot, "release/evidence/update-rollback.json")),
  });
}

const exportSupportBundle = () => saveSupportBundle({ mainWindow, store, diagnostics, releaseReadiness, version: rootPackage?.version ?? app.getVersion() });

function assertText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 20_000) {
    throw new Error(`${field} 无效`);
  }
  return value.trim();
}

function sendMessageStream(event: MessageStreamEvent): void {
  const target = mainWindow;
  if (target && !target.isDestroyed()) target.webContents.send("workspace:message-stream", event);
}

function registerIpc(): void {
  registerResearchIpc(researchService,()=>mainWindow);
  registerTeamResearchIpc(teamResearch);
  registerAgentWorkspaceIpc(agentWorkspace,agentRuntime);
  const readModelStates=modelStateReader({runtime:atomistic,catalog:loadPotentialCatalog,weights:catalogWeights,assertUsable:id=>catalogUpdates.assertUsable(id),loaded:loadedModels,loading:loadingModels});
  ipcMain.handle('potentials:model-states',()=>readModelStates());
  ipcMain.handle('potentials:catalog-weight-download',(_e,q:unknown)=>catalogWeights.download(catalogWeightRequest.parse(q).potentialId));
  ipcMain.handle('potentials:catalog-weight-cancel',(_e,q:unknown)=>catalogWeights.cancel(catalogWeightRequest.parse(q).potentialId));
  ipcMain.handle('potentials:catalog-weight-import',async(_e,q:unknown)=>{const id=catalogWeightRequest.parse(q).potentialId;const f=await dialog.showOpenDialog(mainWindow!,{properties:['openFile'],filters:[{name:'Model checkpoint',extensions:['bin','model','pt','pth','ckpt','cp']}]});if(f.canceled||!f.filePaths[0])return false;await catalogWeights.importFile(id,f.filePaths[0]);return true;});
  ipcMain.handle('potentials:catalog-weight-reveal',async(_e,q:unknown)=>{const id=catalogWeightRequest.parse(q).potentialId;const r=atomistic.status().find(r=>r.potentialId===id);const file=r?.installed?await atomistic.checkpointFile(id):await catalogWeights.cachedFile(id);shell.showItemInFolder(file);});
  ipcMain.handle('potentials:model-load',async(_e,q:unknown)=>{
    const id=catalogWeightRequest.parse(q).potentialId;if(loadingModels.size)throw Error('SCIENCE_BUSY');loadedModels.delete(id);loadingModels.add(id);mainWindow?.webContents.send('potentials:model-changed');
    try{const receipt=await atomistic.loadPotential(id);loadedModels.add(id);return receipt;}
    finally{loadingModels.delete(id);mainWindow?.webContents.send('potentials:model-changed');}
  });
  ipcMain.handle("potentials:packages",async()=>{const p=await atomistic.mountedPackages.status();return p.map(s=>{let error=s.error;try{catalogUpdates.assertUsable(s.potentialId);}catch(e){error=e instanceof Error?e.message:"POTENTIAL_WITHDRAWN";}return {...s,error,runtimeReady:atomistic.environmentReady(s.potentialId)};});});
  ipcMain.handle("potentials:download",(_e,input:unknown)=>atomistic.mountedPackages.download(mountedPackageRequest.parse(input).potentialId));
  ipcMain.handle("potentials:cancel-download",(_e,id:unknown)=>atomistic.mountedPackages.cancel(localId.parse(id)));
  ipcMain.handle("potentials:uninstall",(_e,id:unknown)=>{const pid=localId.parse(id);if(potentialAnalysis.busy(pid))throw Error('PACKAGE_IN_USE');return atomistic.mountedPackages.uninstall(pid);});
  ipcMain.handle("potentials:disable",(_e,input:unknown)=>{const q=z.strictObject({potentialId:localId,disabled:z.boolean()}).parse(input);if(potentialAnalysis.busy(q.potentialId))throw Error('PACKAGE_IN_USE');return atomistic.mountedPackages.setDisabled(q.potentialId,q.disabled);});
  ipcMain.handle("potentials:import",async(_e,input:unknown)=>{const q=mountedPackageRequest.parse(input);atomistic.mountedPackages.entry(q.potentialId);const f=await dialog.showOpenDialog(mainWindow!,{properties:['openFile'],filters:[{name:'Reviewed checkpoint',extensions:['bin','model','tar']}]});if(f.canceled||!f.filePaths[0])return false;await atomistic.mountedPackages.importFile(q.potentialId,f.filePaths[0]);return true;});
  ipcMain.handle("potentials:assess-analysis",(_e,input:unknown)=>potentialAnalysis.assess(analysisRequestSchema.parse(input)));
  ipcMain.handle("potentials:freeze-analysis",(_e,input:unknown)=>{const q=z.strictObject({projectId:localId,proposal:freezeAnalysisSchema}).parse(input);return potentialAnalysis.freeze(q.projectId,q.proposal);});
  ipcMain.handle("potentials:approve-analysis",(_e,input:unknown)=>{const q=z.strictObject({projectId:localId,id:localId,planSha256:z.string().regex(/^[a-f0-9]{64}$/)}).parse(input);return potentialAnalysis.approve(q.projectId,q.id,q.planSha256);});
  ipcMain.handle("potentials:workflows",(_e,id:unknown)=>potentialAnalysis.list(localId.parse(id)));
  ipcMain.handle("potentials:cancel-analysis",(_e,input:unknown)=>{const q=z.strictObject({projectId:localId,id:localId}).parse(input);return potentialAnalysis.cancel(q.projectId,q.id);});
  ipcMain.handle("potentials:analysis-scope",(_e,input:unknown)=>{const scope=analysisScopeSchema.parse(input);if(activeConversations.has(scope.conversationId)||!store.listConversations().some(c=>c.id===scope.conversationId&&c.projectId===scope.projectId))throw Error('CONVERSATION_NOT_IDLE_OR_OWNED');const science=scienceScopes.get(scope.conversationId);if(!science||science.structureId!==scope.structureId||science.permission!==scope.permission||scope.maxSteps<(science.options?.maxSteps??1))throw Error('SCIENTIFIC_SCOPE_REQUIRED');analysisScopes.set(scope.conversationId,scope);piSessions.invalidate(scope.conversationId);return scope;});
  ipcMain.handle("skills:user-list",()=>userSkills.list());
  ipcMain.handle("skills:preview",(_e,input:unknown)=>userSkills.preview(input));
  ipcMain.handle("skills:save",(_e,input:unknown)=>{const q=z.strictObject({draft:userSkillDraftSchema,expectedRevision:z.number().int().positive().nullable()}).parse(input);if(activeConversations.size)throw Error('SKILL_CHANGE_REQUIRES_IDLE_CONVERSATIONS');const result=userSkills.save(q.draft,q.expectedRevision);piSessions.dispose();platformSessions.dispose();return result;});
  ipcMain.handle("skills:enable",(_e,input:unknown)=>{const q=z.strictObject({name:z.string(),enabled:z.boolean()}).parse(input);if(activeConversations.size)throw Error('SKILL_CHANGE_REQUIRES_IDLE_CONVERSATIONS');const result=userSkills.setEnabled(q.name,q.enabled);piSessions.dispose();platformSessions.dispose();return result;});
  ipcMain.handle("skills:delete",(_e,input:unknown)=>{const q=z.strictObject({name:z.string(),revision:z.number().int().positive()}).parse(input);if(activeConversations.size)throw Error('SKILL_CHANGE_REQUIRES_IDLE_CONVERSATIONS');userSkills.remove(q.name,q.revision);piSessions.dispose();platformSessions.dispose();});

  ipcMain.handle("atomistic:electronic-state",(_event,input:unknown)=>atomistic.annotateElectronicState(input));
  ipcMain.handle("atomistic:assess",(_event,input:unknown)=>atomistic.assess(selectionRequestSchema.parse(input)));
  ipcMain.handle("atomistic:start-selected",(_event,input:unknown)=>atomistic.startSelected(mountedSelectedRunSchema.parse(input)));
  ipcMain.handle("atomistic:list-structures",(_event,projectId:unknown)=>atomistic.listStructures(localId.parse(projectId)));
  ipcMain.handle("atomistic:import-sample",(_event,input:unknown)=>{const q=z.strictObject({projectId:localId,sampleId:localId}).parse(input);return atomistic.importSample(q.projectId,q.sampleId);});
  ipcMain.handle("atomistic:scope",(_event,input:unknown)=>{
    const scope=scientificScopeSchema.parse(input);
    if(!store.listConversations().some(c=>c.id===scope.conversationId&&c.projectId===scope.projectId)||activeConversations.has(scope.conversationId))throw Error("请选择空闲的项目对话");
    atomistic.inspect({projectId:scope.projectId,structureId:scope.structureId});scienceScopes.set(scope.conversationId,scope);analysisScopes.delete(scope.conversationId);piSessions.invalidate(scope.conversationId);return scope;
  });
  ipcMain.handle("atomistic:clear-scope",(_event,id:unknown)=>{const conversationId=localId.parse(id);if(activeConversations.has(conversationId))throw Error("对话正在运行");scienceScopes.delete(conversationId);analysisScopes.delete(conversationId);piSessions.invalidate(conversationId);});
  ipcMain.handle("atomistic:get-scope",(_event,id:unknown)=>scienceScopes.get(localId.parse(id))??null);
  ipcMain.handle("science:packages",async()=>{const list=await atomistic.packages.status();return list.map(p=>({...p,runtimeReady:p.state==="installed"&&atomistic.status().some(r=>r.potentialId===p.potentialId&&r.installed)}));});
  ipcMain.handle("science:download-package",(_event,input:unknown)=>atomistic.packages.download(input));
  ipcMain.handle("science:cancel-package",()=>atomistic.packages.cancel());
  ipcMain.handle("science:disable-package",(_event,input:unknown,disabled:unknown)=>{if(typeof disabled!=="boolean")throw Error("INVALID_PACKAGE_STATE");const q=packageRequestSchema.parse(input);if(potentialAnalysis.busy(q.potentialId)||atomistic.packageInUse(q.potentialId))throw Error("PACKAGE_IN_USE");return atomistic.packages.setDisabled(q,disabled);});
  ipcMain.handle("science:import-package",async(_event,input:unknown)=>{const q=packageRequestSchema.parse(input);const file=await dialog.showOpenDialog(mainWindow!,{properties:["openFile"],filters:[{name:"Pinned CHGNet r2SCAN checkpoint",extensions:["bin","tar"]}]});if(file.canceled||!file.filePaths[0])return false;if(potentialAnalysis.busy(q.potentialId)||atomistic.packageInUse(q.potentialId))throw Error("PACKAGE_IN_USE");await atomistic.packages.importFile(q,file.filePaths[0]);return true;});
  ipcMain.handle("science:import-dataset",async(_event,id:unknown)=>{const projectId=localId.parse(id);if(!store.getProject(projectId))throw Error("UNKNOWN_PROJECT");const file=await dialog.showOpenDialog(mainWindow!,{properties:["openFile"],filters:[{name:"MaterialsX scientific holdout JSON",extensions:["json"]}]});if(file.canceled||!file.filePaths[0])return false;await scientificValidation.importDataset(projectId,file.filePaths[0]);return true;});
  ipcMain.handle("science:datasets",(_event,id:unknown)=>scientificValidation.listDatasets(localId.parse(id)));
  ipcMain.handle("science:matrix",(_event,id:unknown)=>scientificValidation.matrix(localId.parse(id)));
  ipcMain.handle("science:evaluate",(_event,input:unknown)=>scientificValidation.start(input));
  ipcMain.handle("science:evaluations",(_event,id:unknown)=>scientificValidation.list(localId.parse(id)));
  ipcMain.handle("science:cancel-evaluation",(_event,input:{projectId:unknown;id:unknown})=>scientificValidation.cancel(localId.parse(input.projectId),localId.parse(input.id)));
  ipcMain.handle("science:export-evaluation",async(_event,input:{projectId:unknown;id:unknown})=>{const record=scientificValidation.list(localId.parse(input.projectId)).find(r=>r.id===localId.parse(input.id));if(!record?.report||record.status!=="completed")throw Error("EVALUATION_REPORT_NOT_AVAILABLE");const save=await dialog.showSaveDialog(mainWindow!,{defaultPath:`materialsx-evaluation-${record.id}.json`,filters:[{name:"Scientific evaluation JSON",extensions:["json"]}]});if(save.canceled||!save.filePath)return false;await writeFile(save.filePath,JSON.stringify(record.report,null,2)+"\n",{mode:0o600});return true;});
  ipcMain.handle("atomistic:md",(_event,input:unknown)=>atomistic.startMD(input));
  ipcMain.handle("atomistic:trajectory",(_event,input:unknown)=>atomistic.trajectory(input));
  ipcMain.handle("atomistic:frame",(_event,input:unknown)=>atomistic.trajectoryFrame(input));
  ipcMain.handle("atomistic:compare-md",(_event,input:unknown)=>atomistic.compareMD(input));
  ipcMain.handle("atomistic:export-md-png",async(_event,input:unknown)=>{
    const q=mdPngExportSchema.parse(input);const frame=await atomistic.trajectoryFrame(q.request);const bytes=cleanAtomicPng(q.png);
    const save=await dialog.showSaveDialog(mainWindow!,{defaultPath:`materialsx-md-step-${frame.step.step}.png`,filters:[{name:"PNG",extensions:["png"]}]});
    if(save.canceled||!save.filePath)return false;if(!save.filePath.toLowerCase().endsWith('.png'))throw Error('PNG_EXPORT_EXTENSION');await writeFile(save.filePath,bytes,{mode:0o600});return true;
  });
  ipcMain.handle("atomistic:export-trajectory",async(_event,input:unknown)=>{
    const q=trajectoryRequestSchema.parse(input);const payload=await atomistic.trajectory(q);
    const save=await dialog.showSaveDialog(mainWindow!,{defaultPath:`materialsx-${payload.partial?'partial-':''}trajectory.extxyz`,filters:[{name:"Extended XYZ trajectory (Å, Å/fs, fs)",extensions:["extxyz"]}]});
    if(save.canceled||!save.filePath)return false;if(!save.filePath.toLowerCase().endsWith('.extxyz'))throw Error('TRAJECTORY_EXPORT_EXTENSION');
    // Stage next to the user-selected destination; a bad frame never leaves a claimed complete export.
    const temp=`${save.filePath}.${randomUUID()}.tmp`,file=await open(temp,'wx',0o600);
    try{await atomistic.trajectoryExport(q,async data=>{let n=0;while(n<data.length){const r=await file.write(data,n,data.length-n);if(!r.bytesWritten)throw Error('EXPORT_WRITE_FAILED');n+=r.bytesWritten;}});await file.sync();await file.close();await rename(temp,save.filePath);return true;}
    catch(error){await file.close().catch(()=>{});await rm(temp,{force:true});throw error;}
  });
  ipcMain.handle("atomistic:relax",(_event,input:unknown)=>atomistic.startRelaxation(input));
  ipcMain.handle("atomistic:comparison",(_event,input:unknown)=>atomistic.comparison(input));
  ipcMain.handle("atomistic:use-output",(_event,input:unknown)=>atomistic.useOutputStructure(input));
  ipcMain.handle("atomistic:view",(_event,input:unknown)=>atomistic.view(input));
  ipcMain.handle("atomistic:export-structure",async(_event,input:unknown)=>{
    const request=atomicViewRequestSchema.parse(input);const {bytes,format}=await atomistic.originalStructure(request);
    const file=await dialog.showSaveDialog(mainWindow!,{defaultPath:`structure.${format}`,filters:[{name:"Original atomic structure",extensions:[format]}]});
    if(file.canceled||!file.filePath)return false;if(!file.filePath.toLowerCase().endsWith(`.${format}`))throw Error("STRUCTURE_EXPORT_EXTENSION");
    await writeFile(file.filePath,bytes,{mode:0o600});return true;
  });
  ipcMain.handle("atomistic:export-png",async(_event,input:unknown)=>{
    const parsed=atomicPngExportSchema.parse(input);await atomistic.view(parsed.request);const png=cleanAtomicPng(parsed.png);
    const file=await dialog.showSaveDialog(mainWindow!,{defaultPath:"materialsx-structure.png",filters:[{name:"PNG",extensions:["png"]}]});
    if(file.canceled||!file.filePath)return false;if(!file.filePath.toLowerCase().endsWith(".png"))throw Error("PNG_EXPORT_EXTENSION");
    await writeFile(file.filePath,png,{mode:0o600});return true;
  });
  ipcMain.handle("atomistic:runtime",()=>atomistic.status());
  ipcMain.handle("atomistic:list",(_event,projectId:unknown)=>atomistic.list(localId.parse(projectId)));
  ipcMain.handle("atomistic:composition",(_event,input:unknown)=>atomistic.composition(input));
  ipcMain.handle("atomistic:get",(_event,input:unknown)=>atomistic.get(input));
  ipcMain.handle("atomistic:start",(_event,input:unknown)=>atomistic.start(input));
  ipcMain.handle("atomistic:cancel",(_event,input:unknown)=>atomistic.cancel(input));
  ipcMain.handle("atomistic:choose-structure",async(_event,input:unknown)=>{
    const projectId=localId.parse(input);if(!store.getProject(projectId))throw Error("UNKNOWN_PROJECT");
    const file=await dialog.showOpenDialog(mainWindow!,{properties:["openFile"],filters:[{name:"Atomic structures (CIF / XYZ / extxyz / POSCAR)",extensions:["cif","xyz","extxyz","poscar"]},{name:"POSCAR / CONTCAR",extensions:["*"]}]});
    if(file.canceled||!file.filePaths[0])return null;return atomistic.importFile(projectId,file.filePaths[0]);
  });
  ipcMain.handle("workspace:bootstrap", () => bootstrap());
  ipcMain.handle("workspace:reveal-artifact", async (_event, input: unknown) => {
    const path = await realpath(assertText(input, "artifactPath"));
    for (const project of store.listProjects()) {
      let root: string;
      try { root = await realpath(join(project.path, "materials-output")); } catch { continue; }
      const inside = relative(root, path);
      if (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
        // Reveal only; never execute a model-supplied script or executable.
        shell.showItemInFolder(path);
        return;
      }
    }
    throw new Error("只能定位已登记项目 materials-output 目录内的真实文件。");
  });
  ipcMain.handle("workspace:choose-project", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return store.createProject(result.filePaths[0]);
  });
  ipcMain.handle("workspace:create-conversation", (_event, projectId: unknown) =>
    store.createConversation(assertText(projectId, "projectId")),
  );
  ipcMain.handle("workspace:list-messages", (_event, conversationId: unknown) =>
    store.listMessages(assertText(conversationId, "conversationId")),
  );
  ipcMain.handle("cloud:list-files", (_event,id:unknown) => (cloudFiles.get(assertText(id,"conversationId"))??[]).map(file=>selectedFileMetadata(file)));
  ipcMain.handle("cloud:clear-files", (_event,id:unknown) => { const key=assertText(id,"conversationId"); if(activeConversations.has(key))throw new Error("任务运行中无法修改文件范围"); cloudFiles.delete(key); });
  registerMxPointsIpc(identityClient);
  const paymentId=(v:unknown)=>{const text=assertText(v,"paymentId");if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(text))throw new Error("订单参数无效");return text};
  ipcMain.handle("payments:plans",async()=>paymentPlansSchema.parse(await(await identityClient.platformRequest("/v1/billing/plans")).json()));
  ipcMain.handle("payments:orders",async(_event,cursor:unknown)=>paymentOrdersSchema.parse(await(await identityClient.platformRequest(`/v1/billing/orders${cursor===undefined?"":`?cursor=${paymentId(cursor)}`}`)).json()));
  ipcMain.handle("payments:create",async(_event,input:{productVersionId:unknown;key:unknown})=>{const plans=paymentPlansSchema.parse(await(await identityClient.platformRequest("/v1/billing/plans")).json());if(plans.mode!=="test"&&plans.mode!=="wechat-pilot"&&!(plans.mode==="wechat-native"&&plans.formalSalesEnabled))throw Error("Payment creation disabled");return orderSchema.parse(await(await identityClient.platformRequest("/v1/billing/orders",{method:"POST",headers:{"Idempotency-Key":paymentId(input.key)},body:JSON.stringify({productVersionId:paymentId(input.productVersionId),channel:plans.mode==="test"?"test":"wechat"})})).json())});
  ipcMain.handle("payments:query",async(_event,input:{id:unknown;key:unknown})=>orderSchema.parse(await(await identityClient.platformRequest(`/v1/billing/orders/${paymentId(input.id)}/query`,{method:"POST",headers:{"Idempotency-Key":paymentId(input.key)},body:"{}"})).json()));  ipcMain.handle("payments:close",async(_event,input:{id:unknown;key:unknown})=>orderSchema.parse(await(await identityClient.platformRequest(`/v1/billing/orders/${paymentId(input.id)}/close`,{method:"POST",headers:{"Idempotency-Key":paymentId(input.key)},body:"{}"})).json()));
  ipcMain.handle("payments:refunds",async(_event,id:unknown)=>paymentRefundsSchema.parse(await(await identityClient.platformRequest(`/v1/billing/orders/${paymentId(id)}/refunds`)).json()));
  ipcMain.handle("payments:refund",async(_event,input:{id:unknown;input:unknown;key:unknown})=>paymentRefundSchema.parse(await(await identityClient.platformRequest(`/v1/billing/orders/${paymentId(input.id)}/refunds`,{method:"POST",headers:{"Idempotency-Key":paymentId(input.key)},body:JSON.stringify(refundInputSchema.parse(input.input))})).json()));
  ipcMain.handle("payments:periods",async()=>subscriptionPeriodsSchema.parse(await(await identityClient.platformRequest("/v1/billing/subscriptions")).json()));
  ipcMain.handle("payments:export",async(_event,cursor:unknown)=>{const res=await identityClient.platformRequest(`/v1/billing/export${cursor===undefined?"":`?cursor=${paymentId(cursor)}`}`);if(!res.ok||!res.headers.get("Content-Type")?.startsWith("text/csv"))throw new Error("订单导出失败");const text=await res.text();if(Buffer.byteLength(text)>256*1024)throw new Error("导出内容过大");const next=res.headers.get("X-Next-Cursor");if(next)paymentId(next);const file=await dialog.showSaveDialog({defaultPath:"materialsx-orders.csv",filters:[{name:"CSV",extensions:["csv"]}]});if(file.canceled||!file.filePath)return {saved:false,nextCursor:next};await writeFile(file.filePath,text,{encoding:"utf8",mode:0o600});return {saved:true,nextCursor:next}});
 ipcMain.handle("support:list",async(_event,cursor:unknown)=>ticketsSchema.parse(await(await identityClient.platformRequest(`/v1/support/tickets${cursor===undefined?"":`?cursor=${paymentId(cursor)}`}`)).json()));
 ipcMain.handle("support:create",async(_event,input:{body:unknown;key:unknown})=>ticketSchema.parse(await(await identityClient.platformRequest("/v1/support/tickets",{method:"POST",headers:{"Idempotency-Key":paymentId(input.key)},body:JSON.stringify(newTicketSchema.parse(input.body))})).json()));
 ipcMain.handle("support:reply",async(_event,input:{id:unknown;body:unknown;key:unknown})=>ticketSchema.parse(await(await identityClient.platformRequest(`/v1/support/tickets/${paymentId(input.id)}/reply`,{method:"POST",headers:{"Idempotency-Key":paymentId(input.key)},body:JSON.stringify(ticketReplySchema.parse(input.body))})).json()));
 ipcMain.handle("support:attach",async(_event,input:{id:unknown;body:unknown;key:unknown})=>attachmentSchema.parse(await(await identityClient.platformRequest(`/v1/support/tickets/${paymentId(input.id)}/attachments`,{method:"POST",headers:{"Idempotency-Key":paymentId(input.key)},body:JSON.stringify(attachmentInputSchema.parse(input.body))})).json()));
 ipcMain.handle("platform:activity",async()=>billingActivitySchema.parse(await(await identityClient.platformRequest("/v1/billing/activity")).json()));
  ipcMain.handle("platform:status",async()=>workspaceStatusSchema.parse(await(await identityClient.platformRequest("/v1/workspace/status")).json()));
 ipcMain.handle("platform:bills",async(_event,cursor:unknown)=>taskBillsSchema.parse(await(await identityClient.platformRequest(`/v1/billing/tasks${cursor===undefined?"":`?cursor=${paymentId(cursor)}`}`)).json()));
 ipcMain.handle("platform:requests",async(_event,id:unknown)=>taskRequestsSchema.parse(await(await identityClient.platformRequest(`/v1/tasks/${paymentId(id)}/requests`)).json()).items);
 ipcMain.handle("platform:releases",async()=>releasesSchema.parse(await(await identityClient.platformRequest("/v1/releases")).json()));
 ipcMain.handle("platform:download",async(_event,url:unknown)=>{if(typeof url!=="string"||!/^https:\/\/github\.com\/materialsx-jlu\/MaterialsX\/releases\/download\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?\/[A-Za-z0-9_.-]+$/.test(url))throw Error("Invalid release URL");const catalog=releasesSchema.parse(await(await identityClient.platformRequest("/v1/releases")).json());if(!catalog.items.some(r=>r.state==="published"&&r.manifest.assets.some(a=>a.downloadUrl===url)))throw Error("Release unavailable");await shell.openExternal(url)});
 ipcMain.handle("platform:export",async(_event,cursor:unknown)=>{const res=await identityClient.platformRequest(`/v1/billing/tasks/export${cursor===undefined?"":`?cursor=${paymentId(cursor)}`}`);if(!res.ok||!res.headers.get("Content-Type")?.startsWith("text/csv"))throw Error("Task export failed");const body=await res.text();if(Buffer.byteLength(body)>256*1024)throw Error("Export too large");const next=res.headers.get("X-Next-Cursor");if(next)paymentId(next);const file=await dialog.showSaveDialog({defaultPath:"materialsx-task-bills.csv",filters:[{name:"CSV",extensions:["csv"]}]});if(file.canceled||!file.filePath)return {saved:false,nextCursor:next};await writeFile(file.filePath,body,{encoding:"utf8",mode:0o600});return {saved:true,nextCursor:next}});
  ipcMain.handle("billing:wallet", async()=>walletSchema.parse(await (await identityClient.platformRequest("/v1/billing/wallet")).json()));
  ipcMain.handle("billing:ledger",async(_event,cursor:unknown)=>{const after=cursor===undefined?undefined:unsignedInteger.parse(cursor);return creditLedgerSchema.parse(await(await identityClient.platformRequest(`/v1/billing/ledger${after?`?cursor=${after}`:""}`)).json())});
  ipcMain.handle("cloud:catalog", () => platformSessions.catalog());
  ipcMain.handle("cloud:run", async (_event,id:unknown) => {
    if(shuttingDown)return null;
    const conversation=assertText(id,"conversationId"),account=await identityClient.snapshot();
    if(shuttingDown)return null;
    if(account.status!=="connected"||!account.user)return null;
    const taskId=store.latestCloudTask(account.user.id,conversation);if(!taskId)return null;
    return platformSessions.refreshSnapshot(conversation,taskId);
  });
  ipcMain.handle("cloud:choose-files", async (_event,input:{projectId:string;conversationId:string}) => {
    const project=store.getProject(assertText(input?.projectId,"projectId"));
    const conversation=store.listConversations().find(c=>c.id===input?.conversationId&&c.projectId===project?.id);
    if (!project||!conversation||activeConversations.has(conversation.id)) throw new Error("请先选择空闲的项目对话");
    const result=await dialog.showOpenDialog(mainWindow!,{title:"添加研究附件（本机解析，最多8个）",defaultPath:project.path,
      properties:["openFile","multiSelections"],filters:[{name:"研究文档与数据",extensions:["pdf","docx","xls","xlsx","txt","md","json","csv","cif","xyz","log"]}]});
    if(result.canceled) return (cloudFiles.get(conversation.id)??[]).map(file=>selectedFileMetadata(file));
    if(result.filePaths.length>8)throw new Error("最多选择8个附件");
    const assets=await Promise.all(result.filePaths.map(path=>snapshotAttachmentFile(project.path,path,projectRoot)));
    cloudFiles.set(conversation.id,assets);return assets.map(file=>selectedFileMetadata(file));
  });
  registerAgentConfiguration(store,researchService,userSkills,()=>activeConversations.size===0);
  registerSkillInstallationIpc(installedSkills,()=>activeConversations.size===0);
  registerAgentMessaging({papers:id=>researchService.papers?.library.list(id)??[],authorizeResearch:(id,cloud)=>researchService.authorizeProject(id,cloud),store,piSessions,platformSessions,agentRuntime,identityClient,atomistic,potentialAnalysis,userSkills,installedSkills,projectRoot,activeConversations,cloudFiles,scienceScopes,analysisScopes,loadSkills,window:()=>mainWindow,isShuttingDown:()=>shuttingDown,requestAtomicView,sendMessageStream,assertText});
  ipcMain.handle("settings:save-model", (_event, input: ModelSettings) => {
    const mode = input?.mode;
    const modelId = assertText(input?.modelId, "modelId");
    const localEndpoint = typeof input?.localEndpoint === "string" ? input.localEndpoint.trim() : "";
    validateModelSelection({
      mode,
      modelId,
      ...(mode === "local" ? { localEndpoint } : {}),
    });
    const agentEngine=z.enum(['pi','codex']).parse(input.agentEngine??'codex');
    const options=z.strictObject({localProtocol:z.enum(['chat-completions','responses']).optional(),localContextBudget:z.number().int().min(2048).max(131072).optional(),cloudWorkspaceTools:z.boolean().optional()}).parse(Object.fromEntries(['localProtocol','localContextBudget','cloudWorkspaceTools'].filter(k=>input[k as keyof ModelSettings]!==undefined).map(k=>[k,input[k as keyof ModelSettings]])));
    return store.saveSettings({ mode, modelId, localEndpoint,agentEngine,...Object.fromEntries(Object.entries(options).filter(([,v])=>v!==undefined)) });
  });
  ipcMain.handle("settings:probe-local-models", (_event, endpoint: unknown) => {
    const localEndpoint = assertText(endpoint, "localEndpoint");
    validateModelSelection({ mode: "local", modelId: "probe", localEndpoint });
    return discoverLocalModels(localEndpoint);
  });
  ipcMain.handle("potentials:catalog",()=>loadPotentialCatalog());
  ipcMain.handle('potentials:storage',()=>potentialDistribution.inventory());
  ipcMain.handle('potentials:cleanup',async(_e,input:unknown)=>{const q=z.strictObject({selection:storageSelectionSchema,locale:z.enum(['zh','en'])}).parse(input);const inventory=await potentialDistribution.inventory();if(q.selection.inventorySha256!==inventory.inventorySha256)throw Error('STORAGE_PREVIEW_STALE');const rows=q.selection.ids.map(id=>{const r=inventory.items.find(r=>r.id===id);if(!r?.removable)throw Error('STORAGE_ITEM_PROTECTED_OR_MISSING');return r;});const confirm=await dialog.showMessageBox(mainWindow!,{type:'warning',title:q.locale==='zh'?'清理 MaterialsX 缓存':'Clean MaterialsX cache',message:rows.map(r=>`${r.label[q.locale]} · ${(r.bytes/1048576).toFixed(2)} MiB`).join('\n'),detail:q.locale==='zh'?'将删除所列缓存。共享计算环境、来源证据、原始结构、计算结果及复现回执会保留。':'The listed caches will be deleted. Shared runtimes, source evidence, inputs, results and reproduction receipts will be preserved.',buttons:q.locale==='zh'?['取消','确认清理']:['Cancel','Confirm cleanup'],defaultId:0,cancelId:0});if(confirm.response!==1)return null;const result=await potentialDistribution.cleanup(q.selection);mainWindow?.webContents.send('potentials:catalog-changed');return result;});
  ipcMain.handle('potentials:export-collection',async(_e,input:unknown)=>{const ids=z.array(catalogId).min(1).max(50).parse(input);const f=await dialog.showOpenDialog(mainWindow!,{properties:['openDirectory']});if(f.canceled||!f.filePaths[0])return null;return potentialDistribution.exportCollection(f.filePaths[0],ids);});
  ipcMain.handle('potentials:import-collection',async()=>{const f=await dialog.showOpenDialog(mainWindow!,{properties:['openDirectory']});if(f.canceled||!f.filePaths[0])return null;const r=await potentialDistribution.importCollection(f.filePaths[0]);mainWindow?.webContents.send('potentials:catalog-changed');return r;});
  ipcMain.handle('potentials:export-catalog',async()=>{const f=await dialog.showSaveDialog(mainWindow!,{defaultPath:'materialsx-catalog-bundle.json',filters:[{name:'Signed catalog bundle',extensions:['json']}]});if(f.canceled||!f.filePath)return false;await writeFile(f.filePath,JSON.stringify(catalogUpdates.bundle(),null,2)+'\n',{flag:'wx',mode:0o600});return true;});
  ipcMain.handle('atomistic:export-receipt',async(_e,input:unknown)=>{const q=z.strictObject({projectId:localId,runId:localId}).parse(input);const receipt=await atomistic.reproductionReceipt(q);const f=await dialog.showSaveDialog(mainWindow!,{defaultPath:'materialsx-reproduction-'+q.runId+'.json',filters:[{name:'Reproduction receipt',extensions:['json']}]});if(f.canceled||!f.filePath)return false;await writeFile(f.filePath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return true;});
  ipcMain.handle('atomistic:inspect-receipt',async()=>{const f=await dialog.showOpenDialog(mainWindow!,{properties:['openFile'],filters:[{name:'Reproduction receipt',extensions:['json']}]});if(f.canceled||!f.filePaths[0])return null;return inspectReproductionReceipt(projectRoot,JSON.parse(ownedText(f.filePaths[0],4*1024*1024)));});
  ipcMain.handle("potentials:updates",()=>catalogUpdates.status());
  ipcMain.handle("potentials:refresh-updates",()=>catalogUpdates.refresh(true));
  ipcMain.handle("potentials:import-catalog",async()=>{const f=await dialog.showOpenDialog(mainWindow!,{properties:["openFile"],filters:[{name:"Signed potential catalog",extensions:["json"]}]});if(f.canceled||!f.filePaths[0])return false;catalogUpdates.accept(JSON.parse(ownedText(f.filePaths[0],32*1024*1024)));return true;});
  ipcMain.handle("potentials:discovery-status",()=>potentialDiscovery.status());
  ipcMain.handle("potentials:discovery-search",(_e,input:unknown)=>potentialDiscovery.search(discoverySearchSchema.parse(input)));
  ipcMain.handle("potentials:discovery-sync",(_e,input:unknown)=>potentialDiscovery.sync(discoverySyncSchema.parse(input).sourceIds,true));
  ipcMain.handle("potentials:discovery-cancel",()=>potentialDiscovery.cancel());
  ipcMain.handle("potentials:discovery-evidence",(_e,id:unknown)=>potentialDiscovery.readEvidence(catalogId.parse(id)));
  ipcMain.handle("potentials:discovery-source",(_e,id:unknown)=>shell.openExternal(potentialDiscovery.get(catalogId.parse(id)).observation.url));
  ipcMain.handle("potentials:search",(_event,input:unknown)=>searchCatalog(loadPotentialCatalog(),input));
  ipcMain.handle("skills:search",(_event,input:unknown)=>searchSkills(loadSkills(),input));
  ipcMain.handle("potentials:source",(_event,id:unknown)=>shell.openExternal(findCatalogEntry(loadPotentialCatalog(),catalogId.parse(id)).sources[0]!.url));
  ipcMain.handle("models:open-source", (_event, modelId: unknown) => {
    const id = assertText(modelId, "modelId");
    const model = loadResearchModels().find((item) => item.id === id);
    const potential = loadPotentialRegistry().potentials.find((item) => item.id === id);
    if (!model && potential) return shell.openExternal(potential.source.url);
    if (!model || !model.sourceUrl.startsWith("https://")) throw new Error("模型来源不可用");
    return shell.openExternal(model.sourceUrl);
  });
  ipcMain.handle("account:devices", (_event, cursor: unknown) => identityClient.devices(assertText(cursor, "cursor")));
  ipcMain.handle("account:get", () => identityClient.snapshot());
  ipcMain.handle("account:login", async () => {
    platformSessions.dispose(); cloudFiles.clear();scienceScopes.clear();analysisScopes.clear();
    try { return await identityClient.login(); }
    catch (error) { return {status:"unavailable",secureStorage:safeStorage.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=="basic_text",user:null,devices:[],nextCursor:null,
      error:error instanceof IdentityLoginError ? error.message : "平台登录未完成，请检查身份服务连接和系统安全存储后重试"}; }
  });
  ipcMain.handle("account:cancel-login", () => identityClient.cancelLogin());
  ipcMain.handle("account:logout", async () => { platformSessions.dispose(); cloudFiles.clear();scienceScopes.clear();analysisScopes.clear(); return identityClient.logout(); });
  ipcMain.handle("account:revoke-device", (_event, id: unknown) => identityClient.revoke(assertText(id, "deviceId")));
  ipcMain.handle("subscription:get", () => controlPlane.snapshot(`local-${store.getInstallationId()}`));
  ipcMain.handle("subscription:activate-development", (_event, planId: unknown) => {
    if (planId !== "pro" && planId !== "research") throw new Error("测试套餐无效");
    return controlPlane.activateDevelopmentPlan(
      `local-${store.getInstallationId()}`,
      planId,
      `desktop-dev-${randomUUID()}`,
    );
  });
  ipcMain.handle("diagnostics:refresh", () => diagnostics());
  ipcMain.handle("release:readiness", () => releaseReadiness());
  ipcMain.handle("release:export-support-bundle", () => exportSupportBundle());
  ipcMain.handle("app:open-docs", () => shell.openPath(join(projectRoot, "docs/STATUS.md")));
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    title: "MaterialsX",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0b0d0f",
    show: false,
    webPreferences: {
      preload: join(currentDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env.MATERIALSX_RENDERER_URL) {
    await mainWindow.loadURL(process.env.MATERIALSX_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(currentDir, "../renderer/index.html"));
  }
}

app.setName("MaterialsX");
const profile=profilePath(process.env.MATERIALSX_PROFILE_PATH);if(profile)app.setPath("userData",profile);

app.whenReady().then(async () => {
  if (process.platform === "darwin" && !packaged) {
    const dockIcon = join(developmentRoot, "assets/brand/materialsx-atom-depth-1024.png");
    if (existsSync(dockIcon)) app.dock?.setIcon(dockIcon);
  }
  const userData = app.getPath("userData");
  store = new WorkspaceStore(join(userData, "materialsx.sqlite"));
  const researchRequest=await createResearchFetch();
  catalogUpdates=new CatalogUpdateService(projectRoot,userData);
  potentialDiscovery=new PotentialDiscoveryService(projectRoot,userData,loadPotentialCatalog,researchRequest);
  const notifyPotential=(channel:string)=>{if(mainWindow&&!mainWindow.isDestroyed()&&!mainWindow.webContents.isDestroyed())mainWindow.webContents.send(channel);};
  // Rebuild only when signed metadata changes. Browsing/downloading must not
  // synchronously parse and clone the complete catalog for every checkpoint.
  potentialCatalogCache=null;
  catalogUpdates.onChanged(changed=>{if(changed)potentialCatalogCache=null;notifyPotential(changed?"potentials:catalog-changed":"potentials:discovery-changed");});potentialDiscovery.onChanged(()=>notifyPotential("potentials:discovery-changed"));
  atomistic = new AtomisticRuntime(projectRoot,userData,id=>store.getProject(id)?.path??null,id=>catalogUpdates.assertUsable(id));
  await atomistic.restore();
  potentialAnalysis=new PotentialAnalysisService(projectRoot,userData,atomistic);potentialAnalysis.restore();
  catalogWeights=new CatalogWeightManager(userData,()=>loadPotentialCatalog(),id=>catalogUpdates.assertUsable(id),fetch,()=>notifyPotential('potentials:model-changed'));
  potentialDistribution=new PotentialDistributionService(projectRoot,userData,atomistic.mountedPackages,id=>potentialAnalysis.busy(id),id=>catalogUpdates.assertUsable(id),catalogWeights);
  userSkills=new UserSkillService(userData,()=>[...readBuiltinSkills(projectRoot).map(s=>s.name),...(installedSkills?.list().map(s=>s.name)??[])],loadPotentialCatalog);
  installedSkills=new SkillInstallationService(userData,()=>[...readBuiltinSkills(projectRoot),...userSkills.summaries()],new GitHubSkillSource(researchRequest),()=>{piSessions?.skillsChanged();notifyPotential("skills:changed");});
  await installedSkills.restore();
  scientificValidation=new ScientificValidationService(projectRoot,userData,atomistic,id=>store.getProject(id)?.path??null);
  await scientificValidation.restore();
  const defaultMcpDirectory=process.env.MATERIALSX_MOOS_MCP_DIRECTORY??(!packaged?join(developmentRoot,"../MOOS/services/materials-mcp"):null);
  let savedMcp=store.mcpConfiguration();
  if(savedMcp.revision===1)savedMcp=store.saveMcpConfiguration({...savedMcp,directory:defaultMcpDirectory,origin:process.env.MATERIALSX_MOOS_ORIGIN??savedMcp.origin,enabled:!!defaultMcpDirectory&&existsSync(join(defaultMcpDirectory,"dist/src/server.js")),revision:2},1);
  researchService=new ResearchService(store,{client:null,assetRoot:projectRoot,jobStateRoot:join(userData,'long-jobs')});await researchService.configure(savedMcp,true);
  researchService.scientific.atomistic=atomistic;
  researchService.papers=new ResearchPaperService(store,researchService,projectRoot,userData,new PublicResearchNetwork(researchRequest));
  potentialDistribution.attachStorage(researchService.papers);
  await researchService.papers.environment.check();
  piSessions = new PiLocalSessionService(projectRoot, userData, (path,conversationId)=>{
    const child=agentRuntime?.subtasks.scope(conversationId);const project=child?store.getProject(child.projectId):store.listProjects().find(p=>p.path===path);
    const definitions=[...(project?createInstalledSkillTools(installedSkills,project.path):[]),...(project?researchService.tools(project.id,conversationId):[]),...(project&&agentWorkspace?agentWorkspace.tools(project.id,conversationId):[]),defineTool({name:"skill_draft",label:"Preview user Skill",description:"Validate an instructions-only bilingual user Skill draft and show it in the MaterialsX My Skills editor. Does not save, overwrite builtin instructions or execute anything. All fields are required.",parameters:Type.Object({draft:Type.Object({schemaVersion:Type.Literal("m6.7-v1"),name:Type.String(),description:Type.Object({zh:Type.String(),en:Type.String()}),instructions:Type.Object({zh:Type.String(),en:Type.String()}),examples:Type.Array(Type.Object({zh:Type.String(),en:Type.String()})),potentialIds:Type.Array(Type.String()),requiredTools:Type.Array(Type.String())},{additionalProperties:false})},{additionalProperties:false}),async execute(_id,args){const p=userSkills.preview(args.draft);mainWindow?.webContents.send("skills:draft",p.draft);return {content:[{type:"text" as const,text:JSON.stringify({name:p.draft.name,sha256:p.sha256,saved:false,previewShown:true})}],details:undefined};}}),...createCatalogTools(loadPotentialCatalog,loadSkills,potentialDiscovery),...(project?createAtomisticTools(atomistic,project.id,id=>requestAtomicView(project.id,id),analysisScopes.has(conversationId)?{service:potentialAnalysis,scope:analysisScopes.get(conversationId)!,prompt:"User requested analysis in this conversation; select an eligible potential from catalog evidence."}:undefined,analysisScopes.has(conversationId)?scienceScopes.get(conversationId):undefined):[])];
    return project&&agentWorkspace?agentWorkspace.childTools(conversationId,definitions):definitions;
  },()=>[...userSkills.paths(),...installedSkills.paths()]);
  const vault = new SystemCredentialVault(join(userData, "platform-session.bin"), safeStorage);
  try {
    identityClient = new IdentityClient(process.env.MATERIALSX_IDENTITY_URL ?? (packaged ? null : "http://127.0.0.1:8788"),
      vault, (url) => shell.openExternal(url), !packaged);
  } catch {
    console.warn("MaterialsX identity origin configuration rejected; platform login disabled");
    identityClient = new IdentityClient(null, vault, (url) => shell.openExternal(url));
  }
  teamResearch=new TeamResearchWorkspace(store,researchService,identityClient);
  platformSessions = new PiPlatformSessionService(identityClient,(account,conversation,task)=>store.saveCloudTask(account,conversation,task.id));
  researchService.papers.rpsme=(c,p,pdf,approved,signal)=>piSessions.extractRpsme(c,p,pdf,approved,signal);
  agentRuntime=new DesktopAgentRuntime(store,piSessions,platformSessions,userData,{packaged:packaged,resourcesPath:process.resourcesPath,projectRoot:developmentRoot},async (projectId,ids)=>{const managed=await researchService.campaigns.queryJobs(projectId,ids);return [...managed,...ids.filter(id=>!managed.some(j=>j.id===id)).flatMap<{id:string;state:string;runId?:string}>(id=>{try {const receipt=atomistic.get({projectId,runId:id});return [{id,state:receipt.job.status}];}catch {try {const receipt=potentialAnalysis.get(projectId,id);return [{id,state:receipt.state,...(receipt.runId?{runId:receipt.runId}:{})}];}catch{return [];}}})];},researchService,id=>applicationCapabilities([...loadBuiltinSkillState(projectRoot),...userSkills.summaries(),...installedSkills.summaries()],atomistic.status(),researchService.moosConfigured(id),!!researchService.papers));
  agentWorkspace=new AgentWorkspace(store,agentRuntime,userData);
  registerIpc();
  await createWindow();
  if(process.env.MATERIALSX_DISCOVERY_AUTOSYNC!=="0"){const refresh=()=>{void catalogUpdates.refresh().catch(()=>{});void potentialDiscovery.sync().catch(()=>{});};setTimeout(refresh,1500).unref();discoveryTimer=setInterval(refresh,3600000);discoveryTimer.unref();}
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  shuttingDown = true;
  if(discoveryTimer)clearInterval(discoveryTimer);catalogUpdates?.dispose();potentialDiscovery?.dispose();
  catalogWeights?.dispose();potentialAnalysis?.dispose();atomistic?.mountedPackages.cancel();scientificValidation?.dispose();atomistic?.packages.cancel();
  atomistic?.dispose();
  identityClient?.cancelLogin();
  platformSessions?.dispose();
  void agentWorkspace?.browser.dispose();
  void agentRuntime?.dispose();
  void teamResearch?.close();
  void researchService?.close();
  piSessions?.dispose();
  store?.close();
});
