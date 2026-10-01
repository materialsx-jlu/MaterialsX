# MaterialsX 开发状态

更新时间：2026-10-01。当前阶段：M4 发布工程已启动，M5/M6 为后续开发计划。

## 开源准备（2026-10-01）

- 团队版权统一为 © 2026 吉林大学 AI-DAOS 团队；自有代码及自研 Skills 已确认授权，采用 AGPL-3.0-only，第三方保持原许可。
- 补齐根 README（隔离演示截图、安装/开发、限制、M5/M6）、LICENSE、NOTICE、CONTRIBUTING、SECURITY、占位 `.env.example` 和第三方清单。
- 第三方清单记录 674 个 npm 锁文件路径条目、82 项上游 Skill 声明及三个 Python 环境快照；这是依赖盘点，完整许可/原生组件与源码交付审核仍待发行前完成。
- `.gitignore` 覆盖环境文件、数据库/日志、研究输出、签名与权重；密钥扫描接入 CI，检查当前候选文件与暂存内容，不回显凭据。
- 计划公开仓库 `materialsx-jlu/MaterialsX`，本轮未初始化 Git、创建远端或推送。安全报告邮箱已确认为 `huzhangyou@jlu.edu.cn`；两份论文抽取示例公开权利与最终安装包通知/源码材料仍待补齐。
- 当前 TypeScript/Vue 类型检查、构建及 51 项 Node 测试通过；占位变量、文档链接、忽略规则和暂存区凭据检查通过。已有安装包未因源码改动自动更新。

## 已落地

### M4 当前增量

- 发布中心：桌面端集中展示科学质量、安全与隐私、安装交付和运维恢复门槛；阻断项不会因到达日期自动通过。
- 安装构建：固定 Electron Builder 26.15.3；219 MB 未签名 macOS arm64 DMG 已通过完整性和启动检查；172 MB Windows x64 NSIS 安装程序已完成交叉构建和 PE 架构检查，尚待 Windows 实机安装及代码签名。
- 诚实签名状态：当前机器没有有效 Developer ID，构建日志与发布中心均显示未签名阻断，不把开发包标作正式发行。
- 支持诊断：可从 UI 导出脱敏 JSON，仅含版本、计数、状态与 SQLite 完整性；实机检查未包含项目路径、模型端点、研究正文和凭据。
- Skills 扩充：固定 K-Dense 提交中的 82 项和 MaterialsX 的 2 项材料抽取 Skills 已通过内置资源验收并默认启用；两项新增 Skill 的 75 个有效文件通过哈希固定，依赖环境、31 个脚本测试、v2 示例、双语资料、Pi 发现和安装资源检查通过。macOS arm64 与 Windows x64 发布包均内置平台专用 Python 3.12、`jsonschema`、`PyMuPDF` 和 `Pillow`。
- 自动门槛：`m4:readiness` 生成机器可读报告，`m4:release-gate` 在存在阻断项时失败。
- 流式交互：Pi `text_delta` 经主进程 32ms 缓冲后推送 renderer，前端按动画帧合并更新；用户消息立即显示，长回答不再等待完整生成后一次出现。

### M3 当前增量

- Go 控制面：新增仅绑定 `127.0.0.1:8787` 的开发服务，提供健康检查、套餐、权益、账本、预留、结算和释放接口。
- 套餐模型：Community 免费本地模式、Pro/Research 测试价格及额度；所有付费文案明确标记“测试价格”，续期模式为手动。
- 额度账本：整数 credits、追加记录、事件幂等、并发预留、实际 usage 结算、剩余额度释放、usage 缺失待对账。
- 账期隔离：套餐切换创建新 period；历史 Pro 用量不会污染 Research 新账期额度。
- 桌面权益：新增“订阅与额度”页面，展示计划、状态、账期、剩余/已用/预留额度以及完整账本记录。
- 恢复能力：开发账本原子写入 JSON 状态文件并可重放；正式环境仍按计划迁移 PostgreSQL 事务和服务端认证。
- 实机链路：已验证 Pro 开发权益 2,000,000 credits，预留 10,000、实际结算 3,500 后余额 1,996,500；切换 Research 后独立显示 8,000,000。

