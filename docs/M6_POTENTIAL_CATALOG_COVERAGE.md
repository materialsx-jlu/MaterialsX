# MaterialsX 机器学习势清单覆盖与增补规划

版本：0.2  
日期：2026-10-02  
状态：资料对照与覆盖规划；M6.7 已导入 173 条资源与 194 条名称记录，安装和运行资格仍须分别验收  
关联：[势资源中心计划](M6_POTENTIAL_HUB_DEVELOPMENT_PLAN.md)  
版权：© 2026 吉林大学 AI-DAOS 团队

## 1. 对照结论与核查范围

本次对照用户提供的“主要机器学习势家族、预训练系列和专用势方法”十部分清单、当前 `models/potentials/registry.json` 和势资源中心计划 v0.2，并查询相关官方仓库、文档与论文。

清单已覆盖较广，但它是家族、研究架构与示范模型的学习资料，不能直接视为所有可下载 checkpoint 的安装清单。本轮逐段核对规划覆盖，重点核实新增项和影响接入的变化；**未逐一下载所有权重、核验全部许可、执行全部模型或审查每篇论文的精度结论**。

需分别补齐：

1. 用户清单比规划表更广：补入 NEP、ALIGNN-FF、分子专用系列、经典训练框架及专用势实例。
2. 当前程序已有但规划表不明确：MatterSim、ORB；不能误报为程序完全遗漏。
3. 用户清单未单列的新模型/架构：MACE-POLAR-1、qNEP、DPA4C、REANN/FIREANN、RuNNer、Amp 等。
4. 名单之外的扩展基础：公开势数据库、互操作接口、维护状态、能量守恒性、长程与组合势合同。

## 2. 现有程序准确基线

当前冻结注册表共 **16 个 checkpoint、7 个家族**：

| 家族 | 当前登记内容 | 本轮规划处理 |
| --- | --- | --- |
| MACE | MP-0b3 medium、MP-0b2 small、MPA-0 medium、OMAT-0 medium、MATPES-PBE/r2SCAN、OMOL-0 XL、MH-1 | 复用身份，按官方发布补历史版本/实际尺寸；不创建不存在的尺寸 |
| CHGNet | 0.3.0、r2SCAN | 复用现有包及执行路径 |
| MatterSim | v1.0.0 1M、5M | 已登记；补明确适配排期和维护/环境信息 |
| ORB | v3 conservative inf OMat | 已登记；补历史版本及 OrbMol 的独立科学域 |
| SevenNet | SevenNet-0 11July2024 | 补其余具体系列/变体与 task/modal |
| MatGL | TensorNet PES MatPES PBE 2025.2 | 补其他经过核实的势权重，和性质模型区分 |
| UMA | s-1p2p1 | 补官方实际发布版本、任务与访问条件 |

当前执行白名单仍只有 MACE-MP-0b3 medium、CHGNet 0.3.0 和 CHGNet r2SCAN。上述目录数量不代表 16 个均已安装或运行通过。

## 3. 用户清单各部分如何纳入

下表是覆盖任务清单；名称来自用户资料，具体版本、权重、字段证据及适用性须在 M6.7 来源核验中逐项登记。列入此表不新增执行资格。

