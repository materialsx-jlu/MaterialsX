# Materials XYZ Ontology 2.0.0

这是面向“增强热塑性复合材料”的项目级数据标准，不宣称是已获行业组织认可的国际标准。它规定材料、工艺、结构、性能及其证据如何组织。规范性文件为本文件、`schema.json`、`vocabulary.json`；`extraction-prompt.md`用于驱动论文提取。

## 1. 记录单位与关系

一项研究一个主 JSON；论文和已提供的补充材料、实验记录分别注册 source。每个明确工艺组一条 record，保留 X、Y、Z 三层。允许一组多试件、多测试条件、多观测，不把每个性能值当独立实验。

```text
source ── evidence ── observation
                         │
material_system ── record ├── X：配方、上浆、路线、温压、冷却
                         ├── Y：孔隙、浸渍、结晶、取向、残余应力、界面
                         └── Z：刚度、强度、层间韧性、疲劳
protocol ─────────────── observation
relation ────────────── observation IDs → observation IDs
```

`record_id`是数据键，可以由提取器生成；不能冒充作者样品编号。论文身份、工艺组身份、批次身份、试件身份四级分开。`lineage.unit`为condition_group、batch或specimen；只有证据确认才使用后两者。`same_specimen_xyz=not_confirmed`是默认。相同配方与主温压条件不保证同批，应记录possible_duplicate_cluster并保留所有原始行。

X、Y、Z是不同对象集合，不能写成数值相等。候选结构方程是 Y=f₁(X,C,Uᵧ)，Z=f₂(X,Y,C,U𝓏)：允许X对Z存在直接或尚未测量的路径；C包括条件与上下文，U表示未观测因素。数据标准记录候选关系，不替研究设计作因果识别。

## 2. 固定结构与扩展

每条record必须含X的5类、Y的6类、Z的4类，即使全部缺失也保留类别。准确英文键及推荐指标见vocabulary.json。每类结构一致：

```json
{
  "status": "not_reported",
  "observations": [],
  "missing_fields": ["各工艺组结晶度"],
  "note": "只报告纯PEEK薄膜熔点，未报告该复合材料组结晶度。"
}
```

status分别为quantitative、qualitative、proxy_only、reported_setting、partial、not_reported、not_applicable、not_accessible、not_yet_extracted。它描述信息覆盖情况，不表示真实材料的好坏。已报告的数值0是有效值；未报告的指标不存在观测条目，在missing_fields中列出。实体属性如未知配比、未知牌号用null。只有草稿允许not_yet_extracted；完成提取不要求测量齐全，但要求每类都已审查。

新增指标使用`ext.`前缀与清晰definition，仍挂到对应类别。经审查后才能纳入下一版标准词表。不可把“金属、聚合物、复合材料”编码成有序数字；以实体及其组成表达。跨材料扩展应另设profile并检查哪些字段适用，本版不宣称覆盖所有材料物理规律。

## 3. 材料表达

material_system包含组成实体：matrix、reinforcement、filler、additive、sizing、coating、precursor、solvent等角色。每个组分具有名称、family、牌号、供应商、配比、属性与证据。配比必须带mass/volume/mole等基准和分母说明。未知配比保持null。没有密度及配比基准不得质量/体积互换。

尺寸、纤维形态、织物架构等放组分attributes。共同材料属性可由组关联引用，不必在每组重复写牌号。乙醇清洗属于工艺；若登记solvent组分，明确它是否留在最终材料。试验夹持片不进入材料配方。设计铺层和织物架构属于X；制造后的实际取向及波纹属于Y。

## 4. 每条观测的最小语义

每个observation必须给出：id、metric、label、value、raw、origin、measurement、state、acquisition、protocol_id、specimen_id、evidence_ids、inherited_from、normalization、derivation、uncertainty、qualifiers、note；不适用或未知的可空字段用null。

- value有kind、data、unit、basis。kind支持scalar、text、categorical、boolean、vector、tensor、series、schedule、image_reference。张量需shape、分量顺序和坐标系；曲线需各轴名称/单位和点列；工艺步骤有明确顺序、物理量单位及名义/实测标记，不伪造缺失时刻。
- raw保留原始数字、文字和单位，便于回溯。canonical stress/modulus用MPa，温度degC，时间min，长度mm，比例1，断裂能J/m2，循环数cycle。温度差和绝对温度转换必须说明；N/25mm不得直接转MPa。
- origin分别为reported、digitized、calculated、simulated、author_interpretation、model_hypothesis。后三类不得冒充直接实测。数字化、计算、模拟必须给derivation，包含方法和输入；模拟补充值不能计为真实实验样本。
- measurement分quantitative、qualitative、proxy、not_measurement；名义设定用acquisition=nominal_setting，实验测量用measured；缺失实际温压轨迹不得把程序图当传感器曲线。
- state为as_manufactured、post_failure、during_process、during_test、not_applicable、unknown。任何断后Y默认不进入加载前中介模型的输入。
- evidence逐条指向source_id、PDF物理页码、表格行列/图及子图/段落。excerpt_kind区分逐字引用、转述、图像观察。不能用“见论文”替代定位。
- 量化Y/Z要求protocol。测试标准、尺寸、方向、速率、温湿度、重复数及误差定义属于协议或观测qualifiers。协议详细参数中每个物理量必须保留单位；机器验证只能检查其中有限项目。
- “至少5次”记录minimum=5、exact=null。图中误差棒定义未知时uncertainty=null，不反推SD。

