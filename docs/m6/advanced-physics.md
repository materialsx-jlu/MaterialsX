# M6.15 高级物理与组合势 / Advanced physics and composition

2026-10-02。首个固定组合工作流已经实现：`mace-mp-0b3-medium-d3-bj-pbe-si`。当前目录 **176 条资源 / 22 个训练 checkpoint / 9 个已接入计算接口 / 93 个默认 Skills**。组合工作流不计作新增训练 checkpoint。

## 已交付范围

| 项目 | 实际行为 |
| --- | --- |
| 基线 | 固定 MACE-MP-0b3 medium，复用既有 MIT 权重与锁定 MACE/ASE 环境 |
| 修正 | 固定 PBE-D3(BJ) **两体**，由既有 NEP_CPU 1.4 源码中的 D3 函数执行，不加载或计算 NEP 神经网络 |
| 组合 | 同一结构的能量、力、应力逐项相加；FIRE 对总势能梯度优化 |
| 任务 | macOS arm64 CPU：单点与固定晶胞 FIRE；仅探索、需科学复核 |
| 输入 | 纯 Si、三维周期、1–128 原子、正定向晶胞、最小奇异值 ≥4 Å、最大 ≤200 Å、体积/原子 ≥5 Å³、原子最短周期距离 ≥2.3 Å |
| 展示 | 复用 Skills 页面样式及全局配色，双语能力/例子、分项能量与 Fmax 表、分项应力、真实 3D 与优化前后对比 |
| AI | `dispersion-required` 匹配已验收的色散组合；实际加载再核验，冻结计划/范围与证据后执行 |
| 生命周期 | 权重共享、停用不影响基线、离线资源/权重集合、真实产物哈希、复现回执、重启恢复与篡改拒读 |

