# RPSME Ontology 1.3 概念模型与冻结决策

> 当前契约：`rpsme-ontology-1.3` 与 `rpsme-bundle-1.0`，2026-09-09。继续接受 1.0–1.2 历史包；新生成的论文包使用 1.3。

## 产品边界

“基于 Ontology 论的高通量材料工艺数据库”把专利、论文和学位论文中报告的材料实验转换为可追溯的配方—工艺—状态—试样—测试—性能关系，供检索、审核和后续模拟/实验委托使用。历史包名仍保留 `rpsme-patent-package-v2` 以兼容既有上传端；`source_type` 决定实际来源类型。

本契约只定义交换事实及其语义约束，不负责上传身份、审批、数据库自增 ID、价格、订单或支付。

## 版本命名

| 名称 | 冻结值 | 变更条件 |
| --- | --- | --- |
| 包版本 | `rpsme-patent-package-v2` | 顶层交换结构发生不兼容变化 |
| 本体版本 | `rpsme-ontology-1.3` | 类、关系或核心语义改变 |
| 实验契约 | `rpsme-experiment-contract-v2` | 抽取/校验规则发生不兼容变化 |
| 提示词版本 | `rpsme-literature-v3-assets-simulation-runs-preparation-inheritance` | 仪器、科研资产、模拟复现与制备继承抽取流程改变 |

旧 `rpsme-patent-package-v1` 不被覆盖；它只能经确定性适配器进入内部 v2。外部包不得携带上传人、上传时间、审核人、内部价格或订单。

## 领域实体

- 来源：`SourceDocument`、`DocumentSet`、`SourceFileDocument`、`DocumentElement`。一项研究可由一个正文 PDF 与多个 SI/附录 PDF 共同构成；每条证据必须用 `document_id + pdf_page` 消除“正文第 3 页/SI 第 3 页”歧义。
- 实验：`ExperimentRecord` 表示来源报告的实施例/对比例；`ExperimentRun` 保留给未来真实执行，不能与专利报告混用。
- 材料：`MaterialEntity`、`MaterialAlias`。身份层级依次为 `material_class → chemical/substance → commercial_product → purchased_batch`。
- 配方：`Recipe` 与 `IngredientUsage`。材料身份和“一次具体用料”分离，同一材料可在多个步骤以不同用量出现。
- 工艺：`ProcessRoute`、`ProcessStep`、`MaterialState`。步骤的规范顺序与原文编号同时保存。
- 试样与观测：`Specimen`、`Test`、`PropertyObservation`。性能观测通过 `observation_role` 区分单值、平行试样、统计汇总和确定性派生值；汇总值保留样本量、不确定度和所聚合的原始观测 ID。
- 表征证据：`InstrumentMention` 保存原文，`CharacterizationInstrument` 保存实验内型号候选，`CharacterizationEvent` 保存一次采集，`CharacterizationMeasurement`、`MediaArtifact`、`AssetReference` 和 `StructureObservation` 保存结果与资产链。
- 解释：`MechanismHypothesis` 是作者机制命题；`SimulationStudy → SimulationRun → SimulationParameter/AssetReference/SimulationResult` 保存可复现计算链。它们都不是实验真值。
- 比较：`Comparison`、`ExperimentChange` 保存基准、改变项与可比性。
- 可信度：`Assertion`、`Evidence`、`QualityAssessment`。审核和实体版本由后续数据库阶段持久化。

## 值状态

| 状态 | 含义 |
| --- | --- |
| `reported` | 来源直接报告，必须有同一来源上下文的证据 |
| `inherited` | 来源明确说明沿用另一实验/公共步骤 |
| `calculated` | 由报告值确定性计算，须保留输入和公式 |
| `digitized` | 从图像/曲线数字化得到 |
| `predicted` | 模拟或模型预测；不得显示为实验测量 |
| `inferred` | 规则或 AI 推断；须记录方法和依赖断言 |
| `pending` | 无法可靠确定，等待来源或抽取审核 |

`NR`（未报告）、`PENDING`（待定）、`NA`（不适用）、数值零和 `not_used=true` 的“明确未使用”互不等价。

## ID 规则

