# 贡献指南

© 2026 吉林大学 AI-DAOS 团队

欢迎改进材料工作流、界面、Skills、运行时与文档。请先阅读 [README](README.md)、[开发状态](docs/STATUS.md) 和对应里程碑计划。GitHub 归属为 [materialsx-jlu](https://github.com/materialsx-jlu)，计划仓库名为 `MaterialsX`，本轮未创建或推送，以下 Issue/PR 流程在仓库建立后适用。

## 提交方式

1. 普通 Issue 提供系统、架构、版本、复现步骤、预期/实际结果和脱敏日志；安全问题按 [SECURITY.md](SECURITY.md) 私下报告。
2. 大改动先讨论目标、科学输出和验收；小修复可直接提交 PR。不要将 M5/M6 计划中的功能标作已完成。
3. Fork 后创建主题分支，小范围修改。PR 说明问题、修改后的行为、验证命令/结果和限制；界面变更附无个人研究信息的截图。
4. 科学测试使用合成、获授权或可再分发的公开数据，记录来源、许可、版本和哈希。禁止上传未授权论文、私有研究数据、模型权重或真实凭据。

贡献者保留其贡献版权；提交者须有权提供贡献，并同意自有新增内容按 AGPL-3.0-only 分发。第三方材料保留原有版权和许可。当前没有另设 CLA 或要求转让版权。

## 环境与目录

建议 Node.js 24、Python 3.12/uv；控制面需 Go 1.25。使用 `npm ci`、`uv sync --project python --frozen` 并保留锁文件。开发启动 `npm run dev`；可选控制面 `npm run control-plane:dev`。

| 目录 | 内容 |
| --- | --- |
| `apps/desktop` | Electron main/preload 与 Vue 界面 |
| `packages` | 合同、Pi 适配、存储、模型策略与共享逻辑 |
| `services/control-plane` | Go 开发订阅/额度控制面 |
| `python` | 科学运行时和文档探针 |
| `skills` / `vendor` | 固定 Skills、双语资料、上游快照与哈希 |
| `models` | 模型目录元数据，非预装权重 |
| `docs` / `release/evidence` | 开发计划与经复核的发布证据 |

## 按变更选择验证

| 变更 | 验证命令 |
| --- | --- |
| TypeScript/Vue、主进程、合同 | `npm run check`、`npm run test`、`npm run build` |
| Go 控制面 | `npm run control-plane:test` |
| Python 文档/科学代码 | `uv run --project python pytest` |
| Skill/元数据/示例 | `npm run skills:audit`、`npm run skills:accept`；打包后 `npm run skills:verify-bundle` |
| Pi/MCP | `npm run m0:pi` 及相关自动化测试 |
| 发布工程 | `npm run m4:readiness`；正式放行用 `npm run m4:release-gate` |
| 所有公开提交 | `python3 scripts/check-public-secrets.py`；人工检查差异、截图和二进制资产 |

完整 `npm run verify` 包含类型、测试、构建、Go、Python、Skills、Pi 和运行时预检。`m0:preflight`、`m0:lammps`、`m0:qe` 可能需要额外 OCR/求解器环境，报告要区分未安装、未执行和失败。当前 CI 只覆盖部分开发检查，不能替代双平台实机安装、科学保留集或付费链路验收。

纯文档/版权修改可核对链接和配置，无需新增机械复现实现的测试。科学行为/执行逻辑修改须补充有意义的输入、边界或失败回归测试；默认单元测试不调用真实付费 API。

## Skills、依赖与科学结果

- 不手改上游快照绕过哈希。上游变更更新固定提交、同步流程、清单与许可；自研 Skill 使用对应清单生成流程。
- 默认启用不代表可选软件已安装。新增依赖声明平台、版本、许可、下载和失败行为。
- 修改依赖或重装 Python 运行时后执行 `python3 scripts/generate-third-party-inventory.py`，人工审核清单差异。
- 保留单位、页码、证据、缺失与不确定性。格式校验和科学质量分开报告，文字声明不能替代真实执行产物。
- M6 模型的代码、权重、训练数据许可分别核验，不从代码许可推导权重再分发权。

## 凭据与公开发布

`.env.example` 仅是占位变量清单，当前入口不会自动加载 `.env`。`ROOTFLOWAI_*` 是未来 M5 服务端契约，当前尚未实现。真实 Key 不得进入命令历史、PR、Issue、日志或截图。

`.gitignore` 不会移除已经提交的文件。提交前检查 `git status` 和 `git diff --cached`；扫描器检查当前文件与暂存内容，不能证明历史或所有类型秘密都不存在。泄漏后先撤销/轮换，再清理历史与发行产物。

二进制分发前提供该版本对应源码、构建说明、依赖许可和必要源码获取方式；根 LICENSE 不能代替完整第三方复核。