## 5. 科学语义的必守规则

| 情况 | 标准处理 |
|---|---|
| DSC只给纯树脂熔点 | 不生成复合材料组结晶度 |
| C-SAM颜色图或SEM孔洞 | 以proxy记录，未标定不得生成体积孔隙率 |
| 断后树脂覆盖、拔出、脱粘 | 保留post_failure；作为机制解释证据 |
| ILSS短梁强度 | Z.strength.ilss；不能填GIc/GIIc或微观IFSS |
| 上浆未提及 | not_reported；不能写“无上浆” |
| 相同工艺在多个表反复出现 | 保留每行，登记可能重复簇 |
| 表1与表4值不一致 | 保留各值和源定位，记录quality_issue |
| 同一SEM图用于浸渍和界面解释 | 共享证据ID，不算两项独立实验 |
| X和Z同时变化 | 可记录direct_XZ关联，不自动产生已验证f1/f2 |
| 无随机化、同批对应或中介干预 | 在relation.limitations和confounders中保留 |

## 6. 候选关系

relation引用观测ID，而非复制文字数值。layer为f1、f2、direct_XZ；kind为association、author_mechanism、model_hypothesis、reported_model。必须给比较组、已控制变量、可能混杂、限制和验证实验。reported_model还需model记录方程/算法、参数与适用域。

within_group仅允许一个record；across_group_comparison允许多个record，但两端工艺组要有对应，不能把A组的Y当成B组的输入。作者机制和大模型假设均不等于已识别因果。断后Y→Z只允许作为机制或假设表达，不能标成加载前中介关联。

## 7. 训练数据视图

原始标准JSON是证据主档。训练视图由工具从主档生成，不能反过来覆盖主档。

- 每个工艺组一行JSONL，保留事实ID、单位、数据类型、协议和source linkage。X/Y/Z仍是分层字段，不将文本直接编码成“1=好、0=差”。
- 连续量先统一物理单位；单篇不做min–max/z-score。训练/验证分组完成后，只在训练集拟合归一化参数，再应用于验证集。
- 按论文/数据来源、批次和可能重复簇防止泄漏。默认整篇文献使用同一split_group，禁止把重复基准分别放训练和验证。
- 任务可用性逐项标记：X→Z数值预测、X→Y定量预测、Y→Z预测、定量中介链。布尔标记仅表示存在候选字段，不保证样本量、模型可识别性或泛化能力。
- 完整Y缺失不妨碍某些X→Z监督学习；定性Y可用于另外定义的图文或分类任务，但必须有明确标签定义与标注依据。
- 单个T370记录不能估计f1/f2。多篇数据也需要材料、测试协议和条件的可比性审查。

## 8. 文件和验证

`schema.json`检查结构、必填键与枚举；`vocabulary.json`检查阶段、指标、物理单位及类型；`xyz_v2.py validate`还检查证据引用、组关联、缺项、断后Y、单位转换和ID唯一性。机器验证不检查图像真伪或原文含义，报告必须注明这一边界。

`template.json`是空文档，标记template，可通过结构检查，但完成态校验必须拒绝。`record-template.json`是单条记录片段，添加真实来源、实体和证据后才能放入主档。不得把模板占位符或未来计划的测量当作观测值。

版本采用MAJOR.MINOR.PATCH。本版从v1平面facts迁移到记录内嵌X/Y/Z，属于不兼容结构变更，因此为2.0.0。原始v1文件保留，可用迁移器生成新文件；迁移只转换已提取事实，不声称重新核查论文或补齐遗漏内容。

## 9. 直接使用

在本机对话中上传PDF，输入：

> 使用 $materials-xyz-extraction，按 Materials XYZ Ontology 2.0 提取这篇论文，生成 paper.xyz.v2.json、validation.v2.json 和 training.v2.jsonl。

在其他大模型环境中，附上PDF、ontology.md、schema.json、vocabulary.json和extraction-prompt.md。提取由大模型完成；附带Python工具负责结构校验、旧数据迁移和训练视图导出，不是独立的PDF语义提取模型。

独立文件包的命令如下，先在虚拟环境安装requirements.txt：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/xyz_v2.py validate examples/T370.xyz.v2.json --report validation.json
.venv/bin/python scripts/xyz_v2.py training examples/polymers-16-00897-v2.xyz.json --out training.jsonl
```

没有真实数据时只可对空模板执行`validate template.json --allow-incomplete`。默认校验会拒绝模板。这一选项仅用于编辑草稿，不能绕过训练导出检查。
