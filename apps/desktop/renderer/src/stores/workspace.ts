import { computed, ref } from "vue";
import { defineStore } from "pinia";
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
  const connections = ref<ConnectionSummary[]>([]);
  const runs = ref<RunRecord[]>([]);
  const settings = ref<ModelSettings>({
    mode: "platform",
    modelId: "materials-research",
    localEndpoint: "http://127.0.0.1:11434",
  });
  const subscription = ref<SubscriptionSnapshot | null>(null);
  const subscriptionLoading = ref(false);
  const releaseReadiness = ref<ReleaseReadiness | null>(null);
  const releaseLoading = ref(false);
  const activeProjectId = ref<string | null>(null);
  const activeConversationId = ref<string | null>(null);
  const activeView = ref<WorkspaceView>("chat");
  const pendingDeltas = new Map<string, string>();
  const streamSequences = new Map<string, number>();
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

  function handleMessageStream(event: MessageStreamEvent): void {
    if (event.type === "start") {
      streamSequences.set(event.streamId, event.sequence);
      pendingDeltas.delete(event.streamId);
      if (event.conversationId === activeConversationId.value) ensureStreamMessage(event);
      return;
    }
    const lastSequence = streamSequences.get(event.streamId) ?? -1;
    if (event.sequence <= lastSequence) return;
    streamSequences.set(event.streamId, event.sequence);
    if (event.conversationId !== activeConversationId.value) return;
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

  async function initialize(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      if (!streamSubscribed) {
        window.materialsx.onMessageStream(handleMessageStream);
        streamSubscribed = true;
      }
      applyBootstrap(await window.materialsx.bootstrap());
      await loadSubscription();
      const first = projectConversations.value[0];
      if (first) await selectConversation(first.id);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
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

  async function sendMessage(content: string): Promise<void> {
    if (!activeProjectId.value) return;
    if (!activeConversationId.value) await createConversation();
    if (!activeConversationId.value) return;
    sending.value = true;
    error.value = "";
    const conversationId = activeConversationId.value;
    const streamId = `stream:${conversationId}`;
    const optimisticUserId = `client:${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    messages.value = [
      ...messages.value.filter((item) => item.id !== streamId),
      { id: optimisticUserId, conversationId, role: "user", content, status: "complete", createdAt },
      { id: streamId, conversationId, role: "assistant", content: "", status: "streaming", createdAt },
    ];
    try {
      messages.value = await window.materialsx.sendMessage({
        projectId: activeProjectId.value,
        conversationId,
        content,
      });
      sending.value = false;
      const currentProject = activeProjectId.value;
      const currentConversation = conversationId;
      applyBootstrap(await window.materialsx.bootstrap());
      activeProjectId.value = currentProject;
      activeConversationId.value = currentConversation;
    } catch (cause) {
      messages.value = messages.value.filter((item) => item.id !== optimisticUserId && item.id !== streamId);
      error.value = cause instanceof Error ? cause.message : String(cause);
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
