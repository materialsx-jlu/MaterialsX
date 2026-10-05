# 贡献指南

© 2026 吉林大学 AI-DAOS 团队

欢迎改进材料工作流、界面、Skills、运行时与文档。请先阅读 [README](README.md)、[开发状态](docs/STATUS.md) 和对应里程碑计划。GitHub 归属为 [materialsx-jlu](https://github.com/materialsx-jlu)，计划仓库名为 `MaterialsX`，本轮未创建或推送，以下 Issue/PR 流程在仓库建立后适用。

## 提交方式

1. 普通 Issue 提供系统、架构、版本、复现步骤、预期/实际结果和脱敏日志；安全问题按 [SECURITY.md](SECURITY.md) 私下报告。
2. 大改动先讨论目标、科学输出和验收；小修复可直接提交 PR。不要将 M5/M6 计划中的功能标作已完成。
3. Fork 后创建主题分支，小范围修改。PR 说明问题、修改后的行为、验证命令/结果和限制；界面变更附无个人研究信息的截图。
4. 科学测试使用合成、获授权或可再分发的公开数据，记录来源、许可、版本和哈希。禁止上传未授权论文、私有研究数据、模型权重或真实凭据。

贡献者保留其贡献版权；提交者须有权提供贡献，并同意自有新增内容按 AGPL-3.0-only 分发。第三方材料保留原有版权和许可。当前没有另设 CLA 或要求转让版权。

## 环境与目录

建议 Node.js 24、Python 3.12/uv；控制面需 Go 1.25。使用 `npm ci`、`uv sync --project python --frozen` 并保留锁文件。开发启动 `npm run dev`；可选控制面 `npm run control-plane:dev`。

| 目录 | 内容 |
| --- | --- |
| `apps/desktop` | Electron main/preload 与 Vue 界面 |
| `packages` | 合同、Pi 适配、存储、模型策略与共享逻辑 |
| `services/control-plane` | Go 开发订阅/额度控制面、独立 PostgreSQL 身份服务 |
| `python` | 科学运行时和文档探针 |
| `skills` / `vendor` | 固定 Skills、双语资料、上游快照与哈希 |
| `models` | 模型目录元数据，非预装权重 |
| `docs` / `release/evidence` | 开发计划与经复核的发布证据 |

## 按变更选择验证

自有源码单文件不得超过 600 个物理行（包括空行）；`npm run source:size` 扫描已跟踪和新增文件，并已加入 `npm run check` 与 CI。第三方 vendor、依赖、生成产物和运行时不计入；不能通过压缩成超长行、改后缀或将自有源码放入排除目录规避。新增职责按模块拆分，确认无调用与兼容需求的旧实现直接删除。

统一 Agent 开发从 [UA.0 基线](docs/agent/ua-0.md) 继续，只维护 [UA 主计划](docs/UNIFIED_AGENT_DEVELOPMENT_PLAN.md) 的阶段状态。`npm run ua0:verify` 为离线检查；`ua0:moos` 只读取已运行的本机 MOOS，`lmstudio:probe` 会向已加载的本地模型发出两个有上限的合成请求，不下载模型。`ua0:codex` 的隔离公开运行时安装与探针步骤见基线文档，不使用个人 Codex 凭据或外部计费 API。探针证据保存在已忽略的 `runtime/agent/ua-0/`；公开只保留脱敏摘要。

| 变更 | 验证命令 |
| --- | --- |
| TypeScript/Vue、主进程、合同 | `npm run check`、`npm run test`、`npm run build` |
| Go 控制面 | `npm run control-plane:test`；身份改动还须在隔离 PG16 实例运行 `npm run m5:identity:test` 和 `npm run m5:identity:live`，配置见 [M5.1](docs/m5/identity.md) |
| Python 文档/科学代码 | `uv run --project python --frozen pytest python/tests` |
| Skill/元数据/示例 | `npm run skills:audit`、`npm run skills:accept`；打包后 `npm run skills:verify-bundle` |
| Pi/MCP | `npm run m0:pi` 及相关自动化测试 |
| 发布工程 | `npm run m4:readiness`；正式放行用 `npm run m4:release-gate` |
| 所有公开提交 | `python3 scripts/check-public-secrets.py`；人工检查差异、截图和二进制资产 |

完整 `npm run verify` 包含类型、测试、构建、Go、Python、Skills、Pi 和运行时预检。`m0:preflight`、`m0:lammps`、`m0:qe` 可能需要额外 OCR/求解器环境，报告要区分未安装、未执行和失败。当前 CI 只覆盖部分开发检查，不能替代双平台实机安装、科学保留集或付费链路验收。

纯文档/版权修改可核对链接和配置，无需新增机械复现实现的测试。科学行为/执行逻辑修改须补充有意义的输入、边界或失败回归测试；默认单元测试不调用真实付费 API。

## Skills、依赖与科学结果

- 不手改上游快照绕过哈希。上游变更更新固定提交、同步流程、清单与许可；自研 Skill 使用对应清单生成流程。
- 默认启用不代表可选软件已安装。新增依赖声明平台、版本、许可、下载和失败行为。
- 修改依赖或重装 Python 运行时后执行 `python3 scripts/generate-third-party-inventory.py`，人工审核清单差异。
- 保留单位、页码、证据、缺失与不确定性。格式校验和科学质量分开报告，文字声明不能替代真实执行产物。
- M6 模型的代码、权重、训练数据许可分别核验，不从代码许可推导权重再分发权。

## 凭据与公开发布

`.env.example` 仅是占位变量清单，当前入口不会自动加载 `.env`。`ROOTFLOWAI_*` 供 M5.0 服务端探针使用；身份服务的数据库/master key 仅服务端注入。真实 Key 不得进入命令历史、PR、Issue、日志或截图。

`.gitignore` 不会移除已经提交的文件。提交前检查 `git status` 和 `git diff --cached`；扫描器检查当前文件与暂存内容，不能证明历史或所有类型秘密都不存在。泄漏后先撤销/轮换，再清理历史与发行产物。

二进制分发前提供该版本对应源码、构建说明、依赖许可和必要源码获取方式；根 LICENSE 不能代替完整第三方复核。

M5.4 的 PG/签名/退款测试已纳入 `m5:identity:test`；桌面集成使用 `npm run build` 后运行 `npm run m5:payments:live`，只创建自身临时数据库和合成渠道，不使用商户密钥或真实资金。更多限制见 [M5.4](docs/m5/payments.md)。

M5.5 后台额外命令：`npm run check:admin` / `npm run build:admin`（包含在根 check/build）；`npm run m5:workspace:live` 要求隔离 PostgreSQL 测试 DSN，运行真实桌面/后台 UI 与合成模型/支付闭环，不产生真实费用。流程与迁移见 [指南](docs/m5/workspace.md)。不要在截图、测试 evidence、Issue 或审计原因中放真实凭据/科研内容。

M5 生命周期回归：专用本机 PostgreSQL 可运行 `npm run m5:beta:race`；CI 使用隔离 `MATERIALSX_IDENTITY_TEST_DATABASE_URL` 运行 `npm run m5:identity:test`。工程测试不应接入真实供应商、真实商户或邮件；前后台合成 UI 验收运行 `npm run m5:workspace:live`。上线资料与限制见 [M5 生命周期](docs/m5/lifecycle-delivery.md)。

M6 相关修改另运行 `npm run m6:verify`。合同以 `packages/contracts/src/atomistic.ts` 为准，导出及检查用 `m6:contracts` / `m6:contracts:check`；跨字段规则不能只依赖 JSON Schema。冻结输入修改需审查并按 `docs/m6/README.md` 提升相应版本后明确 refreeze；不得自动放宽科学门槛。实际桌面验收 `npm run m6:ui` 使用隔离 userData，不需要真实账户、API 密钥或支付。

M6.4 修改运行 `npm run m64:contracts:check`、`npm run m6:selection:test` 和 `npm run m6:ui:selection`。第一项也检查 Go 内嵌的科学工具参数与 Pi schema 一致；后两项使用团队合成结构与真实本机 CPU 权重，平台传输是离线合成，不访问供应商/支付。新增 Skill 同时更新默认配置、manifest、分类、双语介绍/例子及执行状态，运行 `npm run skills:accept:materialsx`。不得改变 M6.0 冻结文件或重写历史证据来声称新阶段已验收。

完整原生云端科学闭环用 `npm run m6:cloud:selection`。需要 PostgreSQL 16 工具；默认创建临时 loopback PG 实例和合成账户，测试后停止并清理，不使用现有开发/生产数据库。可显式指定带 `test` 的隔离测试 DSN。严禁把供应商密钥或正式商户配置传入验收脚本。

M6.5 修改运行 `npm run m65:contracts:check`、`npm run m6:md:test`、`npm run m6:ui:md` 和 `npm run m6:cloud:md`；Python 控制/物理测试在锁定原子运行时中执行 `python -m pytest atomistic/tests -q`。轨迹只用实际注册帧、真实 fs/Å/Å·fs^-1 单位与哈希范围读取；不把 NVT 恒温当能量守恒，也不把部分轨迹/几何新段冒充完成或续算。双势比较保持同输入、相同参数与初速度，只比较各自能量变化；保留 M6.0–M6.4 历史证据，新增 M6.5 当前源码快照。

M6.6 修改运行 `npm run m66:contracts:check`、`npm run m6:validation:test`、`npm run m6:ui:validation`；实际目标平台构建默认核心/扩展/清单后运行 `npm run m6:offline:test`。打包 Skills 可以 `npm run skills:verify-bundle -- --resources <实际资源目录>` 单独检查。保留集必须明确总能量/力单位、理论与能量参考、训练集重叠审查、许可和来源 SHA；合成 fixture 只证明工程行为。不得将它写成独立 DFT 精度验收，不得拟合保留集偏置或自动开放生产。保留 M6.0–M6.5 历史证据，新增 M6.6 源码与验收摘要；Windows CI 配置不能代替实际执行和新安装记录。
