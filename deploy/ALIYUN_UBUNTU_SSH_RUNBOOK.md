# 阿里云 Ubuntu 单机首发：SSH 部署手册

本手册面向一台 Ubuntu ECS，先部署 **preview / 不收费** 环境。公网地址示例采用 `staging.mx.jouhu.com`、`api-staging.mx.jouhu.com`、`admin-staging.mx.jouhu.com`；正式域名与完整放量顺序仍以 [mx.jouhu.com 部署流程](MX_JOUHU_COM_DEPLOYMENT.md) 和 [OD.7](OD7_ROLLOUT.md) 为准。一台 ECS 不能同时把现有 staging、production 两份边缘配置直接加载到一个 Nginx：它们都有 `default_server` 及同名全局指令。正式收费前需独立的 staging 环境与回执；本手册不会自动打开注册、云调用或销售。

## 1. 部署前填写

| 项目 | 填入实际值；不要写密钥到本文 |
| --- | --- |
| ECS | 地域、实例 ID、公网 IP、私网 IP、Ubuntu 版本、`uname -m`、磁盘剩余空间 |
| SSH | 登录用户、私钥文件路径、允许访问 22 的固定公网 IP/CIDR |
| 域名 | preview 官网、API、管理员三条 A/AAAA 记录；证书及续期责任人 |
| 数据 | MaterialsX PostgreSQL 与 LiteLLM 独立库、各自迁移/运行角色、TLS CA、异机备份位置 |
| 科研 | MOOS API 与 `materials-mcp` 位于 ECS 同机还是私网另一台；项目 ACL 验收账户 |
| 运营 | 管理 VPN/身份网关、监控接收人、回滚操作人、发行版本与上一个可用版本 |

