# MaterialsX 0.3 正式环境：与现有服务共用服务器

本流程直接部署到正式域名，不建立 staging。目标服务器已有服务和 PostgreSQL 数据库；所有 MaterialsX 进程、数据库、角色、目录、Nginx 虚拟主机都必须独立命名。本文是部署步骤，不代表已开放充值。

**2026-10-09 现场结论：不能在当前 Ubuntu 16.04 ECS 上按本流程安装正式后端。** 它使用内核 4.4、glibc 2.23、Node 8、Python 3.5；目前共享 RDS 关闭 SSL。Node 22 的正式 Linux 构建要求更高的内核/glibc，MaterialsX 正式身份服务拒绝未验证的数据库 TLS。保留旧 ECS 与其现有服务，新增同 VPC 的 Ubuntu 22.04/24.04 ECS 承载 MaterialsX 全部后端和独立 PostgreSQL，是不干扰现有服务的方案。旧 ECS 可继续承载其他业务；若必须让它充当 MaterialsX 公网入口，需要另行设计经 TLS 验证的双层反向代理和管理准入。更简洁的正式做法是将三个 MX 域名在新 ECS 验收后直接切到新 IP。

拟用三个域名：`mx.jouhu.com`（官网与下载）、`api.mx.jouhu.com`（用户 API 与支付通知）、`admin.mx.jouhu.com`（计费管理与 `/ops`）。实际启用前核对域名控制权、DNS、证书覆盖范围与续期。LiteLLM、MOOS、PostgreSQL 和内部服务不单独开放公网域名。

## 1. 先做只读现场盘点

取得新 ECS 的 SSH 地址、端口、登录账户及认证方式和 sudo 权限。PostgreSQL 可在新 ECS 独立安装并配置 TLS，或使用已有 TLS 的独立 RDS；若用共享 RDS，须先在不会影响其他业务的维护窗口启用 SSL。凭据只存服务器或操作机的私有文件，不写入仓库、命令历史、日志或聊天回显。首次 SSH 连接核对主机指纹。

在服务器检查 `uname -m`、系统版本、可用内存/磁盘、`ss -lntp`、`systemctl --type=service --state=running`、`nginx -T`、已有证书及续期方式、PostgreSQL 版本和**库名/角色名清单**。禁止为盘点导出其他应用的数据或密钥。记录 443 默认虚拟主机、现有 `server_name`、监听端口和需要避让的目录。所有写操作都以这份盘点为前提；发生端口/域名冲突时调整 MaterialsX 清单与服务，不改动现有服务。

## 2. 固定并构建本次正式发布物

冻结完整源码快照与私有的计费 Web、LiteLLM、MOOS 发布物，记录各自版本和 SHA-256。当前仓库版本 `0.3.0-preview.1`，正式安装包须升为无 `-preview` 后缀的新版本，绑定正式清单重新构建、签名并在 macOS/Windows/Linux 实机验证；不能把现有预览安装包标为正式版。独立组件分别放在自己的发布目录，不写进 Go 服务或公开仓库。详细构建与单元路径见 [阿里云 SSH 手册](ALIYUN_UBUNTU_SSH_RUNBOOK.md)。

在仓库外或 Git 忽略的私有运行目录保存正式清单，初次保持 `cloud.mode: disabled`、`payment.mode: disabled`、`releaseChannel: stable`。执行：

```sh
npm run config:check -- --manifest /path/to/production.yaml
npm run config:edge -- --manifest /path/to/production.yaml --out-dir /path/to/generated-edge --existing-nginx
```

`--existing-nginx` 不生成新的 443 `default_server`，以免覆盖服务器现有默认站点。生成文件仍含 `http {}` 级 `map`/`log_format` 定义；安装前通过 `nginx -T` 核对是否已有同名定义，再添加独立的 MaterialsX 配置文件。证书路径要按真实服务器的证书文件配置。官网静态站需要单独配置，生成器只处理 API 与管理域名。`admin-allow.conf` 默认拒绝访问，必须先验证管理 VPN/身份网关，再填入获准网段。先 `nginx -t`，通过后原子重载，并复测现有站点。

## 3. 分开安装数据库和进程

为 MaterialsX 控制面、LiteLLM 和需要独立存储的研究服务新建数据库与受限运行角色；仅授予各自数据库权限。不删除、更名、替换或迁移服务器上任何已有数据库。生产 PostgreSQL 连接要满足应用的 TLS 主机名验证要求。先备份新库并执行应用迁移，再以受限账户做只读检查。详见 [数据库和进程手册](ALIYUN_UBUNTU_SSH_RUNBOOK.md) 与 [正式上线核对](GO_LIVE_CHECKLIST.md)。

各模块以独立 systemd 单元和专用运行账户安装，监听地址优先为 `127.0.0.1`；端口与现有服务冲突时更新清单、环境文件和边缘配置后重新校验。保存旧 `current` 指向与新库备份，以便只回滚 MaterialsX 进程。先启动数据库连接、LiteLLM 与管理 UI，再启动 API/Worker、计费 Web、研究服务和 MOOS。首次上线保持注册、云调用及销售暂停，真实支付通知入口虽然预置路由，但不应在商户与账本验收前开放新订单。

## 4. 正式域名验收与逐项开放

从外部核对三个域名的 DNS/TLS、官网及下载链接、登录、管理准入、API 健康、错误 Host/Origin、支付通知验签，以及内部端口不可达；从管理网络核对 TOTP、计费权限、LiteLLM 模型目录和 MOOS ACL。做一笔获批准的小额真实订单，核对回调幂等、MX 点只入账一次、模型响应和用量最终结算、供应商真实账单、退款与余额。任何用量不明或账本不平，保持销售暂停并核对原请求，不能自动重试供应商调用。

只有上述运行回执、备份恢复演练、监控告警、三平台安装验收与 [OD.5 生产支付门禁](OD5_MX_PRODUCTION.md) 完成后，才把清单和服务端开关改成正式云/支付模式，更新对应价格与路由版本，并执行 [OD.7](OD7_ROLLOUT.md) 的生产门禁。没有 staging 时，使用 `direct-read-only → research → canary-model → wallet → orders`，首阶段同时提交原 staging 所需的全部现场回执及正式只读登录回执；不能伪造 staging 回执。后续阶段仍校验同一生产清单、数据库/凭据/账本绑定及操作开关。上线后的回滚只停止 MaterialsX 新请求和销售，继续处理已有订单、通知、结算与退款；不回滚或清空共享 PostgreSQL 实例。
