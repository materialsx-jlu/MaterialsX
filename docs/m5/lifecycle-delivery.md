# M5 生命周期补全与 M5.6 工程验收

2026-10-01。当前合同 `m5.6-v1`，数据库增量迁移 `008_lifecycle.sql`、`009_paid_beta.sql`、`010_email_serialization.sql`。

## 本轮实现

- **完全未使用订单全额退款**：新商品固定 `refundPolicyVersion=unused-full-v1` / `refundRule=unused-full-v1`。不添加未批准的 7 日期限或按比例退款。申请及审批都在原账户/订单锁内重新检查：任何整数或 0.0001 积分消费、预留、冻结、已退金额均拒绝。订阅有后续续费账期时仍拒绝，避免改动其他订单权益；成功后取消该订单的订阅。历史商品/订单/账本快照保持不变，旧联调政策不被追溯改写。
- **工单**：桌面云服务中心 Agent 下「帮助与工单」，运营后台「客服与上线」。创建/回复有幂等键与版本检查；工单、订单/请求引用按所有者隔离。管理员 MFA、同源 Cookie、CSRF 保护不变。处理记录和审计只追加。
- **主动授权附件**：只上传用户手动粘贴、授权的脱敏文本，单个最多 32 KiB，每工单最多 10 个，AES-GCM 加密，SHA-256 与授权版本记录。拒绝明显密钥/密码字符串；这不是全面敏感信息识别，用户仍需脱敏。没有自动收集日志、PDF 或项目路径。
- **邮件开户与找回**：邮箱验证链接 30 分钟单次使用；GET 不消费令牌，POST 需要 Origin 与 CSRF；公开响应不揭示账户存在性。密码 Argon2id；成功找回撤销所有旧设备/会话；管理员仅允许主机 MFA 恢复。发信由加密事务 outbox 执行，数据库只有令牌摘要，邮件明文只在发送时解密。需真实邮件服务及已批准条款后启用；本机默认关闭。
- **通知与告警**：SMTP 强制 STARTTLS、校验证书、有限超时；发送状态不确定或进程中断进入人工队列，防止盲目重发。开发可选择私有文件收件箱，生产禁止该模式。用量/支付长期待核对、未知采购成本、可配置日成本阈值、通知异常产生幂等告警；确认告警不改变钱款或积分。无外部邮件服务时不发送任何邮件。
- **实际采购账单**：管理员导入每请求不可变账单行；需原请求/路由、账单来源、SHA-256、原因及精确整数 `costMicrofen`。1 元 = 100,000,000 microfen。重复相同证据不重复记成本，冲突证据拒绝；导入不改变用户扣款。未知成本明确显示未知。首页按请求向上取整展示成本人民币分，客服与上线页显示 8 位人民币小数的精确账单值。登记的是管理员核实的账单，服务不能仅凭哈希自行证明供应商账单真实性；原账单需由运营保管核验。
- **受控付费 Beta 准入**：管理员可登记/撤销招募名单；新正式商品由部署 CLI 发布；付款验签后原子发积分、自然月订阅及受限付费额度。新订单和模型调用还需要所有生产验收门槛。名单登记本身不会开放收款。原指定开发账户 `paid-pilot` 继续可用。
- **输入计量适配口**：`mx-input-count-v1` 本机受控可执行程序协议，固定路由、二进制 SHA-256、3 秒超时、4096 字节输出上限；必须计算完整原生请求、工具、历史与供应商模板开销。没有实测确认的计量器时禁止一般 Beta。旧指定账户风险预留仍使用 131072 输入上限，不将其冒充准确输入 Token 数。正式 Beta 使用独立价格版本 `paid-sol-counted-20261001-v1` / `verified-route-counter-v1`，从同一事务中的服务端计量证据计算预留（不提前使用缓存折扣），不再为小请求固定预留整个上限。计量结果 >131072 拒绝；实际 usage 超预留仍进入人工核对，不自动扩大扣减。
- **部署与恢复**：API/Worker systemd 模板、Caddy TLS/SSE 反向代理、Worker 心跳、`/health/ready`（DB 与 Worker）、私有 pg_dump 及仅允许本机独立 `_restore_test` 空库的恢复演练。恢复后升级迁移、废止克隆会话、验证账本；不对克隆启动 Worker、不触发付款/退款或模型调用。
- **M5.6 验收入口**：隔离 PostgreSQL 工程测试、`-race`、实际 Electron main/preload/Vue 与同源后台合成闭环。证据写入忽略的私有 `runtime/`。工程验收与真实科研质量、真实生产验收分别登记。

