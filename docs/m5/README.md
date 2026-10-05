# M5 实施说明

更新时间：2026-10-01。代码、离线验证及 `gpt-5.6-sol` 核心 Responses/Pi 实测通过，费用对账仍待确认；受限技术Alpha已接通，未开放平台收费。

© 2026 吉林大学 AI-DAOS 团队

M5.1 已实现 PostgreSQL 身份、浏览器登录、设备、管理员 MFA 与审计基础；启动和验收见 [identity.md](identity.md)、[M5.1 执行报告](identity-execution-report.md)。M5.2受限网关及M5.3 test-credit账本/材料流程也已本机验收，[M5.3指南](metering.md)提供启动、worker及管理员核对方式。M5.4 的订单/退款测试闭环见 [payments.md](payments.md)。M5.5 已实现六项桌面导航、独立运营后台、账单趋势和版本目录门禁，见 [启动指南](workspace.md) 与 [执行报告](workspace-execution-report.md)；正式收费及 M5.6 Beta 仍待验收。以下接入探针部分保留 M5.0 的历史交付边界。

## 本期交付

| 交付 | 位置 | 当前状态 |
| --- | --- | --- |
| 服务端 RootFlowAI 探针 | `services/control-plane/cmd/m5probe/`、`internal/providers/rootflow/` | inspect/discover/live；受控域名、预算、输出、只读工具、脱敏报告 |
| Pi 协议兼容探针 | `packages/pi-adapter/src/platform-probe.ts` | 固定 SDK 0.99.1，合成回归及真实两轮工具结果回传通过 |
| 可执行合同与 OpenAPI | `packages/contracts/src/platform.ts`、[openapi.json](openapi.json) | M5 核心身份/模型/任务/请求/权益/订单；身份部分已实现，其他路径仅合同 |
| 计费与预算规范 | [billing-budget.md](billing-budget.md) | 单位、usage、舍入、预留、异常与价格审核规则 |
| 协议决策与证据 | [protocol-decision.md](protocol-decision.md)、[execution-report.md](execution-report.md) | Responses 核心及 Pi ModelRuntime 已实测通过；失败/阻断不伪装为通过 |
| UI 草图 | [ui-wireframe.html](ui-wireframe.html)、[ui-spec.md](ui-spec.md) | 六项导航、供应商详情、预算、用量及独立运营中心示意 |

M5.0 当时不实现 MX-502 的生产身份/PostgreSQL、不开放生成网关、真实收退款或桌面自动更新。现有本地模式与开发控制面保持原有行为。

## 无费用验证

在仓库根目录：

```bash
npm run m5:contracts
npm run m5:verify
```

`m5:verify` 检查类型、Node/Go 回归、合同漂移、Pi 合成流和本地配置预检。最后的 `m5:probe` 默认 `inspect`，不访问供应商；阻断报告不是供应商测试通过。Node/Go 用例使用内存或本机 HTTP 合成数据，CI 不注入供应商 Key。

开发产物写入已忽略的 `runtime/m5/`；报告不保存 Key、请求正文、工具参数或响应正文。报告中的 `environment` 区分 `no-network`、`synthetic-fixture` 和 `real-provider`。

## 真实接入前准备

最初授权上限为30元。2026-10-01 用户重新提供凭据，并明确解除本轮诊断的金额预算限制；价格仍未知，不能标记免费或生产可售。新增 `--unbudgeted-test` 仅在显式 `live` 模式跳过金额及价格预检，仍限制6次生成、256输出 Token/次，不重试、不静默换模型。默认行为继续使用原有有价预算保护。

需配置：

| 环境变量 | 用途 |
| --- | --- |
| `ROOTFLOWAI_API_KEY` | 测试进程/服务端环境提供，不写命令参数、公开文件或安装包 |
| `ROOTFLOWAI_BASE_URL` | 可省略；规范化为 `https://api.rootflowai.com/v1`，拒绝其他主机及 `/v1/v1` |
| `ROOTFLOWAI_MODEL` | 可省略；固定 `gpt-5.6-sol`，其他值拒绝 |
| `ROOTFLOWAI_TEST_BUDGET_FEN` | 默认有价测试不超过 `3000`，单位人民币分；显式无金额上限诊断不读取其金额限制 |
| `ROOTFLOWAI_INPUT_PRICE_FEN_PER_MILLION` | 目标账户有效普通输入价，人民币分/百万 Token，正整数 |
| `ROOTFLOWAI_OUTPUT_PRICE_FEN_PER_MILLION` | 目标账户有效输出价，人民币分/百万 Token，正整数 |
| `ROOTFLOWAI_ACCOUNT_GROUP`、`ROOTFLOWAI_MEMBERSHIP` | 经账户核对的模型分组与会员档 |
| `ROOTFLOWAI_PRICE_REFERENCE` | 私有采购价格核对记录引用；报告不复制其内容 |
| `ROOTFLOWAI_PRICE_CONFIRMED` | 完成价格/计费方式与账户核对后设 `1` |

根 `.env.example` 是占位合同；探针不自动加载 `.env`。本机临时测试可在独立终端通过隐藏输入读取 Key，再导出到该进程环境；不要将真实值写入命令历史。例如 macOS zsh：

