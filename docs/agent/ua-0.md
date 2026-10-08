# UA.0：实现盘点与接入基线

验收日期：2026-10-05；平台：macOS arm64。阶段状态见 [统一计划](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md)，技术决定见 [ADR-0001](adr-0001-agent-boundaries.md)。本阶段交付盘点、合同字段冻结、可运行探针及清理，没有把产品默认 Agent 切换为 Codex，也没有构建 UA.2 MOOS MCP 服务。

## 工程起点与清理

基准 HEAD：`070834fd153d9ad1b12fb1c0de598b98528dac82`。开始时工作区已有大量 M5/M6 与文档改动，保留这些修改，没有 reset/clean、提交或推送。盘点回执记录当时 814 个工作树条目（45 个跟踪修改、769 个未跟踪条目）；此数随新增 UA.0 文件变化，不是干净发行基线。

构建仍使用根 package.json：核心 tsc、桌面 esbuild/Vite、后台 Vite；没有新增 npm workspace、业务进程或第二套 Agent。Node v24.7.0；Pi 0.99.1；MCP SDK 1.31.0。

| 原文件 | 拆分前 | 当前职责 | 验收时行数 |
| --- | ---: | --- | ---: |
| `apps/desktop/main/index.ts` | 794 | Electron 组合与 IPC；目录、诊断、支持包提取到独立模块 | 595 |
| `apps/desktop/renderer/src/App.vue` | 891 | 工作台与会话；目录/运营页提取为组件，保留过滤状态与全局主题 | 568 |
| `packages/pi-adapter/src/local-session.ts` | 683 | 会话生命周期；文档工具与 guard 提取到 `local-session-tools.ts` | 279 |

删除：迁移后的旧 helper/模板/状态副本、未使用 imports，以及硬编码已不再使用的 Gemma 探针。`lmstudio:probe` 现在只使用当前已加载模型。移除 Materials MCP 未建立连接就显示 ready 的静态声明，页面改为“尚未连接科研数据服务”。有测试或历史会话调用的 RPSME guards 保留；不是按文件相似度猜测删除。

已加入 `npm run source:size`，扫描自有 TS/Vue/Go/Python/CSS/shell/SQL/C/C++ 等源码，包括未跟踪新文件，600 个物理行以上失败。排除第三方 vendor、依赖、生成产物、运行时、符号链接。`npm run check` 与 CI 都执行该门槛。行数是结构约束，不能通过超长行或排除目录规避；后续继续按职责拆分。

## 复用盘点

| 能力 | 现有实现与证据 | 后续使用 |
| --- | --- | --- |
| 会话与持久化 | PiLocalSessionService、PiPlatformSessionService、SessionManager、WorkspaceStore；现有会话与平台测试通过 | UA.1 适配同一引擎合同；UA.3 不再包第二个执行循环 |
| 文件/论文抽取 | local-session-tools、rpsme-workflow 的真实 PDF 预处理、逐页抽取、JSON/摘要/报告检查；现有测试通过 | UA.6 复用，不在 paper/MOOS 工具里重写 PDF/证据处理 |
| 科学执行 | science-bridge → AtomisticRuntime/selection/workflow/worker；MACE 固定晶胞真实弛豫回归通过 | 所有引擎使用同一科学资格与真实 job/artifact |
| 目录/下载 | potential-hub、catalog-weights、packages、catalog-updates/discovery/distribution | 复用安装/校验/审核，不将 catalog-only 当 ready |
| 流式展示 | text-stream-buffer + WorkspaceStore message events；相关测试通过 | UA.3 补 task/step/attempt/sequence 与完整分项耗时 |
| M5 平台 | control-plane gateway/identity/metering/payments、IdentityClient、Pi Responses | 复用授权、预算、真实请求 ID 与账本；Codex 兼容尚待 UA.1 |
| 页面与交互 | 93 Skills、100 研究模型、173 势与相关资源条目；真实 Electron 六页面回归通过 | 目录覆盖是元数据能力，不代表 173 项均已安装/验收 |
| MOOS 原始事实 | 已运行的原 API、projection、review/version、assetstore | UA.2 只读 MCP；原事实与入库/审核仍由 MOOS 拥有 |

唯一职责表、兼容层调用者与删除条件均在 ADR。UA.0 没有创建空 Agent/MCP/research 模块来充当功能完成。

## Codex、Pi 与 MCP 实测

系统 `/opt/homebrew/bin/codex` wrapper 因平台二进制缺失而 ENOENT。没有改全局安装；在忽略目录隔离安装公开 `@openai/codex@0.160.0`（Apache-2.0），CLI 与协议 Schema 固定版本。SDK 路线本次选择 app-server，未再引入第二个 SDK 会话包装。

