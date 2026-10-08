# UA.2：MOOS 只读 MCP

最新本地修复与回归见 [UA.1–UA.7 统一闭环记录](ua-closure.md)。以下保留本阶段当时的验收结果。

日期：2026-10-05；本机验收 macOS arm64、Node.js 24.7.0。阶段状态由 [统一计划](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md) 维护。

已交付 MOOS 自有服务、八工具、资源读取和真实数据验收。MaterialsX 复用原 `MaterialsMcpClient`，没有增加第二客户端、Agent 循环或材料数据库。聊天的数据源优先级、项目证据快照、双引擎研究入口和研究卡片归 UA.4，远程身份与团队权限归 UA.13。本轮没有更新公开安装包。

## 实现归属

| 位置 | 职责 |
| --- | --- |
| MOOS `services/materials-mcp/src/contracts.ts` | 严格输入、引用、原单位过滤、中英工具说明 |
| MOOS `src/http.ts` | loopback、固定路由、限时限字节、只读 HTTP 回执 |
| MOOS `src/adapter.ts` / `projection.ts` | 既有 API 薄适配、源身份/版本/审核、分页与缺项 |
| MOOS `src/assets.ts` / `resources.ts` | 签发资源、按需读图、权利重查、内容哈希和短期句柄 |
| MOOS `src/server.ts` / `errors.ts` | 固定 SDK 的 stdio 生命周期、中英结构化错误 |
| MaterialsX `packages/agent/src/mcp-client.ts` | 原 MCP 客户端新增 resources/read，共用取消与关闭逻辑 |
| MaterialsX `scripts/agent/ua2-moos.ts` | 显式运行的真实 API/MCP 对照，输出脱敏本机报告 |

本机服务源码位于 `/Users/user/Code/MOOS/services/materials-mcp`，这是独立 MOOS 项目目录，不会复制进 MaterialsX 安装包。没有修改 MOOS 原后端、数据库、论文、抽取包、审核或索引；新包有独立 package-lock、许可、依赖清单及配置模板。未来部署用调用者提供的路径和地址，不硬编码个人目录。

### 工具与引用

| 工具 | 返回内容 |
| --- | --- |
| `moos_status` | 健康、索引版本、历史覆盖和当前权限边界；不触发模型或重建 |
| `moos_search` | 实验、配方、工艺、性能、图片、模拟候选；原单位/条件过滤 |
| `moos_get_experiment` | 固定来源版本的配方、工艺、观测及证据等分页详情 |
| `moos_get_evidence` | 本实验版本的证据原文与页/图/表定位 |
| `moos_compare_observations` | 2–8 条观测的条件/单位与可比性；沿用 MOOS 原规则 |
| `moos_search_assets` | 全局或指定实验的图片元数据与当前进程句柄 |
| `moos_read_asset` | 已签发资产的资源链接；不把图片字节塞入工具正文 |
| `moos_get_simulation` | 已报告的模拟方法、参数、结果及缺项；不执行模拟 |

引用绑定 `connectionId/sourceId/packageImportId/experimentId/generation/packageSha256/projectionSha256/reviewScope/reviewStatus`。后续读取重查当前权限、审核与该 generation，旧版本不存在就失败，不替换为最新。服务未知合同拒绝，不靠字段名字猜测适配。

默认 `reviewScope=verified`；待审核记录需调用者明确传 `include-unreviewed`。审核通过与独立科学复核分别标注，当前 `scientificValidation=unknown`。本机读权限不等于对云模型外发或公开再分发权限，所有回执 `cloudExportAuthorized=false`。

原 MOOS 搜索摘要主动省略配方/工艺/证据/图片/模拟详情。请求相应 `entityKinds` 才补读当前页的固定版本详情；未加载字段返回 null/未加载状态，不能被解释为无数据。原 GET 详情的 null 集合单独记录在 `sourceNullSections`。文字不补造缺失单位、条件、权利或输入文件。

分页绑定查询、过滤与索引源版本。审核和类别后过滤可能产生空页，`filtered_page` 与 `no_match` 分开；需检查 nextCursor。totalCandidates 是原始候选数，不冒充筛选后的总命中数。六类检索复用原精确查询，条件单位和可比性由 MOOS 负责，不另写转换或统计规则。

### 资源、取消和只读边界

SDK 固定 1.31.0、实际协商 MCP 2025-11-25；MOOS 投影 rpsme-experiment-sections-v1.1。服务只接无凭据 loopback origin，保留既有 Host/同源门槛，不伪造授权头。

图片只接受已签发 `moos://...` 句柄；读前和读后重查版本、审核、权利、关联与内容绑定。派生 JPEG 的实际 SHA 与原图 SHA 分开。unknown 权利/缺内容仅有元数据；私有原图 API 拒绝时不改读文件、不伪造研究角色。报告中不保存图片像素，合法本机预览不代表可以公开发布。

每 HTTP 请求 10 秒，服务工具/资源最多 60 秒；MaterialsX 原 MCP 客户端仍有 30 秒上限，建议分页 limit=10。取消传到 MCP 和 HTTP，关闭客户端取消在途请求并收回进程。没有自动重试或源数据修改。

仅允许固定只读 GET 和 search/compare 两个只读 POST，且 search 固定 precise。不开放任意 SQL/文件/URL、入库、审核、任务提交、模拟执行、AI-search、深度探索、混合检索或 embedding。输入额外权限/路径/模式字段被拒绝。

JSON/原图最多 8 MiB，JPEG 预览最多 2 MiB；详情超过 64 KiB 返回资源链接，不静默裁掉证据。进程内句柄 10 分钟有效、最多 256 个和 8 MiB；不是持久镜像。成功回执含原始 HTTP 响应 SHA、状态、路由、字节和时间；错误脱敏且有中英文说明。

