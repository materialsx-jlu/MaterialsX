# M6.0：模型收集与本地科学合同

交付日期：2026-10-01 · 工作包 MX-601 · 合同 `m6.0-v1`
© 2026 吉林大学 AI-DAOS 团队

本页保留 M6.0 冻结交付记录。当前 M6.1 已接入本机 CPU 单点；使用、环境和当前验收状态见 [M6.1 运行时](runtime.md) / [验收](runtime-acceptance.md)。下文“未安装/未执行”均指 M6.0 当时状态。

M6.0 已实现模型注册表、桌面目录入口、数据合同、许可/硬件清单、固定结构样本与质量策略。**未安装或运行 MLIP，未实现 3D 查看器、优化/MD 工具或自动选势。** 这些分别属于 M6.1–M6.6。核心 CPU 运行、双平台安装和独立 DFT 科学质量仍须后续验收。

## 入口与文件

开发版在“模型目录 → 机器学习势 · Checkpoints”查看 16 项具体权重。共用系统主题与目录搜索，支持家族筛选、双语介绍、每项两个双语例子、示例填入聊天、固定来源链接，以及权重/运行/领域状态区分。原研究目录保留 100 项，已启用 Skills 保留 84 项。

| 资源 | 文件 | 用途 |
| --- | --- | --- |
| 权重注册表 | `models/potentials/registry.json` | 16 个具体 checkpoint，包含来源、声明能力、理论层级、许可、硬件矩阵、例子 |
| 来源锁定 | `models/potentials/source-lock.json` | 固定 Git SHA、证据文件 SHA-256、两项核心真实权重身份、HF 元数据 |
| 环境目标 | `models/potentials/environment-targets.json` | 独立家族环境的两平台 CPU 目标、依赖和体积预算；完整依赖锁待 M6.1 |
| 质量策略 | `models/potentials/quality-policy.json` | 预先确定的工程/数值与限定领域筛查门槛；无参考标签时阻断领域通过 |
| 任务名称 | `models/potentials/task-skills.json` | 七个任务 Skill 名称、独立分类和双语例子；M6.4 才注册启用 |
| 合同实现 | `packages/contracts/src/atomistic.ts` | 严格 Zod schema、跨字段约束、单位、预算、终态与产物规则 |
| 可移植 Schema | `schemas/m6/*.json` | 10 份 JSON Schema；Python 等未来执行器须另实现文档中的跨字段与授权检查 |
| 结构样本 | `samples/atomistic/` | 7 个合法几何 + 6 个反例、格式文件、归一化 JSON、哈希与来源 |
| 发布冻结 | `models/potentials/release-lock.json` | 注册表、环境、策略、样本、合同实现与导出 schema 的哈希 |

安装配置已包含上述 `models/`、样本、schema 及 `docs/m6/`；本次只验证构建与配置，没有重新制作或验收安装包。这里的内置资源均为文本/小型几何，不静默下载权重。

## 核心决策

