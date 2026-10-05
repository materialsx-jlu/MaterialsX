import type {TeamResearchAPI} from "./team-research.js";
import type {AgentWorkspaceAPI} from './agent-workspace.js';
import type {CampaignAPI} from './campaigns.js';
import type {MethodPackageAPI} from './method-packages.js';
import type {PaperAPI} from "./papers.js";
import type {ScientificDesktopAPI} from './scientific-quality.js';
import type {NextExperimentAPI} from './next-experiment.js';
import type {ExperimentDesktopAPI} from './experiments.js';
import type {AgentConfigurationAPI} from "./agent-configuration.js";
import type {ResearchDesktopAPI as importResearchAPI} from "./research-project.js";
import type { z } from "zod";
import type { CompatibilityProfile, EngineKind, EngineSessionRef } from "./engine-selection.js";
import type { accountSchema, deviceSchema } from "./platform.js";
export type AccountDevice = z.infer<typeof deviceSchema>;
export type AccountSnapshot = { status: "unconfigured" | "signed_out" | "connected" | "unavailable";
  secureStorage: boolean; user: z.infer<typeof accountSchema> | null; devices: AccountDevice[];
  nextCursor: string | null; error?: string };

export type ModelMode = "platform" | "local";
export type WorkspaceView = "platform" | "chat" | "skills" | "models" | "connections" | "runs" | "research" | "subscription" | "release";

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRecord {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  /** Host-bound execution identity, absent for legacy or non-engine messages. */
  taskId?: string;
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "complete" | "waiting_model" | "streaming" | "cancelled" | "failed";
  createdAt: string;
}

export interface ModelSettings {
  agentEngine?: EngineKind;
  localProtocol?: "chat-completions" | "responses";
  localContextBudget?: number;
  localMaxOutputTokens?: number;
  cloudWorkspaceTools?: boolean;
  mode: ModelMode;
  modelId: string;
  localEndpoint: string;
  cloudMaxCredits?: string;
}

export interface LocalModelSummary {
  id: string;
  ownedBy: string;
}

export interface SubscriptionPlan {
  id: "community" | "pro" | "research";
  name: string;
  priceFen: number;
  includedCredits: number;
  testPrice: boolean;
}

export interface SubscriptionOverview {
  subscription: {
    accountId: string;
    planId: SubscriptionPlan["id"];
    status: "pending" | "trialing" | "active" | "past_due" | "suspended" | "canceled" | "expired";
    periodStart: string;
    periodEnd: string;
    renews: boolean;
    renewalMode: "none" | "manual" | "automatic";
  };
  plan: SubscriptionPlan;
  grantedCredits: number;
  usedCredits: number;
  reservedCredits: number;
  remainingCredits: number;
}

export interface CreditLedgerEntry {
  id: string;
  accountId: string;
  periodId: string;
  eventId: string;
  reservationId?: string;
  kind: "period_credit" | "model_usage" | "reservation_release" | "reconciliation_pending" | string;
  units: number;
  createdAt: string;
  note?: string;
}

export interface SubscriptionSnapshot {
  serviceStatus: "online" | "offline";
  accountId: string;
  plans: SubscriptionPlan[];
  overview: SubscriptionOverview | null;
  ledger: CreditLedgerEntry[];
  error?: string;
}

export type ReleaseCheckStatus = "pass" | "warning" | "blocked";

export interface ReleaseCheck {
  id: string;
  category: "science" | "security" | "delivery" | "operations";
  title: string;
  status: ReleaseCheckStatus;
  detail: string;
  remediation?: string;
}

export interface ReleaseReadiness {
  generatedAt: string;
  version: string;
  platform: string;
  target: "v1";
  passed: number;
  warnings: number;
  blocked: number;
  checks: ReleaseCheck[];
}

export interface SupportBundleResult {
  canceled: boolean;
  path?: string;
}

export interface SkillExample {
  zh: string;
  en: string;
}

export interface SkillSummary {
  name: string;
  category: string;
  categoryLabelZh: string;
  categoryLabelEn: string;
  source: string;
  description: string;
  descriptionZh: string;
  descriptionEn: string;
  examples: SkillExample[];
  license: string;
  enabled: boolean;
  availability?:"ready"|"planned";
  applicablePotentialIds?:string[];
}

export type ModelCategory = "atomistic" | "materials-property" | "materials-chat" | "materials-cif-generation" | "materials-language-base" | "materials-text";

