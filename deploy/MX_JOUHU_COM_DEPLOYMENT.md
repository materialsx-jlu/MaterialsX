# MaterialsX 最终部署流程：mx.jouhu.com

本文把 `mx.jouhu.com` 作为拟定的正式官网域名。域名、服务器、证书和商户状态仍须现场核验；本文是执行顺序，不是已完成的上线回执。以仓库中的 [配置说明](README.md)、[OD.7 门禁](OD7_ROLLOUT.md) 和 [发布前核对](GO_LIVE_CHECKLIST.md) 为实际约束。

若当前只有一台阿里云 Ubuntu ECS，先按 [SSH 单机 preview 手册](ALIYUN_UBUNTU_SSH_RUNBOOK.md)部署；本文件描述后续独立 staging 与 production 的正式路径。

下文 `npm run` 命令默认在持有本仓库发布快照的部署操作机执行；数据库迁移和 `nginx -t` 在对应 staging/production 主机执行。OD.7 门禁操作机需同时持有两份**不含密钥**且经审核的清单及所引用的私有证据；不要把生产凭据复制到 staging 主机。示例中的 `/etc/materialsx/` 和 `/var/lib/materialsx/od7/` 是目标路径，实际路径一旦确定应在所有命令中一致。

## 0. 先确定本次发布边界

首轮只发布**开发预览版**：官网、隔离的 staging API、测试账户和本地模型可以开放验证；正式收款和面向普通用户的付费云模型保持关闭。完成正式商户、价格、账单、签名、三平台实机和异机恢复后，再发布 `stable` 安装包并走收费放量链。当前 `package.json` 为 `0.3.0-preview.1`，且早于 OD.0–OD.7 变更，必须先递增版本、重新构建。预览版本不能绑定生产 `stable` 清单；生产稳定版也不能用预览版本号打包。

对外名称按下表固定。staging 建议使用**独立 VM/主机和公网 IP**；数据库、凭据、账本、账户命名空间也必须独立。当前生成器每份 Nginx 配置都带 `default_server` 和同名 `map`/`log_format`，不能把 staging、production 两份配置原样加载到同一个 Nginx `http {}`。若只有一台主机，先增加经测试的多环境边缘配置与隔离方案，再继续，不要直接叠加配置。

| 用途 | 域名 | 所在环境 | 访问范围 |
| --- | --- | --- | --- |
| 正式官网 | `https://mx.jouhu.com` | production 静态站 | 公网 |
| 正式用户 API / 微信通知 | `https://api.mx.jouhu.com` | production | 公网 443 |
| 正式运营、计费管理 | `https://admin.mx.jouhu.com` | production | VPN/身份网关内 |
| 预览官网 | `https://staging.mx.jouhu.com` | staging 静态站 | 公网或受控测试 |
| 预览 API | `https://api-staging.mx.jouhu.com` | staging | 受控测试 |
| 预览管理 | `https://admin-staging.mx.jouhu.com` | staging | VPN/身份网关内 |

每个 HTTPS 名称都要有有效证书。若用泛域名证书，确认证书同时覆盖根域名 `mx.jouhu.com`；不要假定 `*.mx.jouhu.com` 覆盖根域名。LiteLLM 的 4000/4001、MOOS API、PostgreSQL 和内部服务端口不通过这些域名直接开放。

## 1. 冻结发布内容

1. 在受控分支记录 commit SHA、版本、依赖锁文件和构建机器；先处理当前工作区改动，再构建可重复的发布源码快照。不要把 `.env`、商户证书、RootFlowAI Key、用户论文或数据库快照加入仓库、安装包或公开日志。
2. 执行现有代码检查与部署测试：`npm run config:test`、`npm run od6:test`、`npm run od7:test`、`npm run check:core`、`go -C services/control-plane test ./...`、`npm --prefix website run check`。若构建脚本或依赖在目标机器不兼容，记录具体失败并停止发布。
3. 递增版本并决定 `preview` 或 `stable`。先把预览包发到隔离的 staging；正式版须完成签名及对应平台验收后另行构建。

## 2. 准备两套私有环境

1. 配置 DNS：正式三个名称指向 production 入口；预览三个名称指向独立 staging 入口。核对 A/AAAA、证书链、到期时间及域名归属；未准备好时不要把清单中的 `.invalid` 换成未经控制的域名。
2. 在两套 Linux 环境分别创建受限服务账户、私有配置目录、日志目录和备份目录；私有目录 `0700`，密钥/批准/回执文件 `0600`。只允许必要的公网 443；管理入口还要有 VPN/身份网关准入。证书可通过受控 DNS 验证申请；不得因为申请证书长期放开内部端口。
3. 分别准备 MaterialsX PostgreSQL、LiteLLM 独立数据库、MOOS 来源连接、备份密钥与异机备份目标。生产服务用受限运行角色，迁移用独立 owner 角色；两套环境不共享账户、账本或商户生产回调。staging 支付固定 `disabled`。
4. 把 RootFlowAI、微信商户、SMTP、数据库 DSN、身份主密钥、代理令牌放入服务器私有配置管理。正式收款资料缺失时保持云收费和支付关闭；不要把本机临时隧道或开发数据库复制到生产。

