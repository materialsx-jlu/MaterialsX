# MaterialsX：阿里云 Ubuntu 逐模块部署操作卡

本文用于**一台 ECS 上的预览环境**，按卡片顺序操作，完成一张再开始下一张。它以当前代码和发布脚本为准，不把本机 `localhost`、macOS `launchd` 或开发数据库密码带到服务器。当前没有服务器 IP、SSH 用户、证书及实际数据库，因此本文中的域名和账号是**拟定拓扑**，命令须在填入真实值、校验包哈希后执行；本文不是已完成公网验收的证明。总说明见 [SSH 手册](ALIYUN_UBUNTU_SSH_RUNBOOK.md)，收费放量见 [OD.7](OD7_ROLLOUT.md)。

## 0. 先固定一张部署对照表

此处 `staging` 是预览，暂不收费。未来正式环境用另一台 ECS/独立数据库和 `mx.jouhu.com`、`api.mx.jouhu.com`、`admin.mx.jouhu.com`；不要在同一 Nginx 同时加载两份生成的 `default_server`。

| 模块 | 本地源码或发布物 | ECS 程序目录 → 持久目录 | 访问入口 | 数据库/状态 |
| --- | --- | --- | --- | --- |
| 官网 | `website/` → `website/dist/` | `/var/www/materialsx-preview/releases/<版本>/` → `current/` | `staging.mx.jouhu.com:443` | 无；下载清单为静态 JSON |
| 用户 API、登录、钱包、运营 `/ops`、微信通知入口 | `services/control-plane/` + `apps/admin/` → `dist/control-plane/v<版本>-linux-amd64.tar.gz` | `/opt/materialsx-control-plane/releases/v<版本>/` → `current/`；`/var/lib/materialsx/` | `api-staging.mx.jouhu.com:443`；管理域名的 `/ops` | `materialsx_staging`，`mx_identity` schema |
| 结算/通知 Worker | **同一 Go 发布包**的 `bin/worker` | 同上，不另发包 | 无公网端口 | 同一 MaterialsX 库 |
| 计费管理 Web | `apps/billing-admin/` + `services/billing-admin/` → `dist/billing-admin/` | `/opt/materialsx-billing-admin/releases/<组件版本>/` → `current/`；`/var/lib/materialsx-billing-admin/` | `admin-staging.mx.jouhu.com:443`，受 VPN/身份网关保护 | 不建库；经私有代理访问 Go |
| LiteLLM 代理 | `services/litellm/` → `dist/litellm/*.tar.gz` | `/opt/materialsx-litellm/releases/<组件版本>/` → `current/`；`/var/lib/materialsx-litellm/` | `127.0.0.1:4001` | 独立 `litellm_staging` 库 |
| LiteLLM 中文管理界面 | `services/litellm-console/` → `dist/litellm-console/*.tar.gz` | `/opt/materialsx-litellm-console/releases/<组件版本>/` → `current/`；`/var/lib/materialsx-litellm-console/` | `127.0.0.1:4000`；仅 SSH/VPN 运维访问 | 不建库；转发至 4001 |
| 新模型发布 Worker | Go 发布包的 `bin/modeldeploy` + LiteLLM 包的 `deploy-runner.mjs` | 两个已部署模块；私有状态仍在 LiteLLM runtime | 无公网端口 | MaterialsX 模型发布作业表 |
| MOOS API | **另一仓库** `/Users/user/Code/MOOS/go-backend/` | `/opt/moos/releases/<版本>/go-backend/`；`/var/lib/moos/` | `127.0.0.1:8080` | 独立 `uhtcmc_platform` 库及原始数据 |
| MOOS MCP | `/Users/user/Code/MOOS/services/materials-mcp/` | 同一 MOOS 发布目录 | stdio，无 HTTP 域名 | 不直接连数据库 |
| MaterialsX 研究服务 | `scripts/agent/ua13-server.ts` → `dist/scripts/agent/ua13-server.js` | `/opt/materialsx-team/releases/<版本>/` → `current/`；`/var/lib/materialsx-team/` | API 域名 `/v1/research/*` → `127.0.0.1:8793` | `team.sqlite`，并读取 MOOS MCP |
| 桌面安装包 | `release/dist/` | **安装在用户电脑**，不在 ECS 运行 | 包内单一 API origin | 用户本地项目与模型 |