## 使用与测试

```bash
npm run check
npm run test
npm run build
npm run m5:contracts:check
npm run m5:beta:test          # 需要当前专用本机 PostgreSQL；不触发供应商调用或收款
npm run m5:beta:race
npm run m5:workspace:live     # 设置隔离 MATERIALSX_IDENTITY_TEST_DATABASE_URL；合成桌面/后台闭环
npm run identity:local -- --paid-cloud
```

一般 CI 可用现有 `MATERIALSX_IDENTITY_TEST_DATABASE_URL` 执行 `npm run m5:identity:test`，不依赖本机私有配置。不得用生产库作为测试 DSN。

## 待提供的外部资料

用户确认正式域名/服务器、邮件服务、实际采购费率/原账单、Apple/Windows 签名证书全部待定。实际输入计量器、上游取消计费和数据保留约定、专家材料评测、Windows 实机、真实退款/证书轮换仍需验收。当前不会生成采购价格、虚假审批记录或宣称通过生产 Beta。

`deployment/m5/beta-approvals.example.json` 只有空门槛，必然不能开放正式收款。由部署人员核实原始资料后，在仓库外创建 0600 的审批文件；每项包含 `id/evidenceRef/sha256/approvedBy/approvedAt/expiresAt`（最多 90 天有效），绑定固定路由及 `unused-full-v1`。运营 UI 不能自行把这些项目勾选通过。

必需门槛：deployment、email、procurement、input-metering、wechat-payment-refund、privacy-retention、restore、capacity、materials-quality、macos-signing、windows-install。证据登记是运营审批，不是自动密码学证明。真正供应商 API 能力与费率以采购账户资料为准；[RootFlowAI API 文档](https://rootflowai.com/docs/api/reference) 不构成特定模型 Token 计量或取消收费保证。

## 范围边界

本轮补齐 M5 单供应商订阅、账户、用量、客服及运营生命周期代码。GitHub 安装包自动发布、签名后自动更新及 Skills 热更新属于 M4/发行扩展；多供应商采购与通用云 MCP/任意脚本属于后续平台扩展；机器学习势和 3D 属于 M6。它们没有因本轮交付而被标记实现。见 [剩余工作](remaining-work.md)。

## 本机最终验收记录

- TypeScript：86 项，85 通过，1 项需要另行实时身份服务的测试跳过；不是将跳过计为通过。
- Go / PostgreSQL 16 / race：全包通过，包括精度退款、重复支付、超额/中断恢复、角色限制、邮箱并发单次验证、通知不确定性、工单隔离、账单不可变及 Beta 幂等。
- 实际 Electron main/preload/Vue + 后台 Cookie/MFA + 隔离 PostgreSQL：购买→调用→账单→退款；工单→管理员回复→桌面查看；主题/双语、暂停恢复、CSV、CSP、缺项门槛均通过。全程合成支付/模型，没有新增真实扣款。
- 包含实际消费的本机备份恢复：独立克隆迁移升级、会话失效、账本校验通过，克隆已删除；这是本机恢复工程验证，不是生产灾备验收。
- 已有真实消费只读核对：2 请求、消耗 5.668、余额 1004.332、预留 0，钱包/账单/流水一致，采购成本仍未知。
- 构建、类型检查、合同漂移、当前公开候选/索引文本密钥扫描通过。扫描不覆盖全部 Git 历史/任意凭据格式，15 个二进制/大文件/符号链接仍需发行前人工核查。

开发 API 与 Worker 已更新，本机入口为 `http://127.0.0.1:8788`，后台 `/ops`；通用收款、邮件与公开注册仍关闭。现有 RootFlowAI 指定账户消费模式保持可用。