本项目要求 Node.js `>=22.19.0`（根 `package.json`）、Go `1.25`（`services/control-plane/go.mod`）、LiteLLM 独立环境 Python 3.12。以目标机器 `uname -m` 选择 `linux-amd64` 或 `linux-arm64` Go 包；**macOS 的 `node_modules`、Python 虚拟环境和安装包不能直接搬到 Ubuntu**。Node 发行文件和校验值可从 [Node.js 官方归档](https://nodejs.org/en/download/archive/v22)取得。

生产身份服务会拒绝未做 `sslmode=verify-full` 且主机名未验真的 PostgreSQL DSN；本机普通无 TLS 的 `postgres/postgres` 仅适合开发。阿里云 RDS PostgreSQL 可使用同地域、同 VPC 的内网连接和受控白名单，并按[官方 SSL 说明](https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/configure-ssl-encryption-for-an-apsaradb-rds-for-postgresql-instance)配置证书。若数据库也装在 ECS 上，仍须配置具有可验证 DNS 名称的 PostgreSQL TLS 证书和独立受限角色，不能以 `sslmode=disable` 绕过代码检查。

## 2. 模块与唯一运行入口

| 模块 | 首发运行方式 | 网络边界 |
| --- | --- | --- |
| 官网 | `website/dist/` 静态文件，由 Nginx 提供 | preview 官网 443 |
| 用户 API、登录、钱包、微信回调、`/ops` | `bin/identity`，`materialsx-api.service` | 本机 8788；经 API/管理域名转发 |
| 支付、用量、通知恢复 | `bin/worker`，`materialsx-worker.service` | 不监听公网端口 |
| 研究数据/MOOS MCP | `dist/scripts/agent/ua13-server.js`，`materialsx-team.service` | 本机 8793；仅 `/v1/research/*` 转发 |
| 模型发布作业 | `bin/modeldeploy`；见 [OD.4](OD4_MODEL_DEPLOY.md) | 内部 Worker，不监听公网 |
| LiteLLM 代理与品牌管理 UI | 独立 Python/Node 发布包及各自 systemd | 本机 4001/4000；4000 也不对普通公网开放 |
| 计费管理 Web | `dist/billing-admin` 发布包及其 systemd | 本机 8790；经受保护管理域名访问 |
| 客户端 | macOS/Windows/Linux 安装包 | **不在 ECS 上运行 Electron**；包内只有一个 API origin |

微信通知由 Go API 的 `/v1/payments/wechat/notify` 接收，**没有单独的回调守护进程**。旧 8787 服务及旧订阅桌面桥接已删除；不要部署 `deployment/m5` 的历史入口。Go API/Worker 的当前 Ubuntu 单元在 [`deploy/systemd/`](systemd/)。计费 Web 和 LiteLLM 的独立单元分别在 `services/billing-admin/systemd/`、`services/litellm/systemd/`、`services/litellm-console/systemd/`。这些私有服务目录被 `.gitignore` 排除，**仅克隆公开 Git 仓库不足以重建服务器**；须另行传输已审核的私有发布包。

## 3. ECS 网络与 SSH

1. 阿里云安全组入方向只给固定运维 IP 开 22，给公网开 443；80 仅在实际采用 HTTP 证书验证时临时开放。删除默认安全组中对所有 IP 开放的 22/3389。阿里云[安全组规则](https://help.aliyun.com/zh/ecs/user-guide/security-group-rules)和[默认规则](https://help.aliyun.com/zh/ecs/user-guide/default-security-groups)需在 ECS 控制台逐条核对。
2. 使用密钥对 SSH。首次连接核对服务器指纹；`ssh -i <私钥路径> <用户名>@<ECS公网IP>`。先保持已有 SSH 会话，再配置 Ubuntu UFW 和测试第二个 SSH 会话，避免把自己锁在实例外。Ubuntu 的 UFW 说明见[官方文档](https://documentation.ubuntu.com/server/how-to/security/firewalls/index.html)。
3. 服务器公网入站不得放通 8788、8793、8790、4000、4001、5432、8080。MOOS 如跨主机，只在 VPC 内按 [OD.3 私网连接](OD3_MOOS_LINK.md)处理。管理员域名默认 `deny all`，待 VPN/身份网关实际启用后再添加批准网段。

在 ECS 上核对基础环境：

```sh
uname -m
cat /etc/os-release
node --version
go version
python3.12 --version
ss -lntp
df -h
```

如版本不满足本节要求，先按官方发行渠道安装并核对版本；不要用仓库内旧 macOS `launchd` 命令启动 Ubuntu 服务。

新 ECS 可先安装基础工具；先检查实例已有包与系统镜像，再执行：

```sh
sudo apt-get update
sudo apt-get install -y nginx ca-certificates postgresql-client rsync
```

## 4. 冻结并构建发布物（开发机/受控构建机）

当前工作区有未提交变更。先审查并冻结确切 commit、版本、依赖锁文件和私有组件版本；**不要**从旧 `HEAD` 打包而丢失本轮 OD 代码。下面只生成发布物，不向 GitHub 公开源码或密钥。

```sh
npm ci
npm run check
npm test
go -C services/control-plane test ./...
npm run config:test
npm run od6:test
npm run od7:test
npm run build:core
npm run build:admin
npm run mx03:release:go -- linux-amd64  # aarch64 机器改为 linux-arm64
npm run build:billing-admin
node services/litellm/build-release.mjs
npm run litellm:console:release
npm run mx03:release:audit -- linux-amd64
```

Go 发布包版本现从根 `package.json` 读取，不再写死旧版本。核对 `dist/control-plane/v<版本>-linux-<架构>.tar.gz` 内的 `bin/identity`、`identityctl`、`worker`、`modeldeploy` 和 `admin/`，并保存 SHA-256。计费包为 `dist/billing-admin/`，须包含 `release.json`、`manage.mjs`、`server.mjs` 与静态资源。LiteLLM 和管理 UI 各有独立 `.tar.gz` 与 SHA-256；不能把运行目录、`secrets.env`、PEM、数据库备份或用户科研资料放入发布物。

团队服务需在 **Ubuntu 构建环境** 对冻结源码运行 `npm ci && npm run build:core`，将 `dist/packages/`、`dist/scripts/agent/ua13-server.js`、根 `package.json` 和 `package-lock.json` 放进私有团队包，再在目标 Ubuntu 上安装生产依赖。启动前确认 `MATERIALSX_MOOS_MCP_DIRECTORY/dist/src/server.js` 来自单独审核的 MOOS 发布物。MOOS 本体或数据库不在此仓库中，不能凭本仓库包假设研究服务已可用。

Ubuntu 构建机制作团队包的示例：

```sh
VERSION=$(node -p "require('./package.json').version")
mkdir -p runtime/deployment
tar -czf "runtime/deployment/materialsx-team-${VERSION}.tar.gz" \
  package.json package-lock.json dist/packages dist/scripts/agent/ua13-server.js
tar -tzf "runtime/deployment/materialsx-team-${VERSION}.tar.gz" | head
```

安装包要重新构建；旧 `0.3.0-preview.1` 包早于本轮改动。preview 客户端必须绑定获审的 preview 清单：`MATERIALSX_DEPLOY_MANIFEST=<私有清单绝对路径> npm run package:preview:<平台>`。分别解包核对 `materialsx-client.json` 的 API origin 与发行渠道。官网下载链接要等安装包、SHA-256 和 `website/releases/preview.json` 一致后再发布，见 [OD.6](OD6_RELEASE_OPERATIONS.md)。

## 5. 私有传输与服务器目录

使用 SSH/SCP 或 rsync 将**发布包**送到 ECS 的临时上传目录，先核对本地与远端 SHA-256；SSH 私钥只留在操作机。示例中的变量由操作员填入，不写在仓库：

```sh
export MX_SSH_TARGET='<用户名>@<ECS公网IP>'
VERSION=$(node -p "require('./package.json').version")
PLATFORM='linux-amd64'  # 根据目标机器 uname -m 调整
ssh "$MX_SSH_TARGET" 'mkdir -p ~/materialsx-upload'
rsync -av "dist/control-plane/v${VERSION}-${PLATFORM}.tar.gz" \
  "$MX_SSH_TARGET:~/materialsx-upload/"
ssh "$MX_SSH_TARGET" 'sha256sum ~/materialsx-upload/*.tar.gz'
```

同法传团队、LiteLLM、管理 UI、计费 Web 包和官网静态资源。目标路径固定如下，便于独立升级和回滚：

```text
/opt/materialsx-control-plane/releases/<版本>/  → current/
/opt/materialsx-team/releases/<版本>/           → current/
/opt/materialsx-litellm/releases/<版本>/        → current/
/opt/materialsx-litellm-console/releases/<版本>/→ current/
/opt/materialsx-billing-admin/releases/<版本>/  → current/
/var/www/materialsx-preview/<版本>/             → current/
/opt/materialsx-ops/releases/<版本>/             → current/；仅部署脚本/清单操作
/etc/materialsx/      私有 env、审批、证书、清单；不进入发布包
/var/lib/materialsx*/ 运行状态、日志、快照；不随代码目录切换
```

在服务器以 root 创建专用系统账户、目录和权限。`materialsx` 运行 API/Worker，`materialsx-team` 运行研究服务，LiteLLM 与计费 Web 各自使用专用账户。发布目录由 root 持有且服务账户只读；私有环境文件由 systemd 读取，密钥材料只授予对应服务账户。解包前检查 `tar -tf` 不含绝对路径、`..` 或意外文件；切换 `current` 前保留旧目标和数据库备份。

全新主机的账户示例；已存在的用户先核对 UID/GID 和目录属主，不重复创建：

```sh
sudo useradd --system --home-dir /var/lib/materialsx --shell /usr/sbin/nologin materialsx
sudo useradd --system --home-dir /var/lib/materialsx-team --shell /usr/sbin/nologin materialsx-team
sudo useradd --system --home-dir /var/lib/materialsx-litellm --shell /usr/sbin/nologin materialsx-litellm
sudo useradd --system --home-dir /var/lib/materialsx-billing-admin --shell /usr/sbin/nologin materialsx-billing
sudo install -d -o materialsx -g materialsx -m 0700 /var/lib/materialsx
sudo install -d -o materialsx-team -g materialsx-team -m 0700 /var/lib/materialsx-team
sudo install -d -o materialsx-litellm -g materialsx-litellm -m 0700 /var/lib/materialsx-litellm
sudo install -d -o materialsx-litellm -g materialsx-litellm -m 0700 /var/lib/materialsx-litellm-console
sudo install -d -o materialsx-billing -g materialsx-billing -m 0700 /var/lib/materialsx-billing-admin
```

`config:check`、`config:edge`、`od6:observe`、`od7:gate` 需要仓库内的部署脚本；独立服务包不包含这些命令。先把**已冻结且已提交**的受控源码快照经 SSH 私下传至 `/opt/materialsx-ops/releases/<版本>`，在那里运行 `npm ci --omit=dev`，用只读 `current` 链接供运维执行。示例可从冻结 commit 执行 `git archive --format=tar.gz -o runtime/deployment/ops-source.tar.gz HEAD`，检查 `tar -tzf` 和 SHA-256，再传输；`git archive` 不含未提交代码和被 `.gitignore` 排除的私有服务，因此本步骤必须在本轮改动提交后执行，私有服务另传独立包。操作目录仅授权运维，不通过 Nginx 提供文件下载。

Go 发布包安装示例（在 ECS 上，先填入 `VERSION` 与架构）：

```sh
VERSION='0.3.0-preview.1'
PLATFORM='linux-amd64'
sudo install -d -m 0755 "/opt/materialsx-control-plane/releases/v${VERSION}"
tar -tzf "$HOME/materialsx-upload/v${VERSION}-${PLATFORM}.tar.gz" | head
sudo tar -xzf "$HOME/materialsx-upload/v${VERSION}-${PLATFORM}.tar.gz" \
  -C "/opt/materialsx-control-plane/releases/v${VERSION}"
sudo chown -R root:root "/opt/materialsx-control-plane/releases/v${VERSION}"
sudo ln -s "/opt/materialsx-control-plane/releases/v${VERSION}" "/opt/materialsx-control-plane/current.next"
sudo mv -Tf "/opt/materialsx-control-plane/current.next" "/opt/materialsx-control-plane/current"
```

版本号必须来自本次真实发布包，而不是照抄示例。升级前先用 `readlink -f /opt/materialsx-control-plane/current` 记录旧目标。团队包先在非 root 的临时构建目录解压并执行 `npm ci --omit=dev`，再整体复制到 `/opt/materialsx-team/releases/<版本>`、改为 root 只读并切换 `current`；不要让运行服务账户拥有可改写的源码。LiteLLM、管理 UI 和计费 Web 各自按独立发布包清单安装，不能把它们覆盖到 Go `current` 目录。

## 6. 私有配置、数据库与服务启动

1. 在 ECS 的运维操作目录中，复制 `deploy/examples/staging.template.yaml` 到仓库外 `/etc/materialsx/staging.yaml`，替换三条 `.invalid` origin。首轮把模板的 `cloud.mode: alpha` 改为 `cloud.mode: disabled`，保持 `payment.mode: disabled`，再从 `/opt/materialsx-ops/current` 执行 `npm run config:check -- --manifest /etc/materialsx/staging.yaml`。清单不含密钥，但运维账户须有读取权限；可设为 root 与专用运维组可读，不能让 Web 服务用户改写。服务端同时设置 `MATERIALSX_CLOUD_MODE=disabled`；不要把旧本机 RootFlowAI Key 搬进安装包。以后做受控云模型测试时，先验证供应商路由与价格，再把清单及服务端一同改为 `alpha`，保持运营云调用暂停，生成新清单摘要和回执。
2. 用独立迁移角色和真实 TLS 验证的数据库 DSN，先做加密备份，再运行 `bin/identityctl -command migrate`；使用 `-command grant-runtime -role <受限数据库角色>` 授权，之后以运行角色执行 `-command check`。MaterialsX 与 LiteLLM 采用独立数据库和角色；LiteLLM 另按其 `manage.mjs migrate` 流程迁移。数据迁移不得靠应用启动时自动完成。
3. 创建 `/etc/materialsx/api.env`、`worker.env`、`team.env`，分别只含该进程需要的变量。API 至少需 `MATERIALSX_ENV=production`、`MATERIALSX_IDENTITY_ADDR=127.0.0.1:8788`、`MATERIALSX_IDENTITY_PUBLIC_URL=https://api-staging.mx.jouhu.com`、TLS 验证的 `MATERIALSX_DATABASE_URL`、持久的 `MATERIALSX_IDENTITY_MASTER_KEY`、`MATERIALSX_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128`、`MATERIALSX_SIGNUP_ENABLED=0`、`MATERIALSX_CLOUD_MODE=disabled`、`MATERIALSX_PAYMENT_MODE=disabled`、`MATERIALSX_ADMIN_ASSET_DIR=/opt/materialsx-control-plane/current/admin`。若启用计费 Web，还需同一个管理 origin 与 32 字符以上的私有代理令牌。Worker 使用同一环境标识、数据库和主密钥；模型发布 Worker 另见 OD.4。
4. 团队服务的 `MATERIALSX_TEAM_PUBLIC_ORIGIN` 与 API origin 相同，`MATERIALSX_IDENTITY_URL` 指向同一公开 origin，`MATERIALSX_TEAM_PORT=8793`，`MATERIALSX_TEAM_DATA=/var/lib/materialsx-team/team.sqlite`，`MATERIALSX_TEAM_TRUSTED_LOOPBACK_PROXY=1`，并指定审核后的 MOOS MCP 目录。没有 MOOS 发布物时先不启动团队服务，研究功能保持不可用。跨机 MOOS 使用 OD.3 的私网 mTLS，原始 8080 不开放公网。
5. 安装 [`deploy/systemd/`](systemd/) 的 API、Worker、团队单元以及各独立组件自带的单元；检查 ExecStart 路径、账户、环境文件权限和 `systemd-analyze verify`。执行 `systemctl daemon-reload`，先启动数据库/代理，再启动 API/Worker，最后团队服务和受保护的计费 Web。`journalctl -u <单元名>` 排障时勿把完整环境变量或凭据写入工单。

```sh
sudo install -m 0644 /opt/materialsx-ops/current/deploy/systemd/materialsx-api.service /etc/systemd/system/
sudo install -m 0644 /opt/materialsx-ops/current/deploy/systemd/materialsx-worker.service /etc/systemd/system/
sudo install -m 0644 /opt/materialsx-ops/current/deploy/systemd/materialsx-team.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/materialsx-{api,worker,team}.service
sudo systemctl daemon-reload
sudo systemctl enable --now materialsx-api.service materialsx-worker.service
# MOOS 包与 team.env 均已验证后，再启用 materialsx-team.service。
```

服务内网探针（在 ECS 上执行，替换为当前 API Host）：

```sh
curl -fsS -H 'Host: api-staging.mx.jouhu.com' http://127.0.0.1:8788/health/live
curl -fsS -H 'Host: api-staging.mx.jouhu.com' http://127.0.0.1:8788/health/ready
curl -fsS -H 'Host: admin-staging.mx.jouhu.com' http://127.0.0.1:8790/healthz
curl -fsS http://127.0.0.1:4001/health/readiness
ss -lntp
```

`ready` 503 时检查其分项原因；不要因为 `live` 成功就放开客户端。运营状态还须核对 `cloud_paused=true`、`sales_paused=true` 的**数据库实际值**。

## 7. HTTPS 边缘、官网与验收

1. 安装并检查 Nginx；在证书真实存在后从 `/opt/materialsx-ops/current` 运行 `npm run config:edge -- --manifest /etc/materialsx/staging.yaml --out-dir "$HOME/materialsx-generated-edge"`，不要用 root 执行 npm。生成的 `materialsx-edge.conf` 必须位于 Nginx 的 `http {}` 内；将 `admin-allow.conf` 放到 `/etc/materialsx/edge/`，初始保持 `deny all`。证书路径按生成文件准备 `/etc/materialsx/tls/api/` 和 `/etc/materialsx/tls/admin/`。官网需独立的静态 `server` 块及其证书，不由 `config:edge` 生成。默认 Ubuntu Nginx 的 `conf.d/*.conf` 位于 `http {}` 内；先核对本机 `/etc/nginx/nginx.conf`，再安装配置。测试 `nginx -t` 后才重载。

```sh
sudo install -m 0644 "$HOME/materialsx-generated-edge/materialsx-edge.conf" \
  /etc/nginx/conf.d/materialsx-edge.conf
sudo install -d -m 0750 /etc/materialsx/edge
sudo install -m 0644 "$HOME/materialsx-generated-edge/admin-allow.conf" \
  /etc/materialsx/edge/admin-allow.conf
sudo nginx -t
sudo systemctl reload nginx
```

若系统自带 `/etc/nginx/sites-enabled/default` 也占用 `443 default_server`，先审查并禁用冲突站点，再 `nginx -t`；不要同时加载 staging 与 production 的生成文件。官网另建静态站点，例如：

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

把静态站点保存为 `/etc/nginx/conf.d/materialsx-site.conf` 后再次执行 `nginx -t` 和 reload。证书申请/续期方案由现场选定并验证；证书文件不进入网站目录或 Git。
2. 安装 preview 官网静态文件并用 `SITE_ORIGIN=https://staging.mx.jouhu.com`、`SITE_BASE_PATH=/`、`MATERIALSX_SITE_RELEASE_CHANNEL=preview` 构建；首页、语言切换、下载清单、缓存和图标逐项核对。
3. 从 ECS **外部**运行 DNS/TLS 与端口检查：公开 443 正常，8788/8793/8790/4000/4001/5432/8080 不可直连，管理域名对非 VPN/身份网关来源拒绝。执行 `npm run od7:public-probe` 和 `npm run od6:observe`；随后用真实安装版检查登录、断网、本地模型、研究检索、流式调用和可追溯计费回执。首发可先只验证登录/本地模型，其他未就绪能力在 UI 明确显示不可用。
4. 保存清单摘要、包哈希、健康输出、外部端口结果、系统日志关联 ID 和备份回执。OD.7 需要的 staging/production 隔离与完整场景未具备时，只标记为单机 preview，不能标记正式收费通过。

## 8. 回滚与交接

上线前记录每个模块 `current` 原先指向的 release。故障时先暂停新云调用与新订单，保留已存在的通知、结算和退款 Worker；再把受影响模块的 `current` 原子切回旧版本并重启对应 systemd 单元。**不要**自动执行数据库 down migration，不重放结果待核对的供应商请求。LiteLLM 配置还需按其快照回滚并核对旧模型别名。最后复核账本、目录版本、登录和健康探针，并记录 [OD.6 发布审计](OD6_RELEASE_OPERATIONS.md)。

交接给现场操作员时仍需提供：ECS SSH 用户/IP、DNS 控制权、证书方案、数据库与 CA、MOOS 拓扑、各私有发布包、监控/备份位置以及两名可执行回滚的负责人。本文不含也不请求任何明文密钥。