公网安全组只开 `443`，`22` 只允许运维 IP；`80` 仅在所用证书验证方式确需时开放。`8788/8793/8790/4000/4001/8080/5432` 只在本机回环监听，不直接开放。后端独立包里的私有服务目录目前被 `.gitignore` 排除，**公开 Git checkout 不能重建完整服务器**；发布物从受控本地工作区构建并私下传输。路径中的 `<版本>` 均取实际发布包，不要直接复制历史包名。

### 本机与服务器的命令边界

以下称“本机”均指 `/Users/user/Code/MaterialsX`；“ECS”均指 SSH 登录后的 Ubuntu shell。先在本机设置操作变量，**不要把密钥写入命令或聊天**：

```sh
cd /Users/user/Code/MaterialsX
export MX_SSH_TARGET='<SSH用户>@<ECS公网IP>'
export MX_VERSION="$(node -p "require('./package.json').version")"
ssh "$MX_SSH_TARGET" 'mkdir -p ~/materialsx-upload'
```

先在 ECS 核对 `uname -m`：`x86_64` 对应 `linux-amd64`，`aarch64` 对应 `linux-arm64`。ECS 需安装 Nginx、PostgreSQL 16 与 pgvector（MOOS 使用）、PostgreSQL 客户端、Node **24+**（MOOS MCP 要求，兼容 MaterialsX 的 22.19+ 下限）、Python 3.12、uv、Go 1.25。先校验具体发行包和版本，再安装；不要用 macOS 虚拟环境/`node_modules`。证书申请采用可验证的 DNS-01 或实际受控的 HTTP 验证；Nginx 开启前必须存在有效证书，证书只放 `/etc/materialsx/tls/`。

## 1. 数据库卡：先建库和角色，再运行各模块的迁移

本预览拓扑使用**同机 PostgreSQL 16**，只监听 loopback，并配置 TLS；MaterialsX 生产模式要求数据库 DSN `sslmode=verify-full`。数据库证书必须包含连接主机的 DNS/IP SAN。例如连接 `127.0.0.1` 时证书要有 `IP:127.0.0.1`，客户端要信任相应 CA。证书、`pg_hba.conf` 的 `hostssl` 规则、数据库备份应由 DBA 在 ECS 核对；不能把 `sslmode=disable` 用于 MaterialsX 生产进程。当前 LiteLLM 的 `manage.mjs migrate` 先做本机 `pg_dump`，会拒绝非 localhost 数据库；若以后改用阿里云 RDS，须先修正并重新验收该迁移/备份流程，不能直接照本卡切换。

在 ECS 以数据库管理员创建**三个互不共库**的数据库和四个角色。示例只展示 SQL 结构，密码用 `psql` 的 `\password` 交互设置，禁止写入 SQL 文件、shell 历史或发布包：

```sql
CREATE ROLE mx_migrator LOGIN;
CREATE ROLE mx_runtime LOGIN;
CREATE ROLE litellm_owner LOGIN;
CREATE ROLE moos_owner LOGIN;
CREATE DATABASE materialsx_staging OWNER mx_migrator;
CREATE DATABASE litellm_staging OWNER litellm_owner;
CREATE DATABASE uhtcmc_platform OWNER moos_owner;
```

在 `psql` 中逐一执行 `\password mx_migrator` 等四条交互命令。MOOS 的 `001_init.sql` 需要 `vector` 和 `pg_trgm` 扩展；先在 `uhtcmc_platform` 由有权限的 DBA 安装并检查这两项扩展。实际科研数据不随 MaterialsX 代码包提供：若要访问本机 MOOS 已有配方，需另外从**现有 MOOS 数据库**做受控 `pg_dump -Fc`、校验并恢复到该独立库；迁移数据库前确认论文、图片、资产存储的权利与路径。不要把空库迁移成功误当作已有配方已上线。

各数据库迁移**不能合并成一份 SQL**：

