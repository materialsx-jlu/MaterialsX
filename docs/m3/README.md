# M3 订阅与额度控制面

M3 当前交付的是可验证的开发控制面和桌面权益界面。它不会发起真实付款，也不会自动续费；Pro ¥199/月与 Research ¥599/月沿用开发计划中的测试价格假设。

## 启动

先启动 Go 控制面：

```bash
npm run control-plane:dev
```

再启动桌面端：

```bash
npm run desktop:start
```

桌面侧栏的“订阅与额度”页面会显示控制面状态。开发模式允许启用 Pro 或 Research 测试权益，每次启用建立一个新的手动账期，不产生订单或支付。

控制面仅监听 `127.0.0.1:8787`，开发状态保存在根目录 `runtime/m3-control-plane/state.json`。该文件不进入版本库。

## 当前 API

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | 控制面健康状态 |
| `GET /v1/plans` | Community、Pro、Research 测试套餐 |
| `GET /v1/entitlements/{accountId}` | 当前订阅、账期与额度汇总 |
| `GET /v1/ledger/{accountId}` | 追加式账本记录 |
| `POST /v1/dev/subscriptions` | 仅开发模式授予测试权益 |
| `POST /v1/credits/reservations` | 模型调用前并发安全预留 |
| `POST /v1/credits/settlements` | 按实际 usage 结算；缺失 usage 进入待对账 |
| `POST /v1/credits/releases` | 取消或失败时释放预留 |

所有金额使用分，额度使用整数 credits。事件 ID、reservation ID 和 request ID 是幂等边界。

## 已验证账本规则

- 重复订阅事件不会重复授予额度。
- 重复结算事件不会重复扣减。
- 并发预留不能超过剩余额度。
- 实际消耗少于预留时自动释放差额。
- provider usage 缺失时保留预留并追加 `reconciliation_pending`，不会按零或上限擅自结算。
- 套餐切换产生新 period，上一账期余额和用量不会带入新账期。
- 状态文件重启后可恢复。

## 生产化边界

当前服务是单机开发实现。真实付费 Beta 前必须补齐：

1. 正式账号、设备令牌刷新和撤销。
2. PostgreSQL 事务账本和多实例并发。
3. 一个已获商户能力的支付渠道、webhook 验签、乱序/重复处理、退款和对账。
4. 平台模型网关、供应商 usage 和成本 reconciliation。
5. 管理后台、操作审计和预算告警。
6. 签名的短期离线权益凭证。

在支付主体和渠道确定前，产品界面不得把开发权益描述成已购买订阅或自动续费。
