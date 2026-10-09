# MaterialsX 两台既有 ECS 小流量测试部署

状态：2026-10-09 最小部署已运行。官网静态站、Go API、计费 worker、独立计费 Web、LiteLLM 及其私有管理 UI、独立 PostgreSQL、私有隧道均已在各自主机运行。三个 A 记录已指向新 ECS；公网 443 起初超时，经绑定安全组规则生效后，外部访问三个域名均通过 TLS 验证，官网、API 健康、计费管理页和客户端配置返回 200。计费管理员 TOTP 登录、概览和系统状态通过，系统状态显示 LiteLLM `reachable`；LiteLLM 三个诊断模型别名可读取，服务进程被杀后由 systemd 自动拉起并恢复就绪。**云模型销售与真实支付仍显式关闭，未完成真实调用、价格、钱包和回调验收**。本部署只覆盖低流量测试，不承诺 1000 人并发。现有业务服务、数据库和 Nginx 配置不得被覆盖或重启。

## 分工和连接

| 位置 | 部署内容 | 对外暴露 |
| --- | --- | --- |
| 101.37.13.105（Ubuntu 16.04） | 独立 PostgreSQL 16 测试实例及独立库、LiteLLM 单 worker；隔离 Python 3.12 运行时 | 保留现有 SSH；新数据库 5432、代理 4001 仅监听 `127.0.0.1`，不放通公网 |
| 8.210.238.191（Ubuntu 24.04） | 预构建的官网静态文件、Go API、支付/用量 worker、独立计费 Web、私有 LiteLLM 管理 UI | 仅三个域名的 Nginx 80/443，内部服务仅监听本机 |
| 用户桌面 | MOOS MCP 和本地资源 | MOOS 论文、原始数据、完整 MOOS 后端均不上传 |

新 ECS 到旧 ECS 的 SSH 22 已实测可达。新 ECS 使用专用、限制转发目标的 SSH 账户与持久隧道，将其 `127.0.0.1:15432` 映射到旧 ECS 的 `127.0.0.1:5432`，将 `127.0.0.1:4001` 映射到旧 ECS 的 `127.0.0.1:4001`。隧道断开时 API 必须报错并停止云端调用，不能换用明文公网连接。PostgreSQL 启用 TLS，Go 侧按隧道终点 IP 做 `verify-full` 并使用独立 CA。LiteLLM 及 MaterialsX 分别使用独立数据库和账号；Go API 使用单独的受限运行角色，不使用迁移库主角色。给定的共享 RDS 保持原状，不迁移或修改其已有库。

## 资源限额与启动次序

只读盘点时，新 ECS 7.1 GiB 内存仅约 1.1 GiB available、40 GiB 盘仅约 8.8 GiB 空余；旧 ECS 8 GiB 内存约 4.3 GiB available、约 48 GiB 空余。以上是瞬时值，不能直接当作稳定容量。旧机 PostgreSQL 16.13 已运行；LiteLLM 在隔离的 Python 3.12 musl 解释器上运行，Prisma CLI 使用隔离的 Node 16，仅供旧系统的数据库迁移。运行依赖来自探针阶段的冻结包快照，`uv` 重新安装因该主机到 PyPI 的连接缓慢而未完成；当前锁文件中的 `pyroscope-io` 无 musl 包，测试运行时跳过了它。LiteLLM 已连接专用数据库，并通过 `/health/liveliness`、`/health/readiness` 和三个模型列表检查，实测进程约 465 MiB。这是可回滚的小流量预览环境，**不是可复现的正式付费发行包**；收款前须重做锁文件兼容、离线构建、供应商调用与并发峰值验收。

部署时为 MaterialsX 各 systemd 单元设置 `MemoryMax` 与 `TasksMax`；独立 PostgreSQL 上限 512 MiB，LiteLLM 上限 1536 MiB；新机 API、worker、计费 Web、私有 UI、隧道上限分别为 256、192、192、128、64 MiB。最终实测：新机 MaterialsX 常驻进程合计约 188 MiB、空余磁盘约 8.4 GiB、available 内存约 972 MiB；旧机 LiteLLM 约 465 MiB、PostgreSQL 约 73 MiB、空余磁盘约 45 GiB、available 内存约 3.9 GiB。不上传安装包、MOOS 论文或开发依赖；保留新机至少 5 GiB 系统盘空余。

