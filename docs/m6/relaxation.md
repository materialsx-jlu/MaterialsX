# M6.3：本地结构优化与前后对比

MX-604 · 2026-10-02 · © 2026 吉林大学 AI-DAOS 团队

MaterialsX 使用已安装的 CHGNet 0.3.0 或 MACE-MP-0b3 medium，在本地 CPU 子进程中执行 ASE FIRE 结构优化。运行时、模型身份、单位与资源隔离沿用 M6.1；M6.0/M6.1/M6.2 冻结合同与注册表保持不变，新增 `m6.3-v1` 合同。当前验收是工程/数值流程验收，科学质量仍为 `needs_review`。

## 桌面使用

1. 运行 `npm run desktop:start`，选择本地项目。
2. **模型目录 → 机器学习势 · Checkpoints → 导入结构文件**。
3. 选择 **结构优化 · FIRE** 和一个已安装核心势。
4. 默认固定晶胞，最多 100 步、fmax=0.05 eV/Å。按需要调整；最多 500 步。
5. 点击 **运行结构优化**；查看步数、能量、最大原子力和过滤器广义力，支持取消。
6. 在真实产物卡片中打开 **优化前后对比**；查看双 3D、同步/独立视角、位移/力着色、每步能量曲线和坐标表。
7. 导出最终 extxyz 或打开双语报告。可用最终结构或取消/失败任务的最后有效结构 **新建任务**。

晶胞优化需在界面明确选择，要求模型提供应力，并填写外压（GPa，正值为压缩）。支持“仅各向同性体积变化”和“体积与形状”两种明确约束；默认前者。不会自动解除三维周期、占位、元素、约束、电荷/自旋等既有硬性限制。最多 256 原子、600 秒、4096 MiB、64 MiB 产物、4 线程为默认预算；达到资源上限为失败，不能冒充收敛。

## 收敛与记录

每次优化先进行真实初始单点检查。固定晶胞使用所有原子力向量模长的最大值；变胞同时检查 FrechetCellFilter 的广义力向量模长，`exp_cell_factor=N`。两者都必须严格小于 fmax；广义力是过滤器缩放后的梯度，不冒充原始应力阈值。ASE filter 的原子梯度随形变转换，因此还独立检查实际原子力。

- `converged`：真实终态满足判据，可在第 0 步满足；不伪造优化移动。
- `max_steps`：执行达到步数上限、未收敛；任务执行完成并交付真实最终结构，界面明确标为未收敛。
- `failed` / `cancelled` / `interrupted`：无成功结果；只在真实文件完整、合同/映射一致时登记 `partial=true` 的最后有效结构。

正压的变胞目标是 E+pV，GPa→eV/Å³ 使用 `0.006241509074460762`；总能量不要求每步单调下降。FIRE 固定 dt=0.1、dtmax=0.5、maxstep=0.1，其他默认参数由锁定 ASE 3.26.0 决定。参数/依赖版本保存于 plan、settings 和 environment。每步验证几何、有限输出、形状和最短周期距离；体积限制为初始的 0.5–2 倍，形变梯度奇异值限制 0.7–1.4，最短距离不低于 0.4 Å。这是资源/几何保护，不是经过校准的物理适用域。

每步完整记录写入 `steps.json` 和 `observables.csv`，包括初始 step=0；标量进度事件约每秒一次，加终态事件。不会逐原子刷新 3D。局部优化只说明相应势能面上的局部结果，不保证真实材料稳定、全局基态或 DFT 精度。

## 真实产物与复现

输出目录为项目 `materials-output/atomistic/<run-id>/`。优化任务包含：