选择 **MACE-MP-0b3 medium** 与 **CHGNet 0.3.0** 作为首批无机晶体 CPU 核心候选。计划中出现的“MP-0b3 small”更正为 medium：官方 [0b3 release](https://github.com/ACEsuit/mace-foundations/releases/tag/mace_mp_0b3) 只提供 medium，固定源代码下载映射也仅列 `medium-0b3`。较小的 `MP-0b2 small` 独立登记为扩展候选，不能冒充 0b3。

| 核心身份 | 大小 | SHA-256 |
| --- | ---: | --- |
| `mace-mp-0b3-medium` | 79,472,952 bytes | `2f2be696351ac9e94fbe01cdfb6f017679acdbd2db7645209ef55fec9826b012` |
| `chgnet-0.3.0` | 4,863,221 bytes | `d14ab7c0f093efe64b60a7bcd540bca10e74fb7f46c86108a079af60524659d1` |

两份文件从官方地址读取并计算哈希；**未反序列化、执行或保存为已安装权重**。MACE 固定 release asset `213936922`；CHGNet 固定源码 revision 中的 `chgnet/pretrained/0.3.0/chgnet_0.3.0_e29f68s314m37.pth.tar`。因此 `CHGNet.load()` 的默认权重原本在安装后的 Python 包内，MaterialsX 后续安装包须把这份确切文件及环境收入专用运行时，不能依赖用户全局 Python。

代码、权重和数据许可分开登记。核心按官方 MIT / CHGNet BSD-LBNL 源仓库及包内文件的通知要求做再分发工程决策，保留原始许可在 `licenses/`；尚未打包或宣称全部最终发行法律义务已完成。训练数据许可与模型性能验收保持独立。MACE 标记 ASL 的候选仅按上游原称记录，不当作 Apache-2.0；具体许可文本未核完，不准入默认权重包。UMA 需要访问授权与独立条款。

MatGL 当前官方说明已撤下旧 GitHub 权重回退并修正过消息传递约定，本次选用 `materialyze/TensorNet-PES-MatPES-PBE-2025.2` 的固定 HF revision。`state.pt` 的发布方摘要不等于整个模型包验收；还需要同 revision 的 `model.json`、`model.pt`，在来源锁中分别登记。UMA 采用当前官方 `uma-s-1p2p1` 固定 HF revision，并明确为受限获取。

## 许可与硬件矩阵

登记详情见 [逐 checkpoint 矩阵](candidate-matrix.md)。所有 16 项状态都是 `catalogued`，权重 `absent`，实测运行/领域证据为空。只有两项核心完成真实文件摘要；MatGL/UMA 主权重记录发布方 LFS 摘要，其余扩展摘要未核实。没有一项可正式计算。

两核心目标环境：Python 3.12.10、PyTorch 2.8.0、ASE 3.26.0、NumPy 2.2.6，按源 revision 锁定家族代码，分别构建 macOS arm64/Windows x64 专用环境。**这是 M6.1 的冻结目标，不是已解决/已运行的跨平台依赖锁**；传递 wheel 哈希、原生图转换器或回退模式、设备误差与运行收据须在 M6.1 补齐。CPU 为基线，GPU 不自动启用。

MatterSim Apple Silicon MPS 按官方警示标 `unsupported`，CPU 与 Windows CUDA 仍未测试；其他候选所有平台/设备行均未测试。首版同时只加载一个重型模型，核心权重预算 128 MiB，两环境展开总预算 6 GiB、安装前可用空间预算 8 GiB。这些是交付上限，实际 RSS/包体/加载时间当前未知。

## 合同与执行边界

1. 注册表采用固定候选 ID；未知值写 `unknown`/`null`，声明能力与运行/领域证据分离。元素数量声明不转换成未经核实的具体元素白名单。任何安装/运行/领域状态升级必须补对应的许可、摘要及证据。
2. `AtomicStructure` 必须有有限 Å 坐标、有效元素、唯一原子 ID、明确 PBC；周期结构须有非奇异晶胞。原始输入哈希与变换记录单独保留。部分占据可表示用于预览，M6.1 计算校验必须阻断；位置重叠、最小镜像近距也属于解析后的科学校验。
3. `AtomisticPlan` 只接受枚举和受限参数。固定 cell 优化不带外压；可变 cell 须显式外压，并由执行器核验 stress。MD 时间步 0.01–1 fs、步数/采样/资源预算相互校验。没有任意 Python、shell 或下载 URL 参数。
4. `AtomisticJob` 执行状态与科学质量独立。终态有结束时间；completed 有真实结果 artifact ID；达到步数上限不能视为收敛。`AtomisticResult` 输出总能量 eV、N×3 力、可选应力，不能用语言声明代替文件。
5. `AtomisticArtifact` 限相对路径及类型，阻断绝对路径、穿越、Windows 路径、URL、NUL；`AtomicViewerConfig` 仅 artifact ID、枚举和显示上限，不容纳脚本。**Schema 不验证磁盘真实性、项目授权或 symlink**，未来主进程必须 realpath、ownership、大小与真实哈希再验。
6. `PotentialSelection` 的 selected ID 必须在候选列表中；它本身不能证明候选来自注册表。M6.4 将核验本机已通过资格的候选和证据、元素/PBC/电荷/自旋/head，再让 LLM 解释。`potentialReadiness` 仅返回元数据阻断原因，不是执行授权。
7. JSON Schema 导出无法完整表达所有 Zod 跨字段 refinements；TS 必须使用实现 schema。Python runner 必须补相同约束、科学判断与文件校验，不能只依赖 JSON Schema。

## 固定样本与科学门槛

所有新增几何由团队代码构造，采用项目 AGPL-3.0-only，没有复制待核实的论文示例。Si diamond POSCAR、NaCl CIF、非正交 Si extxyz、Cu vacancy POSCAR、Cu slab extxyz、孤立水和甲烷 XYZ 共 7 例；非有限值、重叠、未知元素、奇异晶胞、缺 PBC、部分占据共 6 例。每个文件记录 SHA-256；合法例有归一化结构合同。它们只是几何/接口样本，`reference:null`、训练重叠未知、`scientificValidationEligible:false`。

有限差分步长 0.001 Å；力梯度最大绝对误差目标 float64 0.005 / float32 0.02 eV/Å；平移/旋转能量容差分别 1e-5 / 1e-3 eV/atom。实际数值验收尚未执行，须包含非平衡结构，不能只测零力结构。核心默认优化为固定 cell、FIRE、200 步、fmax 0.05 eV/Å，最大力为逐原子力向量模长最大值。实际达到 fmax 才能标收敛。

独立匹配理论/能量基准的领域筛查：每核心至少 50 个合法且可许可的参考结构，其中 bulk 20、多元素 10、defect 10、surface 10；限定域目标能量 MAE ≤0.05 eV/atom、力 RMSE ≤0.2 eV/Å。各 checkpoint/子域独立判断，不能看结果后拟合基准或改变门槛。参考的 DFT 设置、赝势、+U、电荷/自旋、收敛、授权与训练重叠审查全部必需。**当前参考标签尚未收集，领域 gate 为 blocked-reference-data-missing**，不是已通过的准确性声明。若目标用途需不同门槛，先建立新的策略版本和参考集，不能改旧策略来放行。

短程 MD 参数与漂移目标也预先记录，仅待 M6.5 逐体系验证；0.5 fs 默认不意味着每种元素/体系安全，短时间跑完不支持扩散或热稳定性结论。分子/聚合物不继承无机核心势的验收范围。

## 复现与验收命令

```bash
npm run m6:verify       # 离线合同、冻结资源、7 组 TS 合同/注册表测试、9 项 ASE/Schema 样本测试
npm run check
npm run test
npm run build
npm run m6:ui           # 临时 userData 的真实 Electron，验证中英/筛选/示例/系统主题，无真实账户或模型调用
npm run m6:source-check # 显式网络核查固定源码证据，不获取凭据或加载权重
npm run m6:source-check -- --weights # 再读两核心文件计算摘要；不存盘/安装/执行
```

修改合同后 `npm run m6:contracts` 导出；`m6:contracts:check` 阻断漂移。修改已冻结输入先评审、必要时提升 release/policy ID，再明确 `npm run m6:audit -- --freeze`；普通 audit/CI 不会自动改锁或放宽门槛。`python3 scripts/generate-m6-samples.py` 可重建几何样本。

本机验收结果见 [验收记录](acceptance.md)。macOS 本机通过不能外推为 Windows 已通过；两平台 CI 已接入离线 audit/schema 检查，运行结果以实际 CI 收据为准。

## M6.1 交接

- 用两核心锁定文件建立隔离 CPU 环境，收集完整依赖哈希与原始通知，两目标平台实际验证。
- 解析真实 CIF/XYZ/extxyz/POSCAR，处理 occupancy/PBC/近距/资源上限；原件只读，结构谱系可追溯。
- ASE 适配器完成能量每原子到总能量、应力单位/符号/分量归一化，并用真单点和有限差分探针验收。
- 任务/产物授权、进程管理、取消/崩溃、包哈希核查须落地后才能执行计划。M6.0 没有注册空的 Pi 计算工具来伪装能力。
- 保持 M5 登录、支付、积分数据库不迁移；本地 MLIP 不生成 Token 账单。M6 云 LLM 仅通过既有 M5 网关计量。


2026-10-02：M6.2 静态 3D 与真实产物卡片已接入，见 [查看器使用](viewer.md) 和 [工程验收](viewer-acceptance.md)。本页的 M6.0 未安装状态为历史冻结基线，当前运行状态以 M6.1 安装回执为准。

2026-10-02：M6.3 本地 FIRE 优化、真实收敛/未收敛记录、最后有效结构和双 3D 位移对比已实现并通过 macOS 工程验收。见 [使用](relaxation.md)、[验收](relaxation-acceptance.md)。当前桌面默认 100 步，M6.0 的 200 步策略预算是历史冻结基线；任务会保存自己的显式参数与预算。
