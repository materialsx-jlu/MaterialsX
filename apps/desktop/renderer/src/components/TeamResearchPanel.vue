<script setup lang="ts">
import { ElDrawer } from "element-plus";
import { Users, ShieldCheck, RefreshCw, FileCheck2 } from "@lucide/vue";
import type { ResearchSnapshot } from "../../../../../packages/contracts/src/research-project.js";
import { useTeamResearch } from "../utils/use-team-research";
const props = defineProps<{
  projectId: string;
  locale: "zh" | "en";
  active: boolean;
  snapshots: ResearchSnapshot[];
  selected: string[];
}>();
const emit = defineEmits<{ changed: [] }>();
const {
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
} = useTeamResearch(props, emit);
</script>
<template>
  <section class="team-panel" data-testid="team-panel">
    <header class="team-heading">
      <div>
        <h2>{{ t("团队研究", "Team research") }}</h2>
        <p>
          {{
            t(
              "共享研究条件和授权数据，由独立审核者复核纠错。",
              "Share research conditions and authorized data; review corrections independently.",
            )
          }}
        </p>
      </div>
      <button class="secondary-button" :disabled="busy" @click="perform(load)">
        <RefreshCw :size="15" />{{ t("刷新", "Refresh") }}
      </button>
    </header>
    <p v-if="error || state?.error" class="team-error" role="alert">
      {{ errorText(error || state?.error) }}
    </p>
    <p v-if="result" class="team-notice">{{ result }}</p>
    <article class="team-card">
      <header>
        <Users :size="21" />
        <div>
          <h3>{{ t("共享项目连接", "Shared project connection") }}</h3>
          <p>
            {{
              t(
                "使用云服务中心的登录账户。项目成员和可读实验由团队单独授权。",
                "Use your existing platform account. The team grants project membership and experiment access separately.",
              )
            }}
          </p>
        </div>
      </header>
      <div class="team-row">
        <button
          class="secondary-button"
          data-testid="team-list"
          :disabled="busy"
          @click="list"
        >
          {{ t("查看我的共享项目", "My shared projects") }}</button
        ><select
          v-model="projectChoice"
          :disabled="busy"
          aria-label="Shared project"
        >
          <option value="">
            {{ t("选择共享项目", "Select a shared project") }}
          </option>
          <option v-for="item in projects" :key="item.id" :value="item.id">
            {{ item.name }} · {{ roleLabel(item.role) }}
          </option>
          <option
            v-if="
              state?.link.remoteProjectId &&
              !projects.some((item) => item.id === state?.link.remoteProjectId)
            "
            :value="state.link.remoteProjectId"
          >
            {{ state.link.remoteProjectId }}
          </option></select
        ><button
          class="primary-button"
          :disabled="busy || !projectChoice"
          @click="connect(true)"
        >
          {{ t("连接", "Connect") }}</button
        ><button
          v-if="state?.link.enabled"
          class="secondary-button"
          :disabled="busy"
          @click="connect(false)"
        >
          {{ t("关闭连接", "Disconnect") }}
        </button>
      </div>
      <p v-if="!remote" class="field-help">
        {{
          t(
            "未连接共享项目。请先登录，再由项目所有者添加你的账户 ID。",
            "No shared project connected. Sign in, then ask the project owner to add your account ID.",
          )
        }}
      </p>
      <div v-else class="team-badges">
        <span>{{ remote.project.name }}</span
        ><span>{{ roleLabel(remote.member.role) }}</span
        ><span>{{
          remote.production
            ? t("正式服务", "Production")
            : t("本机开发服务", "Local development")
        }}</span
        ><span>{{ t("仅本地模型分析", "Local model analysis only") }}</span>
      </div>
    </article>
    <template v-if="remote">
      <p v-if="remote.manifestAccessChanged" class="team-notice">
        {{
          t(
            "共享来源权限已调整，请编辑者重新保存研究条件。",
            "Shared source access changed. An editor must save the research conditions again.",
          )
        }}
      </p>
      <div class="team-columns">
        <article class="team-card">
          <header>
            <ShieldCheck :size="21" />
            <div>
              <h3>{{ t("共享研究条件", "Shared research conditions") }}</h3>
              <p>
                {{
                  t(
                    "共享材料体系、条件、备注和 MOOS 引用。不会上传本机文件或整个工作区。",
                    "Share material, conditions, notes and MOOS references. Local files and the workspace are not uploaded.",
                  )
                }}
              </p>
            </div>
          </header>
          <div class="team-form">
            <label
              >{{ t("材料体系", "Material system")
              }}<input
                v-model="material"
                :readonly="!editor"
                maxlength="300" /></label
            ><label
              >{{ t("条件 · 每行一项", "Conditions · one per line")
              }}<textarea
                v-model="conditions"
                :readonly="!editor"
                rows="3"
              /></label
            ><label
              >{{ t("团队备注", "Team notes")
              }}<textarea
                v-model="notes"
                :readonly="!editor"
                rows="3"
                maxlength="8000"
              />
            </label>
          </div>
          <p class="field-help">
            {{ t("共享版本", "Shared revision") }}
            {{ remote.manifest.revision }} · {{ remote.manifest.refs.length }}
            {{ t("个来源引用", "source references") }}
          </p>
          <div class="team-row">
            <button
              v-if="editor"
              class="primary-button"
              :disabled="busy"
              @click="share"
            >
              {{
                t("保存并共享当前来源", "Save & share current sources")
              }}</button
            ><button
              class="secondary-button"
              :disabled="busy"
              @click="importManifest"
            >
              {{ t("导入本机研究项目", "Import into local research") }}
            </button>
          </div>
        </article>
        <article class="team-card">
          <header>
            <Users :size="21" />
            <div>
              <h3>{{ t("项目成员", "Project members") }}</h3>
              <p>
                {{
                  t(
                    "阅读者读取数据；编辑者提交纠错；审核者独立复核。",
                    "Readers access data; editors propose changes; reviewers review independently.",
                  )
                }}
              </p>
            </div>
          </header>
          <div v-for="m in remote.members" :key="m.accountId" class="team-item">
            <div>
              <strong>{{ m.accountId }}</strong
              ><small
                >{{ roleLabel(m.role) }} ·
                {{
                  m.active ? t("已授权", "Active") : t("已撤销", "Revoked")
                }}</small
              >
            </div>
            <button
              v-if="owner && m.accountId !== remote.member.accountId"
              class="secondary-button"
              :disabled="busy || memberReason.length < 5"
              @click="member(!m.active, m)"
            >
              {{ m.active ? t("撤销", "Revoke") : t("恢复", "Restore") }}
            </button>
          </div>
          <div v-if="owner" class="team-form">
            <label
              >{{ t("账户 ID", "Account ID")
              }}<input v-model="account" maxlength="128" /></label
            ><label
              >{{ t("角色", "Role")
              }}<select v-model="role">
                <option value="reader">{{ roleLabel("reader") }}</option>
                <option value="editor">{{ roleLabel("editor") }}</option>
                <option value="reviewer">{{ roleLabel("reviewer") }}</option>
              </select></label
            ><label
              >{{
                t(
                  "授权变更原因 · 至少 5 字",
                  "Reason for change · at least 5 characters",
                )
              }}<input v-model="memberReason" maxlength="500" /></label
            ><button
              class="secondary-button"
              :disabled="busy || !account || memberReason.length < 5"
              @click="member(true)"
            >
              {{ t("保存成员授权", "Save membership") }}
            </button>
          </div>
        </article>
      </div>
      <article class="team-card">
        <header>
          <FileCheck2 :size="21" />
          <div>
            <h3>{{ t("数据纠错", "Data corrections") }}</h3>
            <p>
              {{
                t(
                  "提议、独立审核、MOOS 更新核验。批准提议不会直接改变原始数据。",
                  "Propose, review independently, then verify the MOOS update. Approval does not modify canonical data.",
                )
              }}
            </p>
          </div>
          <button
            v-if="editor"
            class="secondary-button"
            data-testid="team-propose"
            :disabled="busy || !snapshots.length"
            @click="openProposal"
          >
            {{ t("提交纠错", "Propose correction") }}
          </button>
        </header>
        <p v-if="!remote.proposals.length" class="field-help">
          {{ t("暂无纠错提议。", "No correction proposals.") }}
        </p>
        <div
          v-for="c in remote.proposals"
          :key="c.id"
          class="team-item correction-item"
        >
          <div>
            <strong>{{ status(c.status) }}</strong
            ><small
              >{{ c.input.pointer }} · {{ JSON.stringify(c.input.before) }} →
              {{ JSON.stringify(c.input.after) }}</small
            >
            <p>{{ c.input.reason }}</p>
            <small
              >{{ t("提交者", "Author") }} {{ c.authorId }} ·
              {{ t("版本", "Revision") }} {{ c.revision }}</small
            >
            <details>
              <summary>{{ t("证据与审核记录", "Evidence & review") }}</summary>
              <p>
                {{ c.input.evidenceId }} ·
                {{ t("MOOS 来源版本", "MOOS generation") }}
                {{ c.input.ref.generation }}
              </p>
              <p v-if="c.reviewerId">
                {{ c.reviewerId }} · {{ c.reviewReason }}
              </p>
              <code v-if="c.upstreamReceiptSha256">{{
                c.upstreamReceiptSha256
              }}</code>
            </details>
          </div>
          <div class="team-row">
            <button
              v-if="
                reviewer &&
                c.authorId !== remote.member.accountId &&
                ['proposed', 'approved-awaiting-upstream'].includes(c.status)
              "
              class="secondary-button"
              @click="openReview(c)"
            >
              {{
                c.status === "proposed"
                  ? t("审核", "Review")
                  : t("核验 MOOS 更新", "Verify MOOS update")
              }}</button
            ><button
              v-if="
                (editor || reviewer) &&
                c.status === 'approved-awaiting-upstream'
              "
              class="secondary-button"
              @click="exportPacket(c)"
            >
              {{ t("导出回写包", "Export correction packet") }}
            </button>
          </div>
        </div>
      </article>
      <details class="team-card">
        <summary>{{ t("授权与操作记录", "Authorization & activity") }}</summary>
        <p v-for="a in remote.audit" :key="a.sequence" class="audit-line">
          {{ a.createdAt }} · {{ a.actorId }} · {{ a.action
          }}<small>{{ a.detailSha256 }}</small>
        </p>
      </details>
    </template>
    <ElDrawer
      v-model="editing"
      :title="t('提交数据纠错', 'Propose data correction')"
      size="min(620px,100vw)"
      append-to-body
    >
      <div class="team-form">
        <label
          >{{ t("原始来源", "Original source")
          }}<select v-model="snapshotChoice">
            <option v-for="s in snapshots" :key="s.id" :value="s.id">
              {{ s.title }}
            </option>
          </select></label
        ><label
          >{{
            t(
              "字段路径 · 例如 /observations/0/value",
              "Field path · e.g. /observations/0/value",
            )
          }}<input v-model="pointer" /></label
        ><label
          >{{ t("原值 · JSON 标量", "Original value · JSON scalar")
          }}<input v-model="before" /></label
        ><label
          >{{ t("建议值 · JSON 标量", "Proposed value · JSON scalar")
          }}<input v-model="after" /></label
        ><label
          >{{ t("证据 ID", "Evidence ID")
          }}<input v-model="evidenceId" /></label
        ><label
          >{{ t("原因 · 至少 10 字", "Reason · at least 10 characters")
          }}<textarea v-model="reason" rows="4" /></label
        ><label class="team-check"
          ><input type="checkbox" v-model="confirmed" />{{
            t(
              "我已核对原值和证据，提交人工纠错提议。",
              "I checked the original value and evidence and submit this human correction proposal.",
            )
          }}</label
        ><button
          class="primary-button"
          :disabled="busy || !confirmed || reason.length < 10"
          @click="propose"
        >
          {{ t("提交提议", "Submit proposal") }}
        </button>
        <p v-if="error" class="team-error">{{ errorText(error) }}</p>
      </div>
    </ElDrawer>
    <ElDrawer
      :model-value="!!reviewing"
      @update:model-value="!$event && (reviewing = null)"
      :title="t('独立审核', 'Independent review')"
      size="min(620px,100vw)"
      append-to-body
    >
      <div v-if="reviewing" class="team-form">
        <p>
          {{ reviewing.input.pointer }} ·
          {{ JSON.stringify(reviewing.input.before) }} →
          {{ JSON.stringify(reviewing.input.after) }}
        </p>
        <p>{{ reviewing.input.reason }} · {{ reviewing.input.evidenceId }}</p>
        <template v-if="reviewing.status === 'proposed'"
          ><label
            >{{ t("审核意见", "Decision")
            }}<select v-model="decision">
              <option value="approve">{{ t("批准", "Approve") }}</option>
              <option value="reject">{{ t("驳回", "Reject") }}</option>
            </select></label
          ><label
            >{{
              t(
                "审核依据 · 至少 10 字",
                "Review basis · at least 10 characters",
              )
            }}<textarea v-model="reviewReason" rows="4" /></label></template
        ><label v-else
          >{{ t("MOOS 新版本引用 · JSON", "New MOOS reference · JSON")
          }}<textarea v-model="newReference" rows="9" /><small>{{
            t(
              "粘贴实际 MOOS 返回的引用。必须是同一实验、更高版本、已审核且修正值一致。",
              "Paste a genuine MOOS reference. Same experiment, higher reviewed generation, matching corrected value required.",
            )
          }}</small></label
        ><label class="team-check"
          ><input type="checkbox" v-model="reviewConfirmed" />{{
            t(
              "我已独立核对原始证据和审核依据。",
              "I independently checked the original evidence and review basis.",
            )
          }}</label
        ><button
          class="primary-button"
          :disabled="
            busy ||
            !reviewConfirmed ||
            (reviewing.status === 'proposed'
              ? reviewReason.length < 10
              : !newReference)
          "
          @click="reviewing.status === 'proposed' ? review() : confirm()"
        >
          {{
            reviewing.status === "proposed"
              ? t("保存审核结果", "Save review")
              : t("核验真实更新", "Verify actual update")
          }}
        </button>
        <p v-if="error" class="team-error">{{ errorText(error) }}</p>
      </div>
    </ElDrawer>
  </section>
</template>
<style scoped src="./team-research-panel.css"></style>