## 3. 生成并审核唯一地址清单

在仓库**外**复制 `deploy/examples/staging.template.yaml` 和 `deploy/examples/production.template.yaml`，分别保存为私有的 `/etc/materialsx/staging.yaml`、`/etc/materialsx/production.yaml`。填入上表的三个 origin。若环境在独立主机上，各自可以保留模板中的本机端口；如改端口，还需逐服务同步实际监听配置。初次只读生产清单保持 `cloud.mode: disabled`、`payment.mode: disabled`、`releaseChannel: stable`，staging 保持 `cloud.mode: alpha`、`payment.mode: disabled`、`releaseChannel: preview`。

```sh
npm run config:check -- --manifest /etc/materialsx/staging.yaml
npm run config:check -- --manifest /etc/materialsx/production.yaml
npm run config:inventory
```

审查输出中的公开 origin、内部端口和研究数据模式；`config:check` 只验证配置形状，不证明 DNS、TLS、进程或准入实际生效。若 MOOS 在另一台机器，按 [OD.3 私网 mTLS](OD3_MOOS_LINK.md) 设置 `researchData.mode: private-mtls`，不要公开原始 MOOS API。

## 4. 先部署 staging 的服务与数据

1. 对 staging 数据库加密备份。使用迁移角色执行 `npm run identity:ctl -- --command migrate`，再执行 `npm run identity:ctl -- --command grant-runtime --role <staging 运行角色>`；核对迁移版本和实际授权。LiteLLM 使用自己的独立数据库迁移。
2. 部署同一源码版本的身份 API/Billing Worker、团队研究服务、计费 Web、LiteLLM 代理与管理 UI、模型部署 Worker。按照 [OD.4](OD4_MODEL_DEPLOY.md) 安装 Linux systemd/polkit 和私有模型目录。服务只监听清单中的 loopback 地址；MOOS 从 MCP 到源 API 做一次带账户 ACL 的真实读取验收。
3. staging 启动时关闭注册和新销售；核对数据库中的 `cloud_paused=true`、`sales_paused=true`，不要只依赖迁移默认值。若要验证 `alpha` 流式调用，只在隔离测试账户与受控时段临时放开云调用，测试后恢复暂停并重新抓取真实运营状态；支付始终关闭。
4. 在 staging 主机生成并安装边缘配置：

```sh
npm run config:edge -- --manifest /etc/materialsx/staging.yaml --out-dir /etc/materialsx/generated-edge
nginx -t
```

`admin-allow.conf` 默认拒绝所有访问；先验证 VPN/身份网关，再只放行批准的管理网段，然后原子重载 Nginx。静态官网须单独配置 HTTPS 站点/CDN；`config:edge` 只生成 API 与管理入口，不会发布官网。

## 5. 上线 staging 官网与预览安装包

1. 新的 `-preview.` 版本在目标平台分别构建安装包。设置 `MATERIALSX_DEPLOY_MANIFEST=/etc/materialsx/staging.yaml`，再运行对应的 `npm run package:preview:mac`、`npm run package:preview:win`、`npm run package:preview:linux`。构建机必须可读取获审的清单，但清单不含密钥。解包检查 `materialsx-client.json` 的 API 为 `https://api-staging.mx.jouhu.com`、官网为 `https://staging.mx.jouhu.com`、渠道为 `preview`。
2. 按 [OD.6](OD6_RELEASE_OPERATIONS.md) 生成 `release-info.json`、`SHA256SUMS.txt`，执行 `npm run od6:release-manifest -- <release-info.json 绝对路径>` 产出新的 `website/releases/preview.json`，再生成私有发布审计。核对 GitHub Release 的文件名、尺寸、SHA-256 与发行清单一致。预览包目前是未签名方案；macOS/Windows/Linux 各需真实机器安装、登录、本地 LLM、云模式、研究数据、更新和卸载回归。没有实机回执，不得称正式版。
3. 发行清单更新后，以 `SITE_ORIGIN=https://staging.mx.jouhu.com`、`SITE_BASE_PATH=/`、`MATERIALSX_SITE_RELEASE_CHANNEL=preview` 执行 `npm --prefix website run build`，把 `website/dist/` 发布到 `staging.mx.jouhu.com`。发布前确认 `website/dist/releases/preview.json` 与下载资产同版本。不要把管理服务反向代理到官网域名。

## 6. 完成 staging 现场验收

