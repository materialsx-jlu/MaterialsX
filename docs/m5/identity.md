# M5.1：身份、PostgreSQL 与设备（MX-502）

© 2026 吉林大学 AI-DAOS 团队 · 2026-10-01

代码已实现并完成本机 PostgreSQL 16、桌面客户端和 macOS Electron 验证。公网部署、真实用户开户、Windows 凭据存储实机验收尚未执行。平台模型网关、计量、支付及完整运营页面仍按 M5.2–M5.5 实施。

## 账户与登录

首版采用邮箱和密码，由部署工具创建受邀账户；没有公开注册、邮箱验证、密码邮件重置或社交登录。密码须为 12–128 UTF-8 字节，Argon2id 参数为 19 MiB、2 次迭代、并行度 1、随机 16 字节盐。管理员只有一人，创建时登记至少 20 字节的 Base32 TOTP 秘密，登录必须提交 6 位验证码。TOTP 使用 30 秒步长和 ±1 步容差，同一步不能重复授权。

桌面设置中的“平台账户 / Account”打开系统浏览器，密码只提交给身份服务：

1. 主进程生成随机 verifier，并在 `127.0.0.1` 临时端口启动回调监听。
2. `/v1/auth/desktop/start` 登记 S256 challenge、设备名及精确 callback，服务端生成 flow/state，5 分钟内有效。
3. 浏览器登录页使用 HttpOnly/SameSite cookie、CSRF nonce、Origin 校验与明确授权勾选。成功后回传一次性授权码，有效期不超过 60 秒。
4. 主进程校验 Host、path、flow/state 后，用 verifier 换取令牌；授权码只能使用一次。
5. Access token 15 分钟；refresh token 每次使用后轮换。普通会话最长 30 天，管理员最长 12 小时，刷新不延长绝对期限。旧 refresh token 重放会撤销整个会话。

数据库仅存令牌 SHA-256 摘要。管理员 MFA 秘密以 AES-256-GCM 加密，并绑定账户 ID。Master key 必须稳定保存在服务端秘密系统，并另行安全备份；它不进入桌面安装包。客户端 access token 仅在主进程内存，refresh token 使用 Electron safeStorage 加密后原子写入用户目录 `platform-session.bin`，不进入 SQLite、renderer 或 IPC 返回值。加密不可用或 Linux 使用 `basic_text` 时拒绝平台登录。

客户端串行刷新，遇到无法确认的刷新结果清除本地登录记录并要求重新登录，禁止重试可能已被消耗的旧令牌。网络失败的退出操作不宣称服务端撤销成功，用户可以恢复连接后重试或从另一设备撤销。服务地址变更不向新地址发送旧凭据。本地模型和项目不依赖平台登录。

## 本地启动

需要 Go 1.25、Node 24、PostgreSQL 16。身份服务使用独立数据库，不读取 M3 的 JSON 开发账本，也不迁移已有用户科研数据。下面步骤用于私有开发环境：

1. 在 loopback PostgreSQL 中创建专用 `materialsx_owner` 角色和 `materialsx_identity` 数据库；使用 PostgreSQL 的交互工具或私有连接配置设置密码，不把密码放在命令历史。
2. 将 `.env.example` 中身份变量复制到忽略的 `.env.identity.local`，填写真实私有配置并设为 `chmod 600`。入口不自动加载环境文件。开发示意：

```bash
export MATERIALSX_ENV=development
export MATERIALSX_IDENTITY_ADDR=127.0.0.1:8788
export MATERIALSX_IDENTITY_PUBLIC_URL=http://127.0.0.1:8788
export MATERIALSX_IDENTITY_URL=http://127.0.0.1:8788
# MATERIALSX_DATABASE_URL 从私有配置注入，指向专用 loopback 数据库。
# MATERIALSX_IDENTITY_MASTER_KEY 从私有配置注入，Base64 编码的随机 32 字节。
npm run identity:ctl -- --command migrate
npm run identity:ctl -- --command check
```

Master key **只生成一次并保存**，每次重启换 key 会导致已有管理员 MFA 无法解密。迁移命令显式执行；运行服务不自动建表或升级，迁移校验和不一致会拒绝启动。

