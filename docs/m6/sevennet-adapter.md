# M6.10：SevenNet 家族适配与候选扩充

实施日期：2026-10-02。macOS arm64 / CPU 本机工程验收通过；所有科学结果继续标记 `needs_review`。Windows、GPU、正式签名安装包和独立 DFT 精度尚未验收。下一阶段为 M6.11 自动发现与目录发布。

## 使用方式 / Usage

进入「模型目录 → 机器学习势 · 全部目录 → 下载管理与自动分析」，选择 **SevenNet-0 11July2024**。它和原有五个计算接口共用下载、计划、授权、计算、双语报告、3D 与优化前后对比页面，沿用 Skills 样式和全局主题。

首次需要独立运行环境；在开发机执行：

```bash
npm run m610:runtime:dev
npm run desktop:start
```

已有核心运行环境继续使用；全新开发机还需按 [原运行时文档](runtime.md) 完成 `npm run m6:runtime:dev`。SevenNet 缺少环境时会给出构建说明，不会假装可运行。适配器不共享或升级既有 MACE / CHGNet 的依赖。

权重按需下载，**10,268,648 bytes（约 9.79 MiB）**。也可导入身份完全一致的本地文件。缓存位置为 `<MaterialsX userData>/scientific-packages/<potentialId>/<sha256>/`，模型卡的安装状态来自当前用户真实文件，不由仓库工程回执代替。

导入适用的周期无机结构，选择单点或固定晶胞弛豫，审阅并批准计划后执行；或先授权当前对话的结构、任务、下载和资源范围，再发送需求：

> 使用 SevenNet-0 11July2024 对当前导入的无机周期晶体做固定晶胞优化；最多 100 步，最大原子力阈值 0.03 eV/Å。必要时下载审核权重，输出真实双语报告、收敛情况和 3D 前后对比。

> Use SevenNet-0 11July2024 to relax the imported periodic inorganic crystal at fixed cell. Allow up to 100 steps and a maximum-force threshold of 0.03 eV/Å. Download the reviewed checkpoint if needed and show real bilingual reports, convergence and a 3D before/after comparison.

使用 `@materials-mlip-selection`、`@materials-mlip-singlepoint` 或 `@materials-mlip-relaxation` 可获得对应任务指导。这三个默认 Skill 已补齐 SevenNet 使用范围和中英文要求；无需另外安装 Skill。输入提示不会自行发送。

## 模型身份与能力边界

| 项目 | 本轮实现 |
| --- | --- |
| Checkpoint ID | `sevennet-0-11jul2024`，原目录条目的审核覆盖层 |
| 代码 | `sevenn 0.13.0`，固定 revision `8d9905cc4f4b7ca93be02b37a263785add53c759` |
| 权重 SHA-256 | `7052cb42b7b3be42b40b97fa0d21077a48c54b5548948fc4dcf346629f813c36` |
| 环境 profile | `sevennet-0.13.0-cpu-v1`；Python 3.12.10、PyTorch 2.8.0、e3nn 0.5.8、PyG 2.7.0、ASE 3.26.0 |
| 元素 | 真实读取 checkpoint 的 89 种元素；元素覆盖并不代表每种组合均可靠 |
| 输入范围 | 探索性无机晶体、三轴周期边界；不接受额外电荷或自旋要求 |
| 任务 | 单点能量 / 力 / 应力，固定晶胞 ASE FIRE 弛豫 |
| 单位 | eV、eV/Å、eV/Å³；ASE Voigt 顺序 `xx yy zz yz xz xy` |
| 后端 | macOS arm64 CPU 已验收；Windows CPU / CUDA、macOS MPS 未验收，拒绝执行 |
| 许可 | 固定版本代码和随库 checkpoint 的 MIT 许可；第三方依赖各保留原许可 |

采用上游 ASE calculator 对应力的符号和顺序转换，不在 MaterialsX 再转换一次。加载固定本地 checkpoint，关闭 D3 和可选 GPU 加速。工作进程禁用网络，不根据 LLM 给出的 URL、哈希或 Python 代码下载及执行。

MPTrj / PBE+U 单头 checkpoint 的来源说明保留在 [上游 README 快照](licenses/sevennet-0-README.md)。训练误差、元素数量和本机运行成功不能证明未知材料的独立精度。不启用分子、表面、聚合物、MD、变胞优化、带电/自旋任务和正式生产模式；跨模型总能量没有统一参考，禁止据此直接排名。

## 可扩展结构与空间

