# 线上地址与客户端配置

如果需要一项一项部署，请先按 [Ubuntu 逐模块部署操作卡](MODULE_BY_MODULE_UBUNTU.md) 操作；每张卡写明本地源码、服务器目录、域名/端口、数据库迁移和验收。总准备与 SSH/回滚流程见 [Ubuntu SSH 部署手册](ALIYUN_UBUNTU_SSH_RUNBOOK.md)。正式 staging/production 分离与收费放量仍按 [mx.jouhu.com 最终流程](MX_JOUHU_COM_DEPLOYMENT.md)执行。

明日部署先按 [公网部署前核对](GO_LIVE_CHECKLIST.md) 执行；其中的本机状态快照不会自动放行真实环境。

OD.0 清单生成无密钥拓扑预览；OD.1 可在打包时生成桌面公开配置；OD.2 生成 HTTPS 边缘配置并收紧本机服务监听；OD.3 支持 MOOS 同机或私网双向 TLS 接入；OD.4 的模型部署 Worker 已实现，本机验证通过，Linux 实机与完整灰度闭环待验收。OD.5 的 MX 生产发布门禁已接入，本机测试完成，正式小额支付待真实环境验收。OD.6 的发行清单、服务观测与加密备份已完成本机验证。OD.7 的逐阶段证据门禁与公网只读探针已接入，真实预发布联调待独立环境。模型发布步骤见 [OD.4 模型代理发布作业](OD4_MODEL_DEPLOY.md)，收款步骤见 [OD.5 MX 钱包生产发布与回滚](OD5_MX_PRODUCTION.md)，发行与备份见 [OD.6 发行、观测与备份](OD6_RELEASE_OPERATIONS.md)，放量流程见 [OD.7 预发布联调](OD7_ROLLOUT.md)。生成文件本身不代表公网验收完成。

```sh
npm run config:check
npm run config:check -- --manifest deploy/examples/development.yaml --out runtime/deployment/preview.json
npm run config:inventory
npm run config:test
```

`--out` 只写不存在的文件，权限 0600；建议写入 Git 忽略的 `runtime/`。预览内没有密钥，但仍可能包含内部拓扑。`staging.template.yaml` 和 `production.template.yaml` 故意使用 `.invalid` 域名：复制到 Git 忽略的位置，替换域名后再运行 `config:check`。与已有服务共用服务器、直接部署正式环境时，按 [正式共存部署流程](PRODUCTION_EXISTING_HOST.md) 操作，并为 `config:edge` 加 `--existing-nginx`。跨机器 MOOS 模式及证书操作见 [OD.3 MOOS 私网连接](OD3_MOOS_LINK.md)；其它内部服务仍按同机 loopback 部署。生产微信支付清单必须包含同源通知地址和获批版本；真正开放销售还要通过 OD.5 的私有证据及运行时门禁。

预检只验证地址形状、域名占位符和代码层配置一致性；它不会证明域名归属、DNS、证书、服务在线或运营审批，这些仍由 OD.2–OD.7 的真实环境验收完成。

清单是公开地址的唯一编辑来源；打印的 `partialEnvironment` 只包含现有服务需要的**非密钥**变量，不包含数据库 DSN、代理令牌、商户材料或供应商 Key。预览明确标记 `deploymentReady:false`。开发版默认地址不变。

## OD.2 HTTPS 边缘网关

复制 [`production.template.yaml`](examples/production.template.yaml) 或 staging 模板到 Git 忽略的私有位置，填入三个真实 HTTPS origin，再生成配置：

```sh
npm run config:check -- --manifest /absolute/path/to/production.yaml
npm run config:edge -- --manifest /absolute/path/to/production.yaml --out-dir runtime/deployment/edge
```

生成 `materialsx-edge.conf` 和默认 `deny all` 的 `admin-allow.conf`。将配置安装到 Nginx `http {}` 中；TLS 文件分别放在 `/etc/materialsx/tls/api/` 和 `/etc/materialsx/tls/admin/`，将管理员准入文件放在 `/etc/materialsx/edge/admin-allow.conf`。证书私钥、服务凭据和管理员允许的 VPN 网段由服务器私有配置管理，不写入清单或安装包。管理员准入文件必须先经过 VPN/身份网关核验才可改成 `allow <VPN-CIDR>; deny all;`；切勿公开允许所有地址。Nginx 需支持 `ssl_reject_handshake`，安装后先执行 `nginx -t`，再原子重载。

