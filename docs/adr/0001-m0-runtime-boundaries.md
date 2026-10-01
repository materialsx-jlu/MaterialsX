# ADR 0001：M0 运行时边界

- 状态：接受
- 日期：2026-09-30

## 决策

桌面界面使用 Electron/Vue，Pi 运行在独立 Node 本地服务，科学处理运行在托管 Python 3.12 环境。云模型只能经 MaterialsX 平台网关；用户可选 loopback 本地模型，但不能配置任意远程模型端点或云模型 Key。

Pi SDK 固定为 `@earendil-works/pi-coding-agent@0.99.1`，通过 `pi-adapter` 隔离上游 API。SDK 加载固定的 K-Dense 初始技能路径，并显式装配 MCP 扩展。项目文件、运行、权限与产物状态由 MaterialsX 持有，不由 Pi 会话文件代替。

M0 不引入 PostgreSQL、Temporal 或完整 Vue 工作台。最小平台网关在 M1 实现；M0 只验证供应商接入边界和本地端点政策。

## 原因

Pi 与产品本地层同为 TypeScript，嵌入成本最低。Python 3.12 比当前系统 Python 3.14 更适合科学包生态。独立进程允许以后按任务取消、重启和限制权限。

## 已验证

- Pi SDK 无需执行云模型请求即可创建会话，并从固定目录发现 18 个 K-Dense skills。
- Pi SDK 的 MCP 扩展可连接 stdio server、注册工具；独立客户端可实际调用同一工具协议。
- Electron 的安全默认值由 smoke test 检查。
- Python 环境可运行两种 PDF 解析器与 ASE/EMT。

以上结论仅在对应自动化测试实际通过后成立；运行报告写入 `artifacts/m0/`。
