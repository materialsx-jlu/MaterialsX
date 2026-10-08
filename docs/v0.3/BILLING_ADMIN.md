# 0.3.5 独立用户计费后台

计费后台是单独的 Web 发布单元：`apps/billing-admin/` 构建到 `dist/billing-admin/`，由 `services/billing-admin/manage.mjs` 启动静态站点与固定上游代理。浏览器只访问该站同源 `/api/*`；Go identity/control-plane 持有身份、权限、MX 账本和私有计费 API。计费 Web 没有数据库连接，也不持有支付或供应商密钥。`/ops` 和 LiteLLM 各自部署，计费后台启停不应影响它们。

## 本地启动

1. 先准备新版 Go 可执行文件并停止旧进程，再用数据库 owner 对现有 MaterialsX PostgreSQL 执行 `cd services/control-plane && go run ./cmd/identityctl -command migrate`，最后启动新版 Go。第 014 号迁移新增具名计费员工角色、操作幂等记录及退款/结算的实际完成时间。旧版 Go 的启动检查会拒绝更新后的迁移版本；发布窗口中不要重启旧版。
2. 在 Go identity 服务环境设置 `MATERIALSX_BILLING_ADMIN_PUBLIC_URL=http://127.0.0.1:8790` 与至少 32 字符的随机 `MATERIALSX_BILLING_PROXY_TOKEN`，然后重启 Go。两者缺一不可且必须与计费 Web 配置完全一致。Go 本地监听仍为 `127.0.0.1:8788`，现有 `/ops` 不变。
3. 执行 `npm run check:billing-admin && npm run build:billing-admin`。将 `services/billing-admin/config.example.json` 复制到 `runtime/billing-admin/config.json`，填入同一随机 token，然后执行 `chmod 600 runtime/billing-admin/config.json`。运行 `node dist/billing-admin/manage.mjs check` 和 `node dist/billing-admin/manage.mjs run`；打开 `http://127.0.0.1:8790/`。
4. 使用已有具名管理员或创建具名员工。员工由数据库 owner 执行 `cd services/control-plane && go run ./cmd/identityctl -command create-billing-staff`，从标准输入传入 JSON：`{"email":"...","displayName":"...","password":"...","totpSecret":"..."}`。具名管理员登录后可在「系统 → 员工权限」选择角色，填写原因并授权或撤销；API 要求版本号和幂等键。部署 CLI 也可执行 `-command grant-billing-role`，从标准输入传入 `{"actorId":"具名管理员 ID","accountId":"员工 ID","role":"billing.viewer","action":"grant","expectedVersion":0,"reason":"..."}`；首次授权版本为 0，变更已有角色时必须提供当前版本。可授予 `billing.viewer`、`billing.operator`、`billing.finance`、`billing.pricing`、`billing.admin`。授权人必须持有有效 `billing.admin` 角色，不能撤销最后一个有效管理员；角色变更写入不可变审计事件。生产必须提供 TOTP；本机 `MATERIALSX_LOCAL_DISABLE_ADMIN_TOTP=1` 不可用于生产。

避免将密码、TOTP 种子或代理 token 放入 shell 命令行、Git 仓库或发布包。`config.json` 由本机私有目录提供，发布包内只有示例文件。`npm run billing-admin:test` 检查 Web 静态服务和代理隔离；Go 集成测试需要 `MATERIALSX_IDENTITY_TEST_DATABASE_URL` 指向独立的测试 PostgreSQL。

## 发布与隔离

生产建议将 Go、计费 Web、LiteLLM 分别安装在 `/opt/materialsx-api/`、`/opt/materialsx-billing-admin/`、`/opt/materialsx-litellm/`。只将 `dist/billing-admin/` 复制到计费 Web 的版本目录，核对 `release.json` 中的 SHA-256 与版本；用原子 `current` 符号链接切换版本。计费 Web 的 `config.json` 放在 `/var/lib/materialsx-billing-admin/`，归服务账户所有且权限为 `0600`，升级发布包时不覆盖。每次只重启计费 Web 进程；Go 的迁移与发布使用自己的流程。