```bash
read -r -s ROOTFLOWAI_API_KEY
export ROOTFLOWAI_API_KEY
export ROOTFLOWAI_TEST_BUDGET_FEN=3000
npm run m5:probe -- --mode discover
unset ROOTFLOWAI_API_KEY
```

`discover` 只请求模型列表，不生成文本；列表存在也不能证明余额、协议、模型真实来源或价格。代码不从聊天记录提取凭据，也不读取用户其他软件的凭据存储。

完整价格环境核对后：

```bash
npm run m5:probe -- --mode live
```

Responses 独立验证不满足时，才显式选择并独立测试另一协议：

```bash
npm run m5:probe -- --mode live --protocol chat-completions
```

探针每轮至多 6 次生成、每次 `max_output_tokens` 或 `max_completion_tokens` 为 256，只使用合成材料提示和固定硅读取工具。该上限仅供小型接入探针，不是产品通用输入/输出上限，也不是完整科研效果评测。失败、usage 缺失或预算不足停止后续核心步骤；不自动切模型、协议或重试。

30 元是整轮授权总额，不是每次运行额度。真实生成前持久化累计预留上界至 `runtime/m5/rootflowai-budget.json`，使用独占 lock 拒绝并发运行，重启不重置，修改报告路径不改变预算文件。失败/超时也保留尝试上界；不要删除、清零或另建测试目录绕过预算。异常崩溃遗留锁时先核对进程与供应商消费记录再处理，不自动按 TTL 删除锁或释放资金。

该本机保护只约束估计上界，不能阻止供应商忽略参数、未知独立费用或其他程序消费；有上游硬限额时同时设置。它不是生产事务账本或真实成本结算系统；实际核销由后续对账能力完成。

通过私有 stdin 注入 Key 时，可以使用 `--key-stdin`，调用方须关闭 stdin。凭据不放入命令参数；报告标明 `budgetPolicy: waived-for-diagnostic-test`。授权诊断命令：

```bash
npm run m5:probe -- --mode live --unbudgeted-test --key-stdin
```

该选项不启用生产网关、不确认价格，也不清零旧预算文件。金额字段零表示未计算金额预留，不代表调用免费。

## 2026-10-01 初次真实测试（历史）

认证及 `/v1/models` 返回 HTTP 200，10个可见模型中没有精确 `gpt-5.6`。另外对用户指定型号发起一次非流式 `/v1/responses`，返回 HTTP 503、`model_not_found`，供应商说明当前令牌分组无可用通道。探针再次查列表，按精确型号规则停止，未偷偷替换相近型号。

本次合计3个 API 请求（2次模型列表、1次生成尝试），没有成功生成、没有有效 usage；实际扣费未知。流式、工具、结构化输出和 live Pi 未执行。详见 [原始诊断元数据](evidence/rootflowai-live-exact-model.json)、[探针报告](evidence/rootflowai-live-probe.json) 与 [执行报告](execution-report.md)。

上述是改选前的历史失败。用户随后明确改选 `gpt-5.6-sol`，结果见下文；原始证据保留。

## gpt-5.6-sol 追加实测

模型发现、非流式、流式、工具与结果回传、单字段结构化 JSON 通过；固定 Pi ModelRuntime 两次真实请求也通过。查看 [Go 真实报告](evidence/rootflowai-live-sol-responses.json)、[Pi 真实报告](evidence/pi-responses-live-sol.json) 和 [协议决策](protocol-decision.md)。

Pi 真实测试需三个显式开关，从私有 stdin 读取 Key：

```bash
npm run m5:pi -- --live --key-stdin --unbudgeted-test
```

默认 `npm run m5:pi` 仍是无网络合成验证；live 成功报告保存到忽略的 `runtime/m5/pi-responses-live-sol.json`。每轮最多2个真实请求，只读合成硅记录，凭据及科研正文不保存。

本次供应商 raw input 约4.4K，超过短提示的本地估计。有价测试仍停止；授权免金额诊断记录 warning。Pi 诊断上下文额度改为32768以留足内部余量；这是测试配置，不是供应商容量承诺。50ms 本地取消被观测，上游取消与费用仍未确认。当前未接通桌面生产网关或销售。

## 草图查看

可直接在浏览器打开 `docs/m5/ui-wireframe.html`，或在仓库根目录：

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs/m5
```

打开 `http://127.0.0.1:8765/ui-wireframe.html`。草图可以切换导航、供应商、搜索、深浅色和运营中心；所有业务操作禁用，无网络调用。不作为已实现的后台发布。

## 验收状态与后续

MX-501 的离线交付和 Responses/Pi 核心接入实测完成；采购价、供应商消费日志及商业数据处理核对尚未完成，完整科研工作流与生产平台链另行验收。可以继续 MX-502/503，仍不把桌面平台模型标成正式可售。详见 [执行报告](execution-report.md)。

M5.2已接通受限平台网关/Pi只读工具回路。参见 [启动指南](gateway.md) 与 [执行报告](gateway-execution-report.md)，资金/订阅账本仍属M5.3及以后。