### M2 当前增量

- 本地 RPSME 受管流程：分页抽取、精确证据定位、自动修复、断点缓存、真实文件与完整校验报告；修复双栏文字串行及跨行断字匹配问题。质量未通过时明确交付待复核草稿，详见 `docs/m4/local-rpsme-workflow.md`。

- LM Studio：已从 `http://localhost:1234/v1/models` 发现 `google/gemma-4-e4b`，并通过 Pi Agent 的 OpenAI Completions 适配层完成真实材料问答。
- 本地会话：每个 MaterialsX 会话映射到持久化 Pi session；支持连续对话、停止生成、失败状态和 SQLite 运行记录。
- 模型设置：桌面端可检测 loopback 模型目录，区分 Chat 与 Embedding 模型并选择对话模型；无 BYOK。
- 材料证据模型：新增 MaterialsDataset 1.0 schema，覆盖样品、组成基准、工艺步骤、测量单位/条件/不确定性、缺失原因、来源 SHA-256、页表定位和修订记录。
- schema 约束：已测试证据必填、百分比组成不超过 100、缺失原因显式记录等科学数据边界。

### M1 当前增量

- 桌面端：Electron 44 + Vue 3 + Pinia + Element Plus 已组成可运行的三栏研究工作台，包含项目、研究会话、Skills、数据与 MCP、运行记录和设置入口。
- 本地持久化：Electron 主进程使用 SQLite WAL 保存项目、会话、消息、运行记录和模型设置；自动化测试覆盖关闭数据库后重新打开并恢复全部核心状态。
- 安全边界：renderer 仅通过 preload 暴露窄类型 API；开启 `contextIsolation` 与 sandbox，关闭 Node 集成和任意新窗口。
- 项目接入：通过系统目录选择器登记本地研究项目；原始项目文件不被修改，数据库放在应用用户数据目录。
- 模型入口：保留平台订阅和 loopback 本地模型两种模式，没有 BYOK 或任意远程端点入口。当前消息明确标记等待模型，不生成伪造回答。
- 能力目录：桌面端展示并默认启用 84 个固定版本 Skills，包含 82 个 K-Dense Skills 与两项 MaterialsX 材料抽取 Skills，并实时展示 Pi、MCP、项目 Python、OCR、LAMMPS 和 QE 状态。

- 工程基线：Node 24、TypeScript 5.9、Electron 44、Python 3.12/uv，均固定依赖并提供统一验证命令。
- Pi：固定 `@earendil-works/pi-coding-agent@0.99.1`；可创建隔离会话、发现 84 个初始 Skills、注册并实际调用 stdio MCP 工具；本地会话已开放文件读取、搜索、脚本执行和结果写入工具供材料抽取 Skill 使用。
- Skills：从 `k-dense-ai/scientific-agent-skills` 固定提交 `65d6e786832e2c52832713117bbbf5096b56f77f` 同步 82 项、1128 个文件；文件哈希及 82 项许可证声明审计通过。
- 模型边界：平台模型不接受用户配置的端点，本地模型仅允许 loopback 地址；客户端设计中没有用户云模型密钥入口。
- 桌面安全基线：macOS arm64 上 Electron smoke 通过，`contextIsolation`、sandbox 开启且 renderer 的 Node 集成关闭。
- 文档与科学运行时：文本 PDF 由 pypdf/pdfplumber 双路径验证；扫描 PDF 由 PDFium/Tesseract 验证并保留页码、平均置信度和低置信词；ASE/EMT 测试通过。
- 求解器：macOS arm64 上项目私有 LAMMPS 环境已完成 108 原子 Lennard-Jones NVT 微型运行；项目私有 QE 7.4 osx-64 环境经 Rosetta 完成 Si SCF，6 次迭代收敛至 `-15.83546697 Ry`。输入、版本、日志和哈希留存在本机 `artifacts/m0/`。
- CI：已定义 macOS 与 Windows 的依赖、类型检查、测试、Skills 审计、Pi/MCP 和预检任务。