已安装的测试实例：旧机 `/opt/materialsx-postgresql/16.13`、`/var/lib/materialsx-postgresql/data` 和 `materialsx-postgresql.service`，仅监听 `127.0.0.1:5432`；新建 `mx_control_plane` 与 `mx_litellm` 两库、独立随机凭据保存在旧机 root-only 的 `/var/lib/materialsx-postgresql/bootstrap/roles.env`，不得上传仓库。旧机另有隔离的 `/opt/materialsx-musl/1.2.5` 与 `/opt/materialsx-musl-libs/1.2.2`，并新增此前不存在的 `/lib/ld-musl-x86_64.so.1` 链接供测试 Python 执行，未替换系统 glibc/Python。新机 `materialsx-private-tunnel.service` 以受限 SSH 账户连接旧机，监听 `127.0.0.1:15432` 和 `127.0.0.1:4001`；数据库 CA 存于 `/etc/materialsx-pg/ca.crt`。实测隧道重启后恢复，PostgreSQL TLS 证书与 IP SAN 验证通过。该实例的测试 CA 一年有效，续期及备份应在正式收款前配置。

## 域名和启用门槛

`mx.jouhu.com`、`api.mx.jouhu.com`、`admin.mx.jouhu.com` 的 A 记录已指向 `8.210.238.191`。从旧 ECS 通过加密通道复制的 `*.jouhu.com` 证书保存在新机 `/etc/materialsx/tls/site/`，仅作为备份；它不覆盖深层子域名。当前三个站点分别使用 Let's Encrypt 的有效证书：官网 `/etc/materialsx/letsencrypt/live/materialsx-site/`，API/计费管理 `/etc/materialsx/letsencrypt/live/materialsx-api-admin/`；`materialsx-cert-renew.timer` 每日续期检查，部署钩子在证书实际更新后 reload Nginx。三个站点的本机及公网 SNI/TLS 验证均通过，独立站点的公网 80 ACME 路由可达。

新机只增加了 `/etc/nginx/conf.d/materialsx-two-host-boot-http.conf` 这一份 MaterialsX 虚拟主机配置；未覆盖现有站点配置。官网对应 `/var/www/materialsx/current`，API 反向代理至 `127.0.0.1:8788`，独立计费 Web 至 `127.0.0.1:8790`。API 域名对 `/ops` 与 `/v1/admin/` 返回 404，计费管理入口由独立 Web 代理，管理员账号必须使用 TOTP。新数据库初始管理员凭据只存放在新机 root-only 的 `/etc/materialsx/secrets/initial-admin.json`，不得复制到仓库或日志。

LiteLLM 只监听旧机 `127.0.0.1:4001`；私有管理 UI 在新机 `127.0.0.1:4000`，通过 SSH 隧道访问，不设置公网 Nginx 路由。当前官网继续链接 GitHub 的 `0.3.0-preview.1` 安装包；该包内 `materialsx-client.json` 的 `apiOrigin` 为 `null`，不能用它验收新公网账户/钱包。接入正式云端前须另发绑定 `https://api.mx.jouhu.com` 的新预览包。

按“数据库与隧道 → LiteLLM 健康及真实用量 → API/worker → 计费管理 → 官网/DNS/TLS → 小额支付与退款”逐步验收。支付和云模型销售开关必须等回调验签与幂等、账本入账、模型响应、用量最终结算、供应商实际成本、退款全链路核对通过后才打开。任何一步失败，只停 MaterialsX 对应单元并回退 MaterialsX 的 DNS/Nginx 路由，不处理现有业务服务。此资源规模仅适合受控小流量试用；达到内存限额即暂停扩容流量。
