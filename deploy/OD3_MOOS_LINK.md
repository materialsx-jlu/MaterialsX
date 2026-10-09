# OD.3 MOOS 私网连接与验收

桌面只访问公开 API 的同源 `/v1/research/*`。API 主机上的团队服务执行账户和设备验证、项目成员与源记录范围校验，再通过本机 stdio MCP 读取 MOOS。MOOS 适配器只接受 loopback API 地址。`researchData.mode: colocated` 时，MOOS API 直接在同一主机监听 `internal.moosApi`。

跨主机时仍将团队服务留在 API 主机；MOOS 主机运行只读双向 TLS 服务，API 主机运行 loopback 客户端。清单示例：

```yaml
internal:
  moosApi: 127.0.0.1:8080 # API 主机的隧道客户端，不是远程 MOOS 8080
researchData:
  mode: private-mtls
  linkAddress: 10.24.0.5:9443 # MOOS 主机的私网监听；也允许 172.16/12、192.168/16、100.64/10、ULA
  serverName: moos.internal.materialsx.org # 服务端证书 DNS SAN
  moosHostApi: 127.0.0.1:8080 # MOOS 主机本地 API
```

`npm run config:check -- --manifest <私有清单>` 会拒绝公网/通配监听、开发环境私网桥接和远程裸 HTTP API，并产生无密钥的 `moosLinkServer`/`moosLinkClient` 环境预览。两台主机只复制各自一侧非密钥变量。CA、证书、私钥及客户端证书 SHA-256 指纹由独立密钥管理放在仓库和安装包外，文件权限为 `0600`；环境变量仅放**绝对文件路径**，不放 PEM 内容：

| MOOS 主机 | API/团队主机 |
| --- | --- |
| `MATERIALSX_MOOS_LINK_LISTEN` | `MATERIALSX_MOOS_LINK_LOCAL` |
| `MATERIALSX_MOOS_LINK_UPSTREAM` | `MATERIALSX_MOOS_LINK_REMOTE` |
| `MATERIALSX_MOOS_LINK_CLIENT_FINGERPRINT` | `MATERIALSX_MOOS_LINK_SERVER_NAME` |
| `MATERIALSX_MOOS_LINK_CA/CERT/KEY` | `MATERIALSX_MOOS_LINK_CA/CERT/KEY` |

CA 仅签发此通道的证书；服务端证书需含 `serverAuth` 与 `serverName` 的 DNS SAN，客户端证书需含 `clientAuth`。可用 `openssl x509 -in client.pem -noout -fingerprint -sha256` 核对客户端指纹，去掉冒号后设为 `MATERIALSX_MOOS_LINK_CLIENT_FINGERPRINT`。证书和指纹轮换先停止桥接，再部署新证书/指纹并重启两端；失窃证书应立即移除私网准入并换发 CA/客户端证书。

启动顺序：MOOS API（只绑定 loopback）→ MOOS 主机 `npm run moos:link:server` → API 主机 `npm run moos:link:client` → `MATERIALSX_MOOS_ORIGIN=http://127.0.0.1:8080 npm run ua13:team`。若客户端与真实 MOOS API 在同一测试机，需为客户端选择另一个未占用 loopback 端口，并把 `internal.moosApi` 同步改为该端口。服务端只转发 MOOS MCP 所需的 GET 读取路由和精确搜索/对比 POST；不允许原始 `/api/assets/*/content`、管理路由、任意 URL、重定向或通用 HTTP 代理。请求最多 128 KiB、响应最多 8 MiB、超时 9 秒。研究网关仅下发短期项目/用户/授权版本绑定的引用，图像只允许至多 2 MiB 的 JPEG 预览，原始 PDF 不能经该通道导出。访问日志不得记录论文正文、配方、路径查询、鉴权头或请求体。

项目的源记录范围须由管理员在团队服务的项目清单中设置，参考 [UA.13 项目与范围操作](../docs/deployment/ua13/README.md)；桥接证书不授予项目权限。若桥接故障，先停止团队服务或将研究入口标记不可用，保留账户/模型等其它 API；**不要**将 `MATERIALSX_MOOS_ORIGIN` 改为远程公网 URL。回滚到 `colocated` 只在 MOOS API 确实迁回 API 主机后进行，同时关闭 9443 私网准入与两端桥接进程。过期或撤销的客户端证书通过更换服务端固定指纹和重启立即失效。

防火墙只允许 API 主机的私网身份访问 `linkAddress`；MOOS 主机的 8080 永不开放公网。外部主机扫描应验证 8080/9443 均不可从公网直接访问。不要相信桌面传来的项目角色、研究身份头，项目/账户撤销以后必须在读取时重新验证，不能复用此前的租约。MOOS 待复核标签、原始组分用量、证据页码和源记录 ID 保留在网关结果中，不升级为已验证结论。

本机验收：`npm run config:test` 覆盖双向证书、证书主机名、私网清单、路由限制；`npm run ua13:moos` 使用真实本机 MOOS 记录验证读路径及越权拒绝。正式异地验收仍需真实 API 域名、两台主机及设备：从异地安装版检索获授权配方，读组分、步骤、证据页；用另一项目、停用链接和撤销设备逐项确认拒绝，再从公网扫描 8080/9443。只有回执留存后才可标记 OD.3 真实部署通过。
