# M4 发布证据

发布门槛只读取经过复核的 JSON 证据，不用空文件绕过检查。允许的文件名：

- `macos-arm64-install.json`：签名安装、首次启动、升级和卸载记录。
- `windows-x64-install.json`：签名安装、无管理员路径、升级和卸载记录。
- `science-holdout.json`：文献、计算材料、高分子/复合材料保留集结果及专家签收。
- `update-rollback.json`：应用更新、依赖下载恢复、SQLite 迁移和回退演练。

正式格式会在对应工作包实施时固定；当前不能用占位证据把 v1 阻断项改为通过。
