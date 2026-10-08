# M6.1：本地核心计算运行时

工作包 MX-602 · 2026-10-01 · © 2026 吉林大学 AI-DAOS 团队

本阶段实现两种核心势的本地 CPU 单点计算、结构导入、任务队列、进程取消与真实文件验收。M6.0 的注册表和质量策略保留为冻结基线；本机安装和运行记录单独保存。**单点计算成功与数值一致性通过不等于科学预测精度通过**，结果质量始终为 `needs_review`。

## 使用

```bash
npm ci
npm run m6:runtime:dev
npm run desktop:start
```

在桌面“模型目录 → 机器学习势 · Checkpoints”中，先选择本地项目，导入 CIF、XYZ、extxyz 或 POSCAR，然后明确选择 CHGNet 0.3.0 或 MACE-MP-0b3 medium。点“运行单点计算”后可查看加载/运行/终态、取消任务和定位输出文件。界面共用系统主题和中英文切换。

当前两种核心势只开放三维周期晶体筛查；分子、部分周期的薄膜、部分占据、原子重叠、未知元素、非有限坐标、退化晶胞和含约束输入会被明确阻断。可读取分子结构供后续 viewer 使用，不能据此用无机晶体核心势进行分子计算。XYZ 的 charge/spin 不推断；extxyz 要求显式 PBC；多帧/多结构文件不自动选择一项。CIF 通过 pymatgen 保留占据率和解析警告，不自动排序或修补。

首次开发构建需要网络下载锁定依赖与约 80.43 MiB 权重，最低空闲空间为 3 GiB；不覆盖 PDF/Skill Python 环境。计算过程不调用云端模型、支付或积分账本。

## 环境与打包

| 核心 | 独立环境 | 固定源版本 | Python / PyTorch / ASE / NumPy |
| --- | --- | --- | --- |
| MACE-MP-0b3 medium | `atomistic/environments/mace/` | `726ecec6f3f739786664cf35d6622465fc926170` | 3.12.10 / 2.8.0 / 3.26.0 / 2.2.6 |
| CHGNet 0.3.0 | `atomistic/environments/chgnet/` | `b9a6c15860237297a5a5169660e83b2e61a78e76` | 同上 |

解析依赖同时固定 `pymatgen==2026.5.4` 和 `pymatgen-core==2026.7.16`。两份 `uv.lock` 包含 macOS arm64 / Windows x64 的完整传递依赖和下载摘要；Windows 使用 PyTorch CPU 索引，避免安装 CUDA。构建依赖也有约束。MACE 的 matscipy 固定 1.2.0（1.1.1 不兼容固定 NumPy 2.2.6）。CHGNet 运行时明确使用 legacy Python graph converter，源码构建仍可能需要 C 编译器，Windows CI 已设置 MSVC。

开发环境位于 `runtime/m6-environments/<family>/`，安装元数据/权重位于 `runtime/atomistic/<platform>/<family>/`。`RUNTIME.json` 绑定平台、源 revision、权重身份、环境 profile 和依赖锁 SHA-256；执行前检查身份，反序列化前再次检查权重的实际字节和哈希。用户提供的模型文件、代码、模型路径、下载地址不属于 IPC/工具输入。

```bash
# 与当前主机一致的平台，独立 Python + site-packages + 权重 + 许可文件
npm run m6:runtime
# 开发机空间受限时，仅用于构建/测量可移植运行时；不替代安装器的 8 GiB 空间门槛
node --import tsx scripts/build-atomistic-runtime.ts --development --portable
```

正式构建保持 M6.0 的 8 GiB 最低空闲空间门槛。可移植环境复制独立 CPython 与各自完整 site-packages，移除对开发 venv 路径的依赖；打包额外资源使用 `atomistic-runtime/`。macOS/Windows 打包命令先构建该运行时。Windows 完整构建应在 Windows x64 主机执行，不再把 macOS 上生成的源码包当作 Windows 已验收版本。下载失败或哈希不符不准入。

代码/权重许可、各分发包自带 LICENSE/NOTICE 等文件与依赖清单随运行时保存。缺少元数据许可或内嵌原生库授权仍要在发行审核中逐项核实；安装和工程测试不代替发行许可审核。

## 执行与单位

Electron 主进程选择项目、生成固定 plan 并启动受控 Python 子进程；渲染进程只传 project/structure/potential/run ID 和有上限的 budget。结构文件只由原生文件选择器导入并立即复制，原文件不修改；后台队列最多 8 个等待任务，同一时刻只运行一个重模型。关闭/重启后未完成任务标为 `interrupted`，不自动补算。

