# 微信 Native 商户资料接入与本机验收

更新时间：2026-10-01。维护者已选择：**MaterialsX 使用已有微信官方 SDK，复用本机商户资料。** 本机配置检查及额外授权的 ngrok 独立 ¥0.01 实付测试已通过，永久公网入口待定，正式销售仍关闭，未执行退款。

独立探针已完成真实下单、用户付款、成功通知及查单双重验证，随后关闭临时入口。下面的预检表/JSON 保留当时离线结果；实付结果见 [ngrok 一分测试](wechat-ngrok-probe.md)。永久公网部署和正式销售仍未开放。

## 接入方式

已阅读 `company-law-agent/services/weixin_pay_service/README.md`、`USAGE.md`，并核对实际配置、下单、查询、通知、关单和退款代码。其 HTTP 模式要求业务系统保存服务生成的 `payment_id`，它与业务 `order_id` 不同；不能把该合同直接套到 MaterialsX 的官方 SDK 模式。

本轮经维护者确认使用直接 SDK 模式：

```text
MaterialsX desktop → MaterialsX identity/API + PostgreSQL
                              ↓ 官方 APIv3 Go SDK
                          微信 Native
                              ↓ 验签、解密
                /v1/payments/wechat/notify
```

保留现有订单、退款编号、精确人民币分、已验证支付证据和幂等账本。无需额外启动法律项目的支付服务。该服务的数据库、业务签名密钥、`order_sync` 和 `/api/webhooks/weixin` 通知地址不会用于 MaterialsX；法律项目的 YAML 和回调路由未修改。

新增服务端私有配置读取能力：

| 参数 | 作用 |
| --- | --- |
| `MATERIALSX_WECHAT_CONFIG_PATH` | 私有 `weixin_pay_service` runtime YAML 的绝对路径 |
| `MATERIALSX_WECHAT_RUNTIME_DIR` | 相对 PEM 路径的绝对基目录；省略时为 YAML 所在目录 |
| `WECHAT_PAY_PUBLIC_KEY_ID` | 商户平台提供的 `PUB_KEY_ID_…`；旧 YAML 未包含此字段，可单独提供 |
| `MATERIALSX_IDENTITY_PUBLIC_URL` | MaterialsX 自己的公网 HTTPS Origin；本轮待定 |
| `MATERIALSX_PAYMENT_MODE` | 默认 `disabled`；配置文件存在不会自动启用支付 |

YAML 读取 `payment.weixin` 的 `mchid`、`appid`、`serial_no`、`apiv3_key`、`private_key_pem_path/env`、`wechat_pay_public_key_path/pem_env`，以及可选扩展 `wechat_pay_public_key_id`。PEM 环境变量内容非空时优先读取，否则读取文件。商户密钥只在服务端内存使用，不复制到源码、桌面或安装包。

两种来源互斥：设置 YAML 路径后，不能同时设置原有六项商户环境变量（商户号、AppID、证书序列号、APIv3 密钥、私钥路径、公钥路径），避免混用商户。公钥 ID 若同时提供且不同则拒绝。未指定 YAML 时仍支持原有纯环境变量模式。

读取上限为 64 KiB，拒绝未展开占位值、非官方微信上游地址、不可解析 RSA 或不足 2048 位的密钥；YAML 和私钥在 macOS/Linux 上不能允许其他用户读取。Windows 须通过部署账户 ACL 控制访问，POSIX 权限检查不适用于 Windows。解析错误仅返回 `PAYMENT_VALIDATION`，不输出可能包含密钥的 YAML 诊断。

## 本机使用

本机已生成忽略的 `runtime/wechat-pay/connection.env`，权限 `600`，目录权限 `700`。它只记录外部 YAML/目录路径、公钥 ID 和 `disabled` 状态，未复制商户密钥。已将原商户私钥的权限从 `644` 收紧至 `600`，文件内容保持一致。

在 MaterialsX 项目根目录运行：

```sh
source runtime/wechat-pay/connection.env
npm run m5:payments:preflight -- --merchant-only
```

预检只做本机读取、RSA 解析和 SDK/解密器初始化；不会查 DNS、连接数据库、调用微信、生成付款二维码或退款。报告不包含商户号、AppID、证书序列号、公钥 ID、密钥、PEM、数据库 DSN 或源文件路径。

