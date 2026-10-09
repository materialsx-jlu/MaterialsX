# M5 历史部署材料

此目录只保留早期 M5 的 Beta 审批示例，供迁移时参考。API/Worker 单元已统一移到 [`deploy/systemd/`](../../deploy/systemd/) 并采用现行发布包路径。旧 Caddy 入口和明文数据库备份命令已退役；不得与当前 OD 系列配置同时部署。

当前线上入口、私有环境和发布顺序以 [统一部署说明](../../deploy/README.md)、[OD.5 收款](../../deploy/OD5_MX_PRODUCTION.md)、[OD.6 加密备份](../../deploy/OD6_RELEASE_OPERATIONS.md) 和 [OD.7 放量](../../deploy/OD7_ROLLOUT.md) 为准。systemd 单元安装前仍须核对二进制路径、受限服务账户、工作目录和实际文件权限。
