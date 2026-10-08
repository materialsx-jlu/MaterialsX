# MaterialsX 独立 Agent 运行时分发

更新：2026-10-05。MaterialsX 安装包必须自带公开 Codex 运行程序及其完整平台资源；用户无需安装 Codex CLI、Codex 桌面软件或 Node 来使用已接入的原生 Agent 工具。

## 文件与启动规则

生产应用只从自己的资源目录启动：

```text
MaterialsX.app/Contents/Resources/       # macOS；Windows 为安装目录/resources/
  app.asar                              # MaterialsX 的适配层、合同和界面
  agent-runtime/codex/
    manifest.json
    LICENSE
    NOTICE
    aarch64-apple-darwin/                # 按目标平台/架构替换
      codex-package.json
      bin/codex
      bin/codex-code-mode-host
      codex-path/rg
      codex-resources/                  # 上游 shell、库、许可及配套资源完整保留
```

版本固定为 0.160.0，平台表只有一份 `packages/agent/codex-runtime.json`。开发模式也只解析 MaterialsX 项目的固定依赖；生产模式不通过 require 搜索全局包、不通过 PATH 查找 Codex、不读其他应用的运行目录。移除任意指定外部二进制的产品配置；缺资源、版本/平台错误或指向应用外的 symlink 都会停止，并提示重装 MaterialsX。

配置、原生会话和缓存写入 MaterialsX 自己的 userData/codex/账户/会话目录，不复用 `~/.codex`、Codex 登录信息或 Codex 桌面缓存。平台 API 继续使用原 M5 服务，内置程序不包含供应商凭据；平台访问仍需要相应账户和网络，独立分发不代表模型本身离线。

原生进程 PATH 由包内 rg/bin 和系统基础命令目录构成，不继承 Homebrew/npm 全局 PATH。终端命令应使用 login=false 保留该 PATH；用户自行要求加载登录 shell 时，系统 profile 可能另行设置命令搜索路径。运行时始终用固定绝对路径启动，不因 shell PATH 改变而替换为外部 Codex。

## 打包工程

electron-builder 的 beforePack 检查固定依赖/lockfile/目标平台，afterPack 将该平台完整 vendor 布局复制到应用独立资源目录，保留执行权限和全部上游通知。原 node_modules 中的 Codex 分发文件从 app.asar 排除，避免在一个安装包里保留两份原生运行时。

构建目标的可选 npm 包未安装时，仅构建机下载 package-lock 中锁定的确切版本，先核对 SHA-512，再展开。用户安装后不运行 npm、不自动下载 Codex、不要求全局安装。缺少构建所需资源会中止打包，不能生成静默依赖外部 Codex 的应用。

每个平台生成 manifest（版本、目标、npm integrity、全部资源及其复制时 SHA-256）。签名前核对每个资源；macOS 应用签名可能改变 Mach-O 字节，因此 manifest 明确标注 before-application-signing，产品启动检查版本、文件与应用内路径，不把签名前摘要当作签名后的校验值。签名发行仍需原发布流程。

## 验收

`npm run ua1:codex:package` 使用与生产相同的两处打包 hooks，生成独立、未签名的 Electron 工程测试应用并实际启动。应用没有 node_modules，测试环境移除全局 PATH、使用隔离 HOME；原生模型响应由脚本提供，不调用真实供应商。

macOS arm64 实测通过：

- 实际 packaged Electron 中只解析 Resources/agent-runtime/codex 的程序。
- 原生 composer、终端命令、磁盘 patch 和 MCP read_skill 均执行成功。
- 搜索明确使用包内 rg；测试命令 PATH 中不存在额外 Node。
- 42 个上游资源全部复制并逐文件核对，约 317.54 MiB（332,968,547 字节，未压缩；另有根许可文件）。
- 源码大小/类型检查、200 个单元测试（199 通过、1 项既有跳过）与原生恢复/补充/取消回归通过。

报告位于忽略目录 `runtime/agent/codex-package-smoke/package-report.json`。这个最小工程应用验证打包与原生调用，不是完整材料安装包，也不是智能或科学结论验收。Windows/Linux 有目标打包准备逻辑，原生执行隔离及实机安装仍需后续验收；目前产品 Codex 功能仍仅开放已验收的 macOS。

已有发布文件没有因代码修改自动更新。后续 `npm run package:mac` / `npm run package:win` 等正常 electron-builder 入口都会执行独立运行时 hooks，正式发布还须完成各平台签名和验收。
