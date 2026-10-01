# ADR 0002：M0 权限与供应链边界

- 状态：接受
- 日期：2026-09-30

## 决策

- Renderer 使用 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。
- 初始技能从固定 K-Dense commit 同步，生成 SHA-256 manifest；不在用户启动时拉取 main。
- 初始 skills 作为提示和审核脚本来源，不能自动获得 shell、网络、宿主密钥或项目外文件权限。
- MCP stdio 命令属于代码执行，只有官方签名配置或用户明确授权的项目配置可启动。
- 平台模型供应商 Key 只存云端；桌面只保存平台令牌和独立数据源凭据。
- “受控 Python”不宣称为安全沙箱。未知代码在隔离后端完成前默认不执行。

## 后果

K-Dense 技能内容可以随初始包发现，但各自依赖与联网能力仍需逐项启用和验收。M0 的 MCP server 只用于协议验证，不成为产品内置材料数据库。
