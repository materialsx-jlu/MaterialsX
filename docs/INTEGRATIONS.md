# MaterialsX：Skills、科学引擎与 API/MCP 接入目录

基线：2026-09-30。范围按用户确认覆盖文献/通用分析、计算材料、高分子/复合材料。

本文同时记录已内置 Skills 和待实现的科学引擎/API。82 项 K-Dense Skills 已通过固定内容、许可元数据、双语资料、Pi 发现和安装资源验收；科学计算库、第三方服务、密钥需求和领域结果仍按具体工作流单独验证。

## 1. 来源与分发规则

已确定的初始内置来源：[K-Dense Scientific Agent Skills](https://github.com/k-dense-ai/scientific-agent-skills)。首批审核通过的材料与通用科研技能随初始安装包提供，首次启动按项目方向启用；不要求用户另行克隆仓库。本轮读取的 main SHA 为 `65d6e786832e2c52832713117bbbf5096b56f77f`，实际产品应固定审核通过的快照，不能启动时自动拉取 main。

每个上游 skill 保留命名空间 `kdense/<name>`，自研使用 `materialsx/<name>`，防止同名覆盖。未经验证的第三方连接器标记“社区来源”，不能标记为官方。

上游说明可用于候选选择；产品自己的功能、可支持格式、默认权限和错误行为仍需要实现。引用资料中的示例脚本不自动成为生产级工具。

许可审查分四层：skill 文本、附带代码、运行库/二进制、数据库内容。记录许可证原文、来源、修改情况、署名/再分发要求和 reviewer；不满足分发要求的候选只提供用户自行安装入口，不能计入默认内置数量。

## 2. 初始 K-Dense 技能包：82 个已内置技能

固定快照中的 82 个 K-Dense Skills 已全部随应用内置并默认启用。以下 18 个为最初核心组，另外 64 个扩充项列在第 4 节。Skill 本身无需用户另行安装；需要可选深度学习框架、GPU、外部服务或领域计算引擎的高级任务，仍会在运行时明确检查相应能力。

上游技能中依赖外部 LLM 的步骤统一适配平台网关或本地模型，不增加用户云模型 Key 配置入口。数据库、文献检索和 MCP 的独立服务授权照常管理；尚未适配的功能明确标记不可用。

| ID | 上游 skill | 产品用途 | 环境与验收重点 |
| --- | --- | --- | --- |
| K01 | `pymatgen` | 晶体/组成/结构处理 | `structures`；CIF 回读、占位、单位与对称性容差 |
| K02 | `pymoo` | 多目标/约束优化 | `analysis`；约束可行性、随机种子、Pareto 基准 |
| K03 | `uncertainty-and-units` | 单位与误差传播 | `analysis`；量纲、温度差、误差类型 |
| K04 | `experimental-design` | 实验设计 | `analysis`；因子、区组、随机化与对照 |
| K05 | `exploratory-data-analysis` | 实验数据初查 | `analysis`；缺失、离群值、原始数据保护 |
| K06 | `statistical-analysis` | 显著性/效应量分析 | `analysis`；前提检查、多重比较 |
| K07 | `statistical-power` | 样本量与功效 | `analysis`；假设、效应量、研究设计 |
| K08 | `scikit-learn` | 材料性质回归与基线 | `analysis`；样品/批次拆分，防数据泄漏 |
| K09 | `statsmodels` | 回归与统计模型 | `analysis`；模型诊断和区间 |
| K10 | `matplotlib` | 可导出的科研图 | `analysis`；单位、字体、误差条、矢量输出 |
| K11 | `seaborn` | 统计可视化 | `analysis`；重复测量不能错误当独立样本 |
| K12 | `scientific-visualization` | 图表方法与质量检查 | `analysis`；对应底层图形工具通过验证 |
| K13 | `sympy` | 符号计算与公式校验 | `analysis`；推导/数值一致性 |
| K14 | `literature-review` | 检索与证据综述流程 | 文献连接器；查询记录与纳排规则 |
| K15 | `citation-management` | 引文核验与整理 | 文献连接器；DOI/题名对应，禁止虚构引用 |
| K16 | `scientific-critical-thinking` | 证据与结论检查 | 文本即可；区分观察、预测、因果假设 |
| K17 | `scientific-writing` | 有证据的研究报告 | 报告流水线；未得到的结果不能补写 |
| K18 | `markitdown` | 文档转结构化中间文本 | `documents`；正文与页级证据解析器配合 |

这些名称来自 [上游技能目录](https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills)。材料核心候选的详细限制以各自 [pymatgen](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/pymatgen/SKILL.md)、[pymoo](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/pymoo/SKILL.md)、[uncertainty-and-units](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/uncertainty-and-units/SKILL.md) 为准。

## 3. Alpha 自研目标：12 个材料技能

以下均为计划新建的产品技能，当前未实现。不因为本机可能存在同名/类似私人技能就自动复制入产品；复用私人代码需要先明确来源和授权。

| ID | 拟定 skill | 输入 → 输出 | 关键验证 |
| --- | --- | --- | --- |
| X01 | `materials-evidence-extraction` | 授权 PDF/补充材料 → 样品/性能表与证据 | 页码、表格、原文、缺失项；数值不凭空补齐 |
| X02 | `sample-process-linking` | 文献与实验文件 → 样品/批次/工艺关系 | 同名样品、对照组、重复测量、跨文档冲突 |
| X03 | `mechanical-test-analysis` | 标准化 CSV → 曲线、模量/强度及报告 | 工程/真实应力、应变单位、拟合区间、断裂异常 |
| X04 | `materials-observation-normalization` | 原始值/单位/条件 → 标准记录 | wt%/vol%/phr 区分、转换条件、缺失温度 |
| X05 | `polymer-composite-formulation` | 原料/组分/含量 → 可审阅配方表 | 总量约束、含量基准、基体牌号、密度缺失 |
| X06 | `process-structure-property` | 样品与加工/表征数据 → 关联证据表 | 工艺步骤和条件、可比性；不把相关性冒充因果 |
| X07 | `materials-doe` | 因子/范围/预算 → 下一轮实验表 | 混料与过程变量、区组、随机化、重复和对照 |
| X08 | `materials-pareto-selection` | 约束/目标/数据 → Pareto 候选与限制 | 可行解、成本单位、训练域、预测不确定性 |
| X09 | `structure-quality-control` | CIF/XYZ/POSCAR → 校验/转换/预览 | 周期性、占位、原子距离、信息损失 |
| X10 | `ase-local-simulation` | 支持结构与计算器 → 小规模计算产物 | 计算器适用元素、单位、能量/力和终止状态 |
| X11 | `dft-workflow` | 结构/QE 配置 → 输入、执行记录、结果 | 赝势、截断能/k 点、SCF 收敛、版本/哈希 |
| X12 | `md-workflow` | 结构/LAMMPS 模板 → 输入、轨迹、分析 | 力场适用域、单位制、系综、步长、种子与能量检查 |

可复用确定性组件放在 Python 工具库；skills 编排这些组件。相似领域方法不要复制出多套不一致的计算逻辑。

## 4. 已内置扩充项与 v1 目标

M4 已将下列 14 个上游 Skills 同步到固定提交目录，并完成内置资源验收和默认启用。它们与原 18 项及新增 50 项一起随安装包提供，当前 K-Dense 已验收数量为 82。

新增 50 项来自同一固定提交，完整名称和双语元数据见 `skills/kdense-additional-50.json` 与 `skills/kdense-additional-50-metadata.json`。它们经过许可证声明、固定内容、Pi 发现和安装资源检查；需要 Python 包、GPU、外部服务或科学结果的流程还须逐项验证。

上游候选：`rdkit`、`molecular-dynamics`、`deepchem`、`molfeat`、`shap`、`torch-geometric`、`pymc`、`networkx`、`polars`、`dask`、`scientific-schematics`、`peer-review`、`pyzotero`、`get-available-resources`。其深度学习/GPU/第三方服务依赖保持可选。

自研候选及首版边界：

1. `thermal-analysis`：标准化 DSC/TGA CSV 的基础曲线处理；不承诺所有仪器原始格式。
2. `xrd-pattern-review`：已导出衍射曲线的峰与参考比对；不自动保证相鉴定结论。
3. `spectroscopy-review`：标准化 FTIR/Raman 数据的预处理与证据辅助解释。
4. `microstructure-evidence`：显微图尺度/元数据与人工审核量化记录；自动分割另按验证范围开放。
5. `phase-diagram-analysis`：兼容参考能量下的相图与稳定性分析。
6. `materials-ml-validation`：按材料族/批次拆分、外推判断、基线与误差诊断。
7. `transport-property-analysis`：已标准化电/热输运数据的单位与条件分析。
8. `battery-cycle-analysis`：支持格式的循环数据、容量归一化与库仑效率。
9. `defect-structure-preparation`：受支持超胞/缺陷输入生成、参数与结构谱系。
10. `materials-report-audit`：报告数值、图表、引用和原始证据一致性检查。

## 5. 科学运行环境和引擎矩阵

| 环境/组件 | Alpha/v1 范围 | 分发策略 | 通过条件 |
| --- | --- | --- | --- |
| `analysis` | NumPy/Pandas/SciPy、统计、单位、绘图、pymoo | 托管 Python CPU 环境 | 两个目标 OS 环境锁与数值样例 |
| `documents` | 文本 PDF、表格、标准化文档 | 审查解析器许可后分包 | 证据定位保留；解析失败不静默丢页 |
| `structures` | pymatgen、ASE、mp-api 等 | 独立环境 | 结构输入/转换/数据查询合同测试 |
| `ocr` | 扫描件可选 | 延迟安装模型/依赖 | 下载大小、语言支持、失败恢复清楚 |
| ASE 计算器 | 受支持的小规模 CPU 示例 | 随审核后的计算环境 | 明确适用元素/模型，匹配已知基准 |
| Quantum ESPRESSO | v1 小体系 SCF、有限收敛扫描 | 可选审核计算包/容器或用户配置 | 实际运行小例；检查赝势与物理收敛 |
| LAMMPS | v1 一组公开可复现势函数和 MD 模板 | 可选审核计算包/容器或用户配置 | 输入、日志、轨迹解析和中断清理 |
| VASP/Gaussian 等 | 后续用户自有环境接入 | 不随默认安装包分发 | 用户具备授权，单独集成验收 |
| SSH/Slurm | v1.1+ 大任务提交/监测 | 明确授权连接 | job ID 幂等、取消、资源上限、日志拉取 |

[ASE 文档](https://docs.ase-lib.org/index.html)支持工具与计算器接口的可行性；[LAMMPS 运行文档](https://docs.lammps.org/Run_head.html)支持外部引擎方式。QE 的具体二进制获取、容器、赝势许可与跨平台支持在 M0 验证后写入 ADR，当前不声称已验证完整安装路径。

容器/虚拟环境的使用不豁免二进制和数据许可审查。托管环境与用户自有环境的版本不同，报告必须可区分。

## 6. 首批数据 API：5 个适配器

所有这五项均计划由 MaterialsX 自建适配器；“可包装为 MCP”是拟实现方案，不是宣称对方有官方 MCP。

| ID | 数据源 | 已核验入口 | 能力 | 凭据与限制 | Alpha 输出验收 |
| --- | --- | --- | --- | --- | --- |
| A01 | Materials Project | 官方 `mp-api` / HTTP API | 组成、结构及计算属性 | 用户 API Key；字段、限流与具体数据条款再验证 | 条件查询、分页、结构文件、方法/来源 |
| A02 | OPTIMADE | 标准查询接口与 provider 列表 | 多数据库结构检索 | provider 各自权限、字段与许可；不可假定同质 | 至少两家可用源合同测试、统一结构、原始字段保留 |
| A03 | PubChem | PUG REST | 化合物身份、描述符、结构 | 按官方限流；不适合无限批量抓取 | 名称/SMILES 查询、标识符冲突、来源 |
| A04 | Crossref | REST API | DOI 元数据与引用核验 | 元数据查询不等于获得全文权限 | DOI/题名核对、引用导出、失败状态 |
| A05 | OpenAlex | REST API | 文献发现与关联 | 当前 Key/配额/套餐在接入时验证 | 检索、分页、去重、来源与授权全文链接 |

参考：[Materials Project API](https://docs.materialsproject.org/downloading-data/using-the-api)、[获取 API Key](https://docs.materialsproject.org/downloading-data/using-the-api/getting-started)、[OPTIMADE](https://www.optimade.org/)、[OPTIMADE 资源与 providers](https://www.optimade.org/resources.html)、[PubChem PUG REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest-tutorial)、[Crossref REST](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)、[OpenAlex 官方帮助](https://help.openalex.org/)。

## 7. v1 后半程/后续数据扩展

| ID | 来源 | 已知接入形式 | 计划与注意事项 | 官方依据 |
| --- | --- | --- | --- | --- |
| A06 | NOMAD | API 与归档数据 | v1 候选：搜索/解析只读；上传另授权 | [NOMAD API](https://docs.nomad-lab.eu/1.4.3/howto/manage/program/api.html) |
| A07 | COD | CIF / 标准查询 / 数据下载 | 可先通过 OPTIMADE 接入；专用入口后续，遵守下载节流 | [获取 COD](https://wiki.crystallography.net/howtoobtaincod/) |
| A08 | AFLOW | REST/AFLUX | v1 候选：材料属性检索；核验当前字段/条款 | [AFLOW API](https://aflow.org/documentation/) |
| A09 | JARVIS | jarvis-tools / Figshare 数据集 | v1 候选：快照数据和派生属性；下载量需预算 | [JARVIS 数据集](https://jarvis-tools.readthedocs.io/en/master/databases.html) |
| A10 | Zotero | 本地/远程库接口候选 | 后续，先只读；用户库与论文附件权限分开 | 实施前核验官方 API 与本地版本 |
| A11 | Zenodo / Figshare 通用 | 官方 API 候选 | 后续查数据集与版本；大文件按限额下载 | 实施前核验字段/鉴权/许可 |
| A12 | 企业 ELN/LIMS | 客户已有 API/MCP | v1.2；每客户 schema 映射；读写独立权限 | 无统一通用实现承诺 |
| A13 | 商业材料库 | 以合同许可接口为准 | 不预装破解/爬取连接器，不预估能访问的字段 | 需用户提供已获授权服务 |

其他材料服务可接，但不在公开可用性、版权或账号权限尚未核实时给出“已经支持”的标识。

## 8. 自有 MCP 的建议分组

不要为每一个小函数建立一个常驻 server。建议先形成三个逻辑工具集合，内部根据依赖隔离少量进程：

- `materials-data`：MP、OPTIMADE、化学身份查询；工具如 `search_materials`、`get_structure`、`get_property_evidence`。
- `research-evidence`：文献元数据、DOI 核验、本地文档证据；工具如 `search_papers`、`resolve_doi`、`get_evidence_span`。
- `materials-compute`：结构分析、表格分析、计算准备与结果解析；有副作用的运行/提交工具单独授权。

第三方 MCP 通过独立配置接入；生产默认只启用审核目录里的条目。所有工具的 JSON Schema、版本、返回大小限制和错误码都纳入合同测试。

## 9. 单连接器的完成定义

1. 官方接口/SDK、来源与许可证有记录；说明是官方 API、社区 MCP 还是自建 MCP。
2. 密钥只保存在密钥存储，权限与发送域名可见。
3. 具有边界明确的输入 schema、输出 schema、来源/单位/方法字段。
4. 处理分页、限流、超时、连接断开、schema 变化和凭据过期。
5. 缓存遵循许可，按身份隔离；原始响应保留哈希或可再获取凭证。
6. 固定样例、错误样例和受控真实接口调用通过。
7. 上游故障可以独立禁用，不影响本地工作区。
8. 文档清楚区分已支持与尚未支持字段；界面能显示错误原因和配置入口。

## 10. 插件包格式提案

一个 `materialsx-plugin.json` 关联多个 skill、MCP 配置模板、工具 schema、环境锁与示例；支持从签名官方目录安装，以及用户显式导入本地包。

包内容包括：`manifest`、`skills/`、`tools/`、`schemas/`、`environments/`、`examples/`、`LICENSES/`、`checksums`、`signature`。安装脚本不是任意 shell 钩子：官方包只执行受限声明式依赖操作；高级自定义安装必须被识别为代码执行权限。

发布状态：`discovered → reviewing → verified → published → deprecated / revoked`。离线客户端使用已缓存可信版本；联网时更新撤销清单，并记录对旧项目可复现运行的影响。
