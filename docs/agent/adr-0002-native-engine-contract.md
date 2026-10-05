# ADR-0002：单一引擎边界、研究合同与原生 Codex 接入

日期：2026-10-05。状态：UA.1 已实施；跨平台隔离、科学质量、真实付费供应商端到端另行验收。

UA.1 扩展补充见 [本地双引擎记录](ua-1-extension.md)：模型来源与引擎选择独立；本地原生 Responses 使用实际模型身份，平台继续原 M5 composer 映射。两种协议适配均不执行工具，原生执行循环仍由所选引擎拥有。沙箱网络收窄到本轮宿主服务端口；兼容探针不代表科学验收。

## 决定

在已有 Pi、M5、M6 和 WorkspaceStore 之上增加 AgentEngine 边界。引擎拥有执行循环，适配层负责合同、能力、事件和宿主引用；后续 TaskSupervisor 不重新执行引擎工具。

使用公开固定 `@openai/codex@0.160.0` 的 app-server v2 stdio RPC。没有依赖桌面私有实现，也没有同时引入另一套 Codex SDK 包装。同一固定公开依赖作为构建来源；产品原生资源完整复制至 MaterialsX 专属 Resources/agent-runtime/codex，原 node_modules 分发文件从 app.asar 排除。产品启动只使用自己的资源目录，不解析全局包或 PATH 中的 Codex。上游来源：[固定版本源码](https://github.com/openai/codex/tree/rust-v0.160.0)、[app-server 协议](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/app-server/README.md)。本机协议生成和实际回执用于检验接入，不根据名称假设 API 支持。

Codex 新版 additional_tools/custom_tool_call 经过受限线协议转换为 M5 固定 agent_exec/agent_wait 函数；响应转换回原生 composer。转换器不执行 JS/科学代码、不做失败重试。Go 审核工具名和完整 schema，原生进程执行一次。本机网关不带供应商密钥，平台传输继续使用原认证客户端、任务、请求、预算、用量及结算。

ResearchGoalPlan 是唯一目标/计划合同。模型只能提供解释提案，宿主提供 UUID、授权、费用/时间上限、真实源引用与快照；执行前校验。六部分内容保存到原 WorkspaceStore app_meta，无另一套计划/状态/账本数据库。任务完成字段和科学验收字段独立。

M6 TypeBox 和 Zod action 定义迁至 contracts 的一份共享模块，保持原 Go 冻结 schema。HostMcp 调用原 ScienceBridge.execute，最终产物也用原桥核验。保留原 PDF 受管流程，UA.6 再迁移为同一引擎的领域 Skill，UA.1 不复制抽取业务。

## 权限选择

当前 macOS 原生 Codex 使用实际外层 sandbox-exec 限制项目文件/常见凭据/外部网络。只依赖 workspace-write 会允许额外读范围；外层沙箱内再施加子沙箱会发生 sandbox_apply EPERM，因此 turn 声明 externalSandbox，且实际外层限制不撤销。负向文件/网络测试及正向原生执行同时通过才准入。其他 OS 不降级为全盘读写，暂提供 Pi。

本地 Pi 保留原权限语义并诚实声明 sandbox=none，新增每轮工具授权检查。原生 Codex 的项目权限确认覆盖本轮所选项目，不授权系统中其他用户目录。补充输入不能扩大授权、预算或安装依赖。

## 取舍与未完成项

复杂任务解释会额外消耗一次模型请求，仍计入同一个 M5 任务预算。解释失败即停止，不能静默跳过合同或更换模型。清晰简单请求和已有受管 PDF 抽取可直接执行。

原生线程恢复只证明历史续接。科学任务恢复、只阻断受影响步骤、预算分项、两次以内纠错、重规划/验收和产物重用留到 UA.3/UA.4。真实 gpt-oss-20b 合同解释有失败项，不能宣称 Codex 等级的需求理解。多 Agent、任意互联网搜索/安装、生产跨平台与商用发行未在本阶段开放。
