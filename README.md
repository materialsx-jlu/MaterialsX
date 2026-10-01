# MaterialsX

© 2026 吉林大学 AI-DAOS 团队

面向材料研究与研发工程师的本地 AI 工作台。以 [Pi](https://github.com/earendil-works/pi) 为 Agent 内核，连接材料 Skills、科学工具与数据服务，生成带证据的数据、图表、结构文件和研究报告。覆盖文献/通用分析、计算材料、高分子/复合材料三个方向。

**0.0.1 开发构建：M4 发布工程进行中，M5/M6 尚未实现，平台付费云模型暂未开放。** 自有代码采用 [AGPL-3.0-only](LICENSE)；第三方保留各自许可，发布前待核实事项见 [许可清单](THIRD_PARTY_LICENSES.md)。

## 界面

![MaterialsX 研究工作台](docs/images/workbench.png)

![Skills 分类与双语使用示例](docs/images/skills.png)

截图来自当前代码的隔离演示环境，不含用户真实研究文件、会话或凭据。界面支持深色与 Codex 浅色配色，可在设置中切换。

## 当前能力

- 本地项目、研究会话、SQLite 持久化、Pi 工具调用、流式回答与取消。
- 安全 Markdown、代码、表格和 KaTeX 数学公式显示。
- 默认内置 84 项 Skills：82 项固定版本的 [K-Dense Scientific Agent Skills](https://github.com/k-dense-ai/scientific-agent-skills) 与两项材料抽取 Skills。支持分类、中英文介绍、一至两条双语例子、输入框 `@` 选择。内置 Skill 定义不代表其所有可选科学依赖都已安装。
- `materials-literature-rpsme-json` 与 `materials-xyz-extraction` 随安装包携带 Python 3.12、JSON Schema、PDF 与图像依赖。RPSME 支持逐页证据、断点缓存、真实 JSON、中文摘要与校验报告。
- 100 项材料模型/评测条目的双语目录与例子；这是元数据，权重尚未预装，也不是使用量排行榜。
- LM Studio 本地模型接入、运行时诊断、发布中心和脱敏诊断导出。

## 安装与首次使用

GitHub 归属为 [materialsx-jlu](https://github.com/materialsx-jlu)，计划仓库为 `materialsx-jlu/MaterialsX`，公开下载地址待建立后补充，目前不提供已发布的下载链接。本地构建位于 `release/dist/`，或从源码打包。

| 系统 | 安装产物 | 验证情况 |
| --- | --- | --- |
| macOS Apple Silicon | `MaterialsX-0.0.1-mac-arm64.dmg` | 已构建并在 macOS arm64 启动；未签名、公证 |
| Windows 10/11 x64 | `MaterialsX-0.0.1-win-x64.exe` | 已交叉构建；Windows 实机安装/运行与签名待完成 |

macOS 打开 DMG，将应用拖入 Applications；Windows 使用 NSIS 安装向导选择目录。开发包可能受操作系统签名检查限制，优先从源码启动验证。当前没有已验证的 Intel macOS、Linux、Windows ARM 安装版。

首次运行：

1. 添加本地研究项目，创建研究任务。
2. 在 LM Studio 加载对话模型并启动本地 API 服务。
3. 打开 MaterialsX 设置，选择本地模型，填写 `http://localhost:1234/v1`，检测并选择模型。仅支持 loopback 端点。
4. 键入 `@` 选择 Skill，或从 Skills 详情复制例子到输入框，编辑后发送。

将下例路径替换为自己的合法本地文件：

```text
@materials-literature-rpsme-json 提取 /absolute/path/paper.pdf，输出带证据的 RPSME JSON、中文摘要和校验报告。
```

存储说明见 [M1](docs/m1/README.md)，抽取规则见 [本地 RPSME 流程](docs/m4/local-rpsme-workflow.md)。研究输出不要提交到仓库。

## 开发启动

建议 Node.js 24、npm、Python 3.12/uv；控制面另需 Go 1.25。在项目根目录执行：

```bash
npm ci
uv sync --project python --frozen
npm run dev
```

`dev` 打开 Electron 并启动 renderer 热更新。检查构建界面可运行：

```bash
npm run desktop:start
```

可选订阅/额度开发服务，在另一个终端启动：

```bash
npm run control-plane:dev
```

服务默认只监听 `127.0.0.1:8787`，开发账本和测试价格不是生产支付服务。

[`.env.example`](.env.example) 只有变量名和占位值，不能原样执行或作为可用配置。当前 Electron/Go 入口不自动加载根 `.env`，请通过进程环境设置所需变量。`ROOTFLOWAI_*` 是 M5 未来服务端契约，当前尚无消费者；`MP_API_KEY` 是可选数据源凭据。`MATERIALSX_PYTHON` 由受管工具流程设置，用户不能依靠它任意覆盖安装包解释器。真实云模型 Key 仅服务端保管，不进入 renderer、安装包或公开仓库；产品不提供云模型 BYOK。

## 检查与打包

```bash
npm run check
npm run test
npm run build
npm run control-plane:test
uv run --project python pytest
npm run skills:audit
npm run skills:accept
python3 scripts/check-public-secrets.py
```

完整开发验证为 `npm run verify`。运行时/求解器预检可能需要额外环境，见 [贡献指南](CONTRIBUTING.md)。正式发布必须另过 `npm run m4:release-gate`；当前阻断项尚未关闭，构建成功不能代替发布门槛。

```bash
npm run package:mac
npm run package:win
npm run skills:verify-bundle
```

macOS arm64 应在同架构 macOS 主机构建；Windows x64 须在 Windows 测试机完成最终验证。装配会联网下载 Python 和依赖，安装包不含 LM Studio 或聊天模型权重。发行前重新生成第三方清单、核查运行时版本、保留许可和对应源码、记录版本及哈希，见 [M4](docs/m4/README.md)。

## 当前限制

- 正式账号、云网关、真实支付、生产账本和自动续费尚未完成；订阅页为开发测试值。
- Skill 资源验收不能代表 84 项科学任务全部通过领域效果验证；复杂 PDF/OCR/表格与较弱模型仍可能失败。质量未过的产物须人工复核。
- 工具可读写文件、执行脚本；路径授权、子进程策略与提示注入防护仍需加固。renderer sandbox 不等于科学子进程已全面隔离。
- 双平台签名、Windows 实机、升级回退、三领域保留集和性能/故障验证仍阻断正式 v1。
- 通用机器学习势真实推理、权重管理、原子/分子交互式 3D 尚未实现。

## M5 / M6 路线图

| 阶段 | 计划交付 | 验收重点 | 状态 |
| --- | --- | --- | --- |
| M5：Token 与外部 API | 供应商卡片、服务端 RootFlowAI `gpt-5.6` 测试适配、流式网关、路由/取消、用量与额度结算、付费链路 | 真实模型与多步工具调用；断流补偿；usage 对账；供应商 Key 仅服务端 | 规划，未实现/未进行付费供应商测试 |
| M6：机器学习势与 3D | 模型注册表、兼容性硬门槛、可解释选势、ASE 本地任务、单点/优化/短程 MD、结构/轨迹 3D | 权重许可/哈希；元素/周期性/单位；真实产物；科学质量/资源预算 | 规划，未安装权重/未实现查看器 |

M6 可先实现注册表、任务合同和本地推理，不依赖 M5 付费网关；共有事件、产物和权限合同需保持兼容。后续按 [M5 开发计划](docs/M5_TOKEN_API_DEVELOPMENT_PLAN.md) 和 [M6 开发计划](docs/M6_ML_POTENTIALS_3D_DEVELOPMENT_PLAN.md) 的工作包与验收实施。

## 文档与参与

- [完整开发计划](docs/DEVELOPMENT_PLAN.md)、[开发状态](docs/STATUS.md)、[任务与验收清单](docs/BACKLOG.md)。
- [Skills 与 API/MCP](docs/INTEGRATIONS.md)、[模型目录来源](docs/MODEL_CATALOG.md)。
- [M0](docs/m0/README.md)、[M1](docs/m1/README.md)、[M2](docs/m2/README.md)、[M3](docs/m3/README.md)、[M4](docs/m4/README.md)。
- [贡献与测试](CONTRIBUTING.md)、[安全报告](SECURITY.md)、[许可证](LICENSE)、[第三方许可](THIRD_PARTY_LICENSES.md)。

安全问题请私下发送至 [huzhangyou@jlu.edu.cn](mailto:huzhangyou@jlu.edu.cn)，报告要求见 [SECURITY.md](SECURITY.md)。团队代码和自研 Skills 已确认获开源授权；示例数据公开权利仍待确认。开源程序和自有文档不授予用户研究数据、供应商服务或模型权重的访问权。