| 数据库 | SQL 的本地位置 | ECS 执行入口 | 执行时机 |
| --- | --- | --- | --- |
| MaterialsX | `services/control-plane/migrations/001_identity.sql` 至 `019_model_deploy_catalog_guard.sql`，目前 **20 个文件**，含两个 `014_*` | `bin/identityctl -command migrate`；SQL 已 `go:embed` 进二进制 | 停 API/Worker 后，用 `mx_migrator` 的 DSN；自动记录文件名和 SHA 于 `mx_identity.schema_migrations` |
| LiteLLM | LiteLLM 固定版本内的 Prisma migrations；另补 spend-log 索引 | `node .../services/litellm/manage.mjs migrate` | 停 LiteLLM 代理后，用其独立账号；先备份，后运行 Prisma |
| MOOS | `/Users/user/Code/MOOS/go-backend/migrations/*.sql`，当前 **73 个文件** | 在 ECS `go-backend/` 目录运行 `./bin/migrate` | 仅**新空库**从头执行；其迁移程序未记录版本，不能盲目重跑整目录 |
| 研究服务 | 无 PostgreSQL SQL | `team.sqlite` 首次启动由服务创建 | 需单独备份 SQLite 与 MOOS 引用范围 |

如果是恢复现有 MOOS 完整库，先核对恢复后的 schema 与 MOOS 发布版本，**不要**再对已经有表的恢复库执行 73 个迁移。每次迁移前备份、保存数据库版本和迁移输出；失败时停止该模块，先核对原事务与数据库状态，不重新盲跑。

## 2. 官网卡：先部署不依赖后端的静态页

**本机生成：** 校对 `website/releases/preview.json` 中的安装包文件名、字节数、SHA-256；本轮新客户端尚未打包时先保留下载入口为未发布状态。构建命令：

```sh
cd /Users/user/Code/MaterialsX
SITE_ORIGIN=https://staging.mx.jouhu.com SITE_BASE_PATH=/ MATERIALSX_SITE_RELEASE_CHANNEL=preview npm --prefix website run build
mkdir -p runtime/deployment
tar -czf "runtime/deployment/materialsx-site-${MX_VERSION}.tar.gz" -C website/dist .
shasum -a 256 "runtime/deployment/materialsx-site-${MX_VERSION}.tar.gz"
rsync -av "runtime/deployment/materialsx-site-${MX_VERSION}.tar.gz" "$MX_SSH_TARGET:~/materialsx-upload/"
```

**ECS 安装：** `/var/www/materialsx-preview/releases/<版本>/` 解压，`current` 指向该版本；目录由 root 持有、Nginx 只读。示例（在 ECS shell 设置与上传包一致的版本）：

```sh
MX_VERSION='<实际版本>'
sudo install -d -m 0755 "/var/www/materialsx-preview/releases/${MX_VERSION}"
sudo tar -xzf "$HOME/materialsx-upload/materialsx-site-${MX_VERSION}.tar.gz" \
  -C "/var/www/materialsx-preview/releases/${MX_VERSION}"
sudo chown -R root:root "/var/www/materialsx-preview/releases/${MX_VERSION}"
sudo ln -s "/var/www/materialsx-preview/releases/${MX_VERSION}" /var/www/materialsx-preview/current.next
sudo mv -Tf /var/www/materialsx-preview/current.next /var/www/materialsx-preview/current
```

官网 Nginx 配置另存 `/etc/nginx/conf.d/materialsx-site.conf`：

```nginx
server {
    listen 443 ssl;
    server_name staging.mx.jouhu.com;
    ssl_certificate /etc/materialsx/tls/site/fullchain.pem;
    ssl_certificate_key /etc/materialsx/tls/site/privkey.pem;
    root /var/www/materialsx-preview/current;
    index index.html;
    location / { try_files $uri $uri/ =404; }
}
```

先检查 DNS A/AAAA 均指向实际 ECS，再执行 `sudo nginx -t && sudo systemctl reload nginx`。**验收：** `curl -I https://staging.mx.jouhu.com/zh-CN/`、`/en/`、`/ja/`、`/zh-TW/` 和 `/images/materialsx-icon.png` 均可访问；`/releases/preview.json` 与实际已发布安装包一致。官网不代理 8788，也不持有数据库密钥。

## 3. 用户 API 与运营 `/ops` 卡

**本机生成：** `npm run build:admin && npm run mx03:release:go -- linux-amd64`；运行 `npm run mx03:release:audit -- linux-amd64`（该审计还要求其余三个服务包已构建）。核对 tar 里有 `bin/identity`、`identityctl`、`worker`、`modeldeploy`、`admin/` 和 `release-manifest.json`。本机传输示例；如果 ECS 是 `aarch64`，两处 `linux-amd64` 都换成 `linux-arm64`：

