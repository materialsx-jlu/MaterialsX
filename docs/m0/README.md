# M0 技术验证

当前进展见 [开发状态](../STATUS.md)。

## 运行

```bash
npm install
npm run skills:sync
uv lock --project python
uv sync --project python
npm run verify
npm run m0:electron
npm run m0:lammps
npm run m0:qe
```

一键 CI 验证使用 `./ci.sh`。Electron smoke 需要图形会话；CI 默认不运行它，macOS 本机应单独运行。

## 结果解释

- `pass`：在报告所列主机和版本实际运行通过。
- `missing`：可执行文件或初始包不存在。
- `blocked`：命令存在但服务/环境不可用，例如 Docker CLI 已安装但 daemon 未启动。

`artifacts/m0/preflight.json` 是本机快照且被 Git 忽略。跨平台结论以 CI 产物为准。

当前 M0 的硬门槛是 Node/npm/uv、K-Dense 固定技能包及许可证元数据、TypeScript/Python 测试、Pi/MCP smoke。QE 与 LAMMPS 需要单独下载较大的求解器环境，不放进常规 CI；OCR 在装有 Tesseract 时自动运行，否则测试明确跳过。跨平台结论以真实 CI 产物为准。