3. 用私有 stdin JSON 创建受邀用户。字段为 `email`、`displayName`、`password`；管理员另加 `totpSecret`。私有输入文件不进入仓库，权限设为 600，完成后按部署秘密管理政策处理。

```bash
npm run identity:ctl -- --command create-user < "$PRIVATE_USER_JSON"
npm run identity:ctl -- --command bootstrap-admin < "$PRIVATE_ADMIN_JSON"
npm run identity:dev
```

4. 另开终端，提供同一公开身份地址后运行 `npm run dev` 或 `npm run desktop:start`；打开“设置 → 平台账户 → 登录”。登录页面不能直接替代桌面发起步骤，因为它绑定本轮 PKCE 和 callback。

身份服务默认 `127.0.0.1:8788`，旧开发控制面仍为 `127.0.0.1:8787`。开发身份 HTTP、数据库均只允许 loopback 或本机 Unix socket。现有开发控制面必须显式 `MATERIALSX_DEV_MODE=1` 且绑定 loopback；`npm run control-plane:dev` 已提供该配置。

## API 与最小运营身份

完整合同见 [contracts.md](contracts.md) 与 [openapi.json](openapi.json)，版本 `m5.1-v1`。下列接口有真实实现：

| 路径 | 用途 |
| --- | --- |
| `POST /v1/auth/desktop/start`、`GET/POST /auth/desktop/{flowId}` | 创建登录授权、浏览器表单与授权回调 |
| `POST /v1/auth/desktop/exchange`、`POST /v1/auth/refresh` | 单次兑换、轮换；不作自动重试 |
| `GET /v1/me`、`GET /v1/devices` | 当前主体、自己的设备分页 |
| `POST /v1/devices/{id}/revoke`、`POST /v1/auth/logout` | 退出指定设备或当前设备，令牌立即不可用 |
| `GET /v1/admin/users`、`GET /v1/admin/audit-events` | 仅管理员且 MFA 未过期；分页 |
| `POST /v1/admin/users/{id}/status` | 激活/停用普通用户；原因、版本及幂等键必填 |

当前身份服务没有供应商、云生成、购买或开发权益授予接口。用户身份来自令牌，不接受客户端指定 owner。跨账户设备撤销统一返回 404；普通用户调用管理接口返回 403。管理状态变更不能改变自己或另一管理员，使用 `expectedVersion` 与 `Idempotency-Key`，事务内重复核对管理员及会话。停用撤销全部会话；再次激活不会恢复旧登录。管理写操作与审计同事务提交，审计不可 UPDATE/DELETE，运行角色也无此权限。数据库所有者仍具有改表能力，生产备份和审计外部留存由运维控制。

只交付 OPS-01 的身份、MFA、接口授权和审计基础；完整独立运营 Web 页面及后续业务按运营计划继续开发。账户与设备字段限于必要元数据，不上传本地项目或研究正文。

## 生产隔离与部署

生产和开发使用不同数据库、域名、服务角色及 master key。禁止把 M3 JSON 服务接到公网。正式身份服务须配置：

- `MATERIALSX_ENV=production`；禁止 `MATERIALSX_DEV_MODE=1`。
- `MATERIALSX_IDENTITY_PUBLIC_URL` 为固定 HTTPS origin，桌面 `MATERIALSX_IDENTITY_URL` 同 origin；正式安装包未配置地址时显示“尚未配置”。
- PostgreSQL `sslmode=verify-full`，可信 CA、正确服务器名称，不允许降级或跳过校验。
- 服务监听受防火墙保护，前置 TLS 反向代理保留已配置 Host；拒绝用户自选 Host。接口不启用任意 CORS。代理禁止记录 Authorization、Cookie、登录表单及回调查询串。
- `MATERIALSX_TRUSTED_PROXY_CIDRS` 仅填写实际代理源网段；默认不信任转发头。只有可信 socket peer 才解析 `X-Forwarded-For`，从右往左剥除可信代理。边缘代理覆盖/清理转发头，同时执行连接和请求体限流。

迁移、开户、恢复使用独立 owner 连接。创建无 SUPERUSER/CREATEDB/CREATEROLE 的运行角色，不能继承 owner，也不能向 `PUBLIC` 授予 schema CREATE。以 owner 环境执行：