## M0 工作包状态

| 工作包 | 状态 | 已验证 | 尚需完成 |
| --- | --- | --- | --- |
| MX-001 场景与范围 | 已完成首版 | 10 个验收场景及证据规则 | 用获授权真实样本补充固定输入与误差阈值 |
| MX-002 Pi SDK/MCP | 进行中 | 会话、Skills、MCP 注册和调用 | 流式事件、取消、恢复和分支探针 |
| MX-003 Electron/Python | 进行中 | macOS arm64 本机链路 | Windows x64 CI 实跑与无管理员安装验证 |
| MX-004 文档/许可证 | 进行中 | 文本、扫描 OCR、页级证据、Skills 许可证元数据 | 表格与复杂版式；补足至少 5 类布局 |
| MX-005 科学求解器 | 进行中 | ASE、LAMMPS 与 QE Si SCF | Windows 支持路径与安装体积评估 |
| MX-006 权限/商业 ADR | 进行中 | 运行时、安全边界与科学运行时 ADR | IPC 威胁测试、支付主体和渠道决策记录 |

## M1 工作包状态

| 工作包 | 状态 | 已实现 | 下一步 |
| --- | --- | --- | --- |
| MX-101 仓库与构建基础 | 进行中 | 固定前端依赖、主进程/renderer 构建、类型检查与统一验证 | Windows 构建实跑与安装包 |
| MX-102 项目、SQLite 与迁移 | 进行中 | 项目登记、会话/消息/运行/设置表、WAL、重启恢复测试 | schema migration、备份恢复、受控文件导入 |
| MX-103 会话与 Pi 适配层 | 进行中 | Pi 持久化会话、真实增量流式事件、停止生成、安全 Markdown/KaTeX 排版、`@` Skill 选择器、UI 契约隔离 | steer/follow-up、分支 UI 和工具事件展示 |
| MX-104 模型配置 | 进行中 | LM Studio 真实调用、模型发现、loopback 限制 | 其他本地运行时兼容和平台协议接入 |
| MX-105 工具权限与执行 | 进行中 | secure preload IPC、系统目录选择器、无 renderer Node 权限 | 项目路径授权、子进程策略和威胁测试 |
| MX-106 运行日志和恢复 | 进行中 | SQLite 运行记录、流式 sequence 去重、等待模型状态 | 崩溃恢复、事件补读和子进程清理 |
| MX-107 首条纵向切片 | 未完成 | CSV 工作流入口和 UI 已预留 | 文件导入 → Pi → Python → 图表/报告 → 重启导出 |
| MX-108 最小平台网关 | 未开始 | 平台订阅配置边界已预留 | Alpha 认证、流式网关、限额与用量记录 |

## M2 工作包状态

| 工作包 | 状态 | 已实现 | 下一步 |
| --- | --- | --- | --- |
| MX-201 材料 schema 与证据模型 | 进行中 | MaterialsDataset 1.0、证据定位、缺失原因、修订和组成约束 | JSON/CSV 映射、迁移与审阅 UI |
| MX-202 文档解析与证据审阅 | 进行中 | M0 文本/OCR 页级能力可复用 | 表格布局、原值对照和人工修订 |
| MX-203 样品级数据提取 | 未开始 | schema 和 Skills 基线就绪 | PDF → 样品注册表 → JSON/CSV/XLSX |
| MX-204 实验与机械性能 | 未开始 | 单位/不确定性字段已定义 | CSV 分组、重复样、拟合和图表报告 |
| MX-205 初始 Skills 包 | 进行中 | 84 项固定目录全部验收和默认启用、双语介绍、118 条双语示例、可点击详情与一键填入 composer、安装包内置验证 | 启停、版本回滚和领域效果评测 |
| MX-206 MCP 与工具授权 | 进行中 | stdio MCP smoke、窄 IPC、loopback 模型边界 | 连接管理器、HTTP MCP 和授权 UI |
| MX-207–211 领域工作流 | 未开始 | 求解器与科学运行时探针可复用 | API、结构、DFT/MD、配方和 DOE 闭环 |
| MX-212–213 评测与 Alpha | 未开始 | 自动化基线已建立 | 30 Skills 评测和真实用户试用 |