| 用户清单部分 | 需覆盖的对象 | 规划位置与处理 |
| --- | --- | --- |
| 无机材料：MACE | MP-0/0a/0b/0b2/0b3、MPA、OMAT、MATPES-PBE/r2SCAN、MH-0/1 | M6.7 完整版本清点；M6.8 先启用最小增量；多头后续单独验收 |
| 无机材料：CHGNet/MatGL | CHGNet/r2SCAN、M3GNet、TensorNet-MatPES | M6.7 目录；M6.10 新适配器候选 |
| 无机材料：MatterSim | MatterSim、MatterSim-MT | v1 两权重已登记；MT 先核实公开资产与输出，论文/服务不视为可下载模型 |
| SevenNet | 0/l3i5、omat、MF-ompa、Omni/i8/i12、Nano | M6.7 按实际 checkpoint/modal/cutoff 拆分；M6.10 适配候选 |
| ORB | v1/v2、v3 conservative | M6.7 标记历史与守恒属性；M6.10 候选队列 |
| 其他材料势 | GRACE-1L/2L/3L、NequIP-OAM、Allegro-OAM、PET-MAD、PET-OAM、ALIGNN-FF | 全部进入目录核查；M6.10 分批评估，未适配显示原因 |
| 商业模型 | PFP/Matlantis | 商业服务类型，展示来源与访问条件；不设本地自动下载或默认付费调用 |
| 跨域基础势 | UMA、DPA-2/3/4、SeZM；关联 MACE-MH、SevenNet-Omni | M6.7 登记任务头/版本关系；同份权重按 head 形成不同任务资格 |
| ANI | ANI-1/1x/1ccx/2x/1xnr | M6.7 分子目录；M6.13 执行候选，不能混同元素与反应覆盖 |
| AIMNet2 | AIMNet2、2025/B97-3c、NSE、Pd、RXN | M6.7 分支清点；M6.13/15 分别评估带电、开壳层与专用流程 |
| 其他分子势 | MACE-OFF23、OMOL-0、OrbMol/v2、SO3LR、FeNNix-Bio1、BAMBOO | M6.7 全部登记；M6.13 分批接入，许可/维护状态单列 |
| 催化/表面 | GemNet/GemNet-OC、Equiformer/V2、SCN/eSCN、eSEN、DimeNet/++ OC、PaiNN OC | M6.7 关联具体训练任务与输出；FAIRchem 新旧运行环境分开核实 |
| 经典专用势方法 | GAP/SOAP-GAP、MTP/MLIP、ACE、SNAP/qSNAP、POD/fast POD、HDNNP、DeepPot-SE、NEP | 方法页与具体参数/权重页分开；M6.14 评估合适实例 |
| 经典训练/执行框架 | PACE/pacemaker、ACEpotentials.jl、n2p2、ænet/ænet-PyTorch、PANNA、GPUMD、pypolymlp | 相关工具目录；安装工具不产生模型科学域 |
| 专用训练与主动学习 | NequIP、Allegro、MACE 专用训练、FLARE、CACE、AGNI、RANN | 训练方法/工作流登记；现阶段不自动训练、不生成 DFT 数据 |
| 通用 NEP | NEP89 | 用户原文已提及，应单独登记具体系列；M6.14 候选，不误报为新发现 |
| 分子研究架构 | SchNet、PaiNN、SO3Net、TensorNet/2、TorchMD-NET ET、PhysNet、SpookyNet、NewtonNet、GDML/sGDML、FeNNol | M6.7 架构与框架页；作者发布的具体权重才进入执行候选 |
| 特殊物理路线 | DPLR、DPRc、DeepSpin、自旋势、LES、4G-HDNNP、电荷平衡、Δ-learning | M6.7 能力/依赖字段；M6.15 扩展任务合同后验收 |
| 专用 GAP 实例 | Si、非晶碳、GAP20、Ge₂Sb₂Te₅、HfO₂、LiCl、LiCl-KCl、Si:H、Li–C | M6.7 按作者/年份/DOI/文件分别登记；M6.14 先选小规模可验证实例 |
| 易混淆性质模型 | MACE-MDP、PET-MAD-DOS、CGCNN、普通 MEGNet 性质权重 | 独立性质模型类别，不能进入能量/力任务候选 |
| 描述符 | SOAP、ACSF、bispectrum | 方法/描述符条目，不计入可下载势数量 |
| 引擎与工作流 | ASE、LAMMPS、OpenMM、GPUMD、DP-GEN | 引擎/工作流页，与模型相互引用 |
| 经典力场 | EAM、ReaxFF、OPLS、AMBER、CHARMM | 如纳入相关资源，单列经典力场，不计作 MLIP |
| 按问题选型建议 | 晶体、热输运、电池、电解液、分子、催化、MOF、专用长时模拟 | 转成双语任务标签与证据检索入口；不可直接当作 MaterialsX 已支持任务 |

