# MaterialsX M6：机器学习势、智能选势与原子级 3D 工作台开发计划

版本：1.0  
制定日期：2026-10-01  
状态：开发规划，全部工作包尚未开始  
执行基线：本文件  
版权：© 2026 吉林大学 AI-DAOS 团队

## 1. 产品目标与首条闭环

让 MaterialsX 能读取真实原子结构，依据可核查的模型能力选择机器学习原子间势（MLIP），在本地完成计算，并交付可交互的 3D 结构、轨迹、分析报告和可复现记录。

首条交付闭环：

```text
导入 CIF / XYZ / POSCAR
  → 结构校验
  → 筛选可用势与 LLM 解释选择
  → 单点试算
  → 结构优化
  → 优化前后 3D 对比
  → 导出结构、计算数据与报告
```

在该闭环通过后，增加短程分子动力学、轨迹播放、模型对比，再扩展缺陷、扩散和声子任务。

### 1.1 已确认需求

- 收集多种通用机器学习势，提供统一的默认能力入口。
- 默认内置中英文介绍、分类和每项 1–2 个中英文使用例子；支持 `@` 选择和复制到输入框。
- LLM 可以依据材料、任务和模型证据自动选择势，并说明理由。
- 结果支持原子、分子、晶体及真实模拟轨迹的交互式 3D 展示。
- 与本地 Pi、Python、已有 Skills 和研究项目协同；保留本地模型和平台模型两种 LLM 模式。
- 本次只建立开发文档，不下载权重、不安装依赖、不改程序或启动计算。

### 1.2 首版范围与后续范围

| 交付层 | M6 首版 | 后续扩展 |
| --- | --- | --- |
| 模型资源 | 10–20 个具体 checkpoint 的候选登记与审核，至少 2 个通过双平台运行验收的核心势 | 更多家族、专用势、用户受控导入与微调 |
| 默认安装 | 全部目录与 Skills 内置；通过许可、体积和运行验收的核心 runtime/权重随完整安装包交付 | 审核过的扩展计算包按需安装 |
| 原子计算 | 单点能量/力、固定晶胞优化；经能力检查后的晶胞优化 | 声子、弹性、NEB、缺陷与高通量流程 |
| 分子动力学 | 小体系、有限步数 NVE/NVT，真实轨迹和基本诊断 | NPT、复杂界面、长时间扩散与 HPC |
| 3D | 静态结构、晶胞、原子信息、测量、前后对比、短轨迹、PNG 导出 | 密度等值面、振动模式、复杂轨迹与视频导出 |
| 自动选势 | 硬性检查 + 可追溯 LLM 选择 + 试算校验 | 经过任务评测的路由、主动学习与专家规则 |

候选数量是收集目标，不是已安装或已验证数量。核心势与实际版本在 M6.0 固定；如果某平台不能运行，不把它标记为跨平台就绪，也不以介绍文件代替安装能力。

本期不承诺自动预测全部材料性能，不将原子模型直接当作复合材料宏观有限元模型，不从材料名称凭空编造真实结构，不将动态示意动画称为分子动力学结果。

## 2. 当前代码基础与缺口

| 现有部分 | 当前事实 | M6 需要补齐 |
| --- | --- | --- |
| 材料模型目录 | 100 项模型/评测元数据，包含势函数分类 | checkpoint、执行适配器、安装状态、硬件与领域验证 |
| 科学运行时 | `python/` 已有 ASE/EMT 微型探针，LAMMPS/QE 另有验证基础 | 独立 MLIP 环境、模型加载、结构优化和 MD runner |
| Skills | 84 项内置，有双语介绍、分类、示例与 `@` 入口 | 新增原子模拟任务 Skills 与候选模型说明 |
| Pi | 本机可调用文件与脚本工具 | 受控的结构、选势、计算与产物工具合同 |
| 富文本输出 | Markdown、公式、表格、链接；产物可在文件夹定位 | 类型化产物卡片与 3D viewer |
| renderer | Electron/Vue，关闭原始 Markdown HTML并做清洗 | 专用安全 3D 组件，不通过任意 HTML 注入 |
| 数据库 | 本地 SQLite 项目、会话、消息与运行记录 | 模拟任务、模型版本、结构产物和阶段状态关联 |

特别说明：已有 `materials-xyz-extraction` 中的 X/Y/Z 指配方工艺、微观结构和力学性能本体，不能当作原子坐标 `.xyz` 文件解析器。新功能另设原子结构解析能力。

