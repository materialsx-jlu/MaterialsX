# 第三方许可清单

© 2026 吉林大学 AI-DAOS 团队

审核记录日期：2026-10-02。自有代码与自研 Skills 已获团队开源授权，采用 **AGPL-3.0-only**。上游内容不因根 LICENSE 而改变许可。下列是依赖声明与本机资源核对结果，**不是全部第三方已完成法律审核的证明**。

## 快照与复现

执行 `python3 scripts/generate-third-party-inventory.py` 生成以下清单，升级依赖、同步 Skills、重新装配 Python 运行时后必须重做并人工复核：

- [npm 完整锁文件清单](docs/third-party/npm-dependencies.json)：718 个路径条目，含传递、开发和平台可选依赖；记录版本、声明、来源、integrity、可用许可文件哈希。不同路径不代表不同组件数量，也不是安装包最终 SBOM。
- [Python 依赖快照](docs/third-party/python-dependencies.json)：开发环境和 macOS arm64/Windows x64/Linux x64 内置运行时；记录版本、METADATA/许可文件哈希。某平台不存在时明确标记 unavailable，不从另一平台推断。
- [82 项上游 Skills 的逐项声明](docs/third-party/skills-licenses.json)：固定提交、定义哈希和声明原文。Skill 中的软件许可声明可能指其工具包，不能代替所有脚本、参考和依赖审核。

Node 版本来自 `package-lock.json`；Python 实际版本来自本地 dist-info。PDF Python 构建脚本锁定直接依赖版本，实际平台文件另由受管运行时清单校验；CPython 构建、传递依赖和二进制仍须按本版清单复核，不能仅凭 `python/uv.lock` 声称安装包依赖已全部固定。

## 直接 JavaScript 依赖

