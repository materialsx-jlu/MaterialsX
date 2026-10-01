# M4 发布工程与就绪门槛

M4 当前交付的是可运行的发布中心、脱敏诊断包、固定版本打包工具和 82 项已内置的 K-Dense Skills。它用于暴露发布阻断项，不把开发构建描述为已签名或可正式发布的 v1。

## 当前完成

- Electron Builder `26.15.3` 固定版本，提供 macOS arm64 DMG 和 Windows x64 NSIS 安装程序。
- 桌面端新增“发布中心”，统一显示科学质量、安全与隐私、安装交付、运维恢复四类门槛。
- SQLite `quick_check`、运行时连接、发行包状态、签名、双平台安装证据、三领域评测和更新回退均进入门槛。
- 支持从桌面端导出 JSON 诊断包；不包含项目路径、文件内容、对话正文、模型端点、令牌或凭据。
- K-Dense 固定提交中的 82 项 Skills 全部通过固定内容、元数据、双语资料、Pi 发现、默认启用和安装资源验收；Skill 定义、参考资料、脚本及目录资料随应用交付，无需用户另行克隆或安装 Skill。
- CLI 生成机器可读报告；严格门槛在仍有阻断项时返回失败。

## 命令

```bash
npm run m4:readiness
npm run m4:release-gate
npm run skills:accept
npm run skills:verify-bundle
npm run package:dir
npm run package:mac
npm run package:win
```

`package:dir` 已在 macOS arm64 生成并启动：

```text
release/dist/mac-arm64/MaterialsX.app
```

`package:mac` 已于 2026-09-30 重新生成 219 MB 的未签名开发 DMG，并通过 `hdiutil verify`、挂载内容检查和独立启动冒烟测试：

```text
release/dist/MaterialsX-0.0.1-mac-arm64.dmg
```

DMG、NSIS 安装程序及其 blockmap 的当前 SHA-256 校验清单位于安装包外部的 `release/dist/SHA256SUMS.txt`，避免内置文档与安装包哈希形成自引用。

Windows x64 NSIS 安装程序已在 macOS arm64 构建机完成交叉构建，内部主程序确认为 PE32+ x86-64：

```text
release/dist/MaterialsX-0.0.1-win-x64.exe
```

当前 DMG 与 NSIS 安装程序均用于开发验证。正式 `package:mac` 需要有效 Developer ID Application 证书和公证配置；Windows 安装程序仍需代码签名，并在 Windows 10/11 x64 构建机或测试机完成安装、启动、卸载和升级验证。

## 诊断包隐私边界

诊断包只包含应用/运行时版本、操作系统与架构、SQLite 完整性、记录数量、运行状态计数、连接状态和发布门槛。导出的 JSON 以当前用户可读写权限创建。

导出前后的自动化测试覆盖敏感字段递归脱敏；实机导出后额外检查了用户目录、localhost 端点、研究正文及常见凭据字段。

## 发布证据

门槛识别以下经过复核的文件：

- `release/evidence/macos-arm64-install.json`
- `release/evidence/windows-x64-install.json`
- `release/evidence/science-holdout.json`
- `release/evidence/update-rollback.json`

证据格式固定和执行工作仍属于 MX-402、MX-403、MX-404。空占位文件不能作为正式放行依据。

## 当前发布阻断

1. 84 项内置 Skill 的领域效果和可选依赖仍需按工作流验证，三领域固定模型/环境保留集尚未评测和专家签收。
2. 缺少有效的 macOS 签名、公证及 Windows 代码签名证书。
3. 缺少两目标系统的全新安装、升级和回退实机证据。
4. M3 正式账号、支付、平台网关和生产账本尚未完成。

在这些条件满足前，MaterialsX 可以作为开发/测试构建使用，不能标记为正式 v1。