| 探针 | 真实执行 | 模型来源/限制 |
| --- | --- | --- |
| Codex app-server | initialize → thread/start → 4 轮 Responses → 原生命令读取文件、apply_patch 修改文件、MCP materials_ping → completed | 离线脚本响应；不是模型自主推理验收 |
| Codex 恢复 | 停止进程并用相同隔离存储重启；thread/resume 恢复 1 个 completed turn；command/exec 再读改后文件 | 没有第二次运行原计算；首次 thread `01a10a12-2bb7-76e1-841d-e2f69d70971c`、turn `01a10a12-2bc8-70d3-8d8b-3b780ceccd8c`；重跑产生新 ID |
| MCP 双端 | Pi 与 Codex 分别发现并实际调用现有 M0 stdio fixture；readOnly capability 核对 | client/server SDK 都为 1.31.0；实际协商协议 2025-11-25；fixture 不是 MOOS 服务 |
| Pi 材料流程 | 实际 Pi SDK + 当前 Go validator + materials_science 自动规划/运行/查询 + 真实本机 MACE FIRE 计算 | Responses 由脚本提供，科学 worker 真实执行；供应商调用 0 |

公开运行时此版本默认发送 `additional_tools` 和 namespace/custom tool。M5 的既有 Responses 校验与计量不能假定直接兼容；UA.1 必须验证并迁移必要输入/事件，保持一套 M5 账本。此次没有 RootFlowAI 付费调用、登录账户导入或私有 Codex 实现复制。

固定 SHA-256：

- Codex arm64 可执行文件：`112fae7a5a1223e673c8a1791d32338f37df8b527ff1159bb8adac6c4dbf1b4b`。
- Codex ClientRequest Schema：`1c7fec8758deb95ffe967060130e8d1ddb7a0a5a437ee9b64086dddbed8f5831`。
- 根 package-lock：`076ab2f331f33269f8340f45df8e29ee65bcead874cdd92eeb2f1282fcd102a9`。

开发探针、运行时与日志在 `runtime/agent/ua-0/`，约 322 MB，Git 忽略、未加入应用打包资源。不同平台仍须另验原生运行时和安装包；本机通过不代替 Windows 验收。

## MOOS 数据与权限实测

只读现有 `http://127.0.0.1:8080`，没有启动/重建 MOOS，没有 SQL、写入、审核、导入或索引 job 请求。snapshot 6，读取前后 manifest 均为 `2d165608d7d45cb4d22b48f2ee9b329118b8d7637588fd8c7272fc5a59196385`；抽查记录携带 package/projection hash。

| 数据类别 | 当前 cohort 数量 | 实际读取 |
| --- | ---: | --- |
| 实验 | 1,558 | version-bound records，包括实验/来源/package ID |
| 配方 | 1,851 | projection.recipes 与 ingredients |
| 工艺 | 7,492 步 | projection.processes，另有 1,414 条 process_route |
| 模拟 | 886 条 run | simulations 列表与 simulation_metadata；执行开关 false |
| 图片 | 3,425 条 media | 元数据、资产 metadata 和获准的本机 preview |
| 性能 | 3,865 条 observation | 数值/单位/测试条件/证据投影 |

这是辐射制冷 cohort（`radiative-cooling-current-v1`），不是全部 MOOS 材料库。六类存在证明不等于每条记录完备或科学合格。

审核：全部 1,558 条实验为 pending_review。记录缺项包含 48,331 个无证据实体、1,183 个缺测试条件的观测、804 个缺原单位观测；不能据此自动做跨条件排序。索引会保留审核状态。

索引实测：`rpsme-experiment-sections-v1.1`，模型 namespace `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2@e8f8c211226b894fcb81acc59f3b34ba3efd5f42:mean128:l2:v1`；automatic_indexing=true，external_model_calls=0，production_authorization=false。phase-zero 的旧合同标记自动索引未实现，与运行中的 indexes/status 存在版本差异：adapter 应按能力端点和实际响应判定，不能只读取旧声明。

服务门槛由 MOOS 的 KNOWLEDGE_EXPLORER_ENABLED、KNOWLEDGE_LOCAL_PREVIEW、KNOWLEDGE_MULTIMODAL_ENABLED 控制。没有读取秘密配置；通过响应确认当前本机 preview/多模态可用。附带伪造代理头或外站 Origin 的请求均返回 403；不能把这一本机访问边界当生产租户认证。

