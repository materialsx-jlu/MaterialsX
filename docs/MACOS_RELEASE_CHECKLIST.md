# macOS 安装包发布检查

`v0.3.0` 的 DMG 校验和正确，但镜像中的 `MaterialsX.app` 没有完整的应用签名封装。`codesign --verify --deep --strict` 报 `code has no resources but signature indicates they must be present`，Gatekeeper 拒绝运行。磁盘镜像完整并不等于应用可安装。

## 构建和公证

1. 在构建 Mac 的钥匙串安装 **Developer ID Application** 证书及对应私钥。用 `security find-identity -p codesigning -v` 确认存在有效身份。
2. 在钥匙串创建 Apple notarytool 凭据配置，设置 `MATERIALSX_NOTARY_PROFILE` 为配置名称。不要把证书、私钥或公证密码提交到仓库。
3. 使用经过审核的 production 部署清单设置 `MATERIALSX_DEPLOY_MANIFEST`，运行 `npm run package:mac`。该命令会先检查签名身份与公证配置，生成 DMG、提交 Apple 公证并把票据装订到 DMG；任一步失败都不能发布。
4. 运行 `npm run release:mac:verify`。检查 DMG 完整性、镜像内 App 的 Developer ID 签名、Gatekeeper 接受情况和公证票据。
5. 从最终下载地址重新下载 DMG，核对 SHA-256，在启用 Gatekeeper 的干净 macOS 用户或另一台 Mac 上安装并启动；验证登录、本地模型、内置 Skills、机器学习势及卸载。记录系统版本和结果。

`package:preview:mac` 仅用于本机工程验收，采用临时签名且未公证；不能把它描述为下载后可直接打开的公开安装包。不要用 `xattr -d com.apple.quarantine` 代替发布验收。

## 体积

四套原子计算环境需要各自的 Python 包，但其中不少 PyTorch 等依赖的文件完全一致。打包钩子只在复制到 App 后，将字节、权限一致的大文件合并为硬链接，并删除 Python `-B` 运行模式不使用的 `.pyc` 缓存。原始运行环境和权重文件不受影响；发布前仍须对四套环境逐一运行导入和计算验收。
