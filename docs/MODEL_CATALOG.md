# MaterialsX 材料模型目录（2026-09-30）

MaterialsX 默认内置 100 个材料模型与评测条目的**元数据**，分为原子尺度与势函数、材料性质预测、材料对话模型、晶体结构生成、材料语言基座、文献文本编码六类。每项包含中英文简介、两个中英文任务示例、来源链接和权重许可字段。Skills 另按十二类展示。

该目录**不是“全网使用最多的 100 个模型”排名**。材料科学模型分布在不同仓库和评测平台，公开数据没有一致的跨平台使用量口径。目录以可核查来源和任务覆盖为选择原则：

- [Matbench Discovery](https://github.com/janosh/matbench-discovery) 的 65 个模型评测条目（固定提交 `71633e8bdfdfd41d56d64b1d777e5686d9eda3ec`）。这是性能评测，而非使用量统计。
- [Matbench](https://github.com/materialsproject/matbench) 的 27 个材料性质预测提交（固定提交 `936176db18ca4cd7b38cbd957c017a5bac770c`；排除 `dummy` 基线）。提交不一定提供可分发权重。
- 原作者发布的六个 [LLaMat](https://huggingface.co/collections/m3rg-iitd/llamat) 版本，以及 [MatSciBERT](https://huggingface.co/m3rg-iitd/matscibert) 和 [BatteryBERT](https://huggingface.co/batterydata/batterybert-uncased)。BERT 模型是编码器，不能作为聊天模型使用。

模型目录只内置元数据，**不代表模型权重已安装、已加载或可在 MaterialsX 中直接推理**。当前 MaterialsX 的对话运行时通过本地 OpenAI 兼容接口连接模型；势函数、性质预测和文本编码模型各需要相应的专用运行时、依赖与验证。部分条目还需要单独取得权重、授权或访问资格。应用界面始终将这些条目标为“目录收录”，并给出原始来源供核查。

本机在清理 Gemma 后约有 15 GiB 可用空间，不足以容纳这 100 份权重。安装器因此不会在安装过程中静默下载权重。要刷新目录，可运行 `python3 scripts/sync-materials-model-catalog.py`，更新前应重新核查来源版本、许可和各模型运行条件。

## M6.0 具体权重注册表（2026-10-01）

在原 100 项目录之外，新增 `models/potentials/registry.json`：7 个家族、16 个具体 checkpoint，核心候选为 MACE-MP-0b3 medium 与 CHGNet 0.3.0，已核实两份官方权重摘要。应用在“模型目录 → 机器学习势 · Checkpoints”显示双语详情、家族、两个例子、固定来源及许可/设备矩阵。所有权重仍未安装、运行和领域验证未通过。两目录存在来源关联，不把新的 16 项加算成去重后的 116 个模型，也不改变原先排名说明。更新旧目录的同步脚本不会覆盖这个独立注册表；修改须按 [M6.0 冻结流程](m6/README.md) 审查。