`models/potentials/adapters-m610.json` 固定审核包、完整能力、许可通知、OS/后端矩阵和候选元数据；`atomistic/environments/sevennet/uv.lock` 固定源码、依赖与下载哈希。M6.0 冻结注册表、M6.7 历史目录、M6.8 包合同保留原版本，通过当前覆盖层新增能力。

SevenNet 使用独立锁定环境，开发环境路径为 `runtime/m6-environments/sevennet/`；可搬移环境为 `runtime/atomistic/macos-arm64/sevennet/`。后者本机约 **927 MiB**，另外需要构建环境与 uv 缓存；目录显示保守磁盘预算 **1600 MiB**，并非仅 9.79 MiB 权重。现有五个接口不因此复制或升级环境。上游 Python 包内附的其他旧 checkpoint 在环境构建时移除，权重仍由审核包管理器按需安装。

`npm run m610:runtime` 构建可搬移环境并纳入后续 macOS 打包流程，保存第三方许可证和实际依赖清单。环境回执 `runtimeValidation: pending` 不等于用户安装通过；阶段 B 仍须加载其本机实际权重。Windows 依赖锁已解析，但没有 Windows 实机证据，所以本轮不会创建可执行 Windows SevenNet 环境。

四个原有 Nano 候选（4.5A / 5.0A / 5.5A / 6.0A）补齐官方 `v0.13.1.cp` 发布资产 URL、SHA-256、大小和版本关联，保持原 ID、中英文、每项两个例子及未适配状态。每个权重资产为 458,194 bytes；尚未下载或执行，也没有因文件小而绕过许可、理论域与适配审核。总目录仍是 **173 项资源 / 20 个 checkpoint 条目**，其中 **6 个接口**通过本机实际计算；不重复计数。见 [官方发布元数据快照](evidence/sevennet-nano-release.json)。

## 验收与复现

| 检查 | 本机结果 |
| --- | --- |
| 真权重加载及导数 | 三轴力有限差分最大误差 0.0009351 eV/Å；六分量应力最大误差 0.00002045 eV/Å³ |
| 旋转 / 原子置换 | 实际能量、力、应力对应变换检查通过 |
| 冷下载自动流程 | 未安装权重 → 官方下载及哈希 → 实际阶段 B → FIRE → 双语报告与 3D 通过 |
| 非平衡 Si 优化 | 24 步收敛；最大原子力从 1.479790 降至 0.027939 eV/Å，晶胞保持不变 |
| 既有模型回归 | 原五接口加 SevenNet 共六次同结构真实单点通过 |
| 失败与生命周期 | 最多步数未收敛、越域 / 正式模式 / MD / 变胞阻断、使用中保护、实际 worker 取消、恢复、改报告拒读通过 |
| 可搬移环境 | 新位置 Python 与全部模型模块加载成功，真实权重导数 / 旋转 / 置换复测通过；临时环境已删除 |
| 桌面 | 原生 Electron，冷下载及真实优化、登记文件与 3D、深浅全局主题、窄窗口、中英文、用户 Skill 与对话授权通过 |
| Pi / 网关合同 | 实际 Pi SDK + Go 校验器 + SevenNet worker；Responses 的 LLM 选择采用离线脚本，零供应商 / 支付调用 |
| TypeScript 测试 | 141 项：140 通过，1 项既有跳过；10 个团队 Skill 验收通过 |

公开工程证据为 [导数/变换](evidence/sevennet-adapter-checks.json)、[固定晶胞优化](evidence/sevennet-fixed-cell.json)、[可搬移环境](evidence/sevennet-portability.json)、[实际依赖](evidence/sevennet-dependencies.json)。本机完整任务回执位于 `runtime/m6/acceptance/m610/`，UI 回执及截图在 `runtime/m6/ui/m610/`，两者不进入公共仓库。`m610:sevennet-cpu-derivatives` 对应导数证据，`m610:sevennet-fixed-cell` 对应本机非平衡 Si 固定晶胞优化回执。

```bash
npm run m610:verify
npm run m610:runtime
npm run m610:portability:test -- /绝对路径/已核验的SevenNet-0权重文件
```

最后一项在临时新位置克隆可搬移环境，检查模块全部来自新位置，用本地真实权重重复导数、旋转与置换检查，然后删除临时环境。默认权重路径是本机验收缓存 `runtime/m6/m610-source/checkpoint.bin`；新开发机应显式传入从受控下载获得的文件。它验证运行环境可搬移，并不代表完整安装器已签名、公证或双平台通过。

真实 LLM 自动选势质量及独立 DFT 保留集仍待验收。M6.11 将实现官方发布/新论文采集、去重和审核发布，本轮只有固定来源候选补齐，没有后台持续发现任务。