结构优化、MD、声子、热导率、NEB/IRC、输运等是不同任务。先收录相关能力和论文，不因势能输出力就同时宣告这些高级任务可运行。

## 4. 本轮核实的缺项和修订

| 补充项 | 与用户清单的区别 | 纳入方式 |
| --- | --- | --- |
| **MACE-POLAR-1** | 清单包含 MACE 分子势但未单列该极化静电系列 | M6.7 关联论文和官方来源；M6.13/15 评审具体权重、电子态与物理项 |
| **qNEP** | 清单有 NEP、NEP89，但未单列动态电荷路线 | 方法/模型候选；M6.15 验证电荷与长程边界合同后再启用 |
| **DeePMD DPA4C** | 清单列至 DPA-4/SeZM；当前官方文档还列出 DPA4C 描述符 | 架构条目；发现具体发布权重后另建 checkpoint，不能凭描述符文档设为可下载 |
| **REANN / FIREANN** | 清单列 RANN，但它不等于 REANN；后者还有电场响应扩展 | 架构/框架条目；FIREANN 在高级物理能力队列 |
| **RuNNer / RuNNer 2.0** | 清单有 HDNNP/n2p2，未列这一训练与评估软件 | 相关框架与版本关系；具体训练势另建资源 |
| **Amp** | 未列的原子机器学习训练包 | 框架条目，使用官方文档中的真实软件来源，不凭猜测 GitHub 地址安装 |
| **OpenKIM / NIST IPR** | 名单之外的势和评测来源 | M6.11 采集源候选；必须区分 ML 与经典势、参数包与驱动 |
| **metatomic** | 名单之外的互操作层 | M6.10/14 适配技术评估；不当作新增势或保证所有模型均可转换 |

