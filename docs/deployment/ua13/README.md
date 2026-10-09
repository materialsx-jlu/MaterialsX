# UA.13 同源团队网关部署模板

团队研究服务在 127.0.0.1:8793，账户与模型网关在 127.0.0.1:8788。两者共用同一个 HTTPS API origin；`/v1/research/*` 由团队服务处理，其他用户 API 由 Go 处理。团队服务通过公开 origin 的 `/health` 和 `/v1/me` 核对生产身份及设备状态，MOOS MCP 和原始数据 API 不直接暴露给客户端。

原始示意 Nginx 片段已移除，避免与正式部署配置冲突。生成与安装边缘网关请按 [`deploy/README.md` 的 OD.2 步骤](../../../deploy/README.md#od2-https-边缘网关)。生产团队服务设置 `MATERIALSX_TEAM_PUBLIC_ORIGIN`、`MATERIALSX_IDENTITY_URL` 为同一 API origin，`MATERIALSX_TEAM_TRUSTED_LOOPBACK_PROXY=1`，开发开关关闭。代理固定 Host、转发合法 Origin，并清除伪造身份头。

团队数据库由服务账户独占，目录 0700、文件 0600；初始化授权使用私有 JSON。备份时协调 SQLite WAL（使用 SQLite 备份 API 或停止服务后完整备份），并与账户库、审计和 MOOS 来源分别管理。公网 DNS、TLS、设备撤销和跨网段验收尚待正式环境完成。