export interface ResearchModelSummary {
  id: string;
  name: string;
  category: ModelCategory;
  benchmark: string;
  sourceUrl: string;
  checkpointUrl: string | null;
  license: string;
  descriptionZh: string;
  descriptionEn: string;
  examples: SkillExample[];
}

export interface ConnectionSummary {
  id: string;
  name: string;
  kind: "mcp" | "runtime" | "solver";
  status: "ready" | "attention" | "offline";
  detail: string;
}

export interface RunRecord {
  id: string;
  projectId: string | null;
  label: string;
  status: "waiting_model" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "blocked" | "completed_with_limitations" | "waiting";
  createdAt: string;
}

export interface DesktopBootstrap {
  appVersion: string;
  platform: string;
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  settings: ModelSettings;
  skills: SkillSummary[];
  models: ResearchModelSummary[];
  potentialCatalog?: import("./potential-hub.js").PotentialCatalog;
  potentialRegistry?: import("./atomistic.js").PotentialRegistry;
  connections: ConnectionSummary[];
  runs: RunRecord[];
}

export interface SendMessageInput {
  streamToken?: string;
  projectId: string;
  conversationId: string;
  content: string;
}

export interface MessageStreamEvent {
  conversationId: string;
  streamId: string;
  sequence: number;
  type: "start" | "delta" | "complete" | "cancelled" | "error" | "phase";
  executionEvent?: import("./task-execution.js").ExecutionEvent;
  delta?: string;
  content?: string;
  error?: string;
}

export interface DesktopAPI extends TeamResearchAPI, importResearchAPI, AgentConfigurationAPI, PaperAPI, ScientificDesktopAPI, ExperimentDesktopAPI, NextExperimentAPI, MethodPackageAPI, CampaignAPI, AgentWorkspaceAPI {
  getPotentialModelStates():Promise<import('./catalog-weights.js').PotentialModelState[]>;
  downloadCatalogWeight(id:string):Promise<void>;
  cancelCatalogWeight(id:string):Promise<boolean>;
  importCatalogWeight(id:string):Promise<boolean>;
  revealCatalogWeight(id:string):Promise<void>;
  loadPotentialModel(id:string):Promise<import('./potential-packages.js').CapabilityReceipt>;
  onPotentialModelChanged(callback:()=>void):()=>void;

  getPotentialStorage():Promise<import('./potential-distribution.js').PotentialStorageInventory>;
  cleanupPotentialStorage(selection:import('zod').infer<typeof import('./potential-distribution.js').storageSelectionSchema>,locale:'zh'|'en'):Promise<{removed:string[];bytes:number}|null>;
  exportPotentialCollection(ids:string[]):Promise<{path:string;potentialIds:string[]}|null>;
  importPotentialCollection():Promise<{imported:string[]}|null>;
  exportPotentialCatalog():Promise<boolean>;
  exportScientificReceipt(projectId:string,runId:string):Promise<boolean>;
  inspectScientificReceipt():Promise<ReturnType<typeof import('../../atomistic/src/reproduction-receipt.js').inspectReproductionReceipt>|null>;
  getPotentialCatalog():Promise<import('./potential-hub.js').PotentialCatalog>;
  getPotentialUpdates():Promise<ReturnType<import('../../atomistic/src/catalog-updates.js').CatalogUpdateService['status']>>;
  refreshPotentialUpdates():Promise<ReturnType<import('../../atomistic/src/catalog-updates.js').CatalogUpdateService['status']>>;
  importPotentialCatalog():Promise<boolean>;
  getPotentialDiscovery():Promise<ReturnType<import('../../atomistic/src/potential-discovery.js').PotentialDiscoveryService['status']>>;
  searchPotentialDiscovery(input:import('zod').input<typeof import('./potential-discovery.js').discoverySearchSchema>):Promise<ReturnType<import('../../atomistic/src/potential-discovery.js').PotentialDiscoveryService['search']>>;
  syncPotentialDiscovery(input:import('zod').input<typeof import('./potential-discovery.js').discoverySyncSchema>):Promise<ReturnType<import('../../atomistic/src/potential-discovery.js').PotentialDiscoveryService['status']>&{changes:number}>;
  cancelPotentialDiscovery():Promise<boolean>;
  readPotentialEvidence(id:string):Promise<ReturnType<import('../../atomistic/src/potential-discovery.js').PotentialDiscoveryService['readEvidence']>>;
  openPotentialDiscoverySource(id:string):Promise<void>;
  onPotentialCatalogChanged(callback:()=>void):()=>void;
  onPotentialDiscoveryChanged(callback:()=>void):()=>void;
  getPotentialPackages():Promise<import('./potential-packages.js').MountedPackageStatus[]>;
  downloadPotentialPackage(id:string):Promise<void>;
  cancelPotentialDownload(id:string):Promise<boolean>;
  importPotentialPackage(id:string):Promise<boolean>;
  disablePotentialPackage(id:string,disabled:boolean):Promise<void>;
  uninstallPotentialPackage(id:string):Promise<void>;
  assessPotentialAnalysis(input:import('./potential-workflow.js').AnalysisRequest):Promise<import('./potential-packages.js').SelectionAssessment>;
  freezePotentialAnalysis(projectId:string,input:import('zod').infer<typeof import('./potential-workflow.js').freezeAnalysisSchema>):Promise<import('./potential-workflow.js').PotentialWorkflow>;
  approvePotentialAnalysis(projectId:string,id:string,planSha256:string):Promise<import('./potential-workflow.js').PotentialWorkflow>;
  listPotentialWorkflows(projectId:string):Promise<import('./potential-workflow.js').PotentialWorkflow[]>;
  cancelPotentialAnalysis(projectId:string,id:string):Promise<boolean>;
  setPotentialAnalysisScope(input:import('./potential-workflow.js').AnalysisScope):Promise<import('./potential-workflow.js').AnalysisScope>;
  listUserSkills():Promise<import('../../atomistic/src/user-skills.js').UserSkillRecord[]>;
  previewUserSkill(input:import('zod').infer<typeof import('./potential-hub.js').userSkillDraftSchema>):Promise<ReturnType<import('../../atomistic/src/user-skills.js').UserSkillService['preview']>>;
  saveUserSkill(draft:import('zod').infer<typeof import('./potential-hub.js').userSkillDraftSchema>,expectedRevision:number|null):Promise<import('../../atomistic/src/user-skills.js').UserSkillRecord>;
  enableUserSkill(name:string,enabled:boolean):Promise<import('../../atomistic/src/user-skills.js').UserSkillRecord>;
  deleteUserSkill(name:string,revision:number):Promise<void>;
  onUserSkillDraft(callback:(draft:import('zod').infer<typeof import('./potential-hub.js').userSkillDraftSchema>)=>void):()=>void;

