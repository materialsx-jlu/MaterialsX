# 仅本机开发账户服务

适用场景：开发版云服务中心点击登录，因 `127.0.0.1:8788` 没有身份服务而立即失败。`npm run desktop:start` 只启动桌面；本指南提供独立、持久的本机身份环境。

## 启动

需要已有 Go、Node 及 PostgreSQL 16 工具；不使用 Docker、不下载模型或供应商 Key。在项目根目录执行：

```sh
npm run identity:local
```

脚本查找 Homebrew/Linux PostgreSQL 16，其他路径可设 `MATERIALSX_POSTGRES_BIN`。首次启动新建专用 PostgreSQL、数据库和随机登录资料；以后启动读取同一份私有配置，不重新生成密码或身份 master key。运行迁移、创建受限 runtime 角色并授权后，以 runtime 连接启动已有 Go 身份服务。

| 内容 | 位置 |
|---|---|
| 身份 / 桌面授权 | `http://127.0.0.1:8788` |
| 运营后台 | `http://127.0.0.1:8788/ops` |
| 独立 PostgreSQL | `127.0.0.1:55452/materialsx_local_dev` |
| 桌面普通账户 | `developer@materialsx.local` |
| 运营管理员 | `admin@materialsx.local`，本机使用邮箱 + 密码 |
| 私有登录资料 | `runtime/m5-local/LOGIN.md` |
| 固定 master key / DB 密码 | `runtime/m5-local/private-config.json` |
| 数据、日志及启动锁 | `runtime/m5-local/` |

上面两个 `.local` 邮箱仅作为本机登录标识，无收邮件功能。打开 `LOGIN.md` 查看随机密码；此文件仅保存在本机，不得发到公开 Issue、日志、截图或仓库。`runtime/` 已忽略，目录权限 700、私有资料权限 600。首次创建的密码由程序随机生成，脚本不提供默认通用密码，也不自动修改已有账户密码。

桌面使用普通账户：云服务中心 → 登录 → 系统浏览器输入资料、勾选授权 → 返回桌面。后台使用管理员邮箱和密码。本机启动脚本设置 `MATERIALSX_LOCAL_DISABLE_ADMIN_TOTP=1`，登录页不显示 TOTP；生产环境拒绝此开关，其他启动方式默认仍验证 MFA。

## 范围与停止

监听仅绑定 `127.0.0.1`，不部署公网、不开公开注册。新环境与 `runtime/m51` 集成测试库分开。脚本屏蔽继承的 MaterialsX / RootFlowAI 配置，明确禁用云生成和支付；账户能登录、浏览账单与后台，不代表已获得云调用额度或有可购买套餐。若需要真实云接入，另按 [gateway.md](gateway.md)、[metering.md](metering.md)、[payments.md](payments.md) 配置受控服务，不往本机脚本里添加 Key。

macOS 默认安装用户 LaunchAgent `com.materialsx.local-identity`，退出终端后服务继续运行，异常退出会自动重启，重新登录 macOS 后也自动启动。日志在 `runtime/m5-local/launcher.log` 和 `identity.log`。Linux 或显式 `--foreground` 使用前台运行。需要停用自动恢复并完整停止服务和专用 PostgreSQL：

```sh
npm run identity:local -- --stop
```

停止保留数据和密钥，下次重新执行启动命令。端口冲突时拒绝启动，不杀其他服务。启动锁记录启动器 PID，启动时自动清理已退出启动器留下的锁；不能通过删除私有配置来“修复”登录；删除配置会导致已有 MFA 无法解密。

显式本机检查（不访问付费模型或支付渠道）：

```sh
npm run identity:local:check
npm run identity:local:form-check
```

验证真实数据库环境下的浏览器 PKCE、普通账户、管理员密码登录、账户账单与后台路由并退出测试会话；结果写到忽略的 `runtime/m5-local/validation.json`，不含密码、令牌或研究正文。生产部署仍按 [identity.md](identity.md) 使用 HTTPS、独立秘密管理及备份。

2026-10-01 本机验证：专用 PostgreSQL 与 Go 服务启动通过；普通账户 PKCE / 管理员 MFA / 账单与运营接口通过；runtime 角色无 SUPERUSER、CREATEDB、CREATEROLE 或 schema CREATE 权限；完整停止再启动后私有配置摘要不变、普通及管理员账户仍可登录。开发身份服务的成功不代表正式云生成或支付验收通过。

同日修复真实浏览器表单登录：登录页 `no-referrer` 会使普通表单 POST 的 Origin 变为 `null`；改为仅登录页面使用 `same-origin`。Chrome 还会将授权后的回调跳转纳入 `form-action`，因此登录页只额外允许本轮已验证的精确回调 URL；其他响应保持 `no-referrer`。来源校验、CSRF、PKCE 和一次性授权码保留。参见 [MDN Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy)、[MDN form-action](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action)。

`form-check` 使用临时桌面目录、真实 Electron main/preload、Chromium 原生表单提交和系统安全凭据存储，不手工添加 Origin；结果写到私有 `runtime/m5-local/native-form-validation.json`。2026-10-01 完整登录/回调/退出通过，回调未携带 Referer。Go/PG race 回归同时验证错误 CSRF、跨来源、`null` / 缺失 Origin 均返回 403。旧授权页应关闭，重新从桌面点击登录。

2026-10-02：本机管理员暂时关闭 TOTP；macOS 改用 launchd 托管并自动恢复服务。重新启动会重建管理员页面，已有账户、密钥及数据库保留。付费联调环境仍使用 `npm run identity:local -- --paid-cloud`；默认命令关闭云生成及支付。