抽样：实验 612 的 generation 2 可读，generation 1 返回 404，错误 generation 999999 被拒绝；只能确认此次历史样本不可用。UA.2 要保留缺失/过期错误，不能偷换为最新版本。资产 281 的本机 preview 可读，权限 private_research、redistributable=false；只记录字节数/hash，没有将图片写入仓库或外发。1,690 个审计资产均不允许再分发。

## 合同、案例与性能口径

输入/输出、ID、权限、源数据优先级、任务/科学状态与六部分计划字段冻结于 [contract-baseline.v1.json](../../fixtures/agent/contract-baseline.v1.json)。真正的 product schema 与执行校验在 UA.1 实现，监督/调整与研究交付分别由 UA.3、UA.4 消费。

[research-goals.v1.json](../../fixtures/agent/research-goals.v1.json) 保存 30 个案例，每例含中文/英文（共 60 个 prompt）、目标、约束、缺项/不得编造项、依赖、修复规则、真实产物及终态金标准。覆盖文献/专利/图片、原子结构、实验数据、目标权衡和失败恢复；它们就是 UA.14 首批 30 例，不再复制另一套评测。

目前通过的是案例结构与关键负例校验，专家复核和真实模型解释/分解评测尚待 UA.1。它们不构成科学精度的独立黄金数据集，也没有声称本地模型已通过 30 例。

本机 LM Studio 已加载 `openai/gpt-oss-20b`，MLX/MXFP4，模型与实际上下文均为 131,072；Pi runtime 探测也是 131,072，maxTokens=4096。仅向已加载模型发出两个合成短输出请求，没有切换模型或清缓存。

| 顺序样本 | 实际输入 tokens | 实际输出 tokens | 首个可见文本 | 总请求时间 |
| --- | ---: | ---: | ---: | ---: |
| 152 字符 | 113 | 16 | 2,203 ms | 2,203 ms |
| 8,082 字符 | 3,285 | 17 | 4,600 ms | 4,600 ms |

不能把两个顺序样本当冷/热启动统计或长期 p95；系统未保证独占资源。UA.3 按相同输入/model/context/工具集报告初始化、提示组装、prefill/首 token、工具耗时、正文首字、UI 首次显示、总时长与 usage，至少多次重复后再报告分位数。科学计算时间与模型推理时间分开，M5 以真实 usage/请求回执计量。

## 验证与复跑

已通过：`npm run check`（含 600 行门槛）、源码扫描器 2 个边界测试、30 双语案例结构校验、`npm test`（179 passed / 1 skipped）、`npm run build`（core/desktop/admin）、Go 全包测试、Python 12 个测试、Pi/MCP 协商与调用、真实 Pi/MACE 弛豫、Codex 原生工具/重启恢复、MOOS 只读/拒绝访问/源快照不变、Electron 六页面及详情/过滤状态回归。

保留限制：Vite 大包提示、ASE/NumPy 弃用提醒；隔离 UI 未登录账户，订阅的订单刷新返回“请重新登录平台账户”，仅验页面可切换，不计为支付/订阅业务验收。Node 跳过项是未配置独立测试 PostgreSQL 的真实身份服务集成测试，具体原因保留于 tests.log。秘密扫描检查 3,365 个文本快照，覆盖范围没有阻断项，65 个二进制/大文件仍需发行人工复核；不覆盖 Git 历史或任意凭据格式。版本/源哈希检查见本机回执。

```bash
# 常规离线回归，不启动服务、不调用计费模型
npm run ua0:verify
npm run ua0:ui

# 首次安装隔离的公开开发探针运行时；不修改全局 codex
npm install --prefix runtime/agent/ua-0/codex --no-audit --no-fund --save-exact @openai/codex@0.160.0
runtime/agent/ua-0/codex/node_modules/.bin/codex app-server generate-json-schema --out runtime/agent/ua-0/codex-schema
npm run ua0:codex

# 仅在已有 MOOS/LM Studio 本机服务运行时执行
npm run ua0:moos
npm run lmstudio:probe
npm run ua0:inventory
```

Pi 科学基准复用 `npm run m6:pi:automation:test`，此次执行前确认 MACE 权重已有缓存；冷机器执行该既有命令可能下载权重，需先检查许可、空间与下载范围。回执为 `runtime/m6/acceptance/m68-m69/pi-flow.json`。UA.0 探针仅用合成结构/请求和本机授权读取，不访问真实商户或发起付款。

下一步按 UA.1 实现共同合同和最小 Codex 引擎/M5 接入；UA.2 再提供只读 MOOS MCP。剩余未知与去重后的估算在 ADR 中，不将这些后续实现计入 UA.0。
