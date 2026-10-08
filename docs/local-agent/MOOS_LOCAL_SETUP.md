# MaterialsX 连接本机 MOOS

© 2026 吉林大学 AI-DAOS 团队

MOOS 后端提供材料数据；MOOS 的只读 MCP 服务负责协议适配；MaterialsX 自动启动、管理 MCP，并通过同一套 `research_data` 工具向 Pi 和 Codex App Server 提供数据。无需安装 Codex，也无需手动复制数据库或论文到 MaterialsX。

## 1. 启动 MOOS 后端

本机目录为 `/Users/user/Code/MOOS`。先检查已有服务，避免重复启动：

```bash
curl --fail http://127.0.0.1:8080/api/health
```

返回健康状态即可继续。只有后端未运行时，使用 MOOS 本身的配置启动：

```bash
cd /Users/user/Code/MOOS/go-backend
go run ./cmd/api
```

保持这个终端运行。MOOS 会读取自身的 `.env` 配置；数据库、资产目录等由 MOOS 管理。连接 MaterialsX 不需要重新迁移、清空、导入或重建索引。

## 2. 准备 MCP 服务（首次或服务更新时）

需要 Node.js 24 或更高版本。已存在且完成构建的服务无需重复安装：

```bash
cd /Users/user/Code/MOOS/services/materials-mcp
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

检查 `dist/src/server.js` 已生成。此 MCP 使用 stdio，不监听新端口，不提供网页；直接执行 `node dist/src/server.js` 后等待输入属于正常现象。连接 MaterialsX 时**不需要单独运行这条命令**，桌面程序会启动子进程，并传入后端地址。

## 3. MaterialsX 配置

打开 **数据与 MCP → MOOS MCP**：

| 设置 | 本机值 |
| --- | --- |
| 启用连接 | 开启 |
| 已构建的 MCP 目录 | `/Users/user/Code/MOOS/services/materials-mcp` |
| 本机后端地址 | `http://127.0.0.1:8080` |

点击“保存并测试连接”。“测试已保存的连接”检查已保存值，尚未保存的输入不会生效。设置保存在 MaterialsX 自己的用户目录中，重启后仍有效，不进入公开仓库或安装包。更新设置时应等待当前任务结束。

MCP 正常连接和数据源检查成功后，状态显示“连接正常”。MaterialsX 使用自己的 Electron/Node 运行 MCP；不依赖其他电脑安装 Codex。

## 4. 先确认数据可读，再让 Agent 分析

打开 **研究数据与交付 → 材料数据 → 项目输入与 MOOS**，输入 `水性`、`WCP`、`waterborne` 或 `aqueous`，点击搜索。按来源标签判断结果，选择相关实验后再读配方和证据。

默认仅搜索已审核记录。2026-10-06 本机检查发现，MOOS 历史覆盖快照中的 1,558 条实验均为 `pending_review`。`searchReady=false` 表示覆盖数量是历史快照，不代表实时全库统计；具体记录读取会检查当前版本。因此仅已审核检索可能得到被过滤的空页，不能据此认定数据库没有数据。

若本次任务允许候选数据，勾选 **包含待审核来源（仍需科研复核）**。查询为空但有后续页时继续翻页；关键词命中并不证明是水性涂料，要检查材料、实验类型和工艺。待复核数据仍保持原标签，不会自动变成已验证数据。

在对话中可以使用：

> 搜索 MOOS 中的水性辐射制冷涂料配方。允许本次读取待复核记录。选取一条 WCP 涂料记录，读取其组分、配比和制备步骤及原文证据，仅在对话汇总，保留原单位和缺失条件，不生成文件。

之后再要求结合这些来源讨论设计。对话需要明确本次允许范围，界面勾选不等于所有未来任务永久允许。简单检索复用引擎工具循环；复杂研究仍遵守保存的计划、权限和真实执行回执。

## 5. 已接入的能力与边界

| MOOS MCP 工具 | 用途 |
| --- | --- |
| `moos_status` | 健康、索引与历史覆盖状态 |
| `moos_search` | 实验、配方、工艺、性能和模拟记录检索 |
| `moos_get_experiment` | 固定版本实验分区读取 |
| `moos_get_evidence` | 原文证据和页码定位 |
| `moos_compare_observations` | 带原单位和条件的观测比较 |
| `moos_search_assets` | 关联图片与资产元数据 |
| `moos_read_asset` | 权利与版本检查后的图片资源读取 |
| `moos_get_simulation` | 文献已报告的模拟记录与缺项 |

