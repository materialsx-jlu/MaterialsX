# M6.5 短程分子动力学与轨迹

© 2026 吉林大学 AI-DAOS 团队 · 2026-10-02

开发版已接通 CHGNet 0.3.0 / MACE-MP-0b3 medium 的受限 CPU NVE/NVT、真实轨迹、本地 3D 播放及模型对比。沿用已安装隔离运行时，不另下载权重或新建大型 Python 环境。没有独立 DFT 参考，科学质量保持 `needs_review`；正式模式被阻断。Windows/正式安装包和真实外部 LLM 多步成功率仍待验收。

## 桌面使用

1. `npm run dev` 启动开发版，选择本地项目，进入“模型目录 → 机器学习势 · Checkpoints”。缺少隔离环境时先运行 `npm run m6:runtime:dev`；已有环境无需重建。
2. 导入三维周期、全占据的无机晶体，或使用内置 `si-diamond`。选择正确的适用域和“探索试算”，先查看“筛选兼容势与证据”。当前计算不接受分子、高分子、表面/界面、显式电荷/自旋或未知适用域；这些结构仍可静态预览。
3. 任务选择“短程分子动力学 · NVE/NVT”，明确模型和参数，点击“运行短程 MD”。队列只运行一个重型子进程；本机计算不扣平台积分。
4. 真实终态后点击“播放 3D 轨迹与诊断”。支持播放/暂停、时间轴、1–20 帧/秒、球棍/球/棒、晶胞与推断键，以及全局浅/深配色。标明真实步数、物理时间、采样间隔，播放速度不代表物理时间速度。
5. 导出 `extxyz` 轨迹。取消/失败有有效帧时显示“部分轨迹”，可播放和导出，但没有成功结果。点击“用最后有效帧新建轨迹段”只复用几何；不会冒充 MD 续算。

| 参数 | 默认值与边界 |
| --- | --- |
| 系综/积分器 | NVE / Velocity Verlet；可选择 NVT / ASE Langevin |
| 温度 | 300 K；1–1000 K。NVE 为初速度初始化，NVT 为恒温目标 |
| 步长 | 0.5 fs；0.01–1 fs。含 H/He 时 ≤0.25 fs；通过前置检查仍不保证稳定 |
| 步数 | 200，最多 2000；默认总时间 100 fs |
| 采样 | 每 10 步；1–总步数。包含初始帧和最后有效帧；完成时保留非整采样倍数的最终帧 |
| 随机种子 | 20261001；0–4294967295，PCG64 |
| NVT 摩擦系数 | 显式 `0.01 fs^-1`；0.001–0.1；NVE 为 null，禁止隐藏恒温器 |
| 结构/资源 | 默认 256 原子、600 秒、4096 MiB、64 MiB 输出、4 线程；受 M6.0 冻结最大预算约束 |

固定晶胞，无 NPT/压力耦合/额外约束。初始化为 Maxwell–Boltzmann 随机速度并缩放到指定温度；保留 COM 运动，采用 3N 自由度，初始速度摘要可复核。这是精确初温的随机样本，不是已经平衡的热力学系综。位置为未包裹笛卡尔坐标 Å；速度显式转换为 Å/fs，时间 fs，能量 eV，力 eV/Å，温度 K。显示键仅为几何推断。

## 数值诊断与限制

- 每个真实积分步记录势能、动能、总能量、3N 温度、最大力、最小距离、最大速度和已用时间；轨迹帧按采样间隔保留。图表使用真实逐步数据，长曲线仅在绘图时取样，原 CSV/JSON 保留全部步数。
- NVE：所有积分步的总能量对时间最小二乘斜率，单位 `meV/atom/ps`。沿用冻结工程阈值：至少 1000 fs、绝对漂移 ≤1。默认 100 fs 报 `insufficient_duration`，不会因短段斜率较小就宣称通过。
- NVT：后半程平均温度及相对目标温度误差；M6.5 工程诊断要求至少 500 fs、偏差 ≤20%。恒温器控温不证明能量守恒，该检查不是系综采样或材料热稳定性验证。
- 数值停止门槛在运行前固定：NaN/Inf；最小距离 <0.4 Å；温度 >5000 K；最大速度 >0.5 Å/fs；最大原子力 >100 eV/Å；单步位移 >0.2 Å。模型异常、内存、文件和壁钟预算同样停止；只保留真实写入且通过哈希/映射校验的采样帧。
- 性能摘要的 RSS 为逐积分步采样的观测最大值，计算时间/steps/s 不含模型加载；`outputMiB` 为积分结束时的文件占用，尚未计入后来生成的汇总/报告。执行器仍对全部最终文件再次检查输出预算。
- 不推断扩散系数、相变、长时稳定性或 DFT 精度。所有工程诊断通过仍是 `needs_review`，没有升级生产准入。

