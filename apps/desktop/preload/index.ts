import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, MessageStreamEvent, ModelSettings, SendMessageInput } from "../../../packages/contracts/src/desktop.js";

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke("workspace:bootstrap"),
  revealArtifact: (path) => ipcRenderer.invoke("workspace:reveal-artifact", path),
  chooseProjectFolder: () => ipcRenderer.invoke("workspace:choose-project"),
  createConversation: (projectId) => ipcRenderer.invoke("workspace:create-conversation", projectId),
  listMessages: (conversationId) => ipcRenderer.invoke("workspace:list-messages", conversationId),
  sendMessage: (input: SendMessageInput) => ipcRenderer.invoke("workspace:send-message", input),
  onMessageStream: (listener) => {
    ipcRenderer.on("workspace:message-stream", (_event, payload: MessageStreamEvent) => listener(payload));
  },
  cancelRun: (conversationId) => ipcRenderer.invoke("workspace:cancel-run", conversationId),
  saveModelSettings: (settings: ModelSettings) => ipcRenderer.invoke("settings:save-model", settings),
  probeLocalModels: (endpoint) => ipcRenderer.invoke("settings:probe-local-models", endpoint),
  openResearchModelSource: (modelId) => ipcRenderer.invoke("models:open-source", modelId),
  getSubscription: () => ipcRenderer.invoke("subscription:get"),
  activateDevelopmentPlan: (planId) => ipcRenderer.invoke("subscription:activate-development", planId),
  refreshDiagnostics: () => ipcRenderer.invoke("diagnostics:refresh"),
  getReleaseReadiness: () => ipcRenderer.invoke("release:readiness"),
  exportSupportBundle: () => ipcRenderer.invoke("release:export-support-bundle"),
};

contextBridge.exposeInMainWorld("materialsx", api);