桌面界面和 Agent 共用来源路由：先查已选择的项目输入，再查 MOOS。Agent 使用搜索结果中的短引用选择记录，系统恢复其固定版本，不要求模型重新拼写校验值；短引用只对本次任务有效，重启后需重新搜索。选择记录后保存带版本、SHA-256、审核状态、证据和调用回执的项目快照；后续读取检查来源是否变更。模型不得把搜索摘要当作完整配方，也不能用文字声明替代真实读取。单纯的 MOOS 配方获取使用真实读取回执生成来源表格，直接展示原始用量、单位、工艺和证据定位，避免模型改写配比。设计、比较或分析任务仍走原有研究计划与验收流程；这张来源表不代表配方已完成科学验证。

本地数据连接只读，不允许导入、审核、SQL、索引重建或模拟提交。文献模拟记录不是 MaterialsX 已执行模拟。当前来源许可不授权云端传输或公开再分发；本次验收使用本地模型，不将 MOOS 数据发送到外部模型。

## 6. 排查

- **MOOS MCP is not configured**：检查保存的目录、启用状态和 `dist/src/server.js`，然后测试连接。
- **服务不可用**：检查 MOOS 的 8080 健康接口和自身数据库/资产配置。不要通过重置 MaterialsX 或数据库来修复连接。
- **空结果 / filtered_page**：检查审核范围、关键词和后续页；不要自动放宽权限。
- **UNREVIEWED_SOURCE_REQUIRES_USER_OPT_IN**：在本次任务明确允许读取待复核记录，或只查询已审核来源。
- **stale_version / 来源已更新**：重新搜索并显式选择新版本，不能用旧引用偷偷替换成当前记录。
- **无效工具参数 / 未完成计划**：查看运行记录中的真实调用与修复信息；先通过界面检索验证连接，避免把模型问题误判为 MCP 未配置。

## English quick start

Start the existing MOOS API on `127.0.0.1:8080`. Build `MOOS/services/materials-mcp`, then save that directory in MaterialsX → Data & MCP. MaterialsX launches the stdio server automatically. Test the saved connection and search in Research data → Materials data. Reviewed-only searches exclude pending records; opt in explicitly for each task when using unreviewed recipe candidates. Preserve evidence, units, conditions and review labels. Local access does not authorize cloud export or redistribution.


## 6. 已选项目记录与多个配方

对话中的 `research_data search` 对已选项目记录和 MOOS 新结果统一返回短 `candidateId`。使用返回的句柄选择后，再用返回的 `snapshotId` 读取；两者不可互换，也不需要用户查询或填写内部标识。

默认先查已选项目数据。如果数量不足，Agent 可用 `source=moos` 查询完整 MOOS 目录，并保留同一审核范围。`read_recipes` 接受 AI 从搜索结果选出的 `candidateIds`（最多 5 个），批量选择并读取原始组分、制备步骤和关联证据。单条记录也可用 `read` 的 `section=recipe`，减少来回调用。选择元数据或重复读同一实验不会计入新配方；本地引擎提前结束时，原任务至多继续修正两次，仍受原权限与时间限制。

例如：

> 搜索 MOOS 中的水性辐射制冷涂料配方，允许本次读取待复核记录，列出组分、原始用量、制备步骤及证据页码。并最终形成 3个实验配方。

系统检查是否实际读取了要求数量的不同来源。输出为来源支持的文献实验候选；缺项和待复核状态保持可见，不把缺失配比补成已验证配方，不宣称已经执行实验。如果没有足够的真实来源，本轮不能被判定为完成。


工程回归可显式运行 `node --import tsx scripts/agent/moos-recipe-live.ts`：需要本机 MOOS 和 LM Studio 已启动，使用 Codex + gpt-oss-20b，先在隔离工作区选入两个真实来源，再执行上面的原始请求。仅本地模型调用及 MOOS 只读检索；不修改用户工作区、MOOS 原始记录或调用付费接口。私有回执保存在被忽略的 `runtime/agent/moos-setup/` 中，不作为科研正确性认证。

