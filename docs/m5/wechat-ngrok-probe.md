# ngrok 微信 Native ¥0.01 实付探针

2026-10-01：维护者明确授权建立临时 ngrok 公网地址并发起 ¥0.01 支付。已创建一笔真实 Native 订单，用户扫码支付后，**RSA 验签/AES-GCM 解密的微信成功通知及签名主动查单均确认 SUCCESS**；商户、AppID、订单号、CNY 和金额 1 分匹配。测试完成后已关闭本次隧道与独立探针进程。

本次为独立商户诊断，不是正式套餐购买：未写入平台订阅、积分或生产账本；未执行退款；正式销售继续关闭。真实退款、生产计量政策和完整商业验收仍待完成。脱敏证据见 [wechat-one-fen-validation.json](wechat-one-fen-validation.json)；完整商户订单号/交易号和付款 URL 只保存在忽略的私有 runtime 目录。

## 探针边界

- 新增 `cmd/wechatprobe`，必须显式传入 `--create-one-fen`；金额固定为 CNY **1 分**，不能通过 HTTP 或 CLI 参数提高金额。
- 商户配置沿用 [私有 YAML/PEM 接入](wechat-merchant-setup.md)。对外只开放 `/live` 和验证微信通知的 `/v1/payments/wechat/notify`；没有创建订单、管理员、退款或文件下载接口。
- 本机仅监听 `127.0.0.1:8899`，不会公开本机账户服务、研究文件或法律项目服务。
- 每次运行要求全新的私有输出目录，先持久化原订单号，再提交一次下单；歧义错误仅查询原订单号，不能自动换订单重试。
- 二维码 20 分钟后停止接受付款；每 15 秒签名查询。进程最多运行 25 分钟，届时先查单，仍待支付时尝试关单；已成功的订单不会关单。主动退出不自动退款。
- 通知 body 上限 64 KiB，验证签名、5 分钟时间窗、解密，并核对具体订单/商户/AppID/精确金额。重复通知只重写同一诊断记录，不授予任何权益；迟到的 NOTPAY 快照不能覆盖 SUCCESS。
- 日志不输出 SDK 原始错误、密钥、支付人或原始通知；仅允许已知错误码。私有 `order.json` 保留订单号、支付链接、脱敏状态和交易号以供核对，不包含商户密钥或付款人。

## 复现

不要再次使用已经付款的输出目录或二维码。每次实付测试都须得到明确授权；本次 ¥0.01 授权不表示后续任意实付、退款或批量订单已获授权。

在 MaterialsX 项目根目录先启动只指向诊断端口的隧道：

```sh
ngrok http 127.0.0.1:8899 --inspect=false
```

本机曾遇到 `ERR_NGROK_9009`：ngrok 免费账户不支持代理连接。仅对当前 ngrok 子进程取消代理即可，不修改系统代理或其他服务：

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy \
  ngrok http 127.0.0.1:8899 --inspect=false
```

读取该进程实际分配的 HTTPS Origin，再从另一个终端启动一次性探针：

```sh
source runtime/wechat-pay/connection.env
npm run m5:payments:one-fen -- \
  --origin https://YOUR_CURRENT_NGROK_HOST \
  --dir /absolute/private/new-probe-directory \
  --create-one-fen
```

此命令独立于 `MATERIALSX_PAYMENT_MODE` 的常规部署开关；它只进行明确授权的一分诊断，不开放平台订单路径。ngrok Origin 不写入永久生产配置。禁止启用 ngrok HTTP 请求内容检查，否则通知原文可能被额外留存。完成测试后终止自己的 ngrok 与探针进程，不停止其他项目。

使用本地二维码工具，禁止向第三方二维码网站发送付款链接：

```sh
# 可选诊断工具，不加入桌面安装包；需要本机 Pillow。
uv pip install --python python/.venv/bin/python \
  --target runtime/wechat-pay/qr-tools qrcode==8.2
PYTHONPATH=runtime/wechat-pay/qr-tools python/.venv/bin/python \
  scripts/render-wechat-probe-qr.py \
  --order /absolute/private/new-probe-directory/order.json \
  --output /absolute/private/new-probe-directory/payment.png
```

渲染器只接受金额 1 分、待支付、未过期的订单，并拒绝覆盖文件。付款后由微信通知和主动查单更新 `order.json`；`queryVerified` 在该探针中指已通过签名查询确认支付 SUCCESS，`notificationVerified` 指成功通知已验签、解密并匹配。普通 NOTPAY 查单不将订单标为已付。

## 验证

```sh
go -C services/control-plane test -race ./internal/payments ./cmd/wechatprobe
```

覆盖一分固定请求、通知/查询证据中的金额和身份不匹配拒绝、并发重复到账、迟到查询不能回退支付状态、不同交易号拒绝和私有持久记录。既有 SDK 签名/坏签名/加密通知测试继续保留。

本轮实际公网 `/live`、真实微信下单应答验签、用户扫码付款、成功回调验签解密、签名查单与隧道回收已验证；此结果不替代生产 PostgreSQL 订单/权益业务的实付与退款验收。

官方金额规则：Native `amount.total` 使用整数分且大于零，详见 [微信 Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)；本机代理错误说明见 [ngrok ERR_NGROK_9009](https://ngrok.com/docs/errors/err_ngrok_9009)。

## 后续订阅联调

2026-10-01 随后按维护者的新授权，原 1 分订单已经签名查单并补记到本机开发账户，发放 10 真实积分。新增 1 元订阅已实付并发放 1000 积分、激活一个自然月；这不改变本探针在当时不入账的隔离设计。见 [完整联调](wechat-subscription-pilot.md)。