```sh
MX_GO_PACKAGE="dist/control-plane/v${MX_VERSION}-linux-amd64.tar.gz"
tar -tzf "$MX_GO_PACKAGE" | head -30
shasum -a 256 "$MX_GO_PACKAGE"
rsync -av "$MX_GO_PACKAGE" "$MX_SSH_TARGET:~/materialsx-upload/"
ssh "$MX_SSH_TARGET" "sha256sum ~/materialsx-upload/v${MX_VERSION}-linux-amd64.tar.gz"
```

**ECS 安装：** 解包到 `/opt/materialsx-control-plane/releases/v<版本>/`，root 持有只读，`current` 指向该版本。切换前记录 `readlink -f /opt/materialsx-control-plane/current`。示例：

```sh
MX_VERSION='<实际版本>'
sudo install -d -m 0755 "/opt/materialsx-control-plane/releases/v${MX_VERSION}"
sudo tar -xzf "$HOME/materialsx-upload/v${MX_VERSION}-linux-amd64.tar.gz" \
  -C "/opt/materialsx-control-plane/releases/v${MX_VERSION}"
sudo chown -R root:root "/opt/materialsx-control-plane/releases/v${MX_VERSION}"
sudo ln -s "/opt/materialsx-control-plane/releases/v${MX_VERSION}" /opt/materialsx-control-plane/current.next
sudo mv -Tf /opt/materialsx-control-plane/current.next /opt/materialsx-control-plane/current
```

安装 [`materialsx-api.service`](systemd/materialsx-api.service) 与 [`materialsx-worker.service`](systemd/materialsx-worker.service)。持久目录 `/var/lib/materialsx/`，私有配置 `/etc/materialsx/api.env`、`worker.env`、`migrate.env`。`migrate.env` 用迁移角色 DSN；另外两个用 `mx_runtime` DSN，均从私有文件注入相同、持久的 32 字节 base64 `MATERIALSX_IDENTITY_MASTER_KEY`。最小预览配置的**变量名/非密值**：

```text
MATERIALSX_ENV=production
MATERIALSX_IDENTITY_ADDR=127.0.0.1:8788
MATERIALSX_IDENTITY_PUBLIC_URL=https://api-staging.mx.jouhu.com
MATERIALSX_DATABASE_URL=<对应角色的 verify-full TLS DSN>
MATERIALSX_IDENTITY_MASTER_KEY=<私有持久 key，不写入本文件>
MATERIALSX_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
MATERIALSX_SIGNUP_ENABLED=0
MATERIALSX_CLOUD_MODE=disabled
MATERIALSX_PAYMENT_MODE=disabled
MATERIALSX_ADMIN_ASSET_DIR=/opt/materialsx-control-plane/current/admin
MATERIALSX_BILLING_ADMIN_PUBLIC_URL=https://admin-staging.mx.jouhu.com
MATERIALSX_BILLING_PROXY_TOKEN=<仅 Go 与计费 Web 共知的私有随机 token>
```

私有 env 文件为 root 拥有、0600；`worker.env` 至少重复它需要的身份/数据库/支付/邮件配置，不要直接把含迁移角色 DSN 的 `migrate.env` 交给常驻进程。**先迁移，后启动：**

```sh
sudo systemd-run --wait --collect --pipe -p User=materialsx \
  -p EnvironmentFile=/etc/materialsx/migrate.env \
  /opt/materialsx-control-plane/current/bin/identityctl -command migrate
sudo systemd-run --wait --collect --pipe -p User=materialsx \
  -p EnvironmentFile=/etc/materialsx/migrate.env \
  /opt/materialsx-control-plane/current/bin/identityctl -command grant-runtime -role mx_runtime
sudo systemd-run --wait --collect --pipe -p User=materialsx \
  -p EnvironmentFile=/etc/materialsx/api.env \
  /opt/materialsx-control-plane/current/bin/identityctl -command check
sudo systemd-analyze verify /etc/systemd/system/materialsx-api.service /etc/systemd/system/materialsx-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now materialsx-api.service materialsx-worker.service
```

`identityctl` 不会从磁盘寻找单独 SQL 文件；它用嵌入的 SQL 并校验历史文件 SHA。**验收：** `curl -fsS -H 'Host: api-staging.mx.jouhu.com' http://127.0.0.1:8788/health/live`；`/health/ready` 需核对分项，未接 LiteLLM 时可能返回未就绪，不能以 `live` 代替完整放行。`journalctl -u materialsx-api -u materialsx-worker` 无启动错误。此时微信通知路由已由 API 进程实现，但因支付禁用，不发起真实订单。