路由固定为 API 域名上的 `/v1/research/* → 8793`、其余 API → 8788，以及受保护管理域名上的 `/ops* → 8788`、计费 Web → 8790；公开 API 域名上的管理路径和所有直接访问 Go 计费私有 API 的请求均返回 404。未知 Host 在 TLS 握手阶段拒绝，已知域名上的错误 Host/Origin 分别返回 421/403。代理以实际连接 IP 覆盖 `X-Forwarded-For`，清除客户端伪造的身份和计费代理头，禁用自动上游重试；研究与模型响应不缓冲。访问日志只记录 IP、方法、状态、字节数和耗时，不记录路径、查询、认证头或正文。旧 UA.13 片段仅用于说明历史路由，不能与生成配置叠加。

同机服务只监听 loopback：Go 生产启动拒绝非 loopback `MATERIALSX_IDENTITY_ADDR`，其 `MATERIALSX_TRUSTED_PROXY_CIDRS` 只接受 `127.0.0.1/32,::1/128`；计费 Web 生产启动拒绝非 loopback。研究服务、LiteLLM 代理/管理 UI 已在代码中绑定 loopback。PostgreSQL 必须由主机防火墙/数据库配置限制到 loopback 或私网，公网入站只开放 443；用 `ss`/`lsof` 和**外部主机**扫描验证，不能只凭清单推断。OD.3 仅增加 MOOS 专用私网端口；不得借此将其它内部服务公开。

计费 Web、LiteLLM 等私有组件在当前仓库的 `.gitignore` 中，由各自的私有发布物部署；部署时必须包含对应的监听地址检查，不能只发布本仓库已跟踪的文件。

监控从内部网络调用 Go 的 `/health/live` 和 `/health/ready`，请求必须设置清单中的 API Host（例如 `curl -H 'Host: api.your-domain.tld' http://127.0.0.1:8788/health/ready`）。前者仅证明进程响应，后者分别返回账户数据库、Billing Worker、模型代理和功能开关；启用的模型代理或所需 Worker 不健康时返回 503。公开网关不转发这两个内部探针；现有 `/health` 保留供团队服务校验生产身份。供应商本身、收款渠道和科研结果质量不由这些探针证明。

部署验收需在真实 DNS/TLS 就绪后，用公网安装版测试登录、设备撤销和模型流式响应；从外部确认 8788/8793/8790/4000/4001/5432 不可访问；测试错误 Host/Origin/代理头、断流后原请求回执与单次计费。当前没有正式域名、服务器和证书，因此这些公网验收尚未完成，也未启用生产收费。

## OD.1 安装包地址

打包脚本会先运行 `npm run config:client`，生成 Git 忽略的 `runtime/release-build/client/materialsx-client.json`，由 electron-builder 放入 macOS、Windows、Linux 安装包资源目录。配置仅含版本、发行渠道、API origin 和可选官网地址。没有 `MATERIALSX_DEPLOY_MANIFEST` 时，预览安装包的 `apiOrigin` 为 `null`，平台功能明确不可用；本地 LLM 仍可使用。要绑定已核验的部署清单：

```sh
MATERIALSX_DEPLOY_MANIFEST=/absolute/path/to/reviewed-manifest.yaml npm run config:client
```

不带预览后缀的正式版本会自动要求 stable 渠道及已通过 `config:check` 的生产清单；否则构建前失败，也可显式设置 `MATERIALSX_RELEASE_CHANNEL=stable` 做预检。安装版忽略 `MATERIALSX_IDENTITY_URL`，开发源码运行仍可用它显式覆盖 `127.0.0.1:8788`。更换平台地址需要重新打包，服务端 `/v1/client-config` 不具备重定向客户端到其他 origin 的权限。上线前分别检查三平台包内资源、登录与断网行为。

## 手工核对的地址与责任边界