- 来源：论文/学位论文使用 `SRC-<SOURCE-KEY>`；专利历史包可沿用 `SRC-PATENT-<PUBLICATION>`。
- 实验：论文使用 `LIT-<SOURCE-KEY>-<STABLE-SAMPLE-KEY>`；不要套用专利实施例编号。
- 配方/路线/步骤：`REC-<EXPERIMENT>`、`ROUTE-<EXPERIMENT>`、`STEP-<EXPERIMENT>-<ORDER>`。
- 用料/试样/测试/观测：分别以 `USG-`、`SP-`、`TEST-`、`OBS-` 开头。
- 表征仪器/事件/媒体/结构观察：分别以 `INST-`、`CHAR-`、`MEDIA-`、`STRUCT-` 开头。
- 证据、断言、边：分别以 `EV/EVD-`、`AST-`、`EDGE-` 开头。
- 所有包内 ID 全局唯一；不得使用接收数据库的自增主键。
- 适配器 ID 只依赖来源业务键、规范顺序和确定性哈希，同一输入重复执行结果一致。

## 关系词表

| 关系 | 中文 | 允许方向 |
| --- | --- | --- |
| `REPORTS` | 来源报告实验 | 来源文档 → 实验记录 |
| `HAS_RECIPE` / `HAS_USAGE` / `USES_MATERIAL` | 具有配方 / 具有用料 / 使用材料 | 实验 → 配方 → 用料 → 材料 |
| `HAS_ROUTE` / `HAS_STEP` | 具有路线 / 具有步骤 | 实验 → 路线 → 步骤 |
| `CONSUMES` / `PRODUCES` | 消耗 / 产生状态 | 步骤 → 材料状态 |
| `INTRODUCED_AT` | 在此步加入 | 用料 → 工艺步骤 |
| `FEEDS` | 工艺输入 | ProcessFeed → 工艺步骤 |
| `SOURCE_OF` | 形成试样 | 材料状态 → 试样 |
| `HAS_SPECIMEN` | 具有试样 | 实验 → 试样 |
| `TESTED_BY` / `YIELDS` | 被测试 / 得到观测 | 试样或状态 → 测试 → 性能观测 |
| `HAS_CHARACTERIZATION` / `USES_INSTRUMENT` / `RESOLVES_TO` | 具有表征 / 使用仪器 / 型号候选 | 实验 → 表征事件 → mention；mention → 实验内仪器候选 |
| `CHARACTERIZES` | 表征对象 | 表征事件或兼容旧结构观测 → 材料、状态或试样 |
| `GENERATES` / `YIELDS_STRUCTURE` / `DERIVED_FROM` | 生成媒体 / 得到结构观察 / 源自媒体 | 表征事件或模拟研究 → 图像；表征事件 → 结构观察；结构观察 → 图像 |
| `YIELDS_MEASUREMENT` | 得到表征测量 | 表征事件 → 表征定量测量 |
| `HAS_RUN` / `HAS_PARAMETER` | 具有运行 / 具有参数 | 模拟研究 → 运行 → 参数 |
| `HAS_ASSET` / `INPUT_OF` / `OUTPUT_OF` | 具有资产 / 输入 / 输出 | 媒体或运行 → 资产引用；资产引用 → 运行 |
| `REPRODUCES` | 复现来源运行 | 模拟运行 → 模拟运行 |
| `YIELDS_SIMULATION_RESULT` | 得到模拟结果 | 模拟研究或运行 → 模拟结果；1.3 必须有运行级关系 |
| `HAS_MECHANISM` / `HAS_SIMULATION` | 具有机制命题 / 模拟研究 | 实验 → 解释对象 |
| `MODELS` | 模型针对 | 模拟 → 材料、状态、试样或观测 |
| `SUPPORTS` / `REFUTES` | 支持 / 反驳机制 | 结构、模拟研究、模拟结果或性能观测 → 机制命题 |
| `HAS_COMPARISON` / `COMPARES_TO` / `HAS_CHANGE` | 具有比较 / 对比基准 / 具有变化 | 实验 → 比较 → 基准实验/变化项 |
| `ALIASES` / `POSSIBLE_MATCH` | 材料别名 / 可能同物 | 别名 → 材料；材料 → 材料 |

允许端点的机器真相位于 `scripts/rpsme_ontology_v2/vocabulary.py`，JSON Schema 限定关系名，语义校验器限定关系端点。

## 强制约束

