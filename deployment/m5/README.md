# M5 部署入口（尚未部署）

这些模板不含凭据，不会自动创建公网入口。正式域名、服务器、邮件与签名资料待提供。

1. 在隔离服务器部署 PostgreSQL 16（TLS `verify-full`），保管迁移 owner 与受限 runtime 两套凭据。构建 `cmd/identity`、`cmd/worker`、`cmd/identityctl` 与 `npm run build:admin`，以只读文件安装到 `/opt/materialsx`。
2. 用 owner 连接执行 `identityctl --command migrate`、`identityctl --command grant-runtime --role <runtime_role>`。运行 API/Worker 用 runtime 角色；它们不能迁移、直接改密码或发布商品/价格。主密钥需仓库外 0600 存储并与数据库一起独立备份。
3. `/etc/materialsx/{api,worker}.env` 由运维填写，权限 0600。变量参考项目 `.env.example`，不能将占位值作为配置。启用 `MATERIALSX_ENV=production`、HTTPS `MATERIALSX_IDENTITY_PUBLIC_URL`、`MATERIALSX_IDENTITY_ADDR=127.0.0.1:8788`、`MATERIALSX_ADMIN_ASSET_DIR=/opt/materialsx/dist/apps/admin`、可信代理仅 Caddy 回环 CIDR。
4. 先保持 `MATERIALSX_CLOUD_MODE=disabled` / `MATERIALSX_PAYMENT_MODE=disabled` / `MATERIALSX_EMAIL_ENABLED=0`。完成 SMTP TLS、发送域名、已批准账户条款、微信正式通知路径与退款验证、采购价格与账单、签名与 Windows 等门槛。Caddy 配置 `MATERIALSX_PUBLIC_HOST` 才能取 TLS 证书，不使用临时 ngrok 代替生产部署。
5. 配置仓库外审批文件与经验证的输入计量适配程序，登记 Beta 用户、发布固定商品和销售/采购费率。正式 Beta 销售版本须为 `paid-sol-counted-20261001-v1`、输入策略 `verified-route-counter-v1`、同样 10/1/100 零售比例并绑定已核实计量证据；历史指定账户继续用原 `paid-sol-20261001-v1`。仅满足门槛后设置 `paid-beta` / `wechat-native`；邮件 `smtp`、注册显式开启。商业定价由运营提供，模板不创建或修改商品。
6. 安装两个 systemd 单元。Worker 包含积分恢复、支付查单、客服/告警通知。监控 `GET /health/ready` 及进程存活；状态只表示 DB/Worker，不代表供应商生成健康。金额异常请在 MFA 后台核对，不自动重发生成或支付。

## 备份与恢复演练

仅在安全终端用仓库外凭据设置 owner `MATERIALSX_DATABASE_URL`、主密钥及 PostgreSQL 工具路径（不得粘贴在公开日志）。

```bash
npm run m5:backup -- backup /absolute/private/materialsx.dump
# 预先创建独立本机空数据库，名字必须以 _restore_test 结尾；通过私有环境设置其 DSN。
npm run m5:backup -- restore-drill /absolute/private/materialsx.dump
```

工具拒绝覆盖已有备份、非私有文件、非空恢复库、原库或公网恢复目标。完成后删除演练克隆，或保存在授权的加密测试环境；克隆包含实际用户数据。生产原库灾备需维护窗口、停收款与生成、DB 恢复/迁移、恢复会话失效、账本核验、只查询原单的支付核对、再开启流量。本工具不会替运维在公网原库执行破坏性恢复。

当前保留：邮件令牌过期 1 天后删除；已发/已过期邮件加密 payload 保留 30 天；交易/审计/科研和工单没有静默删除规则。最终生产数据保留、导出与删除政策需审批，不把这组开发默认值视为已批准商业条款。
