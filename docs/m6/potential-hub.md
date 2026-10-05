# M6.7 势资源目录：使用与扩展

本文保留 M6.7 的交付基线；M6.8/M6.9 已完成下载挂载、五 checkpoint 本机实算、授权自动分析与用户 Skill 创建，当前使用见 [下载与自动分析](automatic-analysis.md)。

日期：2026-10-02 · 合同：`m6.7-v1`  
© 2026 吉林大学 AI-DAOS 团队

## 当前交付

进入 **模型目录 → 机器学习势 · 全部目录**，默认展示全部已收录资源。目录使用 Skills 页面的卡片、详情、示例按钮和全局深色/浅色主题，目录置于原有本机计算面板之前。

当前合计 **173 条资源、194 条名称/别名覆盖记录、53 个家族/来源组**：

| 类型 | 数量 | 含义 |
| --- | ---: | --- |
| checkpoint | 20 | 原有 16 权重候选 + 4 个 SevenNet-Nano cutoff 候选；后者尚未绑定资产 |
| family | 69 | 发布系列，不是 69 个已安装权重 |
| architecture | 45 | 研究架构/方法，具体参数仍需核实 |
| training_framework | 17 | 训练软件，安装软件不产生材料适用资格 |
| workflow | 2 | 主动学习/残差学习流程 |
| property_model | 4 | 性质预测，不进入势能/力/MD 执行接口 |
| descriptor | 3 | 描述符，不是独立势 |
| engine | 4 | 模拟引擎，需要具体参数/计算器 |
| classical_forcefield | 5 | 经典力场，不计作 ML checkpoint |
| commercial_service | 1 | 商业服务，未接入付款或调用 |
| repository / interop | 2 / 1 | 数据来源与互操作接口 |

这是人工整理的研究候选范围，不是全网穷尽清单或使用量排行。来源定位与具体能力审核分开：`candidate` 表示名称/来源关联仍待核实，`documented` 表示资料定位，`pinned` 表示历史冻结证据；这些状态均不能替代本机实算或独立科学评测。

每条记录有中英文说明、两条例子、来源、限制及后续接入阶段。使用家族/领域/资源类型/状态筛选；每页最多 24 张卡片。同家族系列和具体版本可在详情中切换。点击“复制到输入框”仅填入例子，用户编辑后再发送。

“隔离环境已安装”来自本机实时查询，**不等于权重通过本轮身份检查、任务兼容或领域精度通过**。刷新按钮可在安装/禁用扩展后重查状态。当前接入的计算器仍仅为：

- `mace-mp-0b3-medium`
- `chgnet-0.3.0`
- `chgnet-r2scan`

原有结构导入、受控选势、单点、FIRE 优化、短程 MD 与 3D 报告保留在目录下方的计算面板。目录新增项不会被传入这些计算器。

## AI 和程序查询

本地 Pi 会话新增两个按需检索工具；没有向系统提示注入全目录，也没有启用 Pi 的全部宿主扩展。

```json
{"tool":"potential_search","args":{"query":"SevenNet","limit":5}}
```

`potential_search` 查询中英文名称、别名、描述、家族和已声明字段；返回目录版本、最多 10 项结果、证据和阻塞原因，可用 offset 继续查询。可使用 `elements`、`periodicity`、`requireForces` 硬过滤，**未知兼容性从约束查询排除**。返回值含 `executionAuthority: false`；真实导入结构的计算资格仍需 `materials_science select`。

```json
{"tool":"skill_search","args":{"query":"晶体","limit":8}}
```

`skill_search` 只查询本机已登记的 Skills，返回双语介绍、例子、启用/规划状态、来源与许可，最多 20 项。Skill 指令已安装不代表其科学环境已安装。它不是互联网搜索，也不下载安装外部 Skill。

桌面 IPC 对应 `searchPotentialCatalog`、`searchInstalledSkills`、`openPotentialSource`。打开来源仅接受目录中的受控 ID，URL 由主进程查表；不接受模型或 renderer 提供的任意来源 URL。

M6.7 的检索工具接入本地 Pi 会话。平台科学调度维持现有授权范围；完整跨平台自动选势/安装/分析编排将在 M6.9 实施。本阶段未调用外部收费模型。

## 目录合同与扩展方式

历史 `models/potentials/registry.json` 和旧任务合同保持冻结。新补充数据在 `models/potentials/catalog-m67.json`，通过 `buildPotentialCatalog` 映射原有 16 条并合并，页面与本地 AI 使用同一目录。

科学字段包含：能量/力/应力与单位、力和能量关系、元素/PBC/训练域、head/modal、电子态输入语义、电场、粒子语义、cutoff、长程与组合组件、理论参考、温压范围。执行字段包含受控 ID、历史关联、适配器/环境引用、空间/内存估计、平台和验证证据。未知为 `null`、`unknown` 或空列表，不能解释为无限制。

`fieldEvidence` 将已声明字段映射到同条记录的来源 ID；不允许悬空引用、虚构已验证平台或镜像重复资产身份。相同权重/执行配置的镜像作为同条记录的来源登记，不生成重复 checkpoint。不同 head、cutoff、粒子/电子态或组合组件可区分配置身份。SHA 校验只是身份依据，不能保证模型文件可安全执行或科学精度。

增加资源时：

1. 确认类型。只有可识别的具体参数包才归 checkpoint；系列、工具和性质模型分开登记。
2. 录入双语介绍、两条例子、限制、来源和覆盖名称。未核实来源保持 candidate，资产地址不猜测。
3. 仅对有证据的能力填值，绑定字段证据；其他保持未知，给出接入阶段和阻塞原因。
4. 更新目录发行 ID/整理时间，执行下面的合同与审计检查。新增 metadata 不产生执行权限。
5. 真正下载/安装需在 M6.8 审核资产与包合同；新计算器适配在 M6.10 等阶段单独验收。

## 创建 Skill 的预留合同

`UserSkillDraft` 定义名称、中英文描述/指令/例子、目录 ID 引用和受控工具依赖。`planUserSkill` 验证名称、Windows 保留名、内置名称冲突与资源引用，计算 `<name>/SKILL.md` 相对路径。

目标用户目录为 **`<MaterialsX userData>/skills`**，与内置目录分开；不能覆盖内置 Skill，不自动执行附带内容。M6.7 **只交付内容/目录合同与纯校验规划函数，不写入 Skill、不提供 Create Skill 按钮**；真实创建、预览、登记、版本与删除流程属 M6.9。

## 开发验证

```bash
npm run m67:contracts:check
npm run m67:audit
npm run check
npm test
npm run m6:ui:catalog
```

重新生成 JSON Schema 使用 `npm run m67:contracts`。修改旧冻结注册表不属于一般扩展方式。`m67:verify` 组合上述验收与旧注册表审计。UI 使用隔离的测试用户目录，不触碰开发者账户和科研输出。

后续：M6.8 泛化下载/环境/挂载并补两个可验收权重；M6.9 完成 AI 自动选势→必要安装→真实计算→3D/报告及 Skill 创建；M6.11 实现官方发布/论文增量发现。本阶段没有下载新权重，也未实现定时在线同步。