## 4. 计费管理 Web 卡

**本机：** `npm run build:billing-admin`，传输整个 `dist/billing-admin/`，保留其中 `release.json`、`manage.mjs`、`server.mjs`、`index.html`、`assets/`、`systemd/`；不要只传静态页。**ECS：** 安装到 `/opt/materialsx-billing-admin/releases/<组件版本>/`，指向 `current`；安装包内 `systemd/materialsx-billing-admin.service`。`/var/lib/materialsx-billing-admin/config.json` 由 `materialsx-billing` 用户持有、0600，格式参照 `services/billing-admin/config.example.json`，但实际值为 `publicUrl=https://admin-staging.mx.jouhu.com`、`goOrigin=http://127.0.0.1:8788`、`webAddress=127.0.0.1:8790`，`proxyToken` 与 Go API 的 token 完全一致且至少 32 字符。先运行 `node /opt/materialsx-billing-admin/current/manage.mjs check`（带 `MX_BILLING_RUNTIME`），再启服务。**验收：** `curl -H 'Host: admin-staging.mx.jouhu.com' http://127.0.0.1:8790/healthz`；随后从**已获准的管理员网络**验证登录、模型目录、账本和运营状态。此 Web 不单独建 SQL 表，`014_billing_admin.sql` 属于 MaterialsX API 的嵌入迁移。

## 5. LiteLLM 代理与中文管理界面卡

这两个包**独立升级**。本机分别执行 `node services/litellm/build-release.mjs` 和 `npm run litellm:console:release`，核对 `dist/litellm/latest.json` 与 `dist/litellm-console/latest.json` 的包名和 SHA 后分别传到 ECS。ECS 解压到 `/opt/materialsx-litellm/releases/<代理版本>/` 与 `/opt/materialsx-litellm-console/releases/<界面版本>/`，分别切 `current`。它们的 systemd 单元来自各自包的 `services/*/systemd/`。

先部署代理：`/var/lib/materialsx-litellm/secrets.env` 为 `materialsx-litellm` 拥有、0600，含**独立库**的 `DATABASE_URL`、持久 `LITELLM_MASTER_KEY`、`LITELLM_SALT_KEY` 和已批准的静态路由供应商 Key；不写入发布包。以服务账户运行以下命令，`uv` 的实际路径需先在 ECS 核对：

```sh
export MX_LITELLM_RUNTIME=/var/lib/materialsx-litellm
UV_PROJECT_ENVIRONMENT="$MX_LITELLM_RUNTIME/.venv" uv sync --project \
  /opt/materialsx-litellm/current/services/litellm --locked --no-dev --python 3.12
node /opt/materialsx-litellm/current/services/litellm/manage.mjs render
node /opt/materialsx-litellm/current/services/litellm/manage.mjs check
node /opt/materialsx-litellm/current/services/litellm/manage.mjs migrate
node /opt/materialsx-litellm/current/services/litellm/manage.mjs validate
```

随后启 `materialsx-litellm.service`，核对 `curl http://127.0.0.1:4001/health/liveliness` 与 `/health/readiness`。`manage.mjs migrate` 会用本机 `pg_dump` 备份 LiteLLM 库并运行其固定版本 Prisma 迁移及 spend-log 索引；它不读取 MaterialsX 的 20 个 SQL 文件。4001 是**模型代理**，Go API 的 `MATERIALSX_LITELLM_URL` 应为 `http://127.0.0.1:4001`；不能写成 4000。

再启 `materialsx-litellm-console.service`，它只在 `127.0.0.1:4000` 提供品牌/中文 UI，转发至 4001；从 ECS 检查 `curl -I http://127.0.0.1:4000/ui/login/`。它没有独立数据库。4000 管理入口不由当前公共 Nginx 生成器暴露；仅通过运维 VPN/SSH 临时隧道使用，不把 Master Key 填到公开页面或日志。

## 6. 新模型发布 Worker 卡（可在初次预览时延后）

