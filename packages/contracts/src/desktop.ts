export type ModelMode = "platform" | "local";
export type WorkspaceView = "chat" | "skills" | "models" | "connections" | "runs" | "subscription" | "release";

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
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "complete" | "waiting_model" | "streaming" | "cancelled" | "failed";
  createdAt: string;
}

export interface ModelSettings {
  mode: ModelMode;
  modelId: string;
  localEndpoint: string;
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
  status: "waiting_model" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
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
  connections: ConnectionSummary[];
  runs: RunRecord[];
}

export interface SendMessageInput {
  projectId: string;
  conversationId: string;
  content: string;
}

export interface MessageStreamEvent {
  conversationId: string;
  streamId: string;
  sequence: number;
  type: "start" | "delta" | "complete" | "cancelled" | "error";
  delta?: string;
  content?: string;
  error?: string;
}

export interface DesktopAPI {
  bootstrap(): Promise<DesktopBootstrap>;
  revealArtifact(path: string): Promise<void>;
  chooseProjectFolder(): Promise<ProjectRecord | null>;
  createConversation(projectId: string): Promise<ConversationRecord>;
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  sendMessage(input: SendMessageInput): Promise<MessageRecord[]>;
  onMessageStream(listener: (event: MessageStreamEvent) => void): void;
  cancelRun(conversationId: string): Promise<boolean>;
  saveModelSettings(settings: ModelSettings): Promise<ModelSettings>;
  probeLocalModels(endpoint: string): Promise<LocalModelSummary[]>;
  openResearchModelSource(modelId: string): Promise<void>;
  getSubscription(): Promise<SubscriptionSnapshot>;
  activateDevelopmentPlan(planId: "pro" | "research"): Promise<SubscriptionSnapshot>;
  refreshDiagnostics(): Promise<ConnectionSummary[]>;
  getReleaseReadiness(): Promise<ReleaseReadiness>;
  exportSupportBundle(): Promise<SupportBundleResult>;
}
