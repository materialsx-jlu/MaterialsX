# 第三方许可清单

© 2026 吉林大学 AI-DAOS 团队

审核记录日期：2026-10-01。自有代码与自研 Skills 已获团队开源授权，采用 **AGPL-3.0-only**。上游内容不因根 LICENSE 而改变许可。下列是依赖声明与本机资源核对结果，**不是全部第三方已完成法律审核的证明**。

## 快照与复现

执行 `python3 scripts/generate-third-party-inventory.py` 生成以下清单，升级依赖、同步 Skills、重新装配 Python 运行时后必须重做并人工复核：

- [npm 完整锁文件清单](docs/third-party/npm-dependencies.json)：674 个路径条目，含传递、开发和平台可选依赖；记录版本、声明、来源、integrity、可用许可文件哈希。不同路径不代表不同组件数量，也不是安装包最终 SBOM。
- [Python 依赖快照](docs/third-party/python-dependencies.json)：开发环境和 macOS arm64/Windows x64 内置运行时；记录版本、METADATA/许可文件哈希。某平台不存在时明确标记 unavailable，不从另一平台推断。
- [82 项上游 Skills 的逐项声明](docs/third-party/skills-licenses.json)：固定提交、定义哈希和声明原文。Skill 中的软件许可声明可能指其工具包，不能代替所有脚本、参考和依赖审核。

Node 版本来自 `package-lock.json`；Python 实际版本来自本地 dist-info。Python 运行时构建脚本目前使用版本范围，**重建可能产生不同版本**，不能仅凭 `python/uv.lock` 声称安装包依赖已全部固定。

## 直接 JavaScript 依赖

| 组件 | 版本 | 声明许可 | 用途/来源 |
| --- | --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 0.99.1 | MIT | Pi Agent；[上游](https://github.com/earendil-works/pi) |
| `@modelcontextprotocol/sdk` | 1.31.0 | MIT | MCP 客户端；[上游](https://github.com/modelcontextprotocol/typescript-sdk) |
| `@lucide/vue` | 1.49.0 | ISC | 图标；[上游](https://github.com/lucide-icons/lucide) |
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

目前 npm 锁文件的 674 项均有 license 字段；仅此不能说明其所有原生二进制、字体和子依赖的通知均已完整收集。未安装平台的许可文件标为待复核。Electron 安装包须保留 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`。

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

Python 的完整传递依赖和许可文本位置见快照 JSON；以上没有授予外部科学软件、模型或数据库的使用权。Go 控制面当前 `go.mod` 无第三方模块需求；Go 工具链不是项目自有代码。uv、Git、Tesseract、LAMMPS、Quantum ESPRESSO、Rosetta、Docker、LM Studio 是构建/可选外部环境，不能当作已随程序再分发或被根 LICENSE 覆盖。

## Skills、模型与示例

导出的项目标志位于 `assets/brand/`，沿用 `@lucide/vue@1.49.0` 的 Atom 几何；SVG 保留 ISC 归属，完整通知另存于 [assets/brand/LUCIDE_LICENSE.txt](assets/brand/LUCIDE_LICENSE.txt)。PNG 为同一矢量资源的高清导出。

[K-Dense](https://github.com/k-dense-ai/scientific-agent-skills) 快照固定为 `65d6e786832e2c52832713117bbbf5096b56f77f`，保留 [MIT 原文](vendor/kdense-scientific-agent-skills/LICENSE.md) 和 `Copyright (c) 2025 K-Dense Inc.`。82 项 Skill 的定义许可逐项记录，安装额外包或访问 API 必须另行满足其条款。

自研 `materials-literature-rpsme-json`、`materials-xyz-extraction` 的团队代码已获授权，按项目 AGPL-3.0-only 分发；快照定义/脚本未因版权换名而改写，以保留原哈希验收。

**以下两份论文抽取示例的公开/再分发权利待确认，尚不能作为已审核资产发布：**

- `vendor/materialsx-default-skills/skills/materials-xyz-extraction/examples/polymers-16-00897-v1.xyz.json`
- `vendor/materialsx-default-skills/skills/materials-xyz-extraction/examples/polymers-16-00897-v2.xyz.json`

上述文件保留用于现有本地验收；维护者确认原文许可、抽取事实/引用/图表的权利与归属后，记录结论，或以合成示例替换并更新哈希及测试。根 AGPL 不替原论文授权。K-Dense 上游示例/图片也需按上游与具体数据来源复核。

`models/catalog.json` 当前仅含目录元数据及来源链接，没有势函数或聊天模型权重。Matbench/Matbench Discovery、LLaMat、MatSciBERT、BatteryBERT 等的目录、代码、权重和数据许可分别审查。M6 引入 MACE/CHGNet 等时须增加具体权重版本、哈希、许可及源码/归属材料。

## 公开发行前仍须完成

1. 两份自研 Skill 论文示例及上游示例资产权利复核。
2. 在两目标平台按准确安装包重新采集最终依赖/notice；检查 Chromium、字体、Python 原生库、NSIS，必要时补充完整通知文本。
3. 对 AGPL/LGPL/MPL 等依赖逐项记录源码、修改、替换/重新链接和网络服务义务的处理方式；提供发行对应源码和可复现构建材料。上游 URL 不是所有义务都已满足的证明。
4. 补齐计划仓库 `materialsx-jlu/MaterialsX` 的版本源码标签/下载入口；安全报告邮箱已确认为 `huzhangyou@jlu.edu.cn`。不能用现有本地包的成功构建冒充已完成公开发行审核。