依赖卡 3 与卡 5。安装 LiteLLM 包内的 `materialsx-model-deploy.service`，其 `50-materialsx-model-deploy.rules` 仅授权服务账户重启 LiteLLM；先在 Ubuntu 上核对 polkit 规则与 systemd 单元名称。`/etc/materialsx/model-deploy.env` 使用 `mx_runtime` 的 MaterialsX 数据库 DSN、同一身份主密钥，并添加 `MX_LITELLM_RUNTIME=/var/lib/materialsx-litellm`、`MATERIALSX_MODEL_DEPLOY_RUNNER=/opt/materialsx-litellm/current/services/litellm/deploy-runner.mjs`、`MX_LITELLM_PORT=4001`。数据库表来自 `018_model_deploy_jobs.sql` 和 `019_model_deploy_catalog_guard.sql`，已由卡 3 的嵌入迁移创建；无需手工 `psql -f`。启动后只提交**内部测试模型**作业，检查 `queued → running → succeeded` 的真实回执与代理路由；`uncertain` 时先按 [OD.4](OD4_MODEL_DEPLOY.md)核对，禁止重复提交。

## 7. MOOS API、MOOS MCP、MaterialsX 研究服务卡

该卡要分三小步。**7A MOOS API：** MOOS 是另一个项目，本机真实目录 `/Users/user/Code/MOOS/`。只制作经过审核的 MOOS 私有源码/发布快照，勿把整目录的 PDF、数据库备份、`.env`、`node_modules` 一起打包。ECS 放 `/opt/moos/releases/<版本>/`；在 `go-backend/` 内用 Go 1.25 构建 `cmd/api` 与 `cmd/migrate`，配置 `APP_ADDR=127.0.0.1:8080`、其独立 `DATABASE_URL`、持久 `RUNTIME_DIR` 和资产目录。MOOS 默认 `APP_ADDR=:8080` 和本地开发库 DSN 都不适合公网。现有数据建议从原 MOOS 库完整备份/恢复；**新空库**才在 `go-backend/` 目录执行一次迁移。先让 API 在 ECS `127.0.0.1:8080` 正常返回 MOOS 既有状态/知识接口。MOOS 仓库目前没有可直接照搬的 MaterialsX systemd 发布单元，需单独制作并在 ECS 核验，不能把 `go run` 当长期服务管理器。

**7B MCP：** 本机 `MOOS/services/materials-mcp/` 要独立打包；在 ECS 的临时构建目录运行 `npm ci --ignore-scripts && npm run build && npm prune --omit=dev`，确认 Node 24+，再连同生产 `node_modules` 一起安装到 root 只读的 `/opt/moos/current/services/materials-mcp/`。`dist/src/server.js` 是 stdio MCP 入口，**不要**为它开公网端口或写单独 Nginx location；由研究服务按需启动子进程。先按其 README 测试 `moos_status`、带授权范围的 `moos_search` 与真实引用读取。

**7C 团队研究服务：** 在 Ubuntu 构建环境用 MaterialsX 冻结源码运行 `npm ci && npm run build:core`，打包 `dist/packages/`、`dist/scripts/agent/ua13-server.js`、根 `package.json`、`package-lock.json`；先在临时构建目录 `npm ci --omit=dev`，然后将完整目录安装到 `/opt/materialsx-team/releases/<版本>/` 并改为 root 只读，最后指向 `current`。[`materialsx-team.service`](systemd/materialsx-team.service) 使用 `/usr/bin/node`；先在 ECS 确认此路径对应 Node 24+。设置 `/etc/materialsx/team.env`：

```text
MATERIALSX_TEAM_PUBLIC_ORIGIN=https://api-staging.mx.jouhu.com
MATERIALSX_IDENTITY_URL=https://api-staging.mx.jouhu.com
MATERIALSX_TEAM_PORT=8793
MATERIALSX_TEAM_DATA=/var/lib/materialsx-team/team.sqlite
MATERIALSX_TEAM_TRUSTED_LOOPBACK_PROXY=1
MATERIALSX_MOOS_MCP_DIRECTORY=/opt/moos/current/services/materials-mcp
MATERIALSX_MOOS_ORIGIN=http://127.0.0.1:8080
```

安装 [`materialsx-team.service`](systemd/materialsx-team.service) 并启动。团队项目还需设置 MOOS 来源范围和账户 ACL；没有真实已授权记录时页面应显示不可用，不要伪造成功。**验收：** ECS 本机 `GET /v1/research/health`，再从有权账户经公网 API 域名搜索、读取真实配方组分/原始用量/页码；另一项目与撤销设备须被拒绝。`team.sqlite`、MOOS PostgreSQL 与科研资产目录分别备份，不要只备份 MaterialsX 账本库。若 MOOS 位于另一台主机，改用 [OD.3 私网 mTLS](OD3_MOOS_LINK.md)，不可把 8080 直接暴露公网。

