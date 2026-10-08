# UA.6：论文服务与受管环境

最新本地修复与回归见 [UA.1–UA.7 统一闭环记录](ua-closure.md)。以下保留本阶段当时的验收结果。

日期：2026-10-05。状态：内部预览工程已实现；真实联网、文件链和共享工具回执验收通过。gpt-oss-20b 的完整自动工具链未通过本轮稳定性测试，Windows 执行资格未验收。科学结论仍须复核。

## 使用入口

在“研究数据与交付”中选择“论文库”。页面和 Skills 使用同一全局主题，支持中文/英文、窄屏/宽屏、关键词与 UTC 首次提交日期、分页检索、固定版本详情、单篇 PDF 下载、指定页阅读，以及 JSON / BibTeX / CSV / Markdown 导出。检索前明确只发送公开研究关键词；下载确认仅供本机研究，不授予再分发权。

在“数据与 MCP”检查或修复论文解析环境。修复只恢复锁定的内置依赖到应用私有目录，不安装系统软件或临时从 PyPI 选择新版本。源安装包损坏时停止并提示重新安装。UI 修复需先停止任务；Agent 的受管修复只允许本任务使用，不能与其他任务或 PDF 读取并发。

聊天示例：

> 查找最近一年机器学习势相关的 arXiv 论文，先检查项目和 MOOS，再补充公开来源。选择一篇相关论文，下载固定版本，读取前 5 页，导出文献 JSON 和 BibTeX；标明未读部分。

> @materials-literature-rpsme-json 提取 /绝对路径/论文.pdf，输出带证据的 RPSME JSON、中文摘要和校验报告。结果保留待复核状态。

示例只描述工具可支持的工作；实际自动完成取决于模型是否返回有效调用。错误参数、未知回执和预算超限不会被补造成成功。

## 同一套后端

| 部件 | 实现 |
| --- | --- |
| 五工具 | `paper_search`、`paper_get`、`paper_fetch`、`paper_read`、`paper_export`；ResearchService 注册，Pi SDK 和 Codex HostMcp 共用 |
| 来源 | 项目已选数据 → MOOS → arXiv；用户明确查新论文可直接 arXiv。相同查询被本地拒绝后不能改走外网绕过；拒绝回执保留在原研究 SQLite |
| 身份 | 固定 arXiv 版本、原文标题/摘要/作者、原始查询、执行查询、日期/筛选、来源时间与元数据 SHA；DOI 已知时补 Crossref，不猜 DOI、不自动合并论文或证明同行评审 |
| 调度 | 全桌面进程共用 arXiv 单连接/至少 3 秒队列，包括既有 M6 新势发现。合并同服务相同在途请求；取消订阅者不误取消其他使用者 |
| 网络 | 独立 Chromium 研究会话；读取系统代理及 HTTPS_PROXY / https_proxy / ALL_PROXY / all_proxy，无账户 Cookie，不改变 LM Studio 或账户网络。仅固定公开来源、HTTPS，无跳转、凭据或任意 URL |
| 缓存 | 原 WorkspaceStore 的 app_meta，不新增数据库。查询默认 24 小时，离线缓存明确标 stale，手动刷新仍排队；200 MiB 元数据、1 GiB 下载回执总额、单 PDF ≤50 MiB |
| 文件 | PDF 校验 MIME、头、大小、固定版本与 SHA；项目 materials-output 下写入，不覆盖不同内容，不跟随输出符号链接。实际页面读取使用原 RPSME 预处理脚本和 artifact-io |
| 阅读 | metadata_only → downloaded → partially_read → fully_read，依据真实回执推进。每次 ≤20 页、≤80,000 字符；累计页哈希/时间、缺文字页和覆盖率。全文文字已读不代表图片审阅或证据抽取完成 |
| RPSME | 新增 materials_rpsme_extract，严格限定原用户任务明确给出的 PDF。复用已有 runRpsmeWorkflow、引用核验、JSON/摘要/报告与 Python 校验；冻结本地模型、协议和原任务预算。领域 JSON 提取不另建 Agent 工具执行循环 |
| 环境 | macOS arm64 / Windows x64 内置 Python 文件和精确依赖锁。逐文件/别名/版本校验 → 隔离复制 → 再校验 → 原子切换。失败不切换指针，旧环境可验证；1 GiB 修复副本预算 |
| 文档 | official_document 读取固定 arXiv API/政策、Crossref API、Python venv 文档的限量摘录与 SHA；不是全网搜索。内容只作为证据，不改变授权 |
| 空间管理 | 论文查询缓存、受保护论文身份/阅读回执、PDF 下载回执大小和受管 Python 副本接入现 M6.12 清理预览/预算。只允许清查询缓存，保留项目文件和复现回执 |