  searchPotentialCatalog(input:import("./potential-hub.js").CatalogSearchInput):Promise<ReturnType<typeof import("../../atomistic/src/potential-hub.js").searchCatalog>>;
  searchInstalledSkills(input:{query:string;limit?:number}):Promise<ReturnType<typeof import("../../atomistic/src/potential-hub.js").searchSkills>>;
  openPotentialSource(id:string):Promise<void>;
  getScientificPackages():Promise<import("./atomistic-validation.js").PackageStatus[]>;
  downloadScientificPackage(input:{potentialId:"chgnet-r2scan"}):Promise<void>;
  chooseScientificPackage(input:{potentialId:"chgnet-r2scan"}):Promise<boolean>;
  cancelScientificPackage():Promise<boolean>;
  disableScientificPackage(input:{potentialId:"chgnet-r2scan"},disabled:boolean):Promise<void>;
  chooseScientificDataset(projectId:string):Promise<boolean>;
  listScientificDatasets(projectId:string):Promise<Array<{id:string;title:string;kind:"dft-heldout"|"synthetic-test";functional:string;samples:number;sha256:string}>>;
  startScientificEvaluation(input:import("zod").infer<typeof import("./atomistic-validation.js").evaluationRequestSchema>):Promise<import("./atomistic-validation.js").EvaluationStatus>;
  listScientificEvaluations(projectId:string):Promise<import("./atomistic-validation.js").EvaluationStatus[]>;
  cancelScientificEvaluation(projectId:string,id:string):Promise<boolean>;
  getScientificQualityMatrix(projectId:string):Promise<import("./atomistic-validation.js").QualityMatrix>;
  exportScientificEvaluation(projectId:string,id:string):Promise<boolean>;

