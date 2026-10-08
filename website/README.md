# MaterialsX 官网

这是与桌面应用分离的静态官网。页面有简体中文（`zh-CN`）、繁体中文（`zh-TW`）、英语（`en`）和日语（`ja`）四个版本。构建仅使用 Node.js 20+，不需要安装依赖，也不读取桌面应用的密钥或数据库。

```bash
cd website
npm run dev          # 构建并在 http://127.0.0.1:4174/ 预览
npm run check        # 检查翻译、内容、资源和部署路径
npm run build        # 生成 dist/
```

`dist/` 是可单独部署的静态目录。官网通过 GitHub Pages 发布在 [materialsx-jlu.github.io/MaterialsX/zh-CN/](https://materialsx-jlu.github.io/MaterialsX/zh-CN/)，推送 `website/` 的变更到 `main` 后会自动构建和部署。本地复现 GitHub Pages 的子路径构建可运行：

```bash
SITE_BASE_PATH=/MaterialsX/ SITE_ORIGIN=https://materialsx-jlu.github.io npm run build
```

`SITE_ORIGIN` 可选；设置后会生成 canonical 链接、hreflang 绝对 URL 和站点地图。部署前应替换为实际 HTTPS 域名。服务端需要让 `/` 访问 `index.html`；根页会根据浏览器语言转向对应的静态语言目录，四个语言地址也可以直接访问。

## 内容维护

- 文案在 `src/i18n/`；四份文案保持相同字段结构，`npm run check` 会核对。
- 页面结构在 `src/render.mjs`，新增研究任务与专题文案在 `src/research-content.mjs`，样式在 `src/styles.css` 和 `src/showcase.css`，交互在 `src/site.js`。
- `public/images/` 是项目自有 Logo 和开发演示截图。原有素材来自本仓库的 `assets/brand/`、`docs/images/`、`docs/m6/screenshots/`；研究任务、势目录、MOOS 连接及本地模型四张新截图取自隔离的 MaterialsX 开发版演示环境。截图仅展示开发环境，不承诺每个安装版本的界面一致。
- 下载按钮指向公开的 [GitHub Releases](https://github.com/materialsx-jlu/MaterialsX/releases)。0.3.0-preview.1 的 macOS Apple Silicon 和 Windows x64 预览安装包已公开；新版本发布时应同步更新四种语言的版本状态。
- 目录中的 100 项材料模型并非全部安装或可运行；页面须继续保留这一说明。MOOS 也须独立配置后才能查询。

官网内容、设计和资源在 `website/` 内独立构建；此目录的构建不会修改桌面应用或其发布流程。
