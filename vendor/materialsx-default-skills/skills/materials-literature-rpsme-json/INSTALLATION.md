# 材料论文抽取 Skill

输入一篇研究工作的正文 PDF；可同时附多个属于同一论文的 Supporting Information、附录或数据说明 PDF。正文没有的实验条件会明确标记，SI 中的表格、显微图和模拟图会按独立 `document_id` 追溯。

在新会话中调用：

```text
$materials-literature-rpsme-json /绝对路径/论文正文.pdf /绝对路径/SI.pdf /绝对路径/补充数据.pdf
```

也可以一次上传多个 PDF 附件后指定本 Skill，并说明哪一个是正文。Skill 会先校验这些文件是否属于同一 DOI/题名，再输出 `*.rpsme.v2.json`、`*.summary.md` 和 `*.validation.json`。没有可绑定文件时输出 JSON-only；有合法且能与 Figure/Panel 或模拟运行绑定的文件时，额外输出一个独立的 `*.rpsme.bundle.zip` 图片/资产包。此时请在 Materials Ontology OS 的同一次上传操作中同时选择 JSON 和 ZIP；两者由 Skill 从同一个资产化本体生成并通过哈希配对。ZIP 内保留相同本体与 manifest 是系统完整性校验所需，不代表重复数据。平台负责查重和双审，Skill 不自动入库。

## 安装到其他机器

当前下载版本为 1.7.1：在下述 P0 基础上新增标定式图表数字化、PubChem/ChEBI 与可选 MP/CSD 身份连接器、本地批处理队列、人工纠错台账和训练数据导出。详见 references/advanced-extraction-p1.md。通用功能不需要新依赖；MP/CSD 使用各自可选客户端、凭据或许可，不随包附带。批处理由宿主实际执行抽取，并非安装后自动运行的爬虫；没有自动训练模型或改写数据库。

解压后目录应为 `materials-literature-rpsme-json/SKILL.md`。Codex 放入用户 `.codex/skills/`；Claude Code 放入 `.claude/skills/` 或项目 `.claude/skills/`，然后重新打开会话。也可让助手直接读取解压目录的 SKILL.md 执行。1.6.0 下载包新增原文证据自检与复核门禁、HTML/JATS/PDF 表格候选解析、外部表格引擎通用导入接口、版面/OCR 诊断与离线评测工具。保留 1.5.0 材料身份候选契约、Ontology 1.3/1.4、研究方向、Bundle 以及原文覆盖核查，不需要专利 Skill 或项目源码。接收系统自动建立身份候选、DOI 与组成证据关联；未核验标识符不会自动成为已验证身份。外部专用表格引擎和专家标注论文集不随包附带。

使用 Python 3.10+ 安装 requirements.txt，并运行 scripts/check_environment.py；可用已有兼容环境或独立虚拟环境。无需在 Skill 中配置 OpenAI API key；抽取使用宿主模型。可选安装本地 Tesseract 及所需语言包；没有可用 OCR 时使用宿主能力或明确保留待处理项。1.6.0 最终校验需要原文准备清单与实际完成的复核记录，详情见 references/extraction-quality-p0.md。模型复核和软件测试均不代表专家验证。

## 维护

论文规则在 references/literature-extraction.md；配比、表征资产、仪器归一和模拟复现分别在对应 reference 文件。项目 scripts/publish_literature_skill.py 同步公共 Schema/校验模块，安装本地 Skill 并生成可复现下载 ZIP。公共契约变更后重新校验和发布。下载包是自包含快照，不会在他人机器自动更新。
