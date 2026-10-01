# 安全问题报告

© 2026 吉林大学 AI-DAOS 团队

当前为 0.0.1 开发版本，没有稳定生产版或承诺维护周期。维护者受理当前开发版问题，旧开发构建没有长期更新承诺；正式支持版本将在发布后公布。

## 私密报告渠道

请将 MaterialsX 安全问题私下发送至 **[huzhangyou@jlu.edu.cn](mailto:huzhangyou@jlu.edu.cn)**。建议邮件主题为 `MaterialsX 安全报告：简短问题描述`，按下节提供脱敏复现材料。

计划仓库为 `materialsx-jlu/MaterialsX`，尚未核实可访问的公开仓库；GitHub Private Vulnerability Reporting **尚未开通或验证**。仓库建立并启用该功能后，也可在 Security → Report a vulnerability 私下报告。

不要在公开 Issue、讨论、PR 或日志中公开漏洞利用步骤、凭据、私有研究数据；不要把 MaterialsX 特有问题发送给 K-Dense 等上游团队。

## 报告内容

- 版本/提交、系统和架构。
- 受影响组件：IPC、文件/脚本工具、Skills、MCP、本地模型端点、诊断包或未来网关。
- 合成文件/脱敏数据的最小复现、预期和实际行为。
- 已观察到的越权、文件写入、数据泄漏或额度异常，以及可选修复建议。

不要附真实 Key、完整 SQLite/Pi 会话、原始研究数据或含 Authorization 头的网络记录。维护者核实后协调修复和披露；响应 SLA 待确认，不作未经落实的时间承诺。

## 当前安全边界

renderer 开启 `contextIsolation` 和 sandbox、关闭 Node 集成，使用窄 preload IPC；模型端点限制为 loopback。科学工具仍可读写文件和运行脚本，路径授权、子进程隔离、提示注入防护仍待完善。使用获授权文件和可信 Skill/MCP，在隔离项目中测试不可信输入。

Go 控制面是 loopback 开发服务，开发模式支持测试权益授予，不应直接暴露公网。生产认证、供应商 Key 管理、支付与账本属于 M5 后续范围。

## 凭据泄漏

此前用于供应商测试的任何真实 RootFlowAI Key 都不得复制到本项目、Issue、公开日志或安装包。若进入公开材料，立即在供应商处撤销/轮换，随后清理 Git 历史、日志、构建及缓存，并检查使用记录；报告中不要再次贴出旧 Key。

提交前运行 `python3 scripts/check-public-secrets.py`，另行检查图片、二进制和历史。扫描是辅助措施，不能替代撤销或安全审计；`.gitignore` 不会移除已跟踪或已发布的秘密。
