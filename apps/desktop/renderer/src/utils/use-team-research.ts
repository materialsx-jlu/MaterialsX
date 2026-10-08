import { computed, ref, watch } from "vue";
import type {
  TeamWorkspace,
  Correction,
} from "../../../../../packages/contracts/src/team-research.js";
import type { ResearchSnapshot } from "../../../../../packages/contracts/src/research-project.js";
export function useTeamResearch(
  props: {
    projectId: string;
    locale: "zh" | "en";
    active: boolean;
    snapshots: ResearchSnapshot[];
    selected: string[];
  },
  emit: (event: "changed") => void,
) {
  const state = ref<TeamWorkspace | null>(null),
    projects = ref<Array<{ id: string; name: string; role: string }>>([]),
    projectChoice = ref(""),
    busy = ref(false),
    error = ref(""),
    result = ref("");
  const material = ref(""),
    conditions = ref(""),
    notes = ref(""),
    account = ref(""),
    role = ref<"reader" | "editor" | "reviewer">("reader"),
    memberReason = ref("");
  const proposalRequestId = ref(crypto.randomUUID());
  const editing = ref(false),
    snapshotChoice = ref(""),
    pointer = ref("/observations/0/value"),
    before = ref("null"),
    after = ref("null"),
    evidenceId = ref(""),
    reason = ref(""),
    confirmed = ref(false);
  const reviewing = ref<Correction | null>(null),
    decision = ref<"approve" | "reject">("approve"),
    reviewReason = ref(""),
    reviewConfirmed = ref(false),
    newReference = ref("");
  const t = (zh: string, en: string) => (props.locale === "zh" ? zh : en);
  const errorText = (value: string | null | undefined) => {
    const code = String(value ?? "");
    if (/TEAM_LOGIN_REQUIRED|重新登录|请先登录/.test(code))
      return t(
        "请先在云服务中心登录，然后刷新团队项目。",
        "Sign in to the platform, then refresh this team project.",
      );
    if (/ACCESS_DENIED|FORBIDDEN/.test(code))
      return t(
        "当前账户没有项目权限，请联系项目所有者。",
        "This account has no project access. Contact the project owner.",
      );
    if (/VERSION_OR_SOURCE_CHANGED|SHARED_SCOPE_CHANGED/.test(code))
      return t(
        "来源或授权已更新，请刷新并重新核对证据。",
        "Source data or access changed. Refresh and check the evidence again.",
      );
    if (/STOP_RUNNING_RESEARCH/.test(code))
      return t(
        "请先停止正在运行的研究，再修改团队设置。",
        "Stop the running research before changing team settings.",
      );
    if (/CONNECTION_DISABLED/.test(code))
      return t("请先连接共享项目。", "Connect a shared project first.");
    if (/KEEP_DISABLED_BINDING/.test(code))
      return t(
        "含团队资料的工作区需要保留项目绑定；可以关闭连接。",
        "A workspace with team data keeps its project binding. You can disconnect it.",
      );
    if (/JSON|Unexpected token|INVALID_REQUEST/.test(code))
      return t(
        "请检查字段值：数字直接输入，字符串使用英文双引号。",
        "Check the field values: enter numbers directly and enclose strings in double quotes.",
      );
    return code
      ? t(
          "操作未完成，请检查账户与服务连接，刷新后重试。",
          "The operation did not complete. Check your account and service connection, then refresh.",
        )
      : "";
  };
  const remote = computed(() => state.value?.remote),
    editor = computed(() => remote.value?.member.role === "editor"),
    reviewer = computed(() => remote.value?.member.role === "reviewer"),
    owner = computed(
      () => remote.value?.project.ownerId === remote.value?.member.accountId,
    );
  const snapshots = computed(() =>
      props.snapshots.filter((s) => s.ref && props.selected.includes(s.id)),
    ),
    chosen = computed(() =>
      snapshots.value.find((s) => s.id === snapshotChoice.value),
    );
  const status = (s: string) =>
    ({
      proposed: t("待审核", "Awaiting review"),
      rejected: t("已驳回", "Rejected"),
      "approved-awaiting-upstream": t(
        "已批准 · 等待 MOOS 更新",
        "Approved · awaiting MOOS update",
      ),
      applied: t("MOOS 新版本已核验", "MOOS update verified"),
    })[s] ?? s;
  const roleLabel = (s: string) =>
    ({
      reader: t("阅读者", "Reader"),
      editor: t("编辑者", "Editor"),
      reviewer: t("审核者", "Reviewer"),
    })[s] ?? s;
  async function load() {
    const id = props.projectId;
    const value = await window.materialsx.getTeamResearch(id);
    if (id !== props.projectId) return;
    state.value = value;
    projectChoice.value = value.link.remoteProjectId ?? "";
    material.value = value.remote?.manifest.materialSystem ?? "";
    conditions.value = value.remote?.manifest.conditions.join("\n") ?? "";
    notes.value = value.remote?.manifest.notes ?? "";
    emit("changed");
  }
  async function perform(fn: () => Promise<unknown>) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    result.value = "";
    try {
      await fn();
    } catch (e) {
      error.value = String(e);
    } finally {
      busy.value = false;
    }
  }
  watch(
    () => [props.projectId, props.active],
    () => {
      editing.value = false;
      reviewing.value = null;
      error.value = "";
      projects.value = [];
      if (props.active) void perform(load);
    },
    { immediate: true },
  );
  async function list() {
    await perform(async () => {
      projects.value = await window.materialsx.listTeamProjects();
    });
  }
  async function connect(enabled: boolean) {
    await perform(async () => {
      const old = state.value!.link;
      await window.materialsx.saveTeamLink(
        props.projectId,
        {
          enabled,
          remoteProjectId: projectChoice.value || old.remoteProjectId,
          revision: old.revision + 1,
        },
        old.revision,
      );
      await load();
      emit("changed");
    });
  }
  async function share() {
    await perform(async () => {
      const old = remote.value!.manifest;
      await window.materialsx.saveTeamManifest(
        props.projectId,
        {
          materialSystem: material.value,
          conditions: conditions.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          notes: notes.value,
          refs: snapshots.value.map((s) => JSON.parse(JSON.stringify(s.ref))),
          revision: old.revision + 1,
        },
        old.revision,
      );
      await load();
    });
  }
  async function importManifest() {
    await perform(async () => {
      await window.materialsx.importTeamManifest(props.projectId);
      emit("changed");
      result.value = t(
        "已导入共享条件，并重新读取所选 MOOS 证据。",
        "Shared conditions imported; MOOS evidence read again.",
      );
    });
  }
  async function member(
    active: boolean,
    existing?: {
      accountId: string;
      role: "reader" | "editor" | "reviewer";
      revision: number;
    },
  ) {
    await perform(async () => {
      await window.materialsx.changeTeamMember(
        props.projectId,
        existing?.accountId ?? account.value,
        {
          role: existing?.role ?? role.value,
          active,
          expectedRevision:
            existing?.revision ??
            remote.value!.members.find((m) => m.accountId === account.value)
              ?.revision ??
            0,
          reason: memberReason.value,
        },
      );
      await load();
    });
  }
  function openProposal() {
    proposalRequestId.value = crypto.randomUUID();
    snapshotChoice.value = snapshots.value[0]?.id ?? "";
    reason.value = "";
    evidenceId.value = "";
    confirmed.value = false;
    editing.value = true;
  }
  watch(snapshotChoice, () => {
    const s = chosen.value;
    const row = (s?.data.observations as any[])?.[0];
    pointer.value = "/observations/0/value";
    before.value = JSON.stringify(row?.value ?? null);
    evidenceId.value = s?.evidence[0]?.locator ?? "";
  });
  async function propose() {
    await perform(async () => {
      if (!confirmed.value || !chosen.value?.ref)
        throw Error(
          t(
            "请选择来源并确认已核对证据。",
            "Select a source and confirm evidence review.",
          ),
        );
      await window.materialsx.proposeResearchCorrection(props.projectId, {
        requestId: proposalRequestId.value,
        ref: JSON.parse(JSON.stringify(chosen.value.ref)),
        pointer: pointer.value,
        before: JSON.parse(before.value),
        after: JSON.parse(after.value),
        evidenceId: evidenceId.value,
        reason: reason.value,
        humanConfirmed: true,
      });
      editing.value = false;
      await load();
    });
  }
  function openReview(c: Correction) {
    reviewing.value = c;
    reviewReason.value = "";
    reviewConfirmed.value = false;
    newReference.value = "";
    decision.value = "approve";
  }
  async function review() {
    await perform(async () => {
      if (!reviewConfirmed.value)
        throw Error(t("请确认已独立审核。", "Confirm independent review."));
      const c = reviewing.value!;
      await window.materialsx.reviewResearchCorrection(props.projectId, c.id, {
        expectedRevision: c.revision,
        decision: decision.value,
        reason: reviewReason.value,
        humanConfirmed: true,
      });
      reviewing.value = null;
      await load();
    });
  }
  async function confirm() {
    await perform(async () => {
      if (!reviewConfirmed.value)
        throw Error(
          t("请确认已核对 MOOS 新版本。", "Confirm the new MOOS version."),
        );
      const c = reviewing.value!;
      await window.materialsx.confirmResearchCorrection(props.projectId, c.id, {
        expectedRevision: c.revision,
        newRef: JSON.parse(newReference.value),
        humanConfirmed: true,
      });
      reviewing.value = null;
      await load();
      emit("changed");
    });
  }
  async function exportPacket(c: Correction) {
    await perform(async () => {
      const saved = await window.materialsx.exportResearchCorrection(
        props.projectId,
        c.id,
      );
      result.value =
        t("回写包已保存：", "Correction packet saved: ") + saved.path;
      await load();
    });
  }

  return {
    errorText,
    state,
    projects,
    projectChoice,
    busy,
    error,
    result,
    material,
    conditions,
    notes,
    account,
    role,
    memberReason,
    editing,
    snapshotChoice,
    pointer,
    before,
    after,
    evidenceId,
    reason,
    confirmed,
    reviewing,
    decision,
    reviewReason,
    reviewConfirmed,
    newReference,
    t,
    remote,
    editor,
    reviewer,
    owner,
    snapshots,
    roleLabel,
    status,
    perform,
    load,
    list,
    connect,
    share,
    importManifest,
    member,
    openProposal,
    propose,
    openReview,
    review,
    confirm,
    exportPacket,
  };
}
