# M1 桌面端运行说明

M1 当前提供可运行的本地桌面工作台。它覆盖项目、会话、Skills、运行时诊断、本地模型配置和 Pi 增量流式响应；受控执行以及 CSV 分析纵向切片仍在开发。

## 启动图形界面

首次运行：

```bash
npm install
npm run desktop:start
```

`desktop:start` 会先构建 Electron 主进程、preload 和 Vue renderer，再打开 MaterialsX 窗口。

开发模式支持 renderer 热更新：

```bash
npm run dev
```

## 当前可操作功能

1. 通过系统目录选择器添加本地材料研究项目。
2. 创建研究任务并把消息、会话标题和运行状态保存到 SQLite。
3. 查看并直接使用 82 个固定版本的 K-Dense Scientific Agent Skills，以及 `materials-literature-rpsme-json`、`materials-xyz-extraction` 两项内置材料抽取 Skills；共 84 项，全部默认启用并随应用安装。macOS arm64 与 Windows x64 安装包分别携带可移植 Python 3.12 运行时及 `jsonschema`、`PyMuPDF`、`Pillow`，两项抽取 Skill 无需再安装 Python 包。
4. 检查 Pi、Materials MCP、项目 Python、Tesseract、LAMMPS 和 Quantum ESPRESSO。
5. 在平台订阅和本地模型之间切换；本地端点只接受 loopback 地址。
6. 通过 32ms 增量缓冲逐步显示本地模型回答，并可随时停止生成。
7. 使用安全 Markdown 阅读回答，支持标题、列表、表格、引用、代码块和 KaTeX 数学公式。
8. 在消息输入框键入 `@` 调出已启用 Skills，可继续输入名称或描述筛选，并使用方向键和 Enter/Tab 插入。
9. 点击 Skills 目录中的任意卡片查看详情，在中文介绍与上游 English 原始介绍之间切换；每项提供一至两条双语使用示例，可连同 `@skill-name` 一键填入输入框继续编辑。
10. 关闭应用后再次启动，恢复项目、会话、消息、运行记录和模型设置。

本地模式已通过 LM Studio `http://localhost:1234/v1` 完成真实流式调用。平台模式仍显示“等待模型连接”，直到平台网关完成生产接入。

## Pi 流式响应

本地模型回答使用 Pi SDK 的真实 `text_delta` 事件。主进程把小 token 合并为约 32ms 一批，renderer 再按浏览器动画帧更新消息，避免每个 token 都触发一次 IPC、Vue 响应式更新和滚动布局。

发送后用户消息与 assistant 占位立即出现；首批内容到达前显示“正在思考”，到达后逐步追加并显示“正在生成”。最终回答完成后才作为一条消息写入 SQLite；停止或失败时保留已经收到的部分内容及对应状态。

## 回答排版

模型与系统回答由专用 Markdown 组件渲染。原始 HTML 默认关闭，渲染结果再经过 DOMPurify 清理；行内 `$...$` 和块级 `$$...$$` 数学公式由 KaTeX 本地渲染，不依赖网络资源。流式生成期间，界面以约 48ms 的间隔合并重排，避免每个 token 都重新解析整段内容而影响输入和滚动。

## Skill 提及

输入 `@` 时，composer 会在输入框上方显示已启用 Skills。输入 Skill 名称或描述中的文字可以实时筛选；上下方向键移动选择，Enter 或 Tab 插入，Esc 关闭，也可直接用鼠标选择。插入格式为 `@skill-name `。Pi 系统提示会把明确提及的 Skill 作为当前任务的优先说明来源。

## Skill 双语目录

Skills 页面默认显示中文介绍，也可以在页面顶部切换为 English。中英文介绍分别来自固定 Skill 元数据和本地翻译，84 项中文介绍保存在 `skills/descriptions.zh.json`。每项 Skill 的一至两条中英文使用示例保存在 `skills/examples.json`。自动化测试会检查介绍和示例与两个固定目录一一对应，并确保每条示例的双语内容完整。点击卡片会打开详情面板，展示完整介绍、使用示例、启用状态、许可证和实际来源；示例按钮会切回研究任务并把 `@skill-name` 与提示词填入 composer，不会自动发送。`npm run skills:accept` 同时验收 K-Dense 与 MaterialsX 内置 Skill 的固定内容、元数据、双语资料、Pi 发现、默认启用和安装资源；其中两项材料抽取 Skill 还会执行 Python 环境、31 个单元测试和 v2 示例校验。`npm run skills:verify-bundle` 直接检查构建后的应用资源目录。

## 本地数据

SQLite 文件名为 `materialsx.sqlite`，位于 Electron 的 MaterialsX 用户数据目录：

- macOS：`~/Library/Application Support/MaterialsX/`
- Windows：`%APPDATA%/MaterialsX/`
- Linux：`~/.config/MaterialsX/`

项目源文件不会因为登记项目而被修改。

## 验证

```bash
npm run check
npm test
npm run build
npm run verify
```

`npm run verify` 还会运行 Python 测试、Skills 审计、Pi/MCP smoke 和 M0 预检。

`npm run package:mac` 和 `npm run package:win` 会先构建对应平台的材料抽取 Python 运行时，再生成安装包。`npm run skills:verify-bundle` 会检查 84 项 Skill、双语资料和平台运行时；在当前主机平台上还会实际执行安装包内的 `check_environment.py`。
