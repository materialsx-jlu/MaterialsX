import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { DEFAULT_MODEL_SETTINGS } from '../../../../../packages/contracts/src/model-defaults.js';
import type { PotentialRegistry } from "../../../../../packages/contracts/src/atomistic.js";
import type {
  ConnectionSummary,
  ConversationRecord,
  DesktopBootstrap,
  MessageRecord,
  MessageStreamEvent,
  ModelSettings,
  ProjectRecord,
  ResearchModelSummary,
  RunRecord,
  ReleaseReadiness,
  SkillSummary,
  SubscriptionSnapshot,
  WorkspaceView,
} from "../../../../../packages/contracts/src/desktop.js";

export const useWorkspaceStore = defineStore("workspace", () => {
  const loading = ref(true);
  const sending = ref(false);
  const error = ref("");
  const appVersion = ref("");
  const platform = ref("");
  const projects = ref<ProjectRecord[]>([]);
  const conversations = ref<ConversationRecord[]>([]);
  const messages = ref<MessageRecord[]>([]);
  const skills = ref<SkillSummary[]>([]);
  const models = ref<ResearchModelSummary[]>([]);
  // Catalog snapshots are replaced atomically, never edited in the renderer.
  const potentialCatalog = shallowRef<import("../../../../../packages/contracts/src/potential-hub.js").PotentialCatalog | null>(null);
  const potentialRegistry = ref<PotentialRegistry | null>(null);
  const connections = ref<ConnectionSummary[]>([]);
  const runs = ref<RunRecord[]>([]);
  const settings = ref<ModelSettings>({ ...DEFAULT_MODEL_SETTINGS });
  const subscription = ref<SubscriptionSnapshot | null>(null);
  const subscriptionLoading = ref(false);
  const releaseReadiness = ref<ReleaseReadiness | null>(null);
  const releaseLoading = ref(false);
  const activeProjectId = ref<string | null>(null);
  const activeConversationId = ref<string | null>(null);
  const activeView = ref<WorkspaceView>("chat");
  const pendingDeltas = new Map<string, string>();
  const streamSequences = new Map<string, number>();
  const settledStreams = new Set<string>();
  let streamFrame: number | null = null;
  let streamSubscribed = false;

  const activeProject = computed(() => projects.value.find((item) => item.id === activeProjectId.value) ?? null);
  const projectConversations = computed(() =>
    conversations.value.filter((item) => item.projectId === activeProjectId.value),
  );
  const activeConversation = computed(
    () => conversations.value.find((item) => item.id === activeConversationId.value) ?? null,
  );
  const readyConnectionCount = computed(() => connections.value.filter((item) => item.status === "ready").length);

  function applyBootstrap(data: DesktopBootstrap): void {
    appVersion.value = data.appVersion;
    platform.value = data.platform;
    projects.value = data.projects;
    conversations.value = data.conversations;
    settings.value = data.settings;
    skills.value = data.skills;
    models.value = data.models;
    potentialCatalog.value = data.potentialCatalog ?? null;
    potentialRegistry.value = data.potentialRegistry ?? null;
    connections.value = data.connections;
    runs.value = data.runs;
    if (!activeProjectId.value && projects.value[0]) activeProjectId.value = projects.value[0].id;
    if (activeProjectId.value && !projects.value.some((item) => item.id === activeProjectId.value)) {
      activeProjectId.value = projects.value[0]?.id ?? null;
    }
  }

  function flushStreamDeltas(): void {
    if (streamFrame !== null) cancelAnimationFrame(streamFrame);
    streamFrame = null;
    for (const [streamId, delta] of pendingDeltas) {
      const index = messages.value.findIndex((item) => item.id === streamId);
      if (index < 0) continue;
      const current = messages.value[index]!;
      messages.value[index] = { ...current, content: current.content + delta };
    }
    pendingDeltas.clear();
  }

  function scheduleStreamFlush(): void {
    if (streamFrame !== null) return;
    streamFrame = requestAnimationFrame(flushStreamDeltas);
  }

  function ensureStreamMessage(event: MessageStreamEvent): void {
    if (messages.value.some((item) => item.id === event.streamId)) return;
    messages.value = [
      ...messages.value,
      {
        id: event.streamId,
        conversationId: event.conversationId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: new Date().toISOString(),
      },
    ];
  }

  const activeStreams = new Map<string,string>();
  function handleMessageStream(event: MessageStreamEvent): void {
    if(settledStreams.has(event.streamId))return;
    if (event.type === "start") {
      activeStreams.set(event.conversationId,event.streamId);
      streamSequences.set(event.streamId, event.sequence);
      pendingDeltas.delete(event.streamId);
      if (event.conversationId === activeConversationId.value) ensureStreamMessage(event);
      return;
    }
    if(activeStreams.get(event.conversationId)!==event.streamId)return;
    const lastSequence = streamSequences.get(event.streamId) ?? -1;
    if (event.sequence <= lastSequence) return;
    streamSequences.set(event.streamId, event.sequence);
    if (event.conversationId !== activeConversationId.value) return;
    if (event.type === "phase") return;
    ensureStreamMessage(event);
    if (event.type === "delta" && event.delta) {
      pendingDeltas.set(event.streamId, (pendingDeltas.get(event.streamId) ?? "") + event.delta);
      scheduleStreamFlush();
      return;
    }
    flushStreamDeltas();
    const index = messages.value.findIndex((item) => item.id === event.streamId);
    if (index < 0) return;
    const current = messages.value[index]!;
    if (event.type === "complete") {
      messages.value[index] = { ...current, content: event.content ?? current.content, status: "complete" };
    } else if (event.type === "cancelled") {
      messages.value[index] = { ...current, content: event.content ?? current.content, status: "cancelled" };
    } else if (event.type === "error") {
      messages.value[index] = { ...current, content: event.content ?? current.content, status: "failed" };
    }
  }

  async function refreshSkills(): Promise<void> {
    skills.value = (await window.materialsx.bootstrap()).skills;
  }

  async function initialize(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      if (!streamSubscribed) {
        window.materialsx.onMessageStream(handleMessageStream);
        streamSubscribed = true;
      }
      applyBootstrap(await window.materialsx.bootstrap());
      const first = projectConversations.value[0];
      if (first) await selectConversation(first.id);
      // Restore local context before optional network work can delay and overwrite user navigation.
      await loadSubscription();
    } catch (cause) {
      error.value = (cause instanceof Error ? cause.message : String(cause))
        .replace(/^Error invoking remote method '[^']+': Error: /, '');
    } finally {
      loading.value = false;
    }
  }

  async function loadSubscription(): Promise<void> {
    subscriptionLoading.value = true;
    try {
      subscription.value = await window.materialsx.getSubscription();
    } finally {
      subscriptionLoading.value = false;
    }
  }

  async function activateDevelopmentPlan(planId: "pro" | "research"): Promise<void> {
    subscriptionLoading.value = true;
    try {
      subscription.value = await window.materialsx.activateDevelopmentPlan(planId);
      connections.value = await window.materialsx.refreshDiagnostics();
    } finally {
      subscriptionLoading.value = false;
    }
  }

  async function chooseProject(): Promise<void> {
    const record = await window.materialsx.chooseProjectFolder();
    if (!record) return;
    const data = await window.materialsx.bootstrap();
    applyBootstrap(data);
    activeProjectId.value = record.id;
    activeConversationId.value = null;
    messages.value = [];
    activeView.value = "chat";
  }

  async function selectProject(projectId: string): Promise<void> {
    activeProjectId.value = projectId;
    activeConversationId.value = null;
    messages.value = [];
    const first = projectConversations.value[0];
    if (first) await selectConversation(first.id);
  }

  async function createConversation(): Promise<void> {
    if (!activeProjectId.value) return;
    const record = await window.materialsx.createConversation(activeProjectId.value);
    conversations.value = [record, ...conversations.value];
    activeConversationId.value = record.id;
    messages.value = [];
    activeView.value = "chat";
  }

  async function selectConversation(conversationId: string): Promise<void> {
    activeConversationId.value = conversationId;
    activeView.value = "chat";
    messages.value = await window.materialsx.listMessages(conversationId);
  }

  async function sendMessage(content: string): Promise<boolean> {
    if (!activeProjectId.value) return false;
    if (!activeConversationId.value) await createConversation();
    if (!activeConversationId.value) return false;
    sending.value = true;
    error.value = "";
    const conversationId = activeConversationId.value;
    const streamToken = crypto.randomUUID();
    const streamId = `stream:${conversationId}:${streamToken}`;
    const optimisticUserId = `client:${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const previousMessages = messages.value;
    const previousIds = new Set(previousMessages.map(item => item.id));
    messages.value = [
      ...messages.value.filter((item) => item.id !== streamId),
      { id: optimisticUserId, conversationId, role: "user", content, status: "complete", createdAt },
      { id: streamId, conversationId, role: "assistant", content: "", status: "streaming", createdAt },
    ];
    try {
      const persisted = await window.materialsx.sendMessage({
        projectId: activeProjectId.value,
        conversationId,
        content,
        streamToken,
      });
      // Fast host actions may return before queued stream events. The database reply is authoritative.
      settledStreams.add(streamId);
      if(settledStreams.size>256)settledStreams.delete(settledStreams.values().next().value!);
      pendingDeltas.delete(streamId);streamSequences.delete(streamId);
      if(activeStreams.get(conversationId)===streamId)activeStreams.delete(conversationId);
      // The host may return only the newly persisted assistant message. A new
      // durable message is enough to accept the reply; do not discard it just
      // because the corresponding user message was omitted from this payload.
      const accepted = persisted.some(item => !previousIds.has(item.id));
      messages.value = accepted ? persisted : previousMessages;
      sending.value = false;
      const currentProject = activeProjectId.value;
      const currentConversation = conversationId;
      applyBootstrap(await window.materialsx.bootstrap());
      activeProjectId.value = currentProject;
      activeConversationId.value = currentConversation;
      return accepted;
    } catch (cause) {
      messages.value = messages.value.filter((item) => item.id !== optimisticUserId && item.id !== streamId);
      error.value = (cause instanceof Error ? cause.message : String(cause))
        .replace(/^Error invoking remote method '[^']+': Error: /, '');
      return false;
    } finally {
      sending.value = false;
    }
  }

  async function cancelActiveRun(): Promise<void> {
    if (!activeConversationId.value) return;
    await window.materialsx.cancelRun(activeConversationId.value);
  }

  async function saveSettings(value: ModelSettings): Promise<void> {
    settings.value = await window.materialsx.saveModelSettings(value);
    await refreshDiagnostics();
  }

  async function refreshDiagnostics(): Promise<void> {
    connections.value = await window.materialsx.refreshDiagnostics();
  }

  async function loadReleaseReadiness(): Promise<void> {
    releaseLoading.value = true;
    try {
      releaseReadiness.value = await window.materialsx.getReleaseReadiness();
    } finally {
      releaseLoading.value = false;
    }
  }

  async function exportSupportBundle(): Promise<string | null> {
    const result = await window.materialsx.exportSupportBundle();
    return result.canceled ? null : (result.path ?? null);
  }

  function showView(view: WorkspaceView): void {
    activeView.value = view;
    if (view === "release") void loadReleaseReadiness();
  }

  return {
    loading,
    sending,
    error,
    appVersion,
    platform,
    projects,
    conversations,
    messages,
    skills,
    models,
    potentialRegistry,
    potentialCatalog,
    connections,
    runs,
    settings,
    subscription,
    subscriptionLoading,
    releaseReadiness,
    releaseLoading,
    activeProjectId,
    activeConversationId,
    activeView,
    activeProject,
    projectConversations,
    activeConversation,
    readyConnectionCount,
    initialize,
    refreshSkills,
    loadSubscription,
    activateDevelopmentPlan,
    chooseProject,
    selectProject,
    createConversation,
    selectConversation,
    sendMessage,
    cancelActiveRun,
    saveSettings,
    refreshDiagnostics,
    loadReleaseReadiness,
    exportSupportBundle,
    showView,
  };
});