1. 每个性能观测必须关联测试；每个测试必须关联试样或明确的材料状态。
2. 每个用量属于 `IngredientUsage`，原始值、原始单位和 basis 永久保留。
3. 同一路线步骤顺序从 1 连续且唯一；输入/输出构成的步骤图不得循环。
4. `reported` 断言和性能必须有同一实验、同一来源的证据。
5. `inferred` 断言必须记录推断方法和依赖断言；推断边必须显式标记。
6. 相对性能必须同时指向基准实验和基准观测。
7. 归一化单位必须与原单位量纲兼容。
8. 表征事件必须有方法、实验归属与被表征对象；结构观察必须能追溯到表征事件或兼容旧表征关系。
9. `capability_reference` 只能保存方法类别的典型能力；实际设备型号、采集参数和 `reported_spatial_resolution` 必须来自当前实验原文证据。
10. 模拟研究和模拟结果的真值状态固定为 `predicted`；模拟标量不得进入实验 `PropertyObservation`，机制不得伪装成测量结果。
11. 包中不得出现 `[object Object]`、未解码 HTML 实体或接收系统拥有的审计字段。
12. 1.3 包必须携带 `document_set`、`bundle` 与 `asset_manifest`；媒体必须且只能由一个表征事件、模拟研究或模拟运行产生。
13. `json_only` 不得声明 `availability_status=bundled`；Bundle 文件必须具有安全相对路径、SHA-256、字节数、MIME 和权利信息。
14. PDF 提取图不是仪器原始文件；模型不能宣称 R3–R5，输入脚本在抽取与验证阶段永不执行。

## 多文档、科研资产与模拟复现 1.3

`DocumentSet` 将正文、补充材料、附录和数据说明绑定到同一来源。接收端在 `rpsme_source_documents` 中按包保存文件哈希与角色，并继续以来源 DOI/业务键做跨包去重。正文与 SI 关系必须通过题名、DOI 或出版物编号核验；不能仅凭文件名猜测。

`SimulationStudy` 保存科学问题与建模对象，`SimulationRun` 保存一次具体运行，`SimulationParameter` 保存可检索参数。吸附能、结合能、扩散系数或聚集状态成为独立 `SimulationResult`。结构、输入脚本、力场、网格、轨迹与日志通过 `AssetReference` 连接运行。详见 `simulation-reproducibility.md`。

`MediaArtifact` 表达 Figure/Panel 的语义，`AssetReference` 表达物理文件引用，顶层 `asset_manifest` 表达哈希、大小、来源和权利。相同哈希复用资产身份；JSON 不嵌入 Base64。详见 `characterization-assets.md`。

## 物料流 1.1

`ProcessFeed` 保存非配方的工艺投入（辅材、增强体、基底、气氛等），通过 `USES_MATERIAL` 指向材料身份，通过 `FEEDS` 指向步骤。设备仍属于步骤参数。原料加入使用 `INTRODUCED_AT`，不能通过相邻顺序猜测。同物料分次投料应分成不同用料，未报告的分配量留空，不能重复累计配方总量。

确实无法从来源确定加入步骤时，必须在 `experiment_record.profile.material_flow` 中同时保存未绑定实体ID与具体原因；试样无法确定来源状态时使用 `specimen_provenance_gaps`。未声明原因的断链属于装配错误，不能由导入器静默接受。

每个产出中间态只能有一个生产步骤；重复名称不代表同一状态，“未固化”不能与“固化”合并。`state_origin` 取 `source_reported`（原文名称）、`normalized_transition`（基于已报告过程的系统命名）、`inferred` 或 `unknown`。命名来源与事实值状态分别保存。支路只有来源明确支持的共同操作才能汇合；多试样必须逐个绑定实际产出状态。

前端按显式关系绘图，CONSUMES 在阅读方向呈现为状态→步骤。工艺辅材不参与组成溯源；性能溯源说明制备来源，不构成因果证明。缺失投料绑定单列，不因缺数据而伪造完整流程。PostgreSQL `rpsme_process_feeds` 保存规范输入，边表保存投料关系，JSONB 保留扩展参数。

## 表征能力目录与实验事实（参考）

| 方法 | 中文 | 典型能力参考 | 常见数据类型 |
| --- | --- | --- | --- |
| `SEM` | 扫描电子显微镜 | 约 1 nm 横向分辨率 | 表面形貌、断口、联用 EDS/EDX 的元素分布 |
| `TEM` | 透射电子显微镜 | 高端模式可低于 0.1 nm | 透射图、HRTEM 晶格条纹、电子衍射 |
| `AFM` | 原子力显微镜 | 约 0.1 nm 通常指垂直分辨率 | 定量高度图、表面形貌、力/黏附图 |
| `OM` | 光学/金相显微镜 | 约 200 nm 衍射极限量级 | 晶粒、显微组织、彩色或偏光图 |

这张表只用于术语解释和能力检索。专利没有报告实际分辨率、加速电压、扫描模式、比例尺或仪器型号时，对应实验字段保持空值。

## 读写边界

1.3 包仍是未审核交换格式。Skill 只生成 JSON/Bundle，不上传、不审批、不执行模拟。接收端负责去重、对象存储、权限、审核和数据库事务；外部包不得携带上传身份、价格、订单或接收端存储键。
