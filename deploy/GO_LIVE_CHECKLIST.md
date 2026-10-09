# MaterialsX 公网部署前核对（2026-10-09）

**当前结论：可以准备 staging 和公网只读入口；不能直接开放用户收费、云模型销售或宣布正式版验收通过。** 本机 `config:check` 使用的仍是 development 清单；`od6:observe` 检出 `database:metrics_unavailable`，MOOS 未配置；未发现真实生产清单、正式域名/证书、受限数据库与商户验收回执。现有 0.3.0-preview.1 安装包早于本轮 OD.0–OD.7 变更，不能当作明天的新构建。

## 先准备私有部署材料

1. 在仓库外分别创建 staging、production 清单，替换三个 `.invalid` HTTPS 域名；按 [统一配置](README.md) 验证。staging 使用独立数据库、密钥、账本和测试账户。生产初次只读部署可保持 `cloud.mode: disabled`、`payment.mode: disabled`；若随后切换为正式 MX 收费清单，必须重新从 OD.7 staging 阶段生成整条放量回执链，不能沿用旧清单摘要。
2. 在服务器准备 Nginx 证书、仅管理员可达的 `admin-allow.conf`、PostgreSQL/LiteLLM 独立受限 DSN、身份主密钥、代理令牌和监控令牌。所有秘密放仓库外 0600 文件；`MATERIALSX_SIGNUP_ENABLED=0`，运营 `cloud_paused=true`、`sales_paused=true`。先核对真实数据库中的暂停值与版本；迁移默认值不能代替这一步。
3. 在 Linux 主机安装 Go API/Worker、团队服务、LiteLLM 和计费 Web 的对应版本。迁移由 owner 角色执行，API/Worker 使用受限角色；使用 [`deploy/systemd/`](systemd/) 的现行 API/Worker/团队单元，核对二进制路径与权限。MOOS 原始 API、数据库、LiteLLM 4000/4001、8788/8790/8793 均不得直接暴露公网。单台 ECS 的 preview 安装顺序见 [Ubuntu SSH 部署手册](ALIYUN_UBUNTU_SSH_RUNBOOK.md)。

## 只读上线顺序

```sh
npm run config:check -- --manifest /private/staging.yaml
npm run config:check -- --manifest /private/production.yaml
npm run config:edge -- --manifest /private/production.yaml --out-dir /private/generated-edge
# 人工安装真实证书、默认拒绝的 admin-allow.conf；在服务器执行 nginx -t，再原子重载。
npm run od6:observe
npm run od7:public-probe -- --manifest /private/staging.yaml --out /private/od7/staging-public-probe.json
```

先部署 staging 并按 [OD.7](OD7_ROLLOUT.md) 收集流式、MOOS ACL、回调幂等、故障注入与隔离回执，再运行 `od7:gate -- --stage staging ...`。之后部署生产只读环境，验证登录、健康探针、目录、管理员隔离、外部端口扫描与客户端断网表现；生成 `read-only` 报告。`od7:public-probe` 不带登录凭据，不会证明业务授权或支付。若探针失败、`od6:observe` 仍报警，先修复原因再推进。

公网安装包必须先递增 `package.json` 版本，再重新构建：`-preview.` 版本设置 `MATERIALSX_DEPLOY_MANIFEST=/private/staging.yaml` 并运行目标平台的预览打包命令；不带预览后缀的稳定版本必须绑定获审的 production 清单。预览包不能绑定生产 `stable` 清单，正式包也不能绑定 staging 清单。检查包内 `materialsx-client.json` 只含获审 origin、渠道和官网地址。重新生成发行清单与 SHA-256，按 [OD.6](OD6_RELEASE_OPERATIONS.md) 记录 `od6:audit` 发布摘要，再核对官网/下载/应用内版本。旧包不能通过改本机 `.env` 指向新公网地址。macOS、Windows、Linux 每个平台仍需分别安装、登录、本地模式、云模式、更新及卸载回归；没有实机回执就保持预览渠道。

域名 `mx.jouhu.com` 的逐步执行顺序见 [最终部署流程](MX_JOUHU_COM_DEPLOYMENT.md)。staging 与 production 的边缘配置不能原样加载到同一个 Nginx 实例：生成配置均含 `default_server` 和相同名称的全局指令，应使用独立入口，或先实现并验证合并配置。

## 放量与故障处理

研究数据、灰度模型、钱包、正式订单按 OD.7 顺序逐项审核；最后一步还需 OD.5 商户/价格/供应商账单批准、真实小额到账及符合规则的退款、异机恢复、告警和回滚回执。解除任何暂停前先核对上一个阶段报告、数据库实际值、Worker 心跳和价格目录。异常时立即暂停新云调用和新销售，保留支付通知、已派发请求结算、退款与账本只读查询；不重放待核对模型请求，不执行数据库 down migration。

上线当日保存：清单 SHA-256、Nginx 配置检查、证书与外部扫描、`od6:observe` 输出、OD.7 每阶段报告、安装包 SHA-256、备份/恢复记录、订单/请求 ID 和回滚演练。不得保存明文 API Key、密码、商户私钥或用户论文内容到公开日志和仓库。