从**外部机器**检查 DNS/TLS、错误 Host/Origin、管理域名隔离，以及 8788/8793/8790/4000/4001/5432 和 MOOS 原始端口不可直达。从 VPN 内另行检查管理登录、TOTP、权限与证书。做真实模型流式、MOOS ACL、回调验签/重复通知夹具、断线与故障注入、备份恢复演练；用请求 ID 核对日志和最终计费回执。

```sh
npm run od6:observe
npm run od7:public-probe -- --manifest /etc/materialsx/staging.yaml --out /var/lib/materialsx/od7/staging-public-probe.json
npm run od7:gate -- --stage staging --manifest /etc/materialsx/staging.yaml --production-manifest /etc/materialsx/production.yaml --evidence /var/lib/materialsx/od7/staging.json --out /var/lib/materialsx/od7/staging-report.json
```

`staging.json` 必须引用 [OD.7](OD7_ROLLOUT.md) 所要求的真实私有回执及 SHA-256，并记录不同的 staging/production 数据库、凭据、账本和账户命名空间。七项公网探针全通过只是必要条件；`od6:observe` 报警要先修好。不能为了过门禁伪造运营状态或手填“通过”。

## 7. 部署 production，但保持只读与暂停

在 production 服务器重复数据库迁移、受限授权、服务部署、备份、健康检查和边缘安装。用 production 清单生成**另一份** Nginx 配置，仅在 production 入口加载。发布正式官网静态资源到 `mx.jouhu.com`；初期可展示“开发预览版”并链接到 staging 的预览下载，不应把预览包误标为正式生产包。核对正式 API、微信通知路径的 TLS/路由、管理准入，继续保持 `MATERIALSX_SIGNUP_ENABLED=0`、`cloud_paused=true`、`sales_paused=true`。

```sh
npm run config:edge -- --manifest /etc/materialsx/production.yaml --out-dir /etc/materialsx/generated-edge
nginx -t
npm run od7:public-probe -- --manifest /etc/materialsx/production.yaml --out /var/lib/materialsx/od7/production-public-probe.json
npm run od7:gate -- --stage read-only --manifest /etc/materialsx/production.yaml --evidence /var/lib/materialsx/od7/read-only.json --previous /var/lib/materialsx/od7/staging-report.json --out /var/lib/materialsx/od7/read-only-report.json
```

只有拿到 `read-only` 报告、外部扫描和监控正常后，才宣布正式域名的只读入口可用。此时不是付费平台上线。

## 8. 从预览走向正式收费

1. 先补齐正式商户、采购单价/账单、模型路由与价格版本、SMTP、证书、告警、异机恢复、签名及三平台实机回执。按 [OD.5](OD5_MX_PRODUCTION.md) 生成私有批准文件和六类证据，测试“完全未使用订单全额退款”规则。
2. 将生产清单改为获批的 `cloud.mode: mx-production`、`payment.mode: wechat-native`、与 API 完全一致的 `payment.notifyOrigin` 和规定的 `payment.releaseId`。**此举改变生产清单摘要，原 staging/read-only 报告失效；从 staging 阶段重新跑完整 OD.7 放量链**。不要在旧回执上直接打开销售。
3. 将版本号改为不带 `-preview.` 的稳定版本，绑定获审的 production 清单打包；正式安装包须完成签名、公证/平台要求及实机验证。设置官网 `MATERIALSX_SITE_RELEASE_CHANNEL=stable`，重新生成 stable 发行清单和 SHA-256，并记录 `od6:audit`。
4. 严格按 `staging → read-only → research → canary-model → wallet → orders` 生成门禁回执。`research` 后才开放研究数据；`canary-model` 前审核供应商真实流式和用量；`wallet` 前核对四类 Token 结算与余额；`orders` 前执行获批准的小额微信 Native 实付、通知幂等、点数只发一次和完全未使用订单原路全额退款。每阶段先核对 Worker、上一报告、运营开关实际版本，再由人手动放量；门禁脚本本身不会打开开关。

## 9. 上线当天与回滚

发布当天保存 commit/版本、两套清单摘要、DNS/TLS 和外部端口扫描、Nginx `-t`、健康与 `od6:observe`、OD.7 各阶段报告、三平台安装包哈希、备份/异机恢复、订单与请求 ID、模型和价格目录一致性记录。设定告警接收人与值班人。任何关键探针失败立即停止放量。

若发生重复扣点、回调异常、供应商未知用量或模型路由故障，先把 `cloud_paused` 和 `sales_paused` 置为 true，阻断**新**云调用和新销售；继续处理已经产生的通知、结算、退款和账本查询。按 [OD.6](OD6_RELEASE_OPERATIONS.md) 记录回滚审计并切回上一个已验证服务/路由版本；不执行数据库 down migration，不重放待核对供应商请求。恢复前重新检查健康、账本、目录与放量回执。
