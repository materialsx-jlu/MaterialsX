# MaterialsX GitHub 源码发布

本仓库公开桌面应用、官网、共享合同、科学工具和 Go 核心控制面。公开源码允许本地研究与开发；正式 MX 充值、模型路由和后台运营需要另行部署受控服务。

## 发布边界

| 保留在本仓库 | 独立保管，不进入本仓库 |
| --- | --- |
| `apps/desktop/`、`apps/admin/`、`website/src/`、`packages/` 中的通用合同、`services/control-plane/` 中的账户、钱包、支付和网关代码 | `apps/billing-admin/`、`services/billing-admin/`、`services/control-plane/internal/billingadmin/` 与计费管理 API 合同 |
| Go 核心服务的受控接口和桌面连接入口 | `services/litellm/`、`services/litellm-console/`，以及供应商密钥和代理运行数据库 |
| MOOS 的连接配置说明和只读调用客户端 | 独立 MOOS 仓库与 `materials-mcp` 服务实现、MOOS 数据库 |

公开导出版的 `cmd/identity` 不挂载计费管理 API。完整本机开发目录保留私有实现，不能直接执行 `git add -A && git push`。独立组件应有各自的访问控制、版本号、数据库、部署和回滚；公开仓库只保留其对接合同。`docs/v0.3/` 中的历史联调文档可能提及独立组件的本机路径，这些路径不是公开仓库的可运行源码。

## 每次更新 GitHub

1. 在完整本机目录完成开发和测试。不要把 `runtime/`、`.env`、支付/供应商密钥、真实用户订单或研究数据放入源码。
2. 从 GitHub `main` 创建一个临时公开导出克隆，将本机允许公开的文件复制过去；排除上表的私有目录、生成产物和缓存。在导出克隆运行 `node scripts/prepare-public-export.mjs <导出克隆绝对路径>`，移除 `cmd/identity` 对 `internal/billingadmin` 的导入与挂载，以及只依赖私有组件的 npm 命令。脚本会拒绝在完整本机目录运行。
3. 在导出克隆运行 `python3 scripts/check-public-secrets.py`、`npm ci`、`npm run check`、`npm test`、`go -C services/control-plane test ./...`。完整 `npm test` 中有测试依赖未入库的本机 Python 运行时与模型权重；验证时可临时放入导出克隆的 Git 忽略 `runtime/`，提交前确认它们仍未暂存。对本次手工修改的源码运行 `git diff --cached --check -- <文件>`；旧版资料中已有 Markdown 硬换行和上游数据文件空白，不应通过批量重写来掩盖差异。另行人工查看二进制文件、图片、许可证及 `git diff --cached --name-only`。
4. 确认暂存列表没有 `billingadmin`、`apps/billing-admin`、`services/billing-admin`、`services/litellm`、`services/litellm-console`、MOOS 服务目录、密钥或运行时数据，再提交并推送 `main`。推送后从远端重新克隆，复查排除项和基础构建。

公开 GitHub Releases 与源码提交是两件事。只有完成目标平台安装、签名、价格和供应商账单核对、支付回调与故障恢复验收后，才能把 0.3 安装包标为正式可用。当前 `0.3.0-preview.1` 源码不代表正式收费发行。

本地部署私有组件时，先分别启动 MOOS、LiteLLM 和计费 Web，再配置 MaterialsX 核心服务的私网端点和凭据；桌面只连接 MaterialsX Go API，不直接接触供应商密钥。公开导出版不提供这些私有进程的源码或启动脚本。若只体验本地研究功能，执行根目录的 `npm ci` 和 `npm run dev` 即可。
