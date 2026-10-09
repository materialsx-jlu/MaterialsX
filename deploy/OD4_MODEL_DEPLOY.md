# OD.4 模型代理发布作业

本阶段把模型部署从计费 Web 请求移到独立 Go Worker。后台提交目录修订号和幂等键；作业在 PostgreSQL 保存当时的模型、能力回执、灰度名单与价格版本快照。Worker 从加密的供应商凭据生成私有候选清单，LiteLLM 适配器先渲染、检查和验证候选配置，再切换当前文件、重启代理、核对健康、模型别名和 Go 网关虚拟 Key，最后写入不含密钥的回执。浏览器不接触供应商 Key，也不能调用本机 `launchd`。

## 部署前提

1. 用数据库迁移角色执行 `npm run identity:ctl -- --command migrate`；迁移 018/019 新增作业表、已部署版本以及目录编辑保护。随后**重新**执行 `npm run identity:ctl -- --command grant-runtime --role <受限运行角色>`，否则 Worker 无法领取作业或回写回执。先备份数据库。
2. Linux 控制面发布包应包含 `bin/modeldeploy`，LiteLLM 独立包应包含 `deploy-runner.mjs`、`manage.mjs` 和两个 systemd 单元。`/var/lib/materialsx-litellm` 只归 `materialsx-litellm` 用户访问，目录 `0700`，`secrets.env`、模型清单、凭据和配置均为 `0600`。LiteLLM 已完成独立数据库迁移，并在 `127.0.0.1:4001` 响应健康探针；4000 管理界面继续只供管理员访问。
3. 将 `services/litellm/systemd/materialsx-model-deploy.service` 安装到 systemd，`50-materialsx-model-deploy.rules` 安装到 `/etc/polkit-1/rules.d/`。规则只授权 `materialsx-litellm` 用户重启 `materialsx-litellm.service`。检查主机的 polkit/systemd 版本和服务名后，执行 `systemctl daemon-reload`。Worker 不以 root 运行。
4. 创建仅服务账户可读的 `/etc/materialsx/model-deploy.env`，引用现有身份服务的数据库、主密钥及生产身份配置，另外设置 `MX_LITELLM_RUNTIME=/var/lib/materialsx-litellm`、`MATERIALSX_MODEL_DEPLOY_RUNNER=/opt/materialsx-litellm/current/services/litellm/deploy-runner.mjs`、`MX_LITELLM_PORT=4001`。`MATERIALSX_MODEL_MANIFEST_PATH` 如设置，必须指向运行目录的 `model-registry.json`。不要把真实值写进 Git、安装包或命令行。Go 网关的 `MATERIALSX_LITELLM_URL` 应指向私网代理 `http://127.0.0.1:4001`，而非 4000 管理 UI。
5. 在测试机先运行 `systemctl start materialsx-model-deploy`，检查服务存活；再经管理界面提交测试目录。Worker 会独占 PostgreSQL 队列锁，同一时刻只有一个实例可部署。

## 发布与核对

管理页面的“提交代理部署”只是入队，不能视为完成。作业状态为 `queued → running → succeeded/failed/uncertain`；页面可刷新查看作业 ID、目录修订和回执。代理部署成功后数据库才写入 `deployed_version`。新增模型先部署一次供代理探针使用；价格复核后再次部署，才能提交灰度状态。提交灰度会写入授权账户与价格版本并增加模型版本，此时需再次部署包含该授权名单的目录；生产网关只在 `deployed_version=version` 时开放灰度调用。正式上线同样先保存新状态，再部署包含正式目录版本的清单；部署前暂不提供新请求。停用立即关闭新请求，随后再部署一次以移除代理中的旧别名。目录编辑在待部署或待核对期间被数据库拒绝；消费者只从已生效的模型状态与价格版本展示目录，历史任务继续按预留时价格结算。

`failed` 只有在旧配置恢复、旧代理重启并通过探活后才作为确认失败写入。中断、回执丢失、文件与新旧两版不符均为 `uncertain`；此时目录冻结，后台禁用重复部署。运维使用作业 ID 先做只读核对：

```sh
sudo systemctl stop materialsx-model-deploy
sudo systemd-run --wait --collect -p User=materialsx-litellm \
  -p EnvironmentFile=/etc/materialsx/model-deploy.env \
  /opt/materialsx-control-plane/current/bin/modeldeploy --reconcile <作业 UUID>
```

这一步比较当前三个私有文件与候选/旧版备份，并查询代理健康与路由；不会重发供应商模型请求。若文件曾部分写入，且旧版备份完整，可以**明确选择恢复上一版**：

```sh
sudo systemd-run --wait --collect -p User=materialsx-litellm \
  -p EnvironmentFile=/etc/materialsx/model-deploy.env \
  /opt/materialsx-control-plane/current/bin/modeldeploy --restore <作业 UUID>
sudo systemctl start materialsx-model-deploy
```

恢复操作会重启代理并复核旧别名；只有回执确认为 `failed` 后才解冻目录。若只需核对且已确定为 `succeeded` 或 `failed`，也要重新启动 Worker。若仍为 `uncertain`，保持 Worker 停止并由运维核查代理日志、备份和实际路由，不能手动把数据库状态改为成功。临时 systemd 单元从受保护文件读取环境，不把密钥写入命令行；正常 Worker 应先停机，避免与手工恢复争抢单例锁。

## 验收边界

本机已覆盖 PostgreSQL 幂等入队、版本冲突、受限角色授权、目录冻结、部署回执、灰度门槛、候选文件校验、故障回滚、Worker 中断后的核对/恢复，以及计费 Web 对 Go 私有 API 的转发。候选配置在本机真实 LiteLLM 运行目录中执行了 `render/check/validate`，未重启当前代理。**尚未在 Linux 测试机执行 systemd/polkit、真实供应商探针、四页面一致性、灰度与正式上线、停用及恢复演练**；这些是 OD.4 的真实环境验收项，不能以本机单元测试替代。OD.5 正式 MX 收费仍关闭。