## 8. Nginx 总路由卡：三个域名、两份配置

先在**本机**复制 `deploy/examples/staging.template.yaml` 到不入 Git 的私有位置，替换为三个拟定 HTTPS origin；将 `cloud.mode` 改为 `disabled`，保留 `payment.mode: disabled`、`researchData.mode: colocated`。`npm run config:check -- --manifest <绝对路径>` 通过后，将同一文件私下传至 ECS `/etc/materialsx/staging.yaml`。从 ECS 的**冻结源码运维目录** `/opt/materialsx-ops/current` 运行：

```sh
npm run config:check -- --manifest /etc/materialsx/staging.yaml
npm run config:edge -- --manifest /etc/materialsx/staging.yaml --out-dir /tmp/materialsx-edge-preview
```

生成的 `/tmp/materialsx-edge-preview/materialsx-edge.conf` 安装到 `/etc/nginx/conf.d/materialsx-edge.conf`，`admin-allow.conf` 安装到 `/etc/materialsx/edge/admin-allow.conf`；后者初始为 `deny all`，要先部署 VPN/身份网关才允许管理员网段。该生成文件负责 `api-staging`（`/v1/research/* → 8793`，其余公开 API → 8788）和 `admin-staging`（`/ops* → 8788`，其余 → 8790）；卡 2 的官网配置单独负责 `staging.mx.jouhu.com`。TLS 文件分别在 `/etc/materialsx/tls/api/`、`admin/`、`site/`。三个证书必须覆盖对应域名。确认 Nginx 默认站点没有占用 `443 default_server`；**仅保留一份** MaterialsX edge 生成配置。最后 `sudo nginx -t` 成功才 reload。

**外部验收：** 三个域名 DNS/TLS 正常；API 域名 `/ops` 与 `/v1/admin/*` 返回 404；未获准来源访问管理域名被拒绝；外部主机不能连接 `8788/8793/8790/4000/4001/8080/5432`。不能只用 ECS 本机 `curl` 证明公网隔离。

## 9. 微信回调、客户端与放量卡

微信支付**没有独立部署进程**：入口在 Go API 的 `/v1/payments/wechat/notify`，Nginx 将该精确路径转发到 8788，后续状态由卡 3 的 Worker 处理。本预览环境保持 `MATERIALSX_PAYMENT_MODE=disabled`，不创建真实订单。正式收费时才在**独立 production 环境**配置 `payment.mode: wechat-native`、正式商户材料、`MATERIALSX_WECHAT_NOTIFY_ORIGIN=https://api.mx.jouhu.com`、回调地址 `https://api.mx.jouhu.com/v1/payments/wechat/notify`，再走 OD.5/OD.7 的真实支付、单次发点和未使用订单退款验收。不要把 ngrok 诊断回调或本机商户材料复制过来。

桌面端本机用经审核的预览清单打包 `MATERIALSX_DEPLOY_MANIFEST=<私有清单绝对路径> npm run package:preview:<平台>`。打开包内 `materialsx-client.json` 核对 `apiOrigin=https://api-staging.mx.jouhu.com`、官网 origin 和渠道；分别安装 macOS、Windows、Linux 测试登录、本地 LLM、断网、研究读取和错误状态。**安装包不上 ECS**，只作为官网/GitHub Release 下载资产；更新官网 `website/releases/preview.json` 为这次实际包的文件名、字节数与 SHA-256 后重新构建卡 2。

## 10. 每张卡的交接记录与回滚

为每个模块记录：源码 commit/私有版本、包 SHA-256、ECS `current` 旧/新目标、配置摘要、迁移回执、systemd 状态、内部/外部探针、操作人和时间。换版只替换**对应模块**的 `current` 并重启相应服务；数据库不做自动 down migration。遇到未知供应商用量、支付通知或模型部署回执，先暂停新云调用/新销售，核对原请求与账本，不能自动重放。

**实际建议执行顺序：** 0 清单与包 → 1 数据库 → 2 官网 → 3 API/Worker → 4 计费 Web → 5 LiteLLM/中文界面 → 6 模型部署 Worker → 7 MOOS/研究服务 → 8 Nginx 公网入口 → 9 客户端/支付放量。允许在卡 3 后先开放“登录 + 本地模型”的受限预览；卡 7 未通过前，不声称 MOOS 配方可用；卡 9 的收费门禁未通过前，不开放销售。