这里未扩展到所有元素。基线训练参考为 MPTrj PBE+U；纯 Si 不涉及 Hubbard U。PBE 色散参数与此限定参考匹配，不应把同一参数直接套到其他泛函、模型 head 或已经包含色散的权重。[MACE 官方基础模型接口](https://github.com/ACEsuit/mace/blob/726ecec6f3f739786664cf35d6622465fc926170/mace/calculators/foundations_models.py)提供添加 PBE D3 的路径；[GPUMD 官方 D3 说明](https://gpumd.org/dev/gpumd/input_parameters/dftd3.html)要求选择与训练参考相对应的泛函。MaterialsX 的实现与验收边界以固定配置文件为准，不宣称与上游所有 dispersion 参数/实现完全等价。

## 固定物理合同

`models/potentials/composition-profile-m615.json` 记录基线 SHA、算子与参数；`physics-m615.json` 记录源码/依赖锁、平台和许可身份。禁止任意表达式、用户指定引擎路径、在线发现后自动编译、不明确的 head 拼接或重复添加 D3。

- 基线 SHA-256：`2f2be696351ac9e94fbe01cdfb6f017679acdbd2db7645209ef55fec9826b012`，79,472,952 bytes。
- NEP_CPU revision：`43b2ee64dd03e7e880cd343582b0de31b715c222`，仅调用 `compute_dftd3`；Si 使用 D3 元素表中的 Z−1=13，不是此前 Si NEP 单元素模型的 type=0。[上游源码](https://github.com/brucefan1983/NEP_CPU)。
- s6=1、s8=0.7875、a1=0.4289、a2=4.4407 Bohr；势截断 10 Å，配位数截断 5 Å；**无 ATM 三体项、无显式静电**。
- 原生总 virial 转 ASE 应力：`-sym(virial)/V`，拉伸为正，顺序 xx/yy/zz/yz/xz/xy，单位 eV/Å³。
- 原生邻居缓冲固定为 1000。2.3 Å 最短距离与 10 Å 截断给出保守球体堆积上界约 912；晶胞最小奇异值限制同时约束周期自像，避免缓冲越界。优化每次评估均检查结构范围，越界后明确失败，不裁剪或伪造结果。
- 能力缓存包含接口及环境配置身份：共享权重不能让组合势误用基线加载回执。

D3 是截断的经验色散修正，不能满足显式长程静电任务。`long-range-required`、`spin-required`、`field-required`、`delta-required`、`multi-head-required` 在首版均拒绝；提示词出现相应需求也会阻止降级为普通短程计算。变胞、MD、正式用途、其他元素与 Windows/GPU 尚未验收。

## 使用

已有 MACE 环境与基线权重的开发版执行：

```bash
npm run m615:runtime
npm run desktop:start
```

初次准备基础环境使用现有 `npm run m6:runtime`。新增原生引擎需要 macOS arm64 的 `clang++`；正式发行资源由打包流程提供，运行时不会自动编译。

模型目录 → 机器学习势 · 全部目录 → 原子结构：导入纯硅样本或兼容结构，选择探索用途及“显式 D3 色散”，筛选并选择组合工作流，运行单点或固定 FIRE。产物卡直接展示分项及总量，并支持 3D/前后对比。自动分析也支持相同物理需求，最多下载量可以设为 0，因为当前基线已随基础运行环境提供。

中文例子：对已导入纯硅周期结构使用 MACE-MP-0b3 + PBE-D3(BJ) 进行固定晶胞 FIRE，展示实际收敛状态、基线/修正/总能量、力和应力，以及优化前后 3D。

English example: Select the audited MACE + PBE-D3(BJ) profile for imported periodic pure Si. Run a single point and show baseline, correction and total energy, forces, stress and real 3D artifacts; retain needs_review.

产物包括 `composition.json`、`physics-profile.json`、`native-engine.json`、`result.json`、中英报告、计划和环境；优化增加最后结构、逐步总能量/力历史。分项输出对应**最终结构**，未输出每步分项。界面通过受控 IPC 读取已登记哈希文件，并验证分项和与总结果一致。

## 工程验证与科学边界

| 验证 | 证据 |
| --- | --- |
| 实算、FIRE、AI 工具与冻结自动分析 | [CPU 运行记录](evidence/m615-composed-cpu.json)：扰动硅 8 原子，初始 −45.4647570108 eV，9 步收敛，最后 −45.4723911024 eV、Fmax=0.04261718 eV/Å；一步上限明确未收敛 |
| 组合和单独 D3 导数 | [数值记录](evidence/m615-composition-consistency.json)：三力、六应力有限差分，旋转/平移与分项求和；源码/二进制篡改拒绝 |
| 双语界面、全局深浅色与 3D | [原生 Electron 验收](evidence/m615-ui.json)，[中文分项表](screenshots/m615/components-zh.png)、[英文浅色分项表](screenshots/m615/components-en-light.png) |
| 离线发行资源 | [隔离资源验收](evidence/m615-offline-resources.json)：完整资源闭包验真、默认共享基线挂载、实际组合单点和二进制篡改拒绝；不是完整安装包验收 |

类型检查、构建和 169 项测试（168 通过 / 1 项既有跳过）、团队 Skills 11/11、冻结历史合同及此前六晶体/ANI/NEP 实算回归通过。有限差分验证接口和保守力自洽，**尚未验证独立 DFT 精度、色散物理优劣或生产可靠性**。纯硅例子用于验证可扩展的组合链条；其他真实材料应用需要先选体系、参考泛函及独立数据逐类验收。

新增引擎约 1.01 MiB（1,059,504 bytes），复用此前上游源码和 Python 环境；无新增权重下载、无大型 Python 环境。离线权重集合会包含共享基线的副本以保存身份/通知，但它不是完整运行环境分发，导入组合项仍要求默认基线环境已存在；不会覆盖受保护基线。完整离线安装资源使用 M6.15 清单。

## 后续逐类接入

| 路线 | 后续条件 | 当前状态 |
| --- | --- | --- |
| 更多 baseline + D3 | 明确泛函/head/原始色散、元素范围与独立误差；重新冻结配置和验收 | 本轮仅上述纯硅 profile |
| qNEP / DPLR / LES | 电荷定义、总电荷、静电求和/边界和单位合同；合法权重、平台、力/应力数值验证 | 目录候选，阻止运行 |
| DeepSpin / 自旋势 | 自旋/磁矩输入、能量与磁力输出、守恒/约束、实测参数文件 | 目录候选，阻止运行 |
| FIREANN / 外场 | 场单位、方向、边界/周期与力导数、训练适用范围 | 目录候选，阻止运行 |
| Δ-learning | 对应低/高理论基线、偏移与相同结构/元素/单位；防重复基线 | 目录候选，阻止运行 |
| 多头模型 | 明确数据集/泛函/能量零点/实际 head 参数，逐 head 科学合同与验收 | 未解除既有 head 门槛 |

这些路线不会由模型自行猜测参数或把目录收录升级为执行资格。

复核命令：`npm run m615:verify`、`npm run m615:offline:manifest`、`npm run m615:offline:test`。数值探针：`runtime/atomistic/macos-arm64/mace/bin/python3.12 -B atomistic/composed_probe.py "$PWD" runtime/atomistic/macos-arm64/mace/checkpoint.bin`。