内置工作台和 RPSME Skills 已更新，继续复用 RPSME/XYZ，不新增重复抽取 Skill。移除了“Codex 不能读取 RPSME Skill”的旧阻断，监督任务不再绕过工具/请求预算进入旧 Pi 专用流程；无监督旧调用保留兼容。公共研究工具发现和权限清单归同一模块，移除两处分散名单。修正内置 Python 指向本机 uv 的绝对别名，删除受管分发中的派生字节码；不清理其他项目或系统缓存。

## 已执行验收

- TypeScript / Vue / Admin 检查、全量构建、单文件 ≤600 行检查通过。构建仍有原 3Dmol eval / 大包警告。
- 全量测试共 278 项：277 项通过、1 项既有跳过、0 项失败。单元与协议测试覆盖日期/中文查询、XML 实体拒绝、固定版本、项目权限、MOOS 优先及拒绝、并发队列/取消、缓存降级、大小/符号链接、实际导出、页覆盖、回退和环境版本。
- 真实 MCP 客户端调用共享四步论文链，使用合成网络来源和真实团队生成 PDF；生成真实页文本、BibTeX 和 TaskSupervisor 回执。输入 schema 的默认字段保持可省略，网络权限单独核对。
- 原 Pi SDK / Codex App Server 执行与权限回归；12 项团队 Skills 的资源和脚本验收。
- 真实联网：公开 arXiv 查询返回 1,272 条上游匹配（不是审核相关论文数量），选取 2610.02454v1，下载 20,686,462 字节 PDF，SHA256 `a7b602c94bc48d57ef1df4667e9cce7ceef8cbaccc9b26d99dbce73b326d76b5`，真实读 5/12 页、导出 BibTeX。PDF 仅在临时本机研究目录处理，测试结束删除，不进入仓库或发行包。
- 补充联网：独立 Crossref DOI 元数据和 arXiv 政策摘录通过。2302.14231v1 没提供 DOI，保留 null，没有把独立 Crossref 记录擅自绑定给它。
- 真实 macOS 内置 Python 修复副本通过文件锁、导入和版本核对；Windows 锁由实际分发文件/包 METADATA 生成，未代替 Windows 上的执行验收。
- Electron 界面真实 IPC / PDF 脚本 / 文件导出、中英文、820/1600 宽度、详情阅读与同一空间管理通过；详情抽屉背景和正文颜色使用全局主题，已查看实际截图核对。
- 真实 gpt-oss-20b：Pi 曾完成检索和下载，后续生成如 `{"paperId":"arxiv:260...","??"}` 的无效调用；Codex 出现模型端工具解析失败。本轮完整自动链未合格，程序停止，未填造参数、切换模型或宣称读完论文。SDK/MCP 的可执行性与模型智能资格分别记录。

原始回执在被 gitignore 排除的 runtime/agent/ua-6。真实模型测试日志包含合成测试输入，不能作为科研证据。没有发起新的付费供应商请求。

## 复验命令

```bash
npm run ua6:verify       # 离线单元、类型、引擎回归、Skills、真实 Electron 文件链
npm run ua6:live         # 实际联网；下载选定一篇 PDF，临时目录结束删除
npm run ua6:supplements  # 实际 DOI 元数据与官方政策文档
npm run ua6:agents       # 真实已加载 gpt-oss-20b；失败保持失败，非离线验收必过项
npm run ua6:runtime-lock -- macos-arm64
npm run ua6:runtime-lock -- windows-x64
```

生成运行时锁仅供构建维护者对当前分发文件审核后使用，不能由 Agent 接受任意源目录或下载地址。测试 PDF 为团队生成的合成文字，不是实验数据。

## 保留边界

arXiv 是预印本来源，不覆盖全部材料期刊或全网。中文查询使用材料术语表；未覆盖的中文需补英文关键词，没有偷偷使用收费模型翻译。未知全文许可保持 unknown，只允许本机研究，不提供公开全文库。跨版本 PDF、视觉证据、引用冲突/撤回传播与领域科研质量继续归 UA.7/UA.12。远程 MOOS 和云端论文全文导出继续按 UA.13 授权；本轮领域提取仅使用冻结的本地模型。任意依赖、CUDA/系统工具或外部求解器不由本环境修复器安装。

工程实现不等于主模型、跨平台、专家科学审查或公开发行资格；本轮没有改发行版本、打包发布或提交 Git。
