# OD.6 发行、观测与备份

当前是开发环境。正式域名、服务器、签名、三平台实机和异机恢复完成前，不标记正式发布通过。

## 发行清单

每次发布新安装包必须递增 `package.json` 版本；当前清单仍指向已有的 0.3.0-preview.1 资产，不代表本轮 OD.6 代码已打包。安装包先生成 `release/dist/<version>/release-info.json` 和 `SHA256SUMS.txt`。执行 `npm run od6:release-manifest -- <release-info.json 绝对路径>` 会重新读取每个安装包并核对长度、SHA-256、校验清单与发行信息哈希，然后写入 `website/releases/preview.json` 或 `stable.json`。官网以 `MATERIALSX_SITE_RELEASE_CHANNEL=preview|stable` 构建；不存在的渠道直接失败。构建后的 `website/dist/releases/<channel>.json` 与下载卡片来自同一清单。上传 GitHub Release 时文件名、版本和哈希必须逐项一致。清单不含 API 地址或供应商密钥。

安装版通过 `MATERIALSX_DEPLOY_MANIFEST` 固定 API 和官网 origin。设置 → 版本更新只向包内官网 HTTPS origin 读取相同渠道的清单，显示版本、安装包和 SHA-256。此功能是手动检查及下载入口；用户下载后仍需校验文件。开发版不自动跟随预览版，稳定版不会看到预览版。切换渠道或平台地址需要重新打包。

真实发布或回滚前，设置私有的 `MATERIALSX_OD6_AUDIT_FILE`、`MATERIALSX_OD6_CHANNEL`、`MATERIALSX_OD6_OPERATOR`、`MATERIALSX_OD6_REASON`，执行 `npm run od6:audit -- publish|rollback <发行清单> <部署清单>`；回滚另外设置 `MATERIALSX_OD6_PREVIOUS_VERSION`。只保存摘要、版本、操作人和原因。文件必须在 0700 私有目录，不入仓库或官网。回滚只切换服务版本与路由配置，不运行数据库 down migration，不改写订单、用量与账本；之后重验账本及旧任务回执。现有服务端 `release_registry` 与 `workspace_operations` 继续负责业务发布审计。

## 观测与故障

Go 入口输出 JSON 访问日志，包括请求 ID、固定路由标签、方法、状态、总耗时、首字节与首个已写出的文本 Token 时间；不写原始 URL、查询、请求体、邮箱、认证头或密钥。响应头 `X-Request-ID` 用于工单关联。`/internal/metrics` 同时要求本机来源与至少 32 字符的 `MATERIALSX_METRICS_TOKEN`；边缘网关不得转发该路径。指标覆盖登录成功/失败、模型首字节与代理超时、待核对请求、积压订单、近一小时支付通知数和 MaterialsX PostgreSQL 数据库大小。配置 `MATERIALSX_LITELLM_DATABASE_URL` 时，巡检还会读取 LiteLLM 独立数据库大小并告警。

在部署主机运行 `npm run od6:observe`，检查 Go `/health/ready`、LiteLLM `/health/readiness`、计费 Web `/healthz`、Go 指标和客户端目录版本。`MATERIALSX_OD6_EXPECTED_CATALOG_REVISION` 用于目录漂移检测。设置 `MATERIALSX_OD6_MOOS_HEALTH_ORIGIN` 后检查团队研究服务健康与已记录的 MOOS 读取失败数；它不能代替带授权的 MOOS 实际读取探针。未设置时显示 `not_configured`。退出码 2 代表告警；生产需由监控调度器接管并配置接收人。该巡检使用累计计数，生产调度应计算增量避免旧峰值反复告警。

停止任一后端时先看健康探针与服务告警键，再用请求 ID 定位日志和账本。LiteLLM 停机时本地模型仍可使用；MOOS 停机时科研来源显示不可用；支付通知中断时先查询订单/通知回执，不重复建单；模型请求用量待核对时不得重放上游调用。`reconciliationPending` 与 `agedPendingOrders` 应触发值班核对。

## 加密备份

在仓库外创建 0700 备份目录，提供 0600 的 `MATERIALSX_BACKUP_KEY_FILE`，内容为 32 字节密钥的 64 位十六进制值。密钥应独立保存，不能与快照同盘。各来源独立执行：

```text
npm run od6:backup -- backup postgres /private/backups/identity.mxbackup
npm run od6:backup -- backup litellm-postgres /private/backups/litellm.mxbackup
npm run od6:backup -- backup team-sqlite /private/backups/team.mxbackup
npm run od6:backup -- backup model-credentials /private/backups/model-credentials.mxbackup
npm run od6:backup -- backup moos-source /private/backups/moos.mxbackup
npm run od6:backup -- restore-drill postgres /private/backups/identity.mxbackup
```

输入分别来自 `MATERIALSX_DATABASE_URL`、`MATERIALSX_LITELLM_DATABASE_URL`、`MATERIALSX_TEAM_SQLITE_PATH`、`MATERIALSX_MODEL_CREDENTIALS_PATH`、`MATERIALSX_MOOS_SOURCE_PATH`。PostgreSQL 使用 `pg_dump` 自定义格式；SQLite `.backup` 包含已提交 WAL 内容；目录来源用 tar。AES-256-GCM 加密快照；演练认证解密后检查 `pg_restore --list`、SQLite `quick_check`、tar 列表或凭据非空，再删除临时明文。旧 M5 明文备份命令已移除。默认演练是**快照格式检查**。如设置 `MATERIALSX_OD6_RESTORE_DATABASE_URL` 为独立本机空库且名称以 `_restore_test` 结尾，PostgreSQL 两类快照还会真实还原并检查表数；随后仍须由人工核对应用登录、订单和账本。异机断电恢复必须另行执行。

## 放行记录

本机检查：`npm run od6:test`、`npm --prefix website run check`、`npm run check:core`、`go -C services/control-plane test ./...`。正式放行还须存档真实 Release 资产哈希、配置摘要、后端故障演练、账本前后核对、异机恢复，以及 macOS/Windows/Linux 分别安装→登录→本地模式→云模型→研究数据→更新→卸载的实机记录。本机临时 PostgreSQL 数据库已完成加密备份、独立空库实际还原及行值核对，测试库已清理。当前仍缺正式部署、异机恢复与三平台机器；本机验证不能代替这些验收。