  annotateAtomicElectronicState(input:import("zod").z.infer<typeof import("./potential-molecules.js").electronicStateRequestSchema>):Promise<import("./atomistic.js").AtomicStructure>;
  assessPotentials(input:import("./potential-physics.js").SelectionRequest):Promise<import("./potential-packages.js").SelectionAssessment>;
  startSelectedPotential(input:import("zod").infer<typeof import("./potential-packages.js").selectedRunSchema>):Promise<import("./atomistic-dynamics.js").ScientificSnapshot>;
  listAtomicStructures(projectId:string):Promise<import("./atomistic.js").AtomicStructure[]>;
  importAtomicSample(input:{projectId:string;sampleId:string}):Promise<import("./atomistic.js").AtomicStructure>;
  setScientificScope(input:import("./potential-physics.js").ScientificScope):Promise<import("./potential-physics.js").ScientificScope>;
  getScientificScope(conversationId:string):Promise<import("./potential-physics.js").ScientificScope|null>;
  clearScientificScope(conversationId:string):Promise<void>;
  onAtomicViewRequest(callback:(request:import("./atomic-viewer.js").AtomicViewRequest)=>void):()=>void;
  startAtomicMD(input:import("zod").infer<typeof import("./atomistic-dynamics.js").startMDSchema>):Promise<import("./atomistic-dynamics.js").ScientificSnapshot>;
  readAtomicTrajectory(input:{projectId:string;runId:string}):Promise<import("zod").infer<typeof import("./atomistic-dynamics.js").trajectoryPayloadSchema>>;
  readAtomicTrajectoryFrame(input:{projectId:string;runId:string;frame:number}):Promise<import("zod").infer<typeof import("./atomistic-dynamics.js").mdFrameSchema>>;
  exportAtomicTrajectory(input:{projectId:string;runId:string}):Promise<boolean>;
  exportAtomicTrajectoryPng(input:import("zod").infer<typeof import("./atomistic-dynamics.js").mdPngExportSchema>):Promise<boolean>;
  compareAtomicMD(input:{projectId:string;runIds:[string,string]}):Promise<import("zod").infer<typeof import("./atomistic-dynamics.js").mdComparisonSchema>>;
  startAtomicRelaxation(input:import("zod").infer<typeof import("./potential-packages.js").startRelaxationMountedSchema>):Promise<import("./atomistic-dynamics.js").ScientificSnapshot>;
  readAtomicComparison(input:{projectId:string;runId:string}):Promise<import("zod").infer<typeof import("./atomistic-relaxation.js").relaxationComparisonSchema>>;
  useAtomicOutput(input:{projectId:string;runId:string}):Promise<import("./atomistic.js").AtomicStructure>;
  readAtomicView(input:import("./atomic-viewer.js").AtomicViewRequest):Promise<import("./atomic-viewer.js").AtomicViewPayload>;
  exportAtomicStructure(input:import("./atomic-viewer.js").AtomicViewRequest):Promise<boolean>;
  exportAtomicPng(input:import("zod").infer<typeof import("./atomic-viewer.js").atomicPngExportSchema>):Promise<boolean>;
  getAtomisticRuntime(): Promise<import("./potential-packages.js").MountedRuntimeStatus[]>;
  chooseAtomicStructure(projectId: string): Promise<import("./atomistic.js").AtomicStructure | null>;
  startAtomisticRun(input: import("./atomistic-runtime.js").StartAtomisticInput): Promise<import("./atomistic-dynamics.js").ScientificSnapshot>;
  listAtomisticRuns(projectId: string): Promise<import("./atomistic-dynamics.js").ScientificSnapshot[]>;
  getAtomicComposition(projectId:string,runId:string):Promise<import('./potential-physics.js').CompositionResult>;
  getAtomisticRun(projectId: string, runId: string): Promise<import("./atomistic-dynamics.js").ScientificSnapshot>;
  cancelAtomisticRun(projectId: string, runId: string): Promise<boolean>;
 getSupportTickets(cursor?:string):Promise<import("zod").infer<typeof import("./lifecycle.js").ticketsSchema>>;
 createSupportTicket(body:import("zod").infer<typeof import("./lifecycle.js").newTicketSchema>,key:string):Promise<import("./lifecycle.js").Ticket>;
 replySupportTicket(id:string,body:import("zod").infer<typeof import("./lifecycle.js").ticketReplySchema>,key:string):Promise<import("./lifecycle.js").Ticket>;
 attachSupportText(id:string,body:import("zod").infer<typeof import("./lifecycle.js").attachmentInputSchema>,key:string):Promise<import("zod").infer<typeof import("./lifecycle.js").attachmentSchema>>;
 getBillingActivity():Promise<import("zod").infer<typeof import("./platform.js").billingActivitySchema>>;
 getWorkspaceStatus():Promise<import("./platform.js").WorkspaceStatus>;
 getTaskBills(cursor?:string):Promise<{items:import("./platform.js").TaskBill[];nextCursor:string|null}>;
 getTaskRequests(id:string):Promise<import("./platform.js").AlphaRequest[]>;
 exportTaskBills(cursor?:string):Promise<{saved:boolean;nextCursor:string|null}>;
 getReleaseCatalog():Promise<{items:import("./platform.js").ReleaseEntry[]}>;
 openReleaseDownload(url:string):Promise<void>;
  listCloudFiles(conversationId:string): Promise<Array<{id:string;name:string}>>;
  clearCloudFiles(conversationId:string): Promise<void>;
  getPaymentPlans(): Promise<import("./platform.js").PaymentPlans>;
  getPaymentOrders(cursor?:string): Promise<{items:import("./platform.js").PaymentOrder[];nextCursor:string|null}>;
  createPaymentOrder(productVersionId:string,key:string): Promise<import("./platform.js").PaymentOrder>;
  queryPaymentOrder(id:string,key:string): Promise<import("./platform.js").PaymentOrder>;
  closePaymentOrder(id:string,key:string): Promise<import("./platform.js").PaymentOrder>;
  getPaymentRefunds(id:string): Promise<{items:import("./platform.js").PaymentRefund[]}>;
  requestPaymentRefund(id:string,input:{amountFen:string;reason:string},key:string): Promise<import("./platform.js").PaymentRefund>;
  getSubscriptionPeriods(): Promise<{items:import("./platform.js").SubscriptionPeriod[]}>;
  exportPaymentOrders(cursor?:string): Promise<{saved:boolean;nextCursor:string|null}>;
  getCreditWallet(): Promise<import("./platform.js").CreditWallet>;
  getCreditLedger(cursor?:string): Promise<{items:import("./platform.js").PlatformCreditEntry[];nextCursor:string|null}>;
  getCloudCatalog(): Promise<import("./platform.js").CloudCatalog>;
  getCloudRun(conversationId: string): Promise<import("../../pi-adapter/src/platform-session.js").PlatformRunSnapshot | null>;
  chooseCloudFiles(projectId: string, conversationId: string): Promise<Array<{id:string;name:string}>>;
  getAccount(): Promise<AccountSnapshot>;
  getAccountDevices(cursor: string): Promise<{ items: AccountDevice[]; nextCursor: string | null }>;
  loginAccount(): Promise<AccountSnapshot>;
  cancelAccountLogin(): Promise<void>;
  logoutAccount(): Promise<AccountSnapshot>;
  revokeAccountDevice(deviceId: string): Promise<AccountSnapshot>;
  bootstrap(): Promise<DesktopBootstrap>;
  revealArtifact(path: string): Promise<void>;
  chooseProjectFolder(): Promise<ProjectRecord | null>;
  createConversation(projectId: string): Promise<ConversationRecord>;
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  sendMessage(input: SendMessageInput): Promise<MessageRecord[]>;
  onMessageStream(listener: (event: MessageStreamEvent) => void): void;
  getTaskExecution(taskId:string):Promise<import("./task-execution.js").TaskExecution|null>;
  getExecutionEvents(taskId:string):Promise<import("./task-execution.js").ExecutionEvent[]>;
  reconcileAgentTask(taskId:string):Promise<import("./task-execution.js").TaskExecution>;
  resumeAgentTask(taskId:string):Promise<void>;
  handoffAgentTask(taskId:string,engine:"pi"|"codex"):Promise<void>;
  reviseAgentPlan(taskId:string,expectedRevision:number,proposal:import("./research-goal.js").ResearchGoalPlan):Promise<import("./task-execution.js").TaskExecution>;
  getResearchPlan(taskId:string):Promise<import("./research-goal.js").ResearchGoalPlan|null>;
  steerRun(conversationId:string,content:string):Promise<void>;
  cancelRun(conversationId: string): Promise<boolean>;
  saveModelSettings(settings: ModelSettings): Promise<ModelSettings>;
  probeLocalModels(endpoint: string): Promise<LocalModelSummary[]>;
  probeEngineCompatibility(settings: ModelSettings): Promise<CompatibilityProfile>;
  getEngineSession(taskId: string): Promise<EngineSessionRef | null>;
  openResearchModelSource(modelId: string): Promise<void>;
  getSubscription(): Promise<SubscriptionSnapshot>;
  activateDevelopmentPlan(planId: "pro" | "research"): Promise<SubscriptionSnapshot>;
  refreshDiagnostics(): Promise<ConnectionSummary[]>;
  getReleaseReadiness(): Promise<ReleaseReadiness>;
  exportSupportBundle(): Promise<SupportBundleResult>;
}