清理了重复的资产详情 GET、无调用者的 HTTP 回执缓存，以及客户端两份相同的取消管理；未删除仍有调用者的旧工具或历史会话逻辑。MaterialsX 自有源码与新增 MOOS 包代码均执行 ≤600 行检查。

## 本机运行

先用 MOOS 自己的方式运行已配置后端；MaterialsX 不负责启动数据库、开启功能开关或执行迁移。然后：

```bash
cd /path/to/MOOS/services/materials-mcp
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

服务独立启动：

```bash
MOOS_API_ORIGIN=http://127.0.0.1:8080 MOOS_CONNECTION_ID=moos-local node dist/src/server.js
```

这是等待 JSON-RPC 的 stdio 进程，不是 HTTP 页面。直接终端启动时没有普通欢迎输出；客户端发送协议后才返回结果。stdout 仅协议，SIGINT/SIGTERM 或客户端关闭可退出，不会关闭 MOOS 后端。中英示例、八工具参数和标准连接配置见该包 README。

从 MaterialsX 做真实只读验收：

```bash
cd /path/to/MaterialsX
MATERIALSX_MOOS_ORIGIN=http://127.0.0.1:8080 \
MATERIALSX_MOOS_MCP_DIRECTORY=/absolute/path/to/MOOS/services/materials-mcp \
npm run ua2:moos
```

开发验收默认寻找同级 `../MOOS/services/materials-mcp`，并用本机已有 `WO2025161063A1` 查询选择含配方/工艺/性能的两条记录；其他部署可设 `MATERIALSX_MOOS_FIXTURE_QUERY` 选择自己的已入库候选。没有足够真实记录或可读图片就失败，不能用占位文件算通过。脚本只读现有数据，不调用模型、收费服务或下载资源。

每次生成 `runtime/agent/ua-2/moos-<时间>.json` 和最新 `moos.json`，目录被 gitignore 排除。只保存必要引用、哈希、状态和计时，不保存证据正文、图片或 Key；失败也留有报告。进程和短期资源在结束后关闭。实际私有来源的引用报告也不应公开发布。

## 验收证据

本轮真实验收通过三条路径，并将字段与原 HTTP 响应逐项核对：

| 路径 | 实测结果 |
| --- | --- |
| 配方/工艺与性能 | 两条 generation=2 的专利实验，各 1 配方、5 工艺步骤、1 观测；配方、成分、工艺、观测、证据原文与定位一致 |
| 条件比较 | MOOS 原规则 conservative-observation-test-v1.1 返回 not_comparable；适配器保持结果，不强行平均或推断因果 |
| 配方与图片 | 真实实验含 1 配方、7 工艺步骤；实际读取 22,099 字节 JPEG 预览，内容 SHA 与原 API 一致；再分发许可为 false |
| 模拟研究 | 实际读到已报告模拟；缺 boundary_conditions、material_models、run_protocol、software、software_version；executionPerformed=false |
| 双语查询 | 辐射 / radiative 各返回 10 个候选，与相同查询的原 API IDs 一致；不计为模型理解验收 |
| 版本与来源保护 | generation=999999 拒绝；检索源版本、4 条选定记录原响应 SHA、历史 snapshot/manifest 和外部模型调用计数前后核对 |

真实数据使用显式 include-unreviewed，保留 pending_review；默认 verified 页仍单独检查。现有 snapshot 的 searchReady=false、覆盖来自 2026-10-02 历史报告；服务不掩盖状态，也没有为验收重建索引。不能把历史覆盖数字当成当前数量。

前后核对覆盖选定记录、索引源版本与 snapshot/manifest，**不是整库事务审计**。真正的只读限制由接口白名单、无数据库/文件访问和测试保证；如果其他 MOOS 进程在验收中更新来源，脚本会失败并要求重新选定版本。

| 自动检查 | 结果 |
| --- | --- |
| MOOS check / test | 类型与大小检查通过；45/45 合同/故障测试通过，含真实 stdio + HTTP 的协议与取消测试 |
| MaterialsX check / test | 核心、桌面、后台类型检查通过；216 项测试中 215 通过，1 项既有跳过 |
| 原生 Codex 回归 | 固定真实 App Server 二进制 + 协议 fixture；工具、项目隔离、MCP、续接、补充、取消通过，不计为真实模型理解 |
| 桌面构建 | 构建通过；保留既有大 chunk 提示，本轮没有增加 renderer 页面 |
| 文件大小 | MaterialsX 自有源码最大 586 行；新 MOOS 包最大 251 行 |

故障覆盖至少 30 项，包括跨连接/跨来源证据、源版本/哈希变化、摘要字段未加载、null 与缺失合同、条件/单位缺失、游标篡改、权利未知、缓存后撤回、读中撤回、伪造 URL/文件路径、无权限、内容哈希不符、服务失联、未知协议/投影、超限、取消及不可复算模拟。合成图片只测试字节与哈希合同；真实图片另有上述独立读取核对。

## 后续边界

UA.3 实现可靠执行、预算、依赖和恢复。UA.4 才把本服务作为共同材料数据源接入聊天，保存有权输入快照并展示真实表/图/证据卡；不在 renderer 硬编码查询。UA.13 提供远程身份与项目授权前，服务保持同机 stdio。

原 MOOS API 仍有有限集合读取后筛选/分页的实现；适配器只补读返回页、不建立镜像库，但没有改造上游数据库索引和大规模检索性能。当前验收不证明科学精度、任意研究需求理解、自动多步研究或所有图片的外发权利。
