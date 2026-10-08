# MaterialsX 0.1.0-preview.1

本版为无可信发行证书的开发预览，正式发行资格未通过。macOS 使用 ad-hoc 封装签名校验包完整性，不等于 Apple 身份签名或公证。© 2026 吉林大学 AI-DAOS 团队。许可证 AGPL-3.0；上游 Skills、运行时与模型权重保留各自许可。

## 下载与安装

统一下载入口：[GitHub Releases](https://github.com/materialsx-jlu/MaterialsX/releases)。请核对同版 `SHA256SUMS.txt`，不要使用旧 0.0.1 安装器判断本版功能。

| 系统 | 文件 | 使用方式 / 范围 |
| --- | --- | --- |
| macOS Apple Silicon | `MaterialsX-0.1.0-preview.1-mac-arm64.dmg` | 打开 DMG，拖入 Applications。未获得 Apple 公证，系统可能阻止首次打开；核对来源后按系统“隐私与安全”提示处理，不关闭全局安全保护。保留本机已审查 M6 环境/扩展权重 |
| Windows x64 | `MaterialsX-0.1.0-preview.1-win-x64.exe` | 运行 NSIS 安装器，可选用户目录。没有 Authenticode 签名，可能出现 SmartScreen 提示；桌面核心与 PDF Python，势环境未打包 |
| Linux x64 | `MaterialsX-0.1.0-preview.1-linux-x86_64.AppImage` | `chmod +x 文件.AppImage` 后运行；需桌面会话。无 FUSE 时采用 AppImage 自解包模式，或使用同版 tar.gz |
| Linux x64 备用 | `MaterialsX-0.1.0-preview.1-linux-x64.tar.gz` | 解压至用户拥有的目录，运行 `materialsx`。不得以 root 或通过关闭 Chromium sandbox 来日常运行 |

Linux 当前是预览构建范围，发行包不是所有发行版/物理机器已经验收的声明。支持窗口仍以 Electron 44 上游要求和实际平台记录为准。

首次使用需自行运行 LM Studio 等本地模型服务，并在 MaterialsX 选择真实模型；不附聊天模型权重。云账户、计费和支付需要部署并配置 M5 服务，安装客户端不会生成正式商户或生产账户。

## 本版包含与限制

- 三平台包含默认双语 Skills、目录、研究工作台、独立 App Server 资源和受管 PDF Python。无需预先安装 Codex 或系统 Python。PDF 工具内置不代表任何本地模型都能完成长论文抽取。
- macOS arm64 保留已有原子/分子计算环境和审核权重；工具运行和材料结论有效性分别检查。Windows/Linux 目录条目不等于安装了势运行环境，不能复制 macOS 二进制实现支持。
- Windows/Linux 的 Codex 项目隔离尚未验收，原生执行仍禁用；平台项目 shell 工具仅在已验收 macOS 上开放。Pi 与宿主研究工具的模型/权限范围以真实能力矩阵为准。
- 新增对已完成原生操作的有界恢复：同一会话读取成功回执后继续，不重放写入或计算。未知操作、账单、预算与权限错误不能重试绕过。
- 完整模型资格、Windows/Linux 实机安装、正式签名/公证、真实科研保留集与专家审核仍待验收。主模型漏参数/无效 JSON 等失败样例保留，未自动提高为 available。

未闭环工作统一在 [主计划第 8.1 节](../UNIFIED_AGENT_DEVELOPMENT_PLAN.md) 管理，不新开第二套 Agent 或计划。

## 重建与对应源码

随发布提供 `MaterialsX-0.1.0-preview.1-source.zip`，保存该版公开工作树和逐文件 SHA-256；包括已授权团队代码、自研 Skills 和上游资源，不附用户输入、账本、凭据或模型缓存。

```bash
npm ci
npm run check
npm test
npm run runtime:skills:mac   # Windows 换成 runtime:skills:win；Linux 换成 runtime:skills:linux
node --import tsx scripts/agent/ua6-runtime-lock.ts macos-arm64
npm run package:preview:mac # Windows: package:preview:win；Linux: package:preview:linux
```

macOS 全部 M6 资源须先按既有 `package:mac` 准备脚本生成锁定环境、审核权重和离线清单；Windows/Linux 核心包不要求这些未验证资源。依赖、上游源码和锁定版本见 `package-lock.json`、`atomistic/environments`、`THIRD_PARTY_LICENSES.md` 及 `docs/third-party`。

构建 profile 复用根配置与原 Codex bundler、UA.14 包内容检查；禁止隐式上传。真实调用测试必须显式 `--live`，付费路线使用原 M5 账本。正式发行使用 `ua14:release-gate`，预览说明不能替代批准证据。