## 3. 模型、Skill 与运行时的组织方式

采用“模型注册表 + 任务 Skills + 统一计算适配器”。同一家族的不同权重独立登记，不为每个大小版本复制一套计算流程。

| 部分 | 内容 | 默认状态 |
| --- | --- | --- |
| 模型卡片 | 版本、元素、任务域、训练数据、理论层级、限制、许可与示例 | 内置可阅读 |
| 任务 Skill | 指导结构校验、选势、执行与结果检查 | 内置启用 |
| 核心势包 | 校验过的 checkpoint、依赖锁与适配器 | 完整安装包预装 |
| 扩展势包 | 大型/额外依赖模型及审核清单 | 可见但明确未安装，用户选择安装后验证 |

用户可在 Skills 中点击“原子模拟与机器学习势”分类，查看任务 Skills；在模型目录中按家族、领域、已安装状态筛选具体权重。详情之间提供跳转，不把“Skill 已启用”误显示成“权重可运行”。

已有“结构与模拟”分类继续保留，新增分类名称中英文固定为“原子模拟与机器学习势 / Atomistic Simulation & ML Potentials”，明确迁移/归类规则，避免重复显示同一 Skill。

## 4. 初始候选收集与准入

### 4.1 初始家族与候选版本

以下是收集起点，不构成逐项验收结论。开发时固定真实仓库 revision、包版本、权重 SHA-256、来源与许可证。

