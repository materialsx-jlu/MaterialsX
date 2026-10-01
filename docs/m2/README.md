# M2 科学 Alpha

M2 从一条真实的本地模型链路和统一材料证据结构开始。当前实现不把“模型可回答”视为科学工作流完成；后续产物仍需确定性工具、来源定位和人工审阅共同约束。

## LM Studio

已验证的本机配置：

```text
Endpoint: http://localhost:1234/v1
Chat model: google/gemma-4-e4b
Protocol: OpenAI-compatible chat completions
Runtime: Pi Agent / openai-completions adapter
```

在桌面端打开“设置”，选择“本地模型”，填写端点并点击“检测本地模型”。Embedding 模型会显示但不能作为对话模型选择。保存后，研究任务经 Pi 发送到本机端点，回复和运行状态写入 SQLite；Pi transcript 单独保存在 MaterialsX 用户数据目录。

命令行真实探针：

```bash
npm run lmstudio:probe
```

该命令需要 LM Studio 已启动并加载 `google/gemma-4-e4b`。

## MaterialsDataset 1.0

schema 位于 `packages/materials-schema/src/index.ts`，当前记录：

- 样品 ID、名称和别名；
- 组成数值及质量/体积/摩尔百分比、phr 或绝对量基准；
- 有序工艺步骤和参数；
- 性能数值、单位、条件和不确定性类型；
- 原始文件 URI、SHA-256、页码、表格、行和引用片段；
- 未报告、不可用、无法辨认、来源冲突和提取失败；
- extractor、reviewer 和 system 修订记录。

所有组成、工艺和测量条目都要求至少一条证据。百分比组成合计超过 100 会被拒绝。

## 下一条纵向切片

下一步实现：导入材料 CSV → 原件哈希与只读登记 → 单位/重复样检查 → 统计与图表 → MaterialsDataset 映射 → 报告及 CSV/JSON 导出。随后接入 PDF 样品级证据提取、结构文件和计算材料工作流。