也可在自己的部署环境显式传入路径：

```sh
npm run m5:payments:preflight -- \
  --config /absolute/private/weixin-pay/config.yaml \
  --runtime-dir /absolute/private/weixin-pay \
  --public-key-id PUB_KEY_ID_FROM_MERCHANT_CONSOLE \
  --merchant-only
```

`--merchant-only` 的退出状态仅表示本机商户配置结果，不修改服务启动或销售门禁。不带该参数时还要求设置 MaterialsX HTTPS Origin；公网入口待定会报告不通过。底层程序退出码 `2` 表示检查未满足，`1` 表示参数/报告写入失败；`go run`/npm 可能将非零子程序状态包装为 `1`，以 JSON 中的检查结果为准。可选 `--output /absolute/private/new-report.json` 写入新的 `600` 文件，拒绝覆盖已有文件。

`npm run identity:local` 仍强制禁用支付，不会因上述连接文件存在而读取真实商户；本轮没有把本机账户服务改成生产环境。远程部署时须通过私有挂载提供 YAML/PEM，不能依赖开发电脑的目录。

## 验收结果

| 项目 | 结果 |
| --- | --- |
| 实际本机 YAML 读取、相对 PEM 路径解析 | 通过 |
| 商户号、AppID、商户证书序列号存在 | 通过；不证明商户归属或应用绑定 |
| APIv3 密钥长度 32 字节 | 通过；不证明它与微信商户侧一致 |
| RSA 私钥、平台公钥格式与位数 | 通过 |
| 维护者提供的微信支付公钥 ID | 格式通过；与公钥配对待微信应答/通知验证 |
| 使用实际本机配置初始化官方 SDK 与通知解密器 | 通过，无网络请求 |
| 配置来源隔离、密钥/解析错误脱敏、权限拒绝、占位符拒绝 | 单元测试通过 |
| SDK 签名查询、合成通知验签/解密及坏签名拒绝回归 | 通过，临时 RSA 夹具 |
| MaterialsX 独立公网 HTTPS Origin | 待定，保持关闭 |
| Native 开通、商户绑定、微信实付和原路退款 | 未验收 |
| 正式销售费率、生产计量边界、退款条款 | 待确认 |

脱敏配置快照见 [wechat-merchant-validation.json](wechat-merchant-validation.json)。`merchantConfigReady:true` 仅表示本机检查通过；`offlineConfigReady:false` 表示缺少 MaterialsX 公网 Origin；`formalSalesEnabled:false`、`realPaymentVerified:false` 始终如实保留。

源支付服务还存在业务鉴权、签名、防重放关闭和 API 错误脱敏关闭的配置。本轮仅在报告中提示，未修改其正在服务法律业务的配置。由于 MaterialsX 不走该服务 HTTP，它们不会被继承为 MaterialsX 的准入规则；该服务公开部署仍需另行加固。

## 后续上线

1. 确定独立 MaterialsX HTTPS Origin，部署身份/API、生产 PostgreSQL、受限运行角色与 Worker，设置可信反代。
2. 通知地址由 MaterialsX 自动组装为 `<MaterialsX Origin>/v1/payments/wechat/notify`。不要复用法律项目的 `/api/webhooks/weixin`；按微信商户设置与实际下单接口要求核对公网可达性。
3. 确认商户/应用绑定、Native 产品开通、公钥 ID 与 PEM 对应、APIv3 密钥和证书序列号一致，并演练公钥轮换。
4. 补齐正式计量边界、价格和退款条款，再显式扩展正式套餐/渠道门禁。当前 `wechat-native` 仅能初始化适配器，不能靠修改环境变量开放正式销售。
5. 完成一笔批准的小额付款、漏通知查单、重复通知到账幂等及原路退款验收，记录微信交易号/退款号的脱敏证据。

官方依据：[微信支付公钥验签](https://pay.wechatpay.cn/doc/v3/merchant/4013053249)、[公钥接入常见问题](https://pay.wechatpay.cn/doc/v3/merchant/4013038816)、[Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)。公钥 ID 与商户证书序列号是不同参数，PEM 文件不能推算微信分配的公钥 ID。