## M3 工作包状态

| 工作包 | 状态 | 已实现 | 下一步 |
| --- | --- | --- | --- |
| MX-301 Go 控制面与账号 | 进行中 | 本地 Go HTTP 服务、稳定安装 ID、Community 权益 | 正式登录、设备刷新/撤销、服务端认证、PostgreSQL |
| MX-302 支付与订阅状态机 | 进行中 | 状态与手动账期模型、开发权益幂等授予 | 确定首发主体/支付渠道后接验签、退款、取消和对账 |
| MX-303 模型网关 | 未开始 | 桌面平台模式和额度边界已预留 | 签约模型路由、流式/取消、隐私日志和 usage |
| MX-304 额度账本 | 进行中 | 并发预留、结算、释放、超额阻断、缺失 usage 待对账 | PostgreSQL 事务、断流补偿和成本对账 worker |
| MX-305 桌面权益视图 | 进行中 | 套餐、余额、账期、手动续期说明和账本 | 登录、购买入口、取消续期和离线权益凭证 |
| MX-306 管理后台 | 未开始 | 账本 API 为后台查询提供基础 | 订单、异常、连接健康、Skills 发布和审计 UI |
| MX-307 付费 Beta | 未开始 | 测试价格仅用于开发验证 | 实际渠道开通后开展小范围实付验证 |

## M4 工作包状态

| 工作包 | 状态 | 已实现 | 下一步 |
| --- | --- | --- | --- |
| MX-401 科研技能扩充 | 进行中 | 84 项固定目录全部验收、默认启用并随安装包交付 | 增加自研技能与领域效果评测 |
| MX-402 三领域保留集 | 未开始 | 门槛与证据入口已建立 | 固定模型/环境，执行文献、计算材料和复合材料评测并专家签收 |
| MX-403 安装签名与更新 | 进行中 | macOS arm64 发行目录实机启动、DMG 验证、Windows x64 NSIS 交叉构建和 PE 架构检查 | Apple/Windows 正式签名、公证、Windows 实机安装、更新和数据库回退 |
| MX-404 故障、隐私与权限 | 进行中 | 脱敏诊断包、字段测试、SQLite 完整性检查 | prompt injection、磁盘满、断电、代理、越权和支付异常演练 |
| MX-405 性能与容量 | 未开始 | 发布中心预留运行时健康指标 | 固定硬件测启动、内存、取消、大文件和控制面并发 |
| MX-406 运维与支持文档 | 进行中 | M4 启动/打包/诊断/证据文档 | 完整备份恢复、更新撤回、对账与安装排错手册 |
| MX-407 灰度与 v1 | 阻断 | 发布门槛可机器检查 | 关闭所有发布阻断项并完成真实用户回归 |

## 本机验证

环境：macOS arm64 24.6.0，Node 24.7.0，Python 3.12.11。

```bash
npm run verify
npm run desktop:start
npm run lmstudio:probe
npm run control-plane:dev
npm run control-plane:test
npm run m0:electron
npm run m0:lammps
npm run m0:qe
```

截至本次记录，M4 发布中心和 macOS arm64 开发发行目录已完成端到端图形化检查。完整验证命令覆盖 TypeScript、Vue、SQLite、Go、Python、Skills、Pi/MCP 和 M4 就绪报告；Windows x64 NSIS 安装程序已完成 macOS 交叉构建，但尚未在 Windows 10/11 x64 上执行安装和运行验证，因此不据此声称 Windows 已验证。

## 余量重估

M4 的关键剩余工作是完成 84 项内置 Skill 的领域效果验证与三领域保留集、双平台签名安装、更新回退、故障演练、性能基线和灰度回归。M3 尚未完成的正式账号、平台模型网关、支付和生产账本仍阻断正式付费 v1；外部账号、签名证书、支付主体和领域专家复核时间单列。