| 家族 | 初始候选 | 默认定位 | 来源 |
| --- | --- | --- | --- |
| MACE | MP-0b3 small/medium、MPA-0、OMAT-0、MATPES-PBE-0、MATPES-r2SCAN-0、OMOL-0、MH-1 等可获权重 | 覆盖材料与分子不同训练域；按 checkpoint 区分 | [MACE foundations](https://github.com/ACEsuit/mace-foundations) |
| CHGNet | 公开预训练版本，具体版本在 M6.0 固定 | 无机材料任务候选，不能因元素覆盖自动用于聚合物 | [CHGNet](https://chgnet.lbl.gov/) |
| MatterSim | v1.0.0-1M、v1.0.0-5M | 材料体系候选 | [MatterSim](https://github.com/microsoft/mattersim) |
| ORB | 当期官方发布中满足能量/力要求的保守型版本，revision 待锁定 | 原子模拟候选，检查力是否来自能量梯度 | [ORB](https://github.com/orbital-materials/orb-models) |
| SevenNet | 官方公开预训练版本，revision 待锁定 | 材料任务候选；LAMMPS 对接为增量 | [SevenNet](https://github.com/MDIL-SNU/SevenNet) |
| MatGL | M3GNet/TensorNet 势能 checkpoint，revision 待锁定 | 材料计算候选；不混入带隙等性质预测器 | [MatGL](https://github.com/materialyzeai/matgl) |
| UMA | 官方可取得且用途允许的具体权重 | 跨域候选，授权、task/head 和硬件分别审核 | [FAIRChem](https://fair-chem.github.io/index.html) |

优先核心候选：MACE-MP-0b3 small 与 CHGNet 的适用版本；首先验证材料晶体优化。它们不代表分子/聚合物核心势已具备，分子任务需另外通过相应权重验收。

NequIP、Allegro、DeePMD 等训练/执行框架可进入扩展适配计划，但只有绑定具体、公开、适用的权重后才登记为可运行势。没有预训练权重的框架不能充作一个通用势。

### 4.2 准入检查

每个 checkpoint 必须记录并验证：

1. 原作者/官方发布来源、revision、下载地址、尺寸与哈希。
2. 代码、权重、训练数据分别对应的许可证；是否允许商业产品再分发。
3. 所支持元素、训练域、PBC、理论层级、数据集/head、能量参考及已知限制。
4. 能量、力、应力等能力，单位、应力符号与 Voigt 排序。
5. 是否能量守恒，力是否由能量梯度得到；任务是否依赖此属性。
6. CPU/CUDA/MPS、macOS/Windows 可运行性、精度、内存与加载耗时。
7. 依赖隔离、有限基准与故障恢复。
8. 中文、英文简介、任务示例和引用。

仓库许可证不自动等于每份权重许可证。MACE 官方清单已有不同许可证和任务类型；仅预测偶极/极化率的条目不能充作能量/力势。相关区别按 [MACE 官方模型表](https://github.com/ACEsuit/mace-foundations)逐项核对。

### 4.3 状态与默认安装规则

模型状态：`catalogued → audited → packaged/installed → runtime_verified → task_validated`；另设 failed、unsupported、disabled。

- 全部通过元数据检查的目录、双语说明和任务 Skills 随程序内置。
- 核心势的运行时与权重预装，用户无需手工 pip 安装或首次联网取权重。
- 扩展模型的下载需要展示大小、来源、许可、所需空间和设备支持，安装后进行哈希与运行检测。
- 未获再分发权利的权重不放入安装包，目录明确说明获取条件。
- 不把多份权重常驻内存；首版默认同时加载一份，切换时释放或按预算缓存。
- 权重不可用时允许查看结构，不得虚构计算结果。

## 5. 模型注册表与选势规则

### 5.1 关键元数据

拟定 `PotentialManifest`，至少包括：

| 字段组 | 内容 |
| --- | --- |
| 身份 | id、family、checkpoint、revision、sha256、来源、citation |
| 环境 | adapter、锁定依赖、平台、设备、dtype、磁盘与内存估计 |
| 权限 | codeLicense、weightLicense、redistributionStatus |
| 能力 | energy、forces、stress、conservative、charge/spin 输入、domain/head |
| 适用性 | elements、periodicity、训练域、温压范围证据、已知缺口 |
| 能量基准 | functional、DFT 软件/设置摘要、referenceConvention、dataset/head |
| 质量 | 基准数据版本、任务验证结果、范围限制、验收日期 |
| 展示 | 双语简介、双语例子、目录/安装/运行状态 |

未知值明确 unknown，不以缺省 true 表示能力通过。声明能力与实测能力分开。

### 5.2 LLM 与执行规则的分工

```text
读取真实结构和用户目标
  → 硬性资格检查
  → 任务适用性证据与评分
  → LLM 提出选择和参数
  → 本地规则验证
  → 单点/短程试算
  → 运行正式任务并保存依据
```

硬性检查由程序执行：权重/许可、元素、PBC、必需输出、charge/spin/head、设备资源和任务上限。LLM 不得覆盖这些检查。

通过硬性检查后，根据相近体系评测、训练域、已知误差、任务规模和可用资源排序。LLM 从候选 ID 中选择，给出引用注册表证据的理由；不能创造模型 ID、适用范围或“已验证”声明。

选势输出需包含 selectedPotentialId、候选与排除理由、domain/head、参数、证据引用、限制和验证安排。结构缺少必需信息时先完成可独立进行的解析/预览，再请求缺失信息；不猜测电荷、自旋、压力或物理相态。

用户可固定已通过硬性检查的模型进行对比。无适用候选时拒绝自动正式计算，说明需要专用势、DFT 或补充验证。低风险探索可在明确“未完成领域验证”的标记下执行受限试算，但不解除硬性不兼容。

### 5.3 科学判断边界

- 不输出无校准的“可信度 95%”。使用可解释状态：范围支持、范围未知、验证通过、待复核。
- 两个模型一致只表示交叉结果一致，不等于真实准确；不得直接平均不兼容的能量。
- 比较能量需保持相同结构/原子数、理论层级、参考基准与 head，记录差异。
- 相图、形成能、缺陷能还需要兼容参考相或化学势；单点能量不直接等同这些量。
- GPU 可用不等于该后端数值可靠；CPU 为首版验证基线，CUDA/MPS 逐模型验证。
- 力学、热学与扩散结果来自相应模拟及统计流程，不是势模型直接输出全部性能。

## 6. 本地运行时与任务执行

### 6.1 运行环境

首版以 ASE calculator 接口统一能量/力/应力和优化/MD 调度。保持科学任务在本地 Python 子进程执行，不放入 renderer，也不由云端 Go 处理本地文件。

MLIP 环境独立于现有 PDF/RPSME Python runtime。为不兼容的家族分组锁依赖，避免全部模型共用一个不稳定环境。macOS arm64 与 Windows x64 分别构建和验证。

模型包存于应用资源的只读内置目录；后续安装缓存存于应用用户数据目录。模型版本、环境和结果相互关联，更新不覆盖旧任务依赖。普通安装无需用户预装 Python、Git、CUDA 或 Docker；GPU 功能另行探测。

MatterSim 官方当前提示 Apple Silicon 的 MPS 可能存在数值问题，建议 CPU；因此不能统一开启所有模型的 MPS 加速。[MatterSim 官方说明](https://github.com/microsoft/mattersim)

### 6.2 受控工具合同

先作为 Pi 本地工具提供，后续可封装 MCP，不为同一功能维护两套执行实现。

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `inspect_atomic_structure` | 已授权文件的 artifact/file ID | 结构摘要、问题、归一化结构 ID |
| `list_compatible_potentials` | 结构 ID、任务与资源要求 | 可运行候选、排除理由、模型证据 |
| `plan_atomistic_run` | 候选模型 ID、结构 ID、任务参数 | 校验过的执行计划与预算 |
| `run_atomistic_calculation` | 已验证 plan ID | job ID、进度事件、真实结果 |
| `get_atomistic_run` | job ID | 状态、日志摘要与产物 |
| `cancel_atomistic_run` | job ID | 取消状态与保留文件 |
| `compare_atomistic_results` | 结果 ID 列表 | 兼容性检查与比较报告 |

工具只接受枚举与 schema 校验参数，不接受 LLM 传任意 Python 或 shell 命令。模型 ID 必须来自本机注册表，路径必须位于用户已授权范围。

### 6.3 执行状态与资源预算

状态：queued、validating、loading_model、running、cancelling、completed、failed、cancelled、interrupted。科学质量状态单独为 unreviewed、passed、needs_review、invalid。

记录 CPU/GPU、线程、内存预算、原子数、总步数、wall time、输出大小、随机种子与检查点。首版默认单个重型任务运行，其他排队；资源不足提示，不静默启用远程计算。

任务持久化后启动进程；进度事件限频，不按每原子或每 Token 更新 UI。取消先请求正常停止，超时后清理子进程树并记录实际终止状态。

重启后 interrupted 不自动变成 completed。优化可从最后真实结构重新启动；MD 只有保存了速度、积分器/恒温器状态和随机数状态等必要数据才能完整续算，否则标为新的轨迹段。

## 7. 结构输入与计算规范

### 7.1 格式与归一化

首版支持 CIF、XYZ/extxyz、POSCAR；分子扩展 SDF/MOL、PDB。解析后建立统一结构 schema：元素/原子编号、坐标、cell、PBC、单位、可选键、电荷、自旋、occupancy、来源哈希与变换记录。

- 坐标归一化为 Å，能量 eV，力 eV/Å；应力 eV/Å³ 并明确正负和分量顺序。
- 无晶胞的 XYZ 不自动认定周期晶体；CIF 部分占据/无序结构需要显式处理后才能计算。
- 检查有限值、原子数、元素、晶胞体积、重叠、重复原子和异常近距离。
- 原文件只读；分数坐标转换、扩胞、去重等写入新结构并记录谱系。
- 分子键、XYZ 距离推断键和晶体邻接显示分别标记；显示推断不改变实际计算结构。
- 3D 展示不复制未知电荷等属性，任何颜色属性都指向真实数据字段。

### 7.2 单点与结构优化

先运行单点试算，校验能量/力有限、输出形状正确、单位与模型加载状态；不得把有限值检查当作物理准确性验证。

优化默认固定 cell。晶胞优化要求应力能力并使用明确的外压/应变约束；用户请求时才启用。优化器、最大步数、force tolerance 和收敛标准完整记录。ASE 提供相应优化接口，具体选择在 M6.1 锁定。[ASE 优化文档](https://docs.ase-lib.org/ase/optimize.html)

收敛状态以实际停止条件判断；达到最大步数但未达标准应交付未收敛结果。最大力取每个原子力向量模长的最大值。局部优化只说明找到该起点附近的局部极小，不保证全局稳定结构。

### 7.3 短程分子动力学

- 首版 NVE 与 NVT 分开；记录温度、初速度、时间步、恒温器、步数、采样间隔和 seed。
- 与轻原子/高频振动匹配时间步，默认值通过具体体系探针确定，不能所有体系套一个值。
- 检查能量、温度、最小距离、NaN/Inf、速度爆炸和模型失效；异常中止并保留轨迹。
- NVE 能量漂移与 NVT 恒温表现按各自物理条件检查，不能用恒温后的稳定温度证明势守恒。
- 短程示例只证明模拟流程和局部稳定性，不据此发布可靠扩散系数、相变温度或长期热稳定性结论。
- 扩散分析须满足足够采样、周期展开、平衡区间、拟合区间与不确定性要求后再扩展。

## 8. 3D 查看器与结果呈现

### 8.1 技术选择

首版采用本地打包的 3Dmol.js，开发时固定经过验证的版本；结构由本机解析/归一化后加载。该库有结构显示与 viewer API，具体格式能力以其文档和应用测试为准。[3Dmol 格式说明](https://www.3dmol.org/doc/global.html)、[GLViewer API](https://www.3dmol.org/doc/GLViewer.html)

复杂分子轨迹与密度数据后续评估 NGL；首版不同时引入两个查看器。[NGL 文档](https://nglviewer.org/ngl/api/index.html)

3D 组件以可信 Vue 组件承载，继续保留 Markdown 禁用原始 HTML 和 DOMPurify。LLM 只引用 artifact ID 与受限显示配置，不能输出脚本控制浏览器。

### 8.2 首版功能

| 功能 | 内容 |
| --- | --- |
| 基础操作 | 鼠标旋转、平移、缩放、重置、适应视图 |
| 结构样式 | 球棍、球、棒；分子键与晶体邻接推断可开关 |
| 周期结构 | cell 边框、原胞/超胞显示；复制仅用于展示，改变计算结构需新任务 |
| 原子信息 | 点选原子，查看 ID、元素、坐标和已有属性 |
| 测量 | 原子距离、角度；周期距离明确最小镜像或显示副本 |
| 属性着色 | 元素、位移、力模长；其他属性仅在数据存在时显示 |
| 对比 | 优化前后并排、可选同步视角；先检查原子映射一致 |
| 轨迹 | 播放、暂停、帧/时间拖动、倍率、采样状态和真实帧时间 |
| 导出 | PNG、原始/优化结构、轨迹文件；视频在后续阶段 |
| 主题 | Materials 深色与 Codex 浅色，坐标/标签对比度适配 |

坐标对齐只改变显示，不修改计算产物。播放插值如启用需标明“显示插值”，不把插值帧当实际模拟数据。

### 8.3 聊天卡片与独立面板

聊天展示类型化“原子计算结果”卡片：任务、模型/版本、结构摘要、执行状态、质量状态、能量变化、收敛条件、预览与产物按钮。点击打开独立结构面板，展示详细参数、选择理由、日志与 3D 交互。

长轨迹不塞进消息正文；LLM 只获得小规模摘要和必要分析。3D 场景不随流式文字反复创建；保留输入、滚动和打字响应。

WebGL 不可用或 context lost 时显示清楚的降级状态，保留表格、结构下载和报告；不能把空白视图标成成功。

### 8.4 性能与本地读取

- 延迟挂载；可见的活动 viewer 数量限制，离屏卡片显示预览图并释放 GPU 资源。
- 轨迹按需分帧读取/缓存；解析使用 Worker 或独立进程，限制文件和数组大小。
- 展示采样与完整计算数据分开；不得丢弃轨迹后声称完整结果。
- 对大体系自动提供球/点等简化样式及明确显示上限，保留完整导出。
- renderer 通过窄 IPC 读取结构/帧；主进程校验 artifact 所属项目、realpath、格式与大小，拒绝路径穿越和 symlink 越界。
- 不加载模型输出的远程 URL、JavaScript、HTML 文件或任意本地文件；科学资源无需上传第三方查看器。

## 9. 产物合同与可复现记录

每次任务使用独立输出目录，示例：

```text
materials-output/atomistic/<run-id>/
  input/structure.extxyz
  plan.json
  selection.json
  model.json
  environment.json
  events.jsonl
  result.json
  final.extxyz
  trajectory.extxyz
  trajectory-index.json
  observables.csv
  validation.json
  report.zh.md
  report.en.md
  artifacts.json
```

按任务类型声明预期产物，单点任务无需伪造 final/trajectory。`artifacts.json` 只登记真实存在、校验通过的文件，包含 artifact ID、type、hash、大小、结构/帧元数据和生成任务。

拟定产物类型：`atomic_structure`、`atomic_trajectory`、`atomistic_result`、`validation_report`、`plot`、`image`。产物清单通过应用 schema 验证，不由模型自然语言自行宣告成功。

复现记录包含输入哈希、模型和环境版本、随机种子、优化/积分参数、设备/dtype、线程、输出单位、模型选择证据、变换谱系与执行时间。不同设备不承诺位级相同，报告数值容差和已测差异。

临时文件原子提交；取消/失败时单独登记有效部分结果，不创建占位成功文件。当前目录不能覆盖旧运行，原始科研输入保持只读。

## 10. 默认 Skills 与双语示例

首版新增一组独立任务 Skills，名称在 M6.0 固定。所有示例指向安装包真实内置示例文件或用户已提供结构，不能用不存在的路径验收。

| Skill | 中文示例 | English example |
| --- | --- | --- |
| `materials-atomic-structure-inspect` | 检查这个 CIF 的晶胞、元素和原子重叠，并展示 3D 结构。 | Inspect this CIF for its cell, elements and overlapping atoms, then show the 3D structure. |
| `materials-mlip-selection` | 为这个晶体的结构优化选择已安装且适用的势，说明候选与排除理由。 | Select an installed, compatible potential for relaxing this crystal and explain the alternatives. |
| `materials-mlip-singlepoint` | 用指定的势计算该结构的能量和力，保留单位、版本与原子级结果。 | Compute this structure's energy and forces with the specified potential, preserving units and provenance. |
| `materials-mlip-relaxation` | 优化这个结构，固定晶胞，报告收敛状态并对比优化前后的 3D。 | Relax this structure with a fixed cell, report convergence and compare the initial and final 3D structures. |
| `materials-mlip-md` | 对该体系运行受限步数的 NVT 示例，展示真实轨迹和温度曲线。 | Run a bounded NVT example for this system and show the actual trajectory and temperature curve. |
| `materials-mlip-comparison` | 对同一个结构比较两个兼容的势，说明能量基准差异和力的偏差。 | Compare two compatible potentials on the same structure and explain energy references and force differences. |
| `materials-atomic-3d-view` | 打开该结构并显示晶胞，测量两个已选原子的距离。 | Open this structure with its unit cell and measure the distance between two selected atoms. |

每项再提供一个变体示例或明确的前置条件，达到每项 1–2 个中英文示例。点击详情支持切换语言、一键填入 composer 和适用模型跳转；`@` 复用现有选择器。

Skills 指令只指导任务流程，工具规则是执行约束。不得通过改写 Skill 绕过不兼容模型、资源预算或文件权限。

## 11. 与 M5、现有材料流程的边界

- M6 不依赖 M5 正式支付完成，可以用本地 LLM 规划并执行本地科学任务。
- 使用 M5 平台 LLM 时，按真实云模型调用记录 Token；本地势计算不虚构 LLM Token 消耗。
- 本地科学任务另记录运行时间、资源与步数预算；首版不把它自动转换成付费云算力订单。
- 原子结构、轨迹和大型数组默认留本机；云 LLM 仅接收用户允许的结构摘要和必要工具结果。
- 从论文推断原子结构时必须区分实验原始文件、文献可重建结构和假设构建模型，并保留出处。
- 与 RPSME/XYZ 本体数据可建立来源关联，但不声称这些实验本体 JSON 已包含真实原子坐标。
- macOS/Windows 签名、公证、正式科学发布门槛继续按 M4 验收。

## 12. 计划改造位置

以下是未来实施位置，本次只新增规划文档。

| 位置 | 工作 |
| --- | --- |
| `models/` | 新增 potentials manifest、安装/能力数据，与现有目录交叉关联 |
| `skills/`、内置技能资源 | 新任务 Skills、双语介绍、分类和示例 |
| `packages/contracts/src/` | AtomicStructure、Potential、AtomisticJob、Artifact、ViewerConfig 类型 |
| `packages/pi-adapter/src/` | 受控原子工具、选势计划合同、进度与取消 |
| `python/` 或新增独立 MLIP 子项目 | parser、calculator adapters、runner、validation、analysis |
| `scripts/` | 模型同步/许可审核、runtime 构建、哈希检查、探针和评测 |
| `apps/desktop/main/` | 任务管理、模型包管理、SQLite migration、帧读取 IPC |
| `apps/desktop/preload/` | 受限结构/任务/产物操作 |
| `apps/desktop/renderer/src/` | StructureViewer、TrajectoryControls、原子结果卡片和模型详情 |
| 安装构建配置 | 核心势包、独立 runtime、许可与离线样例 |
| `docs/m6/` | 清单快照、兼容矩阵、评测、性能、安装与复现手册 |

## 13. 分阶段工作包与验收

| 阶段 | 工作包 | 主要交付 | 验收门槛 | 工作日估计 |
| --- | --- | --- | --- | ---: |
| M6.0 | MX-601 模型收集与合同 | 10–20 个候选、许可/硬件矩阵、核心势决策、数据 schema 与样本集 | 明确目录/权重/运行区分；锁定核心来源与质量标准 | 3–4 |
| M6.1 | MX-602 核心计算运行时 | 至少 2 个核心 adapter、隔离环境、解析、单点、进程取消 | 双平台核心模型真实运行，单位与输出合同通过 | 5–7 |
| M6.2 | MX-603 静态 3D 与产物 | 安全结构加载、晶胞、测量、卡片、主题、PNG | 无脚本注入/越界读取，真实结构可交互 | 5–7 |
| M6.3 | MX-604 优化纵向闭环 | 固定 cell/受控 cell 优化、记录、报告、前后对比 | 成功/未收敛/失败可区分，真实文件与复现证据完整 | 5–7 |
| M6.4 | MX-605 智能选势与默认 Skills | 硬性过滤、证据排序、LLM 合同、双语 Skills 与例子 | 不兼容模型无法执行，选择理由可回溯，本地/平台模式可用 | 5–7 |
| M6.5 | MX-606 短程 MD 与轨迹 | NVE/NVT、诊断、帧加载、播放/导出、模型对比 | 真实轨迹、正确时间/单位，取消与资源上限生效 | 6–8 |
| M6.6 | MX-607 扩展收录与科学验收 | 扩展包、保留集、故障/容量、离线安装和用户回归 | 核心预装离线可用，质量矩阵与双平台交付成立 | 6–9 |

合计约 35–49 个研发工作日，外部授权、参考数据准备和硬件等待另计。M6.1 和 M6.2 的契约先统一，最终在 M6.3 联调；不因达到日程而自动放行质量门槛。

执行顺序：MX-601 → MX-602/MX-603 → MX-604 → MX-605 → MX-606 → MX-607。

核心优化闭环可以先用用户固定模型完成，智能选势随后接入。复杂领域尚未通过验证时保持该领域待验证状态，不能以晶体示例通过替代聚合物/界面验收。

## 14. 验证样本与科学质量门槛

### 14.1 保留集设计

建立有许可、可追溯的固定样本：简单晶体、多元素无机晶体、缺陷结构、表面、孤立分子、有机体系，以及错误输入。保存来源、结构哈希、理论设置和参考能量/力；尽量使用不属于对应模型训练集的保留样本，无法排除重叠时明确标记。

核心势只对其目标域验收。分子/聚合物没有适用权重时测试应验证系统拒绝不合适的选势，不能强行运行无机势来凑样本数量。

### 14.2 验收层次

| 层 | 检查 | 通过代表什么 |
| --- | --- | --- |
| 接口 | 原子数、力数组、有限值、单位/应力约定 | 计算接口正确 |
| 数值 | 适当情况下有限差分能量梯度、旋转/平移/置换、设备差异 | 数值实现与模型性质符合预期 |
| 运行 | 优化停止标准、MD 稳定性、NVE 漂移、取消/恢复 | 流程可运行且状态真实 |
| 领域质量 | 对应理论的能量/力误差、结构变化、目标性质与 DFT/实验 | 仅在已验证范围内可用 |

能量 MAE、力 RMSE、优化 fmax、NVE 漂移等阈值由 M6.0 按固定样本和任务预先写入评测配置，实施前冻结。不得使用一个全局阈值宣称所有材料和性质准确，或看结果后调整阈值。

交叉模型差异可辅助发现异常，不能代替可靠参考。没有参考或超出验证域的结果标 needs_review。EMT/Lennard-Jones 测试可用于 runner 单元测试，但不能作为 MLIP 科学准确性验收。

## 15. 必须完成的测试场景

| 编号 | 场景 |
| --- | --- |
| POT-01 | 模型缺失、哈希错误、许可未通过、元素/PBC/head/charge 不兼容，全部阻止正式执行 |
| POT-02 | 核心 CPU 加载、重复使用、释放内存；CUDA/MPS 单独兼容矩阵 |
| STR-01 | 非正交 cell、extxyz、错误坐标、无序 occupancy、重叠、缺失 PBC |
| CALC-01 | 真单点、固定 cell 优化、需要 stress 的 cell 优化、未收敛与 NaN |
| CALC-02 | 有限差分力检查、单位转换、旋转/平移、容差和模型能量基准 |
| SEL-01 | 未知模型 ID、伪造能力、无候选、错误 LLM 参数，不能绕过工具规则 |
| MD-01 | NVE/NVT、小步数、错误步长、温度异常、真实帧时间和周期展开 |
| JOB-01 | 取消、超时、崩溃、磁盘满、部分产物、重启与轨迹段恢复 |
| VIEW-01 | 3D 样式、cell、原子选择、测量、主题、原子映射与前后对比 |
| VIEW-02 | 大结构/轨迹限额、离屏释放、WebGL 降级、同时聊天输入流畅 |
| SEC-01 | artifact 越权、路径穿越、symlink、恶意 HTML/JS、巨大文件，不放宽现有渲染边界 |
| PKG-01 | 两平台新安装、无需开发环境、断网运行核心样例、许可证与哈希随包 |
| SKILL-01 | 中英文介绍与例子、`@` 选择、复制输入、模型状态联动 |
| DATA-01 | 输入只读、产物清单真实、模型/环境可复现、错误不伪报成功 |

性能规划基线：16GB RAM/SSD、明确设备和固定样例；静态 2,000 原子视图交互目标 ≥30fps，小轨迹首可见帧 p95 ≤2s，输入处理 p95 ≤100ms，取消后 UI p95 ≤1s。实际推理吞吐、权重加载和内存按模型分别报告。以上是待测目标，不是已经达到的指标。

长轨迹、大晶胞或弱 GPU 不满足目标时，提供明确的采样/简化展示与可导出完整数据，不掩盖性能限制。

## 16. 安装、更新与运维

- 模型/运行时随包交付前做体积、许可证和双平台运行检查，记录安装包增量。
- 扩展下载可暂停与恢复，先写临时文件，校验后提交；断网/磁盘不足不损坏已安装模型。
- 权重加载依赖官方来源和固定哈希，不允许 Agent 下载任意 pickle/checkpoint 后直接执行。
- 更新时显示模型变化，保留旧任务 revision；清理未引用缓存与卸载核心包是明确的用户操作。
- 不静默删除用户自有权重、原始结构或任务产物，避免误清理其他本地模型。
- 诊断记录版本、设备、耗时、状态和脱敏错误，默认不含原子坐标、项目路径或科研正文。
- 当计算 runtime 不可用时，3D 预览和文件导出仍可使用；当 WebGL 不可用时，计算与报告仍可使用。
- 对已知模型数值问题可撤销其自动选势资格，保存历史结果而不改写旧模型身份。

## 17. 后续实施记录与待定事项

所有工作包初始为未开始。本文件只是执行计划，不表示默认包、模型、3D viewer 或智能选势已经落地。

M6.0 必须确定：核心 checkpoint/revision、许可证、双平台运行环境、安装体积预算、原子数/步数默认上限、保留样本与质量阈值、参数和 schema 版本。

后续每个工作包在 `docs/m6/` 保存脱敏验证：真实还是 mock、机器与依赖、模型哈希、样本来源、数值和性能结果、已通过范围与阻断项。验收失败只能保持该能力未通过，不把“程序执行结束”写成“科研结论成立”。

M5 的云 LLM、登录和支付可独立推进；M6 的核心本地计算与 3D 不等待 M5 商业链路。新增 HPC、云科学计算或付费模拟应另补方案与计费边界。

## 18. 参考资料

公开资料核对日期：2026-10-01。说明与候选版本可能更新，开发时重新锁定。

- [MACE foundation models](https://github.com/ACEsuit/mace-foundations)
- [CHGNet 官方文档](https://chgnet.lbl.gov/)
- [MatterSim 官方仓库](https://github.com/microsoft/mattersim)
- [ORB 官方仓库](https://github.com/orbital-materials/orb-models)
- [SevenNet 官方仓库](https://github.com/MDIL-SNU/SevenNet)
- [MatGL 官方仓库](https://github.com/materialyzeai/matgl)
- [FAIRChem 文档](https://fair-chem.github.io/index.html)
- [ASE 优化文档](https://docs.ase-lib.org/ase/optimize.html)
- [3Dmol 格式与接口](https://www.3dmol.org/doc/global.html)
- [3Dmol GLViewer](https://www.3dmol.org/doc/GLViewer.html)
- [NGL 文档](https://nglviewer.org/ngl/api/index.html)
- 项目文档：`docs/DEVELOPMENT_PLAN.md`、`docs/MODEL_CATALOG.md`、`docs/INTEGRATIONS.md`、`docs/M5_TOKEN_API_DEVELOPMENT_PLAN.md`。