依据：[MACE-POLAR-1 论文](https://arxiv.org/abs/2602.19411)、[GPUMD 官方资料中的 qNEP](https://github.com/brucefan1983/GPUMD)、[DPA4C 文档](https://docs.deepmodeling.com/projects/deepmd/en/latest/model/dpa4c.html)、[REANN 官方实现](https://github.com/zhangylch/REANN)、[RuNNer 2.0 论文](https://arxiv.org/abs/2607.17978)、[Amp 官方文档](https://amp.readthedocs.io/en/latest/)。

GPUMD 官方资料还列出 CGNEP、NEP-CG/NEP-AACG 等粗粒化方向。可以登记为相关研究条目，但粒子含义与全原子结构不同，本轮不映射到当前原子计算合同，也不据此恢复 M7 多尺度任务。

### 4.1 已有名称需要补细，不能只加一个标签

- **SevenNet-Nano**：官方目录列出 4.5/5.0/5.5/6.0 Å 截断变体；应形成具体条目，不能只有一个不含参数的 Nano 名称。[预训练目录](https://sevennet.readthedocs.io/en/latest/user_guide/pretrained.html)
- **MatterSim**：官方仓库提供 v1.0.0 1M/5M；macOS Apple Silicon 的 MPS 有数值稳定性提示，当前优先核验 CPU。MatterSim-MT 的论文记录与本地公开权重状态分别核实。[官方仓库](https://github.com/microsoft/mattersim)
- **ORB/OrbMol**：材料势和分子势分开登记；OrbMol-v2 的长程模块、电荷/自旋输入及周期边界处理需纳入合同。[官方仓库](https://github.com/orbital-materials/orb-models)
- **ALIGNN-FF**：官方仓库区分普通性质预测与力场，并提供 ASE 计算器；不能把所有 ALIGNN 预训练资产都路由为力场。[官方实现](https://github.com/usnistgov/alignn)
- **SO3LR**：包含半局域网络及静电/色散等物理项，不能只登记单个网络权重而漏掉其组合参数。[官方实现](https://github.com/general-molecular-simulations/so3lr)
- **BAMBOO**：仓库已于 2026-06-12 归档；目录记录归档状态、不同色散实现的 checkpoint 和分发许可，归档不自动等于不能运行。[官方仓库](https://github.com/bytedance/bamboo)

以上是本轮重点核查结论，不构成所有模型的精度排名或许可兼容性结论。

## 5. 必须补入能力合同的字段

在现有元素/体系/输出/硬件字段之外补充：

| 字段组 | 作用 |
| --- | --- |
| `entity_type` | 区分 family、checkpoint、architecture、training_framework、descriptor、engine、workflow、property_model、commercial_service |
| 力与能量关系 | `energy_gradient / direct_force / other / unknown`；能量守恒 MD 要求任务级检查，不把模型名当保证 |
| 任务头/模态 | 记录 head/modal 对应训练集、理论参考、参考能量和输出；同权重不同头分别验资格 |
| 长程与组合项 | 静电、色散、排斥项、基线势、修正/残差角色和必要参数；避免漏项/重复计算 |
| 电子态 | 净电荷、自旋多重度/模型特定 spin 语义、逐原子自旋、电场等分别声明，不能混用 |
| 截断与边界 | 局部 cutoff、长程求和/截断、PBC 支持与晶胞约束；记录单位 |
| 原子/粒子语义 | 全原子、粗粒化、虚拟位点；不兼容的结构类型不可送入现有 worker |
| 维护与访问 | 活跃/归档/停止维护/未知，官方镜像关系、访问授权、撤回与最后核验时间 |
| 验证范围 | 数据来源、训练重叠审查、温压/结构范围、任务误差与平台；未知范围不自动无限外推 |

这些字段先进入 M6.7 数据合同，实际支持相应任务时再实现执行分支。不会为了登记一个电场模型而允许现有 worker 接收任意新参数。

`entity_type` 的非 checkpoint 内容使用相关资源集合，不能强塞进要求权重身份的执行注册表。全目录页面可以展示相关工具/方法，但统计和 AI 候选必须分别计算。

## 6. 阶段安排

| 阶段 | 本清单带来的补充 | 完成边界 |
| --- | --- | --- |
| **M6.7** | 建立本清单所有名称的覆盖追踪；分清对象类型，双语说明/例子和逐字段证据；全部势页面展示 | 每个名称都有已建档、待核实、别名合并或非势分类原因；不要求全部可运行 |
| **M6.8–M6.9** | 仍先完成已有家族的审核包下载与 AI 自动分析 | 保持至少五 checkpoint 的首条真实晶体闭环，不能被广目录阻塞 |
| **M6.10** | 复用已登记的 MatterSim/ORB，补 ALIGNN-FF、PET/GRACE/NequIP 等适配候选；评估 metatomic | 至少一个新执行家族；其他候选有优先级和阻塞原因，非全部一次安装 |
| **M6.11** | 增加作者权重发布、GAP 数据库、GPUMD 模型来源、OpenKIM、NIST 与论文资产关联 | 来源核实、ML/经典势过滤、跨库去重、增量变化及撤回记录 |
| **M6.12** | 分类统计、历史版本、维护状态、双语例子及拒绝原因验收 | 未验证条目始终不显示已运行；目录覆盖和执行覆盖分别统计 |
| **M6.13：分子与长程体系** | ANI/AIMNet2、MACE-OFF/OMOL/POLAR、OrbMol、SO3LR、BAMBOO/FeNNix 候选 | 已交付首个 ANI-2x 分子家族真实单点/FIRE 和显式电荷/自旋/边界/作用需求合同；其他分子/长程候选逐包后续验收 |
| **M6.14：专用势与原生引擎** | GAP/QUIP、NEP/GPUMD、ACE/MTP/SNAP 等，参考 OpenKIM 及 metatomic | 首个纯硅 NEP4 参数与 NEP_CPU 原生 C++ CPU 引擎已交付，Si 元素映射、单位/应力、单点/固定 FIRE 及 3D 已工程验收；其他原生候选逐包后续 |
| **M6.15：高级物理与组合势** | 多头深度扩展、qNEP/DPLR/LES、DeepSpin、FIREANN、Δ-learning 等 | 首个纯硅 MACE+PBE-D3(BJ) 两体组合、分项结果/AI 色散匹配/3D 已交付；其他长程、场/自旋、Δ-learning 和多头仍阻止执行，逐类验收 |

M6.13 首个分子家族已完成 macOS CPU 工程验收，见 [使用与证据](m6/molecular-potentials.md)；M6.14 首个纯硅专用原生接口已完成，见 [使用与证据](m6/native-potentials.md)；其他分子/原生势扩展仍待逐包接入，M6.15 已交付首个固定组合势，见 [使用与证据](m6/advanced-physics.md)，也不属于当前 M6.9 最小价值的完成条件。训练、微调、主动学习可登记知识与接口需求；自动采集 DFT、自动训练和粗粒化模拟不在本轮交付范围。

M6.10 的至少一个新家族门槛保持不变，其他新增家族进入可见队列。分子、专用势引擎和高级物理的工作量在启动各阶段前单独估算，不能沿用原 v0.1 的 24–41 研发日覆盖所有扩展。

## 7. 来源接入与覆盖验收

补充采集来源：

- **GAP 模型数据库**：关联具体模型文件、作者和 DOI，优先验证少量专用实例。[官方目录](https://libatoms.github.io/GAP/data.html)
- **OpenKIM**：研究模型/驱动身份及评测接口，避免把数据库中的经典势全标为 MLIP。[官方组织](https://github.com/openkim)、[KIM API](https://github.com/openkim/kim-api)
- **NIST IPR**：获取势文件、参考文献和适用说明；其收录范围不限机器学习势，也不宣称全世界所有势都在库中。[官方仓库页面](https://www.ctcms.nist.gov/potentials/)
- **作者关联的 DOI/Zenodo/Figshare 等资产源**：只跟随已核实的作者链接，下载与镜像单独审核，不把任意检索结果设为可信分发源。
- **metatomic**：评估通用模型—模拟引擎接口以减少重复适配，不能保证旧权重无需转换即可使用。[官方实现](https://github.com/metatensor/metatomic)

本轮 OpenKIM 主站直接访问返回错误；已通过其官方 GitHub 资料核实项目定位。其实际查询接口、可达性、分页及使用条件列为接入前探针，不宣称采集器已经连通。

M6.7 建立覆盖表：原始名称、规范对象 ID、类型、别名、来源、字段核验情况、资产状态、适配状态、后续阶段和阻塞原因。M6.11 更新这张表，而不是只不断追加介绍文本。

验收要求：

1. 用户清单各名称全部有处理记录；合并别名和移入相关工具均给理由。
2. checkpoint、架构、描述符、引擎和商业服务的计数互不混淆。
3. 每个可下载 checkpoint 绑定必要资产、实际 revision 和许可依据；不凭架构描述生成假下载入口。
4. 每个可自动运行条目绑定目标平台环境、适配器和真实运行记录。
5. 同一权重的镜像去重，多头/截断/物理修正的不同执行配置可追溯。
6. 新论文、归档、撤回、许可或文件变化均更新状态，旧任务仍引用原版本。
7. 新页面、卡片、详情、下载/更新管理及后续扩展采用现有 Skills 页面的样式和呈现形式，复用全局主题；中英文、全部现有主题、窄窗口及各种状态均可读，不增加独立主题或配色设置。具体要求见 [势资源中心计划第 9.1 节](M6_POTENTIAL_HUB_DEVELOPMENT_PLAN.md#91-势资源中心入口)。

规划时未修改冻结注册表或执行权限。2026-10-02 M6.7 已交付目录映射、能力合同、双语页面和本地查询；没有下载新权重或扩展 worker 执行白名单。见 [M6.7 实现](m6/potential-hub.md)。