## 双模型对比

对同一不可变输入，用不同核心势运行完全相同参数/随机种子；实际初速度 SHA 必须一致。播放器提供第二个任务的选择，绘制两条真实温度或 `ΔEtotal/N` 曲线。能量以各模型自身初始值为零、单位 meV/atom；未对齐的绝对总能量不比较。多势一致不证明准确。参数不同、输入不同、任务未完成或初速度不一致会被拒绝。

## Skills 与平台模式

默认 `materials-mlip-md` 现已可执行，保留分类、中英介绍、两条双语例子及 `@` / 填入输入框。先 `materials_science select`、引用真实候选证据，再 `md` 和 `get` 到终态；本地显式参数工具为 `run_atomic_md`。默认统一调度采用 200 步 NVE；输入自定义参数应使用专用工具或桌面。

平台会话先从桌面选择结构、域、用途、MD 参数并“授权范围并填入平台请求”，随后原生确认本轮外发范围。结构/参数范围冻结，不能由 LLM 越权更改；最多两个 CPU 任务。平台只接收有界标量摘要、任务/产物 ID 和 SHA，不传坐标、完整速度/力、轨迹帧数组或本机路径。模型请求按 M5 用量结算；用量未知/未结算不继续本机工具。合成 Responses 验收不代表真实供应商已验证多步成功率。

## 真实文件与读取

输出位于项目内 `materials-output/atomistic/<run-id>/`；原输入不覆盖。

| 文件 | 内容 |
| --- | --- |
| `frames.ndjson` | 实际采样帧：原子顺序对应输入，坐标 Å、速度 Å/fs、逐步指标 |
| `trajectory.extxyz` | 多帧结构，含 `velocity_A_per_fs`、`step`、`time_fs` |
| `trajectory-index.json` | 每帧真实步数/时间、两种文件的字节范围、SHA256；原子写入，只指向已 flush 的帧 |
| `md-observables.json` / `observables.csv` | 完成时全部真实积分步；失败前 CSV 中已记录的步仍保留在本地 |
| `md-summary.json` / `report.zh.md` / `report.en.md` | 实际终止、诊断、随机初始化、资源、双语限制说明 |
| `md-settings.json` / `plan.json` / `environment.json` | 参数、输入/权重 SHA、CPU/dtype、库版本和依赖锁 |
| `selection.json` / `result.json` / `validation.json` / `artifacts.json` | 真实候选证据、最终实际值、质量及文件登记摘要 |

长轨迹只做流式哈希和范围读取，主进程不一次加载全轨迹；单帧 ≤2 MiB，前端 LRU ≤5 帧，同一场景复用。身份、字节范围、项目所有权、哈希及目录/symlink 检查在受控本机路径执行。导出逐帧验证，在用户选定位置先写临时文件，全部成功才完成输出；部分轨迹只导出已登记有效前缀。关闭/切项目释放场景与缓存。

`AtomisticPlan/Result` 沿用 M6.0 冻结格式，扩展合同位于 `schemas/m65`。基础结果的 MD `stopReason=max_steps` 表示到达请求步数，精确语义由 M6.5 的 `requested_steps_completed` 汇总说明；不是优化收敛。重启未终态任务标记 interrupted，检验有效帧，不自动续算；缺完整积分器、恒温器和 RNG 状态。

## 复验

```bash
npm run check
npm test
npm run control-plane:test
npm run m6:audit
npm run m65:contracts:check
npm run m6:md:test
npm run m6:ui:md
npm run m6:cloud:md
runtime/atomistic/macos-arm64/chgnet/bin/python3.12 -m pytest atomistic/tests -q
```

真实双核心数值/取消/资源测试需要已安装环境；平台集成使用临时 PostgreSQL 16 和合成供应商，不访问现有账户数据库，不调用真实供应商或支付。验收与未完成项见 [工程证据](dynamics-acceptance.md)。M6.0–M6.4 历史快照保持其原版本，当前源码另有 M6.5 快照。

算法参考：已锁定 ASE 3.26.0 源码和官方 [MD 文档](https://ase.gitlab.io/ase/ase/md.html)、[Langevin](https://docs.ase-lib.org/_modules/ase/md/langevin.html)、[初始化说明](https://docs.ase-lib.org/_modules/ase/md/velocitydistribution.html)。当前文档中的更新算法不自动替换本项目冻结依赖。