| 组件 | 版本 | 声明许可 | 用途/来源 |
| --- | --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 0.99.1 | MIT | Pi Agent；[上游](https://github.com/earendil-works/pi) |
| `@modelcontextprotocol/sdk` | 1.31.0 | MIT | MCP 客户端；[上游](https://github.com/modelcontextprotocol/typescript-sdk) |
| `@lucide/vue` | 1.49.0 | ISC | 图标；[上游](https://github.com/lucide-icons/lucide) |
| `3dmol` | 2.5.5 | BSD-3-Clause | 本地原子结构查看器；[许可原文](docs/third-party/3DMOL_LICENSE.txt)，传递依赖与打包许可须一并保留 |
| `vue` | 3.5.43 | MIT | renderer；[上游](https://github.com/vuejs/core) |
| `pinia` | 4.0.3 | MIT | 状态；[上游](https://github.com/vuejs/pinia) |
| `element-plus` | 2.14.6 | MIT | UI；[上游](https://github.com/element-plus/element-plus) |
| `dompurify` | 3.4.16 | MPL-2.0 OR Apache-2.0 | HTML 清理；[上游](https://github.com/cure53/DOMPurify)；当前按 Apache-2.0 路线保留许可/NOTICE |
| `katex` | 0.18.9 | MIT | 公式与字体；[上游](https://github.com/KaTeX/KaTeX)；发行须复核随附字体许可 |
| `markdown-it` | 15.0.2 | MIT | Markdown；[上游](https://github.com/markdown-it/markdown-it) |
| `markdown-it-texmath` | 1.0.0 | MIT | 数学扩展；[上游](https://github.com/goessner/markdown-it-texmath) |
| `zod` | 4.6.5 | MIT | 合同验证；[上游](https://github.com/colinhacks/zod) |

直接开发依赖（也可能包含发行运行时）如下；完整传递项见 JSON：

| 组件 | 版本 | 声明许可 |
| --- | --- | --- |
| Electron | 44.5.0 | MIT；Chromium 与原生组件另有许可 |
| electron-builder | 26.15.3 | MIT；NSIS/打包工具另行核查 |
| TypeScript | 5.9.3 | Apache-2.0 |
| Vite / plugin-vue | 8.3.1 / 6.0.9 | MIT |
| vue-tsc / tsx / esbuild | 3.3.11 / 4.23.15 / 0.28.2 | MIT |
| concurrently / cross-env / wait-on | 10.0.5 / 10.1.0 / 9.5.1 | MIT |
| @types/node / @types/markdown-it | 26.6.3 / 14.2.0 | MIT |

目前 npm 锁文件 718 项中有 718 项声明 license 字段；仅此不能说明其所有原生二进制、字体和子依赖的通知均已完整收集。未安装平台的许可文件标为待复核。Electron 安装包须保留 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`。

## Python 与原生运行时

| 组件 | 本机版本 | 声明许可 | 范围/处理 |
| --- | --- | --- | --- |
| CPython | macOS 3.12 系列 / Windows 3.12.10 | PSF 及其内附第三方许可 | 安装包；保留完整 LICENSE，核查 OpenSSL 等原生组件与 python-build-standalone 构建材料 |
| PyMuPDF / MuPDF | PyMuPDF 1.28.2 | AGPL / Artifex 商业双重许可 | 两平台安装包；当前选择开源 AGPL 路线，发行前提供准确版本对应源码与通知；[官方说明](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright) |
| Pillow | 12.3.0 | MIT-CMU 与内附编解码库许可 | 两平台安装包；核对 libjpeg/zlib 等 notices |
| jsonschema | 4.26.0 | MIT | 两平台安装包 |
| attrs / jsonschema-specifications / referencing / rpds-py | 26.1.0 / 2025.9.1 / 0.37.0 / 2026.6.3 | MIT | 两平台安装包；Rust/native wheel 内附许可仍需复核 |
| typing_extensions | 4.16.0 | PSF-2.0 | 两平台安装包 |
| pip | 26.0 | MIT 与 vendored 依赖许可 | 本机 macOS 运行时存在，Windows 快照未含 |
| ASE | 3.29.0 | LGPL-2.1-or-later | 项目开发 Python 环境，非当前核心内置运行时 |
| pdfplumber / pdfminer.six | 0.11.10 / 20260107 | MIT | 开发环境 |
| pypdf | 6.19.0 | BSD-3-Clause | 开发环境 |
| pypdfium2 / PDFium | 5.13.0 | BSD-3-Clause、Apache-2.0 和 PDFium 依赖许可 | 开发环境；保留完整依赖通知 |
| ReportLab | 4.5.1 | BSD（以包内 license.txt 为准） | 开发环境 |
| NumPy | 2.5.3 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | 开发环境；wheel 原生库有独立条款 |
| SciPy / Matplotlib | 1.18.1 / 3.11.2 | 包内完整多组件许可 / Matplotlib 许可 | 开发环境；不能只摘首行归类为单一 BSD |
| pytest | 9.1.1 | MIT | 仅开发测试 |

Python 的完整传递依赖和许可文本位置见快照 JSON；以上没有授予外部科学软件、模型或数据库的使用权。M5.4 新增微信官方 APIv3 Go SDK `github.com/wechatpay-apiv3/wechatpay-go v0.2.21`，采用 Apache-2.0，腾讯版权和原始许可已保留在 Go 通知文件。微信支付是外部商户服务，SDK 许可不授予商户资质或服务使用权。Go 身份服务新增固定模块：`pgx/v5 v5.7.6`、`pgpassfile v1.0.0`、`pgservicefile v0.0.0-20240606120523-5a60cdf6a761`、`puddle/v2 v2.2.2` 为 MIT；`golang.org/x/crypto v0.41.0`、`x/sync v0.16.0`、`x/sys v0.35.0`、`x/text v0.28.0` 为 BSD-3-Clause。准确服务构建依赖与许可哈希见 [Go 清单](docs/third-party/go-dependencies.json)，原始许可全文见 [GO_LICENSES.txt](docs/third-party/GO_LICENSES.txt)，用 `python3 scripts/generate-go-inventory.py` 复现。微信商户私有 YAML 读取新增固定 `gopkg.in/yaml.v3 v3.0.1`，其源文件分别采用 MIT 与 Apache-2.0，完整原始许可已纳入 Go 通知文件。Go 工具链不是项目自有代码；PostgreSQL 为独立部署依赖，采用 PostgreSQL License，当前不随桌面安装包内置。uv、Git、Tesseract、LAMMPS、Quantum ESPRESSO、Rosetta、Docker、LM Studio 是构建/可选外部环境，不能当作已随程序再分发或被根 LICENSE 覆盖。

## Skills、模型与示例

导出的项目标志位于 `assets/brand/`，沿用 `@lucide/vue@1.49.0` 的 Atom 几何；SVG 保留 ISC 归属，完整通知另存于 [assets/brand/LUCIDE_LICENSE.txt](assets/brand/LUCIDE_LICENSE.txt)。PNG 为同一矢量资源的高清导出。

[K-Dense](https://github.com/k-dense-ai/scientific-agent-skills) 快照固定为 `65d6e786832e2c52832713117bbbf5096b56f77f`，保留 [MIT 原文](vendor/kdense-scientific-agent-skills/LICENSE.md) 和 `Copyright (c) 2025 K-Dense Inc.`。82 项 Skill 的定义许可逐项记录，安装额外包或访问 API 必须另行满足其条款。

M6.4 新增七项团队编写的原子模拟任务 Skill 定义（见 `skills/atomistic-m64.json`），按 AGPL-3.0-only 分发；未新增第三方权重或 Python 依赖，不将 MD 规划说明当作执行器。原 75 个自研抽取 Skill 文件哈希保持不变，新 manifest 共 9 Skills / 82 文件。

自研 `materials-literature-rpsme-json`、`materials-xyz-extraction` 的团队代码已获授权，按项目 AGPL-3.0-only 分发；快照定义/脚本未因版权换名而改写，以保留原哈希验收。

**以下两份论文抽取示例的公开/再分发权利待确认，尚不能作为已审核资产发布：**

- `vendor/materialsx-default-skills/skills/materials-xyz-extraction/examples/polymers-16-00897-v1.xyz.json`
- `vendor/materialsx-default-skills/skills/materials-xyz-extraction/examples/polymers-16-00897-v2.xyz.json`

上述文件保留用于现有本地验收；维护者确认原文许可、抽取事实/引用/图表的权利与归属后，记录结论，或以合成示例替换并更新哈希及测试。根 AGPL 不替原论文授权。K-Dense 上游示例/图片也需按上游与具体数据来源复核。

`models/catalog.json` 当前仅含目录元数据及来源链接，没有势函数或聊天模型权重。Matbench/Matbench Discovery、LLaMat、MatSciBERT、BatteryBERT 等的目录、代码、权重和数据许可分别审查。M6.0 已新增 [具体 checkpoint 矩阵](docs/m6/candidate-matrix.md) 和 `models/potentials/source-lock.json`，锁定来源及两核心权重身份；随文档保留 MACE/MACE-foundations MIT、CHGNet BSD-LBNL 原始许可于 `docs/m6/licenses/`。M6.0 当时未引入权重或 MLIP 运行依赖；M6.1 已构建本机两核心隔离运行时，正式安装包发行前须按最终文件/环境补充源码、完整通知与平台核验。ASL 标记及 UMA 授权不视为已获默认包再分发权。新增几何样本由团队构造，AGPL-3.0-only，不涉及待核实论文数据。

## 公开发行前仍须完成

1. 两份自研 Skill 论文示例及上游示例资产权利复核。
2. 在两目标平台按准确安装包重新采集最终依赖/notice；检查 Chromium、字体、Python 原生库、NSIS，必要时补充完整通知文本。
3. 对 AGPL/LGPL/MPL 等依赖逐项记录源码、修改、替换/重新链接和网络服务义务的处理方式；提供发行对应源码和可复现构建材料。上游 URL 不是所有义务都已满足的证明。
4. 补齐计划仓库 `materialsx-jlu/MaterialsX` 的版本源码标签/下载入口；安全报告邮箱已确认为 `huzhangyou@jlu.edu.cn`。不能用现有本地包的成功构建冒充已完成公开发行审核。

本地微信付款二维码使用 `qrcode@1.5.4`（MIT），完整声明保留在 [QRCODE_LICENSE.txt](docs/third-party/QRCODE_LICENSE.txt)，其依赖及类型声明列入 npm 许可清单；付款 URL 不上传到二维码服务。
## M6.1 计算运行时补充

两套 MLIP 环境的完整依赖与平台下载哈希位于 `atomistic/environments/{mace,chgnet}/uv.lock`；源码 revision 与权重身份继承 M6.0 的锁。构建会在各运行时的 `licenses/dependencies/` 保存实际分发包版本、声明许可、许可文件摘要和原始 LICENSE/NOTICE 文件；PyTorch 等内嵌库通知随 site-packages 保留。核心权重通知见 `docs/m6/licenses/`，本机快照见 `docs/m6/evidence/*-dependencies.json`。默认启用 legacy Python CHGNet graph converter 不改变上游许可。安装/工程测试不等于最终发行许可与签名审核，参考 [M6.1 文档](docs/m6/runtime.md)。

M6.5 复用已有、冻结的 ASE 3.26.0 / NumPy / psutil 和两个核心势隔离环境，调用 VelocityVerlet、Langevin 与速度初始化；未增加第三方模型权重或运行时依赖。默认 `materials-mlip-md` 是团队 AGPL-3.0-only Skill，由规划说明升级为执行指南；原抽取 Skills 的 75 文件条目未更改。

M6.6 额外收录 CHGNet r2SCAN checkpoint，沿用固定官方 CHGNet revision 的 BSD-3-Clause-LBNL 通知，保留 `docs/m6/licenses/chgnet-LICENSE.txt` 与 `chgnet-r2scan-README.md`；源码、README/许可、权重 SHA/大小锁在 `models/potentials/extensions-m66.json`。复用已有锁定 CHGNet 环境，无新增第三方 Python 包。默认离线打包权重必须保持许可通知与身份摘要，不因本机成功而免除最终发行源码/依赖/数据权利审查。格式示例仅团队构造几何和明确合成零标签，不含未经授权论文/DFT 数据；真实保留集需另行确认来源许可、重叠和理论匹配，见 [M6.6 文档](docs/m6/validation.md)。

M6.8 按需收录 MACE-MP-0b2 small 与 MACE-MPA-0 medium，沿用固定 MACE 源码与基础权重 MIT 通知，保存 `mace-LICENSE.txt` / `mace-foundations-LICENSE.txt`。来源、SHA-256、大小、依赖锁和通知哈希在 `models/potentials/packages-m68.json`；安装目录携带 NOTICE 与身份记录。复用已有 MACE/CHGNet 环境，没有新增第三方 Python 依赖。M6.9 新 Skill 创建指导及受控工作流代码为团队 AGPL-3.0-only；用户 Skill 为用户提供的指令，不能据此转授上游权利。原自研抽取文件不变，默认 manifest 现为 10 个团队 Skill / 83 文件，总内置目录为 92 Skills。

## M6.10 SevenNet 独立环境与候选补充

SevenNet 源码与随库 SevenNet-0 11July2024 checkpoint 采用固定 revision `8d9905cc4f4b7ca93be02b37a263785add53c759` 的 MIT 许可。原文和模型 README 保存于 [SevenNet LICENSE](docs/m6/licenses/sevennet-LICENSE.txt)、[模型 README](docs/m6/licenses/sevennet-0-README.md)；下载包携带这些通知，SHA/字节数与来源在 `models/potentials/adapters-m610.json`。权重按需下载，不将四个尚未适配的 Nano 权重放入安装包；Nano 元数据补齐不等于代码、权重或数据许可已全部审核。

新环境依赖锁为 `atomistic/environments/sevennet/uv.lock`，复用旧模型时不升级其依赖。实际分发环境版本、声明与许可文件哈希见 [SevenNet 依赖快照](docs/m6/evidence/sevennet-dependencies.json)；构建环境保留 `licenses/dependencies/` 原始通知及 CPython/PyTorch 内嵌许可证。SevenNet、e3nn、torch-geometric 的 MIT 声明不代表整个环境都为 MIT：matscipy 包含 LGPL-2.1 文本，传递依赖 phonemizer-fork 声明 GPLv3+，其他依赖以实际快照及原文为准。公开发行前仍须按最终安装包核实对应源码、修改/链接义务及完整第三方通知；工程验收不代替这项审核。

## M6.11 公开元数据发现与目录发布

新增发现 Skill、采集/审核/签名代码为团队 AGPL-3.0-only；使用已有 Node 加密和现有依赖，没有增加 Python 运行环境或下载权重。默认 manifest 当前为 11 个团队 Skill / 84 文件，总内置目录为 93 Skills。公开 GitHub 发布说明、arXiv 元数据、Hugging Face / OpenKIM / NIST 入口各自保留上游权利，不由本项目 AGPL 再授权；完整原始响应存于忽略的本机采集缓存，公开证据仅含统计/URL/时间及工程回执。双语模板与元数据审核不代替权重、训练数据或再分发许可审核；新候选保持未知能力/许可与不可执行状态。详见 [发现与发布边界](docs/m6/discovery-updates.md)。

## M6.13 ANI-2x 分子环境

TorchANI 2.7.5 源码采用 MIT，原文保留于 [TorchANI LICENSE](docs/m6/licenses/torchani-LICENSE.txt)，固定 revision `9ea5bc29cf635f89b3f593e590e5ab47e54c06d4`。ANI-2x state dict 来自官方作者 Hugging Face 仓库 `roitberg-group/ani2x`，revision `019ca2cfc20b749cba91dfdbffac2ce2aafa4a43`；上游模型卡声明 MIT，原始声明保留于 [模型卡](docs/m6/licenses/ani2x-model-card.md)。代码/权重的身份、字节数、通知 SHA 和来源分别固定在 `models/potentials/molecules-m613.json`；导出/安装带通知。训练数据未随本项目分发，其权利不由代码或权重许可推定。

新增 `atomistic/environments/ani/uv.lock`，隔离已有晶体环境；实际分发依赖及通知哈希见 [ANI 依赖摘要](docs/m6/evidence/ani-dependencies.json)。环境还包含 CPython、PyTorch、ASE 及传递依赖：ASE 保留 LGPL 通知，phonemizer-fork 声明 GPLv3+，不将整个 Python 环境归为 MIT。原始通知保存在运行环境 `licenses/dependencies/` 和各包中；公开发行前仍须按最终包审核源码供应、修改/替换/链接义务和内嵌原生库许可，根 AGPL 不替第三方授权。本轮更新五项既有团队 Skill 范围，仍为 11 项团队 Skill / 84 文件，全部默认 93 Skills。详见 [M6.13 分发与验收边界](docs/m6/molecular-potentials.md)。

## M6.14 NEP_CPU 原生引擎与硅参数文件

- NEP_CPU v1.4，revision `43b2ee64dd03e7e880cd343582b0de31b715c222`：[官方项目](https://github.com/brucefan1983/NEP_CPU)，上游源码头声明 **GPL-3.0-or-later**。所需源码未经修改置于 `vendor/nep-cpu/`，原许可证保留为 `vendor/nep-cpu/LICENSE` 和 `docs/m6/licenses/nep-cpu-LICENSE.txt`。原生构建的所有输入哈希记录于 `models/potentials/native-m614.json`；本项目包装器 `atomistic/nep_runner.cpp` 为团队 AGPL-3.0-only 代码。
- `Si_2022_NEP4_3body.txt`，50,446 bytes，SHA `ad5c2c273a95684d2b19b5b26295b2914e6412a2fe2c377e09ece399b7fa22ca`：[GPUMD 固定 revision](https://github.com/brucefan1983/GPUMD/tree/87c1cf22401ac8c791adda0879e0af704dd5f981)。依据该仓库根 `LICENCE` 按 **GPL-3.0-only** 保留；相应通知为 `docs/m6/licenses/gpumd-LICENCE.txt`，旧版本文件名说明保存于 `nep-si-README.md`。引擎和模型的许可来源分别记录，不推断更宽松的权重许可；训练数据未分发，其独立许可尚未审核。
- 使用既有 CHGNet 锁定环境中的 Python、NumPy、ASE 作为调用层，无新增重型 Python 环境；相应依赖继续遵守原清单。仅 macOS arm64 CPU 编译与执行已验收，不将 Linux/Windows/GPU 标为已验证。

对应源码、团队包装器和许可证已纳入发行资源/离线清单；最终公开发行前仍须按最终二进制包核对 GPL/AGPL 对应源码供应、构建说明、通知及可替换/链接等适用义务。本次未重建或签名安装包。范围与证据见 [原生势交付](docs/m6/native-potentials.md)。

## M6.15 固定组合势

复用 MIT 的 MACE 代码/基础权重与 M6.14 GPL-3.0-or-later 的 NEP_CPU D3 源码（未经修改）；不会新增 NEP 学习权重。`atomistic/d3_runner.cpp`、`atomistic/composed.py` 为团队 AGPL-3.0-only 包装/组合代码。原有通知继续保留，`models/potentials/physics-m615.json` 保存所有编译来源/通知哈希。组合 profile 不是另一个训练 checkpoint，不改变基线权重许可或授予其他上游模型许可。新增 native D3 二进制分发必须携带对应源码、编译脚本、profile 和许可；依赖 GPL 源码的完整对应源码供应要求仍适用。详见 [组合势交付](docs/m6/advanced-physics.md)。

## UA.1 公开 Codex 运行时

固定生产依赖 `@openai/codex@0.160.0`（Apache-2.0）与其平台可选二进制供 app-server 使用；已保存该公开版本的 [LICENSE](docs/third-party/codex/LICENSE) 与 [NOTICE](docs/third-party/codex/NOTICE)，随第三方文档打包。打包 hooks 将整个目标平台 vendor 资源及其内嵌库/许可复制至 MaterialsX 专属 `Resources/agent-runtime/codex`，原 node_modules 中的运行时文件从 app.asar 排除；不使用全局 Codex。UA.0 重复隔离副本已删除，开发探针改用同一依赖；历史协议报告保留。

npm inventory 已重新生成，不能代替原生二进制内嵌组件的完整分发审核。此次验收仅 macOS arm64 开发运行；Windows/Linux 原生隔离、正式安装包与签名、其他平台二进制及内嵌依赖通知仍需发布前审核。没有修改上游 Codex 源码，产品 AGPL-3.0-only 与上游 Apache 许可/通知分别保留。详见 [UA.1](docs/agent/ua-1.md) 与 [ADR-0002](docs/agent/adr-0002-native-engine-contract.md)。

### UA.5 基础包核对（2026-10-05）

本阶段没有新增 Agent 执行库，继续固定 Pi 0.99.1（MIT）、Codex 0.160.0（Apache-2.0）与 MCP SDK 1.31.0（MIT）。项目文件基础工具复用 Pi SDK；原生执行与 macOS 外层隔离复用 MaterialsX 自有打包运行时。模型协议转换不构成另一套执行引擎。中英 Skill 草稿导入只安装用户审阅的指令，不能视为已审核第三方代码、依赖或商业分发权。完整法律审核与各平台发行清单仍按本文件原发布流程执行。

## UA.6 论文与受管环境

新增直接依赖 `@xmldom/xmldom 0.8.15`（MIT），保留包内 LICENSE，纳入 npm 完整清单。只用它解析限量 Atom，禁止 DTD/实体声明。arXiv/Crossref 是外部服务，接口权限不授予全文再分发、同行评审或数据真实性保证；arXiv 描述性元数据为 CC0，而 PDF 权利按单篇许可判断，本系统未知时保留 unknown、限制本机研究。参考 [arXiv API 政策](https://info.arxiv.org/help/api/tou.html) 与 [Crossref REST 文档](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)。

受管修复复用已分发 CPython/PyMuPDF/Pillow/jsonschema 文件，不引入新依赖或从网络重新挑选版本。两平台文件/版本锁位于 `vendor/materialsx-runtime-locks/`；原许可文件随运行时复制保留。macOS 使用 CPython 3.12.12；Windows 分发文件声明 3.12.10；两者 PyMuPDF 1.28.2、Pillow 12.3.0、jsonschema 4.26.0。Windows 文件身份与许可快照不代表 Windows 上的执行验收。测试用 PDF 是团队生成的合成文字，真实论文测试 PDF 不进入仓库或发布包。原科学上游 Skills 版权与许可保持不变。

## UA.10 数值参考数据

NIST/ITL StRD 的 PiDigits（构造数据）及 Norris（NIST 臭氧仪校准观测）作为算法参考，以原字节随应用携带。下载来源与 SHA 位于 `methods/catalog.json`，完整 non-SRD 数据声明和署名位于 `methods/references/NOTICE.txt`。[NIST 许可依据](https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications)与其他 SRD/外部作者数据许可分开审查。未复制 NIST 科学代码、论文正文或权重；该数值实现为 MaterialsX 原有团队代码。

UA.11 后台数值示例复用上述 Norris 原始字节、NOTICE 和 MaterialsX OLS 模块，不增加外部科学代码或数据；示例复制到项目时同时携带 `NOTICE.txt`。独立 worker 使用 MaterialsX 自有运行时与团队代码，没有新增生产依赖。