| 访问方向 | 当前来源/默认 | 分类和责任 | 上线处理 |
| --- | --- | --- | --- |
| 桌面 → 账户/模型/钱包 | 安装版读包内 `materialsx-client.json`；开发版 `127.0.0.1:8788` | 用户 API；`apps/desktop/main/platform-configuration.ts`、`packages/control-plane-client/src/identity.ts` | OD.1 单一 origin 已接入，正式域名待提供 |
| 桌面 → 旧订阅服务 | 桌面 8787 客户端、IPC 与独立开发服务均已移除 | 当前订阅与钱包使用 8788 平台 API | 生产安装包无旧订阅调用 |
| 官网浏览器 → 静态资源 | `127.0.0.1:4174`，现支持 GitHub Pages | 公共静态站点；`website/scripts` | 另设静态域名/CDN；不放私钥 |
| 浏览器 → 计费管理 Web | `127.0.0.1:8790` | 管理员；`apps/billing-admin/server.mjs` | 管理入口受 VPN/访问网关保护，后端仍校验会话/CSRF/角色 |
| 计费 Web → Go 私有管理 API | `127.0.0.1:8788` | 私网 + 代理令牌，前端不直连；`MATERIALSX_BILLING_GO_ORIGIN` | 保持私网，正式代理令牌单独注入 |
| Go → LiteLLM | 生产 `MATERIALSX_LITELLM_URL=http://127.0.0.1:4001`；管理 UI 在 4000 | 模型转发；`gateway/multi_model.go`、`services/litellm` | OD.4 通过服务端 Worker 发布，代理直连 4001；保留计费回执 |
| 管理员 → LiteLLM UI | 本机 `127.0.0.1:4000/ui/` | 管理界面；`services/litellm-console` | 不开放普通公网；独立升级 UI |
| 桌面 → 团队研究服务 | 与身份服务相同 origin 的 `/v1/research/*`；本机 8793 | 账户认证 + 项目 ACL；`team-research.ts`、`team/server.ts` | OD.2 同源路由、OD.3 私网 MOOS |
| 团队服务 → MOOS MCP → MOOS API | MCP stdio，底层 `127.0.0.1:8080` | 科研源数据；`scripts/agent/ua13-server.ts`、MOOS `materials-mcp` | OD.3 同机或私网双向 TLS 桥接；不公开 8080 |
| 用户 → LM Studio | 用户电脑 `localhost:1234/v1` | 用户可配置的本地 LLM；`packages/pi-adapter` | 保留本地 loopback，不改成平台公网地址 |
| 微信支付 → Go 回调 | `/v1/payments/wechat/notify` | 公网签名通知；`payments/wechat.go` | OD.5 固定正式 HTTPS origin 与幂等验签 |
| Go/LiteLLM → 供应商 | `ROOTFLOWAI_BASE_URL` 和模型草案的供应商地址 | 服务端出站；`gateway/config.go`、LiteLLM 注册表 | 服务端密钥，探针/用量/账单核对 |
| Go → 邮件 | `MATERIALSX_SMTP_ADDRESS` | 服务端出站；`internal/delivery` | 受控 SMTP 凭据与退信监测 |
| 科研工具 → 论文服务 | arXiv、Crossref HTTPS | 受限公共出站；`packages/agent/src/papers/network.ts` | 保持来源白名单、超时和引用记录 |
| 应用/官网 → 发行资源 | GitHub Releases、模型目录更新、获准权重来源 | 公共出站；`gateway/releases.go`、`website/src/render.mjs`、`packages/atomistic` | 版本、签名/哈希和来源许可核对 |
| Go → PostgreSQL，LiteLLM → 独立数据库 | 私有 DSN | 内网/受限角色；`identity/config.go`、`services/litellm` | 生产 TLS verify-full、独立迁移角色、备份恢复 |

`config:inventory` 扫描这些一手源码的环境变量**名称**与 URL **origin**，不会输出变量值、URL 路径或查询参数。MOOS 仓库不在当前检出环境时列为缺失的可选源，不阻断 MaterialsX 配置预检。扫描结果不能代替上表人工核对动态 URL、供应商、权限和实际可用性。

## 固定公开路由合同

以 [`routes.mjs`](routes.mjs) 为可校验的有序清单。支付回调是签名入口；`/v1/research/*` 由团队服务处理；`/ops` 和 `/ops/*` 进入 Go，但须管理员边缘准入；`/v1/admin/billing-console/*` 仅允许计费 Web 到 Go 的私有连接；模型流式路由需要保留流，其他用户 API 归 Go。每条记录包括方法、认证、请求体、流式、超时和重试策略。`config:check` 拒绝会遮蔽这些专用路径的前置通配路由；OD.2 已生成同机配置，公网端到端超时仍待真实环境验收。

## 未决输入与下一阶段

真实 API/官网/管理域名、主机拓扑、证书、PostgreSQL/LiteLLM 私有 DSN、MOOS 所在服务器、SMTP 和微信正式商户回调仍未在本轮确定。OD.2 已生成 HTTPS 网关配置，但尚未部署到公网。不要将本机 `wechat-mx-live` 或临时隧道复制到生产清单。