- `source.<format>` / `structure.json`：只读原始输入快照与归一化初始结构。
- `plan.json` / `relaxation-settings.json` / `environment.json`：模型/权重/环境锁、选择来源、预算、FIRE、外压与应变约束。
- `result.json`：最终真实能量、力、应力、实际停止原因与步数；仍引用输入结构 ID，最终几何由优化报告单独关联。
- `final.json` / `final.extxyz`：最终结构，保留原子 ID/顺序与初始输入谱系。
- `relaxation.json`：初末步指标、收敛状态、最终结构 SHA-256 与 N×3 位移。
- `steps.json` / `observables.csv`：全部实际优化步指标。
- `validation.json` / `report.zh.md` / `report.en.md`：接口检查与双语科学限制报告。
- `last-valid.json` / `last-valid.extxyz`：每步原子提交的有效检查点；两文件不一致时不登记。
- `artifacts.json`：主进程登记真实存在的产物、字节数、SHA-256、归属和 partial 标记；失败不创建占位成功产物。
- `events.ndjson`：状态日志；应用数据目录保留权威日志。

extxyz 是几何格式，导出不带 calculator、推断电荷/自旋或优化器对象。ASE extxyz 坐标写出约 8 位小数；JSON 保留计算精度。重新导入允许对应写出精度的坐标舍入，原计算 JSON 不修改。使用末态/部分结构建立新结构 ID、新任务、来源 SHA 与谱系；不会声称恢复 FIRE 速度/步长/内部状态。

读取和导出仅接受项目/任务/登记产物 ID，主进程验证项目归属、每级路径、symlink、文件上限及返回实际字节 SHA。主进程接收新产物/检查点时先做受限无已知摘要读取，完成合同校验后登记；所有后续查看均要求已登记摘要。旧 M6.1 成功记录仍可读取。被修改或缺失的优化产物导致读取拒绝；重启将损坏的已完成记录改为失败。

## 3D 对比

对比前先逐个检查原子 ID、元素、占位、顺序、数组大小及实际位移；固定晶胞还要求晶胞逐项一致。一个独立本地 iframe 中最多两个 viewer，仅装载固定打包脚本与严格数据。普通查看器与对比互斥；关闭释放场景与 GPU，WebGL 失败保留表格/报告/导出。主题、中英文继承系统。frame CSP 禁止网络、任意脚本与 eval；`allow-scripts allow-same-origin` 用于可信本地组件的生命周期隔离，不宣称是运行不可信 HTML 的安全沙箱。

位移定义为 **最终减初始的笛卡尔坐标，未做最小镜像，包含晶胞形变**；保留坐标原点，不做旋转/平移对齐。最终结构可以按真实位移或最终力模长着色；初始结构仅按元素着色，不能把末态力画在初始坐标上。近邻连线仍是近似半径的展示推断，不代表计算键级。颜色按本视图最大值缩放，以绝对数值判断；长轨迹播放仍属 M6.5。

## 本地 Pi 工具

新增 `relax_atomic_structure`，只接受已导入结构 ID、两个已安装势之一和严格选项；晶胞优化只用于用户明确要求，不能推断外压/约束。`get_atomistic_job` 返回实际 stopReason、进度与有限摘要，位移样本最多 16 个。桌面“填入请求”跟随当前任务选择，优化请求携带当前晶胞模式、约束、外压、步数与 fmax。完整的任务 Skills、自动选势与付费平台会话科学工具调度属于 M6.4。

## 验证命令

```bash
npm run check
npm test
npm run m6:verify
npm run m61:contracts:check
npm run m62:contracts:check
npm run m63:contracts:check
runtime/atomistic/macos-arm64/chgnet/bin/python3.12 -m pytest atomistic/tests -q
npm run m6:relaxation:test
npm run m6:ui:relaxation
npm run m6:runtime:test
npm run m6:ui:viewer
```

Windows 在对应 standalone Python 运行同一 Python 测试；GitHub macOS/Windows 工作流已纳入 M6.3 实测。**本机 macOS 通过不代表 Windows 或完整安装包通过。** 验收记录见 [relaxation-acceptance.md](relaxation-acceptance.md)。

实现依据：锁定 ASE 的 [FIRE 与优化接口](https://docs.ase-lib.org/ase/optimize.html)、[FrechetCellFilter](https://docs.ase-lib.org/ase/filters.html)；以本机 ASE 3.26.0 源码与真实试算核对。
