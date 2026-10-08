# M6.6 模型包、科学保留集与离线交付

2026-10-02 · © 2026 吉林大学 AI-DAOS 团队

M6.6 已实现扩展包管理、保留集导入/实际计算/误差报告、质量矩阵、离线包清单与双平台 CI。当前实测在 macOS arm64；独立 DFT 保留集、Windows 实机安装和签名/公证仍待验收，完整 MX-607 科学及双平台发布门槛尚未满足。所有计算仍为探索用途，`needs_review`，没有自动开放正式计算。

## 模型包

在“模型目录 → 机器学习势 · Checkpoints”展开“模型包与科学验收”。CHGNet r2SCAN 是本轮首个可执行扩展，复用已有 CHGNet 隔离 CPU 环境，额外权重 4,872,387 bytes（约 4.65 MiB），未新增大型环境。

开发版首次使用可点击下载，或导入本轮已下载的 `runtime/m6/extension-sources/chgnet-r2scan/checkpoint.bin`；开发版的个人安装状态与测试临时账户隔离。按新构建流程生成的安装包默认带有此权重，不需要用户再次下载。

- “下载扩展包”只访问应用中固定的官方 URL；支持暂停、HTTP Range 续传、磁盘预检查、截断/大小/最终 SHA 拦截，校验后原子提交。服务端忽略 Range 返回完整 200 时从头写临时文件；来源不同、返回范围不符或哈希错误不会安装。
- “导入离线权重”通过原生文件选择器读取；仅接受同一固定 SHA 和大小，不接受用户声明的 URL/摘要作为执行授权。
- “禁用自动选势”阻止新任务，保留文件及旧产物；再次启用要重新通过权重、元素、结构和任务检查。不会删除个人权重、项目输入、其他模型或 Docker 缓存。
- 桌面与 Pi 工具支持三个已接通 checkpoint。其余目录候选仍受许可/摘要/适配器/环境门槛限制，未通过的权重不能反序列化。
- 同一个模型 ID 对应不可变 revision/SHA；后续新权重需新的身份和审核，不能原地改写历史身份。PBE+U 与 r2SCAN 不是可直接比较的总能量基准。

固定 SHA：`8eba3db0f35a2788bb3ae22885ad340591e27996f213c6643af522a633b50dad`。源码 revision：`b9a6c15860237297a5a5169660e83b2e61a78e76`。通知/来源摘要见 `models/potentials/extensions-m66.json`；M6.0 的候选注册表和冻结 release-lock 保持原样，以 M6.6 overlay 增补本轮身份和许可准入。

