# 在对话中安装 Skills

MaterialsX 支持独立安装 Skill，不需要当前电脑安装 Codex，也不需要调用 LLM 完成安装。

## 使用方式

在任意项目的对话中发送一个安装指令：

```text
安装 Skill frontend-design
安装 pymatgen Skill
安装 Skill https://github.com/anthropics/skills/tree/main/skills/frontend-design
安装 Skill /Users/你的用户名/研究技能/my-skill
Install Skill frontend-design
```

本地路径可以指向 Skill 文件夹或 `SKILL.md`。含空格的路径也支持。
GitHub 地址可以是具体 Skill 的目录或 `SKILL.md` 地址。仓库有多个 Skill 时，请选择具体目录。
纯名称先查内置、自建和已安装的 Skill，再按精确目录名称查 `anthropics/skills`、`k-dense-ai/scientific-agent-skills`。
未知名称、同名来源冲突或来源不可访问时返回明确提示，不猜测仓库或宣称安装成功。

完成后，Skill 会出现在 Skills 页的“已安装扩展”分类和对话 `@` 列表。
下一条消息可输入 `@名称 我的任务…`。已安装的同内容包不会重复下载后覆盖；按名称重复安装直接返回当前状态。

## 安装与运行

询问“你可以自己安装 skill吗”会直接显示应用安装说明；不需要模型、账户或管理员，也不会触发安装。`skill_capabilities` 提供当前宿主事实和扩展状态供模型查询。旧原生会话会在请求时补齐当前指导；修复原因和验收边界见 [能力认知记录](agent/capability-awareness.md)。

- 包保存在 MaterialsX 自己的用户数据目录 `installed-skills/<名称>/`，与内置、自建 Skill 分开。
- 保留原始 `SKILL.md`、脚本、参考文件和许可。GitHub 来源固定到提交 SHA；安装记录保存来源、文件大小及 SHA256。
- 安装只保存文件，不执行脚本、不安装 Python/npm 依赖，也不增加科学计算、网络或终端权限。
- 运行时继续使用 Pi / Codex App Server 的原有工具循环与授权。`skill_resource` 可以列出、读取资源，或把校验后的资源复制到项目 `.materialsx/skill-resources/<名称>-<内容哈希>/`；既有项目工具随后才能在自己的沙箱内处理它们。
- 安装指令是宿主应用对人类明确命令的处理。论文内容、模型回答或第三方 Skill 不能据此授权安装额外软件。
- 中文、英文指令都支持。第三方未声明中文简介时显示来源原文，不伪装成已翻译；自建 Skill 仍支持完整双语介绍与例子。
- 扩展管理支持停用、启用及移除；移除的原文件保留在 `installed-skills/.trash/`，重新安装不会覆盖回收文件。

## 边界

当前支持 GitHub HTTPS 公共来源及本机文件夹。不接收任意网站、压缩包、私有仓库凭证、符号链接或子模块。
分支名称含斜杠时请改用提交 SHA 地址。
单个包最多 256 个文件、20 MiB；单文件最多 2 MiB，`SKILL.md` 最多 60000 字节。
环境文件、私钥、越界路径、平台保留文件名及大小写冲突会被拒绝。
不同内容的同名版本不会自动覆盖；先移除旧版再明确安装新版。
依赖缺失、平台不支持或 Skill 本身步骤不可靠，仍可能影响实际任务；安装成功不等于计算资格验收。

## 验证

```sh
npm run check
npm test
npm run build:desktop
node_modules/.bin/electron apps/desktop/skill-install-ui-smoke.cjs
```

测试覆盖真实对话 IPC、无需模型或云账户、持久化索引、Pi / Codex 读取、资源沙箱、重复安装、停用/移除、哈希篡改、路径/符号链接拒绝和取消。
实际 GitHub 名称安装已测试 `frontend-design`，固定 SHA 和下载清单保存在本机 `runtime/agent/skill-install/github-live.json`。

新增 `yaml@2.9.0`（ISC）用于标准 YAML 解析。现有科学方法受完整依赖锁保护，因此随新锁升级为 `1.0.1` 并重新通过 NIST 参考复现；旧冻结任务不会被静默改成新方法版本。