2026-10-06 回归结果：隔离工作区预选两个真实来源后，Codex App Server 0.160.0 + LM Studio gpt-oss-20b 使用原始“三个实验配方”请求，147 秒完成三条 WCP 记录的读取与来源展示。WCP-10 有四条组分，WCP-4 / WCP-6 只有一条组分；后两条明确标为不完整候选，不能直接配制。该结果验证接口与回执闭环，不代表三条记录已获科学或复现实验认证。

补充复测（同日）：使用 16,384 Token 输出上限，加入“水性 / 涂料 / 辐射制冷”中英文元数据筛选及真实来源完成边界后，同请求约 57 秒通过，4 次模型请求、2 次材料数据工具调用。纯来源检索的真实回执齐全后停止追加模型请求，由程序重新核实来源并展示原值，避免重复读取导致上下文超限。膜类、非水性材料不能凑入这类涂料任务的配方数量；元数据匹配仍不代表科研验证。

## 7. 基于已读配方生成建议

在同一会话完成来源读取后，可继续提问：

> 基于上述配方，生成你建议的配方工艺。

这类不要求计算、文件或实验设计的追问使用原有引擎工具循环，直接进入来源读取与建议阶段。同一项目、同一对话的上一项已完成任务中，实际读取过的配方快照会进入本轮冻结输入；不使用搜索元数据、模型口头声明或其他会话的数据代替来源。撤回、失效及访问权限检查继续生效。沿用这些已授权来源，不代表允许检索新的待复核记录。

Agent 使用 `research_data {"action":"read_current_recipes"}` 一次读取最多五个冻结来源，然后使用 `recipe_proposal` 提交建议改动、工艺选项、待确认条件和验证项目。只有一个完整基线时可省略基线 ID；否则需要从当前来源明确选择。组分编号和原单位必须匹配来源，不能直接使用缺少组分用量的候选作为基线，也不能在此工具中悄悄换算单位或添加未记录的组分。此工具目前只支持基线已有组分的用量建议；新增组分需要另行制定完整方案。涉及数值目标、批量设计、模拟或文件交付的请求仍使用完整计划和对应方法。

“来源原值”由程序从不可变快照读取，另列“建议用量（待验证）”；模型不能重写原文用量。建议成功记录后，程序检查真实回执并展示方案，无须模型再次抄写数据。工艺与验证项目使用明确的选项 ID，由程序呈现中文说明并附原文工艺参考；不接收这两个数组中的自由文字用量、设备或电场参数。模型的调整解释保存在回执中，界面用客观的用量变化说明替代，避免将错误理由当作方案依据。中文提问使用中文工艺和验证说明。方案仍是未执行、未验证的小试候选，参数或工艺理由可能有误，需要独立复核；接口检查通过不等于科研方案已获认证。

本地模型参数校验失败时，纠错信息包括该工具本次实际声明的字段与 Schema，不会自动忽略 `value` 等未知字段、执行被拒绝的调用或放宽原权限与时限。纠错继续使用同一执行会话和已有回执，来源已读时会提示进入建议阶段，避免重复检索。

工程回归：`node --import tsx scripts/agent/moos-recipe-followup-live.ts`。此命令只在本机测试时运行：需要已有失败追问、MOOS 与 LM Studio。它通过只读 SQLite 备份及私有临时目录，复制会话历史后重跑原句；所有写入限定于临时副本，调用本地模型与 MOOS 只读接口。回执保存到被忽略的 `runtime/agent/moos-setup/`，测试结束清理副本。

辐射制冷涂料的提示参考原始论文：[水性涂料静电分散研究](https://www.sciencedirect.com/science/article/abs/pii/S0360132324013039)、[TiO₂ 涂层光学与 PVC 表征](https://pubs.acs.org/doi/10.1021/acsomega.4c07223)。它们用于区分颜料体积浓度、太阳光反射与红外发射等基本概念，不替代 MOOS 配方证据，也不为建议配方提供性能保证。

2026-10-06 最终界面验收：在原用户会话及原模型设置下，更新后的 Mac 程序用 Codex App Server + 本地 gpt-oss-20b 执行上述追问，约 118 秒完成。四次模型请求中，两次无效响应由同一会话的有限纠错恢复；实际执行一次冻结配方读取、一次建议记录。三个来源均已读取，建议表的原值/单位与冻结快照一致，工艺和验证选项通过校验，未将未声明用水量或外部电场夹入工艺。此结果验证该流程的接口、来源衔接与展示边界，不证明建议性能或其他复杂研究任务的科学正确性。