来源：[官方固定版本 README](https://github.com/CederGroupHub/chgnet/blob/b9a6c15860237297a5a5169660e83b2e61a78e76/README.md)、[仓库许可](https://github.com/CederGroupHub/chgnet/blob/b9a6c15860237297a5a5169660e83b2e61a78e76/LICENSE)。保留 BSD-3-Clause-LBNL 通知；训练数据与适用域的独立权利、重叠及科学审核不因运行成功而自动完成。

## 科学保留集

“导入科学保留集 JSON”从本机读取到当前项目的私有快照。格式见 [示例](holdout.example.json) 和 `schemas/m66/ScientificHoldout.json`。示例明确是**几何与合成零标签的格式演示，非 DFT**；其结果必须 blocked，禁止用来证明精度。

真实数据应填写：

1. `kind=dft-heldout`，文献/计算来源、许可确认与原始标签来源文件 SHA。
2. `units` 明确 `eV-total`、`eV/angstrom`、`angstrom`；参考力数组按归一化结构的原子顺序，大小 N×3。不要把 eV/atom 当总能量输入。
3. `settings`：代码与版本、PBE+U/r2SCAN、U 参数、赝势 SHA、截断能、k 点、电子态、能量参考/修正、力与电子收敛标准。自旋/电荷字段描述参考计算；结构不得要求当前模型不支持的显式电子态输入。
4. 每个拟评测 checkpoint 的 `audits`：训练集重叠审查、审查人/日期/证据 SHA，以及理论设置和能量参考是否匹配。`independent-reviewed` 是导入者提供的审查声明，仍须独立人工核实；系统不会仅凭该字符串批准生产使用。
5. 唯一结构和标签、领域分类 `bulk` / `multi-element` / `defect` / `surface`。不接受重复样本/重复几何、未知单位、NaN/Inf、力形状不符、部分占据或超出当前运行范围的几何。

评测为实际本机单点任务，最多 100 个结构，每个最多 256 原子，输入 JSON ≤16 MiB，一次一个批次；每个科学子任务沿用资源限额，整个批次再设 1800 秒上限。可取消当前子进程；重启中的批次标记 interrupted，不能产生成功报告。不同项目不能使用彼此的保留集或评测 ID。同 ID 不接受改写内容，数据修订应使用新 ID。

冻结筛查门槛来自 M6.0 `quality-policy.json`：每个 checkpoint 至少 50 个独立样本，bulk 20、多元素 10、缺陷 10、表面 10；每个领域能量 MAE ≤0.05 eV/atom、力 RMSE ≤0.2 eV/Å。当前计算入口限制为三维周期无机晶体；表面数据只能在几何与模型实际范围都合格时做探索诊断，真空层/PBC 三维本身不构成表面领域准入。无合格表面参考及适用证据时不能宣称整体验收通过。

能量误差先按每个结构原子数归一化，再求结构 MAE；力 RMSE 在同领域全部原子笛卡尔分量上求均方根。不拟合保留集能量偏置、不平均不同模型的绝对总能量。理论/参考/重叠/许可/数量缺失或合成样本会 blocked；完整有效数据误差超阈值为 failed；完整筛查阈值通过仅为 `passed-screening`，不验证应力、目标性质、优化、MD 或长时稳定性，也不改变生产门槛。

每个报告含数据/策略/权重 SHA、实际运行 ID 和输入几何摘要。输出在项目 `materials-output/scientific-validation/<evaluation-id>/report.json`、`report.zh.md`、`report.en.md`，支持原生导出 JSON。恢复时核验真实单点文件并重新计算误差，修改过的报告不作为成功证据。标签与完整原子数组保留本机；没有新增云上传或积分消耗流程。

## 离线构建与验证

```bash
npm run m6:runtime
npm run m6:packages:bundle
npm run m6:offline:manifest
npm run runtime:skills:mac
npm run build
# 在实际目标平台上构建；下面以 macOS 为例
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --mac --arm64 \
  --config.directories.output=runtime/m6/m66-package-dist
npm run m6:offline:test
```

已有身份/锁/版本/权重匹配的可移植核心环境会复用；显式 `--rebuild` 才强制重建。正式 `package:dir/mac/win` 已加入扩展包与离线清单步骤；新环境仍按原冻结体积与 ≥8 GiB 构建空间门槛。扩展下载本身另检查剩余字节加 256 MiB 余量；原生安装器/完整安装仍须自己的空间与失败验收。

清单登记实际脚本、schemas、模型身份/通知、结构样本及全部运行时文件 SHA。核心权重上限 128 MiB、两个环境展开上限 6 GiB。安装包默认包含两核心与这个小型扩展，初次科学运行不下载模型、不需要全局 Python；断网不影响已有本机计算。

`m6:offline:test` 校验真实打包资源、启动独立临时 userData 的实际应用，经过 main/preload IPC 运行三个模型。所有 worker 禁用 Python 出站网络 API；macOS 核心另在 `sandbox-exec` 的 OS 网络拒绝下实算。此证据覆盖未签名 unpacked app 的离线工程行为，**不等同于完成 DMG/NSIS 新安装、Windows 实机或签名/公证**。测试产物独立保存在 `runtime/m6/m66-package-dist`，不会覆盖既有发布文件或 `/Applications/MaterialsX.app`。

`.github/workflows/m66.yml` 配置两个实际 OS 的构建、评测、UI 与离线回执；未运行的 CI 不能当作平台验收记录。CUDA/MPS 仍为未验收，不会因 CPU 成功而启用。

## 复验与发布门槛

```bash
npm run m66:contracts:check
npm run check
npm test
npm run control-plane:test
npm run m6:audit
npm run m6:validation:test
npm run m6:ui:validation
runtime/atomistic/macos-arm64/chgnet/bin/python3.12 -m pytest atomistic/tests -q
```

完整证据见 [M6.6 工程验收](validation-acceptance.md)。独立 DFT 数据/科学复核、Windows 实机离线新安装、正式签名/公证与发布批准是分别需要真实证据的门槛；本机测试成功不会把 M6.6 的完整发布状态自动改为通过。
