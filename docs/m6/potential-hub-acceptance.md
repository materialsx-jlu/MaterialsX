# M6.7 工程验收

日期：2026-10-02  
© 2026 吉林大学 AI-DAOS 团队

## 验收范围与结果

| 项目 | 结果与证据 |
| --- | --- |
| 目录与覆盖 | 173 条资源、194 条名称映射；20 checkpoint、69 family、45 architecture，相关资源分开统计 |
| 历史兼容 | 冻结 16 条注册表保留，旧权重 URL/revision/SHA/bytes 原样映射；原执行枚举仍只有 3 项 |
| 合同 | 5 份 M6.7 JSON Schema；拒绝未知证据、重复 ID/相同权重配置镜像、越界查询、注入代码/URL与错误资产身份 |
| 科学匹配边界 | 元素/PBC/力硬过滤排除未知；性质模型和粗粒化研究条目不会被赋予现有全原子计算资格 |
| 双语搜索 | 名称、别名、领域词与描述；分页、空结果；`pacemaker`、中文电解液等查询通过 |
| Skill 搜索/创建合同 | 查询真实内置 Skill 索引；拒绝创建内容中的路径逃逸、内置名称覆盖、无效资源 ID、平台保留名 |
| Pi SDK 装配 | 两个真实工具可按需执行本机元数据查询；工具返回明确无执行授权，未开放远程安装或任意扩展 |
| 真实 Electron | bootstrap/IPC、分页/家族/类型/状态筛选、双语详情、示例复制、受控来源打开与错误 ID 拒绝通过 |
| 共用视觉 | Skills 同类卡片/详情/例子/全局深色与 Codex 浅色；查看器截图复核，850×820 窄窗口布局探针通过 |
| TypeScript 与构建 | core/desktop/admin 类型检查通过；桌面主进程与 renderer 构建通过 |
| 测试 | 全套 Node 测试 131 项：130 通过，1 项原有跳过，无失败 |

窄窗口探针临时降低测试 BrowserWindow 最小宽度以检验响应布局，不改变应用现有最小窗口约束。旧 M6.1–M6.6 UI 脚本改用稳定的“机器学习势”入口名称；M6.0 目录 UI 验收入口复用当前 M6.7 场景，并在其中检查冻结 16 条、原 100 研究模型、91 Skills 与固定来源链接。本轮未重复执行全部旧阶段的耗时 CPU/Electron 场景；相关合同与 Node 测试已回归。

## 可复查证据

- `runtime/m6/verification/m67-catalog.json`：统计、目录补充文件哈希与历史注册表哈希。
- `runtime/m6/ui/m67/catalog-ui.json`：真实桌面交互回执。
- `runtime/m6/ui/m67/catalog-dark-details.png`、`catalog-light-details.png`、`catalog-light-narrow.png`：实际窗口截图。
- `packages/atomistic/src/potential-hub.test.ts`、`packages/pi-adapter/src/catalog-tools.test.ts`：匹配/证据/兼容/工具与 Skill 合同检查。

运行时证据和截图保留在本机忽略目录，不伪造为所有用户的科学验证。源码/schema/目录数据及本说明随仓库可复查。

## 本阶段没有宣告完成的功能

广目录采用候选与未知字段，不等于所有名称已逐项核验许可或具体公开权重。此阶段没有新增下载、新 Python/Torch 环境、真实供应商推理、支付、Windows 实机测试或独立 DFT 精度评测。现有 `needs_review` 科学质量不变。

通用下载/安装与至少 5 个 checkpoint 的真实运行证据归 M6.8；完整自动分析与创建 Skill 归 M6.9；网络/论文增量发现归 M6.11。M6.7 的工程完成不代表上述阶段或完整发布门槛已完成。