```bash
npm run identity:ctl -- --command grant-runtime --role materialsx_runtime
```

此命令授权 schema USAGE、表 SELECT、身份流程必要 INSERT/UPDATE、账户仅 `status/version/last_totp_step` 更新、审计 INSERT 和 sequence 使用；不授予 CREATE、改密码/角色/MFA、审计更新删除。然后将运行服务 `MATERIALSX_DATABASE_URL` 改为 runtime 连接，运行 `npm run identity:dev`（名称是启动脚本，实际环境由配置决定）。生产启动拒绝高权限/迁移 owner 角色。

服务日志只输出启动状态、固定错误；不启用请求体日志。日志/监控包含真实个人信息时必须访问受限。限流计数存 PG，跨进程共享：登录按 IP 与规范化邮箱，已认证 API 也有限流。当前没有模型/设备消费限流或采购告警，随 M5.2/M5.3 交付。维护期可由部署工具执行 `prune` 清理过期临时状态，不删除审计。

## 备份、恢复与管理员找回

备份含密码摘要、MFA 密文和用户元数据，仍是敏感资产。使用私有连接环境执行 `pg_dump --format=custom --no-owner`，备份文件权限 600，存入加密且受控的备份系统；master key 独立保管。工具日志不能打印 DSN 或密码。实机集成测试使用临时目录、合成账户，备份与恢复均已验证。

恢复步骤：停止服务/流量 → 将 dump 恢复到新的隔离数据库 → 使用匹配 master key → 校验迁移 → **撤销全部已恢复会话** → 重新应用最小角色授权 → 健康检查 → 再开放流量。旧备份可能丢失后续的撤销或 refresh 消耗记录，不能恢复后立即开放旧会话。

```bash
npm run identity:ctl -- --command check
npm run identity:ctl -- --command invalidate-sessions
npm run identity:ctl -- --command grant-runtime --role materialsx_runtime
```

`invalidate-sessions` 原子撤销全部会话并追加恢复审计。验收证明恢复出的账号/设备仍存在，执行此步骤后旧 access/refresh 都被拒绝。管理员丢失验证器时，由有主机部署权限的人核实身份，并用 owner 和匹配 master key 从私有 stdin 提交 `email/password/totpSecret`：

```bash
npm run identity:ctl -- --command reset-admin < "$PRIVATE_ADMIN_RECOVERY_JSON"
```

这会更新密码/MFA、提升账户版本、撤销全部旧会话并审计，没有公开的绕过 MFA 入口。普通用户密码找回、自助管理员 MFA 设置、恢复码和其他登录提供方属于后续扩展。

## 可复现验收

```bash
npm run check
npm run test
npm run m5:contracts:check
npm run build
# 从私有配置注入 MATERIALSX_IDENTITY_TEST_DATABASE_URL，库名必须含 test。
# 必须是完全隔离的测试实例，测试连接需要 CREATEDB/CREATEROLE。
# pg_dump/pg_restore 用 PostgreSQL 16；可用 MATERIALSX_POSTGRES_BIN 指定目录。
npm run m5:identity:test
npm run m5:identity:live
npm run m5:identity:storage
# 已 build 且有图形环境时，实测桌面设置登录/退出：
npm run m5:identity:live -- --electron
```

`identity:test` 强制 PG 配置，运行 Go race；创建并销毁独立随机测试库/运行角色。普通 `control-plane:test` 未配置数据库时明确 skip PG 用例，**不能作为 M5.1 验收通过**。`identity:live` 只连接隔离测试库，在该库初始化迁移并创建随机合成账户，启动临时身份服务，验证桌面客户端真实浏览器表单/回调、重启刷新和设备退出；端口 `18788`，完成停止临时服务。不会访问 RootFlowAI 或任何付费模型。此工具保留测试库中的合成账户，可销毁整个专用测试库后重建，不用于已有业务数据库。

CI 新增 Linux/PostgreSQL 16 集成任务；其配置使用明确合成密码，不含真实 Key。macOS/Windows 原有 CI 保持类型、离线、构建回归。Windows safeStorage 实机行为和真实公网 HTTPS/TLS 链路仍需目标环境验证。