默认 256 原子、600 秒、4096 MiB、64 MiB 产物、4 线程。用户预算受 M6.0 合同上限约束。父进程限制时间与协议日志，子进程监测 RSS 与输出体积；达到门槛使任务失败。取消先终止进程树，必要时强制终止；Windows 使用 `taskkill /T`，POSIX 使用独立进程组。失败、取消和中断不发布成功产物清单。这里的隔离是独立依赖与子进程，不宣称是运行任意用户代码的操作系统沙箱。

统一输出总能量 eV、N×3 力 eV/Å、正拉应力 eV/Å³（`xx,yy,zz,yz,xz,xy`）。[CHGNet 官方 ASE adapter](https://github.com/CederGroupHub/chgnet/blob/b9a6c15860237297a5a5169660e83b2e61a78e76/chgnet/model/dynamics.py) 将 intensive energy 乘原子数一次；MaterialsX 不再重复转换。CHGNet GPa 应力显式使用精确 SI 系数 `0.006241509074460762`，不依赖 ASE 默认旧 CODATA 系数。[MACE ASE adapter](https://github.com/ACEsuit/mace/blob/726ecec6f3f739786664cf35d6622465fc926170/mace/calculators/mace.py) 的应力已经是目标单位，不再次乘该系数。运行时从实际模型取元素覆盖，覆盖不代表各元素精度均已验证。

真实产物位于项目 `materials-output/atomistic/<run-id>/`：

- `source.<format>` / `structure.json`：原始快照与归一化结构。
- `plan.json`：模型/结构/依赖 profile、预算、明确选势依据。
- `events.ndjson`：任务阶段、质量状态与失败原因；用户数据目录保留权威日志。
- `environment.json`：实际包版本、设备、dtype、元素与单位转换信息。
- `result.json`：有严格合同、身份和有限数值校验的计算结果。
- `validation.json` / `report.zh.md`：接口验证与科学质量限制。

输出目录拒绝符号链接重定向。产物登记包含真实 SHA-256 和字节数；成功状态必须同时具有真实结果和登记产物。任务与导入结构按项目归属持久化于用户数据目录。

本地 Pi 会话接入五个固定工具：`inspect_atomic_structure`、`run_atomistic_calculation`、`get_atomistic_job`、`cancel_atomistic_job`、`list_atomistic_jobs`。只使用已导入结构 ID 和本项目任务 ID；计算为异步任务，必须读取终态和结果才能声明完成。`get_atomistic_job(wait=true)` 最多等待 30 秒，减少模型反复轮询；列表返回摘要，坐标/力最多返回 16 项样本，完整数组保留在真实 JSON 中。桌面选择与代理工具请求的选势来源分别记录，代理选择不冒充用户已指定。界面的“填入本地模型请求”只在本地模型模式启用。M6.4 的自动选势、七个任务 Skills 以及付费云端会话对本地科学工具的调度仍在后续工作范围。

## 验收

```bash
npm run check
npm run test
npm run m6:verify
node --import tsx scripts/m61-contracts.ts --check
npm run m6:runtime:test
npm run m6:ui:runtime
# 对当前已安装 Python 执行；开发环境示例：
runtime/m6-environments/chgnet/bin/python -m pytest atomistic/tests -q
```

每个核心在 Si、NaCl、Cu vacancy 三个非平衡几何上进行非零力、能量有限差分、平移/旋转能量及力协变检查，使用 M6.0 预冻结门槛；补充以体积应变有限差分检查应力正负号/单位（新增明确门槛 0.001 eV/Å³）。样本为团队合成几何，没有 DFT 标签。工程验收还包括真实文件、严格 IPC/归属、资源门槛、排队/运行中取消和重启恢复。

Windows 的真实双核心验收由 `.github/workflows/m61.yml` 执行并上传证据。**只有该主机真实通过，才可填写 Windows 通过；macOS 的运行记录不能代替 Windows 记录。** 完整安装包、GPU、科学参考集、3D viewer、优化及 MD 不在本次本机验收范围。状态和实测数字见 [M6.1 验收记录](runtime-acceptance.md)。

M6.3 已新增本地 FIRE 结构优化，继续使用本页两套受控运行时与权重。优化选项、收敛、最后有效结构与前后 3D 对比见 [M6.3](relaxation.md)；本页 M6.1 单点回执为历史基线，不重写旧证据。