Linux 示例单元为 `services/billing-admin/systemd/materialsx-billing-admin.service`。生产配置 `publicUrl` 必须是独立 HTTPS 主机名，`webAddress` 是内网监听地址，`goOrigin` 是私网 Go 地址。配置 HTTPS 入口代理只转发该主机名至计费 Web，不直接暴露 Go 的 `/v1/admin/billing-console/*`；外部请求头中的 `X-MX-Billing-Proxy-Key` 由 Web 代理丢弃并重新注入。反向代理应设置请求体上限 32 KiB、合适的空闲/响应超时、保留 `Host`，并将证书续期和访问日志轮转纳入部署。Web 自身只放行固定 `/api` 路由，限制 32 KiB 请求体和 15 秒 Go 上游超时，提供不访问 Go 的 `/healthz`。健康检查成功只表明 Web 进程存活；登录/财务页面会明确显示 Go 不可用。

macOS 本地可执行 `node dist/billing-admin/manage.mjs launchd-install`、`launchd-start`、`launchd-stop`、`launchd-restart`、`status`。Linux 使用 `systemctl` 管理独立单元。回滚时将 `current` 指回前一个通过校验的 Web 版本并仅重启计费 Web；若回滚 Go，须先确认该版本接受当前迁移号和计费 API 合同。计费 Web 的失败不得更改 LiteLLM、Go、`/ops` 的 PID 或配置。

本机「系统 → 云服务与启动」统一显示 Go 数据库、云网关/MX 钱包、LiteLLM 和计费 Web 的状态。具备 `billing.admin` 角色的本机员工可点「检查并启动」，按 LiteLLM Proxy、LiteLLM Console、Go、计费 Web 的顺序只恢复不健康的已安装 launchd 单元；各进程、数据库、发布和密钥仍彼此独立。命令行等价入口是 `npm run billing-admin:stack:status` 和 `npm run billing-admin:stack:start`；当 Go 登录服务已停止、无法进入后台时使用命令行入口。`stack-status` 同时检查本机临时支付回调隧道，`stack-start` 会在回调不可达时拒绝启动付费服务，避免误报支付就绪；隧道本身仍须按私有回调配置单独恢复。按钮限 macOS、loopback、本机非生产环境，并再次校验计费会话、`billing.admin` 角色、Origin 与 CSRF；生产 Web 无法调用本机 launchd。进程健康不证明供应商模型可用或财务对账完成。

## 权限和数据口径

计费后台与 `/ops` 使用不同的 host-only Cookie；所有写操作由 Go 检查 Origin、CSRF、具名角色和当前会话。退款提交必须带原因、版本与幂等键；前端只提交审批，原路退款仍由 Worker 执行。订单手动查单要求操作员或更高角色并留不可变记录。列表由服务端过滤、翻页；CSV 仅含 ID 与会计数字，最多 5000 行，不导出完整邮箱、供应商请求体或密钥。

现金实收、现金退款、MX 点余额/消耗、已消费点对应收入、采购成本和可计算毛利分开显示。供应商账单未核实的请求显示未知/估算，不计入“已核请求毛利”。第 014 号迁移无法追溯旧记录的真实结算/退款时刻，旧已结算预留和旧成功退款按创建时间回填；迁移后的数据分别使用实际 `settled_at` 和 `executed_at`。当前价格快照仍是草案，四模型正式售卖、供应商账单校验和联合价格发布在后续阶段完成前保持关闭。

验收命令：`npm run check:billing-admin`、`npm run billing-admin:test`、`cd services/control-plane && go test ./internal/billingadmin ./internal/mxpoints ./internal/identity`。2026-10-07 本机独立计费 Web 已实际登录，财务角色对一笔 ¥10 MX 点订单完成退款预览与审批，Worker 原路退款成功，详见 [0.3.7 联调记录](INTEGRATION_RELEASE.md)。供应商账单、跨主机 HTTPS/CSRF、生产数据库恢复和三服务完整故障隔离仍需目标环境联调。
