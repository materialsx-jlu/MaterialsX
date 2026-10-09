export default {
  code: 'zh-CN', htmlLang: 'zh-CN', name: '简体中文',
  meta: {
    title: 'MaterialsX｜让材料研究有据可查',
    description: 'MaterialsX 是面向材料科研的本地优先工作台。组织论文与实验数据、调用科研 Skills、连接 MOOS，并交付带来源的研究结果。',
  },
  nav: { product: '产品能力', process: '工作方式', gallery: '界面预览', download: '获取版本', faq: '常见问题', menu: '打开导航', language: '选择语言' },
  topbar: '0.3.0 已开放下载 · MX 点与模型计费仍在试点',
  a11y: { skip: '跳转到正文', backToTop: '返回顶部', metrics: 'MaterialsX 产品概况' },
  hero: {
    eyebrow: 'LOCAL-FIRST RESEARCH WORKSPACE',
    title: '把材料问题，推进到', highlight: '可核对的研究结果。',
    description: '从论文、配方和实验记录出发，让 Agent 调用合适的 Skills 与工具，把过程、来源和产物留在同一个研究项目中。',
    primary: '了解产品能力', secondary: '查看版本状态',
    note: '桌面应用免费使用；0.3.0 安装包已公开并连接正式平台。MX 点充值和云模型服务目前限试点账户。',
  },
  metrics: [
    { value: '98', label: '内置科研 Skills' },
    { value: '176', label: '势与相关资源目录项' },
    { value: '2', label: '可选 Agent 引擎' },
  ],
  intro: {
    eyebrow: 'WHY MATERIALSX', title: '研究不是一次回答，而是一条可追溯的工作链。',
    description: 'MaterialsX 让任务目标、输入资料、工具执行和最终结论保持关联。未验证的数据会保留状态，模型计算也会标明适用边界。',
  },
  pillars: [
    { number: '01', title: '证据先行', description: '阅读论文与数据时保留页码、原始数值和来源，方便回到依据。' },
    { number: '02', title: '方法可见', description: '计划、Skill、工具调用与回执集中记录，知道每一步做了什么。' },
    { number: '03', title: '结果可复核', description: '图表、结构与报告落在项目中；缺项和科学限制不会被隐藏。' },
  ],
  process: {
    eyebrow: 'A RESEARCH FLOW', title: '从问题到交付，四步走得明白。',
    description: '简单问题直接处理；复杂任务先明确目标、约束与验收，再逐步执行。',
    steps: [
      { number: '01', title: '说明目标', description: '写下材料体系、想解决的问题、指标和限制。' },
      { number: '02', title: '收集依据', description: '选择论文、项目文件或已配置的 MOOS 数据。' },
      { number: '03', title: '运行方法', description: '按授权调用 Skills、分析工具或适用的模型。' },
      { number: '04', title: '检查交付', description: '查看数据、图表、结构、报告和未解决的问题。' },
    ],
  },
  features: {
    eyebrow: 'CAPABILITIES', title: '为真实的材料研究任务准备。',
    description: '把常用入口放在一起，同时明确哪些能力需要额外数据、运行时或人工复核。',
    cards: [
      { tag: '文献与文件', title: '有页码的资料提取', description: '支持 PDF、DOCX、表格与文本附件。提取内容保留页码、段落或工作表位置，方便核查原文。', foot: 'PDF 上限 100 MiB / 2000 页' },
      { tag: '科研流程', title: '98 项内置 Skills', description: '按主题浏览双语介绍和使用例子，在对话中用 @ 引用；也可安装本地或 GitHub Skill。', foot: '部分 Skill 仍需单独配置科学依赖' },
      { tag: '研究数据', title: '连接 MOOS 数据', description: '通过独立的只读 MCP 查询实验、配方、工艺、性能、图像与模拟记录，并保留复核状态。', foot: '需要先配置 MOOS 服务' },
      { tag: '材料模型', title: '先筛选，再计算', description: '浏览 100 项模型与相关资源，检查材料域、元素、许可、权重和运行时，再选择适用路线。', foot: '目录收录不等于权重已安装' },
      { tag: 'Agent 引擎', title: '本地或平台模型', description: '可选 Pi 或随应用打包的 Codex App Server；支持 LM Studio 本地接口与已配置的平台服务。', foot: '模型的工具能力需要实际验证' },
      { tag: '结构与验收', title: '看见计算，也看见边界', description: '查看原子结构与 3D 结果，核对单位、证据、收敛与方法适用范围，保留科学复核结论。', foot: '计算依赖匹配的运行时和权重' },
    ],
  },
  gallery: {
    eyebrow: 'INSIDE THE APP', title: '把研究过程放在一个工作台。',
    description: '以下为隔离演示环境中的开发版截图；实际界面与可用能力以安装版本和配置为准。',
    tabs: [
      { id: 'workbench', label: '研究工作台', title: '项目、任务和来源连在一起', description: '从本地项目开始，研究会话与输入文件留在同一工作空间。', imageAlt: 'MaterialsX 研究工作台截图' },
      { id: 'skills', label: 'Skills 目录', title: '按方法找到合适的 Skill', description: '浏览分类、能力、许可和使用示例，再把任务带回对话。', imageAlt: 'MaterialsX Skills 分类和详情截图' },
      { id: 'atomic', label: '原子结构 3D', title: '从数值走向可检查的结构', description: '在支持的环境中查看原子结构与计算产物；图像不能代替科学验证。', imageAlt: 'MaterialsX 原子结构三维界面截图' },
    ],
  },
  download: {
    eyebrow: 'DOWNLOAD STATUS', title: '选择适合你的安装包。',
    description: '0.3.0 的 macOS Apple Silicon 与 Windows x64 安装包连接正式平台，已发布到 GitHub Releases。签名、公证和跨设备验收仍在进行。',
    link: '查看 0.3.0 发布说明', guide: '查看使用指南',
    cards: [
      { platform: 'macOS', arch: 'Apple Silicon', status: '0.3.0：可下载', detail: '已完成本机校验；Apple 公证与全新设备安装验收尚未完成。', asset: 'macos', action: '下载 DMG' },
      { platform: 'Windows', arch: 'x64', status: '0.3.0：可下载', detail: '安装包已发布；Windows 实机验收尚未完成。', asset: 'windows', action: '下载 EXE' },
      { platform: 'Linux', arch: 'x64', status: '当前无公开安装包', detail: '请以发布页中明确标注的版本与架构为准。', asset: 'linux', action: '下载 AppImage' },
    ],
    verify: '下载后可对照 SHA-256 清单核验文件：', checksums: '查看 SHA256SUMS.txt',
    note: '软件不包含聊天模型权重；本地模型需自行在 LM Studio 等工具中加载。科研输出需人工复核。',
  },
  start: {
    eyebrow: 'GET STARTED', title: '从一个本地项目开始。',
    steps: [
      { title: '选择项目文件夹', description: '新建研究任务，让会话、输入和产物留在你的工作空间。' },
      { title: '连接模型', description: '在 LM Studio 加载模型并启动本机 API，然后在 MaterialsX 设置中检测接口。' },
      { title: '提出可核对的问题', description: '选一个 Skill 或直接描述目标，例如提取论文中的实验数据并附上页码。' },
    ],
    exampleLabel: '示例提问', example: '@materials-literature-rpsme-json 提取这篇论文的实验配方，列出原始用量和证据页码。',
  },
  faq: {
    eyebrow: 'FAQ', title: '开始前，先了解这些。',
    items: [
      { q: 'MaterialsX 软件本身收费吗？', a: '桌面软件免费使用。本地模型可在你的计算机运行。已准入的平台模型使用 MX 点按四类 Token 用量结算；当前仅在本机受限测试环境可购买，实际模型与价格以登录后的目录为准。' },
      { q: '100 项材料模型都已经装好并能运行吗？', a: '不是。100 项是双语目录条目，包括势、模型与相关资源。权重、依赖、许可和实际运行资格须逐项确认；目录展示不等于可执行。' },
      { q: '可以连接自己的本地模型吗？', a: '可以。MaterialsX 支持 LM Studio 的本机 API。工具调用和长任务表现取决于模型、接口能力与运行环境，建议先做兼容性检测。' },
      { q: 'MOOS 中的数据会自动可用吗？', a: '不会。需先部署并配置独立的 MOOS MCP 服务。查询为只读，待复核记录会保留原有状态，不被当作已证实结果。' },
      { q: '它能代替材料专家做结论吗？', a: '不能。MaterialsX 帮助组织证据、执行适用方法并留下回执；实验真实性、模型适用性和最终科学结论仍需研究者复核。' },
    ],
  },
  footer: { tagline: '面向材料研发的本地优先 AI 工作台。', product: '产品', resources: '资源', release: '公开版本', repository: 'GitHub 仓库', security: '安全问题', copyright: '© 2026 吉林大学 AI-DAOS 团队' },
};
